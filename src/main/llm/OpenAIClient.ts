import type { ChatMessage, ProviderConfig, ToolCall, ToolSchema } from '../../shared/types'

export interface ChatOptions {
  temperature: number
  maxTokens: number
  tools?: ToolSchema[]
  signal?: AbortSignal
}

export interface ChatResult {
  content: string
  reasoning: string
  toolCalls: ToolCall[]
  finishReason: string
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

export async function chatStream(
  provider: ProviderConfig,
  messages: ChatMessage[],
  opts: ChatOptions,
  cb: StreamCallbacks = {}
): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: sanitizeMessages(messages),
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
    stream: true
  }
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({ type: 'function', function: t }))
    body.tool_choice = 'auto'
  }

  const res = await fetch(chatUrl(provider), {
    method: 'POST',
    headers: headers(provider),
    body: JSON.stringify(body),
    signal: opts.signal
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`LLM 请求失败 [${res.status}] ${text.slice(0, 500)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  let finishReason = ''
  const toolAccum: Record<number, ToolCallAccum> = {}

  const handleData = (data: string): void => {
    if (data === '[DONE]') return
    let json: any
    try {
      json = JSON.parse(data)
    } catch {
      return
    }
    const choice = json.choices?.[0]
    if (!choice) return
    const delta = choice.delta || {}
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content
      cb.onContent?.(delta.content)
    }
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      reasoning += delta.reasoning_content
      cb.onReasoning?.(delta.reasoning_content)
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
  return { content, reasoning, toolCalls, finishReason }
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
