use crate::types::*;
use crate::config::ConfigStore;
use crate::wiki::{VaultManager, SearchIndex, GraphEngine, AiPipeline};
use crate::wiki::contract;
use crate::wiki::vault::{flatten_notes, slugify, split_frontmatter, serialize_frontmatter, extract_wikilinks};
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter};
use sha2::{Sha256, Digest};

pub async fn run_ingest(
    app: &AppHandle,
    cfg: &AppConfig,
    vault: &Mutex<VaultManager>,
    search: &Mutex<SearchIndex>,
    graph: &Mutex<GraphEngine>,
    ai: &AiPipeline,
    raw_rel_path: &str,
) -> Result<IngestResult, String> {
    let provider = cfg.providers.iter()
        .find(|p| p.id == cfg.active_provider_id)
        .or(cfg.providers.first())
        .ok_or("没有可用的 AI 模型")?
        .clone();

    // Read raw file
    let vm = vault.lock().await;
    let full_path = std::path::Path::new(&vm.get_vault_path()).join(raw_rel_path);
    let file_name = full_path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let text_content = extract_text(&full_path)?;
    drop(vm);

    // Get existing concepts and entities
    let (existing_concepts, existing_entities) = {
        let vm = vault.lock().await;
        let notes = vm.list_notes().map_err(|e| e.to_string())?;
        let flat = flatten_notes(&notes);
        let concepts: Vec<(String, String)> = flat.iter()
            .filter(|n| n.kind == "file" && n.path.starts_with("wiki/concepts/"))
            .map(|n| {
                let slug = n.path.trim_end_matches(".md").rsplit('/').next().unwrap_or("").to_string();
                (slug, n.title.clone())
            })
            .collect();
        let entities: Vec<(String, String)> = flat.iter()
            .filter(|n| n.kind == "file" && n.path.starts_with("wiki/entities/"))
            .map(|n| {
                let slug = n.path.trim_end_matches(".md").rsplit('/').next().unwrap_or("").to_string();
                (slug, n.title.clone())
            })
            .collect();
        (concepts, entities)
    };

    let open_questions = {
        let vm = vault.lock().await;
        vm.get_open_questions().unwrap_or_default()
    };

    let contract_text = {
        let vm = vault.lock().await;
        contract::read_contract_sections(&vm.get_vault_path(), &["总则", "wikilink", "confidence"])
    }.unwrap_or_default();

    // Emit progress
    let _ = app.emit("wiki:ingest:progress", &IngestProgress {
        file: file_name.clone(),
        stage: "AI 分析中".to_string(),
        percent: 30,
        done: None,
        error: None,
    });

    // Run AI analysis
    let analysis = ai
        .ingest_source(&provider, &file_name, &text_content, &existing_concepts, &existing_entities, &open_questions, &contract_text)
        .await?;

    // Create source page
    let source_path = format!("wiki/sources/{}.md", analysis.slug);
    let source_content = build_source_page(&analysis, &text_content, raw_rel_path);

    let mut vm = vault.lock().await;
    let created = if !std::path::Path::new(&vm.get_vault_path()).join(&source_path).exists() {
        vm.write_note(&source_path, &NoteData {
            title: analysis.title.clone(),
            tags: vec![],
            body: source_content,
            ai_summary: Some(analysis.summary.clone()),
            ai_relations: None,
            ai_analyzed_at: Some(chrono::Utc::now().to_rfc3339()),
        })?;
        vec![source_path.clone()]
    } else {
        vm.write_note(&source_path, &NoteData {
            title: analysis.title.clone(),
            tags: vec![],
            body: source_content,
            ai_summary: Some(analysis.summary.clone()),
            ai_relations: None,
            ai_analyzed_at: Some(chrono::Utc::now().to_rfc3339()),
        })?;
        vec![]
    };

    // Create/update concept pages
    let mut concept_paths = vec![];
    for concept in &analysis.concepts {
        let slug = concept.match_slug.clone().unwrap_or_else(|| slugify(&concept.name));
        let path = format!("wiki/concepts/{}.md", slug);
        let exists = std::path::Path::new(&vm.get_vault_path()).join(&path).exists();

        let body = if exists {
            // Append source link to existing concept
            let content = vm.read_note(&path).map_err(|e| e.to_string())?;
            format!("{}\n\n- [[{}]] — {}", content.raw_body, analysis.slug, concept.definition)
        } else {
            format!("# {}\n\n{}\n\n## 来源\n- [[{}]] — {}", concept.name, concept.definition, analysis.slug, analysis.title)
        };

        vm.write_note(&path, &NoteData {
            title: concept.name.clone(),
            tags: vec![],
            body,
            ai_summary: None,
            ai_relations: None,
            ai_analyzed_at: None,
        })?;
        concept_paths.push(path);
    }

    // Create/update entity pages
    let mut entity_paths = vec![];
    for entity in &analysis.entities {
        let slug = entity.match_slug.clone().unwrap_or_else(|| slugify(&entity.name));
        let path = format!("wiki/entities/{}.md", slug);
        let exists = std::path::Path::new(&vm.get_vault_path()).join(&path).exists();

        let body = if exists {
            let content = vm.read_note(&path).map_err(|e| e.to_string())?;
            format!("{}\n\n- [[{}]] — {}", content.raw_body, analysis.slug, entity.description)
        } else {
            format!("# {}\n\n**类型**: {}\n\n{}\n\n## 来源\n- [[{}]] — {}", entity.name, entity.entity_type, entity.description, analysis.slug, analysis.title)
        };

        vm.write_note(&path, &NoteData {
            title: entity.name.clone(),
            tags: vec![],
            body,
            ai_summary: None,
            ai_relations: None,
            ai_analyzed_at: None,
        })?;
        entity_paths.push(path);
    }

    // Update index and log
    let log_entry = format!("INGEST | {} → wiki/sources/{}.md | concepts: {} | entities: {}",
        file_name, analysis.slug, analysis.concepts.len(), analysis.entities.len());
    vm.append_log(&log_entry)?;

    // Mark answered questions
    if let Some(answered) = &analysis.answered_questions {
        for q in answered {
            let _ = vm.answer_question(q);
        }
    }

    // Update search index
    if let Ok(note) = vm.read_note(&source_path) {
        let mut si = search.lock().await;
        si.index_note(&note);
    }

    drop(vm);

    // Rebuild graph
    {
        let notes = vault.lock().await.list_notes().map_err(|e| e.to_string())?;
        let flat = flatten_notes(&notes);
        let vm = vault.lock().await;
        let mut inputs = vec![];
        for n in &flat {
            if n.kind != "file" || !n.path.starts_with("wiki/") { continue; }
            if let Ok(content) = vm.read_note(&n.path) {
                if content.graph_excluded.unwrap_or(false) { continue; }
                inputs.push(GraphInput {
                    path: n.path.clone(),
                    title: n.title.clone(),
                    tags: n.tags.clone(),
                    links: content.links,
                });
            }
        }
        let mut ge = graph.lock().await;
        ge.rebuild(&inputs);
    }

    let _ = app.emit("wiki:ingest:progress", &IngestProgress {
        file: file_name,
        stage: "完成".to_string(),
        percent: 100,
        done: Some(true),
        error: None,
    });

    let _ = app.emit("wiki:vault:changed", &serde_json::json!({"type": "modify", "path": source_path}));

    Ok(IngestResult {
        source_path,
        concept_paths,
        entity_paths,
        created,
        updated: vec![],
        log_entry,
        confirm_high: None,
        answered_questions: analysis.answered_questions,
    })
}

