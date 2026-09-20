/**
 * 小米 MiMo TTS 客户端（OpenAI 兼容接口）。
 *
 * 端点与鉴权同 OpenAIClient 模式：POST {baseUrl}/chat/completions，
 * Authorization: Bearer <key>。请求体用 chat 结构承载 TTS：
 *   messages: [{role:'user', content: 风格指令}, {role:'assistant', content: 待合成文本}]
 *   audio: { format, voice }
 * 响应取 choices[0].message.audio.data（base64 音频字节）。
 *
 * 克隆音色无服务端注册：voice 传 `data:audio/wav;base64,...` 样本 dataURL，
 * 模型自动切换为 mimo-v2.5-tts-voiceclone。
 *
 * 职责边界：本文件只做「清洗 + 单段合成」；长文本切分见 segment.ts，
 * 会话编排（分段/滑窗预取/取消）见 SpeechSession.ts。
 */
import { Logger } from '../util/Logger'
import type { TtsResult } from '../shared/types'

export interface BuiltinVoice {
  value: string
  label: string
}

/** MiMo TTS 内置音色（官方文档 9 个；mimo_default 在中国区即「冰糖」） */
export const BUILTIN_VOICES: BuiltinVoice[] = [
  { value: 'mimo_default', label: '默认音色' },
  { value: '冰糖', label: '冰糖 · 中文女声' },
  { value: '茉莉', label: '茉莉 · 中文女声' },
  { value: '苏打', label: '苏打 · 中文男声' },
  { value: '白桦', label: '白桦 · 中文男声' },
  { value: 'Mia', label: 'Mia · 英文女声' },
  { value: 'Chloe', label: 'Chloe · 英文女声' },
  { value: 'Milo', label: 'Milo · 英文男声' },
  { value: 'Dean', label: 'Dean · 英文男声' }
]

/** 取消哨兵：合成被中止时统一抛出（跨 IPC 后错误信息会被加前缀，用 isCancelled 判定） */
export const TTS_CANCELLED = 'TTS_CANCELLED'

/** 是否为取消（本地 AbortError 或跨 IPC 传回的 TTS_CANCELLED 哨兵） */
export function isCancelled(e: unknown): boolean {
  if (e instanceof Error) {
    if (e.name === 'AbortError') return true
    if (e.message === TTS_CANCELLED) return true
    // Electron invoke 包装后的错误："Error invoking remote method…: TTS_CANCELLED"
    return e.message.includes(TTS_CANCELLED)
  }
  return false
}

/** 按状态码映射用户可读的中文错误；原始响应体只进 Logger，不抛给界面 */
function friendlyHttpError(status: number): string {
  if (status === 401 || status === 403) return 'TTS API Key 无效或已过期，请在设置 → 语音中检查'
  if (status === 429) return 'TTS 请求频率超限，请稍后再试'
  if (status >= 500) return 'TTS 服务暂不可用，请稍后再试'
  return `TTS 请求失败（HTTP ${status}）`
}

