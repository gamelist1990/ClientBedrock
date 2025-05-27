; PEXtool シンプルインストーラー

#define MyAppName "PEXtool"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "GitMatrix"
#define MyAppExeName "setuptool_windows.exe"

[Setup]
; アプリケーション基本情報
AppId={{78B5EE53-9B5F-4D2F-8A3E-21F9A2D88B12}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName=C:\Program Files\{#MyAppName}\sample
DefaultGroupName={#MyAppName}
DisableDirPage=yes
; 管理者権限が必要（Program Filesにインストールするため）
PrivilegesRequired=admin
; インストーラーの見た目と動作
OutputDir=..\Output
OutputBaseFilename=PEXtool_Setup
SetupIconFile=..\..\minecraft\worldlist\icon.ico
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
Source: "..\..\minecraft\setuptool\setuptool_windows.exe"; DestDir: "{app}"; Flags: ignoreversion
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