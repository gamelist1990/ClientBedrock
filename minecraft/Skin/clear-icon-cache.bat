@echo off
echo Windowsのアイコンキャッシュをクリアします...
echo 注意: エクスプローラーは再起動されます

taskkill /f /im explorer.exe

echo アイコンキャッシュを削除中...
if exist %LOCALAPPDATA%\IconCache.db del /f %LOCALAPPDATA%\IconCache.db
if exist %LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache*.db del /f %LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache*.db
if exist %LOCALAPPDATA%\Microsoft\Windows\Explorer\thumbcache*.db del /f %LOCALAPPDATA%\Microsoft\Windows\Explorer\thumbcache*.db

echo エクスプローラーを再起動中...
start explorer.exe

echo 完了しました。アプリケーションを再起動してください。
pause