pub async fn batch_start(
    app: &AppHandle,
    cfg: &AppConfig,
    vault: &Mutex<VaultManager>,
    search: &Mutex<SearchIndex>,
    graph: &Mutex<GraphEngine>,
    ai: &AiPipeline,
    paths: &[String],
) -> Result<BatchIngestStartResult, String> {
    if paths.is_empty() {
        return Err("没有文件需要摄入".to_string());
    }

    // Ingest first file
    let first = run_ingest(app, cfg, vault, search, graph, ai, &paths[0]).await?;

    Ok(BatchIngestStartResult {
        raw_file: paths[0].clone(),
        first,
        total: paths.len() as u32,
    })
}

pub async fn batch_continue(
    app: &AppHandle,
    cfg: &AppConfig,
    vault: &Mutex<VaultManager>,
    search: &Mutex<SearchIndex>,
    graph: &Mutex<GraphEngine>,
    ai: &AiPipeline,
) -> Result<BatchIngestDoneResult, String> {
    // Get pending raw files
    let raw_files: Vec<String> = {
        let vm = vault.lock().await;
        vm.list_raw_files().map_err(|e| e.to_string())?
    };

    // Filter to files without compiled source pages
    let mut pending = vec![];
    for raw in &raw_files {
        let slug = raw.rsplit('/').next().unwrap_or(raw).trim_end_matches(".md")
            .trim_end_matches(".txt").trim_end_matches(".pdf");
        let source_path = format!("wiki/sources/{}.md", slug);
        let vm = vault.lock().await;
        if !std::path::Path::new(&vm.get_vault_path()).join(&source_path).exists() {
            pending.push(raw.clone());
        }
    }

    let mut results = vec![];
    let mut errors = vec![];
    let mut all_confirm_high = vec![];

    for raw in &pending {
        let _ = app.emit("wiki:ingest:progress", &IngestProgress {
            file: raw.clone(),
            stage: "处理中".to_string(),
            percent: 0,
            done: None,
            error: None,
        });

        match run_ingest(app, cfg, vault, search, graph, ai, raw).await {
            Ok(result) => {
                if let Some(ch) = &result.confirm_high {
                    all_confirm_high.extend(ch.clone());
                }
                results.push(result);
            }
            Err(e) => {
                errors.push(BatchError { path: raw.clone(), error: e });
            }
        }
    }

    // Deduplicate confirm_high
    let mut seen = std::collections::HashSet::new();
    all_confirm_high.retain(|item| seen.insert(item.slug.clone()));

    Ok(BatchIngestDoneResult {
        results,
        errors,
        confirm_high: all_confirm_high,
    })
}

