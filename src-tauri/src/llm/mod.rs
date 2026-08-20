use crate::types::{ChatMessage, MessageContent, ProviderConfig, TokenUsage, ToolCall, ToolSchema};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct ChatOptions {
    pub temperature: f64,
    pub max_tokens: u32,
    pub tools: Option<Vec<ToolSchema>>,
    pub stream: bool,
    pub thinking: String, // "auto" | "on" | "off"
}

#[derive(Debug, Clone, Default)]
pub struct ChatResult {
    pub content: String,
    pub reasoning: String,
    pub tool_calls: Vec<ToolCall>,
    pub finish_reason: String,
    pub usage: Option<TokenUsage>,
}

#[derive(Debug, Clone, Default)]
pub struct StreamCallbacks {
    pub on_content: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    pub on_reasoning: Option<tokio::sync::mpsc::UnboundedSender<String>>,
}

fn chat_url(p: &ProviderConfig) -> String {
    let base = p.base_url.trim_end_matches('/');
    if p.provider_type == "ollama" {
        format!("{}/v1/chat/completions", base)
    } else {
        format!("{}/chat/completions", base)
    }
}

fn build_headers(p: &ProviderConfig) -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Content-Type", "application/json".parse().unwrap());
    if !p.api_key.is_empty() {
        headers.insert(
            "Authorization",
            format!("Bearer {}", p.api_key).parse().unwrap(),
        );
    }
    headers
}

fn sanitize_messages(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
    messages
        .iter()
        .map(|m| {
            let mut out = serde_json::json!({
                "role": m.role,
            });

            match &m.content {
                MessageContent::Text(text) => {
                    if m.role == "assistant" && text.is_empty() {
                        out["content"] = serde_json::Value::Null;
                    } else {
                        out["content"] = serde_json::Value::String(text.clone());
                    }
                }
                MessageContent::Multipart(parts) => {
                    out["content"] = serde_json::to_value(parts).unwrap_or(serde_json::Value::Null);
                }
            }

            if m.role == "assistant" {
                if let Some(tool_calls) = &m.tool_calls {
                    if !tool_calls.is_empty() {
                        out["tool_calls"] = serde_json::to_value(
                            tool_calls.iter().map(|tc| {
                                serde_json::json!({
                                    "id": tc.id,
                                    "type": "function",
                                    "function": {
                                        "name": tc.name,
                                        "arguments": tc.arguments,
                                    }
                                })
                            }).collect::<Vec<_>>(),
                        ).unwrap_or(serde_json::Value::Null);
                    }
                }
            } else if m.role == "tool" {
                out["tool_call_id"] = m.tool_call_id.clone().unwrap_or_default().into();
                if let Some(name) = &m.name {
                    out["name"] = name.clone().into();
                }
            }

            out
        })
        .collect()
}

fn apply_thinking(body: &mut serde_json::Value, mode: &str) {
    if mode == "auto" {
        return;
    }
    let on = mode == "on";
    if let Some(obj) = body.as_object_mut() {
        obj.insert("enable_thinking".to_string(), on.into());
        obj.insert(
            "reasoning".to_string(),
            serde_json::json!({"enabled": on}),
        );
        obj.insert(
            "thinking".to_string(),
            serde_json::json!({"type": if on { "enabled" } else { "disabled" }}),
        );
    }
}

fn is_unknown_thinking_param_error(msg: &str) -> bool {
    let m = msg.to_lowercase();
    let mentions_param = m.contains("enable_thinking")
        || m.contains("reasoning")
        || m.contains("thinking");
    let mentions_reject = m.contains("unknown")
        || m.contains("unrecognized")
        || m.contains("unsupported")
        || m.contains("not support")
        || m.contains("invalid")
        || m.contains("extra input")
        || m.contains("additional propert");
    mentions_param && mentions_reject
}

