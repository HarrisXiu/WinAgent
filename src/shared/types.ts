// 跨进程共享的类型定义

export type ProviderType = 'openai' | 'ollama'

export interface ProviderConfig {
  id: string
  label: string
  type: ProviderType
  /** OpenAI 类型请含 /v1，例如 https://api.openai.com/v1；Ollama 类型填 http://localhost:11434 */
  baseUrl: string
  apiKey: string
  model: string
  /** 是否支持图片识别（vision）：undefined=自动检测，true/false=用户显式指定 */
  supportsVision?: boolean
}

/**
 * 视觉辅助：主模型不支持图片识别时，先调用另一个视觉模型描述图片，
 * 再把描述文本交给主模型继续完成任务。
 */
export interface VisionAssistConfig {
  /** 是否启用 */
  enabled: boolean
  /**
   * 用作视觉识别的 provider id。
   * 留空表示「与主模型同一 API」，复用当前 provider 的 baseUrl / apiKey，仅换模型名。
   */
  providerId: string
  /**
   * 视觉模型名。同一 API 双模型时必填；
   * 选了其他 provider 时留空则用该 provider 自己的模型。
   */
  model: string
  /** 给视觉模型的指令，留空用内置默认值 */
  prompt: string
}

/**
 * 深度思考（推理）开关。
 * auto=不下发任何思考参数，由模型自己决定；on/off=显式要求开启或关闭。
 * 若目标 API 不认识该参数，客户端会自动去掉参数重试一次。
 */
export type ThinkingMode = 'auto' | 'on' | 'off'

/**
 * 对话模式：已合并为单一桌宠模式（安洁莉娜人设 + 完整 Agent 工具能力）
 * 保留字段兼容旧配置
 */
export type ChatMode = 'pet'

export interface AppConfig {
  activeProviderId: string
  providers: ProviderConfig[]
  temperature: number
  maxTokens: number
  systemPrompt: string
  /** 危险工具是否自动放行（不弹确认） */
  autoApproveTools: boolean
  /** 历史 token 超过该值触发上下文压缩 */
  compactThresholdTokens: number
  /** 压缩时保留最近轮数 */
  keepRecentTurns: number
  /** skills 目录（相对应用根或绝对路径） */
  skillsDir: string
  /** mcp 配置文件路径 */
  mcpConfigPath: string
  /** 视觉辅助：纯语言主模型 + 外部视觉模型协作 */
  visionAssist: VisionAssistConfig
  /** 是否使用流式输出（关闭后一次性返回完整回复） */
  stream: boolean
  /** 深度思考开关 */
  thinkingMode: ThinkingMode
  /** 对话模式：agent=专业助手 / pet=桌宠角色 */
  chatMode: ChatMode
  /** 桌宠模式人设提示词（角色扮演） */
  petPrompt: string
  /** Wiki 个人知识库 Vault 路径（默认相对于 dataDir） */
  vaultPath: string
}

export interface ToolParameter {
  type: string
  description?: string
  [k: string]: unknown
}

export interface ToolSchema {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, ToolParameter>
    required?: string[]
  }
}

/** 单次请求的 token 用量 */
export interface TokenUsage {
  prompt: number
  completion: number
  total: number
  /** true = 接口未返回 usage，由本地估算得出 */
  estimated: boolean
}

export type ToolSource = 'builtin' | 'skill' | 'mcp'

