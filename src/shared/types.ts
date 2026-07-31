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