pub fn batch_abort(ai: &AiPipeline) {
    ai.cancel();
}

pub async fn run_url_import(
    app: &AppHandle,
    cfg: &AppConfig,
    vault: &Mutex<VaultManager>,
    search: &Mutex<SearchIndex>,
    graph: &Mutex<GraphEngine>,
    ai: &AiPipeline,
    url: &str,
) -> Result<serde_json::Value, String> {
    // Fetch URL content
    let client = reqwest::Client::new();
    let res = client.get(url).send().await.map_err(|e| format!("请求失败: {}", e))?;
    let html = res.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

    // Extract text from HTML (basic)
    let text = strip_html(&html);
    let title = extract_title(&html).unwrap_or_else(|| url.to_string());

    // Save to raw/clippings
    let slug = slugify(&title);
    let raw_path = format!("raw/clippings/{}.md", slug);
    let raw_content = format!("---\nsource: {}\ntitle: {}\ndate: {}\n---\n\n# {}\n\n{}", url, title, chrono::Utc::now().to_rfc3339(), title, text);

    {
        let mut vm = vault.lock().await;
        vm.write_note(&raw_path, &NoteData {
            title: title.clone(),
            tags: vec!["web-clip".to_string()],
            body: text,
            ai_summary: None,
            ai_relations: None,
            ai_analyzed_at: None,
        })?;
    }

    // Run ingest
    let result = run_ingest(app, cfg, vault, search, graph, ai, &raw_path).await?;

    Ok(serde_json::json!({
        "rawPath": raw_path,
        "result": result,
    }))
}

