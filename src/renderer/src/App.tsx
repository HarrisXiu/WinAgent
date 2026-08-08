import { useEffect, useRef, useState } from 'react'
import {
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
  BookOpen
} from 'lucide-react'
import type { AppConfig, ChatMode } from '../../shared/types'
import { useAgent } from './lib/useAgent'
import Message from './components/Message'
import Settings, { type TabKey } from './components/Settings'
import ConfirmHighDialog, { type ConfirmHighItem } from './components/wiki/ConfirmHighDialog'
import avatarImg from './assets/angelina/avatar.png'
import zuozuoGif from './assets/angelina/zuozuo.gif'
import kanshuGif from './assets/angelina/kanshu.gif'
import tanxianGif from './assets/angelina/tanxian.gif'
import paizhaoGif from './assets/angelina/paizhao.gif'
import cloudImg from './assets/angelina/cloud.png'
import wandImg from './assets/angelina/wand.png'
import bubbleImg from './assets/angelina/bubble.png'
import heartImg from './assets/angelina/heart.png'

/** Angelina 实时状态：空闲 / 思考 / 执行工具 / 图片识别 / 回答中 */
export type AiState = 'idle' | 'think' | 'tool' | 'vision' | 'talk'
export const AI_STATE_GIF: Record<AiState, string> = {
  idle: zuozuoGif,
  think: kanshuGif,
  tool: tanxianGif,
  vision: paizhaoGif,
  talk: zuozuoGif
}
export const AI_STATE_LABEL: Record<AiState, string> = {
  idle: '待命中',
  think: '思考中',
  tool: '执行工具中',
  vision: '识别图片中',
  talk: '回答中'
}

interface PendingAttachment {
  name: string
  path: string
  isImage: boolean
  dataUrl?: string
  textContent?: string
}

