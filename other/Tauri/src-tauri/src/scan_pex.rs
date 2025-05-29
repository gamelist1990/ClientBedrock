use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::SystemTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeInfo {
    pub architecture: String,
    pub subsystem: String,
    pub timestamp: String,
    pub has_debug_info: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub file_type: String,
    pub is_pe_executable: bool,
    pub pe_info: Option<PeInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PEXToolInfo {
    pub name: String,
    pub version: String,
    pub description: String,
    pub path: String,
    pub tool_type: String, // 'electron' | 'inno' | 'unknown'
    pub has_uninstaller: bool,
    pub uninstaller_path: Option<String>,
    pub apps: Vec<AppInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanResult {
    pub success: bool,
    pub pextool_directories: Option<Vec<String>>,
    pub tools: Option<Vec<PEXToolInfo>>,
    pub total_tools: Option<usize>,
    pub total_apps: Option<usize>,
    pub error: Option<String>,
    pub details: Option<String>,
}

/// PEXtoolディレクトリを検索する
async fn find_pextool_directories() -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let mut pextool_dirs = Vec::new();
    let search_paths = vec![
        "C:\\Program Files".to_string(),
        "C:\\Program Files (x86)".to_string(),
    ];

    for base_path in search_paths {
        if let Ok(entries) = fs::read_dir(&base_path) {
            for entry in entries.flatten() {
                if let Ok(metadata) = entry.metadata() {
                    if metadata.is_dir() {
                        let dir_name = entry.file_name().to_string_lossy().to_lowercase();
                        if dir_name.contains("pextool") || dir_name.contains("pex tool") {
                            let full_path = entry.path().to_string_lossy().to_string();
                            pextool_dirs.push(full_path);
                        }
                    }
                }
            }
        }
    }

    Ok(pextool_dirs)
}

/// PEXtoolディレクトリ内のツールをスキャンする
async fn scan_pextool_directory(
    pextool_path: &str,
) -> Result<Vec<PEXToolInfo>, Box<dyn std::error::Error>> {
    let mut tools = Vec::new();

    if !Path::new(pextool_path).exists() {
        return Ok(tools);
    }

    if let Ok(entries) = fs::read_dir(pextool_path) {
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_dir() {
                    let tool_path = entry.path().to_string_lossy().to_string();
                    let tool_name = entry.file_name().to_string_lossy().to_string();

                    if let Ok(tool_info) = analyze_tool_directory(&tool_path, &tool_name).await {
                        if let Some(info) = tool_info {
                            tools.push(info);
                        }
                    }
                }
            }
        }
    }

    Ok(tools)
}

/// 個別ツールディレクトリを解析
async fn analyze_tool_directory(
    tool_path: &str,
    tool_name: &str,
) -> Result<Option<PEXToolInfo>, Box<dyn std::error::Error>> {
    let mut tool_info = PEXToolInfo {
        name: tool_name.to_string(),
        version: "Unknown".to_string(),
        description: String::new(),
        path: tool_path.to_string(),
        tool_type: "unknown".to_string(),
        has_uninstaller: false,
        uninstaller_path: None,
        apps: Vec::new(),
    };

    // pex.txtファイルの解析
    let pex_txt_path = Path::new(tool_path).join("pex.txt");
    if pex_txt_path.exists() {
        if let Ok(content) = fs::read_to_string(&pex_txt_path) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("Name=") {
                    tool_info.name = trimmed[5..].to_string();
                } else if trimmed.starts_with("Version=") {
                    tool_info.version = trimmed[8..].to_string();
                } else if trimmed.starts_with("Description=") {
                    tool_info.description = trimmed[12..].to_string();
                }
            }
        }
    }

    // package.jsonの解析（Electronアプリの場合）
    let package_json_path = Path::new(tool_path).join("package.json");
    if package_json_path.exists() {
        if let Ok(content) = fs::read_to_string(&package_json_path) {
            if let Ok(package_data) = serde_json::from_str::<serde_json::Value>(&content) {
                tool_info.tool_type = "electron".to_string();
                if let Some(name) = package_data.get("name").and_then(|v| v.as_str()) {
                    tool_info.name = name.to_string();
                }
                if let Some(version) = package_data.get("version").and_then(|v| v.as_str()) {
                    tool_info.version = version.to_string();
                }
                if let Some(description) = package_data.get("description").and_then(|v| v.as_str())
                {
                    tool_info.description = description.to_string();
                }
            }
        }
    } // アンインストーラーの検出
    if let Ok(entries) = fs::read_dir(tool_path) {
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_file() {
                    // 大文字小文字を区別せずに検出するために小文字変換
                    let file_name_lower = entry.file_name().to_string_lossy().to_lowercase();
                    let file_name_original = entry.file_name().to_string_lossy().to_string();

                    // デバッグ: すべてのexeファイルを出力
                    if file_name_lower.ends_with(".exe") {
                        println!("EXEファイル検出: {}", file_name_original);
                    } // "Uninstall" (大文字小文字問わず) で始まるか、"unins" で始まるアンインストーラーを検出
                      // 先に「uninstall」をチェックし、後で「unins」をチェックする
                    if (file_name_lower.starts_with("uninstall")
                        && file_name_lower.ends_with(".exe"))
                        || (file_name_lower.starts_with("unins")
                            && !file_name_lower.starts_with("uninstall")
                            && file_name_lower.ends_with(".exe"))
                    {
                        let uninstall_path = entry.path().to_string_lossy().to_string();
                        tool_info.has_uninstaller = true;
                        tool_info.uninstaller_path = Some(uninstall_path);
                        println!("アンインストーラー検出: {}", file_name_original);

                        // 「uninstall」で始まるファイルはElectronアンインストーラー
                        if file_name_lower.starts_with("uninstall") {
                            tool_info.tool_type = "electron".to_string();
                            println!("Electronアンインストーラー: {}", file_name_original);
                        }
                        // 「unins」で始まり「uninstall」で始まらないファイルはInnoアンインストーラー
                        else if file_name_lower.starts_with("unins") {
                            tool_info.tool_type = "inno".to_string();
                            println!("Innoアンインストーラー: {}", file_name_original);
                        }

                        // package.jsonが存在する場合は、Electronタイプを優先
                        let package_json_path = Path::new(tool_path).join("package.json");
                        if package_json_path.exists() {
                            tool_info.tool_type = "electron".to_string();
                            println!("Package.json found, setting type to electron");
                        }

                        break;
                    }
                }
            }
        }
    }

    // ディレクトリ内のアプリケーションファイルをスキャン
    tool_info.apps = scan_directory_for_apps(tool_path).await?;

    // バージョン情報とタイプ情報を他のexeファイルから取得
    if tool_info.version == "Unknown" || tool_info.tool_type == "unknown" {
        extract_info_from_exe_files(tool_path, &mut tool_info).await?;
    }

    Ok(Some(tool_info))
}

