import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import { URL } from 'url';
import { Mutex } from 'async-mutex';

interface DataEntry {
    value: any; // JSON data
    lock: Mutex;  // Per-entry lock for concurrency control
    version: number; // Version number for conflict resolution
    timestamp: number; // Timestamp for conflict resolution (optional, for last-write-wins)
}

class JsonDB {
    private dbPath: string;
    private data: Map<string, DataEntry> = new Map();
    private writeQueue: { [key: string]: Promise<void> } = {};
    private debugMode: boolean;
    private mergeAlgorithm: 'last-write-wins' | 'version-control'; // Conflict resolution strategy


    constructor(dbPath: string = path.join(process.cwd(), 'db'), debugMode: boolean = false, mergeAlgorithm: 'last-write-wins' | 'version-control' = 'version-control') {
        this.dbPath = dbPath;
        this.debugMode = debugMode;
        this.mergeAlgorithm = mergeAlgorithm;
    }


    private logDebug(...args: any[]) {
        if (this.debugMode) {
            console.log('[DEBUG]', ...args);
        }
    }

    async init(): Promise<void> {
        this.logDebug('Initializing database...');
        try {
            await fs.mkdir(this.dbPath, { recursive: true });
            this.logDebug('Database directory:', this.dbPath);
            await this.loadAllData();
        } catch (error) {
            console.error('Failed to initialize database:', error);
            throw error;
        }
        this.logDebug('Database initialized.');
    }

    private async loadAllData(): Promise<void> {
        this.logDebug('Loading all data...');
        const keys = await fs.readdir(this.dbPath);
        this.logDebug('Found keys:', keys);
        for (const key of keys) {
            if ((await fs.stat(path.join(this.dbPath, key))).isDirectory()) {
                try {
                    await this.load(key);
                } catch (e) {
                    console.warn("invalid entry", e)
                }
            }
        }
        this.logDebug('All data loaded.');
    }

    private async load(key: string): Promise<void> {
        this.logDebug(`Loading data for key: ${key}`);
        const keyPath = path.join(this.dbPath, key);
        const dataFilePath = path.join(keyPath, 'data.json');
        let loadedEntry: DataEntry | null = null;
        try {
            const data = await fs.readFile(dataFilePath, 'utf-8');
            const parsedData = JSON.parse(data);
            // Ensure the loaded data has the correct structure (including version and timestamp)
            if (parsedData && typeof parsedData.value !== 'undefined' && typeof parsedData.version === 'number') {
                loadedEntry = {
                    value: parsedData.value,
                    lock: new Mutex(),
                    version: parsedData.version,
                    timestamp: parsedData.timestamp || Date.now() // Default to current time if missing
                };
                this.logDebug(`Loaded data for key ${key}:`, loadedEntry);
            } else {
                console.warn(`Invalid data format for key "${key}".  Ignoring.`);
                return;
            }

        } catch (err: any) {
            if (err.code === 'ENOENT') {
                console.warn(`Data file not found for key "${key}". It may be new.`);
                return;
            } else {
                console.error("load failed. key:", key, err);
                return;
            }
        }
        if (loadedEntry) {
            this.data.set(key, loadedEntry);
        }

    }

    async get(key: string): Promise<any | undefined> {
        this.logDebug(`Getting value for key: ${key}`);
        let entry = this.data.get(key);

        if (!entry) {
            this.logDebug(`Key not found in memory, Key:${key} loading from disk...`);
            await this.load(key);
            entry = this.data.get(key);
            if (!entry) return undefined;
        }

        if (entry.value === null || entry.value === undefined) {
            this.logDebug(`Key found but value is not load, loading Key:${key} `);
            await this.load(key);
            entry = this.data.get(key)
        }

        if (!entry) {
            throw new Error(`Entry not found for key: ${key}`);
        }


        const release = await entry.lock.acquire();
        try {
            this.logDebug(`Value for key ${key}:`, entry?.value);
            return entry.value;
        } finally {
            release();
        }
    }


    async set(key: string, value: any, clientVersion?: number, clientTimestamp?: number): Promise<void> {
        this.logDebug(`Setting value for key: ${key}`, value);
        const keyPath = path.join(this.dbPath, key);
        const dataFilePath = path.join(keyPath, 'data.json');
        let entry = this.data.get(key);


        if (!entry) {
            this.logDebug(`Creating new entry for key: ${key}`);
            entry = { value: null, lock: new Mutex(), version: 0, timestamp: Date.now() }; // Initialize new entry
            this.data.set(key, entry);
        }


        const release = await entry.lock.acquire();
        try {
            await fs.mkdir(keyPath, { recursive: true });

            if (!this.writeQueue[key]) {
                this.writeQueue[key] = Promise.resolve();
            }

            this.writeQueue[key] = this.writeQueue[key].then(async () => {
                this.logDebug(`Writing to file: ${dataFilePath}`);

                // --- Conflict Resolution Logic ---
                let currentVersion = entry!.version;
                let currentTimestamp = entry!.timestamp;
                let newValue = value;
                let newVersion = currentVersion + 1;  // Always increment version

                if (clientVersion !== undefined) { // If client provides a version
                    if (this.mergeAlgorithm === 'version-control' && clientVersion < currentVersion) {
                        // Conflict: Client version is older than server version
                        release(); // Release before throwing
                        throw new Error(`Conflict: Client version (${clientVersion}) is older than server version (${currentVersion}) for key ${key}`);
                    } else if (this.mergeAlgorithm === 'last-write-wins' && clientTimestamp && clientTimestamp < currentTimestamp) {
                        // Conflict: Client timestamp is older (optional, for last-write-wins)
                        console.warn("last-write-wins conflict. key:", key)
                        // release(); // Release before throwing
                        // throw new Error(`Conflict: Client timestamp is older for key ${key}`);
                        // last-write-wins
                    }
                }

                // Prepare the data to be saved (including version and timestamp)
                const dataToSave = {
                    value: newValue,
                    version: newVersion,
                    timestamp: Date.now()  // Update timestamp
                };
                entry!.value = newValue;
                entry!.version = newVersion;
                entry!.timestamp = dataToSave.timestamp;


                const serializedValue = JSON.stringify(dataToSave, null, 2);

                try {
                    await fs.writeFile(dataFilePath, serializedValue, 'utf-8');
                    this.logDebug(`Write successful: ${dataFilePath}`);
                } catch (err) {
                    console.error("file error", err);
                }
            }).catch(err => {
                console.error(`Error writing to file for key ${key}:`, err);
            });
            await this.writeQueue[key];
        } finally {
            release();
        }
    }



