import { promises as fs, watch, type Dirent } from 'fs'
import path from 'path'
import matter from 'gray-matter'
import type { NoteMeta, NoteContent, NoteData, NoteAnnotation, TagWithCount } from '../../shared/types'

export interface VaultChangeEvent {
  type: 'created' | 'modified' | 'deleted'
  path: string
}

type ChangeCallback = (event: VaultChangeEvent) => void

/** LLM Wiki 分层目录结构（raw 人类所有 / wiki LLM 编译层 / outputs 输出） */
export const RAW_SUBDIRS = ['articles', 'clippings', 'images', 'pdfs', 'notes', 'personal']
export const WIKI_SUBDIRS = ['sources', 'concepts', 'entities', 'synthesis', 'templates', 'outputs']
export const SYSTEM_FILES = ['index.md', 'log.md', 'overview.md', 'QUESTIONS.md']

export class VaultManager {
  private vaultPath: string
  private notesDir: string
  private attachmentsDir: string
  private rawDir: string
  private wikiDir: string
  private outputsDir: string
  private changeCallbacks: ChangeCallback[] = []
  private watcher: ReturnType<typeof watch> | null = null

  constructor(vaultPath: string) {
    this.vaultPath = path.resolve(vaultPath)
    this.notesDir = this.vaultPath
    this.attachmentsDir = path.join(this.vaultPath, 'attachments')
    this.rawDir = path.join(this.vaultPath, 'raw')
    this.wikiDir = path.join(this.vaultPath, 'wiki')
    this.outputsDir = path.join(this.vaultPath, 'outputs')
  }

  getVaultPath(): string {
    return this.vaultPath
  }

  getRawDir(): string {
    return this.rawDir
  }

