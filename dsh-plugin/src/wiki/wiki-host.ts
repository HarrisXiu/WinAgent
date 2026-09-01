/**
 * Wiki 宿主：LLM Wiki 知识库管线（INGEST / 导入 / 工作流）从 Electron 主进程
 * 移植到 DSH 插件。事件广播由 IPC 改为 EventBus。
 * @module dsh-winagent/wiki-host
 */
import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import path from 'path'
import { spawn } from 'child_process'
import matter from 'gray-matter'
import { Logger } from '../util/Logger'
import { EventBus } from '../event-bus'
import { PACKAGE_ROOT, skillEnv } from '../platform'
import type { ConfigStore } from '../config/ConfigStore'
import { VaultManager } from './VaultManager'
import { SearchIndex } from './SearchIndex'
import { GraphEngine, type GraphInput } from './GraphEngine'
import { AiPipeline, type NoteType } from './AiPipeline'
import { readContract, readContractSections } from './contract'
import { runLint, runMerge, runReflect, runQuery } from './WorkflowService'
import type {
  AISuggestion, AnalysisTag, BatchIngestDoneResult, BatchIngestStartResult,
  CustomAnalysisOutput, GraphData, ImportAnalyzeResult, IngestProgress,
  IngestResult, NoteContent, NoteData, NoteMeta, SearchResult, TagWithCount,
  WorkflowResult, LintWorkflowResult, NoteAnnotation, VaultChangeEvent
} from '../shared/types'

/** 扁平化笔记树 */
export function flattenWikiNotes(notes: NoteMeta[]): NoteMeta[] {
  const result: NoteMeta[] = []
  for (const n of notes) {
    result.push(n)
    if (n.children) result.push(...flattenWikiNotes(n.children))
  }
  return result
}

/** 中文名 → 英文小写连字符 slug */
function slugify(name: string): string {
  const ascii = name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
  return ascii || `concept-${Date.now().toString(36)}`
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

function isOlderThan(dateStr: string, days: number): boolean {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return false
  return Date.now() - d.getTime() > days * 24 * 60 * 60 * 1000
}

/**
 * 子进程调用文档提取脚本（pdf/pptx/docx/xlsx/xlsm/doc/xls/ppt）。
 * 与 skill 同一代码路径；NODE_PATH 让脚本能 require 插件依赖。
 */
function extractDocumentText(absPath: string, format: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(PACKAGE_ROOT, 'assets', 'skills', 'pdf', 'read_doc.js')
    const proc = spawn(process.execPath, [scriptPath], { env: skillEnv(), windowsHide: true })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('close', (code) => {
      if (code === 0) {
        try {
          const parsed = JSON.parse(out.trim())
          resolve(String(parsed.text || ''))
        } catch {
          reject(new Error('提取脚本输出解析失败'))
        }
      } else {
        reject(new Error(err.trim() || `提取脚本退出码 ${code}`))
      }
    })
    proc.on('error', (e) => reject(e))
    proc.stdin.write(JSON.stringify({ path: absPath, format }))
    proc.stdin.end()
  })
}

/** 批量摄入会话（交互式标定：先编译 1 篇暂停审查，确认后继续） */
interface BatchSession {
  pending: string[]
  done: IngestResult[]
  errors: Array<{ path: string; error: string }>
  active: boolean
}

export class WikiHost {
  vault: VaultManager
  search: SearchIndex
  graph: GraphEngine
  pipeline: AiPipeline

  private batchSession: BatchSession | null = null
  private autoIngestQueue = new Map<string, ReturnType<typeof setTimeout>>()
  private recentIngests = new Map<string, number>()

  constructor(
    private store: ConfigStore,
    private bus: EventBus,
  ) {
    this.vault = new VaultManager(store.resolveVaultPath())
    this.search = new SearchIndex()
    this.graph = new GraphEngine()
    this.pipeline = new AiPipeline()
  }

  async init(): Promise<void> {
    await this.vault.initialize()
    this.vault.onChange((event: VaultChangeEvent) => {
      this.bus.push('vaultChanged', event)
      if (event.type === 'created' && event.path.startsWith('raw/') && event.path !== 'raw/') {
        this.scheduleAutoIngest(event.path)
      }
    })
    await this.indexWikiVault()
    await this.rebuildGraph()
  }

  dispose(): void {
    this.vault.dispose()
    for (const timer of this.autoIngestQueue.values()) clearTimeout(timer)
    this.autoIngestQueue.clear()
  }

