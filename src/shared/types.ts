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
