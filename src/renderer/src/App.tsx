import { useEffect, useRef, useState } from 'react'
import { Settings as SettingsIcon, Send, Square, Trash2, Minimize2, RefreshCw, AlertTriangle, Plus, X, FileText, ImageIcon } from 'lucide-react'
import type { AppConfig } from '../../shared/types'
import { useAgent } from './lib/useAgent'
import Message from './components/Message'
import Settings from './components/Settings'

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
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadCfg = (): void => {
    window.winagent.getConfig().then(setCfg)
  }
  useEffect(loadCfg, [])

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

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex items-center gap-2 border-b border-border bg-panel px-4 py-2">
        <span className="mr-2 font-semibold tracking-tight">
          Win<span className="text-accent">Agent</span>
        </span>

        <select
          className="rounded border border-border bg-bg px-2 py-1 text-sm outline-none"
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
            className="w-52 rounded border border-border bg-bg px-2 py-1 text-sm outline-none"
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
          <button
            title="拉取模型列表"
            onClick={refreshModels}
            className="rounded p-1.5 text-muted hover:bg-border/50 hover:text-white"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <span className="mr-2 text-xs text-muted">{status}</span>
          {usage && usage.total > 0 && (
            <span
              title={usageTitle}
              className="mr-2 cursor-default rounded bg-border/40 px-1.5 py-0.5 text-[11px] text-muted"
            >
              {usage.estimated ? '~' : ''}
              {fmtTokens(usage.total)} tokens
            </span>
          )}
          <button
            title="压缩上下文"
            onClick={compact}
            className="rounded p-1.5 text-muted hover:bg-border/50 hover:text-white"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
          <button
            title="清空对话"
            onClick={reset}
            className="rounded p-1.5 text-muted hover:bg-border/50 hover:text-white"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            title="设置"
            onClick={() => setShowSettings(true)}
            className="rounded p-1.5 text-muted hover:bg-border/50 hover:text-white"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted">
            <div className="mb-2 text-2xl font-semibold text-gray-300">
              Win<span className="text-accent">Agent</span>
            </div>
            <p className="max-w-md text-sm">
              自主可控的 Windows AI 助手。兼容 OpenAI 格式 API 与本地 Ollama，内置完整 Windows 工具集，
              支持 skills 与 MCP 挂载。
            </p>
            <p className="mt-3 text-xs">输入 <code className="rounded bg-border/50 px-1">/clear</code> 清空、<code className="rounded bg-border/50 px-1">/compact</code> 压缩上下文</p>
          </div>
        ) : (
          turns.map((t, i) => <Message key={i} turn={t} />)
        )}
      </div>

      <div className="border-t border-border bg-panel p-3">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((att, i) => (
              <div
                key={i}
                className="group relative flex items-center gap-2 rounded-lg border border-border bg-bg px-2 py-1.5"
              >
                {att.isImage && att.dataUrl ? (
                  <img src={att.dataUrl} alt={att.name} className="h-10 w-10 rounded object-cover" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded bg-border/40">
                    {att.isImage ? <ImageIcon className="h-5 w-5 text-muted" /> : <FileText className="h-5 w-5 text-muted" />}
                  </div>
                )}
                <span className="max-w-32 truncate text-xs text-gray-300">{att.name}</span>
                <button
                  onClick={() => removeAttachment(i)}
                  className="ml-1 rounded p-0.5 text-muted hover:bg-red-500/20 hover:text-red-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-xl border border-border bg-bg px-3 py-2">
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
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-border/50 hover:text-white"
          >
            <Plus className="h-5 w-5" />
          </button>
          <textarea
            ref={taRef}
            className="max-h-40 flex-1 resize-none bg-transparent text-sm outline-none"
            rows={1}
            placeholder="给 WinAgent 下达指令…（Enter 发送，Shift+Enter 换行）"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
            }}
            onKeyDown={onKeyDown}
          />
          {busy ? (
            <button
              onClick={stop}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/80 text-white hover:bg-red-500"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!input.trim() && attachments.length === 0}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onSaved={(saved) => {
            setCfg(saved)
            setShowSettings(false)
          }}
        />
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-panel p-5 shadow-2xl">
            <div className="mb-3 flex items-center gap-2 text-yellow-400">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="font-semibold">确认执行危险操作</h3>
            </div>
            <p className="mb-2 text-sm text-gray-300">
              工具 <span className="font-mono text-accent">{confirm.name}</span> 即将执行：
            </p>
            <pre className="mb-4 max-h-48 overflow-auto rounded bg-black/40 p-2 text-xs text-gray-300">
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
                className="rounded border border-border px-4 py-1.5 text-sm hover:bg-border/40"
              >
                拒绝
              </button>
              <button
                onClick={() => respondConfirm(true)}
                className="rounded bg-yellow-500 px-4 py-1.5 text-sm font-medium text-black hover:bg-yellow-400"
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