  /** 后台索引 wiki 层笔记（raw 层不索引） */
  async indexWikiVault(): Promise<void> {
    const allNotes = await this.vault.listNotes()
    const flatNotes = flattenWikiNotes(allNotes)
    const filesOnly = flatNotes.filter((n) => n.kind === 'file' && n.path.startsWith('wiki/'))
    const indexData: Array<{ meta: NoteMeta; content: string; summary?: string }> = []
    for (const n of filesOnly) {
      try {
        const content = await this.vault.readNote(n.path)
        indexData.push({ meta: n, content: content.rawBody, summary: content.aiSummary })
      } catch { /* skip */ }
    }
    for (const d of indexData) {
      this.search.indexNote(d.meta, d.content, d.summary)
    }
    Logger.info(`[Wiki] 已索引 ${indexData.length} 篇 wiki 笔记`)
  }

  /** 从 VaultManager 收集笔记并重建图谱（只含 wiki/ 层，排除 graph-excluded） */
  async rebuildGraph(): Promise<void> {
    const notes = await this.vault.listNotes()
    const flatNotes = flattenWikiNotes(notes).filter((n) => n.kind === 'file' && n.path.startsWith('wiki/'))
    const inputs: GraphInput[] = []
    for (const n of flatNotes) {
      try {
        const content = await this.vault.readNote(n.path)
        if (content.graphExcluded) continue
        inputs.push({ path: n.path, title: n.title, tags: n.tags, links: content.links })
      } catch { /* skip */ }
    }
    this.graph.rebuild(inputs)
  }

  private async indexOne(relPath: string): Promise<void> {
    try {
      const note = await this.vault.readNote(relPath)
      this.search.indexNote({
        path: note.path, title: note.title, tags: note.tags,
        created: note.created, updated: note.updated, kind: 'file'
      }, note.rawBody, note.aiSummary)
    } catch { /* skip */ }
  }

  // ──────────────────────── 基础笔记操作 ────────────────────────

  async listNotes(): Promise<NoteMeta[]> {
    return this.vault.listNotes()
  }

  async readNote(relPath: string): Promise<NoteContent> {
    return this.vault.readNote(relPath)
  }

  async writeNote(relPath: string, data: NoteData): Promise<void> {
    await this.vault.writeNote(relPath, data)
    await this.indexOne(relPath)
    this.rebuildGraph().catch(() => {})
  }

  async deleteNote(relPath: string): Promise<void> {
    if (this.vault.isSystemFile(relPath)) throw new Error('系统文件受保护，不能删除')
    await this.vault.deleteNote(relPath)
    this.search.removeNote(relPath)
    this.rebuildGraph().catch(() => {})
  }

  async createNote(relPath: string, title: string): Promise<void> {
    await this.vault.createNote(relPath, title)
    this.rebuildGraph().catch(() => {})
  }

  getBacklinks(targetPath: string): Promise<Array<{ path: string; title: string }>> {
    return this.vault.getBacklinks(targetPath)
  }

  getAllTags(): Promise<TagWithCount[]> {
    return this.vault.getAllTags()
  }

  getNotesByTag(tag: string): Promise<NoteMeta[]> {
    return this.vault.getNotesByTag(tag)
  }

  searchNotes(query: string, limit?: number): SearchResult[] {
    return this.search.search(query, limit)
  }

  getGraphData(): GraphData {
    return this.graph.getData()
  }

  getGraphNode(nodeId: string): GraphData {
    return this.graph.getNeighborhood(nodeId, 1)
  }

  // ──────────────────────── AI 分析 ────────────────────────

  async aiAnalyze(relPath: string): Promise<AISuggestion> {
    try {
      const note = await this.vault.readNote(relPath)
      const allNotes = await this.vault.listNotes()
      const candidates = flattenWikiNotes(allNotes)
        .filter((n) => n.kind === 'file' && n.path.startsWith('wiki/') && n.path !== relPath)
        .map((n) => ({ path: n.path, title: n.title }))
      const noteType: NoteType = relPath.startsWith('wiki/sources/') ? 'source'
        : relPath.startsWith('wiki/concepts/') ? 'concept'
          : relPath.startsWith('wiki/entities/') ? 'entity'
            : relPath.startsWith('raw/') ? 'raw'
              : 'note'
      const contract = await readContractSections(
        this.vault.getVaultPath(),
        ['总则', 'wikilink', 'confidence', '个人写作', '质量红线']
      )
      const openQuestions = await this.vault.getOpenQuestions()
      const cfg = this.store.get()
      const provider = cfg.providers.find((p) => p.id === cfg.activeProviderId) || cfg.providers[0]
      if (!provider) throw new Error('没有可用的 AI 模型，请先在设置中配置')

      const result = await this.pipeline.analyze(provider, note.title, note.rawBody, candidates, {
        noteType, contract, openQuestions
      })
      await this.vault.updateAiResults(relPath, result.summary, result.tags, result.relations)
      await this.indexOne(relPath)
      this.rebuildGraph().catch(() => {})
      this.bus.push('vaultChanged', { type: 'modify', path: relPath })
      return result
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return {}
      throw err
    }
  }

