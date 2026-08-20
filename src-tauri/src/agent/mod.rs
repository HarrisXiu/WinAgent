pub mod context;

use crate::config::ConfigStore;
use crate::llm::{OpenAIClient, ChatOptions, StreamCallbacks};
use crate::tools::ToolRegistry;
use crate::types::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const MAX_ROUNDS: u32 = 25;

const VISION_KEYWORDS: &[&str] = &[
    "gpt-4o", "gpt-4-turbo", "gpt-4-vision", "vision", "vl", "llava", "vlm",
    "gemini", "claude-3", "qwen-vl", "qwen2.5-vl", "glm-4v", "yi-vl", "internvl",
];

fn detect_vision(provider: &ProviderConfig) -> bool {
    if let Some(v) = provider.supports_vision {
        return v;
    }
    let model_lower = provider.model.to_lowercase();
    VISION_KEYWORDS.iter().any(|k| model_lower.contains(k))
}

fn is_image_unsupported_error(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("support image input")
        || m.contains("image input")
        || m.contains("does not support image")
        || m.contains("doesn't support image")
        || m.contains("not support vision")
        || m.contains("image_url")
}

fn estimate_text(s: &str) -> u64 {
    (s.len() as f64 / 3.0).ceil() as u64
}

pub struct AgentService {
    store: ConfigStore,
    registry: Arc<ToolRegistry>,
    history: Mutex<Vec<ChatMessage>>,
    abort: Mutex<Option<tokio::sync::watch::Sender<bool>>>,
    session_usage: Mutex<TokenUsage>,
    pending_confirms: Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>>,
}

impl AgentService {
    pub fn new(store: ConfigStore, registry: Arc<ToolRegistry>) -> Self {
        Self {
            store,
            registry,
            history: Mutex::new(vec![]),
            abort: Mutex::new(None),
            session_usage: Mutex::new(TokenUsage {
                prompt: 0,
                completion: 0,
                total: 0,
                estimated: false,
            }),
            pending_confirms: Mutex::new(HashMap::new()),
        }
    }

    pub fn registry(&self) -> &Arc<ToolRegistry> {
        &self.registry
    }

    pub fn reset(&self) {
        self.history.lock().unwrap().clear();
        *self.session_usage.lock().unwrap() = TokenUsage {
            prompt: 0,
            completion: 0,
            total: 0,
            estimated: false,
        };
    }

    pub fn stop(&self) {
        if let Some(tx) = self.abort.lock().unwrap().take() {
            let _ = tx.send(true);
        }
    }

    pub fn resolve_confirm(&self, id: &str, approved: bool) {
        if let Some(tx) = self.pending_confirms.lock().unwrap().remove(id) {
            let _ = tx.send(approved);
        }
    }

    fn report_usage(&self, last: TokenUsage, app: &AppHandle) {
        let mut session = self.session_usage.lock().unwrap();
        session.prompt += last.prompt;
        session.completion += last.completion;
        session.total += last.total;
        session.estimated = session.estimated || last.estimated;
        let event = AgentEvent::Usage {
            last,
            session: session.clone(),
        };
        let _ = app.emit("agent:event", &event);
    }

