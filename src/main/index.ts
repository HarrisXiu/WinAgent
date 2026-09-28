/**
 * WinAgent 桌面版主进程（Electron）。
 *
 * 主体逻辑（Agent 对话、53+ 工具、LLM Wiki 知识库、skills/MCP）全部复用 dsh-winagent
 * 插件的服务层（lib/services.js）；本文件只做桌面编排：
 *   1. 把数据目录指向 userData（%APPDATA%\com.winagent.app）
 *   2. 装配服务核心（createWinAgentCore）
 *   3. EventBus → IPC 事件转发
 *   4. ipcMain 通道注册（与 preload 的 window.winagent API 一一对应）
 *   5. 主窗口 + 知识库窗口
 */
import { app, BrowserWindow, ipcMain, shell, dialog, nativeTheme, protocol, net } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'

// ── 1. 数据目录：必须先于服务层加载设置（服务层 Logger 单例在 import 时按数据目录构造）──
// 显式沿用 Tauri 时代的数据目录（com.winagent.app 下已有用户的 config.json 与 wiki vault）；
// Electron 默认按 package.json 的 name 解析为 %APPDATA%/winagent，会另起一份。
app.setPath('userData', path.join(app.getPath('appData'), 'com.winagent.app'))
process.env.WINAGENT_DATA_DIR = app.getPath('userData')

// 服务层从 node_modules/dsh-winagent 解析（file: 依赖，见根 package.json）。
// 动态 require：保证上面的 env 已生效；类型由 dsh-winagent/lib/services.d.ts 提供。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const services = require('dsh-winagent/services') as typeof import('dsh-winagent/services')

type AppConfig = import('dsh-winagent/services').AppConfig
type NoteData = import('dsh-winagent/services').NoteData
type AnalysisTag = import('dsh-winagent/services').AnalysisTag
type BusEvent = import('dsh-winagent/services').BusEvent

let mainWindow: BrowserWindow | null = null
/** 知识库独立窗口（顶栏「知识库浏览器」弹出，?view=wiki 渲染 WikiWindowApp） */
let wikiWindow: BrowserWindow | null = null

/** 服务核心（ready 后就绪） */
let core: import('dsh-winagent/services').WinAgentCore | null = null

// 待处理的危险操作确认（agent:confirm → 渲染进程 → agent:confirm:reply）
const pendingConfirms = new Map<string, (approved: boolean) => void>()
let confirmSeq = 0

// ── winagent-skin:// 自定义协议（主题包素材） ───────────────
// 必须在 app ready 之前声明特权（standard/secure/supportFetchAPI/stream），
// 渲染层 <img> 才能直接引用；素材从 {dataDir}/skins/ 读取，带 ?v=<mtime> 缓存失效。
const SKIN_SCHEME = 'winagent-skin'
const SKIN_SLOT_NAMES = new Set(['idle', 'think', 'tool', 'vision', 'talk', 'avatar'])
const SKIN_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: SKIN_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

function skinsRoot(): string {
  return path.resolve(services.getDataDir(), 'skins')
}

/** 解析 winagent-skin://<skinId>/<slot> → 磁盘文件；做白名单 + 路径穿越校验，越界返回 null */
async function resolveSkinUrl(url: string): Promise<string | null> {
  try {
    const u = new URL(url)
    const skinId = u.hostname
    const slot = decodeURIComponent(u.pathname).replace(/^\/+/, '').split('/')[0]
    // skinId / slot 只允许白名单字符（id 由 SkinStore 生成，字符集可枚举）
    if (!/^[a-z0-9_-]{1,64}$/i.test(skinId)) return null
    if (!SKIN_SLOT_NAMES.has(slot)) return null
    const skinDir = path.resolve(skinsRoot(), skinId)
    // 双保险：skinDir 必须仍在 skins 根目录内
    if (skinDir !== skinsRoot() && !skinDir.startsWith(skinsRoot() + path.sep)) return null
    const entries = await fs.readdir(skinDir)
    const entry = entries.find((f) => f.toLowerCase().startsWith(`${slot}.`))
    if (!entry) return null
    const file = path.resolve(skinDir, entry)
    if (!file.startsWith(skinDir + path.sep)) return null
    return file
  } catch {
    return null
  }
}

