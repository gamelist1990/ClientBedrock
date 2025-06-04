use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use tauri::command;
use zip::write::FileOptions;
use base64::{Engine as _, engine::general_purpose};
use reqwest;
use std::env;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModConfig {
    pub name: String,
    pub mod_type: String,
    pub config_path: String,
    pub has_config: bool,
    pub config_files: Vec<String>,
    pub icon_data: Option<String>, // Base64エンコードされた画像データ
    pub icon_url: Option<String>,  // 元のアイコンURL
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupInfo {
    pub name: String,
    pub version: String,
    pub mod_name: String,
    // 共有用メタデータ
    pub author: Option<String>,
    pub description: Option<String>,
    pub created_at: Option<String>,
    pub shared: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigScanResult {
    pub success: bool,
    pub mods: Vec<ModConfig>,
    pub total_mods: usize,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupResult {
    pub success: bool,
    pub backup_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    pub success: bool,
    pub imported_configs: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ShareResult {
    pub success: bool,
    pub shared_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExternalImportResult {
    pub success: bool,
    pub imported_configs: Vec<String>,
    pub mod_name_mismatch: Option<bool>,
    pub original_mod_name: Option<String>,
    pub target_mod_name: Option<String>,
    pub preview_files: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PreviewResult {
    pub success: bool,
    pub backup_info: Option<BackupInfo>,
    pub config_files: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileSelectResult {
    pub success: bool,
    pub file_path: Option<String>,
    pub error: Option<String>,
}

// MODアイコンの結果構造体
#[derive(Debug, Serialize, Deserialize)]
pub struct IconUpdateResult {
    pub success: bool,
    pub icon_data: Option<String>,
    pub error: Option<String>,
}

// MODアイコンの設定用構造体
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModIconConfig {
    pub mod_name: String,
    pub icon_url: Option<String>,
    pub icon_data: Option<String>,
}

const MINECRAFT_CONFIG_BASE: &str = r"C:\Users\PC_User\AppData\Local\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\RoamingState";

// 現在のユーザー名を自動検知する関数
fn get_current_username() -> Result<String, Box<dyn std::error::Error>> {
    if let Ok(username) = env::var("USERNAME") {
        Ok(username)
    } else if let Ok(userprofile) = env::var("USERPROFILE") {
        if let Some(username) = Path::new(&userprofile).file_name() {
            Ok(username.to_string_lossy().to_string())
        } else {
            Err("ユーザー名を取得できませんでした".into())
        }
    } else {
        Err("ユーザー名環境変数が見つかりません".into())
    }
}

// 動的にMinecraft設定ベースパスを取得する関数
fn get_minecraft_config_base() -> String {
    match get_current_username() {
        Ok(username) => {
            format!(r"C:\Users\{}\AppData\Local\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\RoamingState", username)
        }
        Err(_) => {
            // フォールバック：デフォルトパス
            MINECRAFT_CONFIG_BASE.to_string()
        }
    }
}

fn get_mod_config_paths() -> HashMap<String, (String, Option<String>)> {
    let mut mod_paths = HashMap::new();
    
    // 対応mod（パス, デフォルトアイコンURL）
    mod_paths.insert(
        "Flarial".to_string(),
        ("Flarial\\Config".to_string(), Some("https://github.com/flarialmc/launcher/blob/main/src/Assets/icon.png?raw=true".to_string()))
    );
    mod_paths.insert(
        "OderSo".to_string(), 
        ("OderSo\\Configs".to_string(), Some("https://www.pixelalchemy.uk/wp-content/uploads/2024/09/Screenshot-2024-09-17-at-1.45.16%E2%80%AFpm.png".to_string()))
    );
    mod_paths.insert(
        "LatiteRecode".to_string(),
        ("LatiteRecode\\Configs".to_string(), Some("https://latite.net/sources/latite.webp".to_string()))
    );
    // 他のMODも追加可能
    
    mod_paths
}

#[command]
pub async fn scan_minecraft_configs() -> ConfigScanResult {
    let base_path_str = get_minecraft_config_base();
    let base_path = Path::new(&base_path_str);
    let mod_paths = get_mod_config_paths();
    let mut mods = Vec::new();

    if !base_path.exists() {
        return ConfigScanResult {
            success: false,
            mods: vec![],
            total_mods: 0,
            error: Some("Minecraftのディレクトリが見つかりません".to_string()),
        };
    }

    // 保存されたアイコン設定を読み込み
    let icon_settings = load_icon_settings();

    // 各MODフォルダをスキャン
    for (mod_name, (config_sub_path, default_icon_url)) in &mod_paths {
        let mod_base_path = base_path.join(mod_name);
        let config_path = base_path.join(config_sub_path);
        
        if mod_base_path.exists() {
            let mut config_files = Vec::new();
            let has_config = config_path.exists();
            
            if has_config {
                if let Ok(entries) = fs::read_dir(&config_path) {
                    for entry in entries.flatten() {
                        if let Some(file_name) = entry.file_name().to_str() {
                            if file_name.ends_with(".json") || file_name.ends_with(".cfg") || file_name.ends_with(".conf") || file_name.ends_with(".flarial") {
                                config_files.push(file_name.to_string());
                            }
                        }
                    }
                }
            }

            // 保存されたアイコン設定があれば適用、なければデフォルト設定を使用
            let (icon_data, icon_url) = if let Some(icon_config) = icon_settings.mod_icons.get(mod_name) {
                (icon_config.icon_data.clone(), icon_config.icon_url.clone())
            } else if let Some(default_url) = default_icon_url {
                // デフォルトアイコンURLがある場合は即時取得
                match fetch_and_resize_image(default_url, 32).await {
                    Ok(data) => (Some(data), Some(default_url.clone())),
                    Err(e) => {
                        eprintln!("デフォルトアイコン取得失敗: {}", e);
                        (None, Some(default_url.clone()))
                    }
                }
            } else {
                (None, None)
            };

            mods.push(ModConfig {
                name: mod_name.clone(),
                mod_type: mod_name.clone(),
                config_path: config_path.to_string_lossy().to_string(),
                has_config,
                config_files,
                icon_data,
                icon_url,
            });
        }
    }

    // RoamingState直下のその他のフォルダもチェック
    if let Ok(entries) = fs::read_dir(base_path) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let folder_name = entry.file_name().to_string_lossy().to_string();
                
                // 既知のMODでない場合
                if !mod_paths.contains_key(&folder_name) && !folder_name.starts_with('.') {
                    let config_path = entry.path().join("config");
                    let has_config = config_path.exists();
                    let mut config_files = Vec::new();
                    
                    if has_config {                        if let Ok(config_entries) = fs::read_dir(&config_path) {
                            for config_entry in config_entries.flatten() {
                                if let Some(file_name) = config_entry.file_name().to_str() {
                                    if file_name.ends_with(".json") || file_name.ends_with(".cfg") || file_name.ends_with(".conf") || file_name.ends_with(".flarial") {
                                        config_files.push(file_name.to_string());
                                    }
                                }
                            }
                        }
                    }                    // 保存されたアイコン設定があれば適用
                    let (icon_data, icon_url) = if let Some(icon_config) = icon_settings.mod_icons.get(&folder_name) {
                        (icon_config.icon_data.clone(), icon_config.icon_url.clone())
                    } else {
                        (None, None)
                    };
                    
                    mods.push(ModConfig {
                        name: folder_name.clone(),
                        mod_type: "Unknown".to_string(),
                        config_path: config_path.to_string_lossy().to_string(),
                        has_config,
                        config_files,
                        icon_data,
                        icon_url,
                    });
                }
            }
        }
    }

    ConfigScanResult {
        success: true,
        total_mods: mods.len(),
        mods,
        error: None,
    }
}

#[command]
pub async fn backup_mod_config(
    mod_name: String, 
    backup_name: String, 
    version: String, 
    author: Option<String>, 
    description: Option<String>
) -> BackupResult {
    let base_path_str = get_minecraft_config_base();
    let base_path = Path::new(&base_path_str);
    let mod_paths = get_mod_config_paths();
    
    // MODのconfig場所を特定
    let config_path = if let Some((sub_path, _)) = mod_paths.get(&mod_name) {
        base_path.join(sub_path)
    } else {
        base_path.join(&mod_name).join("config")
    };

    if !config_path.exists() {
        return BackupResult {
            success: false,
            backup_path: None,
            error: Some("指定されたMODのconfigが見つかりません".to_string()),
        };
    }

    // バックアップファイル名を生成
    let backup_filename = format!("{}.pexPack", backup_name);
    let backup_path = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .join(&backup_filename);    // バックアップ情報を作成
    let backup_info = BackupInfo {
        name: backup_name.clone(),
        version,
        mod_name: mod_name.clone(),
        author,
        description,
        created_at: Some(std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            .to_string()),
        shared: Some(false),
    };

    // ZIPファイルを作成
    match create_zip_backup(&config_path, &backup_path, &backup_info) {
        Ok(_) => BackupResult {
            success: true,
            backup_path: Some(backup_path.to_string_lossy().to_string()),
            error: None,
        },
        Err(e) => BackupResult {
            success: false,
            backup_path: None,
            error: Some(format!("バックアップ作成エラー: {}", e)),
        },
    }
}

fn create_zip_backup(config_path: &Path, backup_path: &Path, backup_info: &BackupInfo) -> Result<(), Box<dyn std::error::Error>> {
    let file = fs::File::create(backup_path)?;
    let mut zip = zip::ZipWriter::new(file);
    
    // checkType.jsonを追加
    let options = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("checkType.json", options)?;
    zip.write_all(serde_json::to_string_pretty(backup_info)?.as_bytes())?;
    
    // configディレクトリを再帰的に追加
    add_dir_to_zip(&mut zip, config_path, "config", &options)?;
    
    zip.finish()?;
    Ok(())
}

fn add_dir_to_zip<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    path: &Path,
    zip_path: &str,
    options: &FileOptions,
) -> Result<(), Box<dyn std::error::Error>> {
    if path.is_dir() {
        // ディレクトリエントリを追加
        let dir_path = if zip_path.is_empty() {
            String::new()
        } else {
            format!("{}/", zip_path)
        };
        
        if !dir_path.is_empty() {
            zip.add_directory(&dir_path, *options)?;
        }
        
        // ディレクトリ内のアイテムを処理
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let entry_path = entry.path();
            let entry_name = entry.file_name().to_string_lossy().to_string();
            let new_zip_path = if zip_path.is_empty() {
                entry_name.clone()
            } else {
                format!("{}/{}", zip_path, entry_name)
            };
            
            if entry_path.is_dir() {
                add_dir_to_zip(zip, &entry_path, &new_zip_path, options)?;
            } else {
                // ファイルを追加
                zip.start_file(&new_zip_path, *options)?;
                let mut file = fs::File::open(&entry_path)?;
                let mut buffer = Vec::new();
                file.read_to_end(&mut buffer)?;
                zip.write_all(&buffer)?;
            }
        }
    }
    Ok(())
}

#[command]
pub async fn import_config_backup(backup_path: String, target_mod_name: String) -> ImportResult {
    // バックアップファイルのフルパスを生成
    let exe_dir = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();
    
    let full_backup_path = if Path::new(&backup_path).is_absolute() {
        // 既に絶対パスの場合はそのまま使用
        Path::new(&backup_path).to_path_buf()
    } else {
        // 相対パスの場合は実行ファイルのディレクトリと結合
        exe_dir.join(&backup_path)
    };
    
    if !full_backup_path.exists() {
        return ImportResult {
            success: false,
            imported_configs: vec![],
            error: Some(format!("バックアップファイルが見つかりません: {}", full_backup_path.display())),
        };
    }

    // ZIPファイルを読み込み
    let file = match fs::File::open(&full_backup_path) {
        Ok(f) => f,
        Err(e) => return ImportResult {
            success: false,
            imported_configs: vec![],
            error: Some(format!("バックアップファイル読み込みエラー: {} (パス: {})", e, full_backup_path.display())),
        },
    };

    let mut archive = match zip::ZipArchive::new(file) {
        Ok(a) => a,
        Err(e) => return ImportResult {
            success: false,
            imported_configs: vec![],
            error: Some(format!("ZIPファイル展開エラー: {}", e)),
        },
    };

    // checkType.jsonを確認とMOD名検証
    let mut check_type_found = false;
    let mut backup_info: Option<BackupInfo> = None;
    
    for i in 0..archive.len() {
        let mut file = match archive.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };
        
        if file.name() == "checkType.json" {
            check_type_found = true;
            let mut contents = String::new();
            if file.read_to_string(&mut contents).is_ok() {
                backup_info = serde_json::from_str(&contents).ok();
            }
            break;
        }
    }

    if !check_type_found {
        return ImportResult {
            success: false,
            imported_configs: vec![],
            error: Some("無効なバックアップファイルです（checkType.jsonが見つかりません）".to_string()),
        };
    }    // MOD名の整合性チェック
    if let Some(ref info) = backup_info {
        if info.mod_name != target_mod_name {
            return ImportResult {
                success: false,
                imported_configs: vec![],
                error: Some(format!(
                    "MOD名が一致しません。バックアップ: '{}', 選択されたMOD: '{}'", 
                    info.mod_name, 
                    target_mod_name
                )),
            };
        }
    } else {
        return ImportResult {
            success: false,
            imported_configs: vec![],
            error: Some("バックアップ情報の読み込みに失敗しました".to_string()),
        };
    }

    let mut imported_configs = Vec::new();

    // configファイルを一覧表示（実際の復元はここでは行わない）
    for i in 0..archive.len() {
        let file = match archive.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };
        
        if file.name().starts_with("config/") && !file.name().ends_with('/') {
            imported_configs.push(file.name().to_string());
        }
    }

    ImportResult {
        success: true,
        imported_configs,
        error: None,
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupFileInfo {
    pub filename: String,
    pub mod_name: Option<String>,
    pub backup_name: Option<String>,
    pub version: Option<String>,
}

#[command]
pub async fn list_backup_files() -> Vec<BackupFileInfo> {
    let exe_dir = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();

    let mut backups = Vec::new();
    
    if let Ok(entries) = fs::read_dir(&exe_dir) {
        for entry in entries.flatten() {
            if let Some(file_name) = entry.file_name().to_str() {
                if file_name.ends_with(".pexPack") {
                    let mut backup_info = BackupFileInfo {
                        filename: file_name.to_string(),
                        mod_name: None,
                        backup_name: None,
                        version: None,
                    };
                    
                    // バックアップファイルからメタデータを読み込み
                    if let Ok(file) = fs::File::open(entry.path()) {
                        if let Ok(mut archive) = zip::ZipArchive::new(file) {
                            for i in 0..archive.len() {
                                if let Ok(mut zip_file) = archive.by_index(i) {
                                    if zip_file.name() == "checkType.json" {
                                        let mut contents = String::new();
                                        if zip_file.read_to_string(&mut contents).is_ok() {
                                            if let Ok(info) = serde_json::from_str::<BackupInfo>(&contents) {
                                                backup_info.mod_name = Some(info.mod_name);
                                                backup_info.backup_name = Some(info.name);
                                                backup_info.version = Some(info.version);
                                            }
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    
                    backups.push(backup_info);
                }
            }
        }
    }    backups
}

// 安全なファイルコピー（プロセス競合エラー対策）
async fn copy_file_safely(source: &Path, target: &Path) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // 複数回のリトライでファイルコピーを試行
    let mut attempts = 0;
    const MAX_ATTEMPTS: u32 = 5;
    const RETRY_DELAY_MS: u64 = 100;
    
    while attempts < MAX_ATTEMPTS {
        match tokio::fs::copy(source, target).await {
            Ok(_) => return Ok(()),
            Err(e) => {
                attempts += 1;
                if attempts >= MAX_ATTEMPTS {
                    return Err(Box::new(e));
                }
                // 短時間待機してリトライ
                tokio::time::sleep(tokio::time::Duration::from_millis(RETRY_DELAY_MS)).await;
            }
        }
    }
    
    Err("ファイルコピーの最大リトライ回数に達しました".into())
}

// 共有機能: バックアップファイルを任意の場所にコピー
#[command]
pub async fn share_config_backup(backup_filename: String, target_path: String) -> ShareResult {
    let exe_dir = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();
    
    let source_path = exe_dir.join(&backup_filename);
    let target_path = Path::new(&target_path);
    
    if !source_path.exists() {
        return ShareResult {
            success: false,
            shared_path: None,
            error: Some("バックアップファイルが見つかりません".to_string()),
        };
    }
      // ファイルをコピー（プロセス競合エラー対策）
    match copy_file_safely(&source_path, &target_path).await {
        Ok(_) => {
            // 共有フラグを更新
            let _ = update_backup_shared_flag(&backup_filename, true).await;
            
            ShareResult {
                success: true,
                shared_path: Some(target_path.to_string_lossy().to_string()),
                error: None,
            }
        },
        Err(e) => ShareResult {
            success: false,
            shared_path: None,
            error: Some(format!("ファイルのコピーに失敗しました: {}", e)),
        },
    }
}

// バックアップファイルの共有フラグを更新
async fn update_backup_shared_flag(backup_filename: &str, shared: bool) -> Result<(), Box<dyn std::error::Error>> {
    let exe_dir = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();
    
    let backup_path = exe_dir.join(backup_filename);
    
    if !backup_path.exists() {
        return Err("バックアップファイルが見つかりません".into());
    }
    
    // 一時ファイルを作成して更新
    let temp_path = backup_path.with_extension("tmp");
    
    {
        let input_file = fs::File::open(&backup_path)?;
        let mut input_archive = zip::ZipArchive::new(input_file)?;
        
        let output_file = fs::File::create(&temp_path)?;
        let mut output_archive = zip::ZipWriter::new(output_file);
        
        let options = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        
        // 既存のファイルをコピー（checkType.json以外）
        for i in 0..input_archive.len() {
            let mut file = input_archive.by_index(i)?;
            let file_name = file.name().to_string();
            
            if file_name == "checkType.json" {
                // checkType.jsonを更新
                let mut contents = String::new();
                file.read_to_string(&mut contents)?;
                
                if let Ok(mut backup_info) = serde_json::from_str::<BackupInfo>(&contents) {
                    backup_info.shared = Some(shared);
                    
                    output_archive.start_file(&file_name, options)?;
                    output_archive.write_all(serde_json::to_string_pretty(&backup_info)?.as_bytes())?;
                }
            } else {
                // その他のファイルはそのままコピー
                output_archive.start_file(&file_name, options)?;
                let mut buffer = Vec::new();
                file.read_to_end(&mut buffer)?;
                output_archive.write_all(&buffer)?;
            }
        }
        
        output_archive.finish()?;
    }
    
    // 元のファイルを置き換え
    fs::remove_file(&backup_path)?;
    fs::rename(&temp_path, &backup_path)?;
    
    Ok(())
}

// 外部バックアップファイルのプレビュー
#[command]
pub async fn preview_external_backup(file_path: String) -> PreviewResult {
    let backup_path = Path::new(&file_path);
    
    if !backup_path.exists() {
        return PreviewResult {
            success: false,
            backup_info: None,
            config_files: vec![],
            error: Some("ファイルが見つかりません".to_string()),
        };
    }
    
    // ZIPファイルを読み込み
    let file = match fs::File::open(&backup_path) {
        Ok(f) => f,
        Err(e) => return PreviewResult {
            success: false,
            backup_info: None,
            config_files: vec![],
            error: Some(format!("ファイル読み込みエラー: {}", e)),
        },
    };
    
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(a) => a,
        Err(e) => return PreviewResult {
            success: false,
            backup_info: None,
            config_files: vec![],
            error: Some(format!("ZIPファイル展開エラー: {}", e)),
        },
    };
    
    let mut backup_info: Option<BackupInfo> = None;
    let mut config_files = Vec::new();
    
    // ファイル一覧を取得
    for i in 0..archive.len() {
        let mut file = match archive.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };
        
        let file_name = file.name().to_string();
        
        if file_name == "checkType.json" {
            // バックアップ情報を読み込み
            let mut contents = String::new();
            if file.read_to_string(&mut contents).is_ok() {
                backup_info = serde_json::from_str(&contents).ok();
            }
        } else if file_name.starts_with("config/") && !file_name.ends_with('/') {
            config_files.push(file_name);
        }
    }
    
    PreviewResult {
        success: true,
        backup_info,
        config_files,
        error: None,
    }
}

// 外部バックアップファイルのインポート（MOD名が異なっても可能）
#[command]
pub async fn import_external_backup(
    file_path: String,
    target_mod_name: String,
    force_import: Option<bool>
) -> ExternalImportResult {
    let backup_path = Path::new(&file_path);
    
    if !backup_path.exists() {
        return ExternalImportResult {
            success: false,
            imported_configs: vec![],
            mod_name_mismatch: None,
            original_mod_name: None,
            target_mod_name: None,
            preview_files: vec![],
            error: Some("ファイルが見つかりません".to_string()),
        };
    }
    
    // ZIPファイルを読み込み
    let file = match fs::File::open(&backup_path) {
        Ok(f) => f,
        Err(e) => return ExternalImportResult {
            success: false,
            imported_configs: vec![],
            mod_name_mismatch: None,
            original_mod_name: None,
            target_mod_name: None,
            preview_files: vec![],
            error: Some(format!("ファイル読み込みエラー: {}", e)),
        },
    };
    
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(a) => a,
        Err(e) => return ExternalImportResult {
            success: false,
            imported_configs: vec![],
            mod_name_mismatch: None,
            original_mod_name: None,
            target_mod_name: None,
            preview_files: vec![],
            error: Some(format!("ZIPファイル展開エラー: {}", e)),
        },
    };
    
    // checkType.jsonを確認
    let mut backup_info: Option<BackupInfo> = None;
    let mut preview_files = Vec::new();
    
    for i in 0..archive.len() {
        let mut file = match archive.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };
        
        let file_name = file.name().to_string();
        
        if file_name == "checkType.json" {
            let mut contents = String::new();
            if file.read_to_string(&mut contents).is_ok() {
                backup_info = serde_json::from_str(&contents).ok();
            }        } else if file_name.starts_with("config/") && !file_name.ends_with('/') {
            // ファイル表示数を制限（最大5個まで）
            if preview_files.len() < 5 {
                preview_files.push(file_name);
            }
        }
    }
    
    if backup_info.is_none() {
        return ExternalImportResult {
            success: false,
            imported_configs: vec![],
            mod_name_mismatch: None,
            original_mod_name: None,
            target_mod_name: None,
            preview_files: vec![],
            error: Some("無効なバックアップファイルです（checkType.jsonが見つかりません）".to_string()),
        };
    }
    
    let backup_info = backup_info.unwrap();
    let mod_name_mismatch = backup_info.mod_name != target_mod_name;
      // MOD名が異なる場合は、force_importが必要
    if mod_name_mismatch && !force_import.unwrap_or(false) {
        return ExternalImportResult {
            success: false,
            imported_configs: vec![],
            mod_name_mismatch: Some(true),
            original_mod_name: Some(backup_info.mod_name.clone()),
            target_mod_name: Some(target_mod_name.clone()),
            preview_files,
            error: Some(format!(
                "MOD名が一致しません。元MOD: '{}', ターゲットMOD: '{}'。force_importフラグを設定してください。",
                backup_info.mod_name,
                target_mod_name
            )),
        };    }
    
    // 実際のファイルインポート処理
    let mut imported_files = Vec::new();
    let target_config_dir = format!("{}/config", MINECRAFT_CONFIG_BASE);
    
    // ターゲットディレクトリが存在しない場合は作成
    if let Err(e) = fs::create_dir_all(&target_config_dir) {
        return ExternalImportResult {
            success: false,
            imported_configs: vec![],
            mod_name_mismatch: Some(mod_name_mismatch),
            original_mod_name: Some(backup_info.mod_name),
            target_mod_name: Some(target_mod_name.clone()),
            preview_files,
            error: Some(format!("ターゲットディレクトリの作成に失敗しました: {}", e)),
        };
    }
    
    // ZIPファイルを再度開いて実際のファイルを展開
    let file = match fs::File::open(&backup_path) {
        Ok(f) => f,
        Err(e) => return ExternalImportResult {
            success: false,
            imported_configs: vec![],
            mod_name_mismatch: Some(mod_name_mismatch),
            original_mod_name: Some(backup_info.mod_name),
            target_mod_name: Some(target_mod_name.clone()),
            preview_files,
            error: Some(format!("ファイル再読み込みエラー: {}", e)),
        },
    };
    
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(a) => a,
        Err(e) => return ExternalImportResult {
            success: false,
            imported_configs: vec![],
            mod_name_mismatch: Some(mod_name_mismatch),
            original_mod_name: Some(backup_info.mod_name),
            target_mod_name: Some(target_mod_name.clone()),
            preview_files,
            error: Some(format!("ZIP再展開エラー: {}", e)),
        },
    };
    
    // config/ディレクトリ内のファイルを実際に展開
    for i in 0..archive.len() {
        let mut file = match archive.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };
        
        let file_name = file.name().to_string();
        
        if file_name.starts_with("config/") && !file_name.ends_with('/') {
            let target_file_path = Path::new(&target_config_dir)
                .join(file_name.strip_prefix("config/").unwrap_or(&file_name));
            
            // ディレクトリが存在しない場合は作成
            if let Some(parent) = target_file_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
              // ファイルを展開（安全なコピー関数を使用）
            match fs::File::create(&target_file_path) {
                Ok(mut target_file) => {
                    // 一時的にメモリにデータを読み込み
                    let mut buffer = Vec::new();
                    if file.read_to_end(&mut buffer).is_ok() {
                        if target_file.write_all(&buffer).is_ok() {
                            // ファイルを閉じてから安全なコピーを実行
                            drop(target_file);
                            imported_files.push(file_name);
                        }
                    }
                },
                Err(_) => continue,
            }
        }
    }
    
    ExternalImportResult {
        success: true,
        imported_configs: imported_files,
        mod_name_mismatch: Some(mod_name_mismatch),
        original_mod_name: Some(backup_info.mod_name),
        target_mod_name: Some(target_mod_name),
        preview_files,
        error: None,
    }
}

// WebからPNG画像を取得し、リサイズしてBase64エンコード
async fn fetch_and_resize_image(url: &str, size: u32) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let response = reqwest::get(url).await?;
    let image_bytes = response.bytes().await?;
    
    let img = image::load_from_memory(&image_bytes)?;
    let resized = img.resize_exact(size, size, image::imageops::FilterType::Lanczos3);
    
    let mut png_data = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png_data);
    resized.write_to(&mut cursor, image::ImageFormat::Png)?;
    
    let base64_data = general_purpose::STANDARD.encode(&png_data);
    Ok(format!("data:image/png;base64,{}", base64_data))
}

