import type { ProviderConfig, ChatMessage, IngestAnalysis, NoteRelation } from '../../shared/types'
import { chatStream } from '../llm/OpenAIClient'

export interface AiAnalysisResult {
  tags: string[]
  summary: string
  relations: NoteRelation[]
  /** 质量审查建议（0-3 条可执行改进，不落盘，随分析即时返回） */
  suggestions: string[]
}

/** 已有概念页的轻量信息（用于概念名称对齐） */
export interface ExistingConceptInfo {
  slug: string
  title: string
  aliases: string[]
}

/** 知识库候选笔记（关系发现用）：path 为可跳转的 relPath，title 为显示标题 */
export interface CandidateNote {
  path: string
  title: string
}

/** 笔记类型：按类型注入定制审查规则 */
export type NoteType = 'source' | 'concept' | 'entity' | 'raw' | 'note'

export interface AnalyzeOptions {
  /** 页面类型（由调用方按 relPath 判断），决定 prompt 中的定制规则 */
  noteType?: NoteType
  /** 知识库行为契约（vault CLAUDE.md 的相关小节）：注入后「改契约 → AI 分析行为随之变化」闭环成立 */
  contract?: string
  /** 开放问题列表（QUESTIONS.md）：判断本笔记能否回答，能回答的原样复制进 suggestions */
  openQuestions?: string[]
}

/** 各类型笔记的定制审查规则 */
const TYPE_RULES: Record<NoteType, string> = {
  source: `【本页类型：来源页（wiki/sources/）】
- 检查 Key Points 是否完整（3-8 条）、正文是否标注来源（[[source-slug]] 溯源）
- 与知识库其他笔记矛盾时，在 suggestions 中明确指出分歧`,
  concept: `【本页类型：概念页（wiki/concepts/）】
- 检查 definition 是否为一句话定义、是否引用 [[source-slug]] 溯源
- 概念页缺少溯源链接时在 suggestions 中提示「应引用来源页」`,
  entity: `【本页类型：实体页（wiki/entities/）】
- 检查描述是否为一句话、type（person/tool/institution/paper）是否合适`,
  raw: `【本页类型：原始文件（raw/ 只读层）】
- 内容为人类原始输入，AI 永不修改；建议聚焦「可编译为哪些概念/来源页」`,
  note: ''
}

/**
 * AI 分析管道
 * 复用现有 LLM 客户端，对笔记进行标签、摘要、关系发现与质量审查
 */
export class AiPipeline {
  /**
   * 进行中的操作 → 独立 AbortController。
   * analyze 与 ingestSource 各占一个 key，并发互不覆盖；cancel() 只取消 analyze，不会误杀 ingest。
   */
  private controllers = new Map<string, AbortController>()

  /** 取消正在进行的 AI 分析（不影响 INGEST） */
  cancel(): void {
    this.controllers.get('analyze')?.abort()
    this.controllers.delete('analyze')
  }

  /** 注册一个新操作并返回其 signal；同 key 已有进行中的请求先取消（防连点） */
  private track(key: string): AbortSignal {
    this.controllers.get(key)?.abort()
    const ac = new AbortController()
    this.controllers.set(key, ac)
    return ac.signal
  }

  private untrack(key: string): void {
    this.controllers.delete(key)
  }

