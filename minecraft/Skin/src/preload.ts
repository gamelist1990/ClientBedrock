import { contextBridge, ipcRenderer } from 'electron';

interface SkinPackInfo {
    name: string;
    path: string;
    isTemp?: boolean;
    originalMcpackPath?: string;
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    getSkinPacks: (): Promise<SkinPackInfo[]> => ipcRenderer.invoke('get-skin-packs'),
    selectMcpackFile: (): Promise<string | null> => ipcRenderer.invoke('select-mcpack-file'),
    selectFolder: (): Promise<string | null> => ipcRenderer.invoke('select-folder'),
    unpackMcpack: (mcpackPath: string): Promise<SkinPackInfo | null> => 
        ipcRenderer.invoke('unpack-mcpack', mcpackPath),
    validateSourcePack: (sourceFolderPath: string): Promise<boolean> => 
        ipcRenderer.invoke('validate-source-pack', sourceFolderPath),
    replaceSkinPack: (targetPath: string, sourcePath: string): Promise<boolean> => 
        ipcRenderer.invoke('replace-skin-pack', targetPath, sourcePath),
    repackMcpack: (tempPackDir: string, outputPath: string): Promise<boolean> => 
        ipcRenderer.invoke('repack-mcpack', tempPackDir, outputPath),
    runMcEncryptor: (targetPackPath: string): Promise<boolean> => 
        ipcRenderer.invoke('run-mc-encryptor', targetPackPath),
    cleanupTempDir: (tempDirPath: string): Promise<void> => 
        ipcRenderer.invoke('cleanup-temp-dir', tempDirPath),
    openExternalUrl: (url: string): Promise<void> => 
        ipcRenderer.invoke('open-external-url', url),
    getSampleCapeUrl: (): Promise<string> => 
        ipcRenderer.invoke('get-sample-cape-url'),
    saveMcpackAs: (defaultPath: string): Promise<string | null> => 
        ipcRenderer.invoke('save-mcpack-as', defaultPath)
});

// Type definitions for the exposed API
declare global {
    interface Window {
        electronAPI: {
            getSkinPacks: () => Promise<SkinPackInfo[]>;
            selectMcpackFile: () => Promise<string | null>;
            selectFolder: () => Promise<string | null>;
            unpackMcpack: (mcpackPath: string) => Promise<SkinPackInfo | null>;
            validateSourcePack: (sourceFolderPath: string) => Promise<boolean>;
            replaceSkinPack: (targetPath: string, sourcePath: string) => Promise<boolean>;
            repackMcpack: (tempPackDir: string, outputPath: string) => Promise<boolean>;
            runMcEncryptor: (targetPackPath: string) => Promise<boolean>;
            cleanupTempDir: (tempDirPath: string) => Promise<void>;
            openExternalUrl: (url: string) => Promise<void>;
            getSampleCapeUrl: () => Promise<string>;
            saveMcpackAs: (defaultPath: string) => Promise<string | null>;
        };
    }
}
