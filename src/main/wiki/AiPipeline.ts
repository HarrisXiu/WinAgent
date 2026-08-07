import type { ProviderConfig, ChatMessage, IngestAnalysis } from '../../shared/types'
import { chatStream } from '../llm/OpenAIClient'

export interface AiAnalysisResult {
  tags: string[]
  summary: string
  relations: Array<{ target: string; reason: string }>
}

/** 已有概念页的轻量信息（用于概念名称对齐） */
export interface ExistingConceptInfo {
  slug: string
  title: string
  aliases: string[]
}

interface StreamFalseOpts {
  temperature: number
  maxTokens: number
  stream: false
  signal?: AbortSignal
}

/**
 * AI 分析管道
 * 复用现有 LLM 客户端，对笔记内容进行标签、摘要、关系发现
 */
export class AiPipeline {
  private abortController: AbortController | null = null

  /** 取消正在进行的分析 */
  cancel(): void {
    this.abortController?.abort()
    this.abortController = null
  }

  /**
   * 对单篇笔记执行完整分析（标签 + 摘要 + 关系发现）
   * @param provider LLM 提供者配置
   * @param title 笔记标题
   * @param body 笔记正文（markdown）
   * @param allTitles 知识库中所有笔记的标题列表（用于关系发现）
   */
  async analyze(
    provider: ProviderConfig,
    title: string,
    body: string,
    allTitles: string[]
  ): Promise<AiAnalysisResult> {
    this.abortController = new AbortController()
    const signal = this.abortController.signal

    const baseOpts: StreamFalseOpts = {
      temperature: 0.3,
      maxTokens: 800,
      stream: false,
      signal
    }

    try {
      // 并行执行三个分析
      const [tags, summary, relations] = await Promise.all([
        this.generateTags(provider, title, body, baseOpts),
        this.generateSummary(provider, title, body, baseOpts),
        this.discoverRelations(provider, title, body, allTitles, baseOpts)
      ])

      return { tags, summary, relations }
    } finally {
      this.abortController = null
    }
  }

  /** 仅生成标签建议 */
  async suggestTags(provider: ProviderConfig, title: string, body: string): Promise<string[]> {
    return this.generateTags(provider, title, body, {
      temperature: 0.3,
      maxTokens: 400,
      stream: false
    })
  }

  /** 仅生成摘要 */
  async summarize(provider: ProviderConfig, title: string, body: string): Promise<string> {
    return this.generateSummary(provider, title, body, {
      temperature: 0.3,
      maxTokens: 600,
      stream: false
    })
  }

  // === 私有方法 ===