fn parse_usage(u: &serde_json::Value) -> Option<TokenUsage> {
    if u.is_null() {
        return None;
    }
    let prompt = u
        .get("prompt_tokens")
        .or_else(|| u.get("input_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let completion = u
        .get("completion_tokens")
        .or_else(|| u.get("output_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let total = u
        .get("total_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(prompt + completion);
    if prompt == 0 && completion == 0 && total == 0 {
        return None;
    }
    Some(TokenUsage {
        prompt,
        completion,
        total,
        estimated: false,
    })
}

pub struct OpenAIClient;

impl OpenAIClient {
    pub async fn chat_stream(
        provider: &ProviderConfig,
        messages: &[ChatMessage],
        opts: &ChatOptions,
        cb: &StreamCallbacks,
    ) -> Result<ChatResult, String> {
        let thinking = opts.thinking.clone();
        match Self::request(provider, messages, opts, cb, &thinking).await {
            Ok(result) => Ok(result),
            Err(e) => {
                if thinking != "auto" && is_unknown_thinking_param_error(&e) {
                    Self::request(provider, messages, opts, cb, "auto").await
                } else {
                    Err(e)
                }
            }
        }
    }

    async fn request(
        provider: &ProviderConfig,
        messages: &[ChatMessage],
        opts: &ChatOptions,
        cb: &StreamCallbacks,
        thinking: &str,
    ) -> Result<ChatResult, String> {
        let use_stream = opts.stream;

        let mut body = serde_json::json!({
            "model": provider.model,
            "messages": sanitize_messages(messages),
            "temperature": opts.temperature,
            "max_tokens": opts.max_tokens,
            "stream": use_stream,
        });

        if let Some(tools) = &opts.tools {
            if !tools.is_empty() {
                body["tools"] = serde_json::to_value(
                    tools.iter().map(|t| {
                        serde_json::json!({
                            "type": "function",
                            "function": t,
                        })
                    }).collect::<Vec<_>>(),
                )
                .unwrap_or(serde_json::Value::Null);
                body["tool_choice"] = "auto".into();
            }
        }

        if use_stream {
            body["stream_options"] = serde_json::json!({"include_usage": true});
        }

        apply_thinking(&mut body, thinking);

        let client = reqwest::Client::new();
        let res = client
            .post(chat_url(provider))
            .headers(build_headers(provider))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("LLM 请求失败: {}", e))?;

        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(format!(
                "LLM 请求失败 [{}] {}",
                status,
                &text[..text.len().min(500)]
            ));
        }

        if !use_stream {
            let json: serde_json::Value = res
                .json()
                .await
                .map_err(|e| format!("解析响应失败: {}", e))?;
            return Ok(Self::parse_non_stream(&json, cb));
        }

        // Stream SSE parsing
        let mut stream = res.bytes_stream();
        let mut buffer = String::new();
        let mut content = String::new();
        let mut reasoning = String::new();
        let mut finish_reason = String::new();
        let mut usage: Option<TokenUsage> = None;
        let mut tool_accum: std::collections::BTreeMap<u32, ToolCallAccum> =
            std::collections::BTreeMap::new();

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|e| format!("流读取失败: {}", e))?;
            let text = String::from_utf8_lossy(&chunk);
            buffer.push_str(&text);

            let lines: Vec<String> = buffer.split('\n').map(|s| s.to_string()).collect();
            let remainder = lines.last().cloned().unwrap_or_default();
            buffer = remainder;

            for line in &lines[..lines.len().saturating_sub(1)] {
                let trimmed = line.trim();
                if !trimmed.starts_with("data:") {
                    continue;
                }
                let data = trimmed[5..].trim();
                if data == "[DONE]" {
                    continue;
                }
                let json: serde_json::Value = match serde_json::from_str(data) {
                    Ok(j) => j,
                    Err(_) => continue,
                };

                if let Some(u) = parse_usage(&json) {
                    usage = Some(u);
                }

                let choice = json.get("choices").and_then(|c| c.as_array()).and_then(|c| c.first());
                if choice.is_none() {
                    continue;
                }
                let choice = choice.unwrap();
                let delta = choice.get("delta");

                if let Some(delta) = delta {
                    if let Some(c) = delta.get("content").and_then(|v| v.as_str()) {
                        if !c.is_empty() {
                            content.push_str(c);
                            if let Some(tx) = &cb.on_content {
                                let _ = tx.send(c.to_string());
                            }
                        }
                    }

                    let reasoning_delta = delta
                        .get("reasoning_content")
                        .and_then(|v| v.as_str())
                        .or_else(|| delta.get("reasoning").and_then(|v| v.as_str()));
                    if let Some(r) = reasoning_delta {
                        if !r.is_empty() {
                            reasoning.push_str(r);
                            if let Some(tx) = &cb.on_reasoning {
                                let _ = tx.send(r.to_string());
                            }
                        }
                    }

                    if let Some(tool_calls) = delta.get("tool_calls").and_then(|v| v.as_array()) {
                        for tc in tool_calls {
                            let idx = tc.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                            let entry = tool_accum.entry(idx).or_insert_with(|| ToolCallAccum {
                                id: String::new(),
                                name: String::new(),
                                args: String::new(),
                            });
                            if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                                entry.id = id.to_string();
                            }
                            if let Some(name) = tc.get("function").and_then(|f| f.get("name")).and_then(|v| v.as_str()) {
                                entry.name = name.to_string();
                            }
                            if let Some(args) = tc.get("function").and_then(|f| f.get("arguments")).and_then(|v| v.as_str()) {
                                entry.args.push_str(args);
                            }
                        }
                    }
                }

                if let Some(fr) = choice.get("finish_reason").and_then(|v| v.as_str()) {
                    finish_reason = fr.to_string();
                }
            }
        }

        let tool_calls: Vec<ToolCall> = tool_accum
            .into_iter()
            .map(|(i, t)| ToolCall {
                id: if t.id.is_empty() {
                    format!("call_{}", i)
                } else {
                    t.id
                },
                name: t.name,
                arguments: if t.args.is_empty() {
                    "{}".to_string()
                } else {
                    t.args
                },
            })
            .filter(|t| !t.name.is_empty())
            .collect();

        if finish_reason.is_empty() {
            finish_reason = if !tool_calls.is_empty() {
                "tool_calls".to_string()
            } else {
                "stop".to_string()
            };
        }

        Ok(ChatResult {
            content,
            reasoning,
            tool_calls,
            finish_reason,
            usage,
        })
    }

    fn parse_non_stream(json: &serde_json::Value, cb: &StreamCallbacks) -> ChatResult {
        let choice = json.get("choices").and_then(|c| c.as_array()).and_then(|c| c.first());
        let msg = choice
            .and_then(|c| c.get("message"))
            .cloned()
            .unwrap_or(serde_json::Value::Null);

        let content = msg.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let reasoning = msg
            .get("reasoning_content")
            .and_then(|v| v.as_str())
            .or_else(|| msg.get("reasoning").and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_string();

        if !reasoning.is_empty() {
            if let Some(tx) = &cb.on_reasoning {
                let _ = tx.send(reasoning.clone());
            }
        }
        if !content.is_empty() {
            if let Some(tx) = &cb.on_content {
                let _ = tx.send(content.clone());
            }
        }

        let tool_calls: Vec<ToolCall> = msg
            .get("tool_calls")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .enumerate()
                    .filter_map(|(i, tc)| {
                        let name = tc.get("function").and_then(|f| f.get("name")).and_then(|v| v.as_str())?;
                        Some(ToolCall {
                            id: tc.get("id").and_then(|v| v.as_str()).unwrap_or(&format!("call_{}", i)).to_string(),
                            name: name.to_string(),
                            arguments: tc.get("function").and_then(|f| f.get("arguments")).and_then(|v| v.as_str()).unwrap_or("{}").to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let finish_reason = choice
            .and_then(|c| c.get("finish_reason"))
            .and_then(|v| v.as_str())
            .unwrap_or(if !tool_calls.is_empty() { "tool_calls" } else { "stop" })
            .to_string();

        ChatResult {
            content,
            reasoning,
            tool_calls,
            finish_reason,
            usage: parse_usage(&json.get("usage").cloned().unwrap_or(serde_json::Value::Null)),
        }
    }

    pub async fn fetch_models(provider: &ProviderConfig) -> Result<Vec<String>, String> {
        let base = provider.base_url.trim_end_matches('/');
        let client = reqwest::Client::new();

        if provider.provider_type == "ollama" {
            let res = client
                .get(format!("{}/api/tags", base))
                .send()
                .await
                .map_err(|e| format!("Ollama /api/tags 失败: {}", e))?;
            if !res.status().is_success() {
                return Err(format!("Ollama /api/tags 失败 [{}]", res.status()));
            }
            let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
            let models = json
                .get("models")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            Ok(models)
        } else {
            let res = client
                .get(format!("{}/models", base))
                .headers(build_headers(provider))
                .send()
                .await
                .map_err(|e| format!("/models 失败: {}", e))?;
            if !res.status().is_success() {
                return Err(format!("/models 失败 [{}]", res.status()));
            }
            let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
            let models = json
                .get("data")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            Ok(models)
        }
    }
}

#[derive(Default)]
struct ToolCallAccum {
    id: String,
    name: String,
    args: String,
}