export default function App(): JSX.Element {
  const { turns, busy, status, confirm, usage, lastUsage, send, stop, reset, compact, respondConfirm } = useAgent()
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<TabKey>('models')
  const [pickSkills, setPickSkills] = useState(false)
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  // 知识库独立窗口 + 拖拽处理
  const [dragOver, setDragOver] = useState(false)
  const [wikiProcessing, setWikiProcessing] = useState<Array<{ file: string; status: 'processing' | 'done' | 'error'; message?: string; progress?: number; stage?: string }>>([])
  // confidence high 用户确认（概念 5+ 来源，独立窗口与主窗口共用组件）
  const [confirmHigh, setConfirmHigh] = useState<ConfirmHighItem[] | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadCfg = (): void => {
    window.winagent.getConfig().then(setCfg)
  }
  useEffect(loadCfg, [])

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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns])

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
    setCfg(next)
    await window.winagent.saveConfig(next)
  }

  const switchModel = async (model: string): Promise<void> => {
    if (!cfg || !activeProvider) return
    const providers = cfg.providers.map((p) => (p.id === cfg.activeProviderId ? { ...p, model } : p))
    const next = { ...cfg, providers }
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
    send(text || '请分析这些文件。', atts)
    setInput('')
    setAttachments([])
    if (taRef.current) taRef.current.style.height = 'auto'
  }

  const onFileSelect = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = e.target.files
    if (!files) return
    for (const file of Array.from(files)) {
      const filePath = (file as any).path || file.name
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const iconBtn =
    'flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-pink-100/70 hover:text-accent'

  const openSettings = (tab: TabKey = 'models', autoPickSkills = false): void => {
    setSettingsTab(tab)
    setPickSkills(autoPickSkills)
    setShowSettings(true)
  }

  // 根据对话实时状态计算 Angelina 动作
  const aiState: AiState = (() => {
    if (!busy) return 'idle'
    const lastTurn = turns[turns.length - 1]
    if (lastTurn?.toolCalls.some((tc) => tc.running)) return 'tool'
    if (/视觉|识别/.test(status)) return 'vision'
    if (lastTurn?.streaming && lastTurn.content) return 'talk'
    return 'think'
  })()

  const features = [
    { icon: Wrench, title: 'Windows 工具集', desc: '文件、系统、网络、输入、窗口自动化', tab: 'tools' as TabKey },
    { icon: Puzzle, title: 'Skills + MCP', desc: '自定义技能与外部工具动态挂载', tab: 'advanced' as TabKey, pickSkills: true },
    { icon: Server, title: 'OpenAI / Ollama', desc: '云端 API 与本地模型无缝切换', tab: 'models' as TabKey }
  ]

  // 全局拖拽导入到知识库（AI 自动处理）
  const handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const files = e.dataTransfer.files
    if (!files || files.length === 0) return
    for (const file of Array.from(files)) {
      const filePath = (file as any).path
      if (!filePath) continue
      setWikiProcessing((prev) => [...prev, { file: file.name, status: 'processing', progress: 0 }])
      try {
        const relPath = await window.winagent.wiki.importFile(filePath)
        // 所有源文件立即触发 INGEST（md/txt/pdf 分析内容，图片创建基础来源页）
        const result = await window.winagent.wiki.ingest(relPath)
        const total = result.created.length + result.updated.length
        setWikiProcessing((prev) =>
          prev.map((p) =>
            p.file === file.name
              ? { ...p, status: 'done', progress: 100, message: `已编译: ${total} 个页面 (${result.sourcePath})` }
              : p
          )
        )
        // 开放问题匹配提示
        if (result.answeredQuestions && result.answeredQuestions.length > 0) {
          setWikiProcessing((prev) => [
            ...prev,
            {
              file: '📌 问题匹配',
              status: 'done',
              message: `此来源回答了开放问题: ${result.answeredQuestions!.join('；')}`
            }
          ])
        }
        // confidence high 确认请求（5+ 来源概念）
        if (result.confirmHigh?.length) {
          setConfirmHigh(
            result.confirmHigh.map((c) => ({ slug: c.slug, title: c.title, sourceCount: c.sourceCount }))
          )
        }
      } catch (err: any) {
        setWikiProcessing((prev) =>
          prev.map((p) => (p.file === file.name ? { ...p, status: 'error', message: err.message || '导入失败' } : p))
        )
      }
    }
  }

  return (
    <div
      className="flex h-full flex-col bg-bg"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }}
      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (e.currentTarget === e.target) setDragOver(false) }}
      onDrop={handleDrop}
    >
      {/* ================= 顶栏 ================= */}
      <header className="relative z-10 flex items-center gap-2.5 border-b border-border bg-white/70 px-4 py-2 backdrop-blur">
        <div className="mr-1.5 flex items-center gap-2.5">
          <img src={avatarImg} alt="Angelina" className="h-8 w-8 rounded-full object-cover shadow-glow" />
          <span className="text-[15px] font-semibold tracking-tight text-gray-700">
            Win
            <span className="bg-gradient-to-r from-accent to-accent2 bg-clip-text text-transparent">Agent</span>
          </span>
        </div>

        <select
          className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-[13px] text-gray-700"
          value={cfg?.activeProviderId || ''}
          onChange={(e) => switchProvider(e.target.value)}
        >
          {cfg?.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <input
            className="w-52 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[13px] text-gray-700"
            value={activeProvider?.model || ''}
            list="topbar-models"
            placeholder="模型"
            onChange={(e) => switchModel(e.target.value)}
          />
          <datalist id="topbar-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button title="拉取模型列表" onClick={refreshModels} className={iconBtn}>
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {/* 模式已合并：桌宠（含 Agent 全部能力） */}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            title="知识库浏览器（弹出独立窗口）"
            onClick={() => window.winagent.wiki.openWindow()}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-pink-100/70 hover:text-accent"
          >
            <BookOpen className="h-4 w-4" />
          </button>
          {status && (
            <span className="max-w-56 truncate text-xs text-muted">{status}</span>
          )}
          {usage && usage.total > 0 && (
            <span
              title={usageTitle}
              className="cursor-default rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent"
            >
              {usage.estimated ? '~' : ''}
              {fmtTokens(usage.total)} tokens
            </span>
          )}
          <button title="压缩上下文" onClick={compact} className={iconBtn}>
            <Minimize2 className="h-4 w-4" />
          </button>
          <button title="清空对话" onClick={reset} className={iconBtn}>
            <Trash2 className="h-4 w-4" />
          </button>
          <button title="设置" onClick={() => openSettings()} className={iconBtn}>
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ================= 主区域：左侧立绘 + 右侧对话 ================= */}
        <div className="flex min-h-0 flex-1">
        {/* 左侧：Angelina 大立绘，实时随对话状态切换 */}
        {turns.length > 0 && (
          <aside className="flex w-52 shrink-0 flex-col items-center border-r border-border/60 bg-white/40 py-6 backdrop-blur">
            <div className="relative">
              <div className="absolute inset-8 rounded-full bg-gradient-to-br from-accent/25 to-accent2/25 blur-2xl" />
              <img
                src={AI_STATE_GIF[aiState]}
                alt="Angelina"
                className="relative h-44 w-44 object-contain drop-shadow-xl"
              />
              <img src={bubbleImg} alt="" className="absolute -left-7 top-3 h-9 w-9 animate-bounce object-contain" />
              <img src={heartImg} alt="" className="absolute -right-5 top-8 h-6 w-6 animate-pulse object-contain" />
              <img src={cloudImg} alt="" className="absolute -left-8 bottom-2 h-8 w-8 object-contain opacity-90" />
            </div>

            <div className="mt-4 flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-400" />
              </span>
              <span className="text-sm font-semibold text-gray-700">Angelina</span>
            </div>

            <div className="mt-2.5 flex items-center gap-2 rounded-full border border-border bg-white/80 px-3.5 py-1.5 shadow-card">
              {aiState === 'idle' ? (
                <span className="text-xs text-muted">待命中</span>
              ) : (
                <>
                  <span className="flex gap-0.5">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:300ms]" />
                  </span>
                  <span className="text-xs font-medium text-accent">{AI_STATE_LABEL[aiState]}</span>
                </>
              )}
            </div>
          </aside>
        )}

        {/* 右侧：消息 + 输入 */}
        <div className="flex min-w-0 flex-1 flex-col">
      {/* ================= 消息区 ================= */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {turns.length === 0 ? (
          <div className="relative flex h-full flex-col items-center justify-center text-center">
            {/* 角色动图 + 漂浮装饰 */}
            <div className="relative mb-3">
              <div className="absolute inset-4 rounded-full bg-gradient-to-br from-accent/30 to-accent2/30 blur-2xl" />
              <img src={zuozuoGif} alt="Angelina" className="relative h-52 w-52 object-contain drop-shadow-xl" />
              <img src={bubbleImg} alt="" className="absolute -left-12 top-3 h-10 w-10 animate-bounce object-contain" />
              <img src={heartImg} alt="" className="absolute -right-9 top-8 h-7 w-7 animate-pulse object-contain" />
              <img src={wandImg} alt="" className="absolute -right-14 bottom-5 h-12 w-12 animate-bounce object-contain [animation-delay:300ms]" />
              <img src={cloudImg} alt="" className="absolute -left-14 bottom-1 h-9 w-9 object-contain opacity-90" />
            </div>

            <h1 className="mb-2 text-[28px] font-semibold tracking-tight">
              <span className="bg-gradient-to-r from-accent to-accent2 bg-clip-text text-transparent">WinAgent</span>
            </h1>
            <p className="mb-8 max-w-md text-sm leading-relaxed text-muted">
              安洁莉娜的陪伴空间~ 来自罗德岛的信使陪你聊天，也能替你跑腿处理电脑上的全部杂活（完整 Windows 工具集 + 知识库）。
            </p>

            <div className="grid grid-cols-3 gap-3">
              {features.map((f) => (
                <button
                  key={f.title}
                  onClick={() => openSettings(f.tab, f.pickSkills)}
                  title={`点击前往「${f.title}」设置`}
                  className="group w-44 cursor-pointer rounded-2xl border border-border bg-white/80 p-4 text-left shadow-card transition-all hover:border-accent/40 hover:shadow-glow"
                >
                  <f.icon className="mb-2.5 h-5 w-5 text-accent transition-transform group-hover:scale-110" />
                  <div className="mb-1 text-[13px] font-medium text-gray-700">{f.title}</div>
                  <div className="text-[11px] leading-relaxed text-muted">{f.desc}</div>
                </button>
              ))}
            </div>

            <p className="mt-8 text-xs text-muted">
              输入 <code className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent">/clear</code> 清空 ·{' '}
              <code className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent">/compact</code> 压缩上下文
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-1 px-4 pb-6 pt-4">
            {turns.map((t, i) => (
              <Message key={i} turn={t} aiState={aiState} />
            ))}
          </div>
        )}
      </div>

      {/* ================= 输入区 ================= */}
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((att, i) => (
              <div
                key={i}
                className="group flex items-center gap-2.5 rounded-xl border border-border bg-white/80 py-1.5 pl-1.5 pr-2 shadow-card backdrop-blur"
              >
                {att.isImage && att.dataUrl ? (
                  <img src={att.dataUrl} alt={att.name} className="h-8 w-8 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10">
                    {att.isImage ? <ImageIcon className="h-4 w-4 text-accent" /> : <FileText className="h-4 w-4 text-accent" />}
                  </div>
                )}
                <span className="max-w-36 truncate text-xs text-gray-600">{att.name}</span>
                <button
                  onClick={() => removeAttachment(i)}
                  className="rounded-md p-0.5 text-muted transition-colors hover:bg-red-100 hover:text-red-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-2xl border border-border bg-white/90 shadow-card backdrop-blur transition-all focus-within:border-accent/50 focus-within:shadow-[0_0_0_3px_rgba(244,113,156,0.12),0_8px_30px_rgba(244,113,156,0.15)]">
          <textarea
            ref={taRef}
            className="max-h-40 w-full resize-none bg-transparent px-4 pt-3.5 text-sm leading-relaxed text-gray-700 outline-none placeholder:text-muted"
            rows={1}
            placeholder="和安洁莉娜聊聊天，或者让她帮你跑跑腿…"
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
              accept="image/*,.txt,.md,.json,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.h,.css,.html,.xml,.yml,.yaml,.csv,.log,.sh,.bat"
              onChange={onFileSelect}
            />
            <button
              title="添加文件或图片"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-pink-100/70 hover:text-accent"
            >
              <Plus className="h-4 w-4" />
            </button>
            <span className="text-[11px] text-muted">Enter 发送 · Shift+Enter 换行</span>
            <div className="ml-auto">
              {busy ? (
                <button
                  onClick={stop}
                  title="停止生成"
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-400 text-white shadow-lg shadow-red-300/40 transition-all hover:bg-red-500"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  onClick={submit}
                  disabled={!input.trim() && attachments.length === 0}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent2 text-white shadow-glow transition-all hover:opacity-90 disabled:opacity-30 disabled:shadow-none"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
        </div>

      </div>

    {/* 拖拽导入遮罩 */}
    {dragOver && (
      <div
        className="wiki-drop-overlay"
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false) }}
        onDrop={handleDrop}
      >
        <div className="text-center">
          <div className="mb-3 text-5xl">📥</div>
          <div className="text-xl font-semibold text-white">释放文件以导入到知识库</div>
          <div className="mt-2 text-sm text-white/60">AI 将自动分析、标记并索引文件内容</div>
        </div>
      </div>
    )}

    {/* 知识库处理进度提示 */}
    {wikiProcessing.length > 0 && (
      <div className="fixed bottom-20 right-4 z-50 w-72 space-y-2">
        {wikiProcessing.map((p, i) => (
          <div
            key={i}
            className={`rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${
              p.status === 'done'
                ? 'border-green-200 bg-green-50/95 text-green-700'
                : p.status === 'error'
                  ? 'border-red-200 bg-red-50/95 text-red-600'
                  : 'border-accent/20 bg-white/95 text-gray-700'
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
                className="shrink-0 text-muted hover:text-gray-700"
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

      {/* ================= 危险操作确认 ================= */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-pink-900/20 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
              <h3 className="text-[15px] font-semibold text-gray-800">确认执行危险操作</h3>
            </div>
            <p className="mb-2 text-sm text-gray-600">
              工具 <span className="rounded-md bg-accent/10 px-1.5 py-0.5 font-mono text-[13px] text-accent">{confirm.name}</span>{' '}
              即将执行：
            </p>
            <pre className="mb-4 max-h-48 overflow-auto rounded-xl border border-border bg-pink-50/50 p-3 font-mono text-xs leading-relaxed text-gray-600">
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
                className="rounded-lg border border-border px-4 py-1.5 text-sm text-gray-600 transition-colors hover:bg-pink-50"
              >
                拒绝
              </button>
              <button
                onClick={() => respondConfirm(true)}
                className="rounded-lg bg-gradient-to-br from-amber-400 to-orange-400 px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
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
