param(
    [string]$Shortcut
)

$shell = New-Object -ComObject WScript.Shell
$shortcutPath = [System.Environment]::GetFolderPath('Programs') + "\" + $Shortcut
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.Save()

# 管理者実行フラグを付与
$bytes = [System.IO.File]::ReadAllBytes($shortcutPath)
$bytes[21] = $bytes[21] -bor 0x20
[System.IO.File]::WriteAllBytes($shortcutPath, $bytes)