  aiCancel(): void {
    this.pipeline.cancel()
  }

  // ──────────────────────── INGEST ────────────────────────

  private emitIngestProgress(p: IngestProgress): void {
    this.bus.push('ingestProgress', p)
  }

  private emitCustomProgress(p: IngestProgress): void {
    this.bus.push('customProgress', p)
  }

  private scheduleAutoIngest(relPath: string): void {
    const last = this.recentIngests.get(relPath)
    if (last && Date.now() - last < 60000) return
    const existing = this.autoIngestQueue.get(relPath)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(async () => {
      this.autoIngestQueue.delete(relPath)
      const last2 = this.recentIngests.get(relPath)
      if (last2 && Date.now() - last2 < 60000) return
      this.recentIngests.set(relPath, Date.now())
      try {
        Logger.info(`[AutoIngest] 检测到 raw 新文件: ${relPath}`)
        await this.runIngest(relPath)
        Logger.info(`[AutoIngest] 完成: ${relPath}`)
      } catch (e) {
        Logger.error(`[AutoIngest] 失败: ${relPath}: ${String(e)}`)
      }
    }, 1500)
    this.autoIngestQueue.set(relPath, timer)
  }

  async listWikiPages(dir: string): Promise<Array<{ slug: string; title: string }>> {
    const absDir = path.join(this.vault.getVaultPath(), 'wiki', dir)
    try {
      const entries = await fs.readdir(absDir)
      const pages: Array<{ slug: string; title: string }> = []
      for (const f of entries) {
        if (!f.endsWith('.md')) continue
        try {
          const raw = await fs.readFile(path.join(absDir, f), 'utf-8')
          const parsed = matter(raw)
          pages.push({ slug: f.replace(/\.md$/, ''), title: (parsed.data as any).title || f.replace(/\.md$/, '') })
        } catch { /* skip */ }
      }
      return pages.sort((a, b) => a.slug.localeCompare(b.slug))
    } catch {
      return []
    }
  }

  async listConceptSlugs(): Promise<Array<{ slug: string; title: string; aliases: string[] }>> {
    const absDir = path.join(this.vault.getVaultPath(), 'wiki', 'concepts')
    try {
      const entries = await fs.readdir(absDir)
      const result: Array<{ slug: string; title: string; aliases: string[] }> = []
      for (const f of entries) {
        if (!f.endsWith('.md')) continue
        try {
          const raw = await fs.readFile(path.join(absDir, f), 'utf-8')
          const parsed = matter(raw)
          const fm = parsed.data as Record<string, any>
          result.push({
            slug: f.replace(/\.md$/, ''),
            title: fm.title || f.replace(/\.md$/, ''),
            aliases: Array.isArray(fm.aliases) ? fm.aliases : []
          })
        } catch { /* skip */ }
      }
      return result
    } catch {
      return []
    }
  }

