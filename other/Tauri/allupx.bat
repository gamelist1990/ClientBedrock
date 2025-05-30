@echo off
echo ==============================================
echo           ALL UPX - Universal Compressor
echo ==============================================
echo Select compression mode:
echo 1. Standard Compression (Fast, Good ratio)
echo 2. Maximum Compression (Slow, Best ratio)
echo 3. UPX Manager (Info/Decompress/Recompress)
echo 4. Exit
echo ==============================================
echo.

set /p "mode=Enter your choice (1-4): "

if "%mode%"=="1" goto standard
if "%mode%"=="2" goto maximum
if "%mode%"=="3" goto manager
if "%mode%"=="4" goto exit
echo Invalid choice. Please select 1-4.
echo.
goto start

:standard
echo.
echo ==============================================
echo         STANDARD COMPRESSION MODE
echo ==============================================
echo This mode uses: --best --ultra-brute
echo Estimated time: 2-10 minutes
echo.

rem EXEファイルのパスを入力
set /p "exe_path=Enter the path of EXE file to optimize: "

rem ダブルクォートを削除
set "exe_path=%exe_path:"=%"

rem 入力チェック
if "%exe_path%"=="" (
    echo Error: No path entered.
    echo.
    pause
    goto start
)

if not exist "%exe_path%" (
    echo Error: File not found.
    echo Path: %exe_path%
    echo.
    pause
    goto start
)

rem 拡張子チェック
for %%i in ("%exe_path%") do set "file_ext=%%~xi"
if /i not "%file_ext%"==".exe" (
    echo Error: Not an EXE file.
    echo Extension: %file_ext%
    echo.
    pause
    goto start
)

echo.
echo Target: %exe_path%

rem ファイルサイズ取得
for %%i in ("%exe_path%") do set "original_size=%%~zi"
echo Original size: %original_size% bytes

rem バックアップ作成
echo.
echo Creating backup...
copy "%exe_path%" "%exe_path%.backup" >nul
if %errorlevel%==0 (
    echo Backup: %exe_path%.backup
) else (
    echo Warning: Backup creation failed
)

rem UPX実行
call :find_upx
if "%upx_found%"=="0" (
    echo Error: UPX not found.
    echo Download from: https://upx.github.io/
    pause
    goto start
)

echo.
echo Starting STANDARD compression...
"%upx_path%" --best --ultra-brute "%exe_path%"

if %errorlevel%==0 (
    for %%i in ("%exe_path%") do set "compressed_size=%%~zi"
    echo.
    echo ==============================================
    echo COMPRESSION RESULTS:
    echo Original:   %original_size% bytes
    echo Compressed: %compressed_size% bytes
    if %original_size% gtr 0 (
        set /a "reduction=(%original_size%-%compressed_size%)*100/%original_size%"
        echo Saved:      %reduction%%%
    ) else (
        echo Saved:      Cannot calculate (original size is 0)
    )
    echo ==============================================
) else (
    echo Compression failed. Restoring backup...
    copy "%exe_path%.backup" "%exe_path%" >nul
)

echo.
pause
goto start

:maximum
echo.
echo ==============================================
echo         MAXIMUM COMPRESSION MODE
echo ==============================================
echo This mode uses: --best --ultra-brute --lzma
echo + all advanced options
echo Estimated time: 10-30 minutes
echo.

rem EXEファイルのパスを入力
set /p "exe_path=Enter the path of EXE file to optimize: "

rem ダブルクォートを削除
set "exe_path=%exe_path:"=%"

rem 入力チェック
if "%exe_path%"=="" (
    echo Error: No path entered.
    echo.
    pause
    goto start
)

if not exist "%exe_path%" (
    echo Error: File not found.
    echo Path: %exe_path%
    echo.
    pause
    goto start
)

rem 拡張子チェック
for %%i in ("%exe_path%") do set "file_ext=%%~xi"
if /i not "%file_ext%"==".exe" (
    echo Error: Not an EXE file.
    echo Extension: %file_ext%
    echo.
    pause
    goto start
)

echo.
echo Target: %exe_path%

