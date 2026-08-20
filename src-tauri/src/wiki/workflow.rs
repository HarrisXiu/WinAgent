use crate::types::*;
use crate::config::ConfigStore;
use crate::wiki::VaultManager;
use crate::wiki::vault::{flatten_notes, split_frontmatter, extract_wikilinks};
use crate::wiki::SearchIndex;
use crate::llm::{OpenAIClient, ChatOptions, StreamCallbacks};
use tauri::{AppHandle, Emitter};
use sha2::{Sha256, Digest};

pub async fn run_lint(app: &AppHandle, vault: &VaultManager) -> Result<LintWorkflowResult, String> {
    let vault_path = vault.get_vault_path();
    let notes = vault.list_notes().map_err(|e| e.to_string())?;
    let flat = flatten_notes(&notes);

    let mut issues = vec![];
    let mut modified_raw_files = vec![];

    // Check 1: Broken wikilinks
    let all_slugs: std::collections::HashSet<String> = flat.iter()
        .filter(|n| n.kind == "file")
        .map(|n| n.path.trim_end_matches(".md").rsplit('/').next().unwrap_or("").to_string())
        .collect();

    for n in &flat {
        if n.kind != "file" { continue; }
        if let Ok(content) = vault.read_note(&n.path) {
            for link in &content.links {
                if !all_slugs.contains(link) && !flat.iter().any(|f| f.path == *link) {
                    issues.push(format!("[1-broken-link] {} → [[{}]] 链接目标不存在", n.path, link));
                }
            }
        }
    }

    // Check 2: Stub notes (< 100 chars)
    for n in &flat {
        if n.kind != "file" { continue; }
        if let Ok(content) = vault.read_note(&n.path) {
            if content.raw_body.len() < 100 {
                issues.push(format!("[2-stub] {} 正文过短（{} 字符）", n.path, content.raw_body.len()));
            }
        }
    }

    // Check 3: Missing tags
    for n in &flat {
        if n.kind != "file" { continue; }
        if n.tags.is_empty() && n.path.starts_with("wiki/") {
            issues.push(format!("[3-no-tags] {} 缺少标签", n.path));
        }
    }

    // Check 4: Missing AI summary
    for n in &flat {
        if n.kind != "file" || !n.path.starts_with("wiki/sources/") { continue; }
        if let Ok(content) = vault.read_note(&n.path) {
            if content.ai_summary.is_none() {
                issues.push(format!("[4-no-ai-summary] {} 缺少 AI 摘要", n.path));
            }
        }
    }

    // Check 5: Orphan notes (no backlinks)
    for n in &flat {
        if n.kind != "file" || !n.path.starts_with("wiki/") { continue; }
        let slug = n.path.trim_end_matches(".md").rsplit('/').next().unwrap_or("");
        let mut has_backlink = false;
        for other in &flat {
            if other.kind != "file" || other.path == n.path { continue; }
            if let Ok(content) = vault.read_note(&other.path) {
                if content.links.iter().any(|l| l == slug || l == &n.path) {
                    has_backlink = true;
                    break;
                }
            }
        }
        if !has_backlink && !n.path.starts_with("wiki/index") && !n.path.starts_with("wiki/log") {
            issues.push(format!("[5-orphan] {} 无反向链接", n.path));
        }
    }

    // Check 6: SHA-256 hash changed raw files
    let raw_files = vault.list_raw_files().map_err(|e| e.to_string())?;
    for raw in &raw_files {
        let full_path = std::path::Path::new(&vault_path).join(raw);
        if let Ok(content) = std::fs::read(&full_path) {
            let mut hasher = Sha256::new();
            hasher.update(&content);
            let hash = hasher.finalize();
            let hash_str = format!("{:x}", hash);

            // Check if source page exists and has stored hash
            let slug = raw.rsplit('/').next().unwrap_or(raw).trim_end_matches(".md")
                .trim_end_matches(".txt").trim_end_matches(".pdf");
            let source_path = format!("wiki/sources/{}.md", slug);
            if let Ok(source_content) = vault.read_note(&source_path) {
                let (fm, _) = split_frontmatter(&std::fs::read_to_string(
                    std::path::Path::new(&vault_path).join(&source_path)
                ).unwrap_or_default());
                if let Some(stored_hash) = fm.get("raw_hash").and_then(|v| v.as_str()) {
                    if stored_hash != hash_str {
                        issues.push(format!("[6-hash-changed] {} 哈希变化（需重新摄入）", raw));
                        modified_raw_files.push(raw.clone());
                    }
                }
            }
        }
    }

    // Check 7: Duplicate titles
    let mut title_map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for n in &flat {
        if n.kind != "file" { continue; }
        title_map.entry(n.title.clone()).or_default().push(n.path.clone());
    }
    for (title, paths) in &title_map {
        if paths.len() > 1 {
            issues.push(format!("[7-duplicate-title] 「{}」出现在 {} 个文件: {}", title, paths.len(), paths.join(", ")));
        }
    }

    // Check 8: Missing confidence on concepts
    for n in &flat {
        if n.kind != "file" || !n.path.starts_with("wiki/concepts/") { continue; }
        let full_path = std::path::Path::new(&vault_path).join(&n.path);
        let content = std::fs::read_to_string(&full_path).unwrap_or_default();
        let (fm, _) = split_frontmatter(&content);
        if fm.get("confidence").is_none() {
            issues.push(format!("[8-no-confidence] {} 概念页缺少 confidence 字段", n.path));
        }
    }

    // Check 9: Stale index (index.md references non-existent notes)
    let index_path = std::path::Path::new(&vault_path).join("wiki/index.md");
    if let Ok(index_content) = std::fs::read_to_string(&index_path) {
        let links = extract_wikilinks(&index_content);
        for link in &links {
            if !all_slugs.contains(link) {
                issues.push(format!("[9-stale-index] index.md 引用了不存在的 [[{}]]", link));
            }
        }
    }

    let summary = format!("LINT 完成: {} 个问题", issues.len());

    // Write report
    let report_path = "wiki/outputs/lint-report.md";
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M");
    let mut report = format!("# LINT 报告\n\n**时间**: {}\n**问题数**: {}\n\n", now, issues.len());
    for issue in &issues {
        report.push_str(&format!("- {}\n", issue));
    }
    if issues.is_empty() {
        report.push_str("✅ 知识库健康，未发现问题。\n");
    }

    let mut vm_mut = vault; // Read-only access; write report directly
    let full_report_path = std::path::Path::new(&vault_path).join(report_path);
    if let Some(parent) = full_report_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&full_report_path, &report);

    let _ = app.emit("wiki:vault:changed", &serde_json::json!({"type": "modify", "path": report_path}));

    Ok(LintWorkflowResult {
        ok: true,
        report_path: report_path.to_string(),
        summary,
        error: None,
        issues,
        modified_raw_files,
    })
}