// デフォルトアイコンの生成（MOD名の最初の文字を使用）
fn generate_default_icon(mod_name: &str, size: u32) -> Result<String, Box<dyn std::error::Error>> {
    let _first_char = mod_name.chars().next().unwrap_or('M').to_uppercase().to_string();
    
    // 32x32のPNG画像を作成
    let mut img = image::ImageBuffer::new(size, size);
    
    // 背景色を設定（MOD名に基づいて色を決定）
    let hash = mod_name.chars().fold(0u32, |acc, c| acc.wrapping_add(c as u32));
    let r = ((hash >> 16) & 0xFF) as u8;
    let g = ((hash >> 8) & 0xFF) as u8;
    let b = (hash & 0xFF) as u8;
    
    for pixel in img.pixels_mut() {
        *pixel = image::Rgba([r, g, b, 255]);
    }
    
    // PNG形式でエンコード
    let mut png_data = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png_data);
    let dynamic_img = image::DynamicImage::ImageRgba8(img);
    dynamic_img.write_to(&mut cursor, image::ImageFormat::Png)?;
    
    let base64_data = general_purpose::STANDARD.encode(&png_data);
    Ok(format!("data:image/png;base64,{}", base64_data))
}

// MODアイコンを更新
#[command]
pub async fn update_mod_icon(mod_name: String, icon_url: Option<String>) -> IconUpdateResult {
    let icon_data = if let Some(url) = &icon_url {
        match fetch_and_resize_image(url, 32).await {
            Ok(data) => Some(data),
            Err(e) => {
                // URLからの取得に失敗した場合、デフォルトアイコンを生成
                eprintln!("アイコン取得エラー: {}. デフォルトアイコンを生成します。", e);
                match generate_default_icon(&mod_name, 32) {
                    Ok(default_data) => Some(default_data),
                    Err(default_err) => {
                        return IconUpdateResult {
                            success: false,
                            icon_data: None,
                            error: Some(format!("アイコン生成エラー: {}", default_err)),
                        };
                    }
                }
            }
        }
    } else {
        // URLが指定されていない場合、デフォルトアイコンを生成
        match generate_default_icon(&mod_name, 32) {
            Ok(data) => Some(data),
            Err(e) => {
                return IconUpdateResult {
                    success: false,
                    icon_data: None,
                    error: Some(format!("デフォルトアイコン生成エラー: {}", e)),
                };
            }
        }
    };

    // TODO: ここでMOD設定にアイコンデータを保存する処理を追加
    // 現在は取得したデータを返すのみ
    
    IconUpdateResult {
        success: true,
        icon_data,
        error: None,
    }
}

