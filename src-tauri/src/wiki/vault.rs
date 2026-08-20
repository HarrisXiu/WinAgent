use crate::types::*;
use std::path::{Path, PathBuf};
use std::collections::{HashMap, HashSet};

pub struct VaultManager {
    vault_path: PathBuf,
}

impl VaultManager {
    pub fn new(cfg: &AppConfig, data_dir: &Path) -> Self {
        let vault_path = if cfg.vault_path.is_empty() {
            data_dir.join("wiki")
        } else {
            let p = PathBuf::from(&cfg.vault_path);
            if p.is_absolute() { p } else { data_dir.join(&cfg.vault_path) }
        };
        Self { vault_path }
    }

    pub fn get_vault_path(&self) -> String {
        self.vault_path.to_string_lossy().to_string()
    }

    pub fn set_vault_path(&mut self, p: &str) -> Result<(), String> {
        self.vault_path = PathBuf::from(p);
        self.initialize()
    }

    pub fn initialize(&mut self) -> Result<(), String> {
        // Create directory structure
        for dir in &["raw/articles", "raw/clippings", "raw/images", "raw/pdfs", "raw/notes", "raw/personal",
                     "wiki/sources", "wiki/concepts", "wiki/entities", "wiki/outputs"] {
            std::fs::create_dir_all(self.vault_path.join(dir)).map_err(|e| e.to_string())?;
        }
        // Create system files if they don't exist
        let index_path = self.vault_path.join("wiki/index.md");
        if !index_path.exists() {
            std::fs::write(&index_path, "# 知识库索引\n\n").map_err(|e| e.to_string())?;
        }
        let log_path = self.vault_path.join("wiki/log.md");
        if !log_path.exists() {
            std::fs::write(&log_path, "# 操作日志\n\n").map_err(|e| e.to_string())?;
        }
        let overview_path = self.vault_path.join("wiki/overview.md");
        if !overview_path.exists() {
            std::fs::write(&overview_path, "# 知识库概览\n\n").map_err(|e| e.to_string())?;
        }
        let questions_path = self.vault_path.join("wiki/QUESTIONS.md");
        if !questions_path.exists() {
            std::fs::write(&questions_path, "# 开放问题\n\n").map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn list_notes(&self) -> Result<Vec<NoteMeta>, String> {
        self.scan_dir(&self.vault_path, "")
    }

    fn scan_dir(&self, base: &Path, rel: &str) -> Result<Vec<NoteMeta>, String> {
        let dir = if rel.is_empty() { base.to_path_buf() } else { base.join(rel) };
        if !dir.exists() {
            return Ok(vec![]);
        }
        let mut entries = vec![];
        let mut items: Vec<_> = std::fs::read_dir(&dir).map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .collect();
        items.sort_by_key(|e| e.file_name());

        for entry in items {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') { continue; }
            let entry_rel = if rel.is_empty() { name.clone() } else { format!("{}/{}", rel, name) };
            let file_type = entry.file_type().map_err(|e| e.to_string())?;

            if file_type.is_dir() {
                let children = self.scan_dir(base, &entry_rel)?;
                let child_count = children.len();
                entries.push(NoteMeta {
                    path: entry_rel,
                    title: name,
                    tags: vec![],
                    created: String::new(),
                    updated: String::new(),
                    kind: "folder".to_string(),
                    children: Some(children),
                });
                let _ = child_count;
            } else if name.ends_with(".md") {
                let full_path = base.join(&entry_rel);
                let (title, tags, created, updated) = self.parse_frontmatter(&full_path);
                entries.push(NoteMeta {
                    path: entry_rel,
                    title,
                    tags,
                    created,
                    updated,
                    kind: "file".to_string(),
                    children: None,
                });
            }
        }
        Ok(entries)
    }

    fn parse_frontmatter(&self, path: &Path) -> (String, Vec<String>, String, String) {
        let content = std::fs::read_to_string(path).unwrap_or_default();
        let (fm, _body) = split_frontmatter(&content);

        let title = fm.get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
            });

        let tags = fm.get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|t| t.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        let created = fm.get("created")
            .or_else(|| fm.get("date"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let updated = fm.get("updated")
            .or_else(|| fm.get("date"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        (title, tags, created, updated)
    }

    pub fn read_note(&self, rel_path: &str) -> Result<NoteContent, String> {
        let full_path = self.vault_path.join(rel_path);
        let content = std::fs::read_to_string(&full_path).map_err(|e| e.to_string())?;

        let (fm, body) = split_frontmatter(&content);

        let title = fm.get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                Path::new(rel_path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
            });

        let tags = fm.get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|t| t.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        let created = fm.get("created").or_else(|| fm.get("date"))
            .and_then(|v| v.as_str()).unwrap_or("").to_string();
        let updated = fm.get("updated").or_else(|| fm.get("date"))
            .and_then(|v| v.as_str()).unwrap_or("").to_string();

        let links = extract_wikilinks(&body);
        let ai_summary = fm.get("ai_summary").and_then(|v| v.as_str()).map(|s| s.to_string());
        let ai_analyzed_at = fm.get("ai_analyzed_at").and_then(|v| v.as_str()).map(|s| s.to_string());
        let ai_relations = fm.get("ai_relations").and_then(|v| v.as_array()).map(|arr| {
            arr.iter().filter_map(|r| serde_json::from_value(r.clone()).ok()).collect()
        });
        let graph_excluded = fm.get("graph_excluded").and_then(|v| v.as_bool());
        let raw_file = fm.get("raw_file").and_then(|v| v.as_str()).map(|s| s.to_string());

        let annotations = fm.get("annotations").and_then(|v| v.as_array()).map(|arr| {
            arr.iter().filter_map(|a| serde_json::from_value(a.clone()).ok()).collect()
        });

        Ok(NoteContent {
            path: rel_path.to_string(),
            title,
            tags,
            created,
            updated,
            kind: "file".to_string(),
            children: None,
            raw_body: body,
            links,
            ai_summary,
            ai_analyzed_at,
            ai_relations,
            annotations,
            graph_excluded,
            raw_file,
        })
    }

    pub fn write_note(&mut self, rel_path: &str, data: &NoteData) -> Result<(), String> {
        let full_path = self.vault_path.join(rel_path);
        if let Some(parent) = full_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let existing = std::fs::read_to_string(&full_path).ok();
        let (existing_fm, _) = existing.map(|c| split_frontmatter(&c)).unwrap_or((serde_json::Map::new(), String::new()));

        let now = chrono::Utc::now().to_rfc3339();

        let mut fm = serde_json::Map::new();
        fm.insert("title".to_string(), serde_json::Value::String(data.title.clone()));
        fm.insert("tags".to_string(), serde_json::json!(data.tags));
        fm.insert("updated".to_string(), serde_json::Value::String(now.clone()));

        // Preserve created date from existing or set new
        if let Some(created) = existing_fm.get("created").or_else(|| existing_fm.get("date")) {
            fm.insert("created".to_string(), created.clone());
        } else {
            fm.insert("created".to_string(), serde_json::Value::String(now));
        }

        // Preserve other fields from existing frontmatter
        for (k, v) in &existing_fm {
            if k != "title" && k != "tags" && k != "updated" && k != "body" {
                if !fm.contains_key(k) {
                    fm.insert(k.clone(), v.clone());
                }
            }
        }

        // AI fields
        if let Some(summary) = &data.ai_summary {
            fm.insert("ai_summary".to_string(), serde_json::Value::String(summary.clone()));
        } else if let Some(s) = existing_fm.get("ai_summary") {
            fm.insert("ai_summary".to_string(), s.clone());
        }

        if let Some(relations) = &data.ai_relations {
            fm.insert("ai_relations".to_string(), serde_json::to_value(relations).unwrap_or(serde_json::Value::Null));
        } else if let Some(r) = existing_fm.get("ai_relations") {
            fm.insert("ai_relations".to_string(), r.clone());
        }

        if let Some(analyzed_at) = &data.ai_analyzed_at {
            fm.insert("ai_analyzed_at".to_string(), serde_json::Value::String(analyzed_at.clone()));
        } else if let Some(a) = existing_fm.get("ai_analyzed_at") {
            fm.insert("ai_analyzed_at".to_string(), a.clone());
        }

        let yaml = serialize_frontmatter(&fm);
        let content = format!("---\n{}\n---\n{}", yaml, data.body);
        std::fs::write(&full_path, content).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_note(&mut self, rel_path: &str) -> Result<(), String> {
        let full_path = self.vault_path.join(rel_path);
        std::fs::remove_file(&full_path).map_err(|e| e.to_string())
    }

    pub fn create_note(&mut self, rel_path: &str, title: &str) -> Result<(), String> {
        let full_path = self.vault_path.join(rel_path);
        if full_path.exists() {
            return Err("文件已存在".to_string());
        }
        if let Some(parent) = full_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let now = chrono::Utc::now().to_rfc3339();
        let content = format!(
            "---\ntitle: {}\ntags: []\ncreated: {}\nupdated: {}\n---\n# {}\n\n",
            title, now, now, title
        );
        std::fs::write(&full_path, content).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn is_system_file(&self, rel_path: &str) -> bool {
        let system_files = ["wiki/index.md", "wiki/log.md", "wiki/overview.md", "wiki/QUESTIONS.md", "wiki/ANALYSIS_TAGS.md"];
        system_files.iter().any(|f| f == &rel_path)
    }

    pub fn get_backlinks(&self, target_path: &str) -> Result<Vec<NoteMeta>, String> {
        let target_slug = Path::new(target_path).file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let all_notes = self.list_notes()?;
        let flat = flatten_notes(&all_notes);
        let mut backlinks = vec![];
        for n in &flat {
            if n.kind != "file" || n.path == target_path { continue; }
            if let Ok(content) = self.read_note(&n.path) {
                if content.links.iter().any(|l| l == target_slug || l == target_path) {
                    backlinks.push(n.clone());
                }
            }
        }
        Ok(backlinks)
    }

    pub fn get_all_tags(&self) -> Result<Vec<TagWithCount>, String> {
        let all_notes = self.list_notes()?;
        let flat = flatten_notes(&all_notes);
        let mut tag_counts: HashMap<String, u32> = HashMap::new();
        for n in &flat {
            if n.kind != "file" { continue; }
            for tag in &n.tags {
                *tag_counts.entry(tag.clone()).or_insert(0) += 1;
            }
        }
        let mut tags: Vec<TagWithCount> = tag_counts.into_iter()
            .map(|(tag, count)| TagWithCount { tag, count })
            .collect();
        tags.sort_by(|a, b| b.count.cmp(&a.count));
        Ok(tags)
    }

    pub fn get_notes_by_tag(&self, tag: &str) -> Result<Vec<NoteMeta>, String> {
        let all_notes = self.list_notes()?;
        let flat = flatten_notes(&all_notes);
        Ok(flat.into_iter().filter(|n| n.kind == "file" && n.tags.iter().any(|t| t == tag)).collect())
    }

    pub fn get_open_questions(&self) -> Result<Vec<String>, String> {
        let path = self.vault_path.join("wiki/QUESTIONS.md");
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        let questions: Vec<String> = content.lines()
            .filter_map(|line| {
                let trimmed = line.trim();
                if trimmed.starts_with("- ") {
                    Some(trimmed[2..].to_string())
                } else {
                    None
                }
            })
            .collect();
        Ok(questions)
    }

    pub fn append_log(&mut self, entry: &str) -> Result<(), String> {
        let path = self.vault_path.join("wiki/log.md");
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M");
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        let new_content = format!("{}- [{}] {}\n", content, now, entry);
        std::fs::write(&path, new_content).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_index(&mut self, sources: &[(String, String)], concepts: &[(String, String)], entities: &[(String, String)]) -> Result<(), String> {
        let path = self.vault_path.join("wiki/index.md");
        let mut content = String::from("# 知识库索引\n\n");
        content.push_str(&format!("## 来源（{}）\n\n", sources.len()));
        for (slug, title) in sources {
            content.push_str(&format!("- [[{}]] — {}\n", slug, title));
        }
        content.push_str(&format!("\n## 概念（{}）\n\n", concepts.len()));
        for (slug, title) in concepts {
            content.push_str(&format!("- [[{}]] — {}\n", slug, title));
        }
        content.push_str(&format!("\n## 实体（{}）\n\n", entities.len()));
        for (slug, title) in entities {
            content.push_str(&format!("- [[{}]] — {}\n", slug, title));
        }
        std::fs::write(&path, content).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_overview(&mut self, stats: &[(String, String)]) -> Result<(), String> {
        let path = self.vault_path.join("wiki/overview.md");
        let mut content = String::from("# 知识库概览\n\n");
        for (key, value) in stats {
            content.push_str(&format!("- **{}**: {}\n", key, value));
        }
        std::fs::write(&path, content).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_ai_results(&mut self, rel_path: &str, summary: Option<&str>, tags: Option<&Vec<String>>, relations: Option<&Vec<NoteRelation>>) -> Result<(), String> {
        let full_path = self.vault_path.join(rel_path);
        let content = std::fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
        let (mut fm, body) = split_frontmatter(&content);

        if let Some(s) = summary {
            fm.insert("ai_summary".to_string(), serde_json::Value::String(s.to_string()));
        }
        if let Some(t) = tags {
            // Merge tags
            let existing_tags: Vec<String> = fm.get("tags")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|t| t.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let mut merged: HashSet<String> = existing_tags.into_iter().collect();
            for tag in t {
                merged.insert(tag.clone());
            }
            let merged_vec: Vec<serde_json::Value> = merged.into_iter().map(serde_json::Value::String).collect();
            fm.insert("tags".to_string(), serde_json::Value::Array(merged_vec));
        }
        if let Some(r) = relations {
            fm.insert("ai_relations".to_string(), serde_json::to_value(r).unwrap_or(serde_json::Value::Null));
        }
        fm.insert("ai_analyzed_at".to_string(), serde_json::Value::String(chrono::Utc::now().to_rfc3339()));

        let yaml = serialize_frontmatter(&fm);
        let new_content = format!("---\n{}\n---\n{}", yaml, body);
        std::fs::write(&full_path, new_content).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn import_file(&mut self, src_path: &str, target_dir: Option<&str>) -> Result<String, String> {
        let src = Path::new(src_path);
        let name = src.file_name().ok_or("Invalid file name")?.to_string_lossy().to_string();

        // Determine target directory
        let target = target_dir.unwrap_or("raw/articles");
        let target_full = self.vault_path.join(target);
        std::fs::create_dir_all(&target_full).map_err(|e| e.to_string())?;

        let dest = target_full.join(&name);
        std::fs::copy(src, &dest).map_err(|e| e.to_string())?;

        Ok(format!("{}/{}", target, name))
    }

    pub fn list_raw_files(&self) -> Result<Vec<String>, String> {
        let raw_dir = self.vault_path.join("raw");
        if !raw_dir.exists() {
            return Ok(vec![]);
        }
        let mut files = vec![];
        for entry in walkdir::WalkDir::new(&raw_dir).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                let rel = entry.path().strip_prefix(&self.vault_path).unwrap_or(entry.path());
                files.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
        Ok(files)
    }

    pub fn get_analysis_tags(&self) -> Result<Vec<AnalysisTag>, String> {
        let path = self.vault_path.join("wiki/ANALYSIS_TAGS.md");
        if !path.exists() {
            return Ok(vec![]);
        }
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        let (fm, _) = split_frontmatter(&content);
        let tags = fm.get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|t| serde_json::from_value(t.clone()).ok()).collect())
            .unwrap_or_default();
        Ok(tags)
    }

    pub fn add_analysis_tags(&mut self, new_tags: &[AnalysisTag]) -> Result<Vec<AnalysisTag>, String> {
        let path = self.vault_path.join("wiki/ANALYSIS_TAGS.md");
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        let (mut fm, body) = split_frontmatter(&content);

        let mut existing: Vec<AnalysisTag> = fm.get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|t| serde_json::from_value(t.clone()).ok()).collect())
            .unwrap_or_default();

        let existing_tags: HashSet<String> = existing.iter().map(|t| t.tag.clone()).collect();
        for t in new_tags {
            if !existing_tags.contains(&t.tag) {
                existing.push(t.clone());
            }
        }

        fm.insert("tags".to_string(), serde_json::to_value(&existing).unwrap_or(serde_json::Value::Null));
        let yaml = serialize_frontmatter(&fm);
        let new_content = format!("---\n{}\n---\n{}", yaml, body);
        std::fs::write(&path, new_content).map_err(|e| e.to_string())?;
        Ok(existing)
    }

    pub fn append_custom_analysis(&mut self, rel_path: &str, requirement: &str, report: &str) -> Result<(), String> {
        let full_path = self.vault_path.join(rel_path);
        let content = std::fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
        let (fm, body) = split_frontmatter(&content);
        let yaml = serialize_frontmatter(&fm);
        let section = format!("\n\n## Custom Analysis\n\n> 分析要求: {}\n\n{}\n", requirement, report);
        let new_content = format!("---\n{}\n---\n{}{}", yaml, body, section);
        std::fs::write(&full_path, new_content).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn answer_question(&mut self, question: &str) -> Result<(), String> {
        let path = self.vault_path.join("wiki/QUESTIONS.md");
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        // Mark question as answered by prefixing with ✓
        let new_content = content.replace(&format!("- {}", question), &format!("- ✓ ~~{}~~ (已解答)", question));
        std::fs::write(&path, new_content).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn confirm_concept(&mut self, slug: &str, area: &str) -> Result<(), String> {
        let rel_path = format!("wiki/{}/{}.md", area, slug);
        let full_path = self.vault_path.join(&rel_path);
        let content = std::fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
        let (mut fm, body) = split_frontmatter(&content);
        fm.insert("confidence".to_string(), serde_json::Value::String("high".to_string()));
        fm.insert("last_reviewed".to_string(), serde_json::Value::String(chrono::Utc::now().format("%Y-%m-%d").to_string()));
        let yaml = serialize_frontmatter(&fm);
        let new_content = format!("---\n{}\n---\n{}", yaml, body);
        std::fs::write(&full_path, new_content).map_err(|e| e.to_string())?;
        self.append_log(&format!("confidence | {}/{} 已确认为 high（用户背书）", area, slug))?;
        Ok(())
    }

    pub fn list_attachments(&self, sub_dir: Option<&str>) -> Result<Vec<NoteMeta>, String> {
        let base = self.vault_path.join("raw");
        let dir = sub_dir.map(|s| base.join(s)).unwrap_or(base);
        if !dir.exists() {
            return Ok(vec![]);
        }
        let mut entries = vec![];
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') { continue; }
            let file_type = entry.file_type().map_err(|e| e.to_string())?;
            let rel = if let Some(sd) = sub_dir {
                format!("raw/{}/{}", sd, name)
            } else {
                format!("raw/{}", name)
            };
            entries.push(NoteMeta {
                path: rel,
                title: name,
                tags: vec![],
                created: String::new(),
                updated: String::new(),
                kind: if file_type.is_dir() { "folder".to_string() } else { "file".to_string() },
                children: None,
            });
        }
        Ok(entries)
    }

    pub fn add_annotation(&mut self, rel_path: &str, text: &str, range: &str) -> Result<NoteAnnotation, String> {
        let full_path = self.vault_path.join(rel_path);
        let content = std::fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
        let (mut fm, body) = split_frontmatter(&content);

        let mut annotations: Vec<NoteAnnotation> = fm.get("annotations")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|a| serde_json::from_value(a.clone()).ok()).collect())
            .unwrap_or_default();

        let annotation = NoteAnnotation {
            id: format!("ann_{}", uuid::Uuid::new_v4()),
            text: text.to_string(),
            range: range.to_string(),
            created: chrono::Utc::now().to_rfc3339(),
        };
        annotations.push(annotation.clone());

        fm.insert("annotations".to_string(), serde_json::to_value(&annotations).unwrap_or(serde_json::Value::Null));
        let yaml = serialize_frontmatter(&fm);
        let new_content = format!("---\n{}\n---\n{}", yaml, body);
        std::fs::write(&full_path, new_content).map_err(|e| e.to_string())?;
        Ok(annotation)
    }

    pub fn remove_annotation(&mut self, rel_path: &str, annotation_id: &str) -> Result<(), String> {
        let full_path = self.vault_path.join(rel_path);
        let content = std::fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
        let (mut fm, body) = split_frontmatter(&content);

        let mut annotations: Vec<NoteAnnotation> = fm.get("annotations")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|a| serde_json::from_value(a.clone()).ok()).collect())
            .unwrap_or_default();

        annotations.retain(|a| a.id != annotation_id);

        fm.insert("annotations".to_string(), serde_json::to_value(&annotations).unwrap_or(serde_json::Value::Null));
        let yaml = serialize_frontmatter(&fm);
        let new_content = format!("---\n{}\n---\n{}", yaml, body);
        std::fs::write(&full_path, new_content).map_err(|e| e.to_string())?;
        Ok(())
    }
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

pub fn split_frontmatter(content: &str) -> (serde_json::Map<String, serde_json::Value>, String) {
    if !content.starts_with("---\n") && !content.starts_with("---\r\n") {
        return (serde_json::Map::new(), content.to_string());
    }
    let after_first = &content[4..];
    let end = after_first.find("\n---\n").or_else(|| after_first.find("\n---\r\n"));
    if let Some(end_pos) = end {
        let yaml = &after_first[..end_pos];
        let body_start = end_pos + 5; // "\n---\n" = 5 chars
        let body = after_first[body_start..].trim_start_matches('\r').trim_start_matches('\n');
        let fm = parse_yaml_frontmatter(yaml);
        (fm, body.to_string())
    } else {
        (serde_json::Map::new(), content.to_string())
    }
}

pub fn serialize_frontmatter(fm: &serde_json::Map<String, serde_json::Value>) -> String {
    let mut result = String::new();
    for (key, value) in fm {
        match value {
            serde_json::Value::String(s) => {
                result.push_str(&format!("{}: {}\n", key, escape_yaml_string(s)));
            }
            serde_json::Value::Array(arr) => {
                if arr.is_empty() {
                    result.push_str(&format!("{}: []\n", key));
                } else {
                    result.push_str(&format!("{}:\n", key));
                    for item in arr {
                        match item {
                            serde_json::Value::String(s) => {
                                result.push_str(&format!("  - {}\n", escape_yaml_string(s)));
                            }
                            serde_json::Value::Object(obj) => {
                                result.push_str("  - ");
                                let mut first = true;
                                for (k, v) in obj {
                                    if !first { result.push_str("    "); }
                                    first = false;
                                    match v {
                                        serde_json::Value::String(s) => {
                                            result.push_str(&format!("{}: {}\n", k, escape_yaml_string(s)));
                                        }
                                        _ => {
                                            result.push_str(&format!("{}: {}\n", k, v));
                                        }
                                    }
                                }
                            }
                            _ => {
                                result.push_str(&format!("  - {}\n", item));
                            }
                        }
                    }
                }
            }
            serde_json::Value::Bool(b) => {
                result.push_str(&format!("{}: {}\n", key, b));
            }
            serde_json::Value::Number(n) => {
                result.push_str(&format!("{}: {}\n", key, n));
            }
            serde_json::Value::Null => {
                result.push_str(&format!("{}: null\n", key));
            }
            serde_json::Value::Object(obj) => {
                result.push_str(&format!("{}:\n", key));
                for (k, v) in obj {
                    match v {
                        serde_json::Value::String(s) => {
                            result.push_str(&format!("  {}: {}\n", k, escape_yaml_string(s)));
                        }
                        _ => {
                            result.push_str(&format!("  {}: {}\n", k, v));
                        }
                    }
                }
            }
        }
    }
    result.trim_end().to_string()
}

fn escape_yaml_string(s: &str) -> String {
    if s.contains(':') || s.contains('#') || s.contains('{') || s.contains('}') || s.contains('[') || s.contains(']') || s.contains(',') || s.contains('&') || s.contains('*') || s.contains('?') || s.contains('|') || s.contains('>') || s.contains('!') || s.contains('%') || s.contains('@') || s.contains('`') || s.contains('"') || s.contains('\'') {
        format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
    } else if s.is_empty() {
        "\"\"".to_string()
    } else {
        s.to_string()
    }
}

fn parse_yaml_frontmatter(yaml: &str) -> serde_json::Map<String, serde_json::Value> {
    let mut result = serde_json::Map::new();
    let mut lines = yaml.lines().peekable();

    while let Some(line) = lines.next() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Key: value
        if let Some(colon_pos) = trimmed.find(':') {
            let key = trimmed[..colon_pos].trim().to_string();
            let value_str = trimmed[colon_pos + 1..].trim();

            if value_str.is_empty() {
                // Could be array or object
                if lines.peek().map(|l| l.trim_start().starts_with('-')).unwrap_or(false) {
                    // Array
                    let mut arr = vec![];
                    while let Some(next) = lines.peek() {
                        let next_trimmed = next.trim_start();
                        if next_trimmed.starts_with('-') {
                            let item = next_trimmed[1..].trim();
                            if item.starts_with('{') {
                                // Inline object in array
                                if let Ok(obj) = serde_json::from_str::<serde_json::Value>(item) {
                                    arr.push(obj);
                                }
                            } else {
                                arr.push(serde_json::Value::String(item.to_string()));
                            }
                            lines.next();
                        } else {
                            break;
                        }
                    }
                    result.insert(key, serde_json::Value::Array(arr));
                }
            } else if value_str.starts_with('[') && value_str.ends_with(']') {
                // Inline array
                let inner = &value_str[1..value_str.len()-1];
                let arr: Vec<serde_json::Value> = if inner.trim().is_empty() {
                    vec![]
                } else {
                    inner.split(',').map(|s| serde_json::Value::String(s.trim().to_string())).collect()
                };
                result.insert(key, serde_json::Value::Array(arr));
            } else if value_str == "true" || value_str == "false" {
                result.insert(key, serde_json::Value::Bool(value_str == "true"));
            } else if let Ok(n) = value_str.parse::<i64>() {
                result.insert(key, serde_json::Value::Number(n.into()));
            } else if let Ok(n) = value_str.parse::<f64>() {
                if let Some(num) = serde_json::Number::from_f64(n) {
                    result.insert(key, serde_json::Value::Number(num));
                }
            } else {
                // String value (strip quotes)
                let s = value_str.trim_matches('"').trim_matches('\'');
                result.insert(key, serde_json::Value::String(s.to_string()));
            }
        }
    }

    result
}

pub fn extract_wikilinks(body: &str) -> Vec<String> {
    let re = regex::Regex::new(r"\[\[([^\]]+)\]\]").unwrap();
    re.captures_iter(body)
        .filter_map(|c| c.get(1).map(|m| m.as_str().to_string()))
        .collect()
}

pub fn slugify(name: &str) -> String {
    let ascii: String = name
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == ' ' || *c == '-')
        .collect::<String>()
        .trim()
        .replace(' ', "-");
    if ascii.is_empty() {
        format!("concept-{}", chrono::Utc::now().timestamp_millis() % 100000)
    } else {
        ascii
    }
}
