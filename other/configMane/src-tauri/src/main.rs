// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod scan_pex;

fn main() {
    tauri::Builder::<tauri::Wry>::default()
        .plugin(tauri_plugin_opener::init::<tauri::Wry>())
        .plugin(tauri_plugin_fs::init::<tauri::Wry>())
        .invoke_handler(tauri::generate_handler![
            scan_pex::scan_pextool_command,
            config::scan_minecraft_configs,
            config::backup_mod_config,
            config::import_config_backup,
            config::list_backup_files,
            config::share_config_backup,
            config::preview_external_backup,
            config::import_external_backup,
            config::update_mod_icon,
            config::batch_update_mod_icons,
            config::save_mod_icon,
            config::get_mod_icon,
            config::get_all_mod_icons
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