  /**
   * INGEST 分析：对单个原始来源执行编译（LLM Wiki 模式）
   * 一次调用生成 sources 页所需的全部结构化内容，
   * 并要求 LLM 基于已有概念列表做概念名称对齐（matchSlug）
   * @param openQuestions 开放问题列表（来自 QUESTIONS.md，判断本来源是否能回答）
   * @param isPersonal 是否为个人写作（raw/personal/，走个人写作流程）
   */
  async ingestSource(
    provider: ProviderConfig,
    rawTitle: string,
    rawBody: string,
    existingConcepts: ExistingConceptInfo[],
    openQuestions: string[] = [],
    isPersonal = false
  ): Promise<IngestAnalysis> {
    this.abortController = new AbortController()
    const signal = this.abortController.signal

    const conceptList = existingConcepts.length
      ? existingConcepts
          .map((c) => `- slug: ${c.slug} | 中文名: ${c.title} | aliases: ${c.aliases.join(', ') || '无'}`)
          .join('\n')
      : '（暂无已有概念）'
    const questionList = openQuestions.length
      ? openQuestions.map((q) => `- ${q}`).join('\n')
      : '（暂无开放问题）'

    const personalRule = isPersonal
      ? `【个人写作模式】本来源是用户自己写的文章（raw/personal/）：
- summary 简写为核心论点（第一人称视角）
- keyPoints 为文章的主要论点
- 概念 definition 作为「个人立场」表述
- 不参与已有概念的 source_count 计数（但 matchSlug 对齐规则照常）`
      : ''

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个个人知识库管理员。给定一篇原始来源，你要把它编译成知识库结构。
输出必须是一个严格合法的 JSON 对象（不要 markdown 代码块、不要多余文字），格式：
{
  "slug": "英文小写连字符文件名（如 attention-is-all-you-need，不要中文）",
  "title": "来源的中文标题",
  "summary": "2-4 句中文摘要，概括核心内容",
  "keyPoints": ["3-8 条核心要点，每条一句话"],
  "concepts": [
    {"name": "概念中文名", "nameEn": "概念英文名（若无则省略）", "definition": "一句话定义", "matchSlug": "命中已有概念的 slug（否则省略）"}
  ],
  "entities": [
    {"name": "实体名", "type": "person|tool|institution|paper", "description": "一句话描述", "matchSlug": "命中已有实体的 slug（否则省略）"}
  ],
  "contradictions": ["与知识库已有内容的分歧（若无则省略）"],
  "answeredQuestions": ["本来源能回答的开放问题原文（若下方开放问题列表中有能回答的，复制原问题文本；没有则省略该字段"]
}

${personalRule}
概念对齐规则（重要）：
- 下方提供了知识库中已有概念列表（slug + 中文名 + aliases）
- 提取概念时，若该概念与已有概念的 slug、中文名、aliases 或语义相同 → 在 matchSlug 填入已有概念的 slug，表示"更新已有页"
- 只有确实不存在时才作为新概念（不填 matchSlug）
- 实体同理（知识库已有实体在下方列出时对齐）`
      },
      {
        role: 'user',
        content: `来源标题：${rawTitle}

来源内容：
${truncate(rawBody, 6000)}

=== 知识库已有概念列表 ===
${conceptList}

=== 开放问题列表（判断本来源是否能回答） ===
${questionList}

请编译以上来源，输出 JSON。`
      }
    ]

    try {
      const result = await chatStream(provider, messages, {
        temperature: 0.3,
        maxTokens: 1500,
        stream: false,
        signal
      })
      return sanitizeIngest(parseJsonObject(result.content) ?? {})
    } catch (e) {
      throw new Error(`INGEST 分析失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      this.abortController = null
    }
  }

  private async generateTags(
    provider: ProviderConfig,
    title: string,
    body: string,
    opts: StreamFalseOpts
  ): Promise<string[]> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个知识管理助手。分析给定的笔记内容，生成 3-8 个标签。
标签要求：
- 中英文混合，优先使用中文
- 涵盖主题、领域、类型
- 每个标签 2-8 个字
- 只返回 JSON 字符串数组，不要其他内容
示例输出：["机器学习", "神经网络", "深度学习", "AI", "教程"]`
      },
      {
        role: 'user',
        content: `标题：${title}\n\n内容：${truncate(body, 3000)}`
      }
    ]

    try {
      const result = await chatStream(provider, messages, opts)
      return parseJsonArray(result.content) ?? []
    } catch {
      return []
    }
  }

  private async generateSummary(
    provider: ProviderConfig,
    title: string,
    body: string,
    opts: StreamFalseOpts
  ): Promise<string> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个知识管理助手。为给定的笔记生成简洁摘要。
要求：
- 2-4 句中文
- 概括核心内容和关键观点
- 不要包含"本文"、"这篇文章"等冗余开头
- 直接返回摘要文本，不要 JSON 包装`
      },
      {
        role: 'user',
        content: `标题：${title}\n\n内容：${truncate(body, 4000)}`
      }
    ]

    try {
      const result = await chatStream(provider, messages, opts)
      return result.content.trim()
    } catch {
      return ''
    }
  }

  private async discoverRelations(
    provider: ProviderConfig,
    title: string,
    body: string,
    allTitles: string[],
    opts: StreamFalseOpts
  ): Promise<Array<{ target: string; reason: string }>> {
    // 过滤掉当前笔记自身
    const otherTitles = allTitles.filter((t) => t !== title)
    if (otherTitles.length === 0) return []

    const titleList = otherTitles.slice(0, 50).join('\n- ')

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个知识管理助手。分析给定笔记，找出知识库中与它语义相关的其他笔记。
要求：
- 从提供的标题列表中找出 0-5 个最相关的笔记
- 对每个相关笔记说明原因（一句话）
- 如果没有明显相关的，返回空数组
- 严格返回 JSON 数组格式：\`[{"target": "笔记标题", "reason": "相关原因"}]\`
- 不要返回不存在的标题`
      },
      {
        role: 'user',
        content: `当前笔记标题：${title}
当前笔记内容：${truncate(body, 2000)}

知识库中其他笔记标题：
- ${titleList}`
      }
    ]

    try {
      const result = await chatStream(provider, messages, opts)
      const parsed = parseJsonArray(result.content)
      if (!parsed) return []
      // 过滤只保留标题列表中实际存在的
      return parsed.filter(
        (r: any) => r && typeof r.target === 'string' && otherTitles.some(
          (t) => t.toLowerCase() === r.target.toLowerCase()
        )
      ).slice(0, 5)
    } catch {
      return []
    }
  }
}

