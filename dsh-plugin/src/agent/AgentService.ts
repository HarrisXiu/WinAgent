import type { AgentEvent, AppConfig, ChatMessage, ProviderConfig, TokenUsage } from '../shared/types'
import type { ToolRegistry } from '../tools/ToolRegistry'
import type { ConfigStore } from '../config/ConfigStore'
import { promises as fs } from 'fs'
import { chatStream } from '../llm/OpenAIClient'
import { ContextManager, estimateTokens, IMAGE_TOKEN_COST } from './ContextManager'
import { Logger } from '../util/Logger'
import { getCapabilities } from '../util/capabilities'

const MAX_ROUNDS = 25

/** 单轮工具结果最多注入的图片数（防止上下文爆炸） */
const MAX_TOOL_IMAGES = 6

/** PDF 文件直传大小上限（超过则降级为工具读取提示） */
const PDF_DIRECT_MAX_BYTES = 15 * 1024 * 1024

/** 工具结果内嵌图片标记：[[IMG:data:image/png;base64,...]]（skills 输出，Agent 剥离转为视觉输入） */
const TOOL_IMG_RE = /\[\[IMG:(data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+)\]\]/g

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

/**
 * 判断报错是否为“模型不接受文件输入”（PDF 直传被拒）。
 * 图片拒收检查在前，两类错误文案含 file/pdf 时不会误触发。
 */
function isFileUnsupportedError(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    m.includes('file_data') ||
    m.includes('content type file') ||
    m.includes('type: file') ||
    m.includes('type \'file\'') ||
    (m.includes('file') && (m.includes('not support') || m.includes('unsupported') || m.includes('invalid content'))) ||
    (m.includes('pdf') && (m.includes('not support') || m.includes('unsupported')))
  )
}

export interface AgentCallbacks {
  onEvent: (e: AgentEvent) => void
  confirmTool: (name: string, args: string) => Promise<boolean>
}

/** 知识检索能力接口（由 wiki 侧 KnowledgeRetriever 实现，server.ts 装配时注入；结构化类型避免模块循环依赖） */
export interface KnowledgeRetrieverLike {
  retrieve(userInput: string): Promise<{ text: string; count: number } | null>
}

/** 估算一段文本的 token 数（中英混合经验值） */
function estimateText(s: string): number {
  return Math.ceil(s.length / 3)
}

/**
 * 把知识库注入块拼到用户消息尾部：string 直接拼接；multipart 追加到第一个 text part。
 * 注入块首行带【知识库检索…】标记，上下文压缩时可识别剥离（见 ContextManager）。
 */
function appendKnowledge(content: ChatMessage['content'], knowledgeText: string | null): ChatMessage['content'] {
  if (!knowledgeText) return content
  if (typeof content === 'string') return `${content}\n\n${knowledgeText}`
  if (Array.isArray(content)) {
    const parts = [...content]
    const textIdx = parts.findIndex((p) => p.type === 'text')
    if (textIdx >= 0) {
      parts[textIdx] = { type: 'text', text: `${(parts[textIdx] as { type: 'text'; text: string }).text}\n\n${knowledgeText}` }
    } else {
      parts.unshift({ type: 'text', text: knowledgeText })
    }
    return parts
  }
  return content
}

export class AgentService {
  private history: ChatMessage[] = []
  private abort: AbortController | null = null
  /** 本会话累计 token 用量 */
  private sessionUsage: TokenUsage = { prompt: 0, completion: 0, total: 0, estimated: false }
  /** 知识检索能力（WikiHost 初始化后由装配方注入；未注入时跳过自动 RAG） */
  private knowledge: KnowledgeRetrieverLike | null = null

  constructor(private store: ConfigStore, private registry: ToolRegistry) {}

  /** 注入知识检索能力（AgentService 创建早于 WikiHost，只能 setter 注入） */
  setKnowledgeRetriever(r: KnowledgeRetrieverLike): void {
    this.knowledge = r
  }

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
    // petPrompt 只承载人设（身份/语气）；工具清单与规则在此动态拼接，保证唯一一份、与实际注册一致
    const toolNames = this.registry.getSchemas().map((t) => t.name)
    // 本地能力摘要（仅注入影响模型决策的条目；探测结果进程内缓存）
    const caps = getCapabilities()
    const docCaps: string[] = []
    docCaps.push(
      caps.pdfjsRender
        ? 'PDF 视觉渲染可用（render_pdf_page / extract_pdf_images）：扫描件、图表、复杂排版优先走视觉路径'
        : 'PDF 视觉渲染链未安装：扫描件/图表 PDF 只能文本提取（可提示用户安装 pdfjs-dist + @napi-rs/canvas）'
    )
    if (caps.pandoc) docCaps.push('pandoc 可用：Word 生成自动走 pandoc 引擎')
    if (caps.soffice || caps.officeCom) {
      docCaps.push(`office_convert 可用（${caps.soffice ? 'LibreOffice' : 'MS Office COM'} 引擎）：Office 文档 → pdf 及 md/docx/html/txt 互转`)
    }

