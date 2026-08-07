import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import { spawn } from 'child_process'
import path from 'path'
import { ConfigStore, getDataDir } from './config/ConfigStore'
import { ToolRegistry } from './tools/ToolRegistry'
import { AgentService } from './agent/AgentService'
import { fetchModels } from './llm/OpenAIClient'
import { Logger } from './util/Logger'
import { VaultManager } from './wiki/VaultManager'
import { SearchIndex } from './wiki/SearchIndex'
import { GraphEngine } from './wiki/GraphEngine'
import type { GraphInput } from './wiki/GraphEngine'
import { AiPipeline } from './wiki/AiPipeline'
import { createWikiTools } from './tools/wikiTools'
import type { AgentEvent, AppConfig, ChatMessage, NoteData, GraphData, AISuggestion, IngestResult, IngestProgress } from '../shared/types'
import matter from 'gray-matter'

let mainWindow: BrowserWindow | null = null
const store = new ConfigStore()
const registry = new ToolRegistry()
let agent: AgentService
let vaultManager: VaultManager | null = null
let searchIndex: SearchIndex | null = null
let graphEngine: GraphEngine | null = null
let aiPipeline: AiPipeline | null = null

// 待处理的危险操作确认
const pendingConfirms = new Map<string, (approved: boolean) => void>()
let confirmSeq = 0

