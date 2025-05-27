# 📚 初心者向けチュートリアル

このチュートリアルでは、Simple Electron Appを使ってElectronアプリケーション開発の基礎を学びます。

## 🎯 学習目標

このチュートリアルを完了すると、以下のことができるようになります：

- ✅ Electronアプリの構造を理解する
- ✅ メインプロセスとレンダラープロセスの違いを理解する
- ✅ IPCを使った安全な通信方法を学ぶ
- ✅ 基本的なUI機能を実装する
- ✅ アプリをカスタマイズする

## 📖 章立て

### [第1章: Electronの基礎](#第1章-electronの基礎)
### [第2章: アプリの起動と操作](#第2章-アプリの起動と操作)
### [第3章: コードを読んでみよう](#第3章-コードを読んでみよう)
### [第4章: カスタマイズに挑戦](#第4章-カスタマイズに挑戦)
### [第5章: 新機能を追加してみよう](#第5章-新機能を追加してみよう)

---

## 第1章: Electronの基礎

### 1.1 Electronとは？

Electronは、Web技術（HTML、CSS、JavaScript/TypeScript）を使ってデスクトップアプリを作るフレームワークです。

**有名なElectronアプリ:**
- Visual Studio Code
- Discord
- Slack
- WhatsApp Desktop
- Figma

### 1.2 Electronの仕組み

```
┌─────────────────────────────────┐
│        メインプロセス            │  ← Node.jsが動く
│    (アプリ全体を管理)           │
└─────────────────────────────────┘
                │
        ┌───────┴───────┐
        │               │
┌───────▼──────┐ ┌─────▼─────┐
│レンダラー     │ │レンダラー  │  ← Webページが動く
│プロセス1      │ │プロセス2   │
│(ウィンドウ1)  │ │(ウィンドウ2)│
└──────────────┘ └───────────┘
```

**重要なポイント:**
- **メインプロセス**: アプリ全体を管理（1つだけ）
- **レンダラープロセス**: ウィンドウの中身（複数可能）
- **IPC**: プロセス間通信でデータをやりとり

### 1.3 このアプリの構造

```
src/
├── main.ts           👈 メインプロセス（アプリの心臓部）
├── preload.ts        👈 セキュリティの橋渡し
└── renderer/         👈 レンダラープロセス（見た目）
    ├── index.html    👈 画面のレイアウト
    ├── styles.css    👈 見た目の装飾
    └── renderer.js   👈 画面の動作
```

---

## 第2章: アプリの起動と操作

### 2.1 アプリを起動してみよう

1. **ターミナル/コマンドプロンプトを開く**

2. **アプリのフォルダに移動**
```bash
cd "Simple Electron Appのフォルダパス"
```

3. **依存関係をインストール**（初回のみ）
```bash
npm install
```

4. **アプリを起動**
```bash
npm run dev
```

🎉 アプリが起動しました！

### 2.2 アプリの機能を試してみよう

左側のサイドバーにある各ボタンをクリックして、どんな動作をするか確認してみましょう：

1. **📱 アプリ情報** - アプリの詳細情報を表示
2. **💬 メッセージ表示** - ダイアログボックスを表示
3. **📁 ファイル選択** - ファイル選択ダイアログを表示
4. **💾 保存ダイアログ** - ファイル保存ダイアログを表示
5. **🔔 通知** - デスクトップ通知を表示
6. **🎨 テーマ切替** - ダーク/ライトテーマを切り替え

### 2.3 画面の構成を理解しよう

```
┌─────────────────────────────────────────────┐
│  🚀 Simple Electron App (ヘッダー)           │
├─────────────┬───────────────────────────────┤
│ サイドバー   │  メインコンテンツエリア         │
│             │                               │
│ 📋サンプル機能│  🎉 ウェルカムセクション        │
│ - アプリ情報  │                               │
│ - メッセージ  │  📊 結果表示エリア             │
│ - ファイル選択│                               │
│ - 保存ダイアログ│  📝 アクションログ           │
│ - 通知       │                               │
│ - テーマ切替  │                               │
└─────────────┴───────────────────────────────┘
│               フッター情報                    │
└─────────────────────────────────────────────┘
```

