import type { AppConfig, ChatMessage, ProviderConfig } from '../../shared/types'
import { chatStream } from '../llm/OpenAIClient'

export function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0
  for (const m of messages) {
    chars += (m.content || '').length + (m.reasoning_content || '').length
    if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length
  }
  return Math.ceil(chars / 3)
}

const COMPACT_SYSTEM = `你是对话历史压缩器。请把下面的多轮对话（用户与助手及工具调用）压缩成简洁的中文摘要，
保留：用户目标、已完成的关键操作、重要的文件路径/命令/结论、尚未完成的待办。丢弃寒暄与冗余。输出纯摘要文本。`

export class ContextManager {
  constructor(private cfg: AppConfig) {}

  needsCompact(history: ChatMessage[]): boolean {
    return estimateTokens(history) > this.cfg.compactThresholdTokens
  }

  /** 压缩历史：保留最近 keepRecentTurns*2 条，其余总结为一条 system 摘要 */
  async compact(provider: ProviderConfig, history: ChatMessage[]): Promise<ChatMessage[]> {
    const keep = this.cfg.keepRecentTurns * 2
    if (history.length <= keep + 2) return history
    const older = history.slice(0, history.length - keep)
    const recent = history.slice(history.length - keep)
    const transcript = older
      .map((m) => {
        if (m.role === 'tool') return `[工具结果] ${m.content}`
        if (m.tool_calls) return `[助手] ${m.content}\n[调用] ${m.tool_calls.map((t) => t.name).join(', ')}`
        return `[${m.role}] ${m.content}`
      })
      .join('\n')

    const res = await chatStream(
      provider,
      [
        { role: 'system', content: COMPACT_SYSTEM },
        { role: 'user', content: transcript.slice(0, 40000) }
      ],
      { temperature: 0.2, maxTokens: 1024 }
    )
    const summary: ChatMessage = {
      role: 'system',
      content: `【历史摘要】\n${res.content}`
    }
    return [summary, ...recent]
  }
}