pub async fn run_import_analyze(
    app: &AppHandle,
    cfg: &AppConfig,
    vault: &Mutex<VaultManager>,
    search: &Mutex<SearchIndex>,
    graph: &Mutex<GraphEngine>,
    ai: &AiPipeline,
    file_paths: &[String],
    requirement: &str,
) -> Result<ImportAnalyzeResult, String> {
    let provider = cfg.providers.iter()
        .find(|p| p.id == cfg.active_provider_id)
        .or(cfg.providers.first())
        .ok_or("没有可用的 AI 模型")?
        .clone();

    let existing_tags = {
        let vm = vault.lock().await;
        vm.get_analysis_tags().unwrap_or_default()
    };

    let mut files = vec![];
    let mut all_new_tags = vec![];
    let mut all_confirm_high = vec![];

    for file_path in file_paths {
        let path = std::path::Path::new(file_path);
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();

        // Import file to raw
        let raw_rel = {
            let mut vm = vault.lock().await;
            vm.import_file(file_path, Some("raw/articles")).map_err(|e| e.to_string())?
        };

        // Run ingest
        let ingest_result = match run_ingest(app, cfg, vault, search, graph, ai, &raw_rel).await {
            Ok(r) => r,
            Err(e) => {
                files.push(ImportAnalyzeFileResult {
                    name: name.clone(),
                    rel_path: Some(raw_rel.clone()),
                    source_path: None,
                    ingest_error: Some(e),
                    analysis_error: None,
                    analysis: None,
                });
                continue;
            }
        };

        // Run custom analysis
        let text = {
            let full = std::path::Path::new(file_path);
            extract_text(full).unwrap_or_default()
        };

        let analysis = ai
            .custom_analyze(&provider, &name, &text, requirement, &existing_tags)
            .await;

        match analysis {
            Ok(output) => {
                // Append custom analysis to source page
                {
                    let mut vm = vault.lock().await;
                    let _ = vm.append_custom_analysis(&ingest_result.source_path, requirement, &output.report);
                }

                // Collect new tags
                for tag in &output.analysis_tags {
                    if !all_new_tags.iter().any(|t: &AnalysisTag| t.tag == tag.tag) {
                        all_new_tags.push(tag.clone());
                    }
                }

                if let Some(ch) = &ingest_result.confirm_high {
                    all_confirm_high.extend(ch.clone());
                }

                files.push(ImportAnalyzeFileResult {
                    name,
                    rel_path: Some(raw_rel),
                    source_path: Some(ingest_result.source_path),
                    ingest_error: None,
                    analysis_error: None,
                    analysis: Some(output),
                });
            }
            Err(e) => {
                files.push(ImportAnalyzeFileResult {
                    name,
                    rel_path: None,
                    source_path: Some(ingest_result.source_path),
                    ingest_error: None,
                    analysis_error: Some(e),
                    analysis: None,
                });
            }
        }
    }

    // Save new tags
    if !all_new_tags.is_empty() {
        let mut vm = vault.lock().await;
        let _ = vm.add_analysis_tags(&all_new_tags);
    }

    // Deduplicate confirm_high
    let mut seen = std::collections::HashSet::new();
    all_confirm_high.retain(|item| seen.insert(item.slug.clone()));

    Ok(ImportAnalyzeResult {
        files,
        new_tags: all_new_tags,
        confirm_high: all_confirm_high,
    })
}

