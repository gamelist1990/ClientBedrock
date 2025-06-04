import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import log from 'electron-log';

// Configure logging
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

// UTF-8エンコーディングの設定
if (process.platform === 'win32') {
    process.env.PYTHONIOENCODING = 'utf-8';
    process.env.NODE_ENV = process.env.NODE_ENV || 'development';
}

const execAsync = promisify(exec);

const PROGRAMFILES_PATH = process.env.ProgramFiles || 'C:\\Program Files';
const PROGRAMFILESX86_PATH = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const PEXTOOL_FOLDER_NAME = 'PEXtool';

interface InstalledToolInfo {
    name: string;
    productName?: string;
    description: string;
    path: string;
    uninstallerPath: string;
    uninstallerType: 'electron' | 'inno';
    diskUsage: string;
}

let mainWindow: BrowserWindow;

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
        title: 'PEX Uninstall Tool',
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
    const APP_USER_MODEL_ID = 'com.pexuninstaller.electron';
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
                    name: 'PEX Uninstall Tool',
                    items: [
                        {
                            type: 'task',
                            title: 'PEX Uninstall Toolを開く',
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

// ディレクトリサイズを計算する関数
function calculateDirSize(dirPath: string): number {
    let totalSize = 0;
    
    try {
        const files = fs.readdirSync(dirPath);
        
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stats = fs.statSync(filePath);
            
            if (stats.isDirectory()) {
                totalSize += calculateDirSize(filePath);
            } else {
                totalSize += stats.size;
            }
        }
    } catch (error) {
        log.error(`Error calculating directory size: ${dirPath}`, error);
    }
    
    return totalSize;
}

// サイズを人間が読める形式に変換
function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
}