  /** 执行一次 INGEST（LLM Wiki 编译）：raw 文件 → sources/concepts/entities 页 */
  async runIngest(rawRelPath: string): Promise<IngestResult> {
    this.recentIngests.set(rawRelPath, Date.now())

    const cfg = this.store.get()
    const provider = cfg.providers.find((p) => p.id === cfg.activeProviderId) || cfg.providers[0]
    if (!provider) throw new Error('没有可用的 AI 模型，请先在设置中配置')

    const fileName = rawRelPath.split('/').pop() || rawRelPath
    this.emitIngestProgress({ file: fileName, stage: '读取源文件…', percent: 5 })

    const rawAbs = path.join(this.vault.getVaultPath(), rawRelPath)
    const rawBuf = await fs.readFile(rawAbs)
    const ext = path.extname(rawRelPath).toLowerCase()
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']
    const officeExts = ['.pdf', '.pptx', '.docx', '.xlsx', '.xlsm', '.ppt', '.doc', '.xls']
    const textExts = ['.md', '.txt', '.markdown', '.json', '.js', '.ts', '.tsx', '.jsx', '.py',
      '.java', '.c', '.cpp', '.h', '.css', '.html', '.xml', '.yml', '.yaml', '.csv', '.log', '.sh', '.bat']
    let rawText = ''
    let emptyReason = ''
    if (officeExts.includes(ext)) {
      const stageNames: Record<string, string> = {
        '.pdf': '提取 PDF 文本…', '.pptx': '提取 PPT 文本…', '.docx': '提取 Word 文本…',
        '.xlsx': '提取 Excel 文本…', '.xlsm': '提取 Excel 文本…', '.ppt': '转换并提取 PPT 文本…',
        '.doc': '提取 Word(旧版) 文本…', '.xls': '提取 Excel(旧版) 文本…'
      }
      this.emitIngestProgress({ file: fileName, stage: stageNames[ext] || '提取文档文本…', percent: 10 })
      try {
        rawText = await extractDocumentText(rawAbs, ext.slice(1))
        if (!rawText) Logger.info(`[Ingest] ${ext} 无文本内容: ${rawRelPath}`)
      } catch (e) {
        Logger.error(`[Ingest] ${ext} 提取失败 ${rawRelPath}: ${String(e)}`)
        rawText = ''
        emptyReason = `（${ext.slice(1).toUpperCase()} 文本提取失败：${e instanceof Error ? e.message : String(e)}）`
      }
    } else if (textExts.includes(ext)) {
      rawText = rawBuf.toString('utf-8')
    } else if (imageExts.includes(ext)) {
      rawText = ''
      emptyReason = '（图片文件，无文本内容）'
    } else {
      const isBinary = rawBuf.includes(0)
      if (isBinary) {
        rawText = ''
        emptyReason = `（无法识别的二进制格式 ${ext}，无法提取文本）`
      } else {
        rawText = rawBuf.toString('utf-8')
      }
    }
    const rawTitle = rawRelPath.split('/').pop()?.replace(/\.\w+$/, '') || '未命名'
    const today = new Date().toISOString().slice(0, 10)

    const rawSha256 = createHash('sha256').update(rawBuf).digest('hex')
    let rawDate = ''
    try {
      const rawMatter = matter(rawBuf.toString('utf-8'))
      rawDate = typeof rawMatter.data.date === 'string' ? rawMatter.data.date.slice(0, 10) : ''
    } catch { /* no frontmatter */ }
    const possiblyOutdated = !!rawDate && isOlderThan(rawDate, 730)

    const existingConcepts = await this.listConceptSlugs()
    const openQuestions = await this.vault.getOpenQuestions()
    const isPersonal = rawRelPath.startsWith('raw/personal/')
    const contract = await readContract(this.vault.getVaultPath())

    this.emitIngestProgress({ file: fileName, stage: 'AI 分析内容…', percent: 25 })
    const analysis = rawText.trim()
      ? await this.pipeline.ingestSource(provider, rawTitle, rawText, existingConcepts, openQuestions, isPersonal, contract)
      : {
          slug: slugify(rawTitle) || 'untitled',
          title: rawTitle,
          summary: emptyReason || '（无文本内容）',
          keyPoints: [] as string[],
          concepts: [],
          entities: [],
          contradictions: []
        }

    const sourcePath = `wiki/sources/${analysis.slug}.md`
    const sourceFm: Record<string, any> = {
      type: isPersonal ? 'personal-writing' : 'source',
      title: analysis.title,
      date: rawDate || today,
      source_url: '',
      domain: '',
      tags: [],
      processed: true,
      raw_file: rawRelPath,
      raw_sha256: rawSha256,
      last_verified: today,
      possibly_outdated: possiblyOutdated
    }
    if (analysis.language) sourceFm.language = analysis.language
    if (analysis.canonicalSource) sourceFm.canonical_source = analysis.canonicalSource
    if (isPersonal) {
      sourceFm.status = 'draft'
      sourceFm.confidence_at_writing = 'medium'
    }
    const conceptsLinks = analysis.concepts.map((c) => `- [[${c.matchSlug || slugify(c.name)}]] — ${c.name}`).join('\n')
    const entitiesLinks = analysis.entities.map((e) => `- [[${e.matchSlug || slugify(e.name)}]] — ${e.name}`).join('\n')
    const outdatedHint = possiblyOutdated
      ? `\n\n> ⚠ 此来源发表日期已超过 2 年（${rawDate}），内容可能过时，基于它做决策时请谨慎。`
      : ''
    const sourceBody = isPersonal
      ? [
          `# ${analysis.title}（个人写作）`, ``,
          `> 原始文件: \`${rawRelPath}\` · SHA-256: \`${rawSha256.slice(0, 12)}…\`${outdatedHint}`, ``,
          `## Core Argument`, ``, analysis.summary || '（无）', ``,
          `## Key Claims`, ``, analysis.keyPoints.map((k) => `- ${k}`).join('\n') || '（无）', ``,
          `## Evidence Referenced`, ``, conceptsLinks || '（无）', ``,
          `## Limitations`, ``, `（待补充）`, ``
        ].join('\n')
      : [
          `# ${analysis.title}`, ``,
          `> 原始文件: \`${rawRelPath}\` · SHA-256: \`${rawSha256.slice(0, 12)}…\`${outdatedHint}`, ``,
          `## Summary`, ``, analysis.summary || '（无摘要）', ``,
          `## Key Points`, ``, analysis.keyPoints.map((k) => `- ${k}`).join('\n') || '（无要点）', ``,
          `## Concepts Extracted`, ``, conceptsLinks || '（无）', ``,
          `## Entities Extracted`, ``, entitiesLinks || '（无）', ``,
          `## Contradictions`, ``, analysis.contradictions?.length ? analysis.contradictions.map((c) => `- ${c}`).join('\n') : '（无）', ``,
          `## My Notes`, ``, `（在此记录你的想法）`, ``
        ].join('\n')
    await fs.mkdir(path.join(this.vault.getVaultPath(), 'wiki/sources'), { recursive: true })
    await fs.writeFile(path.join(this.vault.getVaultPath(), sourcePath), matter.stringify(sourceBody, sourceFm), 'utf-8')
    this.emitIngestProgress({ file: fileName, stage: '创建来源页…', percent: 55 })

    this.emitIngestProgress({ file: fileName, stage: '编译概念与实体…', percent: 70 })
    const result: IngestResult = { sourcePath, conceptPaths: [], entityPaths: [], created: [], updated: [], logEntry: '' }

    for (const c of analysis.concepts) {
      const slug = c.matchSlug || slugify(c.name)
      const pagePath = `wiki/concepts/${slug}.md`
      const absPath = path.join(this.vault.getVaultPath(), pagePath)
      const exists = await fileExists(absPath)
      result.conceptPaths.push(pagePath)

      if (exists) {
        const raw = await fs.readFile(absPath, 'utf-8')
        const parsed = matter(raw)
        const fm = parsed.data as Record<string, any>
        const prevCount = fm.source_count || 0
        const sourceCount = isPersonal ? prevCount : prevCount + 1
        const evolution = isPersonal
          ? `- ${today} 个人写作 [[${analysis.slug}]] 确立了对此概念的明确立场（不参与计数）`
          : `- ${today}（${sourceCount} sources）：强化 — [[${analysis.slug}]] 提供支持`
        if (!isPersonal && sourceCount >= 5 && fm.confidence !== 'high') {
          result.confirmHigh = result.confirmHigh || []
          result.confirmHigh.push({ slug, title: c.name, sourceCount })
        }
        await fs.writeFile(
          absPath,
          matter.stringify(
            `${parsed.content.trimEnd()}\n\n## Evolution Log\n\n${evolution}\n`,
            {
              ...fm,
              updated: new Date().toISOString(),
              source_count: sourceCount,
              last_reviewed: today,
              confidence: sourceCount >= 3 ? 'medium' : fm.confidence || 'low'
            }
          ),
          'utf-8'
        )
        result.updated.push(pagePath)
      } else {
        const aliases = [c.name, c.nameEn].filter(Boolean)
        const fm2: Record<string, any> = {
          type: 'concept', title: c.name, date: today, updated: new Date().toISOString(),
          tags: [], source_count: 1, confidence: 'low', domain_volatility: 'medium',
          last_reviewed: today, aliases: [...new Set(aliases)]
        }
        const body2 = [
          `# ${c.name}${c.nameEn ? `（${c.nameEn}）` : ''}`, ``,
          `## Definition`, ``, c.definition || '（待补充）', ``,
          `## Key Points`, ``, `- （待补充）`, ``,
          `## My Position`, ``, `（待补充）`, ``,
          `## Contradictions`, ``, `（无）`, ``,
          `## Sources`, ``, `- [[${analysis.slug}]]`, ``,
          `## Evolution Log`, ``, `- ${today}（1 sources）：首次摄入，由 [[${analysis.slug}]] 建立`, ``
        ].join('\n')
        await fs.writeFile(absPath, matter.stringify(body2, fm2), 'utf-8')
        result.created.push(pagePath)
      }
    }

    for (const e of analysis.entities) {
      const slug = e.matchSlug || slugify(e.name)
      const pagePath = `wiki/entities/${slug}.md`
      const absPath = path.join(this.vault.getVaultPath(), pagePath)
      const exists = await fileExists(absPath)
      result.entityPaths.push(pagePath)

      if (exists) {
        const raw = await fs.readFile(absPath, 'utf-8')
        const parsed = matter(raw)
        const fm = parsed.data as Record<string, any>
        const body = `${parsed.content.trimEnd()}\n\n- [[${analysis.slug}]]`
        await fs.writeFile(absPath, matter.stringify(body, { ...fm, updated: new Date().toISOString() }), 'utf-8')
        result.updated.push(pagePath)
      } else {
        const fm2: Record<string, any> = {
          type: 'entity', title: e.name, date: today,
          tags: [], entity_type: e.type, aliases: [e.name]
        }
        const body2 = [
          `# ${e.name}`, ``,
          `## Description`, ``, e.description || '（待补充）', ``,
          `## Key Contributions`, ``, `（待补充）`, ``,
          `## Related Concepts`, ``, `（待补充）`, ``,
          `## Sources`, ``, `- [[${analysis.slug}]]`, ``
        ].join('\n')
        await fs.writeFile(absPath, matter.stringify(body2, fm2), 'utf-8')
        result.created.push(pagePath)
      }
    }

    const allSources = await this.listWikiPages('sources')
    const allConcepts = await this.listWikiPages('concepts')
    const allEntities = await this.listWikiPages('entities')
    await this.vault.updateIndex(allSources, allConcepts, allEntities)
    await this.vault.updateOverview({
      '总来源数': allSources.length,
      '概念数': allConcepts.length,
      '实体数': allEntities.length,
      '开放问题数': (await this.vault.getOpenQuestions()).length,
      '最近摄入': analysis.title
    })
    if (analysis.answeredQuestions?.length) {
      result.answeredQuestions = []
      for (const q of analysis.answeredQuestions) {
        await this.vault.answerQuestion(q)
        result.answeredQuestions.push(q)
      }
    }
    this.emitIngestProgress({ file: fileName, stage: '更新索引…', percent: 85 })

    const logEntry = `ingest | ${analysis.title} → wiki/sources/${analysis.slug}.md`
    await this.vault.appendLog(logEntry)
    result.logEntry = logEntry

    for (const p of [sourcePath, ...result.conceptPaths, ...result.entityPaths]) {
      await this.indexOne(p)
    }
    this.rebuildGraph().catch(() => {})
    this.bus.push('vaultChanged', { type: 'created', path: sourcePath })

    this.emitIngestProgress({ file: fileName, stage: '完成', percent: 100, done: true })
    return result
  }

