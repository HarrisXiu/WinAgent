use serde::{Deserialize, Serialize};

// ==================== Provider / Config ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub provider_type: String, // "openai" | "ollama"
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub supports_vision: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisionAssistConfig {
    pub enabled: bool,
    pub provider_id: String,
    pub model: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeConfig {
    pub mode: String, // "light" | "dark" | "auto"
    pub accent: String,
    pub accent2: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub active_provider_id: String,
    pub providers: Vec<ProviderConfig>,
    pub temperature: f64,
    pub max_tokens: u32,
    pub system_prompt: String,
    pub auto_approve_tools: bool,
    pub compact_threshold_tokens: u32,
    pub keep_recent_turns: u32,
    pub skills_dir: String,
    pub mcp_config_path: String,
    pub vision_assist: VisionAssistConfig,
    pub stream: bool,
    pub thinking_mode: String, // "auto" | "on" | "off"
    pub chat_mode: String,     // "pet"
    pub pet_prompt: String,
    pub vault_path: String,
    pub theme: ThemeConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            active_provider_id: String::new(),
            providers: vec![],
            temperature: 0.7,
            max_tokens: 4096,
            system_prompt: String::new(),
            auto_approve_tools: false,
            compact_threshold_tokens: 120_000,
            keep_recent_turns: 6,
            skills_dir: "skills".to_string(),
            mcp_config_path: "mcp.json".to_string(),
            vision_assist: VisionAssistConfig {
                enabled: false,
                provider_id: String::new(),
                model: String::new(),
                prompt: String::new(),
            },
            stream: true,
            thinking_mode: "auto".to_string(),
            chat_mode: "pet".to_string(),
            pet_prompt: String::new(),
            vault_path: String::new(),
            theme: ThemeConfig {
                mode: "light".to_string(),
                accent: "#f4719c".to_string(),
                accent2: "#6db7d9".to_string(),
            },
        }
    }
}

// ==================== Tools ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolParameter {
    #[serde(rename = "type")]
    pub param_type: String,
    pub description: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSchema {
    pub name: String,
    pub description: String,
    pub parameters: ToolSchemaParams,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSchemaParams {
    #[serde(rename = "type")]
    pub params_type: String, // "object"
    pub properties: serde_json::Map<String, serde_json::Value>,
    pub required: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub name: String,
    pub description: String,
    pub source: String, // "builtin" | "skill" | "mcp"
    pub dangerous: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String, // JSON string
}

// ==================== Chat / LLM ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub prompt: u64,
    pub completion: u64,
    pub total: u64,
    pub estimated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Multipart(Vec<ContentPart>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: ImageUrlData },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageUrlData {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String, // "system" | "user" | "assistant" | "tool"
    pub content: MessageContent,
    pub reasoning_content: Option<String>,
    pub tool_calls: Option<Vec<ToolCall>>,
    pub tool_call_id: Option<String>,
    pub name: Option<String>,
}

// ==================== Agent Events ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgentEvent {
    #[serde(rename = "round")]
    Round { round: u32, history_count: u32 },
    #[serde(rename = "assistant_delta")]
    AssistantDelta { text: String },
    #[serde(rename = "reasoning_delta")]
    ReasoningDelta { text: String },
    #[serde(rename = "assistant_message")]
    AssistantMessage { content: String, reasoning: Option<String> },
    #[serde(rename = "tool_call")]
    ToolCall { id: String, name: String, args: String, source: String },
    #[serde(rename = "tool_result")]
    ToolResult { id: String, name: String, result: String, ok: bool },
    #[serde(rename = "compact")]
    Compact { before: u64, after: u64 },
    #[serde(rename = "vision")]
    Vision { status: String, model: String, text: Option<String> },
    #[serde(rename = "usage")]
    Usage { last: TokenUsage, session: TokenUsage },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "done")]
    Done,
}