---

## 第3章: コードを読んでみよう

### 3.1 main.ts を見てみよう

`src/main.ts` ファイルを開いてください。これがアプリの「司令塔」です。

**重要な部分:**

```typescript
// アプリの準備ができたら実行
app.whenReady().then(() => {
  createMainWindow();  // ウィンドウを作る
  createMenu();        // メニューを作る
  setupIpcHandlers();  // 通信を設定
});
```

### 3.2 preload.ts を理解しよう

`src/preload.ts` ファイルを開いてください。これは「安全な橋渡し役」です。

**重要な部分:**

```typescript
// レンダラーで使えるAPIを公開
const electronAPI = {
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
  // ...
};

// window.electronAPI として使えるようにする
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
```

### 3.3 renderer.js を見てみよう

`src/renderer/renderer.js` ファイルを開いてください。これは「画面の動作」を担当します。

**重要な部分:**

```javascript
// ボタンがクリックされたときの処理
elements.btnAppInfo?.addEventListener('click', showAppInfo);

// アプリ情報を取得して表示
async function showAppInfo() {
  const appInfo = await window.electronAPI.getAppInfo();
  // 結果を画面に表示
}
```

### 3.4 データの流れを理解しよう

```
1. ユーザーがボタンクリック
           ↓
2. renderer.js で処理開始
           ↓
3. window.electronAPI.関数名() で呼び出し
           ↓
4. preload.ts で橋渡し
           ↓
5. main.ts で実際の処理
           ↓
6. 結果をレンダラーに返す
           ↓
7. 画面に結果を表示
```

---

## 第4章: カスタマイズに挑戦

### 4.1 アプリの色を変えてみよう

`src/renderer/styles.css` を開いて、色を変更してみましょう：

```css
:root {
  --primary-color: #ff6b6b;     /* 赤っぽい色に変更 */
  --secondary-color: #4ecdc4;   /* 青緑っぽい色に変更 */
}
```

**変更後、アプリを再起動して確認してみてください！**

### 4.2 ウィンドウサイズを変えてみよう

`src/main.ts` の `createMainWindow()` 関数を見つけて変更：

```typescript
mainWindow = new BrowserWindow({
  width: 1400,        // 幅を大きく
  height: 900,        // 高さも大きく
  minWidth: 1000,     // 最小幅も調整
  minHeight: 700,     // 最小高さも調整
  // ...
});
```

### 4.3 ウェルカムメッセージを変えてみよう

`src/renderer/index.html` を開いて、メッセージを変更：

```html
<h2>🎉 あなたのElectronアプリへようこそ！</h2>
<p>ここは自由に編集できるメッセージエリアです。</p>
```

### 4.4 新しいボタンを追加してみよう

1. **HTMLにボタンを追加** (`src/renderer/index.html`)
```html
<li><button id="btn-hello" class="feature-btn">👋 挨拶</button></li>
```

2. **JavaScriptで動作を追加** (`src/renderer/renderer.js`)
```javascript
// ボタンの取得
const btnHello = document.getElementById('btn-hello');

// クリック時の処理
btnHello?.addEventListener('click', () => {
  alert('こんにちは！初めてのカスタマイズです！');
});
```

---

## 第5章: 新機能を追加してみよう

### 5.1 現在時刻表示機能を作ってみよう

この機能では、ボタンを押すと現在時刻を表示します。

#### ステップ1: メインプロセスで機能を追加

`src/main.ts` の `setupIpcHandlers()` 内に追加：

```typescript
// 現在時刻を取得する機能
ipcMain.handle('get-current-time', () => {
  const now = new Date();
  return {
    date: now.toLocaleDateString('ja-JP'),
    time: now.toLocaleTimeString('ja-JP'),
    timestamp: now.getTime()
  };
});
```

#### ステップ2: プリロードでAPIを公開

`src/preload.ts` の `electronAPI` オブジェクトに追加：

