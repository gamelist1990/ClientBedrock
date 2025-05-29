# PEXtool Scanner - Tauri Desktop App

PEXtoolディレクトリをスキャンして、アプリケーション情報を表示するTauriデスクトップアプリケーションです。

## アーキテクチャ

このアプリケーションは以下の構成で動作します：

1. **Next.js Server**: Node.js APIを使用してPEXtoolディレクトリをスキャン（ポート3000または自動選択）
2. **Tauri App**: Next.jsサーバーにHTTPリクエストを送信してデータを取得

## 開発環境のセットアップ

### 依存関係のインストール

```bash
bun install
```

### 開発サーバーの起動

#### 方法1: 自動でNext.js + Tauriを起動

```bash
bun run dev:all
```

#### 方法2: 手動で個別に起動

**ターミナル1でNext.jsサーバーを起動:**
```bash
bun run dev:server
```

**ターミナル2でTauriアプリを起動:**
```bash
bun run tauri:dev
```

## 使い方

1. アプリケーションが起動したら、「PEXtoolをスキャン」ボタンをクリック
2. スキャンが完了すると、見つかったPEXtoolとアプリケーションの一覧が表示されます
3. 左側のリストでツールを選択すると、右側に詳細情報が表示されます

## ビルド

```bash
bun run tauri:build
```

## トラブルシューティング

### ポートの競合
- Next.jsサーバーはポート3000を最初に試しますが、使用中の場合は自動的に別のポートを選択します
- Tauriアプリケーションは自動的に正しいポートを検出します

### スキャンエラー
- Windows管理者権限が必要な場合があります
- PEXtoolがインストールされていない場合、空の結果が返されます

## API エンドポイント

- `GET /api/scan-pextool` - PEXtoolディレクトリをスキャンして結果を返す

## 技術スタック

- **Frontend**: Next.js + React + TypeScript
- **Backend**: Node.js (Next.js API routes)
- **Desktop**: Tauri
- **Package Manager**: Bun

### 🔧 高度なフィルタリング・解析
- **ファイルタイプフィルタ**: EXE、DLL、PE実行ファイルでフィルタ
- **統計表示**: 検出されたファイル数の動的カウント
- **アンインストーラー検出**: `Uninstall*.exe` パターンでアンインストーラーを自動検出
- **バージョン情報抽出**: exe ファイルから自動でバージョン情報を取得
- **アプリケーションタイプ判別**: 
  - `Uninstall*.exe` 存在時は `Electron` として自動判別
  - `unins000.exe` 存在時は `Inno Setup` として判別
  - `package.json` 存在時は `Electron` として判別
  - その他の場合は `Unknown` として表示

### ♿ アクセシビリティ
- **キーボードナビゲーション**: 完全なキーボード操作対応
- **スクリーンリーダー対応**: ARIA属性と説明文
- **高コントラストモード**: 視覚障害者向けの最適化
- **フォーカス管理**: 明確なフォーカスインジケーター

## 🚀 セットアップ

### 前提条件
- [Bun](https://bun.sh/) v1.0+
- [Node.js](https://nodejs.org/) v18+
- Windows 10/11 (PEXtool用)

### インストール
```bash
# リポジトリをクローン
git clone <repository-url>
cd PEXtool-Scanner

# 依存関係をインストール
bun install

# 開発サーバーを起動
bun run dev
```

### 本番ビルド
```bash
# プロダクションビルド
bun run build

# ビルドされたアプリを実行
bun run start
```

## 📁 プロジェクト構造

```
├── pages/
│   ├── index.tsx           # メインアプリケーション
│   ├── _app.tsx           # Next.jsアプリラッパー
│   └── api/
│       └── scan-pextool.ts # PEXtoolスキャンAPI
├── styles/
│   └── globals.css        # グローバルスタイル（ガラスモーフィズム）
├── public/                # 静的ファイル
├── package.json          # 依存関係とスクリプト
└── next.config.js        # Next.js設定
```

## 🔧 技術仕様

### フロントエンド
- **React 18**: 関数コンポーネントとHooks
- **TypeScript**: 完全な型安全性
- **Next.js 14**: SSR、API Routes、最適化
- **CSS3**: カスタムプロパティ、グリッド、フレックスボックス

### バックエンド
- **Next.js API Routes**: サーバーレス関数
- **Node.js FS**: ファイルシステム操作
- **PE解析**: カスタムTypeScriptアルゴリズム

### パフォーマンス最適化
- **Will-change**: GPU加速対応
- **Code Splitting**: 動的インポート
- **Image Optimization**: Next.js画像最適化
- **Lazy Loading**: 遅延読み込み

## 🎯 使用方法

1. **スキャン開始**: 「🚀 PEXtool スキャン開始」ボタンをクリック
2. **ツール選択**: ドロップダウンからPEXtoolを選択
3. **フィルタリング**: ファイルタイプやPE実行ファイルでフィルタ
4. **アンインストーラー確認**: 各ツールのアンインストーラー検出状況を確認
5. **詳細情報**: アプリケーションの詳細情報（アーキテクチャ、サイズ等）を確認
4. **検索**: リアルタイム検索でファイルを絞り込み
5. **詳細確認**: アプリケーションカードで詳細情報を確認

## 🔍 検出可能なファイル情報

- **基本情報**: ファイル名、パス、サイズ
- **PE情報**: アーキテクチャ (x86/x64)、サブシステム
- **デバッグ情報**: デバッグシンボル有無
- **ファイルタイプ**: EXE、DLL、その他

## 🌟 主な改善点

### v2.0の新機能
- ✅ 完全なCSS分離（インラインスタイル → CSS classes）
- ✅ ガラスモーフィズムデザインシステム
- ✅ アニメーション効果とトランジション
- ✅ キーボードナビゲーション対応
- ✅ リアルタイム検索機能
- ✅ プログレスインジケーター
- ✅ 成功/エラーメッセージ表示
- ✅ ツールチップ機能
- ✅ ダークモード対応
- ✅ レスポンシブデザイン

## 🐛 トラブルシューティング

### よくある問題

**PEXtoolが見つからない場合**
- PEXtoolが `C:\Program Files\PEXtool` にインストールされていることを確認
- 管理者権限で実行を試行

**APIエラーが発生する場合**
- 開発サーバーが起動していることを確認（`bun run dev`）
- ポート3000が他のプロセスで使用されていないことを確認

**スタイルが適用されない場合**
- `_app.tsx` でCSSがインポートされていることを確認
- ブラウザのキャッシュをクリア

## 🤝 コントリビューション

1. フォークする
2. フィーチャーブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. プルリクエストを作成

## 📄 ライセンス

このプロジェクトはMITライセンスの下で公開されています。詳細は [LICENSE](LICENSE) ファイルを参照してください。

## 👥 作成者

- **GitHub Copilot** - 初期開発とコードレビュー
- **PEXtool Community** - アルゴリズムと仕様

---

**🎯 目標**: シンプルで美しく、アクセシブルなPE実行ファイル解析ツールを提供すること
