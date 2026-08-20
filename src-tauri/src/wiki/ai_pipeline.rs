use crate::types::*;
use crate::llm::{OpenAIClient, ChatOptions, StreamCallbacks};
use crate::wiki::vault::slugify;
use std::collections::{HashMap, HashSet};
use tokio::sync::watch;

const TYPE_RULES: &[(&str, &str)] = &[
    ("source", "【笔记类型：来源页】\n- 摘要应概括来源的核心论点和关键数据\n- tags 应包含来源类型（论文/教程/视频等）和领域\n- relations 优先关联到对应概念页"),
    ("concept", "【笔记类型：概念页】\n- 摘要应定义概念并说明其重要性\n- tags 应包含所属领域和关联概念\n- relations 优先关联到相关来源页和实体页"),
    ("entity", "【笔记类型：实体页】\n- 摘要应介绍实体身份和主要贡献\n- tags 应包含实体类型和领域\n- relations 优先关联到相关概念页和来源页"),
    ("raw", "【笔记类型：原始文件】\n- 摘要应概括文件内容\n- tags 应包含文件类型和主题"),
];

const CANCELLED: &str = "AI 分析已取消";

const MAX_TAGS: usize = 8;
const MAX_TAG_CHARS: usize = 16;
const MAX_RELATIONS: usize = 5;
const ANALYZE_BODY_CHARS: usize = 4000;
const INGEST_BODY_CHARS: usize = 8000;

/// AI analysis pipeline.
///
/// All methods take `&self` and rely on interior mutability, so the pipeline can
/// be shared as `Arc<AiPipeline>` without a surrounding mutex. This is what makes
/// [`AiPipeline::cancel`] usable *while* an analysis is in flight, and lets batch
/// ingest run several analyses concurrently.
pub struct AiPipeline {
    /// Monotonic cancel counter. `cancel()` bumps it; every in-flight request
    /// remembers the value it started with and aborts as soon as it changes.
    cancel_epoch: watch::Sender<u64>,
}

impl AiPipeline {
    pub fn new() -> Self {
        let (tx, _) = watch::channel(0u64);
        Self { cancel_epoch: tx }
    }

    /// Cancel every analysis currently in flight.
    pub fn cancel(&self) {
        self.cancel_epoch.send_modify(|v| *v += 1);
    }

    /// Race `fut` against a cancellation bump.
    async fn guarded<T, F>(&self, fut: F) -> Result<T, String>
    where
        F: std::future::Future<Output = Result<T, String>>,
    {
        let mut rx = self.cancel_epoch.subscribe();
        let start = *rx.borrow_and_update();
        tokio::pin!(fut);
        loop {
            tokio::select! {
                biased;
                changed = rx.changed() => {
                    // The sender lives in `self`, so `changed()` only errors if the
                    // pipeline itself was dropped -- treat that as cancellation too.
                    if changed.is_err() || *rx.borrow() != start {
                        return Err(CANCELLED.to_string());
                    }
                }
                out = &mut fut => return out,
            }
        }
    }

    /// Issue a completion and return the JSON object found in the reply.
    ///
    /// Models routinely wrap JSON in prose or code fences, so the response is run
    /// through a balanced-brace scan. If that still fails to parse, the model gets
    /// exactly one chance to repair its own output.
    async fn complete_json(
        &self,
        provider: &ProviderConfig,
        messages: Vec<ChatMessage>,
        temperature: f64,
        max_tokens: u32,
        label: &str,
    ) -> Result<serde_json::Value, String> {
        let opts = ChatOptions {
            temperature,
            max_tokens,
            tools: None,
            stream: false,
            thinking: "auto".to_string(),
        };

        let first = self
            .guarded(OpenAIClient::chat_stream(provider, &messages, &opts, &StreamCallbacks::default()))
            .await?;

        let first_err = match parse_json_reply(&first.content) {
            Ok(v) => return Ok(v),
            Err(e) => e,
        };

        log::warn!("[{}] JSON 解析失败，尝试修复重试: {}", label, first_err);

        // Repair round: show the model its own output and the parse error.
        let mut repair = messages;
        repair.push(text_msg("assistant", &first.content));
        repair.push(text_msg(
            "user",
            &format!(
                "你上一次的输出无法解析为 JSON（错误：{}）。\
                 请只输出一个合法的 JSON 对象，不要任何解释文字、不要 markdown 代码块。",
                first_err
            ),
        ));

        let second = self
            .guarded(OpenAIClient::chat_stream(provider, &repair, &opts, &StreamCallbacks::default()))
            .await?;

        parse_json_reply(&second.content).map_err(|e| {
            format!(
                "{} JSON 解析失败（已重试 1 次）: {} | 原文: {}",
                label,
                e,
                snippet(&second.content, 200)
            )
        })
    }

