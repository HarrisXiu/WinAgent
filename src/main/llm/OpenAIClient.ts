import type {
  ChatMessage,
  ProviderConfig,
  ThinkingMode,
  TokenUsage,
  ToolCall,
  ToolSchema
} from '../../shared/types'

export interface ChatOptions {
  temperature: number
  maxTokens: number
  tools?: ToolSchema[]
  signal?: AbortSignal
  /** 默认 true；为 false 时一次性返回完整回复 */
  stream?: boolean
  /** 深度思考开关，默认 auto（不下发参数） */
  thinking?: ThinkingMode
}

export interface ChatResult {
  content: string
  reasoning: string
  toolCalls: ToolCall[]
  finishReason: string
  /** 接口返回的 token 用量；未返回时为 undefined，由调用方估算 */
  usage?: TokenUsage
}

export interface StreamCallbacks {
  onContent?: (delta: string) => void
  onReasoning?: (delta: string) => void
}

function chatUrl(p: ProviderConfig): string {
  const base = p.baseUrl.replace(/\/$/, '')
  if (p.type === 'ollama') return `${base}/v1/chat/completions`
  return `${base}/chat/completions`
}

function headers(p: ProviderConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (p.apiKey) h['Authorization'] = `Bearer ${p.apiKey}`
  return h
}

/** 清洗消息以兼容 Ollama 的 OpenAI 兼容端点 */
function sanitizeMessages(messages: ChatMessage[]): any[] {
  return messages.map((m) => {
    const out: Record<string, unknown> = { role: m.role }

    if (m.role === 'assistant') {
      // content 为空字符串且有 tool_calls 时，Ollama 要求 content 为 null
      out.content = m.content || null
      // 不发 reasoning_content（Ollama 不认识）
      if (m.tool_calls && m.tool_calls.length > 0) {
        out.tool_calls = m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments || '{}' }
        }))
      }
    } else if (m.role === 'tool') {
      out.content = m.content
      out.tool_call_id = m.tool_call_id
      // Ollama 需要 name 字段
      if (m.name) out.name = m.name
    } else {
      // user / system：content 可以是 string 或 multipart array
      out.content = m.content
    }

    return out
  })
}

interface ToolCallAccum {
  id: string
  name: string
  args: string
}

/**
 * 深度思考参数。各家兼容端字段不统一，同时下发主流几种：
 * - `enable_thinking`：Qwen3 / vLLM / 多数国内网关
 * - `reasoning.enabled`：OpenRouter
 * - `thinking.type`：Claude 兼容端
 * 不认识的网关会忽略；若报错则由上层去参重试。
 */
function applyThinking(body: Record<string, unknown>, mode: ThinkingMode): void {
  if (mode === 'auto') return
  const on = mode === 'on'
  body.enable_thinking = on
  body.reasoning = { enabled: on }
  body.thinking = { type: on ? 'enabled' : 'disabled' }
}

/** 判断报错是否因为网关不认识思考相关参数 */
function isUnknownThinkingParamError(msg: string): boolean {
  const m = msg.toLowerCase()
  const mentionsParam =
    m.includes('enable_thinking') || m.includes('reasoning') || m.includes('thinking')
  const mentionsReject =
    m.includes('unknown') ||
    m.includes('unrecognized') ||
    m.includes('unsupported') ||
    m.includes('not support') ||
    m.includes('invalid') ||
    m.includes('extra input') ||
    m.includes('additional propert')
  return mentionsParam && mentionsReject
}

/** 解析 OpenAI 风格的 usage 字段 */
function parseUsage(u: any): TokenUsage | undefined {
  if (!u) return undefined
  const prompt = Number(u.prompt_tokens ?? u.input_tokens ?? 0)
  const completion = Number(u.completion_tokens ?? u.output_tokens ?? 0)
  const total = Number(u.total_tokens ?? prompt + completion)
  if (!prompt && !completion && !total) return undefined
  return { prompt, completion, total, estimated: false }
}

/** 从非流式响应中提取结果 */
function parseNonStream(json: any, cb: StreamCallbacks): ChatResult {
  const choice = json.choices?.[0] || {}
  const msg = choice.message || {}
  const content: string = typeof msg.content === 'string' ? msg.content : ''
  const reasoning: string =
    typeof msg.reasoning_content === 'string'
      ? msg.reasoning_content
      : typeof msg.reasoning === 'string'
        ? msg.reasoning
        : ''

  // 非流式也回调一次，让界面拿到内容
  if (reasoning) cb.onReasoning?.(reasoning)
  if (content) cb.onContent?.(content)

  const toolCalls: ToolCall[] = Array.isArray(msg.tool_calls)
    ? msg.tool_calls
        .map((tc: any, i: number) => ({
          id: tc.id || `call_${i}`,
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || '{}'
        }))
        .filter((t: ToolCall) => t.name)
    : []

  const finishReason = choice.finish_reason || (toolCalls.length > 0 ? 'tool_calls' : 'stop')
  return { content, reasoning, toolCalls, finishReason, usage: parseUsage(json.usage) }
}

