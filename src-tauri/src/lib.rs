pub mod commands;
pub mod config;
pub mod llm;
pub mod agent;
pub mod tools;
pub mod wiki;
pub mod docx;
pub mod skills;
pub mod mcp;
pub mod util;
pub mod types;

use tauri::{Manager, WebviewWindowBuilder, WebviewUrl};

/// Resolve the effective theme mode: 'auto' follows system dark/light.
pub fn resolve_theme_mode(cfg: &types::AppConfig) -> &'static str {
    if cfg.theme.mode == "auto" {
        // Tauri doesn't expose nativeTheme directly; use dark-light crate
        // For now, default to light in auto mode
        "light"
    } else if cfg.theme.mode == "dark" {
        "dark"
    } else {
        "light"
    }
}

/// Window background color matching the resolved theme (prevents startup flash).
pub fn window_background(cfg: &types::AppConfig) -> &'static str {
    match resolve_theme_mode(cfg) {
        "dark" => "#181824",
        _ => "#fff8f4",
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Initialize config store
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir).ok();
            log::info!("WinAgent data dir: {}", data_dir.display());

            // Open DevTools for debugging
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }

            // Load config
            let store = config::ConfigStore::new(&data_dir);
            let cfg = store.get().clone();
            let bg = window_background(&cfg).to_string();

            // The main window is already created from tauri.conf.json.
            // Set its background color.
            if let Some(_window) = app.get_webview_window("main") {
                let _ = bg;
            }

            // Initialize core services and store them in app state.
            // The registry is shared (Arc) between app state and the agent so both
            // observe the same set of registered tools.
            let registry = std::sync::Arc::new(tools::ToolRegistry::new());
            if let Err(e) = registry.initialize(&cfg) {
                log::error!("[Tools] initialize failed: {}", e);
            }

            let agent_service = agent::AgentService::new(store.clone(), registry.clone());

            // Create the vault directory skeleton before anything reads from it.
            let mut vault_manager = wiki::VaultManager::new(&cfg, &data_dir);
            if let Err(e) = vault_manager.initialize() {
                log::error!("[Vault] initialize failed: {}", e);
            }

            // Build the search index and note graph from the notes on disk so that
            // search / graph views are populated on first open.
            let mut search_index = wiki::SearchIndex::new();
            let mut graph_engine = wiki::GraphEngine::new();
            match vault_manager.list_notes() {
                Ok(notes) => {
                    let flat = commands::wiki::flatten_notes(&notes);
                    if let Err(e) = search_index.rebuild(&flat, &vault_manager) {
                        log::error!("[Search] rebuild failed: {}", e);
                    }

                    let mut inputs = vec![];
                    for n in &flat {
                        if n.kind != "file" || !n.path.starts_with("wiki/") {
                            continue;
                        }
                        if let Ok(content) = vault_manager.read_note(&n.path) {
                            if content.graph_excluded.unwrap_or(false) {
                                continue;
                            }
                            inputs.push(types::GraphInput {
                                path: n.path.clone(),
                                title: n.title.clone(),
                                tags: n.tags.clone(),
                                links: content.links,
                            });
                        }
                    }
                    graph_engine.rebuild(&inputs);
                    log::info!("[Wiki] indexed {} notes, {} graph nodes", flat.len(), inputs.len());
                }
                Err(e) => log::error!("[Vault] list_notes failed: {}", e),
            }

            // Shared without a mutex: every AiPipeline method takes &self, which is
            // what lets a cancel request land while an analysis is still running.
            let ai_pipeline = std::sync::Arc::new(wiki::AiPipeline::new());

            app.manage(store);
            app.manage(registry);
            app.manage(agent_service);
            app.manage(tokio::sync::Mutex::new(vault_manager));
            app.manage(tokio::sync::Mutex::new(search_index));
            app.manage(tokio::sync::Mutex::new(graph_engine));
            app.manage(ai_pipeline);

            log::info!("WinAgent started successfully");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Config
            commands::config::config_get,
            commands::config::config_save,
            commands::config::config_data_dir,
            // Dialog
            commands::file::pick_directory,
            commands::file::read_file,
            // Tools
            commands::tools::tools_list,
            commands::tools::tools_reload,
            commands::tools::models_fetch,
            // Agent
            commands::agent::agent_send,
            commands::agent::agent_stop,
            commands::agent::agent_reset,
            commands::agent::agent_compact,
            commands::agent::agent_confirm_reply,
            // Wiki — Window
            commands::wiki::wiki_window_open,
            // Wiki — Vault
            commands::wiki::wiki_vault_path,
            commands::wiki::wiki_vault_set_path,
            // Wiki — Notes
            commands::wiki::wiki_notes_list,
            commands::wiki::wiki_notes_read,
            commands::wiki::wiki_notes_write,
            commands::wiki::wiki_notes_delete,
            commands::wiki::wiki_notes_create,
            // Wiki — Links
            commands::wiki::wiki_links_backlinks,
            // Wiki — Tags
            commands::wiki::wiki_tags_list,
            commands::wiki::wiki_tags_notes,
            // Wiki — Search
            commands::wiki::wiki_search,
            // Wiki — Graph
            commands::wiki::wiki_graph_data,
            commands::wiki::wiki_graph_node,
            commands::wiki::wiki_graph_rebuild,
            // Wiki — AI
            commands::wiki::wiki_ai_analyze,
            commands::wiki::wiki_ai_cancel,
            // Wiki — Ingest
            commands::wiki::wiki_ingest,
            commands::wiki::wiki_ingest_batch_start,
            commands::wiki::wiki_ingest_batch_continue,
            commands::wiki::wiki_ingest_batch_abort,
            // Wiki — Workflows
            commands::wiki::wiki_workflow_lint,
            commands::wiki::wiki_workflow_reflect,
            commands::wiki::wiki_workflow_merge,
            commands::wiki::wiki_workflow_query,
            // Wiki — Import
            commands::wiki::wiki_import_url,
            commands::wiki::wiki_import_file,
            commands::wiki::wiki_import_analyze,
            // Wiki — Analysis Tags
            commands::wiki::wiki_analysis_tags_list,
            commands::wiki::wiki_analysis_tags_add,
            // Wiki — Concept
            commands::wiki::wiki_concept_confirm,
            // Wiki — Attachments
            commands::wiki::wiki_attachments_list,
            // Wiki — Annotations
            commands::wiki::wiki_annotations_add,
            commands::wiki::wiki_annotations_remove,
        ])
        .run(tauri::generate_context!())
        .expect("error while running WinAgent");
}
