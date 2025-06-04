@echo off
echo Building optimized Tauri app...

cd c:\Users\PC_User\Desktop\GItMatrix\ClientBedrock\other\configMane\src-tauri
rem 最初にクリーンビルド
cargo clean

rem リリースビルド実行
npm run tauri build

echo Build complete!
pause
