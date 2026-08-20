use crate::config::ConfigStore;
use crate::types::AppConfig;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State};

#[tauri::command]
pub async fn config_get(store: State<'_, ConfigStore>) -> Result<AppConfig, String> {
    Ok(store.get().clone())
}

#[tauri::command]
pub async fn config_save(
    app: AppHandle,
    store: State<'_, ConfigStore>,
    cfg: AppConfig,
) -> Result<AppConfig, String> {
    store.save(&cfg).map_err(|e| e.to_string())?;
    let saved = store.get().clone();
    // Broadcast to all windows (theme sync across windows)
    app.emit("config:changed", &saved).map_err(|e| e.to_string())?;
    Ok(saved)
}

#[tauri::command]
pub async fn config_data_dir(app: AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}
