import { contextBridge, ipcRenderer } from 'electron';

/**
 * プリロードスクリプト
 * レンダラープロセスとメインプロセス間の安全な通信を提供します
 */

// セキュリティのためのAPI定義
const electronAPI = {
  /**
   * アプリケーション情報を取得
   */
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  /**
   * メッセージボックスを表示
   * @param options ダイアログのオプション
   */
  showMessageBox: (options: Electron.MessageBoxOptions) => 
    ipcRenderer.invoke('show-message-box', options),

  /**
   * ファイル選択ダイアログを表示
   * @param options ダイアログのオプション
   */
  showOpenDialog: (options: Electron.OpenDialogOptions) => 
    ipcRenderer.invoke('show-open-dialog', options),

  /**
   * ファイル保存ダイアログを表示
   * @param options ダイアログのオプション
   */
  showSaveDialog: (options: Electron.SaveDialogOptions) => 
    ipcRenderer.invoke('show-save-dialog', options),

  /**
   * プラットフォーム情報を取得
   */
  platform: process.platform,

  /**
   * ログ出力（開発用）
   * @param message ログメッセージ
   */
  log: (message: string) => {
    console.log(`[Preload] ${message}`);
  }
};

// window.electronAPIとしてレンダラープロセスに公開
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// TypeScript用の型定義をグローバルに追加
declare global {
  interface Window {
    electronAPI: typeof electronAPI;
  }
}

// プリロードスクリプトが正常に読み込まれたことをログ出力
console.log('プリロードスクリプトが読み込まれました');