async function reloadTools(cfg: AppConfig): Promise<void> {
  await registry.initialize(cfg)
  let skillsDir = store.resolvePath(cfg.skillsDir)
  // 打包模式：extraResources 打包到 resources/ 下，回退查找
  const altSkills = path.join(path.dirname(process.execPath), 'resources', cfg.skillsDir)
  try {
    await fs.access(altSkills)
    skillsDir = altSkills
  } catch { /* 开发模式或自定义路径，使用原始解析 */ }
  const mcpPath = store.resolvePath(cfg.mcpConfigPath)
  await registry.loadExternal(skillsDir, mcpPath)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#0d1117',
    title: 'WinAgent',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 阻止拖拽文件到窗口导致的导航（文件应进入知识库而非被打开）
  mainWindow.webContents.on('will-navigate', (e) => {
    e.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function sendEvent(e: AgentEvent): void {
  mainWindow?.webContents.send('agent:event', e)
}

function confirmTool(name: string, args: string): Promise<boolean> {
  return new Promise((resolve) => {
    const id = `cf_${++confirmSeq}`
    pendingConfirms.set(id, resolve)
    mainWindow?.webContents.send('agent:confirm', { id, name, args })
  })
}

function registerIpc(): void {
  ipcMain.handle('config:get', () => store.get())

  ipcMain.handle('config:save', async (_e, cfg: AppConfig) => {
    await store.save(cfg)
    await reloadTools(cfg)
    return store.get()
  })

  ipcMain.handle('config:dataDir', () => getDataDir())

  // 选择本地文件夹（用于设置 Skills 目录）
  ipcMain.handle('dialog:pickDirectory', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Skills 文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle('file:read', async (_e, filePath: string) => {
    const ext = path.extname(filePath).toLowerCase()
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']
    const isImage = imageExts.includes(ext)
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp'
    }
    const mime = mimeMap[ext] || 'application/octet-stream'
    const name = path.basename(filePath)

    if (isImage) {
      const buf = await fs.readFile(filePath)
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      return { name, path: filePath, mime, isImage: true, dataUrl }
    }

    // 文本类文件读取内容，其他文件只返回路径信息
    const textExts = ['.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', '.py', '.java',
      '.c', '.cpp', '.h', '.css', '.html', '.xml', '.yml', '.yaml', '.csv', '.log', '.sh', '.bat']
    if (textExts.includes(ext)) {
      const textContent = await fs.readFile(filePath, 'utf-8')
      return { name, path: filePath, mime, isImage: false, textContent: textContent.slice(0, 50000) }
    }
    return { name, path: filePath, mime, isImage: false }
  })

  ipcMain.handle('tools:list', () => registry.getInfos())

  ipcMain.handle('tools:reload', async () => {
    await reloadTools(store.get())
    return registry.getInfos()
  })

  ipcMain.handle('models:fetch', async (_e, providerId: string) => {
    const cfg = store.get()
    const provider = cfg.providers.find((p) => p.id === providerId) || store.activeProvider()
    return fetchModels(provider)
  })

  ipcMain.handle('agent:send', async (_e, text: string, attachments?: any[]) => {
    await agent.process(text, { onEvent: sendEvent, confirmTool }, attachments)
  })

  ipcMain.handle('agent:stop', () => agent.stop())
  ipcMain.handle('agent:reset', () => agent.reset())
  ipcMain.handle('agent:compact', async () => {
    await agent.compactNow({ onEvent: sendEvent, confirmTool })
  })

  ipcMain.on('agent:confirm:reply', (_e, payload: { id: string; approved: boolean }) => {
    const resolve = pendingConfirms.get(payload.id)
    if (resolve) {
      resolve(payload.approved)
      pendingConfirms.delete(payload.id)
    }
  })
}

function registerWikiIpc(): void {
  // === Vault ===
  ipcMain.handle('wiki:vault:path', () => vaultManager?.getVaultPath() || '')

  ipcMain.handle('wiki:vault:setPath', async (_e, p: string) => {
    if (!vaultManager) return
    await vaultManager.setVaultPath(p)
    // 重建搜索索引
    if (searchIndex) {
      const notes = await vaultManager.listNotes()
      const flatNotes = flattenWikiNotes(notes)
      const indexData: Array<{ meta: any; content: string }> = []
      for (const n of flatNotes) {
        if (n.kind !== 'file' || !n.path.startsWith('wiki/')) continue
        try {
          const content = await vaultManager.readNote(n.path)
          indexData.push({ meta: n, content: content.rawBody })
        } catch { /* skip */ }
      }
      await searchIndex.rebuild(indexData)
    }
  })

  // === Notes ===
  ipcMain.handle('wiki:notes:list', async () => {
    if (!vaultManager) return []
    return vaultManager.listNotes()
  })

  ipcMain.handle('wiki:notes:read', async (_e, relPath: string) => {
    if (!vaultManager) throw new Error('Vault not initialized')
    return vaultManager.readNote(relPath)
  })

  ipcMain.handle('wiki:notes:write', async (_e, relPath: string, data: NoteData) => {
    if (!vaultManager) throw new Error('Vault not initialized')
    await vaultManager.writeNote(relPath, data)
    // 更新搜索索引
    if (searchIndex) {
      const note = await vaultManager.readNote(relPath)
      searchIndex.indexNote({
        path: note.path, title: note.title, tags: note.tags,
        created: note.created, updated: note.updated, kind: 'file'
      }, note.rawBody)
    }
    // 异步重建图谱
    rebuildGraph().catch(() => {})
  })

  ipcMain.handle('wiki:notes:delete', async (_e, relPath: string) => {
    if (!vaultManager) throw new Error('Vault not initialized')
    // 系统文件受保护，禁止删除
    if (vaultManager.isSystemFile(relPath)) {
      throw new Error('系统文件受保护，不能删除')
    }
    await vaultManager.deleteNote(relPath)
    searchIndex?.removeNote(relPath)
    rebuildGraph().catch(() => {})
  })

  ipcMain.handle('wiki:notes:create', async (_e, relPath: string, title: string) => {
    if (!vaultManager) throw new Error('Vault not initialized')
    await vaultManager.createNote(relPath, title)
    rebuildGraph().catch(() => {})
  })

  // === Links ===
  ipcMain.handle('wiki:links:backlinks', async (_e, targetPath: string) => {
    if (!vaultManager) return []
    return vaultManager.getBacklinks(targetPath)
  })

  // === Tags ===
  ipcMain.handle('wiki:tags:list', async () => {
    if (!vaultManager) return []
    return vaultManager.getAllTags()
  })

  ipcMain.handle('wiki:tags:notes', async (_e, tag: string) => {
    if (!vaultManager) return []
    return vaultManager.getNotesByTag(tag)
  })

  // === Search ===
  ipcMain.handle('wiki:search', async (_e, query: string, limit?: number) => {
    if (!searchIndex) return []
    return searchIndex.search(query, limit)
  })

  // === Graph ===
  ipcMain.handle('wiki:graph:data', async (): Promise<GraphData> => {
    if (!graphEngine) return { nodes: [], edges: [] }
    return graphEngine.getData()
  })

  ipcMain.handle('wiki:graph:node', async (_e, nodeId: string): Promise<GraphData> => {
    if (!graphEngine) return { nodes: [], edges: [] }
    return graphEngine.getNeighborhood(nodeId, 1)
  })

  ipcMain.handle('wiki:graph:rebuild', async () => {
    if (!vaultManager || !graphEngine) return
    await rebuildGraph()
  })

  // === AI (stub for Phase 4) ===
  ipcMain.handle('wiki:ai:analyze', async (_e, relPath: string): Promise<AISuggestion> => {
    if (!vaultManager || !aiPipeline) return {}
    try {
      const note = await vaultManager.readNote(relPath)
      const allNotes = await vaultManager.listNotes()
      const flatNotes = flattenWikiNotes(allNotes).filter((n) => n.kind === 'file')
      const allTitles = flatNotes.map((n) => n.title)

      const cfg = await store.load()
      const provider = cfg.providers.find((p) => p.id === cfg.activeProviderId) || cfg.providers[0]
      if (!provider) throw new Error('没有可用的 AI 模型，请先在设置中配置')

      const result = await aiPipeline.analyze(provider, note.title, note.rawBody, allTitles)

      // 将分析结果写入 frontmatter
      const updated = await vaultManager.readNote(relPath)
      const newTags = [...new Set([...updated.tags, ...result.tags])]
      await vaultManager.writeNote(relPath, {
        title: updated.title,
        body: updated.rawBody,
        tags: newTags
      })
      // 同时保存 AI 摘要到 frontmatter（通过追加 tags 触发 write）
      // 注意：目前 NoteData 不支持 aiSummary，后续可扩展

      // 更新搜索索引和图谱
      const refreshedNote = await vaultManager.readNote(relPath)
      searchIndex?.indexNote({
        path: refreshedNote.path,
        title: refreshedNote.title,
        tags: refreshedNote.tags,
        created: refreshedNote.created,
        updated: refreshedNote.updated,
        kind: 'file'
      }, refreshedNote.rawBody)
      rebuildGraph().catch(() => {})

      // 通知渲染进程
      mainWindow?.webContents.send('wiki:vault:changed', {
        type: 'modify', path: relPath
      })

      return result
    } catch (err: any) {
      if (err.name === 'AbortError') return {}
      throw err
    }
  })

  ipcMain.handle('wiki:ai:cancel', async () => {
    aiPipeline?.cancel()
  })

  // === INGEST（LLM Wiki 编译模式） ===
  ipcMain.handle('wiki:ingest', async (_e, rawRelPath: string): Promise<IngestResult> => {
    if (!vaultManager || !aiPipeline || !searchIndex) throw new Error('Wiki 未初始化')
    return runIngest(rawRelPath)
  })

  // === 概念 confidence 确认（用户背书 high） ===
  ipcMain.handle('wiki:concept:confirm', async (_e, slug: string, area: 'concepts' | 'entities') => {
    if (!vaultManager) throw new Error('Wiki 未初始化')
    const absPath = path.join(vaultManager.getVaultPath(), 'wiki', area, `${slug}.md`)
    try {
      const raw = await fs.readFile(absPath, 'utf-8')
      const parsed = matter(raw)
      const fm = parsed.data as Record<string, any>
      fm.confidence = 'high'
      fm.last_reviewed = new Date().toISOString().slice(0, 10)
      await fs.writeFile(absPath, matter.stringify(parsed.content, fm), 'utf-8')
      await vaultManager.appendLog(`confidence | ${area}/${slug} 已确认为 high（用户背书）`)
      // 刷新索引
      const note = await vaultManager.readNote(`wiki/${area}/${slug}.md`)
      searchIndex?.indexNote({
        path: note.path, title: note.title, tags: note.tags,
        created: note.created, updated: note.updated, kind: 'file'
      }, note.rawBody)
      return { ok: true }
    } catch {
      return { ok: false, error: `页面不存在: wiki/${area}/${slug}.md` }
    }
  })

  // === Import ===
  ipcMain.handle('wiki:import:file', async (_e, srcPath: string, targetDir?: string) => {
    if (!vaultManager) throw new Error('Vault not initialized')
    return vaultManager.importFile(srcPath, targetDir)
  })

  // === Attachments ===
  ipcMain.handle('wiki:attachments:list', async (_e, subDir?: string) => {
    if (!vaultManager) return []
    return vaultManager.listAttachments(subDir)
  })

  // === Annotations ===
  ipcMain.handle('wiki:annotations:add', async (_e, relPath: string, text: string, range: string) => {
    if (!vaultManager) throw new Error('Vault not initialized')
    return vaultManager.addAnnotation(relPath, text, range)
  })

  ipcMain.handle('wiki:annotations:remove', async (_e, relPath: string, annotationId: string) => {
    if (!vaultManager) throw new Error('Vault not initialized')
    return vaultManager.removeAnnotation(relPath, annotationId)
  })

  // === Vault 变更事件 ===
  if (vaultManager) {
    vaultManager.onChange((event) => {
      mainWindow?.webContents.send('wiki:vault:changed', event)
      // raw/ 新文件自动触发 INGEST（任何方式放入 raw/ 的文件都会被编译）
      if (event.type === 'created' && event.path.startsWith('raw/') && event.path !== 'raw/') {
        scheduleAutoIngest(event.path)
      }
    })
  }
}

/** raw/ 新文件自动 INGEST（防抖 + 去重，避免与拖拽导入重复编译） */
const autoIngestQueue = new Map<string, ReturnType<typeof setTimeout>>()
const recentIngests = new Map<string, number>()

function scheduleAutoIngest(relPath: string): void {
  // 检查是否最近（60 秒内）已处理过
  const last = recentIngests.get(relPath)
  if (last && Date.now() - last < 60000) return

  // 防抖：1.5 秒内只触发一次
  const existing = autoIngestQueue.get(relPath)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(async () => {
    autoIngestQueue.delete(relPath)
    recentIngests.set(relPath, Date.now())
    try {
      Logger.info(`[AutoIngest] 检测到 raw 新文件: ${relPath}`)
      await runIngest(relPath)
      Logger.info(`[AutoIngest] 完成: ${relPath}`)
    } catch (e) {
      Logger.error(`[AutoIngest] 失败: ${relPath}: ${String(e)}`)
    }
  }, 1500)
  autoIngestQueue.set(relPath, timer)
}

// 辅助函数：扁平化笔记树
function flattenWikiNotes(notes: import('../shared/types').NoteMeta[]): import('../shared/types').NoteMeta[] {
  const result: import('../shared/types').NoteMeta[] = []
  for (const n of notes) {
    result.push(n)
    if (n.children) result.push(...flattenWikiNotes(n.children))
  }
  return result
}

/** 从 VaultManager 收集笔记数据并重建图谱（只含 wiki/ 层，排除 graph-excluded 系统文件） */
async function rebuildGraph(): Promise<void> {
  if (!vaultManager || !graphEngine) return
  const notes = await vaultManager.listNotes()
  const flatNotes = flattenWikiNotes(notes).filter((n) => n.kind === 'file' && n.path.startsWith('wiki/'))
  const inputs: GraphInput[] = []
  for (const n of flatNotes) {
    try {
      const content = await vaultManager.readNote(n.path)
      if (content.graphExcluded) continue
      inputs.push({
        path: n.path,
        title: n.title,
        tags: n.tags,
        links: content.links
      })
    } catch { /* skip */ }
  }
  graphEngine.rebuild(inputs)
}

/** 推送 INGEST 进度事件到渲染进程 */
function emitIngestProgress(p: IngestProgress): void {
  mainWindow?.webContents.send('wiki:ingest:progress', p)
}

/** 执行一次 INGEST（LLM Wiki 编译）：raw 文件 → sources/concepts/entities 页 */
async function runIngest(rawRelPath: string): Promise<IngestResult> {
  if (!vaultManager || !aiPipeline || !searchIndex) throw new Error('Wiki 未初始化')
  // 记录去重标记（防止 fs.watch 触发的 autoIngest 重复编译）
  recentIngests.set(rawRelPath, Date.now())

  const cfg = await store.load()
  const provider = cfg.providers.find((p) => p.id === cfg.activeProviderId) || cfg.providers[0]
  if (!provider) throw new Error('没有可用的 AI 模型，请先在设置中配置')

  const fileName = rawRelPath.split('/').pop() || rawRelPath
  emitIngestProgress({ file: fileName, stage: '读取源文件…', percent: 5 })

  // 1. 读取 raw 文件内容（md/txt 直接读；office/pdf 通过子进程提取；图片仅取元数据）
  const rawAbs = path.join(vaultManager.getVaultPath(), rawRelPath)
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
      '.pdf': '提取 PDF 文本…',
      '.pptx': '提取 PPT 文本…',
      '.docx': '提取 Word 文本…',
      '.xlsx': '提取 Excel 文本…',
      '.xlsm': '提取 Excel 文本…',
      '.ppt': '转换并提取 PPT 文本…',
      '.doc': '提取 Word(旧版) 文本…',
      '.xls': '提取 Excel(旧版) 文本…'
    }
    emitIngestProgress({ file: fileName, stage: stageNames[ext] || '提取文档文本…', percent: 10 })
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
    rawText = '' // 图片无文本，创建基础 source 页
    emptyReason = '（图片文件，无文本内容）'
  } else {
    // 未知扩展名：NUL 字节检测是否为二进制
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

  // 2. 计算 SHA-256 + 检测 possibly_outdated（raw frontmatter date > 2 年）
  const rawSha256 = createHash('sha256').update(rawBuf).digest('hex')
  let rawDate = ''
  try {
    const rawMatter = matter(rawBuf.toString('utf-8'))
    rawDate = typeof rawMatter.data.date === 'string' ? rawMatter.data.date.slice(0, 10) : ''
  } catch { /* no frontmatter */ }
  const possiblyOutdated = !!rawDate && isOlderThan(rawDate, 730)

  // 3. 读取已有概念列表 + 开放问题（用于对齐与匹配）
  const existingConcepts = await listConceptSlugs()
  const openQuestions = await vaultManager.getOpenQuestions()
  const isPersonal = rawRelPath.startsWith('raw/personal/')

  // 4. LLM 分析（无文本内容的文件跳过分析，直接生成基础来源页）
  emitIngestProgress({ file: fileName, stage: 'AI 分析内容…', percent: 25 })
  const analysis = rawText.trim()
    ? await aiPipeline.ingestSource(provider, rawTitle, rawText, existingConcepts, openQuestions, isPersonal)
    : {
        slug: slugify(rawTitle) || 'untitled',
        title: rawTitle,
        summary: emptyReason || '（无文本内容）',
        keyPoints: [],
        concepts: [],
        entities: [],
        contradictions: []
      }

  // 5. 写入 sources 页
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
        `# ${analysis.title}（个人写作）`,
        ``,
        `> 原始文件: \`${rawRelPath}\` · SHA-256: \`${rawSha256.slice(0, 12)}…\`${outdatedHint}`,
        ``,
        `## Core Argument`,
        ``,
        analysis.summary || '（无）',
        ``,
        `## Key Claims`,
        ``,
        analysis.keyPoints.map((k) => `- ${k}`).join('\n') || '（无）',
        ``,
        `## Evidence Referenced`,
        ``,
        conceptsLinks || '（无）',
        ``,
        `## Limitations`,
        ``,
        `（待补充）`,
        ``
      ].join('\n')
    : [
        `# ${analysis.title}`,
        ``,
        `> 原始文件: \`${rawRelPath}\` · SHA-256: \`${rawSha256.slice(0, 12)}…\`${outdatedHint}`,
        ``,
        `## Summary`,
        ``,
        analysis.summary || '（无摘要）',
        ``,
        `## Key Points`,
        ``,
        analysis.keyPoints.map((k) => `- ${k}`).join('\n') || '（无要点）',
        ``,
        `## Concepts Extracted`,
        ``,
        conceptsLinks || '（无）',
        ``,
        `## Entities Extracted`,
        ``,
        entitiesLinks || '（无）',
        ``,
        `## Contradictions`,
        ``,
        analysis.contradictions?.length ? analysis.contradictions.map((c) => `- ${c}`).join('\n') : '（无）',
        ``,
        `## My Notes`,
        ``,
        `（在此记录你的想法）`,
        ``
      ].join('\n')
  await fs.mkdir(path.join(vaultManager.getVaultPath(), 'wiki/sources'), { recursive: true })
  await fs.writeFile(path.join(vaultManager.getVaultPath(), sourcePath), matter.stringify(sourceBody, sourceFm), 'utf-8')
  emitIngestProgress({ file: fileName, stage: '创建来源页…', percent: 55 })

  // 6-7. 创建/更新 concepts 与 entities 页
  emitIngestProgress({ file: fileName, stage: '编译概念与实体…', percent: 70 })
  const result: IngestResult = { sourcePath, conceptPaths: [], entityPaths: [], created: [], updated: [], logEntry: '' }

  for (const c of analysis.concepts) {
    const slug = c.matchSlug || slugify(c.name)
    const pagePath = `wiki/concepts/${slug}.md`
    const absPath = path.join(vaultManager.getVaultPath(), pagePath)
    const exists = await fileExists(absPath)
    result.conceptPaths.push(pagePath)

    if (exists) {
      // 更新已有概念页（个人写作不参与 source_count 计数）
      const raw = await fs.readFile(absPath, 'utf-8')
      const parsed = matter(raw)
      const fm = parsed.data as Record<string, any>
      const prevCount = fm.source_count || 0
      const sourceCount = isPersonal ? prevCount : prevCount + 1
      const evolution = isPersonal
        ? `- ${today} 个人写作 [[${analysis.slug}]] 确立了对此概念的明确立场（不参与计数）`
        : `- ${today}（${sourceCount} sources）：强化 — [[${analysis.slug}]] 提供支持`
      // 达到 5+ 来源且未确认 high → 标记等待用户确认
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
      // 创建新概念页
      const aliases = [c.name, c.nameEn].filter(Boolean)
      const fm2: Record<string, any> = {
        type: 'concept',
        title: c.name,
        date: today,
        updated: new Date().toISOString(),
        tags: [],
        source_count: 1,
        confidence: 'low',
        domain_volatility: 'medium',
        last_reviewed: today,
        aliases: [...new Set(aliases)]
      }
      const body2 = [
        `# ${c.name}${c.nameEn ? `（${c.nameEn}）` : ''}`,
        ``,
        `## Definition`,
        ``,
        c.definition || '（待补充）',
        ``,
        `## Key Points`,
        ``,
        `- （待补充）`,
        ``,
        `## My Position`,
        ``,
        `（待补充）`,
        ``,
        `## Contradictions`,
        ``,
        `（无）`,
        ``,
        `## Sources`,
        ``,
        `- [[${analysis.slug}]]`,
        ``,
        `## Evolution Log`,
        ``,
        `- ${today}（1 sources）：首次摄入，由 [[${analysis.slug}]] 建立`,
        ``
      ].join('\n')
      await fs.writeFile(absPath, matter.stringify(body2, fm2), 'utf-8')
      result.created.push(pagePath)
    }
  }

  for (const e of analysis.entities) {
    const slug = e.matchSlug || slugify(e.name)
    const pagePath = `wiki/entities/${slug}.md`
    const absPath = path.join(vaultManager.getVaultPath(), pagePath)
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
        type: 'entity',
        title: e.name,
        date: today,
        tags: [],
        entity_type: e.type,
        aliases: [e.name]
      }
      const body2 = [
        `# ${e.name}`,
        ``,
        `## Description`,
        ``,
        e.description || '（待补充）',
        ``,
        `## Key Contributions`,
        ``,
        `（待补充）`,
        ``,
        `## Related Concepts`,
        ``,
        `（待补充）`,
        ``,
        `## Sources`,
        ``,
        `- [[${analysis.slug}]]`,
        ``
      ].join('\n')
      await fs.writeFile(absPath, matter.stringify(body2, fm2), 'utf-8')
      result.created.push(pagePath)
    }
  }

  // 8. 更新 index.md + overview.md + 处理开放问题
  const allSources = await listWikiPages('sources')
  const allConcepts = await listWikiPages('concepts')
  const allEntities = await listWikiPages('entities')
  await vaultManager.updateIndex(allSources, allConcepts, allEntities)
  await vaultManager.updateOverview({
    '总来源数': allSources.length,
    '概念数': allConcepts.length,
    '实体数': allEntities.length,
    '开放问题数': (await vaultManager.getOpenQuestions()).length,
    '最近摄入': analysis.title
  })
  // 标记本来源能回答的开放问题
  if (analysis.answeredQuestions?.length) {
    result.answeredQuestions = []
    for (const q of analysis.answeredQuestions) {
      await vaultManager.answerQuestion(q)
      result.answeredQuestions.push(q)
    }
  }
  emitIngestProgress({ file: fileName, stage: '更新索引…', percent: 85 })

  // 9. 追加 log.md
  const logEntry = `ingest | ${analysis.title} → wiki/sources/${analysis.slug}.md`
  await vaultManager.appendLog(logEntry)
  result.logEntry = logEntry

  // 10. 更新搜索索引 + 重建图谱 + 通知渲染进程
  for (const p of [sourcePath, ...result.conceptPaths, ...result.entityPaths]) {
    try {
      const note = await vaultManager.readNote(p)
      searchIndex.indexNote({
        path: note.path, title: note.title, tags: note.tags,
        created: note.created, updated: note.updated, kind: 'file'
      }, note.rawBody)
    } catch { /* skip */ }
  }
  rebuildGraph().catch(() => {})
  mainWindow?.webContents.send('wiki:vault:changed', { type: 'created', path: sourcePath })

  emitIngestProgress({ file: fileName, stage: '完成', percent: 100, done: true })
  return result
}