/// ディレクトリ内のアプリケーションファイルをスキャン
async fn scan_directory_for_apps(
    directory: &str,
) -> Result<Vec<AppInfo>, Box<dyn std::error::Error>> {
    let mut apps = Vec::new();

    if let Ok(entries) = fs::read_dir(directory) {
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_file() {
                    let file_path = entry.path();
                    let file_name = entry.file_name().to_string_lossy().to_string();

                    if let Some(extension) = file_path.extension() {
                        let ext = extension.to_string_lossy().to_lowercase();
                        if matches!(ext.as_str(), "exe" | "dll" | "sys" | "ocx") {
                            let pe_info = analyze_pe_file(&file_path, &metadata);

                            apps.push(AppInfo {
                                name: file_name,
                                path: file_path.to_string_lossy().to_string(),
                                size: metadata.len(),
                                file_type: ext.to_uppercase(),
                                is_pe_executable: pe_info.is_some(),
                                pe_info,
                            });
                        }
                    }
                }
            }
        }
    }

    // サイズでソート（大きい順）
    apps.sort_by(|a, b| b.size.cmp(&a.size));
    Ok(apps)
}

/// PEファイルの基本情報を抽出（簡易版）
fn analyze_pe_file(file_path: &Path, metadata: &fs::Metadata) -> Option<PeInfo> {
    if let Some(extension) = file_path.extension() {
        let ext = extension.to_string_lossy().to_lowercase();
        if matches!(ext.as_str(), "exe" | "dll" | "sys" | "ocx") {
            let timestamp = metadata
                .modified()
                .unwrap_or(SystemTime::UNIX_EPOCH)
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();

            // 手動で日時を計算
            let seconds_per_day = 86400;
            let seconds_per_hour = 3600;
            let seconds_per_minute = 60;

            // UNIXタイムスタンプを日付に変換（簡易実装）
            let days_since_epoch = timestamp / seconds_per_day;
            let seconds_in_day = timestamp % seconds_per_day;

            let hours = seconds_in_day / seconds_per_hour;
            let minutes = (seconds_in_day % seconds_per_hour) / seconds_per_minute;
            let seconds = (seconds_in_day % seconds_per_hour) % seconds_per_minute;

            // 1970年1月1日からの日数から日付を算出（閏年など厳密な計算はしていない簡易版）
            let mut year = 1970;
            let mut days_remaining = days_since_epoch;

            // 年を計算
            loop {
                let days_in_year = if (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0) {
                    366
                } else {
                    365
                };
                if days_remaining < days_in_year {
                    break;
                }
                days_remaining -= days_in_year;
                year += 1;
            }

            // 月を計算
            let days_in_month = [
                31,
                if (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0) {
                    29
                } else {
                    28
                },
                31,
                30,
                31,
                30,
                31,
                31,
                30,
                31,
                30,
                31,
            ];
            let mut month = 0;
            while month < 12 && days_remaining >= days_in_month[month] {
                days_remaining -= days_in_month[month];
                month += 1;
            }

            // 日を計算（0始まりから1始まりに）
            let day = days_remaining + 1;

            let timestamp_str = format!(
                "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
                year,
                month + 1,
                day,
                hours,
                minutes,
                seconds
            );

            return Some(PeInfo {
                architecture: "x64".to_string(), // 簡易判定
                subsystem: if ext == "exe" {
                    "Console/Windows".to_string()
                } else {
                    "Native".to_string()
                },
                timestamp: timestamp_str,
                has_debug_info: metadata.len() > 1024 * 1024, // 1MB以上なら多分デバッグ情報あり
            });
        }
    }
    None
}

