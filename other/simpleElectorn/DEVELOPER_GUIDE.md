# 開発者ガイド - Simple Electron App

## 📚 アーキテクチャ概要

このElectronアプリケーションは、セキュリティと保守性を重視した現代的なアーキテクチャを採用しています。

### プロセス構造

```
┌─────────────────────────────────┐
│        メインプロセス              │
│     (main.ts - Node.js)         │
│                                 │
│  ┌─────────────────────────────┐ │
│  │      アプリ管理              │ │
│  │  - ウィンドウ作成            │ │
│  │  - メニュー管理              │ │
│  │  │  - ライフサイクル        │ │
│  └─────────────────────────────┘ │
│                                 │
│           ↕ IPC                 │
│                                 │
│  ┌─────────────────────────────┐ │
│  │    プリロードスクリプト       │ │
│  │     (preload.ts)            │ │
│  │  - API公開                  │ │
│  │  - セキュリティ境界          │ │
│  └─────────────────────────────┘ │
└─────────────────────────────────┘
              ↕
┌─────────────────────────────────┐
│      レンダラープロセス           │
│   (HTML/CSS/JS - Chromium)      │
│                                 │
│  ┌─────────────────────────────┐ │
│  │          UI層               │ │
│  │    (index.html)             │ │
│  └─────────────────────────────┘ │
│  ┌─────────────────────────────┐ │
│  │        スタイル層            │ │
│  │     (styles.css)            │ │
│  └─────────────────────────────┘ │
│  ┌─────────────────────────────┐ │
│  │       ロジック層             │ │
│  │    (renderer.js)            │ │
│  └─────────────────────────────┘ │
└─────────────────────────────────┘
```

## 🔐 セキュリティ設計

### 1. コンテキスト分離 (Context Isolation)
- レンダラープロセスのメインワールドとElectronのワールドを分離
- `contextIsolation: true` による完全な分離

### 2. Node.js統合の無効化
- `nodeIntegration: false` によりレンダラーでのNode.js機能を無効
- セキュリティリスクを大幅に軽減

### 3. プリロードスクリプト
- 安全なAPIのみを `contextBridge.exposeInMainWorld()` で公開
- メインプロセスとレンダラー間の安全な通信チャネル

### 4. IPC通信
- `ipcMain.handle()` と `ipcRenderer.invoke()` による非同期通信
- 双方向通信ではなく、レンダラーからメインへの単方向リクエスト

## 🛠️ 主要機能の実装

### ファイルダイアログ
```typescript
// メインプロセス (main.ts)
ipcMain.handle('show-open-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow!, options);
  return result;
});

// プリロード (preload.ts)
showOpenDialog: (options: Electron.OpenDialogOptions) => 
  ipcRenderer.invoke('show-open-dialog', options),

// レンダラー (renderer.js)
const result = await window.electronAPI.showOpenDialog({
  properties: ['openFile', 'multiSelections'],
  filters: [/* ... */]
});
```

### メッセージボックス
```typescript
// メインプロセス
ipcMain.handle('show-message-box', async (event, options) => {
  const result = await dialog.showMessageBox(mainWindow!, options);
  return result;
});

// レンダラーからの呼び出し
const result = await window.electronAPI.showMessageBox({
  type: 'question',
  buttons: ['はい', 'いいえ'],
  message: 'メッセージ'
});
```

## 🎨 UI/UXデザイン

### CSS設計思想
- **CSS変数** によるテーマシステム
- **モバイルファースト** のレスポンシブデザイン
- **アクセシビリティ** を考慮した色彩設計
- **アニメーション** による直感的なフィードバック

### テーマシステム
```css
:root {
  --primary-color: #007acc;
  --bg-primary: #ffffff;
  /* ... */
}

[data-theme="dark"] {
  --bg-primary: #1a1a1a;
  --text-primary: #ffffff;
  /* ... */
}
```

### レスポンシブブレークポイント
- `768px` - タブレット
- `480px` - モバイル

## 📁 ディレクトリ構造詳細