    fn system_message(&self, cfg: &AppConfig) -> ChatMessage {
        let tool_names: Vec<String> = self.registry.get_schemas().iter().map(|t| t.name.clone()).collect();
        let capability = format!(
            "\n【能力说明】\n你拥有完整的 Windows 工具能力，可以直接调用工具执行实际操作：\n可用工具：{}\n\n【执行规则】\n- 用中文回复，保持安洁莉娜的人设口吻，同时专业高效地完成任务\n- 查询类操作直接执行并展示结果；修改/删除类操作先说明再执行\n- 涉及本地文件时用 read_file（传入绝对路径）读取后回答\n- 【知识库检索】用户问题涉及知识库时，必须主动调用 search_knowledge_base 检索\n- 多步骤任务逐步执行并报告每步结果\n- 只使用上面列出的工具名\n\n【图片生成规则】用户需要图片时，用 generate_image_prompt 生成可复用的绘图提示词。\n【文件编辑规则】修改已存在文件优先用 edit_file / multi_edit_file。\n【Word 文档规则】Markdown 风格用 markdown_to_word；精细排版用 create_word_document。",
            tool_names.join(", ")
        );
        ChatMessage {
            role: "system".to_string(),
            content: MessageContent::Text(format!("{}{}", cfg.pet_prompt, capability)),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    pub async fn process(
        &self,
        app: AppHandle,
        user_input: String,
        attachments: Vec<serde_json::Value>,
    ) -> Result<(), String> {
        let cfg = self.store.get();
        let provider = self.store.active_provider().ok_or("No provider configured")?;

        // Build user content
        let user_content = self.build_user_content(&cfg, &provider, &user_input, &attachments);
        let multipart = attachments.iter().any(|a| {
            a.get("isImage").and_then(|v| v.as_bool()).unwrap_or(false)
        });

        self.history.lock().unwrap().push(ChatMessage {
            role: "user".to_string(),
            content: user_content,
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
            name: None,
        });

        let (abort_tx, mut abort_rx) = tokio::sync::watch::channel(false);
        self.abort.lock().unwrap().replace(abort_tx);

        let mut sent_images = multipart;
        let mut downgraded = false;

        for round in 1..=MAX_ROUNDS {
            if abort_rx.has_changed().unwrap_or(false) && *abort_rx.borrow() {
                break;
            }

            let _ = app.emit("agent:event", &AgentEvent::Round {
                round,
                history_count: self.history.lock().unwrap().len() as u32,
            });

            let messages = {
                let mut msgs = vec![self.system_message(&cfg)];
                msgs.extend(self.history.lock().unwrap().clone());
                msgs
            };
            let tools = self.registry.get_schemas();

            let (content_tx, mut content_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
            let (reasoning_tx, mut reasoning_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

            let cb = StreamCallbacks {
                on_content: Some(content_tx),
                on_reasoning: Some(reasoning_tx),
            };

            // Forward stream deltas to frontend
            let app_clone = app.clone();
            let forward_task = tokio::spawn(async move {
                loop {
                    tokio::select! {
                        Some(text) = content_rx.recv() => {
                            let _ = app_clone.emit("agent:event", &AgentEvent::AssistantDelta { text });
                        }
                        Some(text) = reasoning_rx.recv() => {
                            let _ = app_clone.emit("agent:event", &AgentEvent::ReasoningDelta { text });
                        }
                        else => break,
                    }
                }
            });

            let result = OpenAIClient::chat_stream(
                &provider,
                &messages,
                &ChatOptions {
                    temperature: cfg.temperature,
                    max_tokens: cfg.max_tokens,
                    tools: Some(tools.clone()),
                    stream: cfg.stream,
                    thinking: cfg.thinking_mode.clone(),
                },
                &cb,
            )
            .await;

            forward_task.abort();

            let result = match result {
                Ok(r) => r,
                Err(e) => {
                    if sent_images && !downgraded && is_image_unsupported_error(&e) {
                        downgraded = true;
                        sent_images = false;
                        let _ = app.emit("agent:event", &AgentEvent::Vision {
                            status: "error".to_string(),
                            model: provider.model.clone(),
                            text: Some("主模型不接受图片输入，已自动降级重试".to_string()),
                        });
                        // Rebuild user content without vision
                        let rebuilt = self.build_user_content(&cfg, &provider, &user_input, &attachments);
                        let mut hist = self.history.lock().unwrap();
                        if let Some(idx) = hist.iter().rposition(|h| h.role == "user") {
                            hist[idx].content = rebuilt;
                        }
                        continue;
                    }
                    let _ = app.emit("agent:event", &AgentEvent::Error { message: e.clone() });
                    return Err(e);
                }
            };

            // Report usage
            let usage = result.usage.clone().unwrap_or_else(|| {
                let completion_text = format!("{}{}{}", result.content, result.reasoning,
                    result.tool_calls.iter().map(|t| format!("{}{}", t.name, t.arguments)).collect::<String>());
                TokenUsage {
                    prompt: context::estimate_tokens(&messages),
                    completion: estimate_text(&completion_text),
                    total: context::estimate_tokens(&messages) + estimate_text(&completion_text),
                    estimated: true,
                }
            });
            self.report_usage(usage, &app);

            let _ = app.emit("agent:event", &AgentEvent::AssistantMessage {
                content: result.content.clone(),
                reasoning: if result.reasoning.is_empty() { None } else { Some(result.reasoning.clone()) },
            });

            // Record assistant message
            let assistant_msg = ChatMessage {
                role: "assistant".to_string(),
                content: MessageContent::Text(result.content.clone()),
                reasoning_content: if result.reasoning.is_empty() { None } else { Some(result.reasoning.clone()) },
                tool_calls: if result.tool_calls.is_empty() {
                    None
                } else {
                    Some(result.tool_calls.clone())
                },
                tool_call_id: None,
                name: None,
            };
            self.history.lock().unwrap().push(assistant_msg);

            if result.finish_reason != "tool_calls" || result.tool_calls.is_empty() {
                break;
            }

            // Execute tools
            for call in &result.tool_calls {
                let source = self.registry.get_source(&call.name);
                let _ = app.emit("agent:event", &AgentEvent::ToolCall {
                    id: call.id.clone(),
                    name: call.name.clone(),
                    args: call.arguments.clone(),
                    source: source.to_string(),
                });

                let args: serde_json::Value = serde_json::from_str(&call.arguments).unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

                // Dangerous tool confirmation
                if self.registry.is_dangerous(&call.name) && !cfg.auto_approve_tools {
                    let (confirm_tx, confirm_rx) = tokio::sync::oneshot::channel();
                    let confirm_id = format!("cf_{}", uuid::Uuid::new_v4());
                    self.pending_confirms.lock().unwrap().insert(confirm_id.clone(), confirm_tx);

                    let _ = app.emit("agent:confirm", &serde_json::json!({
                        "id": confirm_id,
                        "name": call.name,
                        "args": call.arguments,
                    }));

                    match confirm_rx.await {
                        Ok(true) => {}
                        _ => {
                            let denied = "用户拒绝了该操作";
                            let _ = app.emit("agent:event", &AgentEvent::ToolResult {
                                id: call.id.clone(),
                                name: call.name.clone(),
                                result: denied.to_string(),
                                ok: false,
                            });
                            self.history.lock().unwrap().push(ChatMessage {
                                role: "tool".to_string(),
                                content: MessageContent::Text(denied.to_string()),
                                reasoning_content: None,
                                tool_calls: None,
                                tool_call_id: Some(call.id.clone()),
                                name: Some(call.name.clone()),
                            });
                            continue;
                        }
                    }
                }

                let (ok, tool_result) = self.registry.execute(&call.name, &args);
                let _ = app.emit("agent:event", &AgentEvent::ToolResult {
                    id: call.id.clone(),
                    name: call.name.clone(),
                    result: tool_result.clone(),
                    ok,
                });

                self.history.lock().unwrap().push(ChatMessage {
                    role: "tool".to_string(),
                    content: MessageContent::Text(tool_result),
                    reasoning_content: None,
                    tool_calls: None,
                    tool_call_id: Some(call.id.clone()),
                    name: Some(call.name.clone()),
                });
            }
        }

        let _ = app.emit("agent:event", &AgentEvent::Done);
        self.abort.lock().unwrap().take();
        Ok(())
    }

    fn build_user_content(
        &self,
        cfg: &AppConfig,
        provider: &ProviderConfig,
        user_input: &str,
        attachments: &[serde_json::Value],
    ) -> MessageContent {
        if attachments.is_empty() {
            return MessageContent::Text(user_input.to_string());
        }

        let supports_vision = detect_vision(provider);

        if supports_vision {
            let mut parts: Vec<ContentPart> = vec![];
            let mut text_parts: Vec<String> = vec![user_input.to_string()];

            for att in attachments {
                if att.get("isImage").and_then(|v| v.as_bool()).unwrap_or(false) {
                    if let Some(data_url) = att.get("dataUrl").and_then(|v| v.as_str()) {
                        parts.push(ContentPart::ImageUrl {
                            image_url: ImageUrlData { url: data_url.to_string() },
                        });
                    }
                } else if let Some(text) = att.get("textContent").and_then(|v| v.as_str()) {
                    let name = att.get("name").and_then(|v| v.as_str()).unwrap_or("file");
                    text_parts.push(format!("\n[文件: {}]\n{}", name, text));
                } else {
                    let name = att.get("name").and_then(|v| v.as_str()).unwrap_or("attachment");
                    let path = att.get("path").and_then(|v| v.as_str()).unwrap_or("");
                    text_parts.push(format!("\n[附件: {}]（路径: {}）", name, path));
                }
            }

            parts.insert(0, ContentPart::Text {
                text: text_parts.join(""),
            });
            return MessageContent::Multipart(parts);
        }

        // Non-vision: convert images to text descriptions
        let mut text_parts: Vec<String> = vec![user_input.to_string()];

        for att in attachments {
            if att.get("isImage").and_then(|v| v.as_bool()).unwrap_or(false) {
                let name = att.get("name").and_then(|v| v.as_str()).unwrap_or("image");
                let path = att.get("path").and_then(|v| v.as_str()).unwrap_or("");
                text_parts.push(format!("\n[图片: {}]（路径: {}）注意：当前模型不支持图片识别。", name, path));
            } else if let Some(text) = att.get("textContent").and_then(|v| v.as_str()) {
                let name = att.get("name").and_then(|v| v.as_str()).unwrap_or("file");
                text_parts.push(format!("\n[文件: {}]\n{}", name, text));
            } else {
                let name = att.get("name").and_then(|v| v.as_str()).unwrap_or("attachment");
                let path = att.get("path").and_then(|v| v.as_str()).unwrap_or("");
                text_parts.push(format!("\n[附件: {}]（路径: {}）", name, path));
            }
        }

        MessageContent::Text(text_parts.join(""))
    }

    pub async fn compact_now(&self, app: AppHandle) -> Result<(), String> {
        let provider = self.store.active_provider().ok_or("No provider")?;
        let cfg = self.store.get();

        let before = context::estimate_tokens(&self.history.lock().unwrap());
        let history = self.history.lock().unwrap().clone();

        let compacted = context::compact(&provider, &history, &cfg).await?;
        let after = context::estimate_tokens(&compacted);

        *self.history.lock().unwrap() = compacted;

        let _ = app.emit("agent:event", &AgentEvent::Compact { before, after });
        Ok(())
    }
}
