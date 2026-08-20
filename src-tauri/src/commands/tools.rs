use crate::config::ConfigStore;
use crate::llm::OpenAIClient;
use crate::tools::ToolRegistry;
use crate::types::{ToolInfo, ProviderConfig};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn tools_list(registry: State<'_, Arc<ToolRegistry>>) -> Result<Vec<ToolInfo>, String> {
    Ok(registry.get_infos())
}

#[tauri::command]
pub async fn tools_reload(
    store: State<'_, ConfigStore>,
    registry: State<'_, Arc<ToolRegistry>>,
) -> Result<Vec<ToolInfo>, String> {
    let cfg = store.get().clone();
    registry.initialize(&cfg).map_err(|e| e.to_string())?;
    Ok(registry.get_infos())
}

#[tauri::command]
pub async fn models_fetch(
    store: State<'_, ConfigStore>,
    provider_id: Option<String>,
) -> Result<Vec<String>, String> {
    let cfg = store.get().clone();
    let provider = provider_id
        .and_then(|id| cfg.providers.iter().find(|p| p.id == id).cloned())
        .or_else(|| cfg.providers.first().cloned())
        .ok_or("No provider configured")?;
    OpenAIClient::fetch_models(&provider)
        .await
        .map_err(|e| e.to_string())
}
