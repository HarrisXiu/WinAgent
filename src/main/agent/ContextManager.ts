import type { AppConfig, ChatMessage, ProviderConfig } from '../../shared/types'
import { chatStream } from '../llm/OpenAIClient'

/** 估算每张图片的 token 开销 */
const IMAGE_TOKEN_COST = 800
/** 预压缩阶段：旧工具结果保留的最大字符数 */
const TOOL_RESULT_KEEP_CHARS = 500

/** 提取消息的纯文本部分（multipart 时合并 text 片段） */
function contentText(c: ChatMessage['content']): string {
  if (typeof c === 'string') return c
  if (!Array.isArray(c)) return ''
  return c
    .filter((p) => p.type === 'text')
    .map((p) => (p as { type: 'text'; text: string }).text)
    .join('\n')
}

function contentTokens(c: ChatMessage['content']): number {
  if (typeof c === 'string') return Math.ceil(c.length / 3)
  if (!Array.isArray(c)) return 0
  let t = 0
  for (const p of c) {
    if (p.type === 'text') t += Math.ceil(p.text.length / 3)
    else t += IMAGE_TOKEN_COST // 图片按固定开销估算
  }
  return t
}

export function estimateTokens(messages: ChatMessage[]): number {
  let total = 0
  for (const m of messages) {
    total += contentTokens(m.content)
    if (m.reasoning_content) total += Math.ceil(m.reasoning_content.length / 3)
    if (m.tool_calls) total += Math.ceil(JSON.stringify(m.tool_calls).length / 3)
    total += 4 // 每条消息的固定开销
  }
  return total
}

/**
 * 寻找安全切分点：recent 不能以 tool 消息开头
 * （否则其对应的 assistant tool_calls 被切走，API 会报错）
 */
function safeSplitIndex(history: ChatMessage[], desired: number): number {
  let idx = desired
  while (idx > 0 && history[idx].role === 'tool') idx--
  return idx
}

const COMPACT_SYSTEM = `你是对话历史压缩器。请把下面的多轮对话（用户与助手及工具调用）压缩成简洁的中文摘要，
保留：用户目标、已完成的关键操作、重要的文件路径/命令/结论、尚未完成的待办。丢弃寒暄与冗余。输出纯摘要文本。`

export class ContextManager {
  constructor(private cfg: AppConfig) {}

  needsCompact(history: ChatMessage[]): boolean {
    return estimateTokens(history) > this.cfg.compactThresholdTokens
  }

  /**
   * 两阶段压缩：
   * 阶段一（免 LLM）：截断旧的大体积工具结果、剥离旧消息中的图片，通常可释放大部分 token；
   * 阶段二（LLM 摘要）：若仍超阈值，把旧消息总结为一条 system 摘要，只保留最近轮次。
   * LLM 摘要失败时降级返回阶段一结果，不中断当前请求。
   */
  async compact(provider: ProviderConfig, history: ChatMessage[]): Promise<ChatMessage[]> {
    const keep = this.cfg.keepRecentTurns * 2
    if (history.length <= keep + 2) return history

    const split = safeSplitIndex(history, history.length - keep)
    if (split <= 0) return history

    // ── 阶段一：无损度较高的轻量压缩（截断旧工具结果 + 剥离旧图片）──
    const trimmed = history.map((m, i) => {
      if (i >= split) return m
      // 旧工具结果截断
      if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > TOOL_RESULT_KEEP_CHARS + 100) {
        return { ...m, content: m.content.slice(0, TOOL_RESULT_KEEP_CHARS) + `\n…[结果已截断，原 ${m.content.length} 字符]` }
      }
      // 旧 multipart 消息剥离图片（base64 体积大，且旧图片对后续推理价值低）
      if (Array.isArray(m.content)) {
        const text = contentText(m.content)
        const imgCount = m.content.filter((p) => p.type === 'image_url').length
        return { ...m, content: imgCount > 0 ? `${text}\n[${imgCount} 张图片已省略]` : text }
      }
      return m
    })

    // 阶段一已降到阈值 80% 以下：无需调用 LLM
    if (estimateTokens(trimmed) < this.cfg.compactThresholdTokens * 0.8) {
      return trimmed
    }

    // ── 阶段二：LLM 摘要旧消息 ──
    const older = trimmed.slice(0, split)
    const recent = trimmed.slice(split)
    const transcript = older
      .map((m) => {
        const text = contentText(m.content)
        if (m.role === 'tool') return `[工具结果:${m.name || ''}] ${text}`
        if (m.tool_calls) return `[助手] ${text}\n[调用] ${m.tool_calls.map((t) => `${t.name}(${t.arguments})`).join(', ')}`
        return `[${m.role}] ${text}`
      })
      .join('\n')
    // 超长时保留尾部（越接近现在的信息越重要）
    const capped = transcript.length > 40000 ? '…[更早内容已省略]\n' + transcript.slice(-40000) : transcript

    try {
      const res = await chatStream(
        provider,
        [
          { role: 'system', content: COMPACT_SYSTEM },
          { role: 'user', content: capped }
        ],
        { temperature: 0.2, maxTokens: 1024 }
      )
      const summary: ChatMessage = {
        role: 'system',
        content: `【历史摘要】\n${res.content}`
      }
      return [summary, ...recent]
    } catch {
      // 摘要失败：降级返回阶段一结果，保证对话不中断
      return trimmed
    }
  }
}