// 一括でMODアイコンを設定
#[command] 
pub async fn batch_update_mod_icons(configs: Vec<ModIconConfig>) -> Vec<IconUpdateResult> {
    let mut results = Vec::new();
    
    for config in configs {
        let result = update_mod_icon(config.mod_name, config.icon_url).await;
        results.push(result);
    }
    
    results
}

// MODアイコン設定の保存・読み込み用構造体
#[derive(Debug, Serialize, Deserialize)]
struct ModIconSettings {
    pub mod_icons: HashMap<String, ModIconConfig>,
}

impl Default for ModIconSettings {
    fn default() -> Self {
        Self {
            mod_icons: HashMap::new(),
        }
    }
}

// アイコン設定ファイルのパス
fn get_icon_settings_path() -> std::path::PathBuf {
    std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .join("mod_icons.json")
}

// アイコン設定を読み込み
fn load_icon_settings() -> ModIconSettings {
    let settings_path = get_icon_settings_path();
    
    if settings_path.exists() {
        if let Ok(contents) = fs::read_to_string(&settings_path) {
            if let Ok(settings) = serde_json::from_str::<ModIconSettings>(&contents) {
                return settings;
            }
        }
    }
    
    ModIconSettings::default()
}

// アイコン設定を保存
fn save_icon_settings(settings: &ModIconSettings) -> Result<(), Box<dyn std::error::Error>> {
    let settings_path = get_icon_settings_path();
    let contents = serde_json::to_string_pretty(settings)?;
    fs::write(&settings_path, contents)?;
    Ok(())
}