    pub async fn analyze(
        &self,
        provider: &ProviderConfig,
        title: &str,
        body: &str,
        candidates: &[(String, String)], // (path, title)
        note_type: &str,
        contract: &str,
        open_questions: &[String],
    ) -> Result<AISuggestion, String> {
        let type_rule = TYPE_RULES
            .iter()
            .find(|(t, _)| *t == note_type)
            .map(|(_, r)| *r)
            .unwrap_or("");
        let contract_rule = if contract.is_empty() {
            String::new()
        } else {
            format!("\n\n=== 知识库行为契约（CLAUDE.md，必须遵守）===\n{}", contract)
        };
        let question_rule = if open_questions.is_empty() {
            String::new()
        } else {
            format!(
                "\n\n=== 开放问题列表（若本笔记能回答其中问题，将问题原文放入 suggestions） ===\n{}",
                bullet_list(open_questions)
            )
        };

        let candidates_str = if candidates.is_empty() {
            "（暂无其他笔记）".to_string()
        } else {
            candidates
                .iter()
                .map(|(path, title)| format!("- {}（{}）", path, title))
                .collect::<Vec<_>>()
                .join("\n")
        };

        let system_content = format!(
            r#"你是一个知识管理助手。分析给定笔记，输出严格合法的 JSON 对象（不要 markdown 代码块、不要多余文字）：
{{
  "tags": ["3-8 个标签，中英文混合、每个 2-8 个字，涵盖主题/领域/类型"],
  "summary": "2-4 句中文摘要，概括核心内容与关键观点，不要以「本文」「这篇文章」等开头",
  "relations": [{{"target": "最相关候选笔记的精确路径", "reason": "一句话相关原因"}}],
  "suggestions": ["0-3 条具体可执行的改进建议；没有问题返回空数组"]
}}
要求：
- relations 取 0-5 条；没有明显相关的候选时返回空数组
- relations 的 target 必须逐字取自下方候选列表中的「路径」列，禁止编造或改写
- suggestions 类型示例：正文过短（stub，<100 字）建议补充内容、缺少 [[source-slug]] 溯源、正文可回答开放问题（写问题原文）、与某笔记存在矛盾（写原因）
- tags 示例：["机器学习", "神经网络", "AI", "教程"]{}{}{}"#,
            type_rule, question_rule, contract_rule
        );

        let user_content = format!(
            "当前笔记标题：{}\n当前笔记内容：{}\n\n知识库中其他笔记（路径（标题））：\n{}",
            title,
            clip_body(body, ANALYZE_BODY_CHARS),
            candidates_str
        );

        let parsed = self
            .complete_json(
                provider,
                vec![text_msg("system", &system_content), text_msg("user", &user_content)],
                0.2,
                2048,
                "AI 分析",
            )
            .await?;

        // The model is told to copy candidate paths verbatim but nothing stops it
        // from inventing one, which would create a dangling link. Drop anything
        // that is not a known candidate and backfill the title we already have.
        let titles: HashMap<&str, &str> = candidates
            .iter()
            .map(|(p, t)| (p.as_str(), t.as_str()))
            .collect();

        let tags = str_array(&parsed, "tags").map(normalize_tags);
        let summary = parsed
            .get("summary")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let relations = parsed
            .get("relations")
            .and_then(|v| v.as_array())
            .map(|arr| sanitize_relations(arr, &titles));
        let suggestions = str_array(&parsed, "suggestions").map(|v| dedupe_nonempty(v, 8));

        Ok(AISuggestion { tags, summary, relations, suggestions })
    }