/// exeファイルからバージョン情報とタイプ情報を抽出
async fn extract_info_from_exe_files(
    tool_path: &str,
    tool_info: &mut PEXToolInfo,
) -> Result<(), Box<dyn std::error::Error>> {
    if let Ok(entries) = fs::read_dir(tool_path) {
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_file() {
                    let file_name = entry.file_name().to_string_lossy().to_lowercase();
                    if file_name.ends_with(".exe")
                        && !file_name.starts_with("uninstall")
                        && !file_name.starts_with("unins")
                    {
                        // ファイル名からタイプを推測
                        if file_name.contains("electron") || file_name.contains("app") {
                            tool_info.tool_type = "electron".to_string();
                        } // メインexeファイルと思われるものからバージョンを取得（簡易版）
                        if tool_info.version == "Unknown" && metadata.len() > 1024 {
                            if let Ok(modified) = metadata.modified() {
                                if let Ok(duration) =
                                    modified.duration_since(SystemTime::UNIX_EPOCH)
                                {
                                    let timestamp = duration.as_secs();

                                    // 手動で日時を計算
                                    let seconds_per_day = 86400;

                                    // UNIXタイムスタンプを日付に変換（簡易実装）
                                    let days_since_epoch = timestamp / seconds_per_day;

                                    // 1970年1月1日からの日数から日付を算出
                                    let mut year = 1970;
                                    let mut days_remaining = days_since_epoch;

                                    // 年を計算
                                    loop {
                                        let days_in_year = if (year % 4 == 0 && year % 100 != 0)
                                            || (year % 400 == 0)
                                        {
                                            366
                                        } else {
                                            365
                                        };
                                        if days_remaining < days_in_year {
                                            break;
                                        }
                                        days_remaining -= days_in_year;
                                        year += 1;
                                    }

                                    // 月を計算
                                    let days_in_month = [
                                        31,
                                        if (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0) {
                                            29
                                        } else {
                                            28
                                        },
                                        31,
                                        30,
                                        31,
                                        30,
                                        31,
                                        31,
                                        30,
                                        31,
                                        30,
                                        31,
                                    ];
                                    let mut month = 0;
                                    while month < 12 && days_remaining >= days_in_month[month] {
                                        days_remaining -= days_in_month[month];
                                        month += 1;
                                    }

                                    // 日を計算（0始まりから1始まりに）
                                    let day = days_remaining + 1;

                                    tool_info.version =
                                        format!("{}.{:02}.{:02}", year, month + 1, day);
                                }
                            }
                        }

                        break; // 最初のexeファイルの情報を使用
                    }
                }
            }
        }
    }
    Ok(())
}

/// PEXtoolをスキャンしてツール情報を取得するメイン関数
pub async fn scan_pextools() -> ScanResult {
    match scan_pextools_internal().await {
        Ok(result) => result,
        Err(e) => ScanResult {
            success: false,
            pextool_directories: None,
            tools: None,
            total_tools: None,
            total_apps: None,
            error: Some("Failed to scan PEXtool directories".to_string()),
            details: Some(e.to_string()),
        },
    }
}

async fn scan_pextools_internal() -> Result<ScanResult, Box<dyn std::error::Error>> {
    println!("Starting PEXtool scan...");

    // PEXtoolディレクトリを検索
    let pextool_dirs = find_pextool_directories().await?;
    println!("Found PEXtool directories: {:?}", pextool_dirs);

    let mut all_tools = Vec::new();

    // 各PEXtoolディレクトリをスキャン
    for pextool_dir in &pextool_dirs {
        let tools = scan_pextool_directory(pextool_dir).await?;
        all_tools.extend(tools);
    }

    let total_apps = all_tools.iter().map(|tool| tool.apps.len()).sum();

    println!("Found {} tools in total", all_tools.len());

    Ok(ScanResult {
        success: true,
        pextool_directories: Some(pextool_dirs),
        tools: Some(all_tools.clone()),
        total_tools: Some(all_tools.len()),
        total_apps: Some(total_apps),
        error: None,
        details: None,
    })
}

/// Tauriコマンド: PEXtoolスキャンを実行
#[tauri::command]
pub async fn scan_pextool_command() -> ScanResult {
    scan_pextools().await
}
