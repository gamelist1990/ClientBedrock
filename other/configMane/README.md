# PEXtool Config Manager

PEXtool Config Managerは、Windows上でPEXtoolにインストールされているツールをスキャン・管理するためのTauriアプリケーションです。ElectronアプリやInno Setupアプリの情報を自動的に解析し、アンインストーラーの有無やアプリケーションファイルの詳細も取得できます。

## 主な機能
- PEXtoolディレクトリの自動検出
- 各ツールの詳細情報（名前、バージョン、説明、種別、アンインストーラー有無など）の取得
- ディレクトリ内のアプリケーションファイル（exe, dll, sys, ocx）のスキャン
- ElectronアプリやInno Setupアプリの自動判別
- Next.js + Reactによるフロントエンド、Rust + Tauriによるバックエンド

## 技術スタック
- [Next.js](https://nextjs.org/)（静的エクスポート対応）
- [React](https://react.dev/)
- [Tauri](https://tauri.app/)（Rustベースのデスクトップアプリ）
- Rust（バックエンドロジック）
- TypeScript

## ディレクトリ構成

```
configMane/
├── next.config.js         # Next.js 設定ファイル
├── package.json           # Node.js パッケージ管理
├── tsconfig.json          # TypeScript 設定
├── src-tauri/             # Tauri (Rust) 関連ファイル
│   ├── Cargo.toml         # Rustパッケージ設定
│   └── src/
│       └── scan_pex.rs    # PEXtoolスキャンロジック
└── ...
```

## セットアップ・ビルド方法

1. 依存パッケージのインストール
   ```sh
   npm install
   ```
2. 開発サーバー起動（Next.js）
   ```sh
   npm run dev
   ```
3. Tauriアプリとして起動
   ```sh
   npm run tauri:dev
   ```
4. リリースビルド
   ```sh
   npm run build:optimized
   ```

## ライセンス
MIT

---

### 作者
Koukunn_