export interface ToolCall {
  id: string
  name: string
  arguments: string // JSON string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
  reasoning_content?: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

// 主进程 -> 渲染进程 的流式事件
export type AgentEvent =
  | { type: 'round'; round: number; historyCount: number }
  | { type: 'assistant_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'assistant_message'; content: string; reasoning?: string }
  | { type: 'tool_call'; id: string; name: string; args: string; source: ToolSource }
  | { type: 'tool_result'; id: string; name: string; result: string; ok: boolean }
  | { type: 'compact'; before: number; after: number }
  | { type: 'vision'; status: 'start' | 'done' | 'error'; model: string; text?: string }
  | { type: 'usage'; last: TokenUsage; session: TokenUsage }
  | { type: 'error'; message: string }
  | { type: 'done' }

export interface ToolInfo {
  name: string
  description: string
  source: ToolSource
  dangerous: boolean
}

export interface ModelInfo {
  id: string
}

// ==================== Wiki 知识库类型 ====================

/** 笔记元数据（轻量，不含正文） */
export interface NoteMeta {
  path: string           // 相对于 vault 根目录, 如 "projects/my-note.md"
  title: string          // 显示标题
  tags: string[]
  created: string        // ISO 时间戳
  updated: string
  kind: 'file' | 'folder'
  children?: NoteMeta[]  // 文件夹子项
}

/** 笔记注释/批注 */
export interface NoteAnnotation {
  id: string
  text: string
  range: string          // "line:3-5" 或 "paragraph:2"
  created: string
}

/** 笔记完整内容 */
export interface NoteContent extends NoteMeta {
  rawBody: string        // frontmatter 之后的 markdown 正文
  links: string[]        // 解析出的 [[wiki-link]] 目标列表
  aiSummary?: string
  aiAnalyzedAt?: string
  annotations?: NoteAnnotation[]
  /** frontmatter graph-excluded 标记（系统文件不参与图谱） */
  graphExcluded?: boolean
  /** frontmatter raw_file 字段（source/personal-writing 页指向的原始文件 relPath，双栏对照用） */
  rawFile?: string
}

/** 写入笔记的数据 */
export interface NoteData {
  title: string
  tags: string[]
  body: string
}

/** 图谱节点 */
export interface GraphNode {
  id: string             // 笔记路径(无扩展名)
  label: string
  tags: string[]
  degree: number
  strength: number       // 0-1
  x?: number
  y?: number
  vx?: number
  vy?: number
}

/** 图谱边 */
export interface GraphEdge {
  source: string
  target: string
  type: 'link' | 'tag' | 'ai'
  weight: number
}

/** 图谱数据 */
export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** 搜索结果 */
export interface SearchResult {
  path: string
  title: string
  snippet: string
  score: number
}

/** 标签及计数 */
export interface TagWithCount {
  tag: string
  count: number
}

/** AI 分析建议 */
export interface AISuggestion {
  tags?: string[]
  summary?: string
  relations?: Array<{ target: string; reason: string }>
}

/** INGEST 单次 LLM 分析结果（LLM Wiki 编译模式） */
export interface IngestConcept {
  name: string              // 概念中文名
  nameEn?: string           // 概念英文名
  definition: string        // 一句话定义
  matchSlug?: string        // 命中已有概念时填入其 slug（LLM 从传入列表中判断）
}

export interface IngestEntity {
  name: string
  type: string              // person / tool / institution / paper
  description: string
  matchSlug?: string
}

export interface IngestAnalysis {
  slug: string              // 英文小写连字符，如 attention-is-all-you-need
  title: string             // 中文标题
  summary: string           // 2-4 句摘要
  keyPoints: string[]       // 3-8 条核心要点
  concepts: IngestConcept[]
  entities: IngestEntity[]
  contradictions?: string[] // 与其他来源的分歧
  answeredQuestions?: string[] // 匹配到的开放问题（来自 QUESTIONS.md）
  /** 来源写作语言（如 zh / en），用于跨语言合并检测 */
  language?: string
  /** 若本来源是译文/转述，填原始出处（URL 或标题）；原创来源省略 */
  canonicalSource?: string
}

/** INGEST 完成后的结果（返回前端展示） */
export interface IngestResult {
  sourcePath: string        // wiki/sources/<slug>.md
  conceptPaths: string[]    // 新建/更新的概念页
  entityPaths: string[]     // 新建/更新的实体页
  created: string[]         // 新建的路径
  updated: string[]         // 更新的路径
  logEntry: string          // 写入 log.md 的条目
  /** 达到 5+ 来源且非 high 的概念（等待用户确认晋升） */
  confirmHigh?: Array<{ slug: string; title: string; sourceCount: number }>
  /** 本来源回答了的开放问题 */
  answeredQuestions?: string[]
}

/** 批量摄入：首篇编译完成后的暂停态（交互式标定） */
export interface BatchIngestStartResult {
  /** 第一批原始文件 relPath（双栏对照用） */
  rawFile: string
  first: IngestResult
  /** 批量总数（含已编译的首篇） */
  total: number
}

/** 批量摄入：剩余文件全部编译完成后的汇总 */
export interface BatchIngestDoneResult {
  results: IngestResult[]
  errors: Array<{ path: string; error: string }>
  /** 聚合的待确认 high 概念（按 slug 去重） */
  confirmHigh: Array<{ slug: string; title: string; sourceCount: number }>
}

/** 工作流（LINT/REFLECT/MERGE/QUERY）统一返回 */
export interface WorkflowResult {
  ok: boolean
  /** 报告页 relPath（渲染层在编辑器中打开它） */
  reportPath: string
  summary: string
  error?: string
}

/** LINT 结果（UI 需要结构化 issues 与重新摄入列表） */
export interface LintWorkflowResult extends WorkflowResult {
  /** 全部问题行（含检查编号） */
  issues: string[]
  /** 检查 6 SHA-256 变化的 raw 文件路径（UI 提供「重新摄入」按钮） */
  modifiedRawFiles: string[]
}

/** INGEST 进度事件（主进程 → 渲染进程） */
export interface IngestProgress {
  file: string              // 正在处理的源文件名
  stage: string             // 阶段描述（中文）
  percent: number           // 0-100
  done?: boolean            // true = 处理完成
  error?: string            // 错误信息（失败时）
}

/** Vault 文件变更事件（主→渲染推送） */
export type VaultChangeEvent =
  | { type: 'created'; path: string }
  | { type: 'modified'; path: string }
  | { type: 'deleted'; path: string }