```
src/
├── main.ts              # メインプロセス
│   ├── ウィンドウ管理
│   ├── メニュー作成
│   ├── IPC管理
│   └── アプリライフサイクル
│
├── preload.ts           # プリロードスクリプト
│   ├── API公開
│   ├── セキュリティ境界
│   └── 型定義
│
└── renderer/            # レンダラープロセス
    ├── index.html       # メインHTML
    ├── styles.css       # スタイル定義
    └── renderer.js      # UIロジック
```

## 🔧 カスタマイズガイド

### 新機能の追加手順

1. **メインプロセスでIPC処理追加**
```typescript
// main.ts
ipcMain.handle('your-feature', async (event, data) => {
  // 処理を実装
  return result;
});
```

2. **プリロードでAPI公開**
```typescript
// preload.ts
const electronAPI = {
  yourFeature: (data) => ipcRenderer.invoke('your-feature', data),
  // ...
};
```

3. **レンダラーでUI実装**
```javascript
// renderer.js
async function yourFeature() {
  const result = await window.electronAPI.yourFeature(data);
  // UIを更新
}
```

### メニュー項目の追加
```typescript
// main.ts の createMenu() 内
{
  label: '新しいメニュー',
  submenu: [
    {
      label: '新しい項目',
      accelerator: 'CmdOrCtrl+Shift+N',
      click: () => {
        // 処理を実装
      }
    }
  ]
}
```

### スタイルのカスタマイズ
```css
/* styles.css */
:root {
  --your-custom-color: #yourcolor;
}

.your-component {
  color: var(--your-custom-color);
}
```

## 🧪 テスト戦略

### 推奨テストツール
- **Jest** - ユニットテスト
- **Spectron** - E2Eテスト (非推奨: Playwright推奨)
- **Playwright** - モダンE2Eテスト

### テスト構造例
```
tests/
├── unit/
│   ├── main.test.ts
│   └── preload.test.ts
├── integration/
│   └── ipc.test.ts
└── e2e/
    └── app.test.ts
```

## 🚀 パフォーマンス最適化

### バンドルサイズ削減
- 不要な依存関係の削除
- Tree shaking の活用
- 動的インポートの使用

### メモリ管理
- ウィンドウの適切な破棄
- イベントリスナーのクリーンアップ
- 大きなオブジェクトの参照解放

### 起動時間短縮
- 遅延読み込み
- 最小限の初期処理
- キャッシュの活用

## 📦 ビルド・配布

### 開発ビルド
```bash
npm run dev     # 開発モード
npm run build   # TypeScriptコンパイル
```

### 本番ビルド
```bash
npm run dist        # 全プラットフォーム
npm run dist:win    # Windows専用
npm run pack        # パッケージのみ
```

### 配布設定
```json
// package.json
"build": {
  "appId": "com.yourcompany.yourapp",
  "productName": "Your App Name",
  "directories": {
    "output": "dist-electron"
  }
}
```

## 🔍 デバッグ

### 開発ツール
- **F12** - レンダラープロセスの開発ツール
- **Ctrl+Shift+I** - 同上
- **メニュー → 表示 → 開発者ツール**

### ログ出力
```typescript
// メインプロセス
import * as log from 'electron-log';
log.info('情報ログ');
log.error('エラーログ');

// レンダラープロセス
console.log('レンダラーログ');
```

### 一般的な問題

1. **IPC通信エラー**
   - プリロードスクリプトの読み込み確認
   - 関数名の一致確認

2. **ファイルパスエラー**
   - 相対パス vs 絶対パス
   - 開発環境と本番環境の違い

3. **セキュリティエラー**
   - CSP設定の確認
   - contextIsolation設定の確認

## 📚 参考資料

- [Electron Security](https://electronjs.org/docs/tutorial/security)
- [IPC通信](https://electronjs.org/docs/api/ipc-main)
- [BrowserWindow](https://electronjs.org/docs/api/browser-window)
- [Context Isolation](https://electronjs.org/docs/tutorial/context-isolation)