rem ファイルサイズ取得
for %%i in ("%exe_path%") do set "original_size=%%~zi"
echo Original size: %original_size% bytes

rem バックアップ作成
echo.
echo Creating backup...
copy "%exe_path%" "%exe_path%.backup" >nul
if %errorlevel%==0 (
    echo Backup: %exe_path%.backup
) else (
    echo Warning: Backup creation failed
)

rem UPX実行
call :find_upx
if "%upx_found%"=="0" (
    echo Error: UPX not found.
    echo Download from: https://upx.github.io/
    pause
    goto start
)

echo.
echo Starting MAXIMUM compression...
echo This may take 10-30 minutes...
echo.

rem Method 1: Maximum LZMA compression
echo Method 1: Maximum LZMA compression...
"%upx_path%" --best --ultra-brute --lzma --compress-exports=1 --compress-icons=1 --compress-resources=1 --strip-relocs=1 --force "%exe_path%"

if %errorlevel%==0 (
    echo Method 1 successful!
    goto max_success
)

rem Method 2: Alternative compression
echo Method 1 failed. Trying Method 2...
copy "%exe_path%.backup" "%exe_path%" >nul
"%upx_path%" --best --ultra-brute --compress-exports=1 --compress-icons=1 --compress-resources=1 "%exe_path%"

if %errorlevel%==0 (
    echo Method 2 successful!
    goto max_success
)

rem Method 3: Standard compression fallback
echo Method 2 failed. Trying Method 3 (Standard)...
copy "%exe_path%.backup" "%exe_path%" >nul
"%upx_path%" --best --ultra-brute "%exe_path%"

if %errorlevel%==0 (
    echo Method 3 successful!
    goto max_success
)

echo All methods failed. Restoring original...
copy "%exe_path%.backup" "%exe_path%" >nul
echo Original file restored.
pause
goto start

:max_success
for %%i in ("%exe_path%") do set "compressed_size=%%~zi"
echo.
echo ==============================================
echo MAXIMUM COMPRESSION RESULTS:
echo Original:   %original_size% bytes
echo Compressed: %compressed_size% bytes
if %original_size% gtr 0 (
    set /a "reduction=(%original_size%-%compressed_size%)*100/%original_size%"
    echo Saved:      %reduction%%%
) else (
    echo Saved:      Cannot calculate (original size is 0)
)
echo ==============================================
pause
goto start

:manager
echo.
echo ==============================================
echo              UPX MANAGER MODE
echo ==============================================
echo Advanced management for UPX compressed files
echo.

rem EXEファイルのパスを入力
set /p "exe_path=Enter the path of EXE file: "

rem ダブルクォートを削除
set "exe_path=%exe_path:"=%"

rem 入力チェック
if "%exe_path%"=="" (
    echo Error: No path entered.
    echo.
    pause
    goto start
)

if not exist "%exe_path%" (
    echo Error: File not found.
    echo Path: %exe_path%
    echo.
    pause
    goto start
)

rem 拡張子チェック
for %%i in ("%exe_path%") do set "file_ext=%%~xi"
if /i not "%file_ext%"==".exe" (
    echo Error: Not an EXE file.
    echo Extension: %file_ext%
    echo.
    pause
    goto start
)

call :find_upx
if "%upx_found%"=="0" (
    echo Error: UPX not found.
    echo Download from: https://upx.github.io/
    pause
    goto start
)

echo.
echo Target: %exe_path%
for %%i in ("%exe_path%") do set "current_size=%%~zi"
echo Current size: %current_size% bytes