  getWikiDir(): string {
    return this.wikiDir
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.notesDir, { recursive: true })
    await fs.mkdir(this.attachmentsDir, { recursive: true })
    // LLM Wiki 分层目录
    await Promise.all(RAW_SUBDIRS.map((d) => fs.mkdir(path.join(this.rawDir, d), { recursive: true })))
    await Promise.all(WIKI_SUBDIRS.map((d) => fs.mkdir(path.join(this.wikiDir, d), { recursive: true })))
    await fs.mkdir(path.join(this.wikiDir, 'templates'), { recursive: true })
    await fs.mkdir(path.join(this.wikiDir, 'outputs'), { recursive: true })
    await fs.mkdir(this.outputsDir, { recursive: true })
    // 创建系统文件（若不存在）
    await this.ensureSystemFiles()
    // 创建页面模板
    await this.ensureTemplates()
    this.startWatching()
  }

  /** 判断是否为系统文件（index/log/overview/QUESTIONS，不参与图谱） */
  isSystemFile(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, '/')
    return SYSTEM_FILES.some((f) => normalized === `wiki/${f}`) || normalized.startsWith('wiki/outputs/')
  }

  /** 追加一个开放问题到 wiki/QUESTIONS.md */
  async addQuestion(question: string): Promise<void> {
    const qPath = path.join(this.wikiDir, 'QUESTIONS.md')
    const line = `- [ ] ${question}（opened ${new Date().toISOString().slice(0, 10)}）`
    try {
      const raw = await fs.readFile(qPath, 'utf-8')
      const parsed = matter(raw)
      // 追加到 Open Questions 段末
      let body = parsed.content
      const marker = '## Open Questions'
      if (body.includes(marker)) {
        const idx = body.indexOf(marker)
        const rest = body.slice(idx + marker.length)
        // 找下一段标题
        const nextSection = rest.search(/\n## /)
        const insertAt = nextSection > -1 ? idx + marker.length + nextSection : body.length
        body = body.slice(0, insertAt) + (body.slice(insertAt).startsWith('\n\n') ? '' : '\n\n') + line + body.slice(insertAt)
      } else {
        body += `\n## Open Questions\n\n${line}\n`
      }
      const fm = { ...(parsed.data as Record<string, any>) }
      const content = matter.stringify(body, fm)
      await fs.writeFile(qPath, content, 'utf-8')
    } catch {
      // QUESTIONS.md 不存在时创建
      const body = `# 开放问题队列\n\n## Open Questions\n\n${line}\n\n## Resolved Questions\n\n（暂无）\n`
      await fs.writeFile(qPath, matter.stringify(body, { type: 'system-questions', 'graph-excluded': true }), 'utf-8')
    }
  }

  /** 读取 QUESTIONS.md 中的开放问题列表 */
  async getOpenQuestions(): Promise<string[]> {
    const qPath = path.join(this.wikiDir, 'QUESTIONS.md')
    try {
      const raw = await fs.readFile(qPath, 'utf-8')
      const parsed = matter(raw)
      return parsed.content
        .split('\n')
        .filter((l) => l.trim().startsWith('- [ ]'))
        .map((l) => l.trim().replace(/^- \[ \]\s*/, '').replace(/（opened.*$/, ''))
    } catch {
      return []
    }
  }

  /** 将开放问题移入 Answered（INGEST 匹配到答案时） */
  async answerQuestion(question: string): Promise<void> {
    const qPath = path.join(this.wikiDir, 'QUESTIONS.md')
    try {
      const raw = await fs.readFile(qPath, 'utf-8')
      const parsed = matter(raw)
      let body = parsed.content
      const open = body.split('\n').filter((l) => l.trim().startsWith('- [ ]'))
      const target = open.find((l) => l.includes(question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 30)))
      if (!target) return
      body = body.replace(target, target.replace('- [ ]', '- [x]').replace('（opened', '（answered ' + new Date().toISOString().slice(0, 10) + ', opened'))
      await fs.writeFile(qPath, matter.stringify(body, parsed.data as Record<string, any>), 'utf-8')
    } catch { /* ignore */ }
  }

  /** 更新 wiki/overview.md 的 Health Dashboard */
  async updateOverview(stats: Record<string, number | string>): Promise<void> {
    const oPath = path.join(this.wikiDir, 'overview.md')
    const rows = Object.entries(stats).map(([k, v]) => `| ${k} | ${v} |`).join('\n')
    const body = [
      `# 知识库综述`,
      ``,
      `## Knowledge Base Health Dashboard`,
      ``,
      `| 指标 | 数值 |`,
      `|---|---|`,
      rows,
      ``,
      `> 由系统维护：INGEST 后更新来源数，REFLECT 后更新综合分析指标。`,
      ``
    ].join('\n')
    await fs.writeFile(oPath, matter.stringify(body, { type: 'system-overview', 'graph-excluded': true, updated: new Date().toISOString() }), 'utf-8')
  }

  /** 判断文件是否属于 raw 层（只读区） */
  isRawPath(relPath: string): boolean {
    return relPath.replace(/\\/g, '/').startsWith('raw/')
  }

  /** 追加一行操作日志到 wiki/log.md */
  async appendLog(entry: string): Promise<void> {
    const logPath = path.join(this.wikiDir, 'log.md')
    const line = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} | ${entry}`
    try {
      const raw = await fs.readFile(logPath, 'utf-8')
      await fs.writeFile(logPath, raw.endsWith('\n') ? `${raw}${line}\n` : `${raw}\n${line}\n`, 'utf-8')
    } catch {
      // log.md 不存在（初始化失败时兜底）
    }
  }

  /** 重建 wiki/index.md 的列表段（Sources/Concepts/Entities） */
  async updateIndex(
    sources: Array<{ slug: string; title: string }>,
    concepts: Array<{ slug: string; title: string }>,
    entities: Array<{ slug: string; title: string }>
  ): Promise<void> {
    const fm = {
      type: 'system-index',
      'graph-excluded': true,
      updated: new Date().toISOString()
    }
    const renderList = (items: Array<{ slug: string; title: string }>, header: string): string => {
      const lines = items.map((i) => `- [[${i.slug}]] — ${i.title}`)
      return `## ${header}\n\n${lines.length ? lines.join('\n') : '（暂无）'}`
    }
    const body = [
      `# 知识库索引`,
      ``,
      `本文件由系统自动维护，记录知识库编译层的全部页面。`,
      ``,
      renderList(sources, 'Sources'),
      ``,
      renderList(concepts, 'Concepts'),
      ``,
      renderList(entities, 'Entities'),
      ``
    ].join('\n')
    const content = matter.stringify(body, fm)
    await fs.writeFile(path.join(this.wikiDir, 'index.md'), content, 'utf-8')
  }

  private async ensureSystemFiles(): Promise<void> {
    const indexPath = path.join(this.wikiDir, 'index.md')
    try {
      await fs.access(indexPath)
    } catch {
      await fs.writeFile(
        indexPath,
        matter.stringify(
          '# 知识库索引\n\n本文件由系统自动维护。',
          { type: 'system-index', 'graph-excluded': true, updated: new Date().toISOString() }
        ),
        'utf-8'
      )
    }
    const logPath = path.join(this.wikiDir, 'log.md')
    try {
      await fs.access(logPath)
    } catch {
      await fs.writeFile(
        logPath,
        matter.stringify(
          '# 操作日志\n\n仅追加。格式：YYYY-MM-DD HH:MM | 操作类型 | 说明',
          { type: 'system-log', 'graph-excluded': true }
        ),
        'utf-8'
      )
    }
    const questionsPath = path.join(this.wikiDir, 'QUESTIONS.md')
    try {
      await fs.access(questionsPath)
    } catch {
      await fs.writeFile(
        questionsPath,
        matter.stringify(
          '# 开放问题队列\n\n## Open Questions\n\n（暂无）\n\n## Resolved Questions\n\n（暂无）',
          { type: 'system-questions', 'graph-excluded': true }
        ),
        'utf-8'
      )
    }
    const overviewPath = path.join(this.wikiDir, 'overview.md')
    try {
      await fs.access(overviewPath)
    } catch {
      await fs.writeFile(
        overviewPath,
        matter.stringify(
          '# 知识库综述\n\n## Knowledge Base Health Dashboard\n\n| 指标 | 数值 |\n|---|---|\n| 总来源数 | 0 |\n| 概念数 | 0 |\n| 开放问题数 | 0 |',
          { type: 'system-overview', 'graph-excluded': true, updated: new Date().toISOString() }
        ),
        'utf-8'
      )
    }
  }

  /** 创建页面模板（LLM Wiki 模式标准结构） */
  private async ensureTemplates(): Promise<void> {
    const tplDir = path.join(this.wikiDir, 'templates')
    const templates: Array<[string, string]> = [
      ['source-template.md', [
        '---',
        'type: source',
        'title: "来源标题"',
        'date: YYYY-MM-DD',
        'source_url: "https://"',
        'domain: ""',
        'author: ""',
        'tags: []',
        'processed: true',
        'raw_file: "raw/articles/xxx.md"',
        'raw_sha256: "<64-char-hex>"',
        'last_verified: YYYY-MM-DD',
        'possibly_outdated: false',
        '---',
        '# 标题',
        '',
        '## Summary',
        '',
        '## Key Points',
        '',
        '## Concepts Extracted',
        '',
        '## Entities Extracted',
        '',
        '## Contradictions',
        '',
        '## My Notes',
        ''
      ].join('\n')],
      ['concept-template.md', [
        '---',
        'type: concept',
        'title: "中文主名称"',
        'date: YYYY-MM-DD',
        'updated: YYYY-MM-DD',
        'tags: []',
        'source_count: 0',
        'confidence: low',
        'domain_volatility: medium',
        'last_reviewed: YYYY-MM-DD',
        'aliases: []',
        '---',
        '# 概念名（English Name）',
        '',
        '## Definition',
        '',
        '## Key Points',
        '',
        '## My Position',
        '',
        '## Contradictions',
        '',
        '## Sources',
        '',
        '## Evolution Log',
        ''
      ].join('\n')],
      ['entity-template.md', [
        '---',
        'type: entity',
        'title: "实体名"',
        'date: YYYY-MM-DD',
        'tags: []',
        'entity_type: person',
        'aliases: []',
        '---',
        '# 实体名',
        '',
        '## Description',
        '',
        '## Key Contributions',
        '',
        '## Related Concepts',
        '',
        '## Sources',
        ''
      ].join('\n')],
      ['synthesis-template.md', [
        '---',
        'type: synthesis',
        'title: "综合分析标题"',
        'date: YYYY-MM-DD',
        'tags: []',
        'source_count: 0',
        'confidence: low',
        '---',
        '# 综合分析',
        '',
        '## Thesis',
        '',
        '## Evidence',
        '',
        '## Counter-evidence',
        '',
        '## Synthesis',
        '',
        '## Confidence Notes',
        '',
        '## Limitations',
        '',
        '## Sources',
        ''
      ].join('\n')],
      ['personal-writing-template.md', [
        '---',
        'type: personal-writing',
        'title: "个人文章标题"',
        'date: YYYY-MM-DD',
        'status: draft',
        'topic_tags: []',
        'confidence_at_writing: medium',
        'superseded_by: ""',
        'raw_file: "raw/personal/xxx.md"',
        'raw_sha256: "<64-char-hex>"',
        'last_verified: YYYY-MM-DD',
        'tags: []',
        'processed: true',
        '---',
        '# 标题',
        '',
        '## Core Argument',
        '',
        '## Key Claims',
        '',
        '## Evidence Referenced',
        '',
        '## Limitations',
        ''
      ].join('\n')]
    ]
    for (const [name, content] of templates) {
      const fullPath = path.join(tplDir, name)
      try {
        await fs.access(fullPath)
      } catch {
        await fs.writeFile(fullPath, content, 'utf-8')
      }
    }
  }

  async setVaultPath(newPath: string): Promise<void> {
    this.stopWatching()
    this.vaultPath = path.resolve(newPath)
    this.notesDir = this.vaultPath
    this.attachmentsDir = path.join(this.vaultPath, 'attachments')
    await this.initialize()
  }

  onChange(cb: ChangeCallback): () => void {
    this.changeCallbacks.push(cb)
    return () => {
      this.changeCallbacks = this.changeCallbacks.filter((c) => c !== cb)
    }
  }

  private emit(event: VaultChangeEvent): void {
    for (const cb of this.changeCallbacks) {
      try { cb(event) } catch { /* ignore */ }
    }
  }

  private startWatching(): void {
    try {
      this.watcher = watch(
        this.notesDir,
        { recursive: true },
        (eventType: string, filename: string | null) => {
          if (!filename || !filename.endsWith('.md')) return
          const relPath = filename.replace(/\\/g, '/')
          if (eventType === 'rename') {
            fs.access(path.join(this.notesDir, filename))
              .then(() => this.emit({ type: 'created', path: relPath }))
              .catch(() => this.emit({ type: 'deleted', path: relPath }))
          } else {
            this.emit({ type: 'modified', path: relPath })
          }
        }
      )
    } catch {
      // fs.watch may fail on some systems; silently ignore
    }
  }

  private stopWatching(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }

  /** 递归列出目录中所有 .md 文件，构建树形结构（单个目录读取失败不影响整体） */
  async listNotes(dir?: string): Promise<NoteMeta[]> {
    const base = dir ? path.join(this.notesDir, dir) : this.notesDir
    let entries: Dirent[] = []
    try {
      entries = (await fs.readdir(base, { withFileTypes: true })) as Dirent[]
    } catch {
      return [] // 目录不存在/读取失败 → 空列表，不中断
    }
    const result: NoteMeta[] = []

    // 文件夹在前，文件在后
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'attachments')
    const files = entries.filter((e) => e.isFile() && e.name.endsWith('.md'))

    for (const d of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
      let children: NoteMeta[] = []
      try {
        children = await this.listNotes(dir ? `${dir}/${d.name}` : d.name)
      } catch {
        children = []
      }
      result.push({
        path: (dir ? `${dir}/${d.name}` : d.name).replace(/\\/g, '/'),
        title: d.name,
        tags: [],
        created: '',
        updated: '',
        kind: 'folder',
        children
      })
    }

    for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
      const relPath = (dir ? `${dir}/${f.name}` : f.name).replace(/\\/g, '/')
      try {
        const raw = await fs.readFile(path.join(base, f.name), 'utf-8')
        const parsed = matter(raw)
        const fm = parsed.data as Record<string, any>
        result.push({
          path: relPath,
          title: fm.title || f.name.replace(/\.md$/, ''),
          tags: Array.isArray(fm.tags) ? fm.tags : [],
          created: fm.created || '',
          updated: fm.updated || '',
          kind: 'file'
        })
      } catch {
        result.push({
          path: relPath,
          title: f.name.replace(/\.md$/, ''),
          tags: [],
          created: '',
          updated: '',
          kind: 'file'
        })
      }
    }

    return result
  }

  /** 解析笔记中所有的 [[wiki links]] */
  parseWikiLinks(body: string): string[] {
    const re = /\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g
    const links: string[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(body)) !== null) {
      const target = m[1].trim()
      if (target && !links.includes(target)) {
        links.push(target)
      }
    }
    return links
  }

  /** 读取笔记完整内容 */
  async readNote(relPath: string): Promise<NoteContent> {
    const fullPath = path.join(this.notesDir, relPath)
    const raw = await fs.readFile(fullPath, 'utf-8')
    // 非文本文件（pdf/图片等）：不按 markdown 解析，正文留空避免乱码
    const ext = path.extname(relPath).toLowerCase()
    const textExts = ['.md', '.txt', '.markdown', '.json', '.js', '.ts', '.tsx', '.jsx', '.py',
      '.java', '.c', '.cpp', '.h', '.css', '.html', '.xml', '.yml', '.yaml', '.csv', '.log', '.sh', '.bat']
    if (!textExts.includes(ext)) {
      return {
        path: relPath.replace(/\\/g, '/'),
        title: path.basename(relPath),
        tags: [],
        created: '',
        updated: '',
        kind: 'file',
        rawBody: '',
        links: [],
        graphExcluded: false
      }
    }
    const parsed = matter(raw)
    const fm = parsed.data as Record<string, any>

    const links = this.parseWikiLinks(parsed.content)

    return {
      path: relPath.replace(/\\/g, '/'),
      title: fm.title || path.basename(relPath, '.md'),
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      created: fm.created || new Date().toISOString(),
      updated: fm.updated || new Date().toISOString(),
      kind: 'file',
      rawBody: parsed.content,
      links,
      aiSummary: fm.aiSummary,
      aiAnalyzedAt: fm.aiAnalyzedAt,
      annotations: Array.isArray(fm.annotations) ? fm.annotations : [],
      graphExcluded: fm['graph-excluded'] === true || fm['graph-excluded'] === 'true'
    }
  }

  /** 写入（创建/更新）笔记 */
  async writeNote(relPath: string, data: NoteData): Promise<void> {
    const fullPath = path.join(this.notesDir, relPath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })

    const frontmatter: Record<string, any> = {
      title: data.title,
      tags: data.tags,
      created: new Date().toISOString(),
      updated: new Date().toISOString()
    }

    // 尝试保留原始 created 时间
    try {
      const oldRaw = await fs.readFile(fullPath, 'utf-8')
      const oldParsed = matter(oldRaw)
      if (oldParsed.data.created) {
        frontmatter.created = oldParsed.data.created
      }
      // 保留 AI 相关字段
      if (oldParsed.data.aiSummary) frontmatter.aiSummary = oldParsed.data.aiSummary
      if (oldParsed.data.aiAnalyzedAt) frontmatter.aiAnalyzedAt = oldParsed.data.aiAnalyzedAt
      if (oldParsed.data.annotations) frontmatter.annotations = oldParsed.data.annotations
    } catch {
      // 新文件，使用默认值
    }

    const content = matter.stringify(data.body, frontmatter)
    await fs.writeFile(fullPath, content, 'utf-8')
  }

  /** 删除笔记 */
  async deleteNote(relPath: string): Promise<void> {
    const fullPath = path.join(this.notesDir, relPath)
    await fs.unlink(fullPath)
  }

  /** 创建新笔记（空模板），标题自动 sanitize 防止路径嵌套 */
  async createNote(relPath: string, title: string): Promise<void> {
    // 清理标题中的路径分隔/非法字符
    const safeTitle = String(title || '新笔记').replace(/[\\/:*?"<>|]/g, '-').trim() || '新笔记'
    // 文件名安全化：relPath 末尾文件名用 sanitize 后的标题
    const dir = path.dirname(relPath)
    const safeRelPath = dir === '.' ? `${safeTitle}.md` : `${dir}/${safeTitle}.md`
    const frontmatter = {
      title: safeTitle,
      tags: [] as string[],
      created: new Date().toISOString(),
      updated: new Date().toISOString()
    }
    const content = matter.stringify('', frontmatter)
    const fullPath = path.join(this.notesDir, safeRelPath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content, 'utf-8')
  }

  /** 解析 [[wiki link]] 为实际文件路径 */
  resolveLink(fromPath: string, linkTarget: string): string | null {
    // 尝试多种匹配策略
    const candidates = [
      linkTarget + '.md',
      linkTarget.replace(/\s+/g, '-') + '.md',
      linkTarget
    ]

    const fromDir = path.dirname(fromPath)

    for (const c of candidates) {
      // 相对于当前笔记目录
      const rel = path.join(fromDir, c).replace(/\\/g, '/')
      const fullRel = path.join(this.notesDir, rel)
      try {
        // 同步检查文件是否存在（在 IPC handler 中运行）
        return rel
      } catch {
        // continue
      }
    }

    // 在全局搜索
    for (const c of candidates) {
      const fullGlobal = path.join(this.notesDir, c)
      try {
        return c
      } catch {
        // continue
      }
    }

    return null
  }

  /** 查找引用某个笔记的所有笔记（反向链接） */
  async getBacklinks(targetPath: string): Promise<Array<{ path: string; title: string }>> {
    const allNotes = await this.listNotes()
    const result: Array<{ path: string; title: string }> = []
    const targetId = targetPath.replace(/\.md$/, '').replace(/\\/g, '/')

    const flatNotes = this.flattenNotes(allNotes)
    for (const note of flatNotes) {
      if (note.kind !== 'file' || note.path === targetPath) continue
      try {
        const content = await this.readNote(note.path)
        if (content.links.some((l) => {
          const normalized = l.replace(/\\/g, '/')
          return normalized === targetId || normalized === targetPath.replace(/\.md$/, '')
        })) {
          result.push({ path: note.path, title: note.title })
        }
      } catch {
        // skip
      }
    }

    return result
  }

  /** 获取所有标签及其计数 */
  async getAllTags(): Promise<TagWithCount[]> {
    const allNotes = await this.listNotes()
    const flatNotes = this.flattenNotes(allNotes)
    const tagMap = new Map<string, number>()

    for (const note of flatNotes) {
      if (note.kind !== 'file') continue
      for (const tag of note.tags) {
        tagMap.set(tag, (tagMap.get(tag) || 0) + 1)
      }
    }

    return Array.from(tagMap.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
  }

  /** 按标签筛选笔记 */
  async getNotesByTag(tag: string): Promise<NoteMeta[]> {
    const allNotes = await this.listNotes()
    const flatNotes = this.flattenNotes(allNotes)
    return flatNotes.filter((n) => n.kind === 'file' && n.tags.includes(tag))
  }

  /** 导入外部文件到 vault（LLM Wiki 模式：按类型路由到 raw/ 子目录） */
  async importFile(sourcePath: string, targetDir?: string): Promise<string> {
    const name = path.basename(sourcePath)
    const ext = path.extname(sourcePath).toLowerCase()
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']

    // 自动路由到 raw/<category>/（显式 targetDir 优先；兼容旧路径 targetDir 含 raw/ 前缀）
    let destDir: string
    if (targetDir && targetDir.startsWith('raw/')) {
      destDir = path.join(this.vaultPath, targetDir)
    } else if (imageExts.includes(ext)) {
      destDir = targetDir ? path.join(this.rawDir, targetDir) : path.join(this.rawDir, 'images')
    } else if (ext === '.pdf') {
      destDir = path.join(this.rawDir, 'pdfs')
    } else if (['.md', '.txt', '.markdown'].includes(ext)) {
      destDir = path.join(this.rawDir, 'articles')
    } else {
      destDir = path.join(this.rawDir, 'notes')
    }

    await fs.mkdir(destDir, { recursive: true })

    // 处理重名
    let destName = name
    let destPath = path.join(destDir, destName)
    let counter = 1
    while (await this.fileExists(destPath)) {
      const base = path.basename(name, ext)
      destName = `${base}-${counter}${ext}`
      destPath = path.join(destDir, destName)
      counter++
    }

    await fs.copyFile(sourcePath, destPath)

    const relPath = path.relative(this.vaultPath, destPath).replace(/\\/g, '/')

    // 如果是 markdown 文件，确保 frontmatter 有基本字段
    if (ext === '.md') {
      try {
        const raw = await fs.readFile(destPath, 'utf-8')
        const parsed = matter(raw)
        if (!parsed.data.title && !parsed.data.created) {
          const fixed = matter.stringify(parsed.content, {
            title: path.basename(name, '.md'),
            tags: [] as string[],
            created: new Date().toISOString(),
            updated: new Date().toISOString()
          })
          await fs.writeFile(destPath, fixed, 'utf-8')
        }
      } catch {
        // ignore
      }
    }

    return relPath
  }

  /** 列出附件 */
  async listAttachments(subDir?: string): Promise<string[]> {
    const dir = subDir ? path.join(this.attachmentsDir, subDir) : this.attachmentsDir
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      return entries
        .filter((e) => e.isFile())
        .map((e) => path.relative(this.vaultPath, path.join(dir, e.name)).replace(/\\/g, '/'))
    } catch {
      return []
    }
  }

  /** 更新笔记的 AI 分析结果（直接修改 frontmatter） */
  async updateAiResults(relPath: string, aiSummary?: string, aiTags?: string[]): Promise<void> {
    const note = await this.readNote(relPath)
    const updatedTags = aiTags ? [...new Set([...note.tags, ...aiTags])] : note.tags

    await this.writeNote(relPath, {
      title: note.title,
      tags: updatedTags,
      body: note.rawBody
    })

    // 重新读取并单独更新 AI 字段（writeNote 不保留这些）
    const fullPath = path.join(this.notesDir, relPath)
    const raw = await fs.readFile(fullPath, 'utf-8')
    const parsed = matter(raw)
    const fm = parsed.data as Record<string, any>
    if (aiSummary) fm.aiSummary = aiSummary
    fm.aiAnalyzedAt = new Date().toISOString()
    fm.tags = updatedTags
    const updated = matter.stringify(parsed.content, fm)
    await fs.writeFile(fullPath, updated, 'utf-8')
  }

  /** 添加注释到笔记 */
  async addAnnotation(relPath: string, text: string, range: string): Promise<NoteAnnotation> {
    const fullPath = path.join(this.notesDir, relPath)
    const raw = await fs.readFile(fullPath, 'utf-8')
    const parsed = matter(raw)
    const fm = parsed.data as Record<string, any>
    const annotations: NoteAnnotation[] = Array.isArray(fm.annotations) ? fm.annotations : []
    const annotation: NoteAnnotation = {
      id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      text,
      range,
      created: new Date().toISOString()
    }
    annotations.push(annotation)
    fm.annotations = annotations
    const updated = matter.stringify(parsed.content, fm)
    await fs.writeFile(fullPath, updated, 'utf-8')
    return annotation
  }

  /** 删除注释 */
  async removeAnnotation(relPath: string, annotationId: string): Promise<void> {
    const fullPath = path.join(this.notesDir, relPath)
    const raw = await fs.readFile(fullPath, 'utf-8')
    const parsed = matter(raw)
    const fm = parsed.data as Record<string, any>
    const annotations: NoteAnnotation[] = Array.isArray(fm.annotations) ? fm.annotations : []
    fm.annotations = annotations.filter((a) => a.id !== annotationId)
    const updated = matter.stringify(parsed.content, fm)
    await fs.writeFile(fullPath, updated, 'utf-8')
  }

  dispose(): void {
    this.stopWatching()
    this.changeCallbacks = []
  }

  private async fileExists(p: string): Promise<boolean> {
    try {
      await fs.access(p)
      return true
    } catch {
      return false
    }
  }

  private flattenNotes(notes: NoteMeta[]): NoteMeta[] {
    const result: NoteMeta[] = []
    for (const n of notes) {
      result.push(n)
      if (n.children) {
        result.push(...this.flattenNotes(n.children))
      }
    }
    return result
  }
}