fn build_source_page(analysis: &IngestAnalysis, raw_text: &str, raw_rel_path: &str) -> String {
    let mut content = format!("# {}\n\n", analysis.title);
    content.push_str(&format!("> **摘要**: {}\n\n", analysis.summary));
    content.push_str(&format!("**来源文件**: [[{}]]\n\n", raw_rel_path));

    content.push_str("## 核心要点\n\n");
    for point in &analysis.key_points {
        content.push_str(&format!("- {}\n", point));
    }

    if !analysis.concepts.is_empty() {
        content.push_str("\n## 涉及概念\n\n");
        for concept in &analysis.concepts {
            let slug = concept.match_slug.clone().unwrap_or_else(|| slugify(&concept.name));
            content.push_str(&format!("- [[{}]] — {}\n", slug, concept.definition));
        }
    }

    if !analysis.entities.is_empty() {
        content.push_str("\n## 涉及实体\n\n");
        for entity in &analysis.entities {
            let slug = entity.match_slug.clone().unwrap_or_else(|| slugify(&entity.name));
            content.push_str(&format!("- [[{}]] — {} ({})\n", slug, entity.description, entity.entity_type));
        }
    }

    if let Some(contradictions) = &analysis.contradictions {
        if !contradictions.is_empty() {
            content.push_str("\n## 分歧\n\n");
            for c in contradictions {
                content.push_str(&format!("- {}\n", c));
            }
        }
    }

    if let Some(answered) = &analysis.answered_questions {
        if !answered.is_empty() {
            content.push_str("\n## 回答的开放问题\n\n");
            for q in answered {
                content.push_str(&format!("- ✓ {}\n", q));
            }
        }
    }

    // Include raw text excerpt
    let excerpt: String = raw_text.chars().take(2000).collect();
    content.push_str(&format!("\n\n---\n\n## 原文摘录\n\n{}\n", excerpt));

    content
}

fn extract_text(path: &std::path::Path) -> Result<String, String> {
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).unwrap_or_default();

    match ext.as_str() {
        "md" | "txt" | "markdown" => {
            std::fs::read_to_string(path).map_err(|e| e.to_string())
        }
        "pdf" => {
            // Try pdf-extract
            let data = std::fs::read(path).map_err(|e| e.to_string())?;
            pdf_extract::extract_text_from_mem(&data).map_err(|e| e.to_string())
        }
        "docx" => {
            extract_docx_text(path)
        }
        "xlsx" => {
            extract_xlsx_text(path)
        }
        _ => {
            // Try reading as text
            std::fs::read_to_string(path).or_else(|_| {
                let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
                Ok(String::from_utf8_lossy(&bytes).to_string())
            })
        }
    }
}

fn extract_docx_text(path: &std::path::Path) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    let mut document = archive.by_name("word/document.xml").map_err(|e| e.to_string())?;
    let mut content = String::new();
    use std::io::Read;
    let mut xml = String::new();
    document.read_to_string(&mut xml).map_err(|e| e.to_string())?;

    // Extract text from XML (strip tags)
    let re = regex::Regex::new(r"<[^>]+>").unwrap();
    let text = re.replace_all(&xml, " ");
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    content.push_str(&text);

    Ok(content)
}

fn extract_xlsx_text(path: &std::path::Path) -> Result<String, String> {
    use calamine::Reader;
    let mut workbook: calamine::Sheets<_> =
        calamine::open_workbook_auto(path).map_err(|e| e.to_string())?;

    let mut content = String::new();
    for sheet_name in workbook.sheet_names().clone() {
        content.push_str(&format!("## {}\n\n", sheet_name));
        if let Ok(range) = workbook.worksheet_range(&sheet_name) {
            for row in range.rows() {
                let cells: Vec<String> = row.iter().map(|c| {
                    let s = format!("{}", c);
                    if s.is_empty() { String::new() } else { s }
                }).collect();
                content.push_str(&format!("| {} |\n", cells.join(" | ")));
            }
        }
        content.push('\n');
    }

    Ok(content)
}

fn strip_html(html: &str) -> String {
    // Remove script and style blocks
    let re_script = regex::Regex::new(r"(?s)<script[^>]*>.*?</script>").unwrap();
    let re_style = regex::Regex::new(r"(?s)<style[^>]*>.*?</style>").unwrap();
    let re_tag = regex::Regex::new(r"<[^>]+>").unwrap();

    let no_script = re_script.replace_all(html, "");
    let no_style = re_style.replace_all(&no_script, "");
    let no_tags = re_tag.replace_all(&no_style, " ");
    let decoded = no_tags
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");

    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn extract_title(html: &str) -> Option<String> {
    let re = regex::Regex::new(r"(?s)<title>(.*?)</title>").unwrap();
    re.captures(html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
}
