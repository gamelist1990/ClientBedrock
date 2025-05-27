import { app, BrowserWindow, Menu, MenuItemConstructorOptions, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as log from 'electron-log';

/**
 * Electronメインプロセス
 * アプリケーションのライフサイクルとメインウィンドウを管理します
 */

// 開発モードかどうかを判定
const isDev = process.argv.includes('--dev');

// ログの設定
log.transports.file.level = 'info';
log.transports.console.level = isDev ? 'debug' : 'info';

// メインウィンドウの参照を保持
let mainWindow: BrowserWindow | null = null;

/**
 * メインウィンドウを作成する関数
 */
function createMainWindow(): void {
  // ブラウザウィンドウを作成
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false, // 準備完了まで非表示
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      // セキュリティのためnodeIntegrationは無効
      nodeIntegration: false,
      // コンテキスト分離を有効
      contextIsolation: true,      // プリロードスクリプトを指定
      preload: path.join(__dirname, 'preload.js'),
      // 開発ツールの設定
      devTools: isDev
    }
  });

  // HTMLファイルを読み込み
  const htmlPath = isDev 
    ? path.join(__dirname, '../src/renderer/index.html')
    : path.join(__dirname, '../src/renderer/index.html');
  
  mainWindow.loadFile(htmlPath);

  // ウィンドウの準備が完了したら表示
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
      
      // 開発モードの場合は開発ツールを開く
      if (isDev) {
        mainWindow.webContents.openDevTools();
      }
    }
  });

  // ウィンドウが閉じられた時の処理
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外部リンクを既定のブラウザで開く
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  log.info('メインウィンドウが作成されました');
}

/**
 * アプリケーションメニューを作成する関数
 */
function createMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'ファイル',
      submenu: [
        {
          label: '新規作成',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            // 新規作成の処理をここに書く
            log.info('新規作成が選択されました');
          }
        },
        {
          label: '開く',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              properties: ['openFile'],
              filters: [
                { name: 'テキストファイル', extensions: ['txt'] },
                { name: 'すべてのファイル', extensions: ['*'] }
              ]
            });
            
            if (!result.canceled && result.filePaths.length > 0) {
              log.info('ファイルが選択されました:', result.filePaths[0]);
              // ファイルを開く処理をここに書く
            }
          }
        },
        { type: 'separator' },
        {
          label: '終了',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: '編集',
      submenu: [
        { label: '元に戻す', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'やり直し', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: '切り取り', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'コピー', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '貼り付け', accelerator: 'CmdOrCtrl+V', role: 'paste' }
      ]
    },
    {
      label: '表示',
      submenu: [
        { label: '再読み込み', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '強制再読み込み', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { label: '開発者ツール', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '実際のサイズ', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: '拡大', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: '縮小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全画面表示', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: 'ヘルプ',
      submenu: [
        {
          label: 'このアプリについて',
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'このアプリについて',
              message: 'Simple Electron App',
              detail: 'Electronアプリケーションの初心者向けサンプルです。\n\n作成者: Koukunn_\nバージョン: 1.0.0'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * IPCイベントハンドラーの設定
 */
function setupIpcHandlers(): void {
  // レンダラープロセスからのメッセージを受信
  ipcMain.handle('show-message-box', async (event, options) => {
    const result = await dialog.showMessageBox(mainWindow!, options);
    return result;
  });

  // ファイル選択ダイアログ
  ipcMain.handle('show-open-dialog', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow!, options);
    return result;
  });

  // ファイル保存ダイアログ
  ipcMain.handle('show-save-dialog', async (event, options) => {
    const result = await dialog.showSaveDialog(mainWindow!, options);
    return result;
  });

  // アプリケーション情報の取得
  ipcMain.handle('get-app-info', () => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node
    };
  });

  log.info('IPCハンドラーが設定されました');
}

// アプリケーションの準備が完了した時の処理
app.whenReady().then(() => {
  log.info('アプリケーションが準備完了しました');
  
  createMainWindow();
  createMenu();
  setupIpcHandlers();

  // macOSでドックアイコンがクリックされた時の処理
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// すべてのウィンドウが閉じられた時の処理
app.on('window-all-closed', () => {
  // macOS以外ではアプリケーションを終了
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// アプリケーションがアクティブになった時の処理
app.on('activate', () => {
  // ウィンドウがない場合は新しく作成
  if (mainWindow === null) {
    createMainWindow();
  }
});

// アプリケーション終了前の処理
app.on('before-quit', () => {
  log.info('アプリケーションが終了します');
});

// 未処理の例外をキャッチ
process.on('uncaughtException', (error) => {
  log.error('未処理の例外:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('未処理のPromise拒否:', reason);
});
