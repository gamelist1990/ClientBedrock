# Simple Electron App - 初心者向けサンプル

Electronアプリケーションの初心者向けサンプルとベースアプリケーションです。

## 🚀 特徴

- **TypeScript**を使用した型安全な開発
- **モダンなUI/UX**デザイン
- **レスポンシブ**レイアウト
- **セキュリティ**を考慮した実装
- **豊富なサンプル機能**
- **詳細なコメント**と説明

## 📋 含まれている機能

### 基本機能
- ✅ アプリケーション情報の表示
- ✅ メッセージボックスの表示
- ✅ ファイル選択ダイアログ
- ✅ ファイル保存ダイアログ
- ✅ デスクトップ通知
- ✅ ダーク/ライトテーマ切り替え

### 技術的特徴
- ✅ メインプロセスとレンダラープロセスの安全な通信（IPC）
- ✅ コンテキスト分離（Context Isolation）
- ✅ プリロードスクリプトによるAPI公開
- ✅ セキュリティベストプラクティス
- ✅ エラーハンドリング
- ✅ ログ機能

## 🛠️ 必要な環境

- Node.js 16以上
- npm または yarn

## 📦 インストール

```bash
# 依存関係のインストール
npm install
```

## 🎮 使用方法

### 開発モード
```bash
# TypeScriptをコンパイルしてElectronを起動（開発モード）
npm run dev
```

### 本番モード
```bash
# TypeScriptをコンパイルしてElectronを起動
npm start
```

### ビルド
```bash
# TypeScriptのコンパイルのみ
npm run build

# パッケージング（実行ファイルなし）
npm run pack

# 配布用パッケージの作成
npm run dist

# Windows用配布パッケージ
npm run dist:win
```

## 📁 プロジェクト構造

```
simple-electron-app/
├── src/
│   ├── main.ts                 # メインプロセス
│   ├── preload.ts             # プリロードスクリプト
│   └── renderer/              # レンダラープロセス
│       ├── index.html         # メインHTML
│       ├── styles.css         # スタイルシート
│       └── renderer.js        # UIロジック
├── assets/                    # リソースファイル
│   └── icon.png              # アプリアイコン
├── dist/                     # コンパイル後のファイル
├── dist-electron/            # 配布パッケージ
├── package.json
├── tsconfig.json
└── README.md
```

## 🔧 開発のポイント

### セキュリティ
- `nodeIntegration: false` - Node.jsの機能をレンダラープロセスで無効化
- `contextIsolation: true` - コンテキスト分離の有効化
- プリロードスクリプトによる安全なAPI公開

### 通信
- IPCを使用したメインプロセスとレンダラープロセス間の通信
- `ipcMain.handle()` と `ipcRenderer.invoke()` による非同期通信

### UI/UX
- CSS変数を使用したテーマシステム
- レスポンシブデザイン
- モダンなアニメーション

## 🎨 カスタマイズ

### テーマの変更
`src/renderer/styles.css`の`:root`セクションでカラーパレットを変更できます。

### 新機能の追加
1. `src/main.ts`にIPCハンドラーを追加
2. `src/preload.ts`にAPIを公開
3. `src/renderer/renderer.js`にUI処理を追加

### ウィンドウ設定
`src/main.ts`の`createMainWindow()`関数でウィンドウサイズや設定を変更できます。

## 📚 学習リソース

- [Electron公式ドキュメント](https://www.electronjs.org/docs)
- [Electronセキュリティ](https://www.electronjs.org/docs/tutorial/security)
- [TypeScript](https://www.typescriptlang.org/)

## 🐛 トラブルシューティング

### よくある問題

**1. アプリが起動しない**
```bash
# 依存関係を再インストール
rm -rf node_modules package-lock.json
npm install
```

**2. TypeScriptコンパイルエラー**
```bash
# TypeScriptを手動でコンパイル
npx tsc
```

**3. 開発ツールが表示されない**
開発モード（`npm run dev`）で起動すると自動で開発ツールが表示されます。

## 📝 ライセンス

MIT License

## 👨‍💻 作成者

**Koukunn_** <- ちょっとしたレイアウトの修正のみ...

**Github Copliot**

---

このアプリケーションは学習目的で作成されたサンプルです。実際の商用利用の際は、セキュリティやパフォーマンスの追加検証を行ってください。
