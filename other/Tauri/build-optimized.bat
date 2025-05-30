@echo off
echo Building optimized Tauri app...

rem 最初にクリーンビルド
cargo clean

rem リリースビルド実行
npm run tauri build

echo Build complete!
pause
