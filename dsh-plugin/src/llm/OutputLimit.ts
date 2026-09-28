import type { ProviderConfig, OutputLimit } from '../shared/types'

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
const cache = new Map<string, OutputLimit>()
const pending = new Map<string, Promise<OutputLimit>>()
let observer: ((provider: ProviderConfig, limit: OutputLimit) => Promise<void>) | undefined
export const outputLimitKey = (p: ProviderConfig): string => `${p.type}|${p.baseUrl.trim().replace(/\/+$/, '')}|${p.model}`
export function setOutputLimitObserver(fn: typeof observer): void { observer = fn }
export function knownOutputLimit(p: ProviderConfig): OutputLimit | undefined {
  return cache.get(outputLimitKey(p)) || (p.outputLimit?.key === outputLimitKey(p) ? p.outputLimit : undefined)
}
export async function rememberOutputLimit(p: ProviderConfig, value: number | null, source: string): Promise<OutputLimit> {
  const result = { key: outputLimitKey(p), value, source, detectedAt: new Date().toISOString() }
  cache.set(result.key, result)
  await observer?.(p, result)
  return result
}
/** Only explicit output-token bounds count; context-window size is a different limit. */
export function parseOutputLimitError(message: string): number | null {
  if (!/max[_ ](?:completion[_ ])?tokens|output[_ ](?:token|tokens)/i.test(message)) return null
  const range = message.match(/(?:range[^\[\n]{0,50})\[\s*\d+\s*,\s*([\d,]+)\s*\]/i)
  const upper = message.match(/(?:max[_ ](?:completion[_ ])?tokens|output[_ ]tokens).{0,100}?(?:less than or equal to|at most|maximum(?: (?:value|of))?|<=|up to)\s*[:=]?\s*([\d,]+)/i)
  const value = Number((range?.[1] || upper?.[1] || '').replace(/,/g, ''))
  return Number.isSafeInteger(value) && value > 0 ? value : null
}
function fromMetadata(model: any): number | null {
  const values = [model?.outputTokenLimit, model?.max_output_tokens, model?.max_completion_tokens,
    model?.output_token_limit, model?.top_provider?.max_completion_tokens,
    model?.limits?.max_output_tokens, model?.capabilities?.max_output_tokens]
  return values.find(v => typeof v === 'number' && Number.isSafeInteger(v) && v > 0) ?? null
}
export async function detectOutputLimit(p: ProviderConfig, fetcher: Fetcher = fetch, force = false): Promise<OutputLimit> {
  if (!p.model.trim()) throw new Error('请先选择模型，再检测输出上限')
  const key = outputLimitKey(p)
  const cached = knownOutputLimit(p)
  if (!force && cached && Date.now() - Date.parse(cached.detectedAt) < 86400000) return cached
  if (pending.has(key)) return pending.get(key)!
  const work = (async () => {
    const base = p.baseUrl.trim().replace(/\/+$/, '')
    const url = new URL(base)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('API 地址无效')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (p.apiKey) headers.Authorization = `Bearer ${p.apiKey}`
    const read = async (endpoint: string, init: RequestInit = {}): Promise<Response> => fetcher(endpoint, { ...init, headers: init.headers || headers, signal: AbortSignal.timeout(12000) })
    const google = url.hostname === 'generativelanguage.googleapis.com'
    const endpoint = google
      ? `${url.origin}/v1beta/models/${encodeURIComponent(p.model.replace(/^models\//, ''))}`
      : p.type === 'ollama' ? `${base}/api/show` : `${base}/models`
    try {
      const res = await read(endpoint, google ? { headers: { 'x-goog-api-key': p.apiKey } } : p.type === 'ollama' ? { method: 'POST', body: JSON.stringify({ model: p.model }) } : {})
      if (res.ok) {
        const data = await res.json() as any
        const model = Array.isArray(data.data) ? data.data.find((m: any) => m.id === p.model) : data
        const limit = fromMetadata(model)
        if (limit) return rememberOutputLimit(p, limit, '模型接口元数据')
      } else if (res.status === 401 || res.status === 403) throw new Error(`输出上限检测认证失败 [${res.status}]，请检查 API Key 和模型权限`)
    } catch (e) { if (e instanceof Error && e.message.includes('认证失败')) throw e }
    // Local engines often do not publish an output cap. Never mistake num_ctx for it.
    if (p.type === 'ollama') return rememberOutputLimit(p, null, '接口未公布输出上限，使用服务端默认值')
    // A bounded, minimal validation probe: no conversation, files or tool definitions are sent.
    const res = await read(`${base}/chat/completions`, { method: 'POST', body: JSON.stringify({
      model: p.model, messages: [{ role: 'user', content: 'Reply only OK.' }], max_tokens: 2147483647, stream: true
    }) })
    if (!res.ok) {
      const message = await res.text()
      const limit = parseOutputLimitError(message)
      if (limit) return rememberOutputLimit(p, limit, 'API 参数校验返回的输出上限')
      if ([401,403,429].includes(res.status)) throw new Error(`输出上限检测失败 [${res.status}]，请检查认证、模型权限或配额`)
    } else { await res.body?.cancel() }
    return rememberOutputLimit(p, null, '接口未返回明确上限，使用服务端默认值')
  })()
  pending.set(key, work)
  try { return await work } finally { pending.delete(key) }
}
