import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    // アンインストーラー関連のAPI
    getInstalledTools: () => ipcRenderer.invoke('get-installed-tools'),
    launchUninstaller: (toolPath: string) => ipcRenderer.invoke('launch-uninstaller', toolPath),
    getDiskUsage: (toolPath: string) => ipcRenderer.invoke('get-disk-usage', toolPath)
});