    pub async fn ingest_source(
        &self,
        provider: &ProviderConfig,
        file_name: &str,
        text_content: &str,
        existing_concepts: &[(String, String)], // (slug, title)
        existing_entities: &[(String, String)],
        open_questions: &[String],
        contract: &str,
    ) -> Result<IngestAnalysis, String> {
        let system_content = format!(
            r#"你是知识库编译器。分析给定来源文件，输出严格合法的 JSON 对象（不要 markdown 代码块）：
{{
  "slug": "英文小写连字符 slug",
  "title": "中文标题",
  "summary": "2-4 句中文摘要",
  "keyPoints": ["3-8 条核心要点"],
  "concepts": [{{"name": "概念中文名", "nameEn": "英文名", "definition": "一句话定义", "matchSlug": "命中已有概念 slug 或 null"}}],
  "entities": [{{"name": "实体名", "type": "person/tool/institution/paper", "description": "一句话描述", "matchSlug": "命中已有实体 slug 或 null"}}],
  "contradictions": ["与其他来源的分歧（没有则空数组）"],
  "answeredQuestions": ["匹配到的开放问题原文（没有则空数组）"],
  "language": "zh 或 en",
  "canonicalSource": "原始出处 URL 或标题（译文/转述填，原创省略）"
}}

已有概念列表（matchSlug 从中选取）：
{}

已有实体列表（matchSlug 从中选取）：
{}

开放问题列表（answeredQuestions 从中选取原文）：
{}

{}"#,
            slug_list(existing_concepts, "（暂无概念）"),
            slug_list(existing_entities, "（暂无实体）"),
            if open_questions.is_empty() {
                "（暂无开放问题）".to_string()
            } else {
                bullet_list(open_questions)
            },
            if contract.is_empty() {
                String::new()
            } else {
                format!("=== 契约 ===\n{}", contract)
            }
        );

        let user_content = format!(
            "文件名: {}\n\n内容:\n{}",
            file_name,
            clip_body(text_content, INGEST_BODY_CHARS)
        );

        let value = self
            .complete_json(
                provider,
                vec![text_msg("system", &system_content), text_msg("user", &user_content)],
                0.2,
                4096,
                "INGEST",
            )
            .await?;

        let mut parsed: IngestAnalysis = serde_json::from_value(value)
            .map_err(|e| format!("INGEST 结果字段不完整: {}", e))?;

        // A hallucinated matchSlug would merge the new note into a page that does
        // not exist; a hallucinated answeredQuestion would close a question that
        // was never asked. Both are cheap to verify against what we already know.
        let concept_slugs: HashSet<&str> =
            existing_concepts.iter().map(|(s, _)| s.as_str()).collect();
        let entity_slugs: HashSet<&str> =
            existing_entities.iter().map(|(s, _)| s.as_str()).collect();
        let questions: HashSet<&str> = open_questions.iter().map(|q| q.trim()).collect();

        for c in &mut parsed.concepts {
            if !c.match_slug.as_deref().is_some_and(|s| concept_slugs.contains(s)) {
                c.match_slug = None;
            }
        }
        for e in &mut parsed.entities {
            if !e.match_slug.as_deref().is_some_and(|s| entity_slugs.contains(s)) {
                e.match_slug = None;
            }
        }
        if let Some(answered) = &mut parsed.answered_questions {
            answered.retain(|q| questions.contains(q.trim()));
        }

        parsed.title = parsed.title.trim().to_string();
        if parsed.title.is_empty() {
            parsed.title = file_name.trim_end_matches(".md").to_string();
        }
        parsed.slug = slugify(parsed.slug.trim());
        if parsed.slug.is_empty() {
            parsed.slug = slugify(&parsed.title);
        }

        Ok(parsed)
    }

    pub async fn custom_analyze(
        &self,
        provider: &ProviderConfig,
        file_name: &str,
        text_content: &str,
        requirement: &str,
        existing_tags: &[AnalysisTag],
    ) -> Result<CustomAnalysisOutput, String> {
        let tags_str = if existing_tags.is_empty() {
            "（暂无）".to_string()
        } else {
            existing_tags
                .iter()
                .map(|t| format!("- {}: {}", t.tag, t.template))
                .collect::<Vec<_>>()
                .join("\n")
        };

        let system_content = format!(
            r#"你是文档分析助手。根据用户要求分析文档，输出严格合法的 JSON 对象：
{{
  "summary": "1-2 句弹窗摘要",
  "report": "完整 markdown 分析报告",
  "analysisTags": [{{"tag": "2-8 字标签", "template": "可复用分析要求"}}]
}}

已有分析标签（避免重复）：
{}"#,
            tags_str
        );

        let user_content = format!(
            "文件名: {}\n用户要求: {}\n\n文档内容:\n{}",
            file_name,
            requirement,
            clip_body(text_content, INGEST_BODY_CHARS)
        );

        let value = self
            .complete_json(
                provider,
                vec![text_msg("system", &system_content), text_msg("user", &user_content)],
                0.4,
                4096,
                "Custom analysis",
            )
            .await?;

        serde_json::from_value(value).map_err(|e| format!("Custom analysis 结果字段不完整: {}", e))
    }
}

