import type { AgentEvent, AppConfig, ChatMessage, ProviderConfig, TokenUsage } from '../../shared/types'
import type { ToolRegistry } from '../tools/ToolRegistry'
import type { ConfigStore } from '../config/ConfigStore'
import { chatStream } from '../llm/OpenAIClient'
import { ContextManager, estimateTokens, IMAGE_TOKEN_COST } from './ContextManager'
import { Logger } from '../util/Logger'

const MAX_ROUNDS = 25

/** 模型名包含这些关键词时视为支持图片识别 */
const VISION_KEYWORDS = [
  'gpt-4o', 'gpt-4-turbo', 'gpt-4-vision', 'vision', 'vl', 'llava', 'vlm',
  'gemini', 'claude-3', 'qwen-vl', 'qwen2.5-vl', 'glm-4v', 'yi-vl', 'internvl'
]

/** 视觉辅助默认指令 */
const DEFAULT_VISION_PROMPT = `请完整、客观地描述图片内容。要求：
1. 先概括图片类型（截图/照片/图表/文档扫描等）
2. 逐项描述可见的文字（原文转写，不要意译）、数据、界面元素、图形结构
3. 数学公式用 LaTeX 语法转写
4. 表格用 Markdown 表格转写
5. 不要添加主观推测，只陈述看得到的内容`

/** 检测 provider 的模型是否支持 vision：用户显式设置优先，否则按模型名关键词自动检测 */
function detectVision(provider: ProviderConfig): boolean {
  if (provider.supportsVision !== undefined) return provider.supportsVision
  const modelLower = provider.model.toLowerCase()
  return VISION_KEYWORDS.some((k) => modelLower.includes(k))
}

/**
 * 解析视觉辅助使用的 provider。
 * - providerId 为空：复用主 provider 的 baseUrl/apiKey，仅换成 visionAssist.model（同一 API 双模型）
 * - providerId 有值：用该 provider，visionAssist.model 非空时覆盖其模型名
 * 解析结果与主模型完全相同（同 API 同模型）时返回 undefined，避免自己调自己。
 */
function resolveVisionProvider(cfg: AppConfig, main: ProviderConfig): ProviderConfig | undefined {
  const va = cfg.visionAssist
  if (!va.enabled) return undefined

  const base = va.providerId ? cfg.providers.find((p) => p.id === va.providerId) : main
  if (!base) return undefined

  const model = va.model.trim() || (va.providerId ? base.model : '')
  if (!model) return undefined
  if (base.id === main.id && model === main.model) return undefined

  // 强制标记为支持 vision，避免被关键词检测误判
  return { ...base, model, supportsVision: true }
}

/**
 * 判断报错是否为“模型不接受图片输入”。
 * 不同网关文案不一：OpenRouter 返回 "No endpoints found that support image input"，
 * OpenAI/其他兼容端多为 "does not support image" / "invalid content type image_url" 等。
 */
function isImageUnsupportedError(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    m.includes('support image input') ||
    m.includes('image input') ||
    m.includes('does not support image') ||
    m.includes("doesn't support image") ||
    m.includes('not support vision') ||
    m.includes('image_url')
  )
}

export interface AgentCallbacks {
  onEvent: (e: AgentEvent) => void
  confirmTool: (name: string, args: string) => Promise<boolean>
}

/** 估算一段文本的 token 数（中英混合经验值） */
function estimateText(s: string): number {
  return Math.ceil(s.length / 3)
}

export class AgentService {
  private history: ChatMessage[] = []
  private abort: AbortController | null = null
  /** 本会话累计 token 用量 */
  private sessionUsage: TokenUsage = { prompt: 0, completion: 0, total: 0, estimated: false }

  constructor(private store: ConfigStore, private registry: ToolRegistry) {}

  reset(): void {
    this.history = []
    this.sessionUsage = { prompt: 0, completion: 0, total: 0, estimated: false }
  }

  getUsage(): TokenUsage {
    return this.sessionUsage
  }

  /** 累加单次用量并上报；任一次为估算则会话总量标记为估算 */
  private reportUsage(last: TokenUsage, cb: AgentCallbacks): void {
    this.sessionUsage = {
      prompt: this.sessionUsage.prompt + last.prompt,
      completion: this.sessionUsage.completion + last.completion,
      total: this.sessionUsage.total + last.total,
      estimated: this.sessionUsage.estimated || last.estimated
    }
    cb.onEvent({ type: 'usage', last, session: this.sessionUsage })
    Logger.info(
      `[Usage] 本次 prompt=${last.prompt} completion=${last.completion} total=${last.total}` +
        `${last.estimated ? '（估算）' : ''} | 会话累计 ${this.sessionUsage.total}`
    )
  }