/** 待合成文本的预处理：剥成适合朗读的纯文本（清洗，不切分、不截断） */
export function plainTextForSpeech(md: string): string {
  let t = md || ''
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, ' ') // 思维链标签整段剥掉
  t = t.replace(/```[\s\S]*?```/g, ' ') // 代码围栏整块剥掉
  t = t.replace(/~~~[\s\S]*?~~~/g, ' ')
  t = t.replace(/`([^`]*)`/g, '$1') // 行内代码留文字
  t = t.replace(/<\/?[a-z][^>]*>/gi, ' ') // 残留 HTML 标签
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接只留文字
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '') // 标题符号
  t = t.replace(/\*\*\*(.+?)\*\*\*/g, '$1')
  t = t.replace(/\*\*(.+?)\*\*/g, '$1')
  t = t.replace(/__(.+?)__/g, '$1')
  t = t.replace(/\*(.+?)\*/g, '$1')
  t = t.replace(/_(.+?)_/g, '$1')
  t = t.replace(/~~(.+?)~~/g, '$1') // 删除线
  t = t.replace(/^\s*>\s?/gm, '') // 引用
  t = t.replace(/^\s*[-*+]\s+(\[[ x]\]\s+)?/gm, '') // 列表符号
  t = t.replace(/\|/g, ' ') // 表格竖线
  t = t.replace(/^-{3,}\s*$/gm, '') // 分隔线
  t = t.replace(/https?:\/\/\S+/g, '链接') // 裸 URL 不逐字朗读
  t = t.replace(/\p{Extended_Pictographic}/gu, ' ') // emoji（避免逐字念符号名）
  t = t.replace(/[\u{FE0F}\u{200D}\u{20E3}]/gu, '') // 变体选择符 / 零宽连接符 / 键帽残片
  t = t.replace(/\n{2,}/g, '\n')
  return t.trim()
}

export interface SpeakRequest {
  apiKey: string
  /** 如 https://api.xiaomimimo.com/v1 */
  baseUrl: string
  /** 已预处理的待合成文本 */
  text: string
  /** 风格指令（user 角色），空传 '' */
  stylePrompt: string
  /** 内置音色名，或克隆样本 dataURL（data:audio/...;base64,...） */
  voice: string
  /** 输出格式 */
  outputFormat: 'wav' | 'mp3'
  signal?: AbortSignal
}

/** 组装 TTS 请求体（导出便于复用/测试） */
export function buildTtsBody(req: SpeakRequest): Record<string, unknown> {
  const isClone = req.voice.startsWith('data:')
  return {
    model: isClone ? 'mimo-v2.5-tts-voiceclone' : 'mimo-v2.5-tts',
    messages: [
      { role: 'user', content: req.stylePrompt || '请用自然的语气朗读。' },
      { role: 'assistant', content: req.text }
    ],
    audio: { format: req.outputFormat, voice: req.voice },
    stream: false
  }
}

/** 合成单段语音：返回 base64 音频 + MIME */
export async function speak(req: SpeakRequest): Promise<TtsResult> {
  const base = req.baseUrl.replace(/\/$/, '')
  let res: Response
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${req.apiKey}`
      },
      body: JSON.stringify(buildTtsBody(req)),
      signal: req.signal
    })
  } catch (e) {
    if (isCancelled(e)) throw new Error(TTS_CANCELLED)
    // 网络层失败（DNS / 连接拒绝 / TLS 等）
    Logger.error('TTS 网络请求失败: ' + String((e as Error)?.message || e))
    throw new Error('无法连接语音服务，请检查网络或接口地址')
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    Logger.error(`TTS 请求失败 [${res.status}] ${body.slice(0, 500)}`)
    throw new Error(friendlyHttpError(res.status))
  }

  let json: any
  try {
    json = await res.json()
  } catch (e) {
    if (isCancelled(e)) throw new Error(TTS_CANCELLED)
    throw new Error('TTS 响应解析失败')
  }
  const audio = json?.choices?.[0]?.message?.audio
  const data = typeof audio?.data === 'string' ? audio.data : ''
  if (!data) {
    const errMsg = json?.error?.message || json?.message || ''
    throw new Error(`TTS 响应中没有音频数据${errMsg ? `: ${String(errMsg).slice(0, 200)}` : ''}`)
  }
  return { audioBase64: data, mime: req.outputFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav' }
}

/**
 * 二期预留：pcm16 真流式合成（本轮不实现，签名先行）。
 *
 * 落地路径：请求体改 `stream: true` + `audio.format: 'pcm16'`，按 OpenAIClient.chatStream
 * （../llm/OpenAIClient.ts）既有的 getReader() + TextDecoder + `data:` 行解析范式消费 SSE，
 * 每个 audio 增量帧回调 onChunk；渲染层 player.ts 增 PCM sink（AudioContext + AudioWorklet
 * 环形缓冲）替换 `<audio>` 路径。本轮的会话/ack/队列/控制条骨架可直接复用——届时只需把
 * 「一段 = 一个 wav blob」换成「一段 = 一串 PCM 帧」。
 */
export async function speakStream(_req: SpeakRequest, _onChunk: (pcmBase64: string) => void): Promise<void> {
  void _onChunk
  throw new Error('pcm16 真流式合成属二期规划，尚未实现')
}