// MODアイコンを設定として保存
#[command]
pub async fn save_mod_icon(mod_name: String, icon_url: Option<String>, icon_data: Option<String>) -> IconUpdateResult {
    let mut settings = load_icon_settings();
    
    settings.mod_icons.insert(mod_name.clone(), ModIconConfig {
        mod_name: mod_name.clone(),
        icon_url,
        icon_data: icon_data.clone(),
    });
    
    match save_icon_settings(&settings) {
        Ok(_) => IconUpdateResult {
            success: true,
            icon_data,
            error: None,
        },
        Err(e) => IconUpdateResult {
            success: false,
            icon_data: None,
            error: Some(format!("設定保存エラー: {}", e)),
        },
    }
}

// 保存されたMODアイコン設定を取得
#[command]
pub async fn get_mod_icon(mod_name: String) -> ModIconConfig {
    let settings = load_icon_settings();
    
    settings.mod_icons.get(&mod_name)
        .cloned()
        .unwrap_or(ModIconConfig {
            mod_name,
            icon_url: None,
            icon_data: None,
        })
}

// 外部パックファイル選択ダイアログを開く
#[command]
pub async fn select_external_pack_file(app_handle: tauri::AppHandle) -> FileSelectResult {
    use tauri_plugin_dialog::DialogExt;
    
    let result = app_handle
        .dialog()
        .file()
        .add_filter("PEX Pack Files", &["pexPack"])
        .set_title("外部パックファイルを選択")
        .blocking_pick_file();
    
    #[allow(non_snake_case)]
    match result {
        Some(file_path) => FileSelectResult {
            success: true,
            file_path: Some(file_path.to_string()),
            error: None,
        },
        None => FileSelectResult {
            success: false,
            file_path: None,
            error: Some("ファイルが選択されませんでした".to_string()),
        },
    }
}