  // ──────────────────────── 批量摄入 ────────────────────────

  async ingestBatchStart(paths: string[]): Promise<BatchIngestStartResult> {
    if (this.batchSession) throw new Error('已有批量摄入在进行中，请先完成或停止')
    if (!Array.isArray(paths) || paths.length === 0) throw new Error('未选择文件')
    const compiledRaw = await this.listCompiledRawFiles()
    const unique = Array.from(new Set(paths.map((p) => p.replace(/\\/g, '/'))))
    const pending = unique.filter((p) => !compiledRaw.has(p))
    if (pending.length === 0) {
      throw new Error(`所选 ${unique.length} 个文件均已编译过`)
    }
    const now = Date.now()
    for (const p of pending) this.recentIngests.set(p, now)
    const firstPath = pending[0]
    const first = await this.runIngest(firstPath)
    this.batchSession = { pending: pending.slice(1), done: [first], errors: [], active: false }
    return { rawFile: firstPath, first, total: pending.length }
  }

  async ingestBatchContinue(): Promise<BatchIngestDoneResult> {
    if (!this.batchSession) return { results: [], errors: [], confirmHigh: [] }
    if (this.batchSession.active) throw new Error('批量摄入正在执行中')
    this.batchSession.active = true
    try {
      for (const p of this.batchSession.pending) {
        try {
          this.batchSession.done.push(await this.runIngest(p))
        } catch (e) {
          this.batchSession.errors.push({ path: p, error: e instanceof Error ? e.message : String(e) })
        }
      }
      const confirmHighMap = new Map<string, { slug: string; title: string; sourceCount: number }>()
      for (const r of this.batchSession.done) {
        for (const c of r.confirmHigh ?? []) {
          const prev = confirmHighMap.get(c.slug)
          if (!prev || c.sourceCount > prev.sourceCount) confirmHighMap.set(c.slug, c)
        }
      }
      const result: BatchIngestDoneResult = {
        results: this.batchSession.done,
        errors: this.batchSession.errors,
        confirmHigh: Array.from(confirmHighMap.values())
      }
      this.batchSession = null
      return result
    } finally {
      if (this.batchSession) this.batchSession.active = false
    }
  }

