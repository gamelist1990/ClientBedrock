// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod scan_pex;

fn main() {
    tauri::Builder::<tauri::Wry>::default()
        .plugin(tauri_plugin_opener::init::<tauri::Wry>())
        .plugin(tauri_plugin_fs::init::<tauri::Wry>())
        .invoke_handler(tauri::generate_handler![scan_pex::scan_pextool_command])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