impl Default for AiPipeline {
    fn default() -> Self {
        Self::new()
    }
}

// ── helpers ──────────────────────────────────────────────

fn text_msg(role: &str, content: &str) -> ChatMessage {
    ChatMessage {
        role: role.to_string(),
        content: MessageContent::Text(content.to_string()),
        reasoning_content: None,
        tool_calls: None,
        tool_call_id: None,
        name: None,
    }
}

fn bullet_list(items: &[String]) -> String {
    items.iter().map(|q| format!("- {}", q)).collect::<Vec<_>>().join("\n")
}

fn slug_list(items: &[(String, String)], empty: &str) -> String {
    if items.is_empty() {
        return empty.to_string();
    }
    items
        .iter()
        .map(|(slug, title)| format!("- {} ({})", slug, title))
        .collect::<Vec<_>>()
        .join("\n")
}

fn str_array(v: &serde_json::Value, key: &str) -> Option<Vec<String>> {
    v.get(key).and_then(|v| v.as_array()).map(|arr| {
        arr.iter()
            .filter_map(|s| s.as_str().map(|s| s.to_string()))
            .collect()
    })
}

/// Truncate to `max_chars` **characters**, appending an ellipsis when clipped.
///
/// Always slice on character boundaries: the previous byte-range slicing panicked
/// whenever the cut landed inside a multi-byte character, which is the common case
/// for Chinese model output.
fn snippet(s: &str, max_chars: usize) -> String {
    let mut out: String = s.chars().take(max_chars).collect();
    if s.chars().count() > max_chars {
        out.push('…');
    }
    out
}

/// Clip an over-long document while keeping both ends.
///
/// Head-only truncation throws away the conclusion, which is usually where the
/// key points live, so keep 3/4 from the front and 1/4 from the back.
fn clip_body(s: &str, max_chars: usize) -> String {
    let total = s.chars().count();
    if total <= max_chars {
        return s.to_string();
    }
    let head_len = max_chars * 3 / 4;
    let tail_len = max_chars - head_len;
    let head: String = s.chars().take(head_len).collect();
    let tail: String = s.chars().skip(total - tail_len).collect();
    format!("{}\n\n…（中间省略约 {} 字）…\n\n{}", head, total - max_chars, tail)
}

fn normalize_tags(raw: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for tag in raw {
        let tag = tag.trim().trim_start_matches('#').trim().to_string();
        if tag.is_empty() || tag.chars().count() > MAX_TAG_CHARS {
            continue;
        }
        if seen.insert(tag.to_lowercase()) {
            out.push(tag);
        }
        if out.len() >= MAX_TAGS {
            break;
        }
    }
    out
}

fn dedupe_nonempty(raw: Vec<String>, limit: usize) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for item in raw {
        let item = item.trim().to_string();
        if item.is_empty() {
            continue;
        }
        if seen.insert(item.clone()) {
            out.push(item);
        }
        if out.len() >= limit {
            break;
        }
    }
    out
}

fn sanitize_relations(
    arr: &[serde_json::Value],
    titles: &HashMap<&str, &str>,
) -> Vec<NoteRelation> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for item in arr {
        let target = match item.get("target").and_then(|v| v.as_str()) {
            Some(t) => t.trim(),
            None => continue,
        };
        // Only keep targets the model was actually offered.
        let Some(title) = titles.get(target) else {
            log::debug!("[AI 分析] 丢弃无效关联目标: {}", target);
            continue;
        };
        if !seen.insert(target.to_string()) {
            continue;
        }
        out.push(NoteRelation {
            target: target.to_string(),
            reason: item
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string(),
            title: Some((*title).to_string()),
        });
        if out.len() >= MAX_RELATIONS {
            break;
        }
    }
    out
}

fn parse_json_reply(content: &str) -> Result<serde_json::Value, String> {
    let candidate = extract_json_object(content)
        .ok_or_else(|| format!("回复中找不到 JSON 对象 | 原文: {}", snippet(content, 200)))?;
    serde_json::from_str(&candidate).map_err(|e| e.to_string())
}