/** 列出 wiki/<dir>/ 下的页面（slug + title） */
async function listWikiPages(dir: string): Promise<Array<{ slug: string; title: string }>> {
  if (!vaultManager) return []
  const absDir = path.join(vaultManager.getVaultPath(), 'wiki', dir)
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

/** 列出 wiki/concepts/ 下所有概念（slug + title + aliases），用于 INGEST 对齐 */
async function listConceptSlugs(): Promise<Array<{ slug: string; title: string; aliases: string[] }>> {
  if (!vaultManager) return []
  const absDir = path.join(vaultManager.getVaultPath(), 'wiki', 'concepts')
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

/** 中文名 → 英文小写连字符 slug（保留 ascii，中文转拼音不可行时用 index 兜底） */
function slugify(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
  return ascii || `concept-${Date.now().toString(36)}`
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** 判断日期是否早于 N 天前 */
function isOlderThan(dateStr: string, days: number): boolean {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return false
  return Date.now() - d.getTime() > days * 24 * 60 * 60 * 1000
}

/**
 * 通过子进程调用 skills/pdf/read_pdf.js 提取文档文本（pdf/pptx/docx/xlsx）
 * 子进程方案绕开打包后 asar 内 require 的不确定性，与 skill 完全同一代码路径
 */
function extractDocumentText(absPath: string, format: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let scriptPath: string
    if (app.isPackaged) {
      scriptPath = path.join(process.resourcesPath, 'skills', 'pdf', 'read_pdf.js')
    } else {
      scriptPath = path.join(app.getAppPath(), 'skills', 'pdf', 'read_pdf.js')
    }
    const proc = spawn(process.execPath, [scriptPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true
    })
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

app.whenReady().then(async () => {
  const cfg = await store.load()
  agent = new AgentService(store, registry)
  registerIpc()

  // 初始化 Wiki 服务（轻量：仅创建目录和启动文件监听）
  const vaultPath = store.resolveVaultPath()
  vaultManager = new VaultManager(vaultPath)
  await vaultManager.initialize()
  searchIndex = new SearchIndex()
  graphEngine = new GraphEngine()
  aiPipeline = new AiPipeline()
  registerWikiIpc()

  // 注册知识库工具到 Agent
  registry.setWikiTools(createWikiTools(vaultManager, searchIndex, store))

  await reloadTools(cfg)
  Logger.info('WinAgent 启动完成，数据目录: ' + getDataDir())
  createWindow()

  // 首次启动：询问是否创建桌面快捷方式
  checkFirstRun()

  // 后台异步索引 Wiki 内容（不阻塞窗口显示，并行读取所有笔记）
  indexWikiVault()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

/** 首次启动检查：询问是否创建桌面快捷方式（仅打包版本） */
async function checkFirstRun(): Promise<void> {
  if (!app.isPackaged) return // 开发模式跳过
  const markerPath = path.join(getDataDir(), '.shortcut-asked')
  try {
    await fs.access(markerPath)
    return // 已询问过，跳过
  } catch { /* 首次启动 */ }
  // 写入标记文件（防止重复询问）
  try { await fs.writeFile(markerPath, String(Date.now())) } catch { /* ok */ }

  if (!mainWindow) return
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: '创建桌面快捷方式',
    message: '检测到这是首次启动 WinAgent，\n是否在桌面创建快捷方式？',
    buttons: ['创建快捷方式', '取消'],
    defaultId: 0,
    cancelId: 1
  })
  if (response === 0) {
    const shortcutPath = path.join(app.getPath('desktop'), 'WinAgent.lnk')
    shell.writeShortcutLink(shortcutPath, 'create', {
      target: process.execPath,
      description: 'WinAgent — Windows AI 桌面助手',
      icon: process.execPath,
      iconIndex: 0
    })
    Logger.info('桌面快捷方式已创建: ' + shortcutPath)
  }
}

/** 后台异步索引 wiki vault 中的 wiki 层笔记（LLM 检索编译结果，不索引 raw 层） */
async function indexWikiVault(): Promise<void> {
  if (!vaultManager || !searchIndex) return
  try {
    const allNotes = await vaultManager.listNotes()
    const flatNotes = flattenWikiNotes(allNotes)
    const filesOnly = flatNotes.filter((n) => n.kind === 'file' && n.path.startsWith('wiki/'))
    if (filesOnly.length === 0) return

    // 并行读取所有笔记内容
    const indexData: Array<{ meta: any; content: string }> = []
    const reads = filesOnly.map(async (n) => {
      try {
        const content = await vaultManager!.readNote(n.path)
        indexData.push({ meta: n, content: content.rawBody })
      } catch { /* skip unreadable files */ }
    })
    await Promise.all(reads)

    await searchIndex.rebuild(indexData)
    await rebuildGraph()
    // 通知渲染进程 vault 已就绪
    mainWindow?.webContents.send('wiki:vault:changed', { type: 'modified', path: '' })
    Logger.info(`Wiki 索引完成: ${indexData.length} 篇笔记`)
    // 扫描 raw/ 中未编译的文件（无对应 source 页），自动补编译
    await ingestPendingRawFiles()
  } catch (err) {
    Logger.error('Wiki 索引失败: ' + String(err))
  }
}

/** 启动时对 raw/ 中未编译（无对应 source 页）的文件自动 INGEST */
async function ingestPendingRawFiles(): Promise<void> {
  if (!vaultManager || !aiPipeline) return
  try {
    // 收集已有 source 页引用的 raw_file 列表
    const sourceDir = path.join(vaultManager.getVaultPath(), 'wiki', 'sources')
    const compiled = new Set<string>()
    try {
      const sourceFiles = await fs.readdir(sourceDir)
      for (const f of sourceFiles.filter((f) => f.endsWith('.md'))) {
        try {
          const raw = await fs.readFile(path.join(sourceDir, f), 'utf-8')
          const parsed = matter(raw)
          const rf = (parsed.data as any).raw_file
          if (typeof rf === 'string') compiled.add(rf.replace(/\\/g, '/'))
        } catch { /* skip */ }
      }
    } catch { /* sources 目录不存在 */ }

    // 扫描 raw/ 下所有文件（排除图片——图片无文本也可编译基础页，但避免噪音只处理文本类）
    const allNotes = await vaultManager.listNotes()
    const rawFiles = flattenWikiNotes(allNotes).filter(
      (n) => n.kind === 'file' && n.path.startsWith('raw/') && !compiled.has(n.path)
    )
    if (rawFiles.length === 0) return
    Logger.info(`[AutoIngest] 发现 ${rawFiles.length} 个未编译的 raw 文件，开始自动编译…`)
    // 串行编译（避免并发 LLM 调用过载）
    for (const n of rawFiles) {
      try {
        await runIngest(n.path)
        Logger.info(`[AutoIngest] 已编译: ${n.path}`)
      } catch (e) {
        Logger.error(`[AutoIngest] 跳过（失败）: ${n.path}: ${String(e)}`)
      }
    }
  } catch (err) {
    Logger.error('未编译文件扫描失败: ' + String(err))
  }
}

app.on('window-all-closed', () => {
  vaultManager?.dispose()
  registry.dispose()
  if (process.platform !== 'darwin') app.quit()
})