/** 截断文本到指定长度 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '\n\n...（内容已截断）'
}

/** 从 LLM 返回中解析 JSON 对象 */
function parseJsonObject(text: string): any | null {
  if (!text) return null
  // 直接解析
  try {
    const parsed = JSON.parse(text.trim())
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch { /* continue */ }
  // 提取 ```json ... ``` 代码块
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) {
    try {
      const parsed = JSON.parse(codeBlock[1].trim())
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch { /* continue */ }
  }
  // 提取第一个 {...} 对象
  const objMatch = text.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0])
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch { /* fail */ }
  }
  return null
}

/** 清洗并校验 INGEST 分析结果（字段兜底） */
function sanitizeIngest(raw: any): IngestAnalysis {
  const str = (v: any, fallback = ''): string => (typeof v === 'string' && v.trim() ? v.trim() : fallback)
  const strArr = (v: any): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []
  const concepts = Array.isArray(raw.concepts) ? raw.concepts : []
  const entities = Array.isArray(raw.entities) ? raw.entities : []
  return {
    slug: str(raw.slug, 'untitled')
      .toLowerCase()
      .replace(/[^a-z0-9\-\s]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'untitled',
    title: str(raw.title, '未命名来源'),
    summary: str(raw.summary),
    keyPoints: strArr(raw.keyPoints),
    concepts: (concepts as any[])
      .filter((c: any) => c && typeof c.name === 'string' && c.name.trim())
      .map((c: any) => ({
        name: str(c.name),
        nameEn: str(c.nameEn, undefined as any) || undefined,
        definition: str(c.definition),
        matchSlug: str(c.matchSlug, undefined as any) || undefined
      }))
      .slice(0, 10),
    entities: (entities as any[])
      .filter((e: any) => e && typeof e.name === 'string' && e.name.trim())
      .map((e: any) => ({
        name: str(e.name),
        type: str(e.type, 'person'),
        description: str(e.description),
        matchSlug: str(e.matchSlug, undefined as any) || undefined
      }))
      .slice(0, 10),
    contradictions: strArr(raw.contradictions),
    answeredQuestions: strArr(raw.answeredQuestions)
  }
}

/** 从 LLM 返回中解析 JSON 数组 */
function parseJsonArray(text: string): any[] | null {
  if (!text) return null
  // 尝试直接解析
  try {
    const parsed = JSON.parse(text.trim())
    if (Array.isArray(parsed)) return parsed
  } catch { /* continue */ }

  // 提取 ```json ... ``` 代码块
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) {
    try {
      const parsed = JSON.parse(codeBlock[1].trim())
      if (Array.isArray(parsed)) return parsed
    } catch { /* continue */ }
  }

  // 提取第一个 [...] 数组
  const arrayMatch = text.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0])
      if (Array.isArray(parsed)) return parsed
    } catch { /* fail */ }
  }

  return null
}