  stop(): void {
    this.abort?.abort()
  }

  getHistory(): ChatMessage[] {
    return this.history
  }

  private systemMessage(cfg: AppConfig): ChatMessage {
    // 模式已合并：安洁莉娜人设（petPrompt）+ 完整 Agent 工具能力与规则
    const toolNames = this.registry.getSchemas().map((t) => t.name)
    const capability = [
      '',
      '【能力说明】',
      '你拥有完整的 Windows 工具能力（与专业 Agent 完全相同），可以直接调用工具执行实际操作：',
      `可用工具：${toolNames.join(', ')}`,
      '',
      '【执行规则】',
      '- 用中文回复，保持安洁莉娜的人设口吻，同时专业高效地完成任务',
      '- 查询类操作直接执行并展示结果；修改/删除类操作先说明再执行',
      '- 涉及本地文件时用 read_file（传入绝对路径）读取后回答，不要拒绝说"无法访问"',
      '- 涉及个人知识库时用 search_knowledge_base / read_note 检索',
      '- 多步骤任务逐步执行并报告每步结果；操作失败时分析原因并给建议',
      '- 只使用上面列出的工具名，不要发明不存在的工具名',
      '',
      '【图片生成规则】用户需要图片时，用 generate_image_prompt 生成可复用的绘图提示词并完整展示，绝不编造图片内容。',
      '【文件编辑规则】修改已存在文件优先用 edit_file / multi_edit_file，仅新建或小文件用 write_file。',
      '【Word 文档规则】生成 Word/docx 时：Markdown 风格用 markdown_to_word；精细排版用 create_word_document；数学公式用 LaTeX 写在 $...$ 中。'
    ].join('\n')
    return { role: 'system', content: cfg.petPrompt + capability }
  }

  /**
   * 调用外部视觉模型识别图片，返回描述文本。
   * 每张图片单独一次请求，避免多图混淆且便于定位失败。
   */
  private async describeImages(
    cfg: AppConfig,
    visionProvider: ProviderConfig,
    images: Array<{ name: string; dataUrl: string }>,
    userInput: string,
    cb: AgentCallbacks
  ): Promise<string[]> {
    const prompt = cfg.visionAssist.prompt.trim() || DEFAULT_VISION_PROMPT
    const results: string[] = []

    for (const img of images) {
      cb.onEvent({ type: 'vision', status: 'start', model: visionProvider.model })
      Logger.info(`[VisionAssist] 识别 "${img.name}" ← ${visionProvider.model}`)
      try {
        const res = await chatStream(
          visionProvider,
          [
            {
              role: 'user',
              content: [
                { type: 'text', text: `${prompt}\n\n【用户原始需求】${userInput}\n请着重描述与该需求相关的内容。` },
                { type: 'image_url', image_url: { url: img.dataUrl } }
              ]
            }
          ],
          {
            temperature: 0.2,
            maxTokens: cfg.maxTokens,
            signal: this.abort?.signal,
            stream: cfg.stream,
            thinking: cfg.thinkingMode
          }
        )
        const text = res.content.trim()
        // 视觉模型的开销也计入会话总量
        this.reportUsage(
          res.usage ?? {
            prompt: estimateText(prompt) + IMAGE_TOKEN_COST,
            completion: estimateText(text),
            total: estimateText(prompt) + IMAGE_TOKEN_COST + estimateText(text),
            estimated: true
          },
          cb
        )
        results.push(`\n[图片: ${img.name}]（由视觉模型 ${visionProvider.model} 识别）\n${text}`)
        cb.onEvent({ type: 'vision', status: 'done', model: visionProvider.model, text })
        Logger.info(`[VisionAssist] "${img.name}" 识别完成，${text.length} 字符`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        results.push(`\n[图片: ${img.name}] 视觉模型识别失败: ${msg}`)
        cb.onEvent({ type: 'vision', status: 'error', model: visionProvider.model, text: msg })
        Logger.error(`[VisionAssist] "${img.name}" 识别失败: ${msg}`)
      }
    }
    return results
  }

  /**
   * 构建用户消息内容。
   * forceNoVision=true 时强制走非 vision 路径（用于主模型实际拒收图片后的降级重试）。
   * 返回 multipart=true 表示消息里带了图片，失败时可降级。
   */
  private async buildUserContent(
    cfg: AppConfig,
    provider: ProviderConfig,
    userInput: string,
    attachments: any[] | undefined,
    cb: AgentCallbacks,
    forceNoVision = false
  ): Promise<{ content: ChatMessage['content']; multipart: boolean }> {
    let userContent: ChatMessage['content'] = userInput
    let multipart = false

    if (attachments && attachments.length > 0) {
      const supportsVision = !forceNoVision && detectVision(provider)
      if (!forceNoVision) {
        Logger.info(`[Vision] model="${provider.model}" supportsVision=${provider.supportsVision} auto=${supportsVision}`)
      }

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
        multipart = parts.some((p) => p.type === 'image_url')
      } else {
        // 不支持 vision：先看能否用视觉辅助模型代为识别
        const images = attachments.filter((a) => a.isImage)
        const sendable = images.filter((a) => a.dataUrl)
        const va = cfg.visionAssist
        const visionProvider = resolveVisionProvider(cfg, provider)

        const textParts: string[] = [userInput]

        if (visionProvider && sendable.length > 0) {
          // 视觉辅助：外部模型识别图片 → 描述文本交给主模型
          const descs = await this.describeImages(
            cfg,
            visionProvider,
            sendable.map((a) => ({ name: a.name, dataUrl: a.dataUrl })),
            userInput,
            cb
          )
          textParts.push(...descs)
        }
        // 未能交给视觉模型的图片（未启用/未配置/缺 dataUrl）退化为路径描述
        const skipped = visionProvider ? images.filter((a) => !a.dataUrl) : images
        if (skipped.length > 0) {
          const hint = !va.enabled
            ? '当前模型不支持图片识别，可在设置中开启「视觉辅助」或切换到支持 vision 的模型。'
            : visionProvider
              ? '当前模型不支持图片识别，且该图片无法交给视觉辅助模型。'
              : '当前模型不支持图片识别；视觉辅助已开启但未正确配置（请检查视觉模型名）。'

          for (const att of skipped) {
            textParts.push(`\n[图片: ${att.name}]（路径: ${att.path}）注意：${hint}`)
          }
        }

        // 非图片附件照常处理
        for (const att of attachments) {
          if (att.isImage) continue
          if (att.textContent) {
            textParts.push(`\n[文件: ${att.name}]\n${att.textContent}`)
          } else {
            textParts.push(`\n[附件: ${att.name}]（路径: ${att.path}）`)
          }
        }
        userContent = textParts.join('')
      }
    }

    return { content: userContent, multipart }
  }