/// Pull the first balanced `{...}` span out of a model reply.
///
/// Handles code fences, leading/trailing prose and nested objects, and does not
/// get confused by braces or escaped quotes inside JSON strings.
fn extract_json_object(s: &str) -> Option<String> {
    let start = s.find('{')?;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (offset, ch) in s[start..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let end = start + offset + ch.len_utf8();
                    return Some(s[start..end].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snippet_does_not_split_multibyte_chars() {
        let s = "知识库分析结果非常长".repeat(50);
        assert_eq!(snippet(&s, 5).chars().count(), 6); // 5 chars + ellipsis
        assert_eq!(snippet("短", 200), "短");
    }

    #[test]
    fn extracts_json_from_fenced_reply() {
        let reply = "好的，结果如下：\n```json\n{\"tags\": [\"a\"]}\n```\n以上。";
        let v: serde_json::Value =
            serde_json::from_str(&extract_json_object(reply).unwrap()).unwrap();
        assert_eq!(v["tags"][0], "a");
    }

    #[test]
    fn extracts_json_with_nested_objects_and_braces_in_strings() {
        let reply = r#"{"a": {"b": "} not the end {"}, "c": 1}"#;
        let v: serde_json::Value =
            serde_json::from_str(&extract_json_object(reply).unwrap()).unwrap();
        assert_eq!(v["c"], 1);
        assert_eq!(v["a"]["b"], "} not the end {");
    }

    #[test]
    fn extracts_json_with_escaped_quotes() {
        let reply = r#"prose {"summary": "他说 \"你好\" 然后离开"} trailing"#;
        let v: serde_json::Value =
            serde_json::from_str(&extract_json_object(reply).unwrap()).unwrap();
        assert_eq!(v["summary"], r#"他说 "你好" 然后离开"#);
    }

    #[test]
    fn unbalanced_json_is_rejected() {
        assert!(extract_json_object("{\"a\": 1").is_none());
        assert!(extract_json_object("no json here").is_none());
    }

    #[test]
    fn tags_are_trimmed_deduped_and_capped() {
        let raw = vec![
            " 机器学习 ".to_string(),
            "#AI".to_string(),
            "ai".to_string(),   // dupe of AI, case-insensitive
            "".to_string(),      // dropped
            "这个标签实在是太长了完全超出了限制范围".to_string(), // dropped
        ];
        assert_eq!(normalize_tags(raw), vec!["机器学习", "AI"]);
    }

    #[test]
    fn tag_count_is_capped() {
        let raw: Vec<String> = (0..20).map(|i| format!("tag{}", i)).collect();
        assert_eq!(normalize_tags(raw).len(), MAX_TAGS);
    }

    #[test]
    fn hallucinated_relation_targets_are_dropped() {
        let titles: HashMap<&str, &str> =
            [("wiki/concepts/real.md", "真实概念")].into_iter().collect();
        let arr = vec![
            serde_json::json!({"target": "wiki/concepts/real.md", "reason": "相关"}),
            serde_json::json!({"target": "wiki/concepts/made-up.md", "reason": "编造"}),
        ];
        let out = sanitize_relations(&arr, &titles);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].target, "wiki/concepts/real.md");
        assert_eq!(out[0].title.as_deref(), Some("真实概念"));
    }

    #[test]
    fn duplicate_relations_are_collapsed() {
        let titles: HashMap<&str, &str> = [("a.md", "A")].into_iter().collect();
        let arr = vec![
            serde_json::json!({"target": "a.md", "reason": "一"}),
            serde_json::json!({"target": "a.md", "reason": "二"}),
        ];
        assert_eq!(sanitize_relations(&arr, &titles).len(), 1);
    }

    #[test]
    fn clip_body_keeps_head_and_tail() {
        let body: String = (0..1000).map(|_| '甲').chain(std::iter::once('尾')).collect();
        let clipped = clip_body(&body, 100);
        assert!(clipped.starts_with('甲'));
        assert!(clipped.ends_with('尾'), "tail must survive truncation");
        assert!(clipped.contains("中间省略"));
    }

    #[test]
    fn clip_body_is_noop_when_short() {
        assert_eq!(clip_body("短文本", 100), "短文本");
    }
}
