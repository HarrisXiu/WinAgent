use crate::agent::AgentService;
use crate::config::ConfigStore;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn agent_send(
    app: AppHandle,
    agent: State<'_, AgentService>,
    text: String,
    attachments: Option<Vec<serde_json::Value>>,
) -> Result<(), String> {
    agent
        .process(app, text, attachments.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_stop(agent: State<'_, AgentService>) -> Result<(), String> {
    agent.stop();
    Ok(())
}

#[tauri::command]
pub async fn agent_reset(agent: State<'_, AgentService>) -> Result<(), String> {
    agent.reset();
    Ok(())
}

#[tauri::command]
pub async fn agent_compact(
    app: AppHandle,
    agent: State<'_, AgentService>,
) -> Result<(), String> {
    agent.compact_now(app).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_confirm_reply(
    agent: State<'_, AgentService>,
    id: String,
    approved: bool,
) -> Result<(), String> {
    agent.resolve_confirm(&id, approved);
    Ok(())
}
