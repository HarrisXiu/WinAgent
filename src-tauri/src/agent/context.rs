use crate::types::{ChatMessage, MessageContent, AppConfig, ProviderConfig};
use crate::llm::{OpenAIClient, ChatOptions, StreamCallbacks};

/// Estimate tokens for a message list (rough: chars/3)
pub fn estimate_tokens(messages: &[ChatMessage]) -> u64 {
    let total_chars: usize = messages.iter().map(|m| {
        let role_len = m.role.len();
        let content_len = match &m.content {
            MessageContent::Text(s) => s.len(),
            MessageContent::Multipart(parts) => parts.iter().map(|p| {
                match p {
                    crate::types::ContentPart::Text { text } => text.len(),
                    crate::types::ContentPart::ImageUrl { image_url } => image_url.url.len(),
                }
            }).sum(),
        };
        role_len + content_len
    }).sum();
    (total_chars as f64 / 3.0).ceil() as u64
}

pub const IMAGE_TOKEN_COST: u64 = 765;

/// Check if history needs compaction
pub fn needs_compact(cfg: &AppConfig, messages: &[ChatMessage]) -> bool {
    estimate_tokens(messages) > cfg.compact_threshold_tokens as u64
}

/// Compact history: summarize older messages, keep recent turns
pub async fn compact(
    provider: &ProviderConfig,
    history: &[ChatMessage],
    cfg: &AppConfig,
) -> Result<Vec<ChatMessage>, String> {
    let keep = cfg.keep_recent_turns as usize * 2; // user + assistant per turn
    if history.len() <= keep {
        return Ok(history.to_vec());
    }

    let older = &history[..history.len() - keep];
    let recent = &history[history.len() - keep..];

    // Summarize older messages
    let summary_content: String = older.iter().map(|m| {
        let role = &m.role;
        let content = match &m.content {
            MessageContent::Text(s) => s.clone(),
            MessageContent::Multipart(parts) => parts.iter().filter_map(|p| {
                match p {
                    crate::types::ContentPart::Text { text } => Some(text.clone()),
                    _ => None,
                }
            }).collect::<Vec<_>>().join(" "),
        };
        format!("[{}] {}", role, content)
    }).collect::<Vec<_>>().join("\n");

    let summary_request = vec![
        ChatMessage {
            role: "system".to_string(),
            content: MessageContent::Text("请用中文简洁总结以下对话历史，保留关键信息、工具调用结果和用户意图。".to_string()),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
            name: None,
        },
        ChatMessage {
            role: "user".to_string(),
            content: MessageContent::Text(summary_content),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
            name: None,
        },
    ];

    let result = OpenAIClient::chat_stream(
        provider,
        &summary_request,
        &ChatOptions {
            temperature: 0.3,
            max_tokens: 1024,
            tools: None,
            stream: false,
            thinking: "auto".to_string(),
        },
        &StreamCallbacks::default(),
    ).await?;

    let mut compacted = vec![
        ChatMessage {
            role: "system".to_string(),
            content: MessageContent::Text(format!("以下是之前对话的摘要：\n{}", result.content)),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
            name: None,
        },
    ];
    compacted.extend(recent.iter().cloned());
    Ok(compacted)
}