pub async fn run_reflect(app: &AppHandle, vault: &VaultManager, cfg: &AppConfig) -> Result<WorkflowResult, String> {
    let provider = cfg.providers.iter()
        .find(|p| p.id == cfg.active_provider_id)
        .or(cfg.providers.first())
        .ok_or("没有可用的 AI 模型")?
        .clone();

    let notes = vault.list_notes().map_err(|e| e.to_string())?;
    let flat = flatten_notes(&notes);

    // Build a summary of all notes for the LLM
    let mut notes_summary = String::new();
    for n in &flat {
        if n.kind != "file" || !n.path.starts_with("wiki/") { continue; }
        if let Ok(content) = vault.read_note(&n.path) {
            let excerpt: String = content.raw_body.chars().take(200).collect();
            notes_summary.push_str(&format!("- {} ({}): {}\n", n.path, n.title, excerpt));
        }
    }

    let truncated: String = notes_summary.chars().take(8000).collect();

    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: MessageContent::Text("你是知识库分析助手。执行综合分析（REFLECT）：反向检验、模式扫描、Gap Analysis。输出 markdown 报告。".to_string()),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
            name: None,
        },
        ChatMessage {
            role: "user".to_string(),
            content: MessageContent::Text(format!("知识库笔记列表：\n\n{}\n\n请执行：\n1. 反向检验：核心概念是否有充分来源支撑\n2. 模式扫描：是否存在重复/矛盾\n3. Gap Analysis：哪些领域缺少覆盖", truncated)),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
            name: None,
        },
    ];

    let result = OpenAIClient::chat_stream(
        &provider,
        &messages,
        &ChatOptions {
            temperature: 0.4,
            max_tokens: 4096,
            tools: None,
            stream: false,
            thinking: "auto".to_string(),
        },
        &StreamCallbacks::default(),
    ).await?;

    let report_path = "wiki/outputs/reflect-report.md";
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M");
    let report = format!("# REFLECT 报告\n\n**时间**: {}\n\n{}", now, result.content);

    let full_path = std::path::Path::new(&vault.get_vault_path()).join(report_path);
    if let Some(parent) = full_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&full_path, &report);

    let _ = app.emit("wiki:vault:changed", &serde_json::json!({"type": "modify", "path": report_path}));

    Ok(WorkflowResult {
        ok: true,
        report_path: report_path.to_string(),
        summary: "REFLECT 分析完成".to_string(),
        error: None,
    })
}