// EXEファイルの詳細情報を取得（Windows API経由）
async function getExeFileInfo(exePath: string): Promise<{ productName?: string; description?: string; version?: string }> {
    try {
        // ファイルが存在するかチェック
        if (!fs.existsSync(exePath)) {
            log.warn(`EXE file does not exist: ${exePath}`);
            return {};
        }
        
        // パスを安全にエスケープ
        const escapedPath = exePath.replace(/'/g, "''");
          // PowerShellでファイル情報を直接取得（UTF-8エンコーディング指定）
        const powershellCommand = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; try { $file = Get-Item '${escapedPath}'; $v = $file.VersionInfo; Write-Output "PRODUCT_NAME:$($v.ProductName)"; Write-Output "FILE_DESCRIPTION:$($v.FileDescription)"; Write-Output "FILE_VERSION:$($v.FileVersion)" } catch { Write-Output "ERROR:Failed to get file info" }`;        const { stdout, stderr } = await execAsync(`powershell -OutputFormat Text -Command "${powershellCommand}"`, {
            timeout: 10000,
            windowsHide: true,
            encoding: 'utf8',
            env: { ...process.env, LANG: 'en_US.UTF-8' }
        });
        
        if (stderr) {
            log.warn(`PowerShell stderr for ${exePath}:`, stderr);
        }
        
        log.debug(`PowerShell stdout for ${exePath}:`, stdout);
        
        if (stdout && stdout.trim()) {
            const lines = stdout.trim().split('\n');
            let productName: string | undefined;
            let description: string | undefined;
            let version: string | undefined;
            
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine.startsWith('ERROR:')) {
                    log.error(`PowerShell error for ${exePath}:`, trimmedLine);
                    return {};
                } else if (trimmedLine.startsWith('PRODUCT_NAME:')) {
                    const value = trimmedLine.substring('PRODUCT_NAME:'.length).trim();
                    productName = value && value !== '' ? value : undefined;
                } else if (trimmedLine.startsWith('FILE_DESCRIPTION:')) {
                    const value = trimmedLine.substring('FILE_DESCRIPTION:'.length).trim();
                    description = value && value !== '' ? value : undefined;
                } else if (trimmedLine.startsWith('FILE_VERSION:')) {
                    const value = trimmedLine.substring('FILE_VERSION:'.length).trim();
                    version = value && value !== '' ? value : undefined;
                }
            }
            
            log.info(`Extracted EXE info for ${path.basename(exePath)} - Product: "${productName}", Description: "${description}", Version: "${version}"`);
            
            return {
                productName: productName || undefined,
                description: description || undefined,
                version: version || undefined
            };
        } else {
            log.warn(`No output from PowerShell for ${exePath}`);
        }
    } catch (error) {
        log.error(`Error getting EXE file info for ${exePath}:`, error);
    }
    
    return {};
}

// ツールの製品名と説明を取得
async function getToolInfo(toolPath: string, folderName: string): Promise<{ name: string; productName?: string; description: string }> {
    let productName: string | undefined;
    let description: string = 'PEXツール';
      // 1. pex.txtファイルをチェック（Inno Setupアプリ用）
    const pexTextPath = path.join(toolPath, 'pex.txt');
    if (fs.existsSync(pexTextPath)) {
        try {
            const pexContent = await fs.promises.readFile(pexTextPath, 'utf-8');
            const lines = pexContent.split('\n').map(line => line.trim()).filter(line => line);
            
            let pexName: string | undefined;
            let pexVersion: string | undefined;
            let pexDescription: string | undefined;
            
            // Name=, Version=, Description= 形式で解析
            for (const line of lines) {
                if (line.startsWith('Name=')) {
                    pexName = line.substring('Name='.length).trim();
                } else if (line.startsWith('Version=')) {
                    pexVersion = line.substring('Version='.length).trim();
                } else if (line.startsWith('Description=')) {
                    pexDescription = line.substring('Description='.length).trim();
                }
            }
            
            if (pexName || pexDescription) {
                return {
                    name: folderName, // フォルダ名
                    productName: pexName || folderName,
                    description: pexDescription || 'PEXツール'
                };
            }
        } catch (error) {
            log.warn(`Error reading pex.txt: ${pexTextPath}`, error);
        }
    }
    
    // 2. メインEXEファイルを探してバージョン情報を取得
    try {
        const files = await fs.promises.readdir(toolPath);
        const exeFiles = files.filter(file => 
            file.toLowerCase().endsWith('.exe') && 
            !file.toLowerCase().includes('uninstall') &&
            !file.toLowerCase().startsWith('unins')
        );
          if (exeFiles.length > 0) {
            // 最初に見つかったEXEファイルから詳細情報を取得
            const mainExePath = path.join(toolPath, exeFiles[0]);
            const exeInfo = await getExeFileInfo(mainExePath);
            
            log.info(`EXE Info for ${mainExePath}:`, exeInfo);
            
            if (exeInfo.productName || exeInfo.description) {
                productName = exeInfo.productName;
                // FileDescriptionを優先して使用、なければProductNameやファイル名をフォールバック
                description = exeInfo.description || exeInfo.productName || 'アプリケーション';
            } else {
                // EXEファイル名をフォールバックとして使用
                productName = path.parse(exeFiles[0]).name;
                description = 'アプリケーション';
            }
        }
    } catch (error) {
        log.warn(`Error scanning for exe files in: ${toolPath}`, error);
    }
    
    // 3. package.jsonファイルをチェック（Electronアプリ用）
    if (!productName) {
        const packageJsonPath = path.join(toolPath, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            try {
                const packageContent = await fs.promises.readFile(packageJsonPath, 'utf-8');
                const packageData = JSON.parse(packageContent);
                
                productName = packageData.productName || packageData.name;
                description = packageData.description || 'Electronアプリケーション';
            } catch (error) {
                log.warn(`Error reading package.json: ${packageJsonPath}`, error);
            }
        }
    }
    
    // 4. resourcesフォルダ内のpackage.jsonをチェック（パッケージ化されたElectronアプリ用）
    if (!productName) {
        const resourcesPackagePath = path.join(toolPath, 'resources', 'app', 'package.json');
        if (fs.existsSync(resourcesPackagePath)) {
            try {
                const packageContent = await fs.promises.readFile(resourcesPackagePath, 'utf-8');
                const packageData = JSON.parse(packageContent);
                
                productName = packageData.productName || packageData.name;
                description = packageData.description || 'Electronアプリケーション';
            } catch (error) {
                log.warn(`Error reading resources package.json: ${resourcesPackagePath}`, error);
            }
        }
    }
    
    // 5. フォールバック: フォルダ名を使用
    if (!productName) {
        productName = folderName;
    }
    
    return {
        name: folderName, // フォルダ名（システム管理用）
        productName, // 表示用の製品名
        description // 詳細説明
    };
}

// インストールされているPEXtoolを検索
async function findInstalledTools(): Promise<InstalledToolInfo[]> {
    const installedTools: InstalledToolInfo[] = [];
    
    // Program Files と Program Files (x86) 両方を検索
    const searchPaths = [PROGRAMFILES_PATH, PROGRAMFILESX86_PATH];
    
    for (const searchPath of searchPaths) {
        const pexToolMainPath = path.join(searchPath, PEXTOOL_FOLDER_NAME);
        
        try {
            // PEXtoolメインフォルダが存在するかチェック
            if (!fs.existsSync(pexToolMainPath)) {
                log.info(`PEXtool folder not found: ${pexToolMainPath}`);
                continue;
            }
            
            const entries = await fs.promises.readdir(pexToolMainPath, { withFileTypes: true });
            
            for (const entry of entries) {
                // PEXtoolフォルダ内のサブフォルダ（個別ツール）を探す
                if (entry.isDirectory()) {
                    const toolPath = path.join(pexToolMainPath, entry.name);
                    let uninstallerPath = '';
                    let uninstallerType: 'electron' | 'inno' = 'inno';
                    
                    // アンインストーラーを探す
                    try {
                        const toolFiles = await fs.promises.readdir(toolPath);
                        
                        // Electronアプリの場合のアンインストーラー
                        const electronUninstallers = toolFiles.filter(file => 
                            file.toLowerCase().includes('uninstall') && 
                            file.toLowerCase().endsWith('.exe'));
                        
                        if (electronUninstallers.length > 0) {
                            uninstallerPath = path.join(toolPath, electronUninstallers[0]);
                            uninstallerType = 'electron';
                        } else {
                            // Innoセットアップの場合のアンインストーラー
                            const innoUninstaller = toolFiles.find(file => 
                                file.toLowerCase().startsWith('unins') && 
                                file.toLowerCase().endsWith('.exe'));
                            
                            if (innoUninstaller) {
                                uninstallerPath = path.join(toolPath, innoUninstaller);
                                uninstallerType = 'inno';
                            }
                        }
                          if (uninstallerPath) {
                            // フォルダサイズを計算
                            const dirSize = calculateDirSize(toolPath);
                            const formattedSize = formatBytes(dirSize);
                            
                            // 自分自身のパスを確認して除外（自身はアンインストールリストに表示しない）
                            const currentAppPath = path.dirname(app.getAppPath());
                            const currentAppName = path.basename(currentAppPath);                            // PEX Uninstall Tool自身を除外（複数のパターンをチェック）
                            const folderNameLower = entry.name.toLowerCase();
                            const isOwnApp = folderNameLower === 'pex-uninstall-tool' ||
                                           folderNameLower === 'pexuninstalltool' ||
                                           folderNameLower === 'pexuninstaller' ||
                                           folderNameLower.includes('pex-uninstall') ||
                                           folderNameLower.includes('pexuninstall') ||
                                           toolPath === currentAppPath;
                            
                            if (!isOwnApp) {
                                // ツール名と説明を取得
                                const { name, productName, description } = await getToolInfo(toolPath, entry.name);
                                
                                installedTools.push({
                                    name, // フォルダ名（skinInjector, sample など）
                                    productName, // 製品名（EXEファイルから取得）
                                    description, // ツールの説明
                                    path: toolPath,
                                    uninstallerPath,
                                    uninstallerType,
                                    diskUsage: formattedSize
                                });
                                
                                log.info(`Found PEX tool: ${productName || name} (${description}) - Folder: ${entry.name} at ${toolPath}`);
                            } else {
                                log.info(`Excluding self from uninstall list: ${entry.name} (matched exclusion pattern)`);
                            }
                        } else {
                            log.warn(`No uninstaller found for tool: ${entry.name} at ${toolPath}`);
                        }
                    } catch (error) {
                        log.error(`Error scanning tool directory: ${toolPath}`, error);
                    }
                }
            }
        } catch (error) {
            log.error(`Error scanning PEXtool directory: ${pexToolMainPath}`, error);
        }
    }
    
    log.info(`Found ${installedTools.length} PEX tools`);
    return installedTools;
}

// IPC handlers for uninstaller
ipcMain.handle('get-installed-tools', async (): Promise<InstalledToolInfo[]> => {
    log.info('Scanning for installed PEX tools...');
    return await findInstalledTools();
});

ipcMain.handle('launch-uninstaller', async (_, toolPath: string): Promise<boolean> => {
    log.info(`Launching uninstaller: ${toolPath}`);
    
    try {
        if (os.platform() === 'win32') {
            await shell.openPath(toolPath);
            return true;
        }
        return false;
    } catch (error) {
        log.error(`Error launching uninstaller: ${toolPath}`, error);
        return false;
    }
});

ipcMain.handle('get-disk-usage', async (_, toolPath: string): Promise<string> => {
    try {
        const dirSize = calculateDirSize(toolPath);
        return formatBytes(dirSize);
    } catch (error) {
        log.error(`Error calculating disk usage: ${toolPath}`, error);
        return 'Unknown';
    }
});