rem UPX状態チェック
"%upx_path%" -l "%exe_path%" >nul 2>&1
if %errorlevel%==0 (
    echo Status: COMPRESSED with UPX
    echo.
    echo Options:
    echo 1. Show compression info
    echo 2. Decompress file
    echo 3. Recompress with maximum settings
    echo 4. Back to main menu
    echo.
    set /p "mgr_choice=Choice (1-4): "
    
    if "%mgr_choice%"=="1" (
        echo.
        echo ==============================================
        echo UPX COMPRESSION INFO:
        "%upx_path%" -l "%exe_path%"
        echo ==============================================
        pause
        goto manager
    )
    
    if "%mgr_choice%"=="2" (
        echo.
        echo Creating backup...
        copy "%exe_path%" "%exe_path%.compressed_backup" >nul
        echo Decompressing...
        "%upx_path%" -d "%exe_path%"        if %errorlevel%==0 (
            for %%i in ("%exe_path%") do set "decomp_size=%%~zi"
            echo Decompressed successfully!
            echo New size: %decomp_size% bytes
            if %current_size% gtr 0 (
                set /a "expansion=(%decomp_size%-%current_size%)*100/%current_size%"
                echo Size increase: %expansion%%%
            ) else (
                echo Size increase: Cannot calculate (current size is 0)
            )
        ) else (
            echo Decompression failed.
        )
        pause
        goto start
    )
    
    if "%mgr_choice%"=="3" (
        echo.
        echo Creating backup...
        copy "%exe_path%" "%exe_path%.old_compressed" >nul
        echo Decompressing...
        "%upx_path%" -d "%exe_path%"
        if %errorlevel%==0 (
            for %%i in ("%exe_path%") do set "decomp_size=%%~zi"
            echo Recompressing with maximum settings...
            "%upx_path%" --best --ultra-brute --lzma --compress-exports=1 --compress-icons=1 --compress-resources=1 --strip-relocs=1 --force "%exe_path%"
            if %errorlevel%==0 (
                for %%i in ("%exe_path%") do set "new_size=%%~zi"
                echo.
                echo ==============================================
                echo RECOMPRESSION RESULTS:                echo Old compressed: %current_size% bytes
                echo Decompressed:   %decomp_size% bytes  
                echo New compressed: %new_size% bytes
                if %current_size% gtr 0 (
                    set /a "improvement=(%current_size%-%new_size%)*100/%current_size%"
                    if %improvement% gtr 0 (
                        echo Improvement: %improvement%%% smaller!
                    ) else (
                        set /a "worse=%improvement%*-1"
                        echo Result: %worse%%% larger
                    )
                ) else (
                    echo Improvement: Cannot calculate (current size is 0)
                )
                echo ==============================================
            ) else (
                echo Recompression failed. Restoring...
                copy "%exe_path%.old_compressed" "%exe_path%" >nul
            )
        ) else (
            echo Decompression failed.
        )
        pause
        goto start
    )
    
    if "%mgr_choice%"=="4" goto start
    
) else (
    echo Status: NOT COMPRESSED
    echo.
    echo Options:
    echo 1. Compress with standard settings
    echo 2. Compress with maximum settings
    echo 3. Back to main menu
    echo.
    set /p "mgr_choice=Choice (1-3): "
    
    if "%mgr_choice%"=="1" goto standard
    if "%mgr_choice%"=="2" goto maximum
    if "%mgr_choice%"=="3" goto start
)

echo Invalid choice.
pause
goto start

:find_upx
set "upx_found=0"
if exist "%USERPROFILE%\Tools\upx\upx.exe" (
    set "upx_path=%USERPROFILE%\Tools\upx\upx.exe"
    set "upx_found=1"
) else if exist "C:\Program Files\upx\upx.exe" (
    set "upx_path=C:\Program Files\upx\upx.exe"
    set "upx_found=1"
) else if exist "upx.exe" (
    set "upx_path=upx.exe"
    set "upx_found=1"
)
goto :eof

:start
cls
echo ==============================================
echo           ALL UPX - Universal Compressor
echo ==============================================
echo Select compression mode:
echo 1. Standard Compression (Fast, Good ratio)
echo 2. Maximum Compression (Slow, Best ratio)
echo 3. UPX Manager (Info/Decompress/Recompress)
echo 4. Exit
echo ==============================================
echo.

set /p "mode=Enter your choice (1-4): "

if "%mode%"=="1" goto standard
if "%mode%"=="2" goto maximum
if "%mode%"=="3" goto manager
if "%mode%"=="4" goto exit
echo Invalid choice. Please select 1-4.
echo.
pause
goto start

:exit
echo.
echo Thank you for using ALL UPX!
pause