// ==================== Wiki Types ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub path: String,
    pub title: String,
    pub tags: Vec<String>,
    pub created: String,
    pub updated: String,
    pub kind: String, // "file" | "folder"
    pub children: Option<Vec<NoteMeta>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteAnnotation {
    pub id: String,
    pub text: String,
    pub range: String,
    pub created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRelation {
    pub target: String,
    pub reason: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteContent {
    pub path: String,
    pub title: String,
    pub tags: Vec<String>,
    pub created: String,
    pub updated: String,
    pub kind: String,
    pub children: Option<Vec<NoteMeta>>,
    pub raw_body: String,
    pub links: Vec<String>,
    pub ai_summary: Option<String>,
    pub ai_analyzed_at: Option<String>,
    pub ai_relations: Option<Vec<NoteRelation>>,
    pub annotations: Option<Vec<NoteAnnotation>>,
    pub graph_excluded: Option<bool>,
    pub raw_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteData {
    pub title: String,
    pub tags: Vec<String>,
    pub body: String,
    pub ai_summary: Option<String>,
    pub ai_relations: Option<Vec<NoteRelation>>,
    pub ai_analyzed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub tags: Vec<String>,
    pub degree: u32,
    pub strength: f64,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub vx: Option<f64>,
    pub vy: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub edge_type: String, // "link" | "tag" | "ai"
    pub weight: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub path: String,
    pub title: String,
    pub snippet: String,
    pub score: f64,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagWithCount {
    pub tag: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AISuggestion {
    pub tags: Option<Vec<String>>,
    pub summary: Option<String>,
    pub relations: Option<Vec<NoteRelation>>,
    pub suggestions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestConcept {
    pub name: String,
    pub name_en: Option<String>,
    pub definition: String,
    pub match_slug: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestEntity {
    pub name: String,
    #[serde(rename = "type")]
    pub entity_type: String,
    pub description: String,
    pub match_slug: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestAnalysis {
    pub slug: String,
    pub title: String,
    pub summary: String,
    pub key_points: Vec<String>,
    pub concepts: Vec<IngestConcept>,
    pub entities: Vec<IngestEntity>,
    pub contradictions: Option<Vec<String>>,
    pub answered_questions: Option<Vec<String>>,
    pub language: Option<String>,
    pub canonical_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmHighItem {
    pub slug: String,
    pub title: String,
    pub source_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestResult {
    pub source_path: String,
    pub concept_paths: Vec<String>,
    pub entity_paths: Vec<String>,
    pub created: Vec<String>,
    pub updated: Vec<String>,
    pub log_entry: String,
    pub confirm_high: Option<Vec<ConfirmHighItem>>,
    pub answered_questions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchIngestStartResult {
    pub raw_file: String,
    pub first: IngestResult,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchIngestDoneResult {
    pub results: Vec<IngestResult>,
    pub errors: Vec<BatchError>,
    pub confirm_high: Vec<ConfirmHighItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchError {
    pub path: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisTag {
    pub tag: String,
    pub template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAnalysisOutput {
    pub summary: String,
    pub report: String,
    pub analysis_tags: Vec<AnalysisTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAnalyzeFileResult {
    pub name: String,
    pub rel_path: Option<String>,
    pub source_path: Option<String>,
    pub ingest_error: Option<String>,
    pub analysis_error: Option<String>,
    pub analysis: Option<CustomAnalysisOutput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAnalyzeResult {
    pub files: Vec<ImportAnalyzeFileResult>,
    pub new_tags: Vec<AnalysisTag>,
    pub confirm_high: Vec<ConfirmHighItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowResult {
    pub ok: bool,
    pub report_path: String,
    pub summary: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LintWorkflowResult {
    pub ok: bool,
    pub report_path: String,
    pub summary: String,
    pub error: Option<String>,
    pub issues: Vec<String>,
    pub modified_raw_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestProgress {
    pub file: String,
    pub stage: String,
    pub percent: u32,
    pub done: Option<bool>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum VaultChangeEvent {
    #[serde(rename = "created")]
    Created { path: String },
    #[serde(rename = "modified")]
    Modified { path: String },
    #[serde(rename = "deleted")]
    Deleted { path: String },
}

/// Graph input for GraphEngine::rebuild
#[derive(Debug, Clone)]
pub struct GraphInput {
    pub path: String,
    pub title: String,
    pub tags: Vec<String>,
    pub links: Vec<String>,
}
