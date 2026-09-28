import { useEffect, useRef, useState } from 'react'
import {
  Bot,
  Settings as SettingsIcon,
  Send,
  Square,
  Trash2,
  Minimize2,
  RefreshCw,
  AlertTriangle,
  Plus,
  X,
  FileText,
  ImageIcon,
  Wrench,
  Puzzle,
  Server,
  BookOpen,
  Sparkles
  , PanelLeftClose, PanelLeftOpen, MessageSquare, Search, ChevronRight, ArrowUpRight, Columns2
} from 'lucide-react'
import type { AppConfig, AnalysisTag, KnowledgeContext } from '../../shared/types'
import KnowledgeWorkspace, { type KnowledgeSelection } from './components/wiki/KnowledgeWorkspace'
import ErrorBoundary from './components/ErrorBoundary'
import ToolsWorkspace from './components/workbench/ToolsWorkspace'
import { useResizablePane } from './components/workbench/useResizablePane'
import './components/workbench/workbench.css'
import { useAgent } from './lib/useAgent'
import { SpeechProvider, useSpeech } from './lib/useSpeech'
import SpeechBar from './components/SpeechBar'
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

function AppShell(): JSX.Element {
  const speech = useSpeech()
  const skin = useSkin()
  const { turns, busy, status, confirm, usage, lastUsage, visionActive, activeRules, knowledgeError, send, stop, reset, compact, respondConfirm, conversations, conversationId, conversationKind, topicTag, switchConversation, createTopic, setDraftContext } = useAgent({
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
      if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='n'){e.preventDefault();if(!busy)setCreatingTopic(true)}
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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns])

  // Esc 停止朗读（Agent 生成由「停止生成」按钮控制）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && speech.state !== 'idle') {
        e.stopPropagation()
        speech.stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [speech])

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
    if ((!text && attachments.length === 0) || busy) return
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
  }

  const onFileSelect = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = e.target.files
    if (!files) return
    for (const file of Array.from(files)) {
      const filePath = window.winagent.filePath(file)
      if (!filePath) continue
      try {
        const data = await window.winagent.readFile(filePath)
        setAttachments((prev) => [...prev, {
          name: data.name,
          path: data.path,
          isImage: data.isImage,
          dataUrl: data.dataUrl,
          textContent: data.textContent
        }])
      } catch (err) {
        console.error('读取文件失败:', err)
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeAttachment = (idx: number): void => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx))
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as KeyboardEvent).isComposing) {
      e.preventDefault()
      submit()
    }
  }

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

  // Tauri 拖拽：监听原生 onDragDropEvent 转发的自定义事件
  useEffect(() => {
    const onDragEnter = (): void => setDragOver(true)
    const onDragLeave = (): void => setDragOver(false)
    const onDrop = async (e: Event): Promise<void> => {
      const detail = (e as CustomEvent).detail as { paths: string[] }
      setDragOver(false)
      const paths = detail.paths
      if (!paths || paths.length === 0) return
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
        <div className="wb-brand"><Bot size={21}/><strong>WinAgent</strong><span>0.5.0</span><button title="收起侧栏 Ctrl+B" onClick={()=>setSidebarCollapsed(true)}><PanelLeftClose size={17}/></button></div>
        <button className="wb-new-task" title="新建专题任务 Ctrl+Shift+N" disabled={busy} onClick={()=>setCreatingTopic(true)}><Plus size={17}/><span>新建专题任务</span><kbd>Ctrl ⇧ N</kbd></button>
        {creatingTopic&&<form className="wb-topic-form" onSubmit={e=>{e.preventDefault();void submitTopic()}}><input autoFocus aria-label="专题任务名称" placeholder="例如：毕业论文" value={topicDraft} onChange={e=>setTopicDraft(e.target.value)}/><button disabled={busy||!topicDraft.trim()} type="submit">创建专题与标签</button><button type="button" onClick={()=>setCreatingTopic(false)}>取消</button></form>}
        <nav className="wb-primary-nav">
          <button aria-current={!showKnowledge&&!showPlugins&&conversationKind==='assistant'?'page':undefined} onClick={()=>void changeConversation('assistant')} title="助理"><Bot size={18}/><span>助理</span></button>
          <button aria-current={!showKnowledge&&!showPlugins&&conversationKind==='topic'?'page':undefined} onClick={()=>{const first=conversations.find(c=>c.kind==='topic');if(first)void changeConversation(first.id);else setCreatingTopic(true)}} title="专题任务"><MessageSquare size={18}/><span>专题任务</span><small>{conversations.filter(c=>c.kind==='topic').length}</small></button>
          <button aria-current={showPlugins?'page':undefined} onClick={()=>navigate('plugins')} title="Skills 与 MCP"><Puzzle size={18}/><span>Skills 与 MCP</span></button>
          <button aria-current={showKnowledge?'page':undefined} onClick={()=>navigate('wiki')} title="Wiki 知识库"><BookOpen size={18}/><span>Wiki 知识库</span><small>资料与规范</small></button>
        </nav>
        <div className="wb-task-section"><div className="wb-section-label">专题任务</div><label className="wb-search"><Search size={14}/><input aria-label="搜索专题任务" placeholder="搜索专题任务" value={taskSearch} onChange={e=>setTaskSearch(e.target.value)}/></label><div className="wb-task-list">{conversations.filter(c=>c.kind==='topic'&&c.title.toLowerCase().includes(taskSearch.toLowerCase())).map(c=><button key={c.id} disabled={busy} className={c.id===conversationId?'is-active':''} title={`${c.title} · ${c.topicTag}`} onClick={()=>void changeConversation(c.id)}><MessageSquare size={14}/><span>{c.title}</span></button>)}{!conversations.some(c=>c.kind==='topic')&&<p>新建专题后，在 Wiki 文件上添加对应标签。</p>}</div></div>
        <div className="wb-sidebar-footer"><button onClick={()=>openSettings('models')} title="设置"><SettingsIcon size={18}/><span>设置</span></button><span className="wb-local-status"><i/>本地工作区</span></div>
        <div {...sidebar.separator} className="wb-resizer wb-sidebar-resizer" aria-label="调整导航宽度"/>
      </aside>
      <div className="wb-stage">
        <header className="wb-topbar"><button title={sidebarCollapsed?'展开侧栏 Ctrl+B':'收起侧栏 Ctrl+B'} onClick={()=>setSidebarCollapsed(v=>!v)}>{sidebarCollapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}</button><span className="wb-breadcrumb">工作区<ChevronRight size={13}/><strong>{showKnowledge?'Wiki 知识库':showPlugins?'Skills 与 MCP':conversationKind==='topic'?conversations.find(c=>c.id===conversationId)?.title||'专题任务':'助理'}</strong></span><div className="wb-topbar-actions">{status&&<span className="wb-muted wb-status" role="status">{status}</span>}{usage&&usage.total>0&&<span title={usageTitle} className="wb-usage">{usage.estimated?'~':''}{fmtTokens(usage.total)} tokens</span>}<button title="压缩上下文" disabled={busy} onClick={compact}><Minimize2 size={17}/></button><button title="设置" onClick={()=>openSettings()}><SettingsIcon size={17}/></button></div></header>
        <main className={`wb-body ${showKnowledge?'wb-reading':''}`}>
          <div className="wb-wiki-page" hidden={!showKnowledge}><ErrorBoundary name="Wiki 知识库" inline><KnowledgeWorkspace selection={knowledgeSelection} topicOptions={conversations.filter(c=>c.kind==='topic')} activeTopicTag={topicTag} onClose={()=>navigate('chat')} onPin={(path,title)=>{void pinKnowledge(path,title)}} onQuote={(text,path,title)=>{void pinKnowledge(path,title).then(allowed=>{if(!allowed)return;setInput(s=>`${s}${s?'\n\n':''}引用《${title}》：\n${text}\n\n`);setTimeout(()=>taRef.current?.focus(),0)})}}/></ErrorBoundary></div>
          {showPlugins&&<ErrorBoundary name="Skills 与 MCP" inline><ToolsWorkspace/></ErrorBoundary>}
          <div className="wb-chat" hidden={showPlugins||showKnowledge}>
            <div className="wb-context">{conversationKind==='topic'?<strong title="只使用带此标签的 Wiki 文件">{topicTag} · 仅使用本专题资料</strong>:<label><BookOpen size={14}/><select aria-label="知识范围" value={knowledgeMode} onChange={e=>setKnowledgeMode(e.target.value as KnowledgeContext['mode'])}><option value="auto">自动检索 Wiki</option><option value="selected" disabled={!pinnedKnowledge.length}>仅固定资料</option><option value="off">关闭知识检索</option></select></label>}<button onClick={()=>navigate('wiki')}><Plus size={13}/>添加资料标签</button>{conversationKind==='assistant'&&pinnedKnowledge.map(p=><span className="wb-context-chip" key={p.path}><button onClick={()=>openKnowledge(p.path)} title="阅读资料">{p.title}</button><button title="移除此资料" onClick={()=>{setPinnedKnowledge(x=>x.filter(n=>n.path!==p.path));if(pinnedKnowledge.length===1)setKnowledgeMode('auto')}}><X size={12}/></button></span>)}{activeRules.map(r=><span key={r.id} className="wb-rule-chip" title={`规范版本 ${r.version}`}>已采用：{r.title} · {r.count} 条</span>)}</div>
            {scopeNotice&&<div role="alert" className="wb-error">{scopeNotice}</div>}
            {knowledgeError&&<div role="alert" className="wb-error">{knowledgeError}</div>}
            <div ref={scrollRef} className="wb-messages">{turns.length===0?<div className="wb-welcome"><div className="wb-welcome-icon">{skin.avatar?<img src={skin.avatar} alt=""/>:<Bot size={26}/>}</div><h1>{conversationKind==='topic'?conversations.find(c=>c.id===conversationId)?.title||'专题任务':'助理'}</h1><p>{conversationKind==='topic'?`仅按「${topicTag}」标签下的 Wiki 文件完成任务。先到 Wiki 给资料加标签。`:'助理可以访问全部 Wiki 内容。描述你想完成的事，或先选择资料。'}</p><div className="wb-starters"><button onClick={()=>navigate('wiki')}><BookOpen size={19}/><strong>基于资料工作</strong><span>阅读、提问与规范写作</span><ArrowUpRight size={14}/></button><button onClick={()=>{setInput(conversationKind==='topic'?'请根据本专题已标记的资料列出写作计划，并标明每条依据。':'请帮我起草一篇论文，先根据 Wiki 中已启用的论文规范列出写作计划。');taRef.current?.focus()}}><FileText size={19}/><strong>写一份文档</strong><span>采用当前聊天可用的规范</span><ArrowUpRight size={14}/></button>{conversationKind==='assistant'&&<button onClick={()=>navigate('plugins')}><Puzzle size={19}/><strong>扩展工作能力</strong><span>Skills、MCP 与本地工具</span><ArrowUpRight size={14}/></button>}</div></div>:<div className="wb-message-list">{turns.map(t=><Message key={t.id} turn={t} aiState={aiState} voiceOn={!!(cfg?.voice.enabled&&cfg?.voice.apiKey)} onOpenKnowledge={openKnowledge}/>)}</div>}</div>
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

        <div className="wb-composer-box">
          <textarea
            ref={taRef}
            className="max-h-40 w-full resize-none bg-transparent px-4 pt-3.5 text-sm leading-relaxed text-text outline-none placeholder:text-muted"
            rows={1}
            placeholder={conversationKind==='topic'?'根据已标记的专题资料描述任务…':'描述任务，@ 引用规范，或添加文件…'}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
            }}
            onKeyDown={onKeyDown}
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
              title="添加文件或图片"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-hover/70 hover:text-accent"
            >
              <Plus className="h-4 w-4" />
            </button>}
            <div className="wb-model-controls"><select aria-label="当前服务商" disabled={busy} value={cfg?.activeProviderId || ''} onChange={e=>void switchProvider(e.target.value)}>{cfg?.providers.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select><input aria-label="当前模型" disabled={busy} value={activeProvider?.model || ''} list="workbench-models" placeholder="选择模型" onChange={e=>void switchModel(e.target.value)}/><datalist id="workbench-models">{models.map(m=><option key={m} value={m}/>)}</datalist><button title="拉取模型列表" onClick={refreshModels}><RefreshCw size={13}/></button></div>
            <div className="ml-auto">
              {busy ? (
                <button
                  onClick={stopAll}
                  title="停止生成"
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-danger text-white shadow-lg shadow-danger/40 transition-all hover:bg-danger/90"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  onClick={submit}
                  title="发送消息"
                  disabled={busy || (!input.trim() && attachments.length === 0)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent2 text-accent-fg shadow-glow transition-all hover:opacity-90 disabled:opacity-30 disabled:shadow-none"
                >
                  <Send className="h-4 w-4" />
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

    {/* 拖拽导入遮罩 */}
    {dragOver && (
      <div
        className="wiki-drop-overlay"
      >
        <div className="text-center">
          <div className="mb-3 text-5xl">📥</div>
          <div className="text-xl font-semibold text-white">释放文件以导入到知识库</div>
          <div className="mt-2 text-sm text-white/60">将弹出分析要求确认，AI 编译并定制分析</div>
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

      {/* ================= 危险操作确认 ================= */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-panel p-5 shadow-2xl">
            <div className="mb-3 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning/15">
                <AlertTriangle className="h-5 w-5 text-warning" />
              </div>
              <h3 className="text-[15px] font-semibold text-text">确认执行危险操作</h3>
            </div>
            <p className="mb-2 text-sm text-text-secondary">
              工具 <span className="rounded-md bg-accent/10 px-1.5 py-0.5 font-mono text-[13px] text-accent">{confirm.name}</span>{' '}
              即将执行：
            </p>
            <pre className="mb-4 max-h-48 overflow-auto rounded-xl border border-border bg-surface/50 p-3 font-mono text-xs leading-relaxed text-text-secondary">
              {(() => {
                try {
                  return JSON.stringify(JSON.parse(confirm.args), null, 2)
                } catch {
                  return confirm.args
                }
              })()}
            </pre>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => respondConfirm(false)}
                className="rounded-lg border border-border px-4 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface"
              >
                拒绝
              </button>
              <button
                onClick={() => respondConfirm(true)}
                className="rounded-lg bg-gradient-to-br from-warning to-accent2 px-4 py-1.5 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
              >
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
