import { useEffect, useRef, useState } from 'react'
import {
  Bot,
  Settings as SettingsIcon,
  Square,
  Minimize2,
  RefreshCw,
  AlertTriangle,
  Plus,
  X,
  FileText,
  ImageIcon,
  Puzzle,
  Wrench,
  Server,
  BookOpen,
  PanelLeftClose, PanelLeftOpen, MessageSquare, Search, ChevronRight, ArrowUpRight, ArrowUp, ArrowDown, Paperclip, Library, Loader2,
  Archive, ArchiveRestore, Pencil, Trash2
} from 'lucide-react'
import type { AppConfig, AnalysisTag, KnowledgeContext } from '../../shared/types'
import KnowledgeWorkspace, { type KnowledgeSelection } from './components/wiki/KnowledgeWorkspace'
import ErrorBoundary from './components/ErrorBoundary'
import ToolsWorkspace from './components/workbench/ToolsWorkspace'
import { useResizablePane } from './components/workbench/useResizablePane'
import './components/workbench/workbench.css'
import { useAgent, type TopicSummary } from './lib/useAgent'
import { SpeechProvider, useSpeech } from './lib/useSpeech'
import SpeechBar from './components/SpeechBar'
import AppGlyph from './components/AppGlyph'
import Message from './components/Message'
import Settings, { type TabKey } from './components/Settings'
import ConfirmHighDialog, { type ConfirmHighItem } from './components/wiki/ConfirmHighDialog'
import ImportAnalyzeDialog, { type ImportAnalyzeFile } from './components/wiki/ImportAnalyzeDialog'
import { useSkin } from './theme/SkinProvider'
import type { AiState } from './theme/skins'

interface PendingAttachment {
  name: string
  path: string
  isImage: boolean
  dataUrl?: string
  textContent?: string
}

/** 输入 / 时弹出的命令菜单（均为已实现的命令） */
const SLASH_COMMANDS = [
  { cmd: '/clear', desc: '清空当前对话' },
  { cmd: '/compact', desc: '压缩上下文，释放 token' },
  { cmd: '/new', desc: '新建专题任务' }
] as const

/** 距底部小于此值视为「停在底部」：新内容到达时才自动跟随 */
const STICK_THRESHOLD = 80