// 全MODアイコン設定を取得
#[command]
pub async fn get_all_mod_icons() -> HashMap<String, ModIconConfig> {
    let settings = load_icon_settings();
    settings.mod_icons
}

// 新しい構造体を追加
#[derive(Debug, Serialize, Deserialize)]
pub struct SmartImportResult {
    pub success: bool,
    pub detected_mod_type: Option<String>,
    pub imported_configs: Vec<String>,
    pub target_mod_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportSelectResult {
    pub success: bool,
    pub selected_path: Option<String>,
    pub error: Option<String>,
}

// pexPack出力場所を選択するファイル選択ダイアログ
#[command]
#[allow(clippy::match_single_binding)]
pub async fn select_export_location(app_handle: tauri::AppHandle, default_filename: String) -> ExportSelectResult {
    use tauri_plugin_dialog::DialogExt;
    
    let result = app_handle
        .dialog()
        .file()
        .add_filter("PEX Pack Files", &["pexPack"])
        .set_title("pexPackファイルの保存場所を選択")
        .set_file_name(&default_filename)
        .blocking_save_file();
      #[allow(clippy::match_single_binding)]
    match result {
        Some(file_path) => ExportSelectResult {
            success: true,
            selected_path: Some(file_path.to_string()),
            error: None,
        },
        _ => ExportSelectResult {
            success: false,
            selected_path: None,
            error: Some("保存場所が選択されませんでした".to_string()),
        },
    }
}

// 改良されたシェア機能：ユーザー指定の場所にエクスポート
#[command]
pub async fn export_config_to_custom_location(
    mod_name: String,
    backup_name: String,
    version: String,
    author: Option<String>,
    description: Option<String>,
    export_path: String
) -> BackupResult {
    let config_path = format!("{}/{}", get_minecraft_config_base(), mod_name);
    let config_path = Path::new(&config_path);
    
    if !config_path.exists() {
        return BackupResult {
            success: false,
            backup_path: None,
            error: Some("設定ディレクトリが見つかりません".to_string()),
        };
    }
    
    // バックアップ情報を作成
    let backup_info = BackupInfo {
        name: backup_name.clone(),
        version,
        mod_name: mod_name.clone(),
        author,
        description,
        created_at: Some(std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            .to_string()),
        shared: Some(true),
    };
    
    let export_path = Path::new(&export_path);
    
    // ZIPファイルを作成
    match create_zip_backup(&config_path, &export_path, &backup_info) {
        Ok(_) => BackupResult {
            success: true,
            backup_path: Some(export_path.to_string_lossy().to_string()),
            error: None,
        },
        Err(e) => BackupResult {
            success: false,
            backup_path: None,
            error: Some(format!("エクスポートに失敗しました: {}", e)),
        },
    }
}

// pexPackからMODタイプを自動検知する関数
fn detect_mod_type_from_pack(archive: &mut zip::ZipArchive<fs::File>) -> Option<String> {
    // checkType.jsonから情報を取得
    for i in 0..archive.len() {
        if let Ok(mut file) = archive.by_index(i) {
            if file.name() == "checkType.json" {
                let mut contents = String::new();
                if file.read_to_string(&mut contents).is_ok() {
                    if let Ok(backup_info) = serde_json::from_str::<BackupInfo>(&contents) {
                        return Some(backup_info.mod_name);
                    }
                }
                break;
            }
        }
    }
    
    // config内のファイル拡張子で推定
    let mut flarial_files = 0;
    let mut other_files = 0;
    
    for i in 0..archive.len() {
        if let Ok(file) = archive.by_index(i) {
            let file_name = file.name();
            if file_name.starts_with("config/") && !file_name.ends_with('/') {
                if file_name.ends_with(".flarial") {
                    flarial_files += 1;
                } else if file_name.ends_with(".json") || file_name.ends_with(".cfg") {
                    other_files += 1;
                }
            }
        }
    }
    
    // Flarialファイルが多い場合はFlarial、そうでなければOderSo
    if flarial_files > 0 {
        Some("Flarial".to_string())
    } else if other_files > 0 {
        Some("OderSo".to_string())
    } else {
        None
    }
}

// スマートインポート機能：パックタイプを自動検知してMODにインポート
#[command]
pub async fn smart_import_pack(file_path: String) -> SmartImportResult {
    let backup_path = Path::new(&file_path);
    
    if !backup_path.exists() {
        return SmartImportResult {
            success: false,
            detected_mod_type: None,
            imported_configs: vec![],
            target_mod_path: None,
            error: Some("ファイルが見つかりません".to_string()),
        };
    }
    
    // ZIPファイルを読み込み
    let file = match fs::File::open(&backup_path) {
        Ok(f) => f,
        Err(e) => return SmartImportResult {
            success: false,
            detected_mod_type: None,
            imported_configs: vec![],
            target_mod_path: None,
            error: Some(format!("ファイル読み込みエラー: {}", e)),
        },
    };
    
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(a) => a,
        Err(e) => return SmartImportResult {
            success: false,
            detected_mod_type: None,
            imported_configs: vec![],
            target_mod_path: None,
            error: Some(format!("ZIPファイル展開エラー: {}", e)),
        },
    };
    