  /**
   * 对单篇笔记执行完整分析（标签 + 摘要 + 关系发现 + 质量审查建议）。
   * 单次 LLM 调用同时产出全部内容（共享上下文，省 2/3 token 与延迟）。
   * @param provider LLM 提供者配置
   * @param title 笔记标题
   * @param body 笔记正文（markdown）
   * @param candidates 知识库中其他笔记（path + title），关系发现的 target 直接映射为可跳转路径
   * @param opts 可选：契约注入 / 页面类型定制 / 开放问题列表
   */
  async analyze(
    provider: ProviderConfig,
    title: string,
    body: string,
    candidates: CandidateNote[],
    opts: AnalyzeOptions = {}
  ): Promise<AiAnalysisResult> {
    const signal = this.track('analyze')
    const { noteType = 'note', contract = '', openQuestions = [] } = opts

    // 候选去重 + 过滤空路径（当前笔记自身由调用方排除）
    const seen = new Set<string>()
    const others = candidates.filter((c) => c.path && !seen.has(c.path) && !!seen.add(c.path))
    const candidateMap = new Map(others.map((c) => [c.path.toLowerCase(), c]))

    // 契约注入：改 CLAUDE.md → 分析行为随之变化
    const contractRule = contract
      ? `\n\n=== 知识库行为契约（CLAUDE.md，必须遵守）===\n${contract}`
      : ''
    // 页面类型定制规则
    const typeRule = TYPE_RULES[noteType]
      ? `\n\n${TYPE_RULES[noteType]}`
      : ''
    // 开放问题列表：能回答的原样复制问题文本进 suggestions
    const questionRule = openQuestions.length
      ? `\n\n=== 开放问题列表（若本笔记能回答其中问题，将问题原文放入 suggestions） ===\n${openQuestions.map((q) => `- ${q}`).join('\n')}`
      : ''

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个知识管理助手。分析给定笔记，输出严格合法的 JSON 对象（不要 markdown 代码块、不要多余文字）：
{
  "tags": ["3-8 个标签，中英文混合、每个 2-8 个字，涵盖主题/领域/类型"],
  "summary": "2-4 句中文摘要，概括核心内容与关键观点，不要以「本文」「这篇文章」等开头",
  "relations": [{"target": "最相关候选笔记的精确路径", "reason": "一句话相关原因"}],
  "suggestions": ["0-3 条具体可执行的改进建议；没有问题返回空数组"]
}
要求：
- relations 取 0-5 条；没有明显相关的候选时返回空数组
- relations 的 target 必须逐字取自下方候选列表中的「路径」列，禁止编造或改写
- suggestions 类型示例：正文过短（stub，<100 字）建议补充内容、缺少 [[source-slug]] 溯源、正文可回答开放问题（写问题原文）、与某笔记存在矛盾（写原因）
- tags 示例：["机器学习", "神经网络", "AI", "教程"]${typeRule}${questionRule}${contractRule}`
      },
      {
        role: 'user',
        content: `当前笔记标题：${title}
当前笔记内容：${truncate(body, 4000)}

知识库中其他笔记（路径（标题））：
${others.map((c) => `- ${c.path}（${c.title}）`).join('\n') || '（暂无其他笔记）'}`
      }
    ]

    try {
      const result = await chatStream(provider, messages, {
        temperature: 0.3,
        maxTokens: 1000,
        stream: false,
        signal
      })
      const parsed = parseJsonObject(result.content)
      if (!parsed || typeof parsed !== 'object') {
        throw new Error(`AI 分析结果无法解析为 JSON。前 200 字符: ${result.content.slice(0, 200)}`)
      }

      const tags = strArr((parsed as any).tags)
      const summary = typeof (parsed as any).summary === 'string' ? String((parsed as any).summary).trim() : ''
      const suggestions = strArr((parsed as any).suggestions).slice(0, 3)

      // relations 校验：target 必须命中候选列表中的真实路径（映射回可跳转 relPath + 回填显示标题）
      const relations: NoteRelation[] = Array.isArray((parsed as any).relations)
        ? ((parsed as any).relations as Array<{ target?: unknown; reason?: unknown }>)
            .filter((r) => r && typeof r.target === 'string' && r.target.trim())
            .map((r) => ({
              target: (r.target as string).trim(),
              reason: typeof r.reason === 'string' ? r.reason.trim() : ''
            }))
            .filter((r) => candidateMap.has(r.target.toLowerCase()))
            .map((r) => ({ ...r, title: candidateMap.get(r.target.toLowerCase())!.title }))
            .slice(0, 5)
        : []

      return { tags, summary, relations, suggestions }
    } catch (e) {
      // 如实报错（由调用方传播给前端 aiError），AbortError 由调用方静默处理
      throw e instanceof Error ? e : new Error(`AI 分析失败: ${String(e)}`)
    } finally {
      this.untrack('analyze')
    }
  }

  // === 私有方法 ===

  /**
   * INGEST 分析：对单个原始来源执行编译（LLM Wiki 模式）
   * 一次调用生成 sources 页所需的全部结构化内容，
   * 并要求 LLM 基于已有概念列表做概念名称对齐（matchSlug）
   * @param openQuestions 开放问题列表（来自 QUESTIONS.md，判断本来源是否能回答）
   * @param isPersonal 是否为个人写作（raw/personal/，走个人写作流程）
   * @param contract 知识库行为契约（vault 根 CLAUDE.md 前 MAX_CONTRACT_CHARS 字符，每次摄入重新读盘）
   */
  async ingestSource(
    provider: ProviderConfig,
    rawTitle: string,
    rawBody: string,
    existingConcepts: ExistingConceptInfo[],
    openQuestions: string[] = [],
    isPersonal = false,
    contract = ''
  ): Promise<IngestAnalysis> {
    const signal = this.track('ingest')

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

    const contractRule = contract
      ? `\n\n=== 知识库行为契约（CLAUDE.md，必须遵守）===\n${contract}`
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
  "answeredQuestions": ["本来源能回答的开放问题原文（若下方开放问题列表中有能回答的，复制原问题文本；没有则省略该字段"],
  "language": "来源写作语言代码（zh/en/ja/…，无法判断则省略）",
  "canonicalSource": "若本来源是译文/转述/转载，填原始出处（URL 或标题）；原创来源省略该字段"
}
${personalRule}
概念对齐规则（重要）：
- 下方提供了知识库中已有概念列表（slug + 中文名 + aliases）
- 提取概念时，若该概念与已有概念的 slug、中文名、aliases 或语义相同 → 在 matchSlug 填入已有概念的 slug，表示"更新已有页"
- 只有确实不存在时才作为新概念（不填 matchSlug）
- 实体同理（知识库已有实体在下方列出时对齐）${contractRule}`
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
        maxTokens: 3000,
        stream: false,
        signal
      })
      const parsed = parseJsonObject(result.content)
      if (!parsed) {
        console.warn('[AiPipeline] INGEST LLM 输出无法解析为 JSON，将使用空兜底。前 200 字符:', result.content.slice(0, 200))
      }
      return sanitizeIngest(parsed ?? {})
    } catch (e) {
      throw new Error(`INGEST 分析失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      this.untrack('ingest')
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

/** 字符串数组清洗（过滤空串） */
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []
}

/** 清洗并校验 INGEST 分析结果（字段兜底） */
function sanitizeIngest(raw: any): IngestAnalysis {
  const str = (v: any, fallback = ''): string => (typeof v === 'string' && v.trim() ? v.trim() : fallback)
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
    answeredQuestions: strArr(raw.answeredQuestions),
    language: str(raw.language, undefined as any) || undefined,
    canonicalSource: str(raw.canonicalSource, undefined as any) || undefined
  }
}