function AppShell(): JSX.Element {
  const speech = useSpeech()
  const skin = useSkin()
  const { turns, busy, switching, running, runningId, canRegenerate, regenerate, renameTopic, archiveTopic, deleteTopic, status, confirm, usage, lastUsage, visionActive, activeRules, knowledgeError, send, stop, reset, compact, respondConfirm, conversations, conversationId, conversationKind, topicTag, switchConversation, createTopic, setDraftContext } = useAgent({
    onConversationLoaded: record => {
      setInput(record.draft || '')
      setKnowledgeMode(record.context?.mode || 'auto')
      setPinnedKnowledge((record.context?.paths || []).map(path=>({path,title:path.split('/').pop()?.replace(/\.md$/,'') || path})))
      setAttachments([])
    },
    // 自动朗读：回复完成后（未出错）走全局语音会话（气泡播放态/控制条/取消链路统一）
    onTurnComplete: (content, turnId) => {
      const v = cfgRef.current?.voice
      if (!v?.enabled || !v.autoPlay || !v.apiKey) return
      speech.speak(content, { messageId: turnId, source: 'auto' })
    }
  })
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  // 事件回调里读配置用（避免闭包读到旧 cfg）
  const cfgRef = useRef<AppConfig | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<TabKey>('models')
  const [pickSkills, setPickSkills] = useState(false)
  const [input, setInput] = useState('')
  const [showKnowledge, setShowKnowledge] = useState(false)
  const [showPlugins, setShowPlugins] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [taskSearch, setTaskSearch] = useState('')
  const [creatingTopic, setCreatingTopic] = useState(false)
  const [topicDraft, setTopicDraft] = useState('')
  const [scopeNotice, setScopeNotice] = useState('')
  const sidebar = useResizablePane('winagent:sidebar-width', 232, 192, 380)
  const navigate = (view: 'chat'|'wiki'|'plugins'): void => {setShowKnowledge(view==='wiki');setShowPlugins(view==='plugins')}
  const changeConversation = async (id='assistant'): Promise<void> => { speech.stop(); await switchConversation(id);setScopeNotice('');navigate('chat') }
  const submitTopic = async (): Promise<void> => { if (!topicDraft.trim()) return;try { await createTopic(topicDraft);setTopicDraft('');setCreatingTopic(false);setScopeNotice('');navigate('chat') } catch(e) { setScopeNotice(e instanceof Error?e.message:String(e)) } }

  // ── 专题管理：右键菜单 → 重命名（内联）/ 归档 / 删除（确认框决定是否移除 Wiki 标签） ──
  const [topicMenu, setTopicMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renamingId, setRenamingId] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  // 提交/取消后立即清空：回车提交与随后的 blur、Esc 取消与随后的 blur 都只生效一次
  const renameRef = useRef('')
  const [showArchived, setShowArchived] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; title: string; tag: string; wikiFiles: number | null } | null>(null)
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])
  /** IPC 抛出的错误带「Error invoking remote method 'x': Error:」前缀，展示前去掉 */
  const showError = (e: unknown): void =>
    setToast({ text: (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), error: true })
  const topics = conversations.filter((c) => c.kind === 'topic')
  const activeTopics = topics.filter((c) => !c.archived)
  const archivedTopics = topics.filter((c) => c.archived)
  const matchesSearch = (c: TopicSummary): boolean => c.title.toLowerCase().includes(taskSearch.toLowerCase())
  const openTopicMenu = (e: React.MouseEvent, id: string): void => {
    e.preventDefault()
    // 菜单约 180×140：贴近窗口右/下边缘时向内收，避免溢出
    setTopicMenu({ id, x: Math.min(e.clientX, window.innerWidth - 188), y: Math.min(e.clientY, window.innerHeight - 150) })
  }
  useEffect(() => {
    if (!topicMenu) return
    const close = (): void => setTopicMenu(null)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [topicMenu])
  const startRename = (id: string): void => {
    const t = topics.find((c) => c.id === id)
    setTopicMenu(null)
    if (!t) return
    renameRef.current = id
    setRenamingId(id)
    setRenameDraft(t.title)
  }
  const cancelRename = (): void => {
    renameRef.current = ''
    setRenamingId('')
  }
  const commitRename = async (): Promise<void> => {
    const id = renameRef.current
    if (!id) return
    cancelRename()
    const old = topics.find((c) => c.id === id)
    const next = renameDraft.trim()
    if (!old || !next || next === old.title) return
    try {
      const n = await renameTopic(id, next)
      setToast({ text: n ? `已重命名，并同步更新 ${n} 个 Wiki 文件的标签` : '已重命名' })
    } catch (e) {
      showError(e)
    }
  }
  const toggleArchive = async (id: string, archived: boolean): Promise<void> => {
    setTopicMenu(null)
    try {
      await archiveTopic(id, archived)
      setToast({ text: archived ? '已归档，可在侧栏「已归档」中找回' : '已取消归档' })
    } catch (e) {
      showError(e)
    }
  }
  const askDelete = (id: string): void => {
    setTopicMenu(null)
    const t = topics.find((c) => c.id === id)
    if (!t?.topicTag) return
    const tag = t.topicTag
    setDeleteDialog({ id, title: t.title, tag, wikiFiles: null })
    // 统计带该标签的 Wiki 文件数，决定确认框给哪些选项
    const settle = (n: number): void => setDeleteDialog((d) => (d && d.id === id ? { ...d, wikiFiles: n } : d))
    window.winagent.wiki.getNotesByTag(tag).then((notes) => settle(notes.length)).catch(() => settle(0))
  }
  const confirmDelete = async (removeWikiTag: boolean): Promise<void> => {
    const d = deleteDialog
    if (!d) return
    setDeleteDialog(null)
    try {
      const n = await deleteTopic(d.id, removeWikiTag)
      setToast({ text: removeWikiTag && n ? `已删除「${d.title}」，并从 ${n} 个 Wiki 文件移除标签` : `已删除「${d.title}」` })
    } catch (e) {
      showError(e)
    }
  }
  const topicItem = (c: TopicSummary): JSX.Element =>
    renamingId === c.id ? (
      <input
        key={c.id}
        className="wb-rename-input"
        autoFocus
        aria-label="专题新名称"
        maxLength={60}
        value={renameDraft}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setRenameDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void commitRename() }
          else if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
        }}
        onBlur={() => void commitRename()}
      />
    ) : (
      <button
        key={c.id}
        className={`${c.id === conversationId && !showKnowledge && !showPlugins ? 'is-active' : ''} ${c.archived ? 'is-archived' : ''}`}
        title={`${c.title} · ${c.topicTag}${c.id === runningId ? ' · 正在运行' : ''}（右键：重命名 / 归档 / 删除）`}
        aria-haspopup="menu"
        onClick={() => void changeConversation(c.id)}
        onContextMenu={(e) => openTopicMenu(e, c.id)}
      >
        <MessageSquare size={14} />
        <span>{c.title}</span>
        {c.id === runningId && <i className="wb-run-dot" />}
      </button>
    )
  const [knowledgeSelection, setKnowledgeSelection] = useState<KnowledgeSelection | null>(null)
  const [knowledgeMode, setKnowledgeMode] = useState<KnowledgeContext['mode']>('auto')
  const [pinnedKnowledge, setPinnedKnowledge] = useState<Array<{path:string;title:string}>>([])
  const pinKnowledge = async (path: string, title: string): Promise<boolean> => {
    if (conversationKind === 'topic') {
      const note = await window.winagent.wiki.readNote(path).catch(()=>null)
      if (!note) {setScopeNotice(`请先打开《${title}》并添加「${topicTag}」标签`);navigate('wiki');return false}
      if (!note.tags.includes(topicTag)) {setScopeNotice(`请先为《${title}》添加「${topicTag}」标签`);navigate('wiki');return false}
      setScopeNotice('');navigate('chat');return true
    }
    setPinnedKnowledge(p => p.some(x=>x.path===path)?p:[...p,{path,title}]);setKnowledgeMode('selected')
    navigate('chat')
    return true
  }
  const openKnowledge = (path: string, chunkId?: string): void => {
    setKnowledgeSelection({path,chunkId});navigate('wiki')
  }
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  // 知识库独立窗口 + 拖拽处理
  const [dragOver, setDragOver] = useState(false)
  const [wikiProcessing, setWikiProcessing] = useState<Array<{ file: string; status: 'processing' | 'done' | 'error'; message?: string; progress?: number; stage?: string; leaving?: boolean }>>([])
  // confidence high 用户确认（概念 5+ 来源，独立窗口与主窗口共用组件）
  const [confirmHigh, setConfirmHigh] = useState<ConfirmHighItem[] | null>(null)
  // 拖入文件后的分析要求弹窗（files + 历史分析 tag）
  const [importDialog, setImportDialog] = useState<{ files: ImportAnalyzeFile[]; tags: AnalysisTag[] } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  useEffect(()=>window.winagent.wiki.onChatContext(({path,title,text})=>{
    void pinKnowledge(path,title);setShowPlugins(false)
    if(text)setInput(s=>`${s}${s?'\n\n':''}引用《${title}》：\n${text}\n\n`)
  }),[conversationKind,topicTag])
  useEffect(()=>{setDraftContext(input,{mode:knowledgeMode,paths:pinnedKnowledge.map(p=>p.path)})},[input,knowledgeMode,pinnedKnowledge])
  useEffect(()=>{
    const shortcut=(e:KeyboardEvent):void=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='b'){e.preventDefault();setSidebarCollapsed(s=>!s)}
      if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='n'){e.preventDefault();setCreatingTopic(true)}
    }
    window.addEventListener('keydown',shortcut);return()=>window.removeEventListener('keydown',shortcut)
  },[busy,conversationId,turns,input])

  const loadCfg = (): void => {
    window.winagent.getConfig().then((c) => {
      cfgRef.current = c
      setCfg(c)
    })
  }
  useEffect(() => {
    loadCfg()
    // 设置面板/另一窗口改配置后实时同步（含自动朗读开关、主题包、人设）
    return window.winagent.onConfigChanged((c) => {
      cfgRef.current = c
      setCfg(c)
    })
  }, [])

  // 订阅 INGEST 进度（拖拽编译进度条）
  useEffect(() => {
    return window.winagent.wiki.onIngestProgress((p) => {
      setWikiProcessing((prev) =>
        prev.map((item) =>
          item.file === p.file
            ? { ...item, progress: p.percent, stage: p.stage, status: p.error ? 'error' : item.status }
            : item
        )
      )
    })
  }, [])

  // done 卡片 5 秒后渐隐（error 常驻手动关闭）
  useEffect(() => {
    const target = wikiProcessing.find((p) => p.status === 'done' && !p.leaving)
    if (!target) return
    const t = setTimeout(() => {
      setWikiProcessing((prev) =>
        prev.map((p) => (p.file === target.file && p.status === 'done' ? { ...p, leaving: true } : p))
      )
    }, 5000)
    return () => clearTimeout(t)
  }, [wikiProcessing])

  // 渐隐过渡结束后移除
  useEffect(() => {
    if (!wikiProcessing.some((p) => p.leaving)) return
    const t = setTimeout(() => {
      setWikiProcessing((prev) => prev.filter((p) => !p.leaving))
    }, 300)
    return () => clearTimeout(t)
  }, [wikiProcessing])

  // 智能跟随：只有停在底部附近时才随新内容滚动；用户上翻阅读时不打扰，改为显示「回到最新」
  const [stuck, setStuck] = useState(true)
  const stuckRef = useRef(true)
  const onMessagesScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD
    stuckRef.current = atBottom
    setStuck(atBottom)
  }
  const scrollToLatest = (smooth = true): void => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    stuckRef.current = true
    setStuck(true)
  }
  useEffect(() => {
    if (stuckRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns])
  // 切换对话直接定位到底部
  useEffect(() => { scrollToLatest(false) }, [conversationId])

  const activeProvider = cfg?.providers.find((p) => p.id === cfg.activeProviderId)

  const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
  const usageTitle = usage
    ? [
        `会话累计：输入 ${usage.prompt} + 输出 ${usage.completion} = ${usage.total} tokens`,
        lastUsage ? `最近一次：输入 ${lastUsage.prompt} + 输出 ${lastUsage.completion} = ${lastUsage.total}` : '',
        usage.estimated ? '注：部分请求接口未返回用量，为本地估算值' : ''
      ]
        .filter(Boolean)
        .join('\n')
    : ''

  const refreshModels = async (): Promise<void> => {
    if (!cfg) return
    try {
      setModels(await window.winagent.fetchModels(cfg.activeProviderId))
    } catch {
      setModels([])
    }
  }
  useEffect(() => {
    setModels([])
    if (cfg) void refreshModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.activeProviderId])

  const switchProvider = async (id: string): Promise<void> => {
    if (!cfg) return
    const next = { ...cfg, activeProviderId: id }
    cfgRef.current = next
    setCfg(next)
    await window.winagent.saveConfig(next)
  }

  const switchModel = async (model: string): Promise<void> => {
    if (!cfg || !activeProvider) return
    const providers = cfg.providers.map((p) => (p.id === cfg.activeProviderId ? { ...p, model } : p))
    const next = { ...cfg, providers }
    cfgRef.current = next
    setCfg(next)
    await window.winagent.saveConfig(next)
  }

  const submit = (): void => {
    const text = input.trim()
    if ((!text && attachments.length === 0) || running || busy || switching) return
    if (text === '/new') {
      setInput('')
      setCreatingTopic(true)
      return
    }
    if (text === '/clear') {
      void reset()
      setInput('')
      return
    }
    if (text === '/compact') {
      void compact()
      setInput('')
      return
    }
    const atts = attachments.length > 0
      ? attachments.map((a) => ({ name: a.name, path: a.path, isImage: a.isImage, dataUrl: a.dataUrl }))
      : undefined
    if (conversationKind === 'topic' && atts?.length) {setScopeNotice('请先将文件导入 Wiki 并添加当前专题标签');return}
    send(text || '请分析这些文件。', atts, { mode: conversationKind === 'topic' ? 'auto' : knowledgeMode, paths: conversationKind === 'topic' ? [] : pinnedKnowledge.map(p=>p.path) })
    setInput('')
    setAttachments([])
    if (taRef.current) taRef.current.style.height = 'auto'
    scrollToLatest()
  }

  /** 选择/拖入/粘贴共用：按磁盘路径读取为附件 */
  const attachPath = async (filePath: string): Promise<void> => {
    try {
      const data = await window.winagent.readFile(filePath)
      setAttachments((prev) => prev.some((a) => a.path && a.path === data.path) ? prev : [...prev, {
        name: data.name,
        path: data.path,
        isImage: data.isImage,
        dataUrl: data.dataUrl,
        textContent: data.textContent
      }])
    } catch (err) {
      setScopeNotice(`读取文件失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const onFileSelect = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = e.target.files
    if (!files) return
    for (const file of Array.from(files)) {
      const filePath = window.winagent.filePath(file)
      if (filePath) await attachPath(filePath)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  /** Ctrl+V：资源管理器复制的文件按路径读取；截图等无路径的图片转 dataURL 直接附上 */
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = Array.from(e.clipboardData.files)
    if (files.length === 0) return
    if (conversationKind === 'topic') { setScopeNotice('专题任务不支持附件：请先将文件导入 Wiki 并添加当前专题标签'); e.preventDefault(); return }
    e.preventDefault()
    for (const file of files) {
      const filePath = window.winagent.filePath(file)
      if (filePath) { void attachPath(filePath); continue }
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () => {
        const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '')
        const ext = file.type.split('/')[1] || 'png'
        setAttachments((prev) => [...prev, { name: `粘贴图片-${stamp}.${ext}`, path: '', isImage: true, dataUrl: String(reader.result) }])
      }
      reader.readAsDataURL(file)
    }
  }

  // ── / 命令菜单 ──
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const slashMatches = /^\/\S*$/.test(input) && !slashDismissed ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(input.toLowerCase())) : []
  const runSlash = (cmd: string): void => {
    setInput('')
    setSlashIndex(0)
    if (cmd === '/new') setCreatingTopic(true)
    else if (cmd === '/clear') void reset()
    else if (cmd === '/compact') void compact()
  }

  const removeAttachment = (idx: number): void => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx))
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const composing = (e.nativeEvent as KeyboardEvent).isComposing
    if (slashMatches.length > 0 && !composing) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = slashMatches.length
        setSlashIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (!running && !busy) runSlash(slashMatches[Math.min(slashIndex, slashMatches.length - 1)].cmd)
        return
      }
      if (e.key === 'Escape') {
        // 标记已处理：全局 Esc（停止生成/朗读）据此跳过
        e.preventDefault()
        setSlashDismissed(true)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !composing) {
      e.preventDefault()
      submit()
    }
  }

  // Esc：弹窗打开时交给弹窗；否则先停止生成，再按一次停止朗读
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (topicMenu || deleteDialog) {
        e.preventDefault()
        setTopicMenu(null)
        setDeleteDialog(null)
        return
      }
      if (confirm) {
        e.preventDefault()
        respondConfirm(false)
        return
      }
      if (showSettings || importDialog || confirmHigh) return
      if (busy) {
        e.preventDefault()
        stop()
        return
      }
      if (speech.state !== 'idle') {
        e.preventDefault()
        speech.stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /** 停止生成：同时掐断语音（Agent 停了，朗读也要停） */
  const stopAll = (): void => {
    stop()
    speech.stop()
  }

  const iconBtn =
    'flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-hover/70 hover:text-accent'

  const openSettings = (tab: TabKey = 'models', autoPickSkills = false): void => {
    setSettingsTab(tab)
    setPickSkills(autoPickSkills)
    setShowSettings(true)
  }

  // 根据对话实时状态计算 AI 动作（vision 按事件类型判定，见 useAgent）
  const aiState: AiState = (() => {
    if (!busy) return 'idle'
    const lastTurn = turns[turns.length - 1]
    if (lastTurn?.toolCalls.some((tc) => tc.running)) return 'tool'
    if (visionActive) return 'vision'
    if (lastTurn?.streaming && lastTurn.content) return 'talk'
    return 'think'
  })()

  const features = [
    { icon: Wrench, title: 'Windows 工具集', desc: '文件、系统、网络、输入、窗口自动化', tab: 'tools' as TabKey },
    { icon: Puzzle, title: 'Skills + MCP', desc: '自定义技能与外部工具动态挂载', tab: 'advanced' as TabKey, pickSkills: true },
    { icon: Server, title: 'OpenAI / Ollama', desc: '云端 API 与本地模型无缝切换', tab: 'models' as TabKey }
  ]

  // 拖放：drag-shim 转发的自定义事件；detail.zone 为落点所在放置区（attach=聊天附件 / 其余=导入知识库）
  const [dropZone, setDropZone] = useState<'attach' | 'wiki' | null>(null)
  const attachAllowed = conversationKind === 'assistant' && !showKnowledge && !showPlugins
  const attachAllowedRef = useRef(attachAllowed)
  attachAllowedRef.current = attachAllowed
  useEffect(() => {
    const onDragEnter = (): void => setDragOver(true)
    const onDragLeave = (): void => { setDragOver(false); setDropZone(null) }
    const onDrop = async (e: Event): Promise<void> => {
      const detail = (e as CustomEvent).detail as { paths: string[]; zone?: string }
      setDragOver(false)
      setDropZone(null)
      const paths = detail.paths
      if (!paths || paths.length === 0) return
      if (detail.zone === 'attach' && attachAllowedRef.current) {
        for (const p of paths) await attachPath(p)
        taRef.current?.focus()
        return
      }
      const dropped: ImportAnalyzeFile[] = paths.map((p) => {
        const name = p.split(/[\\/]/).pop() || p
        return { name, path: p }
      })
      try {
        const tags = await window.winagent.wiki.listAnalysisTags()
        setImportDialog({ files: dropped, tags })
      } catch {
        setImportDialog({ files: dropped, tags: [] })
      }
    }
    window.addEventListener('tauri:dragenter', onDragEnter)
    window.addEventListener('tauri:dragleave', onDragLeave)
    window.addEventListener('tauri:drop', onDrop)
    return () => {
      window.removeEventListener('tauri:dragenter', onDragEnter)
      window.removeEventListener('tauri:dragleave', onDragLeave)
      window.removeEventListener('tauri:drop', onDrop)
    }
  }, [])

  return (
    <div className={`wb-shell ${sidebarCollapsed?'wb-collapsed':''}`}>
      <aside ref={sidebar.element} style={sidebar.style} className="wb-sidebar" aria-label="主导航">
        <div className="wb-brand"><span className="wb-logo"><AppGlyph size={15}/></span><strong>WinAgent</strong><span>{__APP_VERSION__}</span><button title="收起侧栏 Ctrl+B" onClick={()=>setSidebarCollapsed(true)}><PanelLeftClose size={17}/></button></div>
        <button className="wb-new-task" title="新建专题任务 Ctrl+Shift+N" onClick={()=>setCreatingTopic(true)}><Plus size={17}/><span>新建专题任务</span><kbd>Ctrl ⇧ N</kbd></button>
        {creatingTopic&&<form className="wb-topic-form" onSubmit={e=>{e.preventDefault();void submitTopic()}}><input autoFocus aria-label="专题任务名称" placeholder="例如：毕业论文" value={topicDraft} onChange={e=>setTopicDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setCreatingTopic(false);setTopicDraft('')}}}/><button disabled={!topicDraft.trim()} type="submit">创建专题与标签</button><button type="button" onClick={()=>setCreatingTopic(false)}>取消</button></form>}
        <nav className="wb-primary-nav">
          <button aria-current={!showKnowledge&&!showPlugins&&conversationKind==='assistant'?'page':undefined} onClick={()=>void changeConversation('assistant')} title="助理"><Bot size={18}/><span>助理</span>{runningId==='assistant'&&<i className="wb-run-dot" title="正在运行"/>}</button>
          <button aria-current={showPlugins?'page':undefined} onClick={()=>navigate('plugins')} title="Skills 与 MCP"><Puzzle size={18}/><span>Skills 与 MCP</span></button>
          <button aria-current={showKnowledge?'page':undefined} onClick={()=>navigate('wiki')} title="Wiki 知识库"><BookOpen size={18}/><span>Wiki 知识库</span><small>资料与规范</small></button>
        </nav>
        <div className="wb-task-section"><div className="wb-section-label">专题任务<small>{activeTopics.length}</small></div><label className="wb-search"><Search size={14}/><input aria-label="搜索专题任务" placeholder="搜索专题任务" value={taskSearch} onChange={e=>setTaskSearch(e.target.value)}/></label><div className="wb-task-list">{activeTopics.filter(matchesSearch).map(topicItem)}{!topics.length&&<p>新建专题后，在 Wiki 文件上添加对应标签。右键专题可重命名、归档或删除。</p>}{archivedTopics.length>0&&<><button className="wb-archive-toggle" aria-expanded={showArchived} onClick={()=>setShowArchived(s=>!s)}><ChevronRight size={13}/><Archive size={13}/><span>已归档</span><small>{archivedTopics.length}</small></button>{showArchived&&archivedTopics.filter(matchesSearch).map(topicItem)}</>}</div></div>
        <div className="wb-sidebar-footer"><button onClick={()=>openSettings('models')} title="设置"><SettingsIcon size={18}/><span>设置</span></button><span className="wb-local-status"><i/>本地工作区</span></div>
        <div {...sidebar.separator} className="wb-resizer wb-sidebar-resizer" aria-label="调整导航宽度"/>
      </aside>
      <div className="wb-stage">
        <header className="wb-topbar"><button title={sidebarCollapsed?'展开侧栏 Ctrl+B':'收起侧栏 Ctrl+B'} onClick={()=>setSidebarCollapsed(v=>!v)}>{sidebarCollapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}</button><span className="wb-breadcrumb">工作区<ChevronRight size={13}/><strong>{showKnowledge?'Wiki 知识库':showPlugins?'Skills 与 MCP':conversationKind==='topic'?conversations.find(c=>c.id===conversationId)?.title||'专题任务':'助理'}</strong></span><div className="wb-topbar-actions">{status&&<span className="wb-muted wb-status" role="status">{status}</span>}{usage&&usage.total>0&&<span title={usageTitle} className="wb-usage">{usage.estimated?'~':''}{fmtTokens(usage.total)} tokens</span>}<button title={running?'任务运行中，结束后可压缩':'压缩上下文（/compact）'} disabled={running} onClick={()=>void compact()}><Minimize2 size={17}/></button></div></header>
        <main className={`wb-body ${showKnowledge?'wb-reading':''}`}>
          <div className="wb-wiki-page" hidden={!showKnowledge}><ErrorBoundary name="Wiki 知识库" inline><KnowledgeWorkspace selection={knowledgeSelection} topicOptions={conversations.filter(c=>c.kind==='topic')} activeTopicTag={topicTag} onClose={()=>navigate('chat')} onPin={(path,title)=>{void pinKnowledge(path,title)}} onQuote={(text,path,title)=>{void pinKnowledge(path,title).then(allowed=>{if(!allowed)return;setInput(s=>`${s}${s?'\n\n':''}引用《${title}》：\n${text}\n\n`);setTimeout(()=>taRef.current?.focus(),0)})}}/></ErrorBoundary></div>
          {showPlugins&&<ErrorBoundary name="Skills 与 MCP" inline><ToolsWorkspace/></ErrorBoundary>}
          <div className="wb-chat" hidden={showPlugins||showKnowledge}>
            <div className="wb-context">{conversationKind==='topic'?<strong title="只使用带此标签的 Wiki 文件">{topicTag} · 仅使用本专题资料</strong>:<label><BookOpen size={14}/><select aria-label="知识范围" value={knowledgeMode} onChange={e=>setKnowledgeMode(e.target.value as KnowledgeContext['mode'])}><option value="auto">自动检索 Wiki</option><option value="selected" disabled={!pinnedKnowledge.length}>仅固定资料</option><option value="off">关闭知识检索</option></select></label>}<button onClick={()=>navigate('wiki')}><Plus size={13}/>添加资料标签</button>{conversationKind==='assistant'&&pinnedKnowledge.map(p=><span className="wb-context-chip" key={p.path}><button onClick={()=>openKnowledge(p.path)} title="阅读资料">{p.title}</button><button title="移除此资料" onClick={()=>{setPinnedKnowledge(x=>x.filter(n=>n.path!==p.path));if(pinnedKnowledge.length===1)setKnowledgeMode('auto')}}><X size={12}/></button></span>)}{activeRules.map(r=><span key={r.id} className="wb-rule-chip" title={`规范版本 ${r.version}`}>已采用：{r.title} · {r.count} 条</span>)}</div>
            {scopeNotice&&<div role="alert" className="wb-error">{scopeNotice}</div>}
            {knowledgeError&&<div role="alert" className="wb-error">{knowledgeError}</div>}
            <div ref={scrollRef} className="wb-messages" onScroll={onMessagesScroll}>{turns.length===0?<div className="wb-welcome"><div className={`wb-welcome-icon ${skin.avatar?'has-avatar':''}`}>{skin.avatar?<img src={skin.avatar} alt=""/>:<AppGlyph size={28}/>}</div><h1>{conversationKind==='topic'?conversations.find(c=>c.id===conversationId)?.title||'专题任务':'助理'}</h1><p>{conversationKind==='topic'?`仅按「${topicTag}」标签下的 Wiki 文件完成任务。先到 Wiki 给资料加标签。`:'助理可以访问全部 Wiki 内容。描述你想完成的事，或先选择资料。'}</p><div className="wb-starters"><button onClick={()=>navigate('wiki')}><BookOpen size={19}/><strong>基于资料工作</strong><span>阅读、提问与规范写作</span><ArrowUpRight size={14}/></button><button onClick={()=>{setInput(conversationKind==='topic'?'请根据本专题已标记的资料列出写作计划，并标明每条依据。':'请帮我起草一篇论文，先根据 Wiki 中已启用的论文规范列出写作计划。');taRef.current?.focus()}}><FileText size={19}/><strong>写一份文档</strong><span>采用当前聊天可用的规范</span><ArrowUpRight size={14}/></button>{conversationKind==='assistant'&&<button onClick={()=>navigate('plugins')}><Puzzle size={19}/><strong>扩展工作能力</strong><span>Skills、MCP 与本地工具</span><ArrowUpRight size={14}/></button>}</div></div>:<div className="wb-message-list">{turns.map((t,i)=>{const isLast=i===turns.length-1;return <Message key={t.id} turn={t} aiState={aiState} isLast={isLast&&t.role==='assistant'} onRegenerate={isLast&&t.role==='assistant'&&canRegenerate?()=>void regenerate():undefined} voiceOn={!!(cfg?.voice.enabled&&cfg?.voice.apiKey)} onOpenKnowledge={openKnowledge}/>})}</div>}{!stuck&&turns.length>0&&<button className="wb-jump-latest" onClick={()=>scrollToLatest()}><ArrowDown size={14}/>回到最新</button>}</div>
      {/* ================= 输入区 ================= */}
      <div className="wb-composer mx-auto w-full max-w-3xl px-4 pb-4">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((att, i) => (
              <div
                key={i}
                className="group flex items-center gap-2.5 rounded-xl border border-border bg-panel/80 py-1.5 pl-1.5 pr-2 shadow-card backdrop-blur"
              >
                {att.isImage && att.dataUrl ? (
                  <img src={att.dataUrl} alt={att.name} className="h-8 w-8 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10">
                    {att.isImage ? <ImageIcon className="h-4 w-4 text-accent" /> : <FileText className="h-4 w-4 text-accent" />}
                  </div>
                )}
                <span className="max-w-36 truncate text-xs text-text-secondary">{att.name}</span>
                <button
                  onClick={() => removeAttachment(i)}
                  className="rounded-md p-0.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 后台任务提示：Agent 单任务，别的对话在跑时本对话可起草但不能发送 */}
        {running&&runningId!==conversationId&&<div className="wb-bg-notice" role="status"><Loader2 size={13} className="animate-spin"/><span>「{runningId==='assistant'?'助理':conversations.find(c=>c.id===runningId)?.title||'任务'}」正在后台运行，完成后即可发送</span><button onClick={()=>void changeConversation(runningId)}>查看</button></div>}
        <div className="wb-composer-box">
          {slashMatches.length > 0 && (
            <div className="wb-slash-menu" role="listbox" aria-label="命令">
              {slashMatches.map((c, i) => (
                <button
                  key={c.cmd}
                  role="option"
                  aria-selected={i === Math.min(slashIndex, slashMatches.length - 1)}
                  disabled={running || busy}
                  onMouseEnter={() => setSlashIndex(i)}
                  onMouseDown={(e) => { e.preventDefault(); runSlash(c.cmd) }}
                >
                  <code>{c.cmd}</code>
                  <span>{c.desc}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            className="max-h-40 w-full resize-none bg-transparent px-4 pt-3.5 text-sm leading-relaxed text-text outline-none placeholder:text-muted"
            rows={1}
            placeholder={conversationKind==='topic'?'根据已标记的专题资料描述任务，输入 / 查看命令…':'描述任务，输入 / 查看命令，可拖入或粘贴文件…'}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setSlashDismissed(false)
              setSlashIndex(0)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          <div className="flex items-center gap-2 px-3 pb-2.5">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept="image/*,.pdf,.docx,.xlsx,.pptx,.txt,.md,.json,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.h,.css,.html,.xml,.yml,.yaml,.csv,.log,.sh,.bat"
              onChange={onFileSelect}
            />
            {conversationKind==='assistant'&&<button
              title="添加文件或图片（也可拖入或 Ctrl+V 粘贴）"
              aria-label="添加文件或图片"
              onClick={() => fileInputRef.current?.click()}
              className="wb-composer-icon"
            >
              <Plus className="h-4 w-4" />
            </button>}
            <div className="wb-model-controls"><select aria-label="当前服务商" disabled={running} value={cfg?.activeProviderId || ''} onChange={e=>void switchProvider(e.target.value)}>{cfg?.providers.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select><input aria-label="当前模型" disabled={running} value={activeProvider?.model || ''} list="workbench-models" placeholder="选择模型" onChange={e=>void switchModel(e.target.value)}/><datalist id="workbench-models">{models.map(m=><option key={m} value={m}/>)}</datalist><button title="拉取模型列表" aria-label="拉取模型列表" onClick={refreshModels}><RefreshCw size={13}/></button></div>
            <div className="ml-auto">
              {busy ? (
                <button onClick={stopAll} title="停止生成（Esc）" aria-label="停止生成" className="wb-send is-stop">
                  <Square className="h-3 w-3" fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={submit}
                  title={running ? '另一个任务正在后台运行' : '发送（Enter）'}
                  aria-label="发送消息"
                  disabled={running || switching || (!input.trim() && attachments.length === 0)}
                  className="wb-send"
                >
                  <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
          </div>
        </main>
      </div>

    {/* 全局语音控制条（朗读中/暂停/错误时浮现） */}
    <SpeechBar />

    {/* 专题右键菜单：透明底层接住外部点击/右键以关闭；方向键在菜单项间移动 */}
    {topicMenu && (() => {
      const t = topics.find((c) => c.id === topicMenu.id)
      if (!t) return null
      const locked = t.id === runningId
      return (
        <>
          <div className="wb-menu-backdrop" onMouseDown={() => setTopicMenu(null)} onContextMenu={(e) => { e.preventDefault(); setTopicMenu(null) }} />
          <div
            className="wb-context-menu"
            role="menu"
            aria-label={`专题「${t.title}」操作`}
            style={{ left: topicMenu.x, top: topicMenu.y }}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
              e.preventDefault()
              const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)'))
              const i = items.indexOf(document.activeElement as HTMLButtonElement)
              items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
            }}
          >
            <button role="menuitem" autoFocus disabled={locked} onClick={() => startRename(t.id)}><Pencil size={14} />重命名</button>
            <button role="menuitem" onClick={() => void toggleArchive(t.id, !t.archived)}>
              {t.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              {t.archived ? '取消归档' : '归档'}
            </button>
            <hr />
            <button role="menuitem" className="is-destructive" disabled={locked} onClick={() => askDelete(t.id)}><Trash2 size={14} />删除…</button>
            {locked && <p>正在运行，完成后才能重命名或删除</p>}
          </div>
        </>
      )
    })()}

    {/* 删除专题确认：带该专题标签的 Wiki 文件由用户决定是否一并移除标签 */}
    {deleteDialog && (
      <div className="wb-modal-backdrop" role="presentation">
        <div className="wb-alert" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-desc">
          <div className="wb-alert-icon is-danger"><Trash2 size={21} /></div>
          <h3 id="delete-title">删除专题「{deleteDialog.title}」？</h3>
          <p id="delete-desc">
            对话记录会被永久删除，无法恢复。
            {deleteDialog.wikiFiles === null
              ? '正在统计 Wiki 中的相关文件…'
              : deleteDialog.wikiFiles > 0
                ? <>Wiki 中有 {deleteDialog.wikiFiles} 个文件带有 <code>{deleteDialog.tag}</code> 标签，是否一并移除？文件本身不会被删除。</>
                : 'Wiki 中没有文件带有此专题标签。'}
          </p>
          <div className="wb-alert-actions is-stacked">
            {!!deleteDialog.wikiFiles && (
              <button className="is-destructive" onClick={() => void confirmDelete(true)}>删除并移除 Wiki 标签</button>
            )}
            <button
              className={deleteDialog.wikiFiles ? '' : 'is-destructive'}
              disabled={deleteDialog.wikiFiles === null}
              onClick={() => void confirmDelete(false)}
            >
              {deleteDialog.wikiFiles ? '删除，保留 Wiki 标签' : '删除'}
            </button>
            <button autoFocus onClick={() => setDeleteDialog(null)}>取消 <kbd>Esc</kbd></button>
          </div>
        </div>
      </div>
    )}

    {toast && <div className={`wb-toast ${toast.error ? 'is-error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.text}</div>}

    {/* 拖放遮罩：左「作为附件发送」/ 右「导入知识库」；落点由 drag-shim 按 data-drop-zone 判定 */}
    {dragOver && (
      <div className="wb-drop-overlay">
        <div
          data-drop-zone="attach"
          className={`wb-drop-zone ${dropZone === 'attach' ? 'is-over' : ''} ${attachAllowed ? '' : 'is-disabled'}`}
          onDragOver={() => setDropZone('attach')}
        >
          <Paperclip size={30} strokeWidth={1.6} />
          <strong>作为附件发送</strong>
          <span>{attachAllowed ? '附加到当前「助理」对话的输入框' : conversationKind === 'topic' ? '专题任务不支持附件，请导入知识库' : '回到对话后可作为附件'}</span>
        </div>
        <div
          data-drop-zone="wiki"
          className={`wb-drop-zone ${dropZone === 'wiki' ? 'is-over' : ''}`}
          onDragOver={() => setDropZone('wiki')}
        >
          <Library size={30} strokeWidth={1.6} />
          <strong>导入知识库</strong>
          <span>确认分析要求后，由 AI 编译进 Wiki</span>
        </div>
      </div>
    )}

    {/* 知识库处理进度提示 */}
    {wikiProcessing.length > 0 && (
      <div className="fixed bottom-20 right-4 z-50 w-72 space-y-2">
        {wikiProcessing.map((p, i) => (
          <div
            key={i}
            className={`rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur transition-all duration-300 ${
              p.leaving ? 'translate-y-2 opacity-0' : 'opacity-100'
            } ${
              p.status === 'done'
                ? 'border-success/30 bg-success/10 text-success'
                : p.status === 'error'
                  ? 'border-danger/30 bg-danger/10 text-danger'
                  : 'border-accent/20 bg-panel/95 text-text'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                {p.status === 'processing' && (
                  <>
                    <span className="font-medium">{p.stage || '正在分析'}</span>
                    <span className="ml-1 text-xs opacity-70">{p.file}</span>
                  </>
                )}
                {p.status === 'done' && `✓ ${p.message}`}
                {p.status === 'error' && `✗ ${p.file}: ${p.message}`}
              </span>
              <button
                onClick={() => setWikiProcessing((prev) => prev.filter((_, j) => j !== i))}
                className="shrink-0 text-muted hover:text-text"
              >
                <X className="inline h-3 w-3" />
              </button>
            </div>
            {/* 进度条 */}
            {p.status === 'processing' && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-accent/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-accent2 transition-all duration-300"
                  style={{ width: `${Math.max(p.progress ?? 0, 4)}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    )}

      {/* ================= 设置弹窗 ================= */}
      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onSaved={(saved) => {
            cfgRef.current = saved
            setCfg(saved)
            setShowSettings(false)
          }}
          initialTab={settingsTab}
          pickSkillsOnMount={pickSkills}
        />
      )}

      {/* ================= confidence high 确认（概念 5+ 来源，共享组件） ================= */}
      {confirmHigh && (
        <ConfirmHighDialog
          items={confirmHigh}
          onClose={() => setConfirmHigh(null)}
          onDone={() => {
            setWikiProcessing((prev) => [
              ...prev,
              { file: 'confidence', status: 'done', message: 'high 确认已处理' }
            ])
            setConfirmHigh(null)
          }}
        />
      )}

      {/* ================= 拖入文件 → 分析要求弹窗 ================= */}
      {importDialog && (
        <ImportAnalyzeDialog
          files={importDialog.files}
          tags={importDialog.tags}
          onClose={() => setImportDialog(null)}
          onDone={(r) => {
            setImportDialog(null)
            if (r.confirmHigh?.length) setConfirmHigh(r.confirmHigh)
          }}
        />
      )}

      {/* ================= 危险操作确认（Esc 拒绝；默认焦点在「拒绝」，误按 Enter 也不会放行） ================= */}
      {confirm && (
        <div className="wb-modal-backdrop" role="presentation">
          <div className="wb-alert" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-desc">
            <div className="wb-alert-icon"><AlertTriangle size={22} /></div>
            <h3 id="confirm-title">允许执行此操作？</h3>
            <p id="confirm-desc">
              工具 <code>{confirm.name}</code> 即将执行
              {running && runningId !== conversationId && <>（来自后台任务「{runningId === 'assistant' ? '助理' : conversations.find((c) => c.id === runningId)?.title || '任务'}」）</>}：
            </p>
            <pre>
              {(() => {
                try {
                  return JSON.stringify(JSON.parse(confirm.args), null, 2)
                } catch {
                  return confirm.args
                }
              })()}
            </pre>
            <div className="wb-alert-actions">
              <button autoFocus onClick={() => respondConfirm(false)}>
                拒绝 <kbd>Esc</kbd>
              </button>
              <button className="is-destructive" onClick={() => respondConfirm(true)}>
                允许执行
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App(): JSX.Element {
  // SpeechProvider 包住整个主窗口：气泡朗读 / 自动朗读 / Agent 开口 / 试听共用同一状态机
  return (
    <SpeechProvider>
      <AppShell />
    </SpeechProvider>
  )
}