    // MODタイプを自動検知
    let detected_mod_type = detect_mod_type_from_pack(&mut archive);
    
    if detected_mod_type.is_none() {
        return SmartImportResult {
            success: false,
            detected_mod_type: None,
            imported_configs: vec![],
            target_mod_path: None,
            error: Some("MODタイプを検知できませんでした".to_string()),
        };
    }
    
    let mod_type = detected_mod_type.unwrap();
    let mod_paths = get_mod_config_paths();
      // 対応するMODパスを取得
    let target_mod_path = if let Some((config_sub_path, _)) = mod_paths.get(&mod_type) {
        let base_path = get_minecraft_config_base();
        format!("{}/{}", base_path, config_sub_path)
    } else {
        return SmartImportResult {
            success: false,
            detected_mod_type: Some(mod_type.clone()),
            imported_configs: vec![],
            target_mod_path: None,
            error: Some(format!("未対応のMODタイプです: {}", mod_type)),
        };
    };
    
    // ターゲットディレクトリが存在しない場合は作成
    if let Err(e) = fs::create_dir_all(&target_mod_path) {
        return SmartImportResult {
            success: false,
            detected_mod_type: Some(mod_type.clone()),
            imported_configs: vec![],
            target_mod_path: Some(target_mod_path),
            error: Some(format!("ターゲットディレクトリの作成に失敗しました: {}", e)),
        };
    }
    
