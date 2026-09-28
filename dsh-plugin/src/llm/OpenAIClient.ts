import type {
  ChatMessage,
  ProviderConfig,
  ThinkingMode,
  TokenUsage,
  ToolCall,
  ToolSchema
} from '../shared/types'
import { knownOutputLimit, parseOutputLimitError, rememberOutputLimit } from './OutputLimit'

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

type ChatFetcher = (url: string, init?: RequestInit) => Promise<Response>
// 桌面宿主注入 Electron net.fetch 以沿用系统代理；插件宿主仍使用 Node fetch。
// 用闭包延迟读取 global fetch，测试和其他宿主替换 global.fetch 时仍然生效。
let chatFetcher: ChatFetcher = (url, init) => fetch(url, init)
export function setChatFetcher(fetcher?: ChatFetcher): void {
  chatFetcher = fetcher || ((url, init) => fetch(url, init))
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
  thinking: ThinkingMode,
  retriedLimit = false
): Promise<ChatResult> {
  const useStream = opts.stream !== false
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: sanitizeMessages(messages),
    temperature: opts.temperature,
    stream: useStream
  }
  const limit = knownOutputLimit(provider)?.value
  const requested = Number.isSafeInteger(opts.maxTokens) && opts.maxTokens > 0 ? opts.maxTokens : 0
  if (requested) body.max_tokens = limit ? Math.min(requested, limit) : requested
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({ type: 'function', function: t }))
    body.tool_choice = 'auto'
  }
  // 让流式响应在最后一个 chunk 里带上 usage（OpenAI 及多数兼容端支持）
  if (useStream) body.stream_options = { include_usage: true }
  applyThinking(body, thinking)

  const endpoint = chatUrl(provider)
  let res: Response
  try {
    res = await chatFetcher(endpoint, {
      method: 'POST',
      headers: headers(provider),
      body: JSON.stringify(body),
      signal: opts.signal
    })
  } catch (e) {
    if (opts.signal?.aborted) throw e
    throw modelNetworkError(e, endpoint)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const upper = res.status === 400 ? parseOutputLimitError(text) : null
    if (upper && !retriedLimit) {
      // Some gateways reject their own advertised boundary. Let the server choose in that case.
      const next = Number(body.max_tokens) > upper ? upper : 0
      await rememberOutputLimit(provider, next || null, next ? 'API 参数校验返回的输出上限' : `接口拒绝公布范围内的参数（上限 ${upper}），已改用服务端默认值`)
      return request(provider, messages, { ...opts, maxTokens: next }, cb, thinking, true)
    }
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

/** 只提取已知网络错误类别，避免把可能含 Key 的底层请求信息带到界面。 */
function modelNetworkError(error: unknown, endpoint: string): Error {
  const e = error as { name?: string; message?: string; code?: string; cause?: unknown; errors?: unknown[] }
  const codes: string[] = []
  const visit = (value: unknown, depth = 0): void => {
    if (!value || typeof value !== 'object' || depth > 4) return
    const item = value as typeof e
    if (typeof item.code === 'string') codes.push(item.code)
    if (typeof item.message === 'string') codes.push(...(item.message.match(/net::ERR_[A-Z_]+/g) || []))
    visit(item.cause, depth + 1)
    if (Array.isArray(item.errors)) item.errors.forEach((child) => visit(child, depth + 1))
  }
  visit(error)
  const detail = codes.join(' ')
  let hint = '网络连接失败，请检查网络和系统代理是否能访问该地址。'
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || /TIMED?_?OUT|TIMEOUT/.test(detail)) {
    hint = '请求超时，请检查网络、系统代理或服务是否正常。'
  } else if (/ENOTFOUND|EAI_AGAIN|NAME_NOT_RESOLVED/.test(detail)) {
    hint = '域名解析失败，请检查 Base URL、DNS 和系统代理。'
  } else if (/ECONNREFUSED|CONNECTION_REFUSED/.test(detail)) {
    hint = '连接被拒绝，请检查服务是否启动、端口是否正确；本地 Ollama 默认使用 11434 端口。'
  } else if (/CERT|TLS|SSL|SELF_SIGNED/.test(detail)) {
    hint = 'HTTPS 证书校验失败，请检查系统时间、证书信任或代理证书。'
  } else if (/PROXY|TUNNEL/.test(detail)) {
    hint = '代理连接失败，请检查系统代理是否启动、地址和端口是否正确。'
  } else if (/ECONNRESET|CONNECTION_RESET/.test(detail)) {
    hint = '连接被重置，请检查网络、系统代理或服务状态。'
  }
  return new Error(`${hint} 请求地址：${endpoint}`)
}

/** 拉取可用模型列表；桌面端可注入 Electron fetch，以遵循系统代理。 */
export async function fetchModels(
  provider: ProviderConfig,
  request: (url: string, init?: RequestInit) => Promise<Response> = fetch
): Promise<string[]> {
  const base = provider.baseUrl?.trim().replace(/\/+$/, '')
  let url: URL
  try {
    url = new URL(base)
  } catch {
    throw new Error('Base URL 无效，请填写完整的 http:// 或 https:// 接口地址。')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL 必须为 http:// 或 https:// 地址，不含账号、查询参数或片段；API Key 请填入独立字段。')
  }
  const endpoint = `${base}${provider.type === 'ollama' ? '/api/tags' : '/models'}`
  const signal = AbortSignal.timeout(15000)
  let res: Response
  try {
    res = await request(endpoint, {
      headers: provider.type === 'ollama' ? undefined : headers(provider),
      signal
    })
  } catch (e) {
    throw modelNetworkError(e, endpoint)
  }
  if (!res.ok) {
    const hint = res.status === 401 ? '认证失败，请检查 API Key 是否属于当前服务商。'
      : res.status === 403 ? '访问被拒绝，请检查 API Key 权限、接口访问限制或地区限制。'
      : res.status === 404 ? '模型列表接口不存在，请核对 Base URL；部分服务商需手动填写模型名称。'
      : res.status === 429 ? '请求过于频繁或配额不足，请稍后重试并检查服务商配额。'
      : res.status >= 500 ? '服务商暂时不可用，请稍后重试。'
      : '模型列表请求失败，请核对接口配置。'
    throw new Error(`${hint} [HTTP ${res.status}] 请求地址：${endpoint}`)
  }
  let json: any
  try {
    json = await res.json()
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw modelNetworkError(e, endpoint)
    throw new Error(`接口未返回有效 JSON，请确认 Base URL 指向 API 而非网页。请求地址：${endpoint}`)
  }
  const models = provider.type === 'ollama' ? json?.models : json?.data
  if (!Array.isArray(models)) {
    throw new Error(`模型列表格式不正确，请检查服务商类型和 Base URL。请求地址：${endpoint}`)
  }
  const names = models.map((m: any) => provider.type === 'ollama' ? m?.name : m?.id)
  return [...new Set(names.filter((name): name is string => typeof name === 'string' && name.length > 0))]
}
