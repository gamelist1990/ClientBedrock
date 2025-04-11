import { promises as fs } from 'fs';
import * as path from 'path';

// Json db 更新 各guild に対応版

interface GuildData {
    [key: string]: any;
}

interface DatabaseStructure {
    [guildId: string]: GuildData;
}

class JsonDB {
    private filePath: string;
    private dbDir: string;

    constructor(dbName: string, dbDirectory: string = './database') {
        this.dbDir = path.resolve(dbDirectory);
        this.filePath = path.join(this.dbDir, `${dbName}.json`);
    }

    private async ensureDirectoryExists(): Promise<void> {
        try {
            await fs.mkdir(this.dbDir, { recursive: true });
        } catch (error: any) {
            if (error.code !== 'EEXIST') {
                console.error(`Error creating directory ${this.dbDir}:`, error);
                throw error;
            }
        }
    }

    private async readData(): Promise<DatabaseStructure> {
        await this.ensureDirectoryExists();
        try {
            const data = await fs.readFile(this.filePath, 'utf-8');
            return JSON.parse(data) as DatabaseStructure;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return {};
            }
            console.error(`Error reading or parsing database file ${this.filePath}:`, error);
            throw error;
        }
    }

    private async writeData(data: DatabaseStructure): Promise<void> {
        await this.ensureDirectoryExists();
        try {
            await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (error) {
            console.error(`Error writing database file ${this.filePath}:`, error);
            throw error;
        }
    }

    async getAll(guildId: string): Promise<GuildData> {
        const allData = await this.readData();
        return allData[guildId] || {};
    }

    async get(guildId: string, key: string): Promise<any | undefined> {
        const allData = await this.readData();
        if (allData[guildId] && allData[guildId].hasOwnProperty(key)) {
            return allData[guildId][key];
        }
        return undefined;
    }

    async set(guildId: string, key: string, value: any): Promise<void> {
        const allData = await this.readData();
        if (!allData[guildId]) {
            allData[guildId] = {};
        }
        allData[guildId][key] = value;
        await this.writeData(allData);
    }

    async delete(guildId: string, key: string): Promise<boolean> {
        const allData = await this.readData();
        if (allData[guildId] && allData[guildId].hasOwnProperty(key)) {
            delete allData[guildId][key];
            await this.writeData(allData);
            return true;
        }
        return false;
    }

    async has(guildId: string, key: string): Promise<boolean> {
        const allData = await this.readData();
        return !!allData[guildId] && allData[guildId].hasOwnProperty(key);
    }

    async clearGuild(guildId: string): Promise<void> {
        const allData = await this.readData();
        if (allData[guildId]) {
            allData[guildId] = {};
            await this.writeData(allData);
        }
    }

    async clearAllGuilds(): Promise<void> {
        await this.writeData({});
    }

    async getRawData(): Promise<DatabaseStructure> {
        return await this.readData();
    }
}

export default JsonDB;