export async function chatStream(
  provider: ProviderConfig,
  messages: ChatMessage[],
  opts: ChatOptions,
  cb: StreamCallbacks = {}
): Promise<ChatResult> {
  const thinking = opts.thinking ?? 'auto'
  try {
    return await request(provider, messages, opts, cb, thinking)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // 网关不认识思考参数：去掉参数重试一次
    if (thinking !== 'auto' && isUnknownThinkingParamError(msg)) {
      return request(provider, messages, opts, cb, 'auto')
    }
    throw e
  }
}

async function request(
  provider: ProviderConfig,
  messages: ChatMessage[],
  opts: ChatOptions,
  cb: StreamCallbacks,
  thinking: ThinkingMode
): Promise<ChatResult> {
  const useStream = opts.stream !== false
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: sanitizeMessages(messages),
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
    stream: useStream
  }
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({ type: 'function', function: t }))
    body.tool_choice = 'auto'
  }
  // 让流式响应在最后一个 chunk 里带上 usage（OpenAI 及多数兼容端支持）
  if (useStream) body.stream_options = { include_usage: true }
  applyThinking(body, thinking)

  const res = await fetch(chatUrl(provider), {
    method: 'POST',
    headers: headers(provider),
    body: JSON.stringify(body),
    signal: opts.signal
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`LLM 请求失败 [${res.status}] ${text.slice(0, 500)}`)
  }

  if (!useStream) {
    return parseNonStream(await res.json(), cb)
  }

  if (!res.body) {
    throw new Error('LLM 请求失败：响应体为空')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  let finishReason = ''
  let usage: TokenUsage | undefined
  const toolAccum: Record<number, ToolCallAccum> = {}

  const handleData = (data: string): void => {
    if (data === '[DONE]') return
    let json: any
    try {
      json = JSON.parse(data)
    } catch {
      return
    }
    // usage 通常在最后一个 chunk，该 chunk 的 choices 可能为空数组
    const u = parseUsage(json.usage)
    if (u) usage = u

    const choice = json.choices?.[0]
    if (!choice) return
    const delta = choice.delta || {}
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content
      cb.onContent?.(delta.content)
    }
    // reasoning_content：DeepSeek/Qwen 等；reasoning：OpenRouter
    const reasoningDelta =
      typeof delta.reasoning_content === 'string' && delta.reasoning_content
        ? delta.reasoning_content
        : typeof delta.reasoning === 'string' && delta.reasoning
          ? delta.reasoning
          : ''
    if (reasoningDelta) {
      reasoning += reasoningDelta
      cb.onReasoning?.(reasoningDelta)
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0
        if (!toolAccum[idx]) toolAccum[idx] = { id: '', name: '', args: '' }
        if (tc.id) toolAccum[idx].id = tc.id
        if (tc.function?.name) toolAccum[idx].name = tc.function.name
        if (tc.function?.arguments) toolAccum[idx].args += tc.function.arguments
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      handleData(trimmed.slice(5).trim())
    }
  }

  const toolCalls: ToolCall[] = Object.keys(toolAccum)
    .map((k) => Number(k))
    .sort((a, b) => a - b)
    .map((i) => {
      const t = toolAccum[i]
      return { id: t.id || `call_${i}`, name: t.name, arguments: t.args || '{}' }
    })
    .filter((t) => t.name)

  if (!finishReason) finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop'
  return { content, reasoning, toolCalls, finishReason, usage }
}

/** 拉取可用模型列表 */
export async function fetchModels(provider: ProviderConfig): Promise<string[]> {
  const base = provider.baseUrl.replace(/\/$/, '')
  if (provider.type === 'ollama') {
    const res = await fetch(`${base}/api/tags`)
    if (!res.ok) throw new Error(`Ollama /api/tags 失败 [${res.status}]`)
    const json: any = await res.json()
    return (json.models || []).map((m: any) => m.name).filter(Boolean)
  }
  const res = await fetch(`${base}/models`, { headers: headers(provider) })
  if (!res.ok) throw new Error(`/models 失败 [${res.status}]`)
  const json: any = await res.json()
  return (json.data || []).map((m: any) => m.id).filter(Boolean)
}
