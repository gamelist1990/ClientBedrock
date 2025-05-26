import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import AdmZip from 'adm-zip';
import { spawn, execSync } from 'child_process';
import crypto from 'crypto';
import log from 'electron-log';

// Configure logging
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

const MINECRAFT_UWP_PACKAGE_ID = 'Microsoft.MinecraftUWP_8wekyb3d8bbwe';
const PREMIUM_CACHE_SKIN_PACKS_SUBPATH = ['AppData', 'Local', 'Packages', MINECRAFT_UWP_PACKAGE_ID, 'LocalState', 'premium_cache', 'skin_packs'];
const MANIFEST_FILENAME = 'manifest.json';
const MC_ENCRYPTOR_DIR_NAME = 'MCEnc';
const MC_ENCRYPTOR_EXE_NAME = 'McEncryptor.exe';
const SAMPLE_CAPE_ZIP_URL = "https://pexserver.github.io/tool/File/GenSkin/index.html";

interface SkinPackInfo {
    name: string;
    path: string;
    isTemp?: boolean;
    originalMcpackPath?: string;
}

let mainWindow: BrowserWindow;

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
        title: 'Skin Injector',
        autoHideMenuBar: true
    });

    const isDev = process.argv.includes('--dev');
    if (isDev) {
        mainWindow.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    }
}

app.whenReady().then(() => {
    // Windowsのタスクバーアイコンを適切に設定
    // 注意: この値はpackage.jsonのappIdと完全に一致する必要がある
    const APP_USER_MODEL_ID = 'com.skinInjector.electron';
    app.setAppUserModelId(APP_USER_MODEL_ID);
    
    // Windowsの場合、さらに詳細なタスクバー設定
    if (process.platform === 'win32') {
        // アイコンパスを設定
        const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
        
        try {
            // ジャンプリストを設定（Windows 7以降）
            app.setJumpList([
                {
                    type: 'custom',
                    name: 'Skin Injector',
                    items: [
                        {
                            type: 'task',
                            title: 'Minecraft Skin Injectorを開く',
                            program: process.execPath,
                            iconPath: iconPath,
                            iconIndex: 0
                        }
                    ]
                }
            ]);
            
            log.info('Windows taskbar jump list set successfully');
        } catch (error) {
            log.warn('Failed to set jump list:', error);
        }
    }

    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// IPC handlers
ipcMain.handle('get-skin-packs', async (): Promise<SkinPackInfo[]> => {
    log.info('Scanning for installed skin packs...');

    if (os.platform() !== 'win32') {
        log.warn('Non-Windows platform detected, skipping installed skin pack scan');
        return [];
    }

    const skinPacksBaseDir = path.join(os.homedir(), ...PREMIUM_CACHE_SKIN_PACKS_SUBPATH);

    try {
        await fs.promises.access(skinPacksBaseDir);
    } catch (error) {
        log.error(`Skin packs directory not found: ${skinPacksBaseDir}`);
        return [];
    }

    const detectedSkinPacks: SkinPackInfo[] = [];
    const addedPackNames = new Set<string>();

    try {
        const entries = await fs.promises.readdir(skinPacksBaseDir, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const skinPackDir = path.join(skinPacksBaseDir, entry.name);
                const manifestPath = path.join(skinPackDir, MANIFEST_FILENAME);

                try {
                    await fs.promises.access(manifestPath);
                    const manifestContent = await fs.promises.readFile(manifestPath, 'utf-8');
                    const manifestJson = JSON.parse(manifestContent);
                    const packName = manifestJson.header?.name || entry.name;

                    if (!addedPackNames.has(packName)) {
                        detectedSkinPacks.push({ name: packName, path: skinPackDir });
                        addedPackNames.add(packName);
                    }
                } catch {
                    // Ignore directories without valid manifest
                }
            }
        }
    } catch (error) {
        log.error('Error reading skin packs directory:', error);
        return [];
    }

    detectedSkinPacks.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    log.info(`Found ${detectedSkinPacks.length} unique skin packs`);

    return detectedSkinPacks;
});

ipcMain.handle('select-mcpack-file', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: '.mcpack ファイルを選択',
        filters: [
            { name: 'MCPACK ファイル', extensions: ['mcpack'] },
            { name: 'ZIP ファイル', extensions: ['zip'] },
            { name: 'すべてのファイル', extensions: ['*'] }
        ],
        properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }

    return result.filePaths[0];
});

ipcMain.handle('select-folder', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'フォルダを選択',
        properties: ['openDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }

    return result.filePaths[0];
});