    async delete(key: string): Promise<boolean> {
        this.logDebug(`Deleting key: ${key}`);
        const keyPath = path.join(this.dbPath, key);
        const entry = this.data.get(key);

        if (!entry) {
            this.logDebug(`Key not found for deletion: ${key}`);
            return false;
        }

        const release = await entry.lock.acquire();
        try {
            if (this.data.has(key)) {
                await fs.rm(keyPath, { recursive: true, force: true });
                this.logDebug(`Deleted key and directory: ${key}`);
                this.data.delete(key);
                delete this.writeQueue[key];
                return true;
            }
            return false;
        } catch (e: any) {
            console.error("delete file err ", e)
            return false;
        } finally {
            release();
        }
    }

    async getAllKeys(): Promise<string[]> {
        const keys = Array.from(this.data.keys());
        this.logDebug('Getting all keys:', keys);
        return keys;
    }

    private safeParse(data: string): any | undefined {
        try {
            return JSON.parse(data);
        } catch {
            return undefined;
        }
    }
}

async function startServer(db: JsonDB, port: number = 3000, _debugMode: boolean = false) {
    const server = http.createServer(async (req, res) => {
        console.log(`[Request] ${req.method} ${req.url}`);

        try {
            const url = new URL(req.url!, `http://${req.headers.host}`);

            const sendResponse = (statusCode: number, data: any, contentType: string = 'application/json') => {
                console.log(`[Response] ${statusCode} ${req.url}`);
                res.statusCode = statusCode;
                res.setHeader('Content-Type', contentType);
                res.end(typeof data === 'string' ? data : JSON.stringify(data));
            };
            if (url.pathname === '/get') {
                const key = url.searchParams.get('key');
                if (!key) {
                    return sendResponse(400, { error: 'Missing key parameter' });
                }
                const value = await db.get(key);
                if (value === undefined) {
                    return sendResponse(404, { error: 'Key not found' });
                }
                sendResponse(200, value);
            } else if (url.pathname === '/set') {
                const key = url.searchParams.get('key');
                if (!key) {
                    return sendResponse(400, { error: 'Missing key parameter' });
                }

                let body = '';
                req.on('data', chunk => {
                    body += chunk.toString();
                });
                req.on('end', async () => {
                    console.log('[Request Body]', body);
                    const parsedBody = db["safeParse"](body)
                    if (parsedBody === undefined) {
                        return sendResponse(400, { error: 'Invalid JSON body' });
                    }
                    const clientVersion = parsedBody.version; // Extract client version from request body
                    const clientTimestamp = parsedBody.timestamp;


                    try {
                        await db.set(key, parsedBody.value === undefined ? parsedBody : parsedBody.value, clientVersion, clientTimestamp); // Pass version to set()
                        sendResponse(200, { message: 'Data set successfully' });
                    } catch (error: any) {
                        if (error.message.startsWith('Conflict:')) {
                            sendResponse(409, { error: error.message }); // 409 Conflict
                        } else {
                            sendResponse(500, { error: error.message });
                        }
                    }
                });
                req.on("error", (err) => {
                    sendResponse(500, { error: err.message });
                })
            } else if (url.pathname === '/delete') {
                const key = url.searchParams.get('key');
                if (!key) {
                    return sendResponse(400, { error: 'Missing key parameter' });
                }
                const result = await db.delete(key)
                if (!result) {
                    return sendResponse(404, { error: 'Key not found' });
                }
                sendResponse(200, { message: "Data delete successfully" })
            } else if (url.pathname === '/keys') {
                const keys = await db.getAllKeys();
                sendResponse(200, keys);
            } else {
                sendResponse(404, { error: 'Not Found' });
            }
        } catch (err: any) {
            console.error("serve error:", err)
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err.message || "Internal Server Error" }))
        }
    });


    // Use the 'listening' event to get the actual port
    server.listen(port, () => {
        const address = server.address();
        const port = typeof address === 'string' ? address : address?.port;
        console.log(`Server running on port ${port}`);
    });


    process.on('SIGINT', async () => {
        console.log('Shutting down server...');
        server.close(() => {
            console.log('Server shut down.');
            process.exit(0);
        });
    });
}


async function main() {
    const debugMode = process.argv.includes('--debug');
    const randomPort = process.argv.includes('--random-port');
    const mergeAlgorithm = process.argv.includes('--last-write-wins') ? 'last-write-wins' : 'version-control'; // Default to version-control

    const db = new JsonDB(path.join(process.cwd(), "db"), debugMode, mergeAlgorithm);
    await db.init();

    // Determine the port based on --random-port flag
    const port = randomPort ? 0 : 2000; // 0 will trigger automatic port assignment
    await startServer(db, port, debugMode);
}

main();