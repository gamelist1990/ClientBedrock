# Google Material Design CSS Framework

このプロジェクトは、Googleのマテリアルデザインを基にした包括的なCSSフレームワークです。TSX/Reactプロジェクトで使用することを想定して設計されています。

## 📁 ファイル構成

```
pages/styles/
├── index.css      # メインファイル（全てをインポート）
├── globals.css    # グローバルスタイル、変数、リセット
├── components.css # UIコンポーネントスタイル
├── utilities.css  # ユーティリティクラス
├── layout.css     # レイアウト用クラス
└── examples.tsx   # 使用例コンポーネント
```

## 🎨 デザインシステム

### カラーパレット
- **Google Blue**: `#4285f4`
- **Google Red**: `#ea4335` 
- **Google Yellow**: `#fbbc05`
- **Google Green**: `#34a853`

### フォント
- **Primary**: Google Sans, Roboto
- **Monospace**: Roboto Mono

## 🚀 使用方法

### 1. スタイルのインポート
```tsx
// pages/_app.tsx
import './styles/index.css';
```

### 2. 基本的なコンポーネント

#### ボタン
```tsx
<button className="btn btn-primary">Primary Button</button>
<button className="btn btn-secondary">Secondary Button</button>
<button className="btn btn-ghost">Ghost Button</button>
```

#### カード
```tsx
<div className="card">
  <div className="card-header">
    <h3 className="card-title">Card Title</h3>
  </div>
  <div className="card-body">
    Card content goes here
  </div>
</div>
```

#### フォーム
```tsx
<div className="input-group">
  <label className="label">Email</label>
  <input type="email" className="input" placeholder="Enter email" />
  <p className="help-text">We'll never share your email</p>
</div>
```

### 3. レイアウトシステム

#### アプリシェル
```tsx
<div className="app-shell">
  <header className="app-header">
    <nav className="nav">
      <a className="nav-brand">My App</a>
    </nav>
  </header>
  <main className="app-main">
    <div className="app-content">
      Content here
    </div>
  </main>
</div>
```

#### グリッドレイアウト
```tsx
<div className="grid grid-cols-3 gap-4">
  <div>Item 1</div>
  <div>Item 2</div>
  <div>Item 3</div>
</div>
```

### 4. ユーティリティクラス

#### スペーシング
```tsx
<div className="p-4 m-2">Padding 16px, Margin 8px</div>
<div className="px-6 py-4">Horizontal padding 24px, Vertical padding 16px</div>
```

#### フレックスボックス
```tsx
<div className="d-flex justify-center items-center gap-4">
  <div>Item 1</div>
  <div>Item 2</div>
</div>
```

#### テキスト
```tsx
<h1 className="text-3xl font-bold text-center">Large centered title</h1>
<p className="text-secondary text-sm">Secondary small text</p>
```

## 🎭 テーマ

### ダークテーマ
```tsx
<div data-theme="dark">
  <!-- Dark theme content -->
</div>
```

### カラーテーマ
```tsx
<div className="theme-red">
  <!-- Red theme content -->
</div>
<div className="theme-green">
  <!-- Green theme content -->
</div>
```

## 🧩 コンポーネント例

### モーダル
```tsx
<div className="modal-backdrop show">
  <div className="modal">
    <div className="modal-header">
      <h3 className="modal-title">Modal Title</h3>
      <button className="modal-close">×</button>
    </div>
    <div className="modal-body">
      Modal content
    </div>
    <div className="modal-footer">
      <button className="btn btn-secondary">Cancel</button>
      <button className="btn btn-primary">Confirm</button>
    </div>
  </div>
</div>
```

### アラート
```tsx
<div className="alert alert-success">
  <div className="alert-title">Success!</div>
  <div className="alert-message">Operation completed successfully</div>
</div>
```

### ナビゲーション
```tsx
<nav className="nav">
  <a href="#" className="nav-brand">Brand</a>
  <div className="nav-links">
    <a href="#" className="nav-link active">Home</a>
    <a href="#" className="nav-link">About</a>
    <a href="#" className="nav-link">Contact</a>
  </div>
</nav>
```

## 📱 レスポンシブデザイン

### ブレークポイント
- **sm**: 640px以下
- **md**: 768px以下  
- **lg**: 1024px以下
- **xl**: 1280px以下

### レスポンシブクラス
```tsx
<div className="grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
  <!-- 1列 → 2列 → 3列 -->
</div>

<div className="text-sm md:text-base lg:text-lg">
  <!-- フォントサイズがレスポンシブ -->
</div>
```

## ♿ アクセシビリティ

- フォーカス管理
- キーボードナビゲーション
- スクリーンリーダー対応
- 高コントラストモード対応
- 動作軽減モード対応

### アクセシビリティクラス
```tsx
<button className="focus-visible-only">
  Focus visible only when needed
</button>

<div className="sr-only">
  Screen reader only content
</div>

<a href="#main" className="skip-link">
  Skip to main content
</a>
```

## 🎨 カスタムCSS変数

```css
:root {
  --primary: #4285f4;
  --secondary: #757575;
  --success: #34a853;
  --warning: #fbbc05;
  --error: #ea4335;
  
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;
}
```

## 🎯 ベストプラクティス

1. **セマンティックHTML**: 適切なHTML要素を使用
2. **アクセシビリティ**: ARIA属性とキーボードナビゲーション
3. **パフォーマンス**: CSS変数とmodularアプローチ
4. **保守性**: 一貫したネーミング規則
5. **レスポンシブデザイン**: モバイルファースト

## 📖 参考資料

- [Material Design Guidelines](https://material.io/design)
- [Google Fonts](https://fonts.google.com/)
- [Material Design Colors](https://material.io/design/color/)
- [Accessibility Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)

## 🤝 貢献

このフレームワークの改善にご協力いただける場合は、プルリクエストをお送りください。

## 📄 ライセンス

MIT License