ipcMain.handle('unpack-mcpack', async (_, mcpackPath: string): Promise<SkinPackInfo | null> => {
    log.info(`Unpacking mcpack: ${mcpackPath}`);

    const tempDirSuffix = crypto.randomBytes(6).toString('hex');
    const tempDirPath = path.join(os.tmpdir(), `skinpack-temp-${tempDirSuffix}`);

    try {
        await fs.promises.mkdir(tempDirPath, { recursive: true });
        const zip = new AdmZip(mcpackPath);
        zip.extractAllTo(tempDirPath, true);

        let packName = path.basename(mcpackPath, path.extname(mcpackPath));

        try {
            const manifestContent = await fs.promises.readFile(path.join(tempDirPath, MANIFEST_FILENAME), 'utf-8');
            const manifestJson = JSON.parse(manifestContent);
            packName = manifestJson.header?.name || packName;
        } catch {
            log.warn(`Could not read manifest.json, using filename: ${packName}`);
        }

        log.info(`Successfully unpacked to: ${tempDirPath}`);
        return { name: packName, path: tempDirPath, isTemp: true, originalMcpackPath: mcpackPath };
    } catch (error) {
        log.error(`Error unpacking mcpack: ${mcpackPath}`, error);
        await fs.promises.rm(tempDirPath, { recursive: true, force: true }).catch(() => { });
        return null;
    }
});

ipcMain.handle('validate-source-pack', async (_, sourceFolderPath: string): Promise<boolean> => {
    const sourceManifestPath = path.join(sourceFolderPath, MANIFEST_FILENAME);
    try {
        await fs.promises.access(sourceManifestPath);
        log.info(`Source manifest.json found: ${sourceManifestPath}`);
        return true;
    } catch {
        log.error(`Source manifest.json not found: ${sourceManifestPath}`);
        return false;
    }
});

ipcMain.handle('replace-skin-pack', async (_, targetPath: string, sourcePath: string): Promise<boolean> => {
    log.info(`Replacing skin pack content: ${targetPath} <- ${sourcePath}`);

    try {
        // Delete existing content (except manifest.json)
        const entries = await fs.promises.readdir(targetPath);
        for (const entry of entries) {
            if (entry.toLowerCase() !== MANIFEST_FILENAME.toLowerCase()) {
                await fs.promises.rm(path.join(targetPath, entry), { recursive: true, force: true });
            }
        }

        // Copy new content (except manifest.json)
        await fs.promises.cp(sourcePath, targetPath, {
            recursive: true,
            filter: (src) => path.basename(src).toLowerCase() !== MANIFEST_FILENAME.toLowerCase()
        });

        log.info('Skin pack replacement completed successfully');
        return true;
    } catch (error) {
        log.error('Error replacing skin pack content:', error);
        return false;
    }
});

ipcMain.handle('repack-mcpack', async (_, tempPackDir: string, outputPath: string): Promise<boolean> => {
    log.info(`Repacking mcpack: ${tempPackDir} -> ${outputPath}`);

    try {
        const zip = new AdmZip();
        zip.addLocalFolder(tempPackDir);
        zip.writeZip(outputPath);

        log.info(`Successfully repacked to: ${outputPath}`);
        return true;
    } catch (error) {
        log.error(`Error repacking mcpack: ${outputPath}`, error);
        return false;
    }
});

ipcMain.handle('run-mc-encryptor', async (_, targetPackPath: string): Promise<boolean> => {
    const mcEncryptorExePath = path.join(process.cwd(), MC_ENCRYPTOR_DIR_NAME, MC_ENCRYPTOR_EXE_NAME);

    if (!fs.existsSync(mcEncryptorExePath)) {
        log.warn(`McEncryptor not found: ${mcEncryptorExePath}`);
        return true; // Skip if not available
    }

    log.info(`Running McEncryptor: ${mcEncryptorExePath}`);

    return new Promise((resolve) => {
        const proc = spawn(mcEncryptorExePath, [], {
            cwd: path.dirname(mcEncryptorExePath),
            stdio: ['pipe', 'inherit', 'inherit']
        });

        if (proc.stdin) {
            proc.stdin.write(targetPackPath + os.EOL);
            proc.stdin.end();
        } else {
            log.error("Cannot access McEncryptor stdin");
            resolve(false);
            return;
        }

        proc.on('close', (code) => {
            if (code === 0) {
                log.info('McEncryptor completed successfully');
                resolve(true);
            } else {
                log.error(`McEncryptor exited with error code: ${code}`);
                resolve(false);
            }
        });

        proc.on('error', (error) => {
            log.error('McEncryptor execution error:', error);
            resolve(false);
        });
    });
});

ipcMain.handle('cleanup-temp-dir', async (_, tempDirPath: string): Promise<void> => {
    if (tempDirPath && fs.existsSync(tempDirPath)) {
        try {
            await fs.promises.rm(tempDirPath, { recursive: true, force: true });
            log.info(`Cleaned up temporary directory: ${tempDirPath}`);
        } catch (error) {
            log.warn(`Error cleaning up temporary directory: ${tempDirPath}`, error);
        }
    }
});

ipcMain.handle('open-external-url', async (_, url: string): Promise<void> => {
    await shell.openExternal(url);
});

ipcMain.handle('get-sample-cape-url', (): string => {
    return SAMPLE_CAPE_ZIP_URL;
});

ipcMain.handle('save-mcpack-as', async (_, defaultPath: string): Promise<string | null> => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'MCPACKファイルを保存',
        defaultPath: defaultPath,
        filters: [
            { name: 'MCPACK ファイル', extensions: ['mcpack'] },
            { name: 'すべてのファイル', extensions: ['*'] }
        ]
    });

    if (result.canceled || !result.filePath) {
        return null;
    }

    return result.filePath;
});
