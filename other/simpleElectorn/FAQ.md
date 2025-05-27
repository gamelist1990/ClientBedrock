# よくある質問 (FAQ)

## 🚀 基本的な使い方

### Q: アプリの起動方法を教えてください
A: 以下のコマンドでアプリを起動できます：

```bash
# 開発モード（開発ツール付き）
npm run dev

# 通常モード
npm start
```

### Q: アプリが起動しない場合はどうすればよいですか？
A: 以下の手順を試してください：

1. **依存関係の再インストール**
```bash
rm -rf node_modules package-lock.json
npm install
```

2. **TypeScriptのコンパイル**
```bash
npm run build
```

3. **ログファイルの確認**
- Windows: `%USERPROFILE%\AppData\Roaming\Simple Electron App\logs\`
- macOS: `~/Library/Logs/Simple Electron App/`
- Linux: `~/.config/Simple Electron App/logs/`

## 🔧 開発・カスタマイズ

### Q: 新しい機能を追加するにはどうすればよいですか？
A: 以下の3ステップで機能を追加できます：

1. **メインプロセス** (`src/main.ts`) にIPC処理を追加
2. **プリロード** (`src/preload.ts`) でAPIを公開
3. **レンダラー** (`src/renderer/renderer.js`) でUI処理を実装

詳細は `DEVELOPER_GUIDE.md` の「新機能の追加手順」をご覧ください。

### Q: アプリのアイコンを変更したい
A: `assets/` フォルダ内のアイコンファイルを置き換えてください：

- **開発用**: `assets/icon.svg` または `assets/icon.png`
- **Windows**: `assets/icon.ico` (256x256px推奨)
- **macOS**: `assets/icon.icns`
- **Linux**: `assets/icon.png` (512x512px推奨)

### Q: ウィンドウサイズを変更したい
A: `src/main.ts` の `createMainWindow()` 関数で設定を変更してください：

```typescript
mainWindow = new BrowserWindow({
  width: 1400,        // 幅を変更
  height: 900,        // 高さを変更
  minWidth: 1000,     // 最小幅
  minHeight: 700,     // 最小高さ
  // ...
});
```

### Q: テーマの色を変更したい
A: `src/renderer/styles.css` の `:root` セクションでカラー変数を変更してください：

```css
:root {
  --primary-color: #your-color;
  --secondary-color: #your-secondary-color;
  /* ... */
}
```

## 🎨 UIの質問

### Q: ダークテーマはありますか？
A: はい！アプリ内の「🎨 テーマ切替」ボタンでライト/ダークテーマを切り替えできます。

### Q: フォントを変更したい
A: `src/renderer/styles.css` の `--font-family` 変数を変更してください：

```css
:root {
  --font-family: 'Your Font', 'Segoe UI', sans-serif;
}
```

### Q: レスポンシブデザインに対応していますか？
A: はい。ウィンドウサイズに応じてレイアウトが自動調整されます。

## 🔒 セキュリティ

### Q: このアプリは安全ですか？
A: はい。以下のセキュリティ対策を実装しています：

- **Context Isolation** - レンダラープロセスの分離
- **nodeIntegration無効** - Node.js機能の制限
- **プリロードスクリプト** - 安全なAPI公開のみ
- **CSP** - コンテンツセキュリティポリシー

### Q: 外部サイトへのアクセスはありますか？
A: いいえ。このアプリは完全にオフラインで動作し、外部への通信は行いません。

## 📦 ビルド・配布

### Q: 実行ファイルを作成したい
A: 以下のコマンドで配布用パッケージを作成できます：

```bash
# 全プラットフォーム用
npm run dist

# Windows専用
npm run dist:win

# パッケージのみ（インストーラーなし）
npm run pack
```

### Q: インストーラーをカスタマイズしたい
A: `package.json` の `build` セクションで設定を変更してください：

```json
"build": {
  "appId": "com.yourcompany.yourapp",
  "productName": "Your App Name",
  "win": {
    "target": "nsis",
    "icon": "assets/icon.ico"
  }
}
```

### Q: 自動更新機能はありますか？
A: 現在のバージョンには含まれていませんが、`electron-updater` を使用して実装できます。

## 🐛 トラブルシューティング

### Q: 「Module not found」エラーが出る
A: 以下を試してください：

1. **依存関係の確認**
```bash
npm list --depth=0
```

2. **再インストール**
```bash
npm install
```

3. **キャッシュクリア**
```bash
npm cache clean --force
```

### Q: TypeScriptエラーが出る
A: 以下を確認してください：

1. **TypeScriptバージョン**
```bash
npx tsc --version
```

2. **手動コンパイル**
```bash
npx tsc --noEmit  # エラーチェックのみ
npx tsc           # コンパイル実行
```

### Q: アプリが重い・遅い
A: 以下の対策を試してください：

1. **開発ツールを閉じる** - F12で開発ツールを無効化
2. **不要なプロセスを確認** - タスクマネージャーでElectronプロセスを確認
3. **メモリ使用量をチェック** - Chromeタスクマネージャー (Shift+Esc)

### Q: ファイルが保存されない
A: ファイル保存機能は現在サンプル実装です。実際のファイル操作を実装する場合は、Node.jsの `fs` モジュールを使用してメインプロセスで処理してください。

## 🔧 高度な設定

### Q: デバッグモードを有効にしたい
A: 環境変数 `ELECTRON_ENABLE_LOGGING=1` を設定するか、`--dev` フラグ付きで起動してください：

```bash
npm run dev  # 自動的にデバッグモード
```

### Q: 複数ウィンドウを作成したい
A: `src/main.ts` で追加のBrowserWindowインスタンスを作成してください：

```typescript
function createSecondWindow() {
  const secondWindow = new BrowserWindow({
    // 設定...
  });
  // ...
}
```

### Q: メニューを非表示にしたい
A: `createMenu()` 関数の呼び出しをコメントアウトするか、以下を追加してください：

```typescript
mainWindow.setMenuBarVisibility(false);
```

## 📚 学習リソース

### Q: Electronについてもっと学びたい
A: 以下のリソースを参考にしてください：

- [Electron公式ドキュメント](https://electronjs.org/docs)
- [Electron API リファレンス](https://electronjs.org/docs/api)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

### Q: このサンプルを元に本格的なアプリを作りたい
A: `DEVELOPER_GUIDE.md` を参考に、以下の拡張を検討してください：

- データベース連携 (SQLite, PostgreSQL)
- 状態管理 (Redux, MobX)
- テスト実装 (Jest, Playwright)
- CI/CD パイプライン
- 自動更新機能

## 💬 サポート

### Q: バグを見つけた場合はどうすればよいですか？
A: GitHubのIssuesに報告してください。以下の情報を含めてください：

- OS情報
- Electronバージョン
- エラーメッセージ
- 再現手順

### Q: 機能要望がある場合は？
A: GitHubのIssuesに「Feature Request」として投稿してください。

### Q: このFAQに載っていない質問がある
A: GitHubのDiscussionsまたはIssuesで質問してください。コミュニティが回答します。

---

最終更新: 2024年5月27日
