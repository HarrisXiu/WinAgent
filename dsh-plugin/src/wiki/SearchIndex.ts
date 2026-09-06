import type { NoteMeta, SearchResult } from '../shared/types'

/** 单条倒排记录：tf 为该 token 在文档中的出现次数，weight 为命中的最高字段权重 */
interface PostingEntry {
  tf: number
  weight: number
}

interface IndexedDoc {
  path: string
  title: string
  content: string
  tags: string
  summary: string
  aliases: string
  confidence?: string
  sourceCount?: number
}

/** 字段权重：标题最高，别名次之（中文名/英文全名兜底检索），正文最低 */
const FIELD_WEIGHT_TITLE = 4
const FIELD_WEIGHT_ALIASES = 3.5
const FIELD_WEIGHT_TAGS = 3
const FIELD_WEIGHT_SUMMARY = 2.5
const FIELD_WEIGHT_CONTENT = 1
/** 中文 unigram 权重折扣：单字区分度低，靠 IDF 压制常见字噪音 */
const UNIGRAM_DISCOUNT = 0.5

/**
 * 内存倒排索引（BM25 简化版）：
 * - 中英混合分词，中文滑窗 bigram + 低权重 unigram（单字查询不再全空）
 * - 字段加权（title/aliases/tags/summary/content）
 * - IDF 加权评分并归一化到 0~1（跨查询可比，供 RAG 阈值过滤）
 */
export class SearchIndex {
  private docs: Map<string, IndexedDoc> = new Map()
  // 倒排索引：token → (path → {tf, weight})
  private postings: Map<string, Map<string, PostingEntry>> = new Map()
  // 反查表：path → 该文档出现过的全部 token（removeNote 用，避免重新分词）
  private pathTokens: Map<string, Set<string>> = new Map()

  /** 中英文混合分词：英文/数字词（≥2 字符）+ 中文 bigram/unigram */
  private tokenize(text: string): string[] {
    return [...this.tokenizeFields([{ text, weight: 1 }]).keys()]
  }

  /**
   * 分字段分词：对每个字段按其权重生成 token → 权重映射（同 token 取最高权重）。
   * 中文串同时产出 bigram（原权重）与 unigram（原权重 × UNIGRAM_DISCOUNT）。
   */
  private tokenizeFields(fields: Array<{ text: string; weight: number }>): Map<string, number> {
    const weights = new Map<string, number>()
    const bump = (token: string, weight: number): void => {
      const prev = weights.get(token)
      if (prev === undefined || weight > prev) weights.set(token, weight)
    }
    for (const field of fields) {
      const wordRe = /[a-zA-Z0-9一-鿿]+/g
      let m: RegExpExecArray | null
      while ((m = wordRe.exec(field.text)) !== null) {
        const word = m[0].toLowerCase()
        if (word.length >= 2) bump(word, field.weight)
        if (/[一-鿿]/.test(word)) {
          if (word.length > 2) {
            // 滑窗 bigram 覆盖子串命中
            for (let i = 0; i < word.length - 1; i++) bump(word.slice(i, i + 2), field.weight)
          }
          // unigram：单字查询兜底（低权重 + IDF 自然压制常见字）；单字 CJK 串也入索引
          for (const ch of word) bump(ch, field.weight * UNIGRAM_DISCOUNT)
        }
      }
    }
    return weights
  }

  /**
   * 索引一条笔记（summary 为 AI 摘要，检索时随结果返回便于直接回答）。
   * extra 携带 frontmatter 中的 confidence / source_count / aliases。
   */
  indexNote(
    note: NoteMeta,
    content: string,
    summary?: string,
    extra?: { aliases?: string[]; confidence?: string; sourceCount?: number }
  ): void {
    // 移除旧条目
    this.removeNote(note.path)

    const aliases = (extra?.aliases || []).filter(Boolean).join(' ')
    const doc: IndexedDoc = {
      path: note.path,
      title: note.title,
      content: content.slice(0, 50000),
      tags: note.tags.join(' '),
      summary: (summary || '').slice(0, 500),
      aliases,
      confidence: extra?.confidence,
      sourceCount: extra?.sourceCount
    }
    this.docs.set(note.path, doc)

    const tokens = this.tokenizeFields([
      { text: doc.title, weight: FIELD_WEIGHT_TITLE },
      { text: doc.aliases, weight: FIELD_WEIGHT_ALIASES },
      { text: doc.tags, weight: FIELD_WEIGHT_TAGS },
      { text: doc.summary, weight: FIELD_WEIGHT_SUMMARY },
      { text: doc.content, weight: FIELD_WEIGHT_CONTENT }
    ])
    const seen = new Set<string>()
    for (const [token, weight] of tokens) {
      let entry = this.postings.get(token)
      if (!entry) {
        entry = new Map()
        this.postings.set(token, entry)
      }
      const prev = entry.get(note.path)
      // 同 token 命中多字段时保留最高权重；tf 累加出现次数
      entry.set(note.path, { tf: (prev?.tf || 0) + 1, weight: Math.max(weight, prev?.weight || 0) })
      seen.add(token)
    }
    this.pathTokens.set(note.path, seen)
  }