function registerSkinProtocol(): void {
  protocol.handle(SKIN_SCHEME, async (request) => {
    const file = await resolveSkinUrl(request.url)
    if (!file) return new Response(null, { status: 404 })
    try {
      const buf = await fs.readFile(file)
      const mime = SKIN_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
      return new Response(new Uint8Array(buf), { headers: { 'content-type': mime } })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}

// ── 2. 主题 / 窗口 ──────────────────────────────────────────

/** 解析当前主题模式：auto 时跟随系统亮暗（nativeTheme） */
function resolveThemeMode(cfg: AppConfig): 'light' | 'dark' {
  if (cfg.theme.mode === 'auto') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  return cfg.theme.mode
}

/** 窗口启动背景色（与 body 首帧一致，避免启动闪色） */
function windowBackground(): string {
  try {
    return resolveThemeMode(core!.store.get()) === 'dark' ? '#181824' : '#fff8f4'
  } catch {
    return '#fff8f4'
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: windowBackground(),
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
    loadDevUrl(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

/**
 * dev 模式加载渲染进程。vite 重新优化依赖时 dev server 会短暂拒绝连接
 * （ERR_CONNECTION_REFUSED → 白屏），这里指数间隔重试直至就绪。
 */
async function loadDevUrl(url: string, retries = 20): Promise<void> {
  try {
    await mainWindow?.loadURL(url)
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    if (retries > 0 && (msg.includes('ERR_CONNECTION_REFUSED') || msg.includes('ERR_CONNECTION_RESET'))) {
      await new Promise((r) => setTimeout(r, 500))
      return loadDevUrl(url, retries - 1)
    }
    services.Logger.error('渲染进程加载失败: ' + msg)
  }
}

/** 知识库独立窗口（?view=wiki 渲染 WikiWindowApp） */
function createWikiWindow(): void {
  if (wikiWindow && !wikiWindow.isDestroyed()) {
    wikiWindow.focus()
    return
  }
  wikiWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: windowBackground(),
    title: '知识库',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  wikiWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  wikiWindow.webContents.on('will-navigate', (e) => {
    e.preventDefault()
  })

  // index.html 的 <title>WinAgent</title> 会覆盖窗口标题，这里固定为「知识库」
  wikiWindow.webContents.on('page-title-updated', (e) => {
    e.preventDefault()
    wikiWindow?.setTitle('知识库')
  })

  wikiWindow.on('closed', () => {
    wikiWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    loadDevUrl(process.env.ELECTRON_RENDERER_URL + '?view=wiki')
  } else {
    wikiWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { view: 'wiki' } })
  }
}

/** 广播到所有窗口 */
function sendToWindows(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args)
  }
}

// ── 3. EventBus → IPC 转发 ─────────────────────────────────

/** bus 事件名 → IPC 通道名；映射表之外的类型不转发 */
const BUS_TO_IPC: Record<string, string> = {
  agentEvent: 'agent:event',
  confirm: 'agent:confirm',
  configChanged: 'config:changed',
  vaultChanged: 'wiki:vault:changed',
  ingestProgress: 'wiki:ingest:progress',
  customProgress: 'wiki:custom:progress',
  voiceSegment: 'voice:segment',
  voiceSessionEnd: 'voice:session:end'
}

function startBusForwarding(): void {
  core!.bus.subscribe((e: BusEvent) => {
    const channel = BUS_TO_IPC[e.type]
    if (!channel) return
    // agent 事件与语音分段只发主窗口（语音播放态在主窗口消费）；其余广播（主题切换/wiki 进度需双窗口同步）
    if (e.type === 'agentEvent' || e.type === 'confirm' || e.type === 'voiceSegment' || e.type === 'voiceSessionEnd') {
      mainWindow?.webContents.send(channel, e.data)
    } else {
      sendToWindows(channel, e.data)
    }
  })
}

// ── 4. IPC 通道（与 preload 的 window.winagent API 一一对应）──

function registerIpc(): void {
  const conversations = new services.ConversationStore(path.join(services.getDataDir(), 'conversations'))
  let activeConversation = ''
  let activeConversationKind: 'assistant' | 'topic' = 'assistant'
  let activeTopicTag = ''
  let detectingRequest = 0
  ipcMain.handle('chats:list', () => conversations.list())
  ipcMain.handle('chats:open', async (_e, id: string) => {
    if (core!.agent.isBusy() || detectingRequest) throw new Error('请等待当前任务结束后切换')
    const key = id || 'assistant'
    let record: import('dsh-winagent/services').SavedConversation | null = null
    try { record = await conversations.read(key) } catch (e: any) { if (e.code !== 'ENOENT' || key !== 'assistant') throw e }
    if (record?.kind === 'topic' && !record.topicTag?.startsWith('专题:')) throw new Error('专题任务缺少有效标签，无法打开')
    core!.agent.restoreSession(record?.state)
    activeConversation = key
    activeConversationKind = record?.kind === 'topic' ? 'topic' : 'assistant'
    activeTopicTag = activeConversationKind === 'topic' ? record?.topicTag || '' : ''
    if (!record) {
      record = { id: key, title: '助理', kind: 'assistant', updated: new Date().toISOString(), turns: [], state: core!.agent.exportSession(), context: { mode: 'auto', paths: [] } }
      await conversations.write(record)
    }
    return record
  })
  ipcMain.handle('chats:createTopic', async (_e, title: string) => {
    if (core!.agent.isBusy() || detectingRequest) throw new Error('请等待当前任务结束后新建专题')
    const name = String(title || '').trim().replace(/\s+/g, ' ')
    if (!name || name.length > 60 || /[\r\n]/.test(name)) throw new Error('请输入 1–60 字的专题名称')
    if ((await conversations.list()).some(c => c.kind === 'topic' && c.title.toLowerCase() === name.toLowerCase())) throw new Error('专题名称已存在')
    core!.agent.restoreSession()
    const record: import('dsh-winagent/services').SavedConversation = {
      id: require('crypto').randomUUID(), title: name, kind: 'topic', topicTag: `专题:${name}`,
      updated: new Date().toISOString(), turns: [], state: core!.agent.exportSession(), context: { mode: 'auto', paths: [] }
    }
    await conversations.write(record)
    activeConversation = record.id; activeConversationKind = 'topic'; activeTopicTag = record.topicTag!
    return record
  })
  ipcMain.handle('chats:save', async (_e, id: string, turns: any[], context?: import('dsh-winagent/services').KnowledgeContext, draft?: string) => {
    if (id !== activeConversation) throw new Error('当前任务已切换，未覆盖其他任务')
    const state = core!.agent.exportSession()
    const existing = await conversations.read(id)
    await conversations.write({ ...existing, updated: new Date().toISOString(), turns, state,
      context: { mode: activeConversationKind === 'topic' ? 'auto' : context?.mode || 'auto', paths: activeConversationKind === 'topic' ? [] : context?.paths || [] }, draft })
  })
  services.setOutputLimitObserver(async (provider, limit) => {
    const cfg = core!.store.get()
    const current = cfg.providers.find(p => p.id === provider.id)
    if (!current || services.outputLimitKey(current) !== limit.key) return
    await core!.store.save({ ...cfg, providers: cfg.providers.map(p => p.id === provider.id ? { ...p, outputLimit: limit } : p),
      maxTokens: cfg.autoMaxTokens !== false && cfg.activeProviderId === provider.id ? limit.value || 0 : cfg.maxTokens })
    sendToWindows('config:changed', core!.store.get())
  })
  ipcMain.handle('models:outputLimit', async (_e, provider: import('dsh-winagent/services').ProviderConfig, force: boolean) => {
    try { return { limit: await services.detectOutputLimit(provider, (url, init) => net.fetch(url, init), force) } }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  })
  const wiki = () => {
    if (!core) throw new Error('服务未初始化')
    return core.wikiHost
  }

  // === Config ===
  ipcMain.handle('config:get', () => core!.store.get())
  ipcMain.handle('config:save', async (_e, cfg: AppConfig) => {
    const before = core!.store.get()
    const toolsChanged = cfg.skillsDir !== before.skillsDir || cfg.mcpConfigPath !== before.mcpConfigPath || JSON.stringify(cfg.skillsDirs) !== JSON.stringify(before.skillsDirs)
    if(toolsChanged && core!.agent.isBusy()) throw new Error('请等待当前任务结束后更新工具目录')
    await core!.store.save(cfg)
    if(toolsChanged)await core!.reloadTools()
    const saved = core!.store.get()
    sendToWindows('config:changed', saved)
    return saved
  })
  ipcMain.handle('config:dataDir', () => services.getDataDir())

  // === Dialog ===
  ipcMain.handle('dialog:pickDirectory', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Skills 文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  // === File（附件读取：图片→dataUrl，文本→内容，其他→路径信息） ===
  ipcMain.handle('file:read', async (_e, filePath: string) => {
    const fs = await import('fs')
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
      const buf = await fs.promises.readFile(filePath)
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      return { name, path: filePath, mime, isImage: true, dataUrl }
    }

    // PDF：≤15MB 附带 dataUrl（供模型文件直传，被拒时自动降级工具读取）；超限仅路径
    if (ext === '.pdf') {
      const buf = await fs.promises.readFile(filePath)
      const base = { name, path: filePath, mime: 'application/pdf', isImage: false, isPdf: true }
      if (buf.length > 15 * 1024 * 1024) return base
      return { ...base, dataUrl: `data:application/pdf;base64,${buf.toString('base64')}` }
    }

    const textExts = ['.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', '.py', '.java',
      '.c', '.cpp', '.h', '.css', '.html', '.xml', '.yml', '.yaml', '.csv', '.log', '.sh', '.bat']
    if (textExts.includes(ext)) {
      const textContent = await fs.promises.readFile(filePath, 'utf-8')
      return { name, path: filePath, mime, isImage: false, textContent: textContent.slice(0, 50000) }
    }
    return { name, path: filePath, mime, isImage: false }
  })

  // === Tools / Models ===
  ipcMain.handle('tools:list', () => core!.registry.getInfos())
  const mcpFile = (): string => core!.store.resolvePath(core!.store.get().mcpConfigPath || 'mcp.json')
  ipcMain.handle('tools:mcp:get', async () => {
    try { return await fs.readFile(mcpFile(), 'utf8') } catch (e: any) { if(e.code==='ENOENT')return '{"mcpServers":{}}';throw e }
  })
  ipcMain.handle('tools:mcp:save', async (_e, text: string) => {
    if(core!.agent.isBusy())throw new Error('请等待当前任务结束后更新工具')
    const value = JSON.parse(text)
    if(!value.mcpServers || typeof value.mcpServers!=='object' || Array.isArray(value.mcpServers)) throw new Error('配置需要包含 mcpServers 对象')
    for(const [name, server] of Object.entries(value.mcpServers) as Array<[string,any]>) {
      if(!name.trim() || !server || typeof server!=='object')throw new Error('MCP 服务名称或配置无效')
      if(typeof server.url==='string') { if(!/^https?:\/\//i.test(server.url))throw new Error(`${name} 的 URL 需要使用 http 或 https`) }
      else if(typeof server.command!=='string' || !server.command.trim())throw new Error(`${name} 需要填写 command 或 url`)
      if(server.args!==undefined && (!Array.isArray(server.args)||server.args.some((x:any)=>typeof x!=='string')))throw new Error(`${name} 的 args 必须为字符串数组`)
    }
    const file=mcpFile();await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value,null,2),'utf8')
    await core!.reloadTools();return core!.registry.getInfos()
  })
  ipcMain.handle('tools:reload', async () => {
    if(core!.agent.isBusy())throw new Error('请等待当前任务结束后重新加载工具')
    await core!.reloadTools()
    return core!.registry.getInfos()
  })
  ipcMain.handle('models:fetch', async (_e, request: string | import('dsh-winagent/services').ProviderConfig) => {
    try {
      // 设置页可传入尚未保存的配置；顶栏仍可按 providerId 拉取。
      const provider = typeof request === 'string'
        ? core!.store.get().providers.find((p) => p.id === request)
        : request
      if (!provider) throw new Error('服务商配置不存在，请重新选择服务商。')
      // 使用 Electron 网络栈，使模型请求遵循系统代理配置。
      const models = await services.fetchModels(provider, (url, init) => net.fetch(url, init))
      return { models }
    } catch (e) {
      // 显式返回错误，避免 Electron IPC 给用户提示加上内部方法名。
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  // === Agent ===
  ipcMain.handle('agent:send', async (_e, text: string, attachments?: any[], context?: import('dsh-winagent/services').KnowledgeContext) => {
    if (detectingRequest || core!.agent.isBusy()) throw new Error('当前任务仍在执行')
    if (!activeConversation) throw new Error('请先打开助理或专题任务')
    if (activeConversationKind === 'topic' && attachments?.length) throw new Error('专题任务只能使用带当前专题标签的 Wiki 文件；请先将文件导入 Wiki 并添加标签')
    const requestId = Date.now()
    detectingRequest = requestId
    if (core!.store.get().autoMaxTokens !== false) {
      const provider = core!.store.activeProvider()
      try {
        const limit = await services.detectOutputLimit(provider, (url, init) => net.fetch(url, init))
        const cfg = core!.store.get()
        if (services.outputLimitKey(core!.store.activeProvider()) === limit.key) {
          await core!.store.save({ ...cfg, maxTokens: limit.value || 0 })
          sendToWindows('config:changed', core!.store.get())
        }
      } catch { // Detection failure must not prevent a valid chat request using server defaults.
        const cfg = core!.store.get()
        await core!.store.save({ ...cfg, maxTokens: 0 })
        sendToWindows('config:changed', core!.store.get())
      }
    }
    if (detectingRequest !== requestId) return
    detectingRequest = 0
    await core!.agent.process(text, {
      onEvent: (e) => core!.bus.push('agentEvent', e),
      confirmTool
    }, attachments, activeConversationKind === 'topic' ? { mode: 'auto', paths: [], topicTag: activeTopicTag } : { mode: context?.mode, paths: context?.paths })
  })
  ipcMain.handle('agent:stop', () => {
    detectingRequest = 0
    core!.agent.stop()
    clearPendingConfirms(false)
  })
  ipcMain.handle('agent:reset', () => {
    core!.agent.reset()
    clearPendingConfirms(false)
  })
  ipcMain.handle('agent:compact', async () => {
    await core!.agent.compactNow({ onEvent: (e) => core!.bus.push('agentEvent', e), confirmTool })
  })

  ipcMain.on('agent:confirm:reply', (_e, payload: { id: string; approved: boolean }) => {
    const resolve = pendingConfirms.get(payload.id)
    if (resolve) {
      resolve(payload.approved)
      pendingConfirms.delete(payload.id)
    }
  })

  // === Voice（TTS + 克隆音色库） ===
  // 分段朗读会话：start 立即返回 {sessionId, total}，逐段经 voice:segment 事件下发；
  // 渲染层播到某段时用 ack 回执（单向 send）驱动滑窗预取；cancel 终止会话。
  ipcMain.handle('tts:start', (_e, text: string, opts?: { voice?: string; stylePrompt?: string; source?: 'manual' | 'auto' | 'agent' | 'test' }) => {
    return core!.voice.startSession(text, opts)
  })
  ipcMain.on('tts:ack', (_e, sessionId: string, index: number) => {
    core!.voice.ack(sessionId, index)
  })
  ipcMain.on('tts:cancel', (_e, sessionId?: string) => {
    core!.voice.cancelSession(sessionId)
  })

  const voiceStore = () => core!.voice.voiceStore
  const broadcastVoices = async (): Promise<void> => {
    sendToWindows('voice:changed', await voiceStore().list())
  }
  ipcMain.handle('voice:list', async () => voiceStore().list())
  // 内置音色列表（服务层单一事实来源，渲染层不硬编码）
  ipcMain.handle('voice:builtinList', () => services.BUILTIN_VOICES)
  ipcMain.handle('voice:add', async (_e, name?: string) => {
    if (!mainWindow) throw new Error('窗口未就绪')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择参考音频（wav / mp3）',
      filters: [{ name: '音频（wav / mp3）', extensions: ['wav', 'mp3'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return voiceStore().list()
    await voiceStore().add(name || '', result.filePaths[0])
    await broadcastVoices()
    return voiceStore().list()
  })
  ipcMain.handle('voice:rename', async (_e, id: string, name: string) => {
    const list = await voiceStore().rename(id, name)
    await broadcastVoices()
    return list
  })
  ipcMain.handle('voice:remove', async (_e, id: string) => {
    await voiceStore().remove(id)
    await broadcastVoices()
    return voiceStore().list()
  })
  // 克隆音色试听：走朗读会话（返回 {sessionId, total}，可取消、进控制条）
  ipcMain.handle('voice:test', async (_e, id: string, sampleText?: string) => {
    return core!.voice.testClone(id, sampleText)
  })

  // === Skins（主题包：外观素材库） ===
  const skins = () => {
    if (!core) throw new Error('服务未初始化')
    return core.skins
  }
  const broadcastSkins = async (): Promise<void> => {
    sendToWindows('skin:changed', await skins().list())
  }
  ipcMain.handle('skins:list', async () => skins().list())
  ipcMain.handle('skins:create', async (_e, name: string) => {
    await skins().create(name)
    await broadcastSkins()
    return skins().list()
  })
  ipcMain.handle('skins:setSlot', async (_e, id: string, slot: string) => {
    if (!mainWindow) throw new Error('窗口未就绪')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择图片（png / gif / jpg / webp）',
      filters: [{ name: '图片（png / gif / jpg / webp）', extensions: ['png', 'gif', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return skins().list()
    await skins().setSlot(id, slot as import('dsh-winagent/services').SkinSlot, result.filePaths[0])
    await broadcastSkins()
    return skins().list()
  })
  ipcMain.handle('skins:clearSlot', async (_e, id: string, slot: string) => {
    await skins().clearSlot(id, slot as import('dsh-winagent/services').SkinSlot)
    await broadcastSkins()
    return skins().list()
  })
  ipcMain.handle('skins:rename', async (_e, id: string, name: string) => {
    const list = await skins().rename(id, name)
    await broadcastSkins()
    return list
  })
  ipcMain.handle('skins:remove', async (_e, id: string) => {
    await skins().remove(id)
    await broadcastSkins()
    return skins().list()
  })

  // === Prompts（人设默认值：主题包联动切换用） ===
  ipcMain.handle('config:prompts', () => ({
    personaPrompt: services.DEFAULT_PERSONA_PROMPT,
    petPrompt: services.DEFAULT_PET_PROMPT
  }))

  // === Wiki — 窗口 / Vault ===
  ipcMain.handle('wiki:window:open', () => createWikiWindow())
  ipcMain.handle('wiki:workspace:chat', (_e, value: {path:string;title:string;text?:string}) => {
    mainWindow?.webContents.send('wiki:workspace:chat',value)
    mainWindow?.show();mainWindow?.focus()
  })
  ipcMain.handle('wiki:workspace:sources', () => wiki().workspace.sources())
  ipcMain.handle('wiki:workspace:jobs', () => wiki().workspace.jobs())
  ipcMain.handle('wiki:workspace:cancel', (_e, id: string) => wiki().ingestion.cancel(id))
  ipcMain.handle('wiki:workspace:pickFiles', async () => {
    const selected = await dialog.showOpenDialog({ title: '导入知识资料或任务规范', properties: ['openFile', 'multiSelections'] })
    return selected.canceled ? [] : selected.filePaths
  })
  ipcMain.handle('wiki:rules:list', () => wiki().workspace.rules())
  ipcMain.handle('wiki:rules:compile', async (_e, sourcePath: string, task: import('dsh-winagent/services').RuleTask, keywords: string[]) => {
    const result = await wiki().rules.compile(core!.store.activeProvider(), sourcePath, task, keywords)
    core!.bus.push('vaultChanged', { type: 'modified', path: sourcePath })
    return result
  })
  ipcMain.handle('wiki:rules:toggle', async (_e, id: string, enabled: boolean) => {
    await wiki().rules.toggle(id, !!enabled)
    core!.bus.push('vaultChanged', { type: 'modified', path: '.rules' })
  })
  ipcMain.handle('wiki:workspace:openOriginal', async (_e, rawPath: string) => {
    const root = path.resolve(wiki().getVaultPath())
    const target = path.resolve(root, rawPath)
    const relative = path.relative(root, target)
    if (!rawPath.replace(/\\/g, '/').startsWith('raw/') || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('文件必须位于当前知识库 raw 目录')
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
  })
  ipcMain.handle('wiki:workspace:pdf', async (_e, id: string) => {
    const source = (await wiki().workspace.sources()).find(s=>s.id===id)
    if (!source || !source.rawPath.toLowerCase().endsWith('.pdf')) throw new Error('PDF 来源不存在')
    const root = await fs.realpath(wiki().getVaultPath())
    const file = await fs.realpath(path.resolve(root,source.rawPath))
    const relative = path.relative(root,file)
    if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('PDF 不在当前知识库中')
    return new Uint8Array(await fs.readFile(file))
  })
  ipcMain.handle('wiki:vault:path', () => wiki().getVaultPath())
  ipcMain.handle('wiki:vault:setPath', async (_e, p: string) => {
    await wiki().setVaultPath(p)
  })

  // === Wiki — Notes ===
  ipcMain.handle('wiki:notes:list', async () => wiki().listNotes())
  ipcMain.handle('wiki:notes:read', async (_e, relPath: string) => wiki().readNote(relPath))
  ipcMain.handle('wiki:notes:write', async (_e, relPath: string, data: NoteData) => {
    await wiki().writeNote(relPath, data)
  })
  ipcMain.handle('wiki:notes:delete', async (_e, relPath: string) => {
    await wiki().deleteNote(relPath)
  })
  ipcMain.handle('wiki:notes:create', async (_e, relPath: string, title: string) => {
    await wiki().createNote(relPath, title)
  })

  // === Wiki — Links / Tags / Search ===
  ipcMain.handle('wiki:links:backlinks', async (_e, targetPath: string) => wiki().getBacklinks(targetPath))
  ipcMain.handle('wiki:tags:list', async () => wiki().getAllTags())
  ipcMain.handle('wiki:tags:notes', async (_e, tag: string) => wiki().getNotesByTag(tag))
  ipcMain.handle('wiki:search', async (_e, query: string, limit?: number) => wiki().searchNotes(query, limit))

  // === Wiki — Graph ===
  ipcMain.handle('wiki:graph:data', async () => wiki().getGraphData())
  ipcMain.handle('wiki:graph:node', async (_e, nodeId: string) => wiki().getGraphNode(nodeId))
  ipcMain.handle('wiki:graph:rebuild', async () => {
    await wiki().rebuildGraph()
  })

  // === Wiki — AI 分析 ===
  ipcMain.handle('wiki:ai:analyze', async (_e, relPath: string) => wiki().aiAnalyze(relPath))
  ipcMain.handle('wiki:ai:cancel', () => wiki().aiCancel())

  // === Wiki — Ingest ===
  ipcMain.handle('wiki:ingest', async (_e, rawRelPath: string, force?: boolean) => wiki().runIngest(rawRelPath, force === true))
  ipcMain.handle('wiki:ingest:batchStart', async (_e, paths: string[]) => wiki().ingestBatchStart(paths))
  ipcMain.handle('wiki:ingest:batchContinue', async () => wiki().ingestBatchContinue())
  ipcMain.handle('wiki:ingest:batchAbort', async () => wiki().ingestBatchAbort())

  // === Wiki — 工作流 ===
  ipcMain.handle('wiki:workflow:lint', async () => wiki().workflowLint())
  ipcMain.handle('wiki:workflow:reflect', async () => wiki().workflowReflect())
  ipcMain.handle('wiki:workflow:merge', async (_e, keep: string, remove: string, area: 'concepts' | 'entities') => {
    return wiki().workflowMerge(keep, remove, area)
  })
  ipcMain.handle('wiki:workflow:query', async (_e, query: string) => wiki().workflowQuery(query))

  // === Wiki — 导入 ===
  ipcMain.handle('wiki:import:url', async (_e, url: string) => wiki().importUrl(url))
  ipcMain.handle('wiki:import:file', async (_e, srcPath: string, targetDir?: string) => {
    // 返回 relPath 字符串（preload/renderer 期望 Promise<string>）
    return wiki().importFile(srcPath, targetDir)
  })
  ipcMain.handle('wiki:import:analyze', async (_e, filePaths: string[], requirement: string) => {
    return wiki().importAnalyze(filePaths, requirement)
  })

  // === Wiki — 分析 tag / 附件 / 批注 / 概念确认 ===
  ipcMain.handle('wiki:analysisTags:list', async () => wiki().getAnalysisTags())
  ipcMain.handle('wiki:analysisTags:add', async (_e, tags: AnalysisTag[]) => wiki().addAnalysisTags(tags))
  ipcMain.handle('wiki:attachments:list', async (_e, subDir?: string) => wiki().listAttachments(subDir))
  ipcMain.handle('wiki:annotations:add', async (_e, relPath: string, text: string, range: string) => {
    return wiki().addAnnotation(relPath, text, range)
  })
  ipcMain.handle('wiki:annotations:remove', async (_e, relPath: string, annotationId: string) => {
    await wiki().removeAnnotation(relPath, annotationId)
  })
  ipcMain.handle('wiki:concept:confirm', async (_e, slug: string, area: 'concepts' | 'entities') => {
    return wiki().conceptConfirm(slug, area)
  })
}

function confirmTool(name: string, args: string): Promise<boolean> {
  return new Promise((resolve) => {
    const id = `cf_${++confirmSeq}`
    pendingConfirms.set(id, resolve)
    mainWindow?.webContents.send('agent:confirm', { id, name, args })
  })
}

function clearPendingConfirms(approved: boolean): void {
  for (const [id, resolve] of [...pendingConfirms]) {
    pendingConfirms.delete(id)
    resolve(approved)
  }
}

// ── 5. 启动 ────────────────────────────────────────────────

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    // 模型列表、输出上限和实际 LLM 请求使用同一 Electron 网络栈与系统代理。
    services.setChatFetcher((url, init) => net.fetch(url, init))
    // 自定义协议（主题包素材）须在窗口加载前就绪
    registerSkinProtocol()
    try {
      core = await services.createWinAgentCore()
      startBusForwarding()
      services.Logger.info('桌面版服务核心就绪')
    } catch (err) {
      services.Logger.error('服务核心装配失败: ' + String((err as Error)?.message || err))
      dialog.showErrorBox('WinAgent 启动失败', String((err as Error)?.message || err))
      app.quit()
      return
    }
    registerIpc()
    createWindow()
  })

  app.on('window-all-closed', () => {
    core?.dispose()
    if (process.platform !== 'darwin') app.quit()
  })
}