    // ZIPファイルを再度開いて実際のファイルを展開
    let file = match fs::File::open(&backup_path) {
        Ok(f) => f,
        Err(e) => return SmartImportResult {
            success: false,
            detected_mod_type: Some(mod_type.clone()),
            imported_configs: vec![],
            target_mod_path: Some(target_mod_path),
            error: Some(format!("ファイル再読み込みエラー: {}", e)),
        },
    };
    
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(a) => a,
        Err(e) => return SmartImportResult {
            success: false,
            detected_mod_type: Some(mod_type.clone()),
            imported_configs: vec![],
            target_mod_path: Some(target_mod_path),
            error: Some(format!("ZIP再展開エラー: {}", e)),
        },
    };
    
    // config/ディレクトリ内のファイルを実際に展開
    let mut imported_files = Vec::new();
    
    for i in 0..archive.len() {
        let mut file = match archive.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };
        
        let file_name = file.name().to_string();
        
        if file_name.starts_with("config/") && !file_name.ends_with('/') {
            let target_file_path = Path::new(&target_mod_path)
                .join(file_name.strip_prefix("config/").unwrap_or(&file_name));
            
            // ディレクトリが存在しない場合は作成
            if let Some(parent) = target_file_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            
            // ファイルを展開
            match fs::File::create(&target_file_path) {
                Ok(mut target_file) => {
                    let mut buffer = Vec::new();
                    if file.read_to_end(&mut buffer).is_ok() {
                        if target_file.write_all(&buffer).is_ok() {
                            imported_files.push(file_name);
                        }
                    }
                },
                Err(_) => continue,
            }
        }
    }
    
    SmartImportResult {
        success: true,
        detected_mod_type: Some(mod_type),
        imported_configs: imported_files,
        target_mod_path: Some(target_mod_path),
        error: None,
    }
}