  async ingestBatchAbort(): Promise<{ ok: boolean }> {
    this.batchSession = null
    return { ok: true }
  }

  private async listCompiledRawFiles(): Promise<Set<string>> {
    const result = new Set<string>()
    const sources = await this.listWikiPages('sources')
    for (const s of sources) {
      try {
        const note = await this.vault.readNote(`wiki/sources/${s.slug}.md`)
        if (note.rawFile) result.add(note.rawFile)
      } catch { /* skip */ }
    }
    return result
  }

  // ──────────────────────── 工作流 ────────────────────────

  async workflowLint(): Promise<LintWorkflowResult> {
    const r = await runLint(this.vault)
    if (r.ok) this.bus.push('vaultChanged', { type: 'created', path: r.reportPath })
    return r
  }

  async workflowReflect(): Promise<WorkflowResult> {
    const r = await runReflect(this.vault, this.store)
    if (r.ok) this.bus.push('vaultChanged', { type: 'created', path: r.reportPath })
    return r
  }

  async workflowMerge(keep: string, remove: string, area: string): Promise<WorkflowResult> {
    const r = await runMerge(this.vault, keep, remove, area)
    if (r.ok) {
      this.bus.push('vaultChanged', { type: 'created', path: r.reportPath })
      this.bus.push('vaultChanged', { type: 'deleted', path: `wiki/${area}/${remove}.md` })
    }
    return r
  }

