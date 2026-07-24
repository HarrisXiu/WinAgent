import type { AgentEvent, AppConfig, ChatMessage } from '../../shared/types'
import type { ToolRegistry } from '../tools/ToolRegistry'
import type { ConfigStore } from '../config/ConfigStore'
import { chatStream } from '../llm/OpenAIClient'
import { ContextManager, estimateTokens } from './ContextManager'
import { Logger } from '../util/Logger'

const MAX_ROUNDS = 25

export interface AgentCallbacks {
  onEvent: (e: AgentEvent) => void
  confirmTool: (name: string, args: string) => Promise<boolean>
}

export class AgentService {
  private history: ChatMessage[] = []
  private abort: AbortController | null = null

  constructor(private store: ConfigStore, private registry: ToolRegistry) {}

  reset(): void {
    this.history = []
  }

  stop(): void {
    this.abort?.abort()
  }

  getHistory(): ChatMessage[] {
    return this.history
  }

  private systemMessage(cfg: AppConfig): ChatMessage {
    return { role: 'system', content: cfg.systemPrompt }
  }

  async process(userInput: string, cb: AgentCallbacks, attachments?: any[]): Promise<void> {
    const cfg = this.store.get()
    const provider = this.store.activeProvider()
    const ctx = new ContextManager(cfg)
    this.abort = new AbortController()

    // 构建用户消息（含附件）
    let userContent: ChatMessage['content'] = userInput
    if (attachments && attachments.length > 0) {
      // 检测模型是否可能支持 vision
      const modelLower = provider.model.toLowerCase()
      const visionKeywords = ['gpt-4o', 'gpt-4-turbo', 'gpt-4-vision', 'vision', 'vl', 'llava', 'vlm', 'gemini', 'claude-3', 'qwen-vl', 'qwen2.5-vl']
      const supportsVision = visionKeywords.some((k) => modelLower.includes(k))

      if (supportsVision) {
        // 支持 vision：发送 multipart 消息
        const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []
        const textParts: string[] = [userInput]
        for (const att of attachments) {
          if (att.isImage && att.dataUrl) {
            parts.push({ type: 'image_url', image_url: { url: att.dataUrl } })
          } else if (att.textContent) {
            textParts.push(`\n[文件: ${att.name}]\n${att.textContent}`)
          } else {
            textParts.push(`\n[附件: ${att.name}]（路径: ${att.path}）`)
          }
        }
        parts.unshift({ type: 'text', text: textParts.join('') })
        userContent = parts
      } else {
        // 不支持 vision：图片转为路径描述，文本照常内嵌
        const textParts: string[] = [userInput]
        for (const att of attachments) {
          if (att.isImage) {
            textParts.push(`\n[图片: ${att.name}]（路径: ${att.path}）注意：当前模型不支持图片识别，如需分析图片内容请切换到支持 vision 的模型。`)
          } else if (att.textContent) {
            textParts.push(`\n[文件: ${att.name}]\n${att.textContent}`)
          } else {
            textParts.push(`\n[附件: ${att.name}]（路径: ${att.path}）`)
          }
        }
        userContent = textParts.join('')
      }
    }

    this.history.push({ role: 'user', content: userContent })
    Logger.info(`[USER] ${userInput}${attachments ? ` (+${attachments.length} 附件)` : ''}`)

    try {
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        // 上下文压缩
        if (ctx.needsCompact(this.history)) {
          const before = estimateTokens(this.history)
          this.history = await ctx.compact(provider, this.history)
          const after = estimateTokens(this.history)
          cb.onEvent({ type: 'compact', before, after })
          Logger.info(`[Compact] ${before} → ${after} tokens`)
        }

        cb.onEvent({ type: 'round', round, historyCount: this.history.length })

        const messages = [this.systemMessage(cfg), ...this.history]
        const tools = this.registry.getSchemas()

        const result = await chatStream(
          provider,
          messages,
          {
            temperature: cfg.temperature,
            maxTokens: cfg.maxTokens,
            tools,
            signal: this.abort.signal
          },
          {
            onContent: (d) => cb.onEvent({ type: 'assistant_delta', text: d }),
            onReasoning: (d) => cb.onEvent({ type: 'reasoning_delta', text: d })
          }
        )

        cb.onEvent({ type: 'assistant_message', content: result.content, reasoning: result.reasoning })

        // 记录助手消息
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: result.content,
          reasoning_content: result.reasoning || undefined,
          tool_calls: result.toolCalls.length
            ? result.toolCalls.map((tc) => ({
                id: tc.id,
                name: tc.name,
                // 确保 arguments 是合法 JSON 字符串
                arguments: (() => {
                  try {
                    return JSON.stringify(JSON.parse(tc.arguments || '{}'))
                  } catch {
                    return '{}'
                  }
                })()
              }))
            : undefined
        }
        this.history.push(assistantMsg)

        if (result.finishReason !== 'tool_calls' || result.toolCalls.length === 0) {
          break // 完成
        }

        // 执行每个工具
        for (const call of result.toolCalls) {
          const source = this.registry.getSource(call.name)
          cb.onEvent({ type: 'tool_call', id: call.id, name: call.name, args: call.arguments, source })
          Logger.info(`[TOOL CALL] ${call.name} ${call.arguments}`)

          let args: Record<string, any> = {}
          try {
            args = call.arguments ? JSON.parse(call.arguments) : {}
          } catch {
            /* 保持空参数 */
          }

          // 危险操作确认
          if (this.registry.isDangerous(call.name) && !cfg.autoApproveTools) {
            const approved = await cb.confirmTool(call.name, call.arguments)
            if (!approved) {
              const denied = '用户拒绝了该操作'
              cb.onEvent({ type: 'tool_result', id: call.id, name: call.name, result: denied, ok: false })
              this.history.push({ role: 'tool', content: denied, tool_call_id: call.id, name: call.name })
              continue
            }
          }

          const { ok, result: toolResult } = await this.registry.execute(call.name, args)
          cb.onEvent({ type: 'tool_result', id: call.id, name: call.name, result: toolResult, ok })
          Logger.info(`[TOOL RESULT] ${call.name}: ${toolResult.slice(0, 200)}`)
          this.history.push({ role: 'tool', content: toolResult, tool_call_id: call.id, name: call.name })
        }
      }
      cb.onEvent({ type: 'done' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      cb.onEvent({ type: 'error', message: msg })
      Logger.error(`[Agent] ${msg}`)
    } finally {
      this.abort = null
    }
  }

  async compactNow(cb: AgentCallbacks): Promise<void> {
    const cfg = this.store.get()
    const provider = this.store.activeProvider()
    const ctx = new ContextManager(cfg)
    const before = estimateTokens(this.history)
    this.history = await ctx.compact(provider, this.history)
    const after = estimateTokens(this.history)
    cb.onEvent({ type: 'compact', before, after })
  }
}