```typescript
const electronAPI = {
  // ...既存のAPI...
  getCurrentTime: () => ipcRenderer.invoke('get-current-time'),
};
```

#### ステップ3: HTMLにボタンを追加

`src/renderer/index.html` のサイドバーに追加：

```html
<li><button id="btn-time" class="feature-btn">⏰ 現在時刻</button></li>
```

#### ステップ4: UIの動作を実装

`src/renderer/renderer.js` に追加：

```javascript
// 1. ボタン要素を取得
const btnTime = document.getElementById('btn-time');

// 2. クリックイベントを設定
btnTime?.addEventListener('click', showCurrentTime);

// 3. 現在時刻表示機能
async function showCurrentTime() {
  try {
    addLogEntry('現在時刻を取得中...', 'info');
    
    const timeInfo = await window.electronAPI.getCurrentTime();
    
    const resultHtml = `
      <div class="time-result">
        <h4>⏰ 現在時刻</h4>
        <div class="time-display">
          <div class="time-item">
            <strong>日付:</strong> ${timeInfo.date}
          </div>
          <div class="time-item">
            <strong>時刻:</strong> ${timeInfo.time}
          </div>
          <div class="time-item">
            <strong>タイムスタンプ:</strong> ${timeInfo.timestamp}
          </div>
        </div>
      </div>
      <style>
        .time-result { padding: 1rem; }
        .time-result h4 { margin-bottom: 1rem; color: var(--primary-color); }
        .time-display { background: var(--bg-secondary); padding: 1rem; border-radius: 6px; }
        .time-item { margin: 0.5rem 0; }
        .time-item strong { color: var(--primary-color); }
      </style>
    `;
    
    displayResult(resultHtml);
    addLogEntry('現在時刻を表示しました', 'success');
    
  } catch (error) {
    console.error('時刻取得エラー:', error);
    addLogEntry(`エラー: ${error.message}`, 'error');
  }
}
```

#### ステップ5: テストしてみよう

1. アプリを再ビルド: `npm run build`
2. アプリを再起動: `npm run dev`
3. 新しい「⏰ 現在時刻」ボタンをクリック

🎉 **おめでとうございます！** 初めての機能追加が完了しました！

### 5.2 もっと挑戦してみよう

#### 挑戦1: ランダムな名言表示機能
```javascript
const quotes = [
  "プログラミングは魔法だ",
  "バグは学習の機会だ",
  "コードは詩のように美しく書こう"
];
```

#### 挑戦2: 簡単な計算機能
```javascript
// 二つの数値を受け取って計算結果を返す
```

#### 挑戦3: カウンター機能
```javascript
// ボタンを押すたびに数が増えるカウンター
```

---

## 🎓 まとめ

### あなたが学んだこと

- ✅ Electronアプリの基本構造
- ✅ メインプロセスとレンダラープロセスの役割
- ✅ IPCを使った安全な通信方法
- ✅ HTMLでのUI作成
- ✅ CSSでのスタイリング
- ✅ JavaScriptでのイベント処理
- ✅ 新機能の追加方法

### 次のステップ

1. **より高度な機能に挑戦**
   - ファイルの読み書き
   - データベースの使用
   - 外部APIとの連携

2. **学習リソース**
   - [Electron公式ドキュメント](https://electronjs.org/docs)
   - [MDN Web Docs](https://developer.mozilla.org/)
   - [TypeScript公式サイト](https://www.typescriptlang.org/)

3. **コミュニティに参加**
   - GitHubでオープンソースプロジェクトに貢献
   - 技術ブログで学習内容をアウトプット
   - 勉強会やイベントに参加

### トラブルが起きたら

1. **FAQ.md** を確認
2. **DEVELOPER_GUIDE.md** の詳細説明を読む
3. GitHubのIssuesで質問
4. 公式ドキュメントを参照

---

**🎉 お疲れさまでした！あなたは今、Electronアプリ開発者です！🎉**

継続的な学習と実践で、さらに素晴らしいアプリを作っていけるでしょう。

頑張ってください！ 🚀