  async process(userInput: string, cb: AgentCallbacks, attachments?: any[]): Promise<void> {
    const cfg = this.store.get()
    const provider = this.store.activeProvider()
    const ctx = new ContextManager(cfg)
    this.abort = new AbortController()

    const built = await this.buildUserContent(cfg, provider, userInput, attachments, cb)
    let sentImages = built.multipart
    let downgraded = false

    this.history.push({ role: 'user', content: built.content })
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

        let result
        try {
          result = await chatStream(
            provider,
            messages,
            {
              temperature: cfg.temperature,
              maxTokens: cfg.maxTokens,
              tools,
              signal: this.abort.signal,
              stream: cfg.stream,
              thinking: cfg.thinkingMode
            },
            {
              onContent: (d) => cb.onEvent({ type: 'assistant_delta', text: d }),
              onReasoning: (d) => cb.onEvent({ type: 'reasoning_delta', text: d })
            }
          )
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          // 主模型声称支持 vision 但网关实际拒收图片：降级走视觉辅助路径重试一次
          if (sentImages && !downgraded && isImageUnsupportedError(msg)) {
            downgraded = true
            sentImages = false
            Logger.info(`[Vision] 模型 "${provider.model}" 实际不接受图片输入，降级为视觉辅助/文本描述重试`)
            cb.onEvent({
              type: 'vision',
              status: 'error',
              model: provider.model,
              text: `主模型不接受图片输入，已自动降级重试`
            })
            const rebuilt = await this.buildUserContent(cfg, provider, userInput, attachments, cb, true)
            // 按角色定位（而非固定下标），避免上下文压缩后索引失效
            const idx = this.history.map((h) => h.role).lastIndexOf('user')
            if (idx >= 0) this.history[idx] = { role: 'user', content: rebuilt.content }
            continue
          }
          throw e
        }

        // 接口未返回 usage 时本地估算
        const completionText = result.content + (result.reasoning || '') +
          result.toolCalls.map((t) => t.name + t.arguments).join('')
        this.reportUsage(
          result.usage ?? {
            prompt: estimateTokens(messages),
            completion: estimateText(completionText),
            total: estimateTokens(messages) + estimateText(completionText),
            estimated: true
          },
          cb
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
