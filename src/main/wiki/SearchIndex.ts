import type { NoteMeta, SearchResult } from '../../shared/types'

interface IndexedDoc {
  path: string
  title: string
  content: string
  tags: string
}

export class SearchIndex {
  private docs: Map<string, IndexedDoc> = new Map()
  // 简单的倒排索引：词 → 文档路径集合
  private invertedIndex: Map<string, Set<string>> = new Map()

  /** 简易分词（支持中英文混合） */
  private tokenize(text: string): string[] {
    // 提取中文单字、英文单词、数字
    const tokens: string[] = []
    // 英文/数字词
    const wordRe = /[a-zA-Z0-9一-鿿]+/g
    let m: RegExpExecArray | null
    while ((m = wordRe.exec(text)) !== null) {
      const word = m[0].toLowerCase()
      if (word.length >= 2) {
        tokens.push(word)
      }
      // 中文按 bigram 拆分
      if (/[一-鿿]/.test(word) && word.length > 2) {
        for (let i = 0; i < word.length - 1; i++) {
          tokens.push(word.slice(i, i + 2))
        }
      }
    }
    return [...new Set(tokens)]
  }

  /** 索引一条笔记 */
  indexNote(note: NoteMeta, content: string): void {
    // 移除旧条目
    this.removeNote(note.path)

    const doc: IndexedDoc = {
      path: note.path,
      title: note.title,
      content: content.slice(0, 50000),
      tags: note.tags.join(' ')
    }
    this.docs.set(note.path, doc)

    const tokens = this.tokenize(`${doc.title} ${doc.tags} ${doc.content}`)
    for (const token of tokens) {
      let set = this.invertedIndex.get(token)
      if (!set) {
        set = new Set()
        this.invertedIndex.set(token, set)
      }
      set.add(note.path)
    }
  }

  /** 移除笔记索引 */
  removeNote(notePath: string): void {
    const doc = this.docs.get(notePath)
    if (doc) {
      const tokens = this.tokenize(`${doc.title} ${doc.tags} ${doc.content}`)
      for (const token of tokens) {
        const set = this.invertedIndex.get(token)
        if (set) {
          set.delete(notePath)
          if (set.size === 0) this.invertedIndex.delete(token)
        }
      }
    }
    this.docs.delete(notePath)
  }

  /** 全文搜索（TF-IDF 简化版） */
  search(query: string, limit = 20): SearchResult[] {
    const queryTokens = this.tokenize(query)
    if (queryTokens.length === 0) return []

    // 评分：匹配 token 数量
    const scores = new Map<string, number>()
    for (const token of queryTokens) {
      const paths = this.invertedIndex.get(token)
      if (!paths) continue
      for (const path of paths) {
        scores.set(path, (scores.get(path) || 0) + 1)
      }
    }

    // 排序、限制数量
    const ranked = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)

    return ranked.map(([path, score]) => {
      const doc = this.docs.get(path)
      const title = doc?.title || path
      const snippet = doc ? this.generateSnippet(doc.content, query) : ''
      return { path, title, snippet, score }
    })
  }

  /** 重建索引 */
  async rebuild(notes: Array<{ meta: NoteMeta; content: string }>): Promise<void> {
    this.docs.clear()
    this.invertedIndex.clear()
    for (const note of notes) {
      this.indexNote(note.meta, note.content)
    }
  }

  /** 导出索引 */
  export(): object {
    const docs: Record<string, IndexedDoc> = {}
    this.docs.forEach((doc, path) => { docs[path] = doc })
    const inverted: Record<string, string[]> = {}
    this.invertedIndex.forEach((set, token) => { inverted[token] = Array.from(set) })
    return { docs, inverted }
  }

  /** 从持久化数据恢复索引 */
  import(data: any): void {
    this.docs.clear()
    this.invertedIndex.clear()
    if (data.docs) {
      for (const [path, doc] of Object.entries(data.docs)) {
        this.docs.set(path, doc as IndexedDoc)
      }
    }
    if (data.inverted) {
      for (const [token, paths] of Object.entries(data.inverted)) {
        this.invertedIndex.set(token, new Set(paths as string[]))
      }
    }
  }

  /** 生成包含搜索关键词的摘录 */
  private generateSnippet(content: string, query: string): string {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) return content.slice(0, 200)

    const lower = content.toLowerCase()
    let bestIdx = -1
    for (const word of words) {
      const idx = lower.indexOf(word)
      if (idx !== -1) { bestIdx = idx; break }
    }
    if (bestIdx === -1) return content.slice(0, 200)

    const start = Math.max(0, bestIdx - 60)
    const end = Math.min(content.length, bestIdx + 140)
    let snippet = content.slice(start, end)
    if (start > 0) snippet = '…' + snippet
    if (end < content.length) snippet = snippet + '…'
    return snippet
  }
}