    const capability = [
      '',
      '【能力与执行规则】',
      `可用工具：${toolNames.join(', ')}`,
      '- 用中文回复；查询类操作直接执行并展示结果；修改/删除类操作先说明再执行',
      '- 多步骤任务逐步执行并报告每步结果；操作失败时分析原因并给建议（如是否需要管理员权限）',
      '- 涉及本地文件时用 read_file（传入绝对路径）读取后回答，不要拒绝说"无法访问"',
      '- 只使用上面列出的工具名，不要发明不存在的工具名',
      '',
      '【个人知识库（LLM Wiki）】',
      '你管理着用户的个人知识库。每轮用户消息末尾可能附带系统自动检索的「知识库检索结果」。',
      '- 回答知识/事实/概念类问题（如"什么是X""X和Y有什么区别""我之前了解的X"）时，优先依据检索结果作答，注明来源笔记标题，核心结论溯源到 wiki/sources/ 下的来源页；不同来源结论矛盾时显式标注分歧，知识库之外的补充注明「知识库外」。',
      '- 检索结果不够详细时，用 retrieve_knowledge 深度检索（一次取多篇全文）；或用 search_knowledge_base 换关键词（同义词/英文/缩写）检索、read_note 读单篇全文。',
      '- 检索结果为「未找到相关内容」时：先明确告知用户知识库中没有相关资料，再用自己的知识回答，并标注该部分未经知识库验证。',
      '- 系统操作类请求（打开程序、管理文件、系统设置等）与知识库无关，直接执行工具，不要检索。',
      '- 高价值回答用 save_knowledge_output 持久化；记录开放问题用 add_question；健康检查/综合分析/合并页面分别用 lint_knowledge_base / reflect_knowledge_base / merge_knowledge_pages。',
      '',
      '【图片生成规则】用户需要图片时，直接生成完整可复用的绘图提示词（可直接粘贴的英文 Prompt + 中文拆解说明）并完整展示，绝不编造图片内容。',
      '【文件编辑规则】修改已存在文件优先用 edit_file / multi_edit_file，仅新建或小文件用 write_file。',
      '【文档生成规则】生成 Word 用 markdown_to_docx（产出 Markdown，公式用 LaTeX 写在 $...$ 中，自动插入为 Word 原生公式）；生成 Excel 用 write_xlsx（sheets JSON 或 Markdown 表格）；生成 PPT 用 write_pptx（slides JSON）。',
      '【本地文档能力】' + docCaps.join('；')
    ].join('\n')
    return { role: 'system', content: cfg.petPrompt + capability }
  }

  /** 从工具结果文本剥离 [[IMG:...]] 标记：返回净化文本与 dataUrl 列表 */
  private extractToolImages(text: string): { text: string; images: string[] } {
    const images: string[] = []
    const clean = text.replace(TOOL_IMG_RE, (_m, url: string) => {
      images.push(url)
      return ''
    })
    return { text: clean.trim(), images }
  }

  /**
   * 把历史中所有带图片的 user 消息降级为纯文本（视觉辅助描述或提示）。
   * 用于主模型声称支持 vision 但网关实际拒收图片后的重试。
   */
  private async stripHistoryImages(cfg: AppConfig, provider: ProviderConfig, userInput: string, cb: AgentCallbacks): Promise<void> {
    const visionProvider = resolveVisionProvider(cfg, provider)
    for (let i = 0; i < this.history.length; i++) {
      const msg = this.history[i]
      if (msg.role !== 'user' || !Array.isArray(msg.content)) continue
      const textParts: string[] = []
      const images: Array<{ name: string; dataUrl: string }> = []
      const keptFiles: Array<{ type: 'file'; file: { filename: string; file_data: string } }> = []
      for (const p of msg.content) {
        if (p.type === 'text') textParts.push(p.text)
        else if (p.type === 'image_url') images.push({ name: `image-${i + 1}-${images.length + 1}`, dataUrl: p.image_url.url })
        else if (p.type === 'file') keptFiles.push(p)
      }
      const parts: string[] = [textParts.join('\n')]
      if (images.length > 0) {
        if (visionProvider) {
          parts.push(...(await this.describeImages(cfg, visionProvider, images, userInput, cb)))
        } else {
          parts.push(`[注意] 本消息含 ${images.length} 张图片，当前模型不支持图片识别且未启用视觉辅助，图片不可见。`)
        }
      }
      const textContent = parts.filter((t) => t && t.trim()).join('\n')
      // 图片降级不影响文件直传：保留 file parts
      this.history[i] = keptFiles.length
        ? {
            role: 'user',
            content: [
              ...(textContent ? [{ type: 'text' as const, text: textContent }] : []),
              ...keptFiles
            ]
          }
        : { role: 'user', content: textContent }
    }
  }

  /**
   * 把历史中所有 user 消息里的 file parts（PDF 直传）剥离为工具读取提示（保留图片与文本）。
   * 用于网关拒收文件输入后的降级重试。
   */
  private stripHistoryFileParts(): void {
    const note = '[系统] PDF 文件直传被拒收，请改用 read_pdf（提取文本）/ render_pdf_page（渲染页面）工具读取上述路径的 PDF。'
    for (let i = 0; i < this.history.length; i++) {
      const msg = this.history[i]
      if (msg.role !== 'user' || !Array.isArray(msg.content)) continue
      if (!msg.content.some((p) => p.type === 'file')) continue
      const texts = msg.content.filter((p) => p.type === 'text').map((p) => (p as { type: 'text'; text: string }).text)
      const kept = msg.content.filter((p) => p.type === 'image_url') as Array<{ type: 'image_url'; image_url: { url: string } }>
      const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
        ...(texts.length ? [{ type: 'text' as const, text: texts.join('\n') }] : []),
        { type: 'text' as const, text: note },
        ...kept
      ]
      this.history[i] = { role: 'user', content }
    }
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
   * 返回 multipart=true 表示消息里带了图片（可触发图片降级）；
   * hasFiles=true 表示带了 PDF 文件直传（网关拒收时可降级为工具读取提示）。
   */
  private async buildUserContent(
    cfg: AppConfig,
    provider: ProviderConfig,
    userInput: string,
    attachments: any[] | undefined,
    cb: AgentCallbacks,
    forceNoVision = false
  ): Promise<{ content: ChatMessage['content']; multipart: boolean; hasFiles: boolean }> {
    let userContent: ChatMessage['content'] = userInput
    let multipart = false
    let hasFiles = false

    if (attachments && attachments.length > 0) {
      // PDF 附件：文件直传（不依赖 vision，文本模型也可读文档）；被拒/超限/禁用时降级为路径提示
      const isPdf = (a: any): boolean =>
        a.isPdf === true || a.mime === 'application/pdf' || /\.pdf$/i.test(String(a.name || ''))
      const pdfs = attachments.filter((a) => isPdf(a))
      const others = attachments.filter((a) => !isPdf(a))
      const pdfNotes: string[] = []
      const fileParts: Array<{ type: 'file'; file: { filename: string; file_data: string } }> = []

      const allowFiles = provider.supportsFiles !== false
      for (const att of pdfs) {
        let dataUrl: string | undefined = att.dataUrl
        if (!dataUrl && att.path) {
          try {
            const buf = await fs.readFile(att.path)
            if (buf.length <= PDF_DIRECT_MAX_BYTES) {
              dataUrl = `data:application/pdf;base64,${buf.toString('base64')}`
            }
          } catch { /* 读取失败按路径提示 */ }
        }
        if (allowFiles && dataUrl) {
          fileParts.push({
            type: 'file',
            file: { filename: String(att.name || 'document.pdf'), file_data: dataUrl }
          })
          pdfNotes.push(`\n[PDF 附件: ${att.name}]（路径: ${att.path}）已作为文件输入直传给模型`)
        } else {
          pdfNotes.push(
            `\n[PDF 附件: ${att.name}]（路径: ${att.path}）${allowFiles ? '超过直传大小上限（15MB），' : '当前模型已禁用文件直传，'}` +
            '请用 read_pdf 提取文本；需要看版式/图表时用 render_pdf_page'
          )
        }
      }

      if (others.length > 0) {
        const supportsVision = !forceNoVision && detectVision(provider)
        if (!forceNoVision) {
          Logger.info(`[Vision] model="${provider.model}" supportsVision=${provider.supportsVision} auto=${supportsVision}`)
        }

        if (supportsVision) {
          // 支持 vision：发送 multipart 消息
          const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []
          const textParts: string[] = [userInput]
          for (const att of others) {
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
          const images = others.filter((a) => a.isImage)
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
          for (const att of others) {
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

      // PDF 备注与文件 parts 合并进最终内容
      if (pdfNotes.length > 0) {
        const note = pdfNotes.join('')
        if (Array.isArray(userContent)) {
          userContent = [...userContent, { type: 'text', text: note }]
        } else {
          userContent = String(userContent) + note
        }
      }
      if (fileParts.length > 0) {
        if (Array.isArray(userContent)) {
          userContent = [...userContent, ...fileParts]
        } else {
          userContent = [{ type: 'text', text: String(userContent) }, ...fileParts]
        }
        hasFiles = true
      }
    }

    return { content: userContent, multipart, hasFiles }
  }

  async process(userInput: string, cb: AgentCallbacks, attachments?: any[]): Promise<void> {
    const cfg = this.store.get()
    const provider = this.store.activeProvider()
    const ctx = new ContextManager(cfg)
    this.abort = new AbortController()

    const built = await this.buildUserContent(cfg, provider, userInput, attachments, cb)
    let sentImages = built.multipart
    let sentFiles = built.hasFiles
    let downgraded = false
    let filesDowngraded = false

    // 自动 RAG：检索知识库并把结果拼到本轮 user 消息尾部（注入只在当轮有价值，压缩时会被剥离）
    let knowledgeText: string | null = null
    if (this.knowledge && userInput.trim()) {
      try {
        const inj = await this.knowledge.retrieve(userInput)
        knowledgeText = inj?.text ?? null
        if (inj) cb.onEvent({ type: 'knowledge', query: userInput.slice(0, 50), count: inj.count })
      } catch (e) {
        Logger.warn(`[RAG] 知识库检索失败（已跳过）: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    this.history.push({ role: 'user', content: appendKnowledge(built.content, knowledgeText) })
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
            // 全量剥离历史中的图片（含用户附件与工具注入图），改为视觉辅助描述/文本提示后重试
            await this.stripHistoryImages(cfg, provider, userInput, cb)
            continue
          }
          // PDF 文件直传被网关拒收：剥离 file parts，改为工具读取提示后重试
          if (sentFiles && !filesDowngraded && isFileUnsupportedError(msg)) {
            filesDowngraded = true
            sentFiles = false
            Logger.info(`[FilePass] 模型 "${provider.model}" 不接受 PDF 文件输入，降级为工具读取提示重试`)
            cb.onEvent({
              type: 'vision',
              status: 'error',
              model: provider.model,
              text: `主模型不接受 PDF 文件输入，已降级为 read_pdf / render_pdf_page 工具路径`
            })
            this.stripHistoryFileParts()
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

        // 本轮工具返回的图片（[[IMG:...]] 标记剥离所得）
        let roundImages: string[] = []

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
          // 剥离 [[IMG:...]] 标记：图片不进文本上下文，转为视觉输入
          const { text: cleanText, images: toolImages } = this.extractToolImages(toolResult)
          const shown = toolImages.length
            ? cleanText + `\n（另有 ${toolImages.length} 张图片已作为视觉输入附带在下一轮消息中）`
            : cleanText
          cb.onEvent({ type: 'tool_result', id: call.id, name: call.name, result: shown, ok })
          Logger.info(`[TOOL RESULT] ${call.name}: ${shown.slice(0, 200)}`)
          this.history.push({ role: 'tool', content: shown, tool_call_id: call.id, name: call.name })
          if (toolImages.length > 0) roundImages.push(...toolImages)
        }

        // 工具返回图片 → 注入视觉输入（vision 模型直看；否则视觉辅助描述）
        if (roundImages.length > 0) {
          const capped = roundImages.slice(0, MAX_TOOL_IMAGES)
          if (capped.length < roundImages.length) {
            Logger.warn(`[ToolImage] 本轮工具图片 ${roundImages.length} 张超出上限，仅注入前 ${capped.length} 张`)
          }
          if (detectVision(provider)) {
            this.history.push({
              role: 'user',
              content: [
                { type: 'text', text: `[系统] 上述工具结果附带 ${capped.length} 张图片（见下方），请直接结合图片内容继续任务，不要重复调用工具获取图片。` },
                ...capped.map((url) => ({ type: 'image_url' as const, image_url: { url } }))
              ]
            })
            sentImages = true
          } else {
            const visionProvider = resolveVisionProvider(cfg, provider)
            if (visionProvider) {
              const descs = await this.describeImages(
                cfg,
                visionProvider,
                capped.map((url, i) => ({ name: `tool-image-${i + 1}`, dataUrl: url })),
                userInput,
                cb
              )
              this.history.push({
                role: 'user',
                content: `[系统] 上述工具结果附带 ${capped.length} 张图片，视觉辅助模型识别结果：\n${descs.join('\n')}`
              })
            } else {
              this.history.push({
                role: 'user',
                content: `[系统] 上述工具结果附带 ${capped.length} 张图片，但当前模型不支持图片识别且未启用视觉辅助，图片内容不可用。`
              })
            }
          }
          roundImages = []
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
