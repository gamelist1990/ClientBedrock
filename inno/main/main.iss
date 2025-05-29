; PEXScanner シンプルインストーラー

#define MyAppName "PEXScanner"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Koukunn_"
#define MyAppExeName "pextool-scanner.exe"

[Setup]
; アプリケーション基本情報
AppId={{A1C2D3E4-F5B6-7890-ABCD-1234567890EF}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName=C:\Program Files\PEXtool\PEXScanner
DefaultGroupName={#MyAppName}
DisableDirPage=yes
; 管理者権限が必要（Program Filesにインストールするため）
PrivilegesRequired=admin
; インストーラーの見た目と動作
OutputDir=..\Output
OutputBaseFilename=PEXScanner_Installer
SetupIconFile=..\..\other\Tauri\src-tauri\icons\icon.ico
; ライセンス表示と同意
LicenseFile=..\lib\LICENSE.txt
ShowLanguageDialog=yes
Compression=lzma
SolidCompression=yes
WizardStyle=modern
; 日本語サポート
LanguageDetectionMethod=uilanguage

[Languages]
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; ソースコード
Source: "..\..\other\Tauri\src-tauri\target\release\pextool-scanner.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\other\Tauri\src-tauri\target\release\WebView2Loader.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\other\Tauri\src-tauri\icons\icon.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\other\Tauri\pex.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\lib\LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion

; ___

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\icon.ico"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"