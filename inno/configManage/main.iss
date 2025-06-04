; PEXManager シンプルインストーラー

#define MyAppName "PEXManager"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Koukunn_"
#define MyAppExeName "pexconfig-manager.exe"

[Setup]
; アプリケーション基本情報
AppId={{A1C2D3E4-F5B6-7890-ABCD-1234567890EF}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName=C:\Program Files\PEXtool\PEXManager
DefaultGroupName={#MyAppName}
DisableDirPage=yes
; 管理者権限が必要（Program Filesにインストールするため）
PrivilegesRequired=admin
; アップグレード処理用の設定
AppVerName={#MyAppName} {#MyAppVersion}
UpdateUninstallLogAppName=yes
AppMutex=PEXManagerAppMutex
; インストーラーの見た目と動作
OutputDir=..\Output
OutputBaseFilename=PEXManager_Installer
SetupIconFile=..\..\other\configMane\src-tauri\icons\icon.ico
; ライセンス表示と同意
LicenseFile=..\lib\LICENSE.txt
ShowLanguageDialog=yes
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
; 日本語サポート
LanguageDetectionMethod=uilanguage

[Languages]
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
japanese.SetupAppTitle=セットアップ - {#MyAppName}
japanese.SetupWindowTitle={#MyAppName} - セットアップ
japanese.UpgradeAppTitle=更新 - {#MyAppName}
japanese.WizardReady=インストールの準備ができました
japanese.WizardReadyTitle=インストールの準備ができました
japanese.WizardReadyLabel=インストーラーは {#MyAppName} の[name]を行う準備ができました。
english.SetupAppTitle=Setup - {#MyAppName}
english.SetupWindowTitle={#MyAppName} - Setup
english.UpgradeAppTitle=Update - {#MyAppName}
english.WizardReady=Ready to Install
english.WizardReadyTitle=Ready to Install
english.WizardReadyLabel=Setup is now ready to begin [name] {#MyAppName}.

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; ソースコード
Source: "..\..\other\configMane\src-tauri\target\release\pexconfig-manager.exe"; DestDir: "{app}"; Flags: ignoreversion replacesameversion
Source: "..\..\other\configMane\src-tauri\target\release\WebView2Loader.dll"; DestDir: "{app}"; Flags: ignoreversion replacesameversion
Source: "..\..\other\configMane\src-tauri\icons\icon.ico"; DestDir: "{app}"; Flags: ignoreversion replacesameversion
Source: "..\..\other\configMane\pex.txt"; DestDir: "{app}"; Flags: ignoreversion replacesameversion
Source: "..\lib\LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion replacesameversion

; ___

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\icon.ico"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"