  /** 移除笔记索引 */
  removeNote(notePath: string): void {
    const tokens = this.pathTokens.get(notePath)
    if (tokens) {
      for (const token of tokens) {
        const entry = this.postings.get(token)
        if (entry) {
          entry.delete(notePath)
          if (entry.size === 0) this.postings.delete(token)
        }
      }
    }
    this.pathTokens.delete(notePath)
    this.docs.delete(notePath)
  }

  /** 全文搜索：IDF 加权评分，归一化到 0~1 */
  search(query: string, limit = 20): SearchResult[] {
    const queryWeights = this.tokenizeFields([{ text: query, weight: 1 }])
    if (queryWeights.size === 0) return []

    const n = this.docs.size
    // 分子：Σ idf(token) × (1 + ln(tf)) × fieldWeight
    const scores = new Map<string, number>()
    // 分母：Σ idf(queryTokens)，把分数归一化到 0~1
    let idfSum = 0
    for (const [token] of queryWeights) {
      const entry = this.postings.get(token)
      const idf = Math.log(1 + n / (1 + (entry ? entry.size : 0)))
      idfSum += idf
      if (!entry) continue
      for (const [path, posting] of entry) {
        const contrib = idf * (1 + Math.log(posting.tf)) * posting.weight
        scores.set(path, (scores.get(path) || 0) + contrib)
      }
    }
    if (idfSum <= 0 || scores.size === 0) return []

    const ranked = Array.from(scores.entries())
      .map(([path, score]) => ({ path, norm: score / idfSum }))
      .sort((a, b) => b.norm - a.norm)
      .slice(0, limit)

    return ranked.map(({ path, norm }) => {
      const doc = this.docs.get(path)
      const title = doc?.title || path
      const snippet = doc ? this.generateSnippet(doc, query) : ''
      return {
        path,
        title,
        snippet,
        score: Number.isFinite(norm) ? Math.max(0, Math.min(1, norm)) : 0,
        summary: doc?.summary || undefined,
        confidence: doc?.confidence,
        sourceCount: doc?.sourceCount
      }
    })
  }

  /** 重建索引 */
  async rebuild(notes: Array<{ meta: NoteMeta; content: string; summary?: string; extra?: { aliases?: string[]; confidence?: string; sourceCount?: number } }>): Promise<void> {
    this.docs.clear()
    this.postings.clear()
    this.pathTokens.clear()
    for (const note of notes) {
      this.indexNote(note.meta, note.content, note.summary, note.extra)
    }
  }

  /** 生成包含搜索关键词的摘录：summary 优先，content 兜底，窗口 ±60/140 */
  private generateSnippet(doc: IndexedDoc, query: string): string {
    const tokens = [...this.tokenize(query).filter((t) => t.length >= 2 || /[一-鿿]/.test(t))]
    const pick = (source: string): number => {
      const lower = source.toLowerCase()
      // 优先长 token（bigram/整词）命中，位置更可信
      const ordered = [...tokens].sort((a, b) => b.length - a.length)
      for (const token of ordered) {
        const idx = lower.indexOf(token)
        if (idx !== -1) return idx
      }
      return -1
    }
    const target = doc.summary || doc.content
    let bestIdx = tokens.length > 0 ? pick(target) : -1
    if (bestIdx === -1 && doc.summary) {
      // summary 未命中再试正文
      bestIdx = pick(doc.content)
      if (bestIdx !== -1) return this.sliceWindow(doc.content, bestIdx)
    }
    if (bestIdx === -1) return (doc.summary || doc.content).slice(0, 200)
    return this.sliceWindow(target, bestIdx)
  }

  private sliceWindow(content: string, idx: number): string {
    const start = Math.max(0, idx - 60)
    const end = Math.min(content.length, idx + 140)
    let snippet = content.slice(start, end)
    if (start > 0) snippet = '…' + snippet
    if (end < content.length) snippet = snippet + '…'
    return snippet
  }
}