pub async fn run_merge(app: &AppHandle, vault: &VaultManager, keep: &str, remove: &str, area: &str) -> Result<WorkflowResult, String> {
    let keep_path = format!("wiki/{}/{}.md", area, keep);
    let remove_path = format!("wiki/{}/{}.md", area, remove);

    let keep_content = vault.read_note(&keep_path).map_err(|e| e.to_string())?;
    let remove_content = vault.read_note(&remove_path).map_err(|e| e.to_string())?;

    // Merge: append remove content to keep, update backlinks
    let merged_body = format!("{}\n\n---\n\n## 合并自 [[{}]]\n\n{}", keep_content.raw_body, remove, remove_content.raw_body);

    let merged_tags: Vec<String> = {
        let mut tags: std::collections::HashSet<String> = keep_content.tags.into_iter().collect();
        for t in remove_content.tags { tags.insert(t); }
        tags.into_iter().collect()
    };

    // Write merged content
    let vault_path = vault.get_vault_path();
    let full_keep = std::path::Path::new(&vault_path).join(&keep_path);
    let (mut fm, _) = split_frontmatter(&std::fs::read_to_string(&full_keep).map_err(|e| e.to_string())?);
    fm.insert("tags".to_string(), serde_json::json!(merged_tags));
    let yaml = crate::wiki::vault::serialize_frontmatter(&fm);
    let new_content = format!("---\n{}\n---\n{}", yaml, merged_body);
    std::fs::write(&full_keep, new_content).map_err(|e| e.to_string())?;

    // Delete the removed page
    let full_remove = std::path::Path::new(&vault_path).join(&remove_path);
    let _ = std::fs::remove_file(&full_remove);

    // Update backlinks: replace [[remove]] with [[keep]] in all notes
    let notes = vault.list_notes().map_err(|e| e.to_string())?;
    let flat = flatten_notes(&notes);
    for n in &flat {
        if n.kind != "file" { continue; }
        let np = std::path::Path::new(&vault_path).join(&n.path);
        if let Ok(content) = std::fs::read_to_string(&np) {
            let new_content = content.replace(&format!("[[{}]]", remove), &format!("[[{}]]", keep));
            if new_content != content {
                let _ = std::fs::write(&np, new_content);
            }
        }
    }

    let report_path = "wiki/outputs/merge-report.md";
    let report = format!("# MERGE 报告\n\n合并: {} → {}\n删除: {}", remove_path, keep_path, remove_path);
    let full_report = std::path::Path::new(&vault_path).join(report_path);
    let _ = std::fs::write(&full_report, &report);

    let _ = app.emit("wiki:vault:changed", &serde_json::json!({"type": "merge", "keep": keep_path, "remove": remove_path}));

    Ok(WorkflowResult {
        ok: true,
        report_path: report_path.to_string(),
        summary: format!("已合并 {} → {}", remove, keep),
        error: None,
    })
}

pub async fn run_query(app: &AppHandle, vault: &VaultManager, search: &SearchIndex, cfg: &AppConfig, query: &str) -> Result<WorkflowResult, String> {
    // Search knowledge base
    let results = search.search(query, 10).map_err(|e| e.to_string())?;

    if results.is_empty() {
        return Ok(WorkflowResult {
            ok: false,
            report_path: "wiki/outputs/query-report.md".to_string(),
            summary: "未找到相关笔记".to_string(),
            error: Some("无搜索结果".to_string()),
        });
    }

    // Read top results
    let mut context = String::new();
    for (i, r) in results.iter().enumerate().take(5) {
        if let Ok(note) = vault.read_note(&r.path) {
            let excerpt: String = note.raw_body.chars().take(500).collect();
            context.push_str(&format!("### {} ({})\n{}\n\n", note.title, note.path, excerpt));
        }
        let _ = i;
    }

    // Generate answer using LLM
    let provider = cfg.providers.iter()
        .find(|p| p.id == cfg.active_provider_id)
        .or(cfg.providers.first())
        .ok_or("没有可用的 AI 模型")?
        .clone();

    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: MessageContent::Text("你是知识库查询助手。根据检索到的笔记内容回答用户问题。注明来源笔记路径。".to_string()),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
            name: None,
        },
        ChatMessage {
            role: "user".to_string(),
            content: MessageContent::Text(format!("问题: {}\n\n检索到的笔记:\n\n{}", query, context)),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
            name: None,
        },
    ];

    let result = OpenAIClient::chat_stream(
        &provider,
        &messages,
        &ChatOptions {
            temperature: 0.3,
            max_tokens: 2048,
            tools: None,
            stream: false,
            thinking: "auto".to_string(),
        },
        &StreamCallbacks::default(),
    ).await?;

    let report_path = "wiki/outputs/query-report.md";
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M");
    let report = format!("# QUERY 报告\n\n**时间**: {}\n**问题**: {}\n\n## 检索结果\n\n", now, query);
    let mut report = report;
    for r in &results {
        report.push_str(&format!("- [{}] {} (score: {:.2})\n", r.path, r.title, r.score));
    }
    report.push_str(&format!("\n## 回答\n\n{}", result.content));

    let full_path = std::path::Path::new(&vault.get_vault_path()).join(report_path);
    if let Some(parent) = full_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&full_path, &report);

    let _ = app.emit("wiki:vault:changed", &serde_json::json!({"type": "modify", "path": report_path}));

    Ok(WorkflowResult {
        ok: true,
        report_path: report_path.to_string(),
        summary: format!("查询完成，找到 {} 条相关笔记", results.len()),
        error: None,
    })
}