  async workflowQuery(query: string): Promise<WorkflowResult> {
    const r = await runQuery(this.vault, this.search, this.store, query)
    if (r.ok) this.bus.push('vaultChanged', { type: 'created', path: r.reportPath })
    return r
  }

  // ──────────────────────── 导入 ────────────────────────

  async importUrl(url: string): Promise<{ ok: boolean; relPath?: string; sourcePath?: string; error?: string }> {
    const target = (url || '').trim()
    if (!/^https?:\/\//i.test(target)) {
      return { ok: false, error: '请输入合法的 http/https 链接' }
    }
    let host = ''
    try {
      host = new URL(target).hostname.replace(/^www\./, '')
    } catch {
      return { ok: false, error: 'URL 格式不合法' }
    }

    let html = ''
    try {
      const res = await fetch(target, {
        signal: AbortSignal.timeout(20000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WinAgent/0.2' }
      })
      if (!res.ok) return { ok: false, error: `网页请求失败：HTTP ${res.status}` }
      const buf = await res.arrayBuffer()
      const contentType = res.headers.get('content-type') || ''
      if (!/text\/html|application\/xhtml/i.test(contentType)) {
        return { ok: false, error: `该 URL 返回的是 ${contentType.split(';')[0] || '未知类型'}，请下载后导入知识库` }
      }
      html = Buffer.from(buf).toString('utf-8')
    } catch (e) {
      return { ok: false, error: `抓取网页失败：${e instanceof Error ? e.message : String(e)}` }
    }

    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || host)
      .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const cleaned = html
      .replace(/<(script|style|noscript|iframe|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|blockquote|pre)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .split('\n').map((l) => l.trim()).filter((l) => l.length > 0).join('\n\n')
      .slice(0, 30000)
    if (!cleaned) {
      return { ok: false, error: '网页正文为空（可能是 JS 渲染页面，请复制内容后保存为文件导入）' }
    }

    const today = new Date().toISOString().slice(0, 10)
    const slug = title.toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
      || host.replace(/[^a-z0-9]/g, '-')
    const relPath = `raw/clippings/${today}-${host}-${slug}.md`
    const rawBody = [`# ${title}`, ``, `> 来源：${target}`, ``, cleaned, ``].join('\n')
    const rawFm = { title, date: today, source_url: target, domain: host, tags: [] }
    const absPath = path.join(this.vault.getVaultPath(), relPath)
    await fs.mkdir(path.dirname(absPath), { recursive: true })
    await fs.writeFile(absPath, matter.stringify(rawBody, rawFm), 'utf-8')

    this.recentIngests.set(relPath, Date.now())
    const ingestResult = await this.runIngest(relPath)
    return { ok: true, relPath, sourcePath: ingestResult.sourcePath }
  }

  importFile(srcPath: string, targetDir?: string): Promise<string> {
    return this.vault.importFile(srcPath, targetDir)
  }

  async importAnalyze(filePaths: string[], requirement: string): Promise<ImportAnalyzeResult> {
    const cfg = this.store.get()
    const provider = cfg.providers.find((p) => p.id === cfg.activeProviderId) || cfg.providers[0]
    if (!provider) throw new Error('没有可用的 AI 模型，请先在设置中配置')
    const contract = await readContract(this.vault.getVaultPath())

    const results: ImportAnalyzeResult['files'] = []
    const newTags: AnalysisTag[] = []
    const confirmHighMap = new Map<string, { slug: string; title: string; sourceCount: number }>()

    const imports: Array<{ name: string; path: string; relPath: string }> = []
    for (const p of filePaths) {
      const name = p.split(/[\\/]/).pop() || p
      try {
        const relPath = await this.vault.importFile(p)
        this.recentIngests.set(relPath, Date.now())
        imports.push({ name, path: p, relPath })
      } catch (e) {
        results.push({ name, ingestError: e instanceof Error ? e.message : String(e) })
      }
    }

    for (const item of imports) {
      const { name, relPath } = item
      try {
        const ingestResult = await this.runIngest(relPath)
        for (const c of ingestResult.confirmHigh ?? []) {
          const prev = confirmHighMap.get(c.slug)
          if (!prev || c.sourceCount > prev.sourceCount) confirmHighMap.set(c.slug, c)
        }
        const fileResult: ImportAnalyzeResult['files'][number] = {
          name, relPath, sourcePath: ingestResult.sourcePath
        }
        if (requirement.trim()) {
          try {
            this.emitCustomProgress({ file: name, stage: '定制分析…', percent: 90 })
            const note = await this.vault.readNote(ingestResult.sourcePath)
            const analysis: CustomAnalysisOutput = await this.pipeline.customAnalyze(
              provider, note.title, note.rawBody, requirement.trim(), contract
            )
            await this.vault.appendCustomAnalysis(ingestResult.sourcePath, requirement.trim(), analysis.report)
            await this.indexOne(ingestResult.sourcePath)
            this.bus.push('vaultChanged', { type: 'modify', path: ingestResult.sourcePath })
            this.emitCustomProgress({ file: name, stage: '归纳分析 tag…', percent: 95 })
            fileResult.analysis = analysis
            if (analysis.analysisTags.length) newTags.push(...analysis.analysisTags)
            this.emitCustomProgress({ file: name, stage: '完成', percent: 100, done: true })
          } catch (e) {
            fileResult.analysisError = e instanceof Error ? e.message : String(e)
            this.emitCustomProgress({ file: name, stage: '完成', percent: 100, done: true })
          }
        }
        results.push(fileResult)
      } catch (e) {
        results.push({ name, relPath, ingestError: e instanceof Error ? e.message : String(e) })
      }
    }

    let addedTags: AnalysisTag[] = []
    if (newTags.length) {
      const before = new Set((await this.vault.getAnalysisTags()).map((t) => t.tag))
      await this.vault.addAnalysisTags(newTags)
      addedTags = newTags.filter((t) => !before.has(t.tag))
    }

    return { files: results, newTags: addedTags, confirmHigh: Array.from(confirmHighMap.values()) }
  }

  /** 浏览器上传：写入 raw/uploaded/<name> 并立即 INGEST（可选定制分析） */
  async uploadAndIngest(name: string, buf: Buffer, requirement: string): Promise<ImportAnalyzeResult> {
    const safeName = (name || 'upload').replace(/[\\/:*?"<>|]/g, '_')
    const relPath = `raw/uploaded/${Date.now()}-${safeName}`
    const absPath = path.join(this.vault.getVaultPath(), relPath)
    await fs.mkdir(path.dirname(absPath), { recursive: true })
    await fs.writeFile(absPath, buf)
    this.recentIngests.set(relPath, Date.now())
    return this.importAnalyze([absPath], requirement || '')
  }

  // ──────────────────────── 概念 / tags / 附件 / 批注 ────────────────────────

  async conceptConfirm(slug: string, area: 'concepts' | 'entities'): Promise<{ ok: boolean; error?: string }> {
    const absPath = path.join(this.vault.getVaultPath(), 'wiki', area, `${slug}.md`)
    try {
      const raw = await fs.readFile(absPath, 'utf-8')
      const parsed = matter(raw)
      const fm = parsed.data as Record<string, any>
      fm.confidence = 'high'
      fm.last_reviewed = new Date().toISOString().slice(0, 10)
      await fs.writeFile(absPath, matter.stringify(parsed.content, fm), 'utf-8')
      await this.vault.appendLog(`confidence | ${area}/${slug} 已确认为 high（用户背书）`)
      await this.indexOne(`wiki/${area}/${slug}.md`)
      return { ok: true }
    } catch {
      return { ok: false, error: `页面不存在: wiki/${area}/${slug}.md` }
    }
  }

  getAnalysisTags(): Promise<AnalysisTag[]> {
    return this.vault.getAnalysisTags()
  }

  async addAnalysisTags(tags: AnalysisTag[]): Promise<AnalysisTag[]> {
    const merged = await this.vault.addAnalysisTags(tags)
    if (tags.length > 0) await this.vault.appendLog(`analysis-tags | 新增 ${tags.length} 个分析要求 tag`)
    return merged
  }

  listAttachments(subDir?: string): Promise<string[]> {
    return this.vault.listAttachments(subDir)
  }

  addAnnotation(relPath: string, text: string, range: string): Promise<NoteAnnotation> {
    return this.vault.addAnnotation(relPath, text, range)
  }

  removeAnnotation(relPath: string, annotationId: string): Promise<void> {
    return this.vault.removeAnnotation(relPath, annotationId)
  }

  getVaultPath(): string {
    return this.vault.getVaultPath()
  }

  async setVaultPath(p: string): Promise<void> {
    await this.vault.setVaultPath(p)
    await this.indexWikiVault()
    await this.rebuildGraph()
  }
}
