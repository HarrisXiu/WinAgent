use crate::config::ConfigStore;
use crate::tools::ToolRegistry;
use crate::wiki::{VaultManager, SearchIndex, GraphEngine, AiPipeline};
use crate::types::*;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

// === Window ===

#[tauri::command]
pub async fn wiki_window_open(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("wiki") {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let _store = app.state::<ConfigStore>();

    let _window = WebviewWindowBuilder::new(
        &app,
        "wiki",
        WebviewUrl::App("index.html?view=wiki".into()),
    )
    .title("知识库")
    .inner_size(1400.0, 900.0)
    .min_inner_size(960.0, 600.0)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

// === Vault ===

#[tauri::command]
pub async fn wiki_vault_path(
    vault: State<'_, Mutex<VaultManager>>,
) -> Result<String, String> {
    let vm = vault.lock().await;
    Ok(vm.get_vault_path())
}

#[tauri::command]
pub async fn wiki_vault_set_path(
    app: AppHandle,
    store: State<'_, ConfigStore>,
    vault: State<'_, Mutex<VaultManager>>,
    search: State<'_, Mutex<SearchIndex>>,
    p: String,
) -> Result<(), String> {
    let mut vm = vault.lock().await;
    vm.set_vault_path(&p).map_err(|e| e.to_string())?;

    // Rebuild search index
    let notes = vm.list_notes().map_err(|e| e.to_string())?;
    let flat = flatten_notes(&notes);
    let mut si = search.lock().await;
    si.rebuild(&flat, &vm).map_err(|e| e.to_string())?;
    Ok(())
}

// === Notes ===

#[tauri::command]
pub async fn wiki_notes_list(
    vault: State<'_, Mutex<VaultManager>>,
) -> Result<Vec<NoteMeta>, String> {
    let vm = vault.lock().await;
    vm.list_notes().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wiki_notes_read(
    vault: State<'_, Mutex<VaultManager>>,
    rel_path: String,
) -> Result<NoteContent, String> {
    let vm = vault.lock().await;
    vm.read_note(&rel_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wiki_notes_write(
    app: AppHandle,
    vault: State<'_, Mutex<VaultManager>>,
    search: State<'_, Mutex<SearchIndex>>,
    rel_path: String,
    data: NoteData,
) -> Result<(), String> {
    let mut vm = vault.lock().await;
    vm.write_note(&rel_path, &data).map_err(|e| e.to_string())?;

    // Update search index
    let note = vm.read_note(&rel_path).map_err(|e| e.to_string())?;
    {
        let mut si = search.lock().await;
        si.index_note(&note);
    }
    // Async graph rebuild omitted for now — will be triggered by vault change event
    Ok(())
}

#[tauri::command]
pub async fn wiki_notes_delete(
    vault: State<'_, Mutex<VaultManager>>,
    search: State<'_, Mutex<SearchIndex>>,
    rel_path: String,
) -> Result<(), String> {
    let mut vm = vault.lock().await;
    if vm.is_system_file(&rel_path) {
        return Err("系统文件受保护，不能删除".to_string());
    }
    vm.delete_note(&rel_path).map_err(|e| e.to_string())?;
    {
        let mut si = search.lock().await;
        si.remove_note(&rel_path);
    }
    Ok(())
}

#[tauri::command]
pub async fn wiki_notes_create(
    vault: State<'_, Mutex<VaultManager>>,
    rel_path: String,
    title: String,
) -> Result<(), String> {
    let mut vm = vault.lock().await;
    vm.create_note(&rel_path, &title).map_err(|e| e.to_string())
}

// === Links ===

#[tauri::command]
pub async fn wiki_links_backlinks(
    vault: State<'_, Mutex<VaultManager>>,
    target_path: String,
) -> Result<Vec<NoteMeta>, String> {
    let vm = vault.lock().await;
    vm.get_backlinks(&target_path).map_err(|e| e.to_string())
}

// === Tags ===

#[tauri::command]
pub async fn wiki_tags_list(
    vault: State<'_, Mutex<VaultManager>>,
) -> Result<Vec<TagWithCount>, String> {
    let vm = vault.lock().await;
    vm.get_all_tags().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wiki_tags_notes(
    vault: State<'_, Mutex<VaultManager>>,
    tag: String,
) -> Result<Vec<NoteMeta>, String> {
    let vm = vault.lock().await;
    vm.get_notes_by_tag(&tag).map_err(|e| e.to_string())
}

// === Search ===

#[tauri::command]
pub async fn wiki_search(
    search: State<'_, Mutex<SearchIndex>>,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<SearchResult>, String> {
    let si = search.lock().await;
    si.search(&query, limit.unwrap_or(20)).map_err(|e| e.to_string())
}

// === Graph ===

#[tauri::command]
pub async fn wiki_graph_data(
    graph: State<'_, Mutex<GraphEngine>>,
) -> Result<GraphData, String> {
    let ge = graph.lock().await;
    Ok(ge.get_data())
}

#[tauri::command]
pub async fn wiki_graph_node(
    graph: State<'_, Mutex<GraphEngine>>,
    node_id: String,
) -> Result<GraphData, String> {
    let ge = graph.lock().await;
    Ok(ge.get_neighborhood(&node_id, 1))
}

#[tauri::command]
pub async fn wiki_graph_rebuild(
    vault: State<'_, Mutex<VaultManager>>,
    graph: State<'_, Mutex<GraphEngine>>,
) -> Result<(), String> {
    rebuild_graph_inner(&vault, &graph).await.map_err(|e| e.to_string())
}

// === AI Analysis ===

#[tauri::command]
pub async fn wiki_ai_analyze(
    app: AppHandle,
    store: State<'_, ConfigStore>,
    vault: State<'_, Mutex<VaultManager>>,
    search: State<'_, Mutex<SearchIndex>>,
    graph: State<'_, Mutex<GraphEngine>>,
    ai: State<'_, Arc<AiPipeline>>,
    rel_path: String,
) -> Result<AISuggestion, String> {
    let cfg = store.get().clone();
    let provider = cfg.providers.iter()
        .find(|p| p.id == cfg.active_provider_id)
        .or(cfg.providers.first())
        .ok_or("没有可用的 AI 模型，请先在设置中配置")?
        .clone();

    let note = {
        let vm = vault.lock().await;
        vm.read_note(&rel_path).map_err(|e| e.to_string())?
    };

    let all_notes = {
        let vm = vault.lock().await;
        vm.list_notes().map_err(|e| e.to_string())?
    };
    let candidates: Vec<(String, String)> = flatten_notes(&all_notes)
        .into_iter()
        .filter(|n| n.kind == "file" && n.path.starts_with("wiki/") && n.path != rel_path)
        .map(|n| (n.path.clone(), n.title.clone()))
        .collect();

    let note_type = if rel_path.starts_with("wiki/sources/") {
        "source"
    } else if rel_path.starts_with("wiki/concepts/") {
        "concept"
    } else if rel_path.starts_with("wiki/entities/") {
        "entity"
    } else if rel_path.starts_with("raw/") {
        "raw"
    } else {
        "note"
    };

    let contract = {
        let vm = vault.lock().await;
        crate::wiki::contract::read_contract_sections(
            &vm.get_vault_path(),
            &["总则", "wikilink", "confidence", "个人写作", "质量红线"],
        ).unwrap_or_default()
    };

    let open_questions = {
        let vm = vault.lock().await;
        vm.get_open_questions().unwrap_or_default()
    };

    let result = ai
        .analyze(&provider, &note.title, &note.raw_body, &candidates, note_type, &contract, &open_questions)
        .await
        .map_err(|e| e.to_string())?;

    // Persist results
    {
        let mut vm = vault.lock().await;
        vm.update_ai_results(&rel_path, result.summary.as_deref(), result.tags.as_ref(), result.relations.as_ref())
            .map_err(|e| e.to_string())?;
    }

    // Update search index
    {
        let vm = vault.lock().await;
        if let Ok(refreshed) = vm.read_note(&rel_path) {
            let mut si = search.lock().await;
            si.index_note(&refreshed);
        }
    }

    // Rebuild graph
    let _ = rebuild_graph_inner(&vault, &graph).await;

    // Notify frontend
    app.emit("wiki:vault:changed", serde_json::json!({"type": "modify", "path": rel_path})).ok();

    Ok(result)
}

#[tauri::command]
pub async fn wiki_ai_cancel(
    ai: State<'_, Arc<AiPipeline>>,
) -> Result<(), String> {
    ai.cancel();
    Ok(())
}

// === Ingest ===

#[tauri::command]
pub async fn wiki_ingest(
    app: AppHandle,
    store: State<'_, ConfigStore>,
    vault: State<'_, Mutex<VaultManager>>,
    search: State<'_, Mutex<SearchIndex>>,
    graph: State<'_, Mutex<GraphEngine>>,
    ai: State<'_, Arc<AiPipeline>>,
    raw_rel_path: String,
) -> Result<IngestResult, String> {
    let cfg = store.get().clone();
    crate::wiki::ingest::run_ingest(&app, &cfg, &vault, &search, &graph, &ai, &raw_rel_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wiki_ingest_batch_start(
    app: AppHandle,
    store: State<'_, ConfigStore>,
    vault: State<'_, Mutex<VaultManager>>,
    search: State<'_, Mutex<SearchIndex>>,
    graph: State<'_, Mutex<GraphEngine>>,
    ai: State<'_, Arc<AiPipeline>>,
    paths: Vec<String>,
) -> Result<BatchIngestStartResult, String> {
    let cfg = store.get().clone();
    crate::wiki::ingest::batch_start(&app, &cfg, &vault, &search, &graph, &ai, &paths)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wiki_ingest_batch_continue(
    app: AppHandle,
    store: State<'_, ConfigStore>,
    vault: State<'_, Mutex<VaultManager>>,
    search: State<'_, Mutex<SearchIndex>>,
    graph: State<'_, Mutex<GraphEngine>>,
    ai: State<'_, Arc<AiPipeline>>,
) -> Result<BatchIngestDoneResult, String> {
    let cfg = store.get().clone();
    crate::wiki::ingest::batch_continue(&app, &cfg, &vault, &search, &graph, &ai)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wiki_ingest_batch_abort(
    ai: State<'_, Arc<AiPipeline>>,
) -> Result<serde_json::Value, String> {
    crate::wiki::ingest::batch_abort(&ai);
    Ok(serde_json::json!({"ok": true}))
}

// === Workflows ===

#[tauri::command]
pub async fn wiki_workflow_lint(
    app: AppHandle,
    vault: State<'_, Mutex<VaultManager>>,
) -> Result<LintWorkflowResult, String> {
    let vm = vault.lock().await;
    crate::wiki::workflow::run_lint(&app, &vm)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wiki_workflow_reflect(
    app: AppHandle,
    store: State<'_, ConfigStore>,
    vault: State<'_, Mutex<VaultManager>>,
) -> Result<WorkflowResult, String> {
    let cfg = store.get().clone();
    let vm = vault.lock().await;
    crate::wiki::workflow::run_reflect(&app, &vm, &cfg)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wiki_workflow_merge(
    app: AppHandle,
    vault: State<'_, Mutex<VaultManager>>,
    keep: String,
    remove: String,
    area: String,
) -> Result<WorkflowResult, String> {
    let vm = vault.lock().await;
    crate::wiki::workflow::run_merge(&app, &vm, &keep, &remove, &area)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wiki_workflow_query(
    app: AppHandle,
    store: State<'_, ConfigStore>,
    vault: State<'_, Mutex<VaultManager>>,
    search: State<'_, Mutex<SearchIndex>>,
    query: String,
) -> Result<WorkflowResult, String> {
    let cfg = store.get().clone();
    let vm = vault.lock().await;
    let si = search.lock().await;
    crate::wiki::workflow::run_query(&app, &vm, &si, &cfg, &query)
        .await
        .map_err(|e| e.to_string())
}

// === Import ===

#[tauri::command]
pub async fn wiki_import_url(
    app: AppHandle,
    store: State<'_, ConfigStore>,
    vault: State<'_, Mutex<VaultManager>>,
    search: State<'_, Mutex<SearchIndex>>,
    graph: State<'_, Mutex<GraphEngine>>,
    ai: State<'_, Arc<AiPipeline>>,
    url: String,
) -> Result<serde_json::Value, String> {
    let cfg = store.get().clone();
    crate::wiki::ingest::run_url_import(&app, &cfg, &vault, &search, &graph, &ai, &url)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wiki_import_file(
    vault: State<'_, Mutex<VaultManager>>,
    src_path: String,
    target_dir: Option<String>,
) -> Result<String, String> {
    let mut vm = vault.lock().await;
    vm.import_file(&src_path, target_dir.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wiki_import_analyze(
    app: AppHandle,
    store: State<'_, ConfigStore>,
    vault: State<'_, Mutex<VaultManager>>,
    search: State<'_, Mutex<SearchIndex>>,
    graph: State<'_, Mutex<GraphEngine>>,
    ai: State<'_, Arc<AiPipeline>>,
    file_paths: Vec<String>,
    requirement: String,
) -> Result<ImportAnalyzeResult, String> {
    let cfg = store.get().clone();
    crate::wiki::ingest::run_import_analyze(&app, &cfg, &vault, &search, &graph, &ai, &file_paths, &requirement)
        .await
        .map_err(|e| e.to_string())
}

// === Analysis Tags ===

#[tauri::command]
pub async fn wiki_analysis_tags_list(
    vault: State<'_, Mutex<VaultManager>>,
) -> Result<Vec<AnalysisTag>, String> {
    let vm = vault.lock().await;
    vm.get_analysis_tags().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wiki_analysis_tags_add(
    vault: State<'_, Mutex<VaultManager>>,
    tags: Vec<AnalysisTag>,
) -> Result<Vec<AnalysisTag>, String> {
    let mut vm = vault.lock().await;
    vm.add_analysis_tags(&tags).map_err(|e| e.to_string())
}

// === Concept Confirm ===

#[tauri::command]
pub async fn wiki_concept_confirm(
    vault: State<'_, Mutex<VaultManager>>,
    search: State<'_, Mutex<SearchIndex>>,
    slug: String,
    area: String,
) -> Result<serde_json::Value, String> {
    let mut vm = vault.lock().await;
    vm.confirm_concept(&slug, &area)
        .map_err(|e| e.to_string())?;
    // Refresh index
    let rel_path = format!("wiki/{}/{}.md", area, slug);
    if let Ok(note) = vm.read_note(&rel_path) {
        let mut si = search.lock().await;
        si.index_note(&note);
    }
    Ok(serde_json::json!({"ok": true}))
}

// === Attachments ===

#[tauri::command]
pub async fn wiki_attachments_list(
    vault: State<'_, Mutex<VaultManager>>,
    sub_dir: Option<String>,
) -> Result<Vec<NoteMeta>, String> {
    let vm = vault.lock().await;
    vm.list_attachments(sub_dir.as_deref()).map_err(|e| e.to_string())
}

// === Annotations ===

#[tauri::command]
pub async fn wiki_annotations_add(
    vault: State<'_, Mutex<VaultManager>>,
    rel_path: String,
    text: String,
    range: String,
) -> Result<NoteAnnotation, String> {
    let mut vm = vault.lock().await;
    vm.add_annotation(&rel_path, &text, &range).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wiki_annotations_remove(
    vault: State<'_, Mutex<VaultManager>>,
    rel_path: String,
    annotation_id: String,
) -> Result<(), String> {
    let mut vm = vault.lock().await;
    vm.remove_annotation(&rel_path, &annotation_id).map_err(|e| e.to_string())
}

// === Helpers ===

pub fn flatten_notes(notes: &[NoteMeta]) -> Vec<NoteMeta> {
    let mut result = vec![];
    for n in notes {
        result.push(n.clone());
        if let Some(children) = &n.children {
            result.extend(flatten_notes(children));
        }
    }
    result
}

pub async fn rebuild_graph_inner(
    vault: &State<'_, Mutex<VaultManager>>,
    graph: &State<'_, Mutex<GraphEngine>>,
) -> Result<(), String> {
    let vm = vault.lock().await;
    let notes = vm.list_notes().map_err(|e| e.to_string())?;
    let flat = flatten_notes(&notes);

    let mut inputs = vec![];
    for n in &flat {
        if n.kind != "file" || !n.path.starts_with("wiki/") {
            continue;
        }
        if let Ok(content) = vm.read_note(&n.path) {
            if content.graph_excluded.unwrap_or(false) {
                continue;
            }
            inputs.push(crate::types::GraphInput {
                path: n.path.clone(),
                title: n.title.clone(),
                tags: n.tags.clone(),
                links: content.links,
            });
        }
    }

    let mut ge = graph.lock().await;
    ge.rebuild(&inputs);
    Ok(())
}
