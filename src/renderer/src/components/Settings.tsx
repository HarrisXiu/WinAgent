import { useEffect, useState } from 'react'
import { X, Plus, Trash2, RefreshCw, Save, FolderOpen } from 'lucide-react'
import type { AppConfig, ProviderConfig, ToolInfo } from '../../../shared/types'

interface Props {
  onClose: () => void
  onSaved: (cfg: AppConfig) => void
}

function newProvider(): ProviderConfig {
  return {
    id: 'provider_' + Date.now(),
    label: '新 Provider',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: ''
  }
}

export default function Settings({ onClose, onSaved }: Props): JSX.Element {
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [dataDir, setDataDir] = useState('')
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.winagent.getConfig().then(setCfg)
    window.winagent.listTools().then(setTools)
    window.winagent.getDataDir().then(setDataDir)
  }, [])

  if (!cfg) return <div className="p-6 text-muted">加载中…</div>

  const update = (patch: Partial<AppConfig>): void => setCfg({ ...cfg, ...patch })
  const updateProvider = (i: number, patch: Partial<ProviderConfig>): void => {
    const providers = [...cfg.providers]
    providers[i] = { ...providers[i], ...patch }
    update({ providers })
  }

  const fetchModels = async (p: ProviderConfig): Promise<void> => {
    try {
      const models = await window.winagent.fetchModels(p.id)
      setModelsByProvider((m) => ({ ...m, [p.id]: models }))
    } catch (e) {
      setModelsByProvider((m) => ({ ...m, [p.id]: [`拉取失败: ${e instanceof Error ? e.message : e}`] }))
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    const saved = await window.winagent.saveConfig(cfg)
    const t = await window.winagent.reloadTools()
    setTools(t)
    setSaving(false)
    onSaved(saved)
  }

  const toolsBySource = {
    builtin: tools.filter((t) => t.source === 'builtin'),
    skill: tools.filter((t) => t.source === 'skill'),
    mcp: tools.filter((t) => t.source === 'mcp')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[88vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-lg font-semibold">设置</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-border/50 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {/* Providers */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-medium">模型 Providers</h3>
              <button
                onClick={() => update({ providers: [...cfg.providers, newProvider()] })}
                className="flex items-center gap-1 rounded bg-accent/20 px-2 py-1 text-xs text-accent hover:bg-accent/30"
              >
                <Plus className="h-3.5 w-3.5" /> 添加
              </button>
            </div>
            <div className="space-y-3">
              {cfg.providers.map((p, i) => (
                <div key={p.id} className="rounded-lg border border-border bg-bg/50 p-3">
                  <div className="mb-2 flex gap-2">
                    <input
                      className="flex-1 rounded border border-border bg-bg px-2 py-1 text-sm"
                      value={p.label}
                      placeholder="名称"
                      onChange={(e) => updateProvider(i, { label: e.target.value })}
                    />
                    <select
                      className="rounded border border-border bg-bg px-2 py-1 text-sm"
                      value={p.type}
                      onChange={(e) => updateProvider(i, { type: e.target.value as 'openai' | 'ollama' })}
                    >
                      <option value="openai">OpenAI 兼容</option>
                      <option value="ollama">Ollama</option>
                    </select>
                    <button
                      onClick={() => update({ providers: cfg.providers.filter((_, j) => j !== i) })}
                      className="rounded p-1.5 text-muted hover:bg-red-500/20 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <input
                    className="mb-2 w-full rounded border border-border bg-bg px-2 py-1 text-sm"
                    value={p.baseUrl}
                    placeholder="Base URL（OpenAI 含 /v1；Ollama 填 http://localhost:11434）"
                    onChange={(e) => updateProvider(i, { baseUrl: e.target.value })}
                  />
                  {p.type === 'openai' && (
                    <input
                      className="mb-2 w-full rounded border border-border bg-bg px-2 py-1 text-sm"
                      value={p.apiKey}
                      type="password"
                      placeholder="API Key"
                      onChange={(e) => updateProvider(i, { apiKey: e.target.value })}
                    />
                  )}
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded border border-border bg-bg px-2 py-1 text-sm"
                      value={p.model}
                      placeholder="模型名称"
                      list={`models-${p.id}`}
                      onChange={(e) => updateProvider(i, { model: e.target.value })}
                    />
                    <datalist id={`models-${p.id}`}>
                      {(modelsByProvider[p.id] || []).map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                    <button
                      onClick={() => fetchModels(p)}
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted hover:text-white"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> 拉取模型
                    </button>
                  </div>
                  {modelsByProvider[p.id] && (
                    <div className="mt-1 text-[11px] text-muted">
                      可用: {modelsByProvider[p.id].join(', ') || '（空）'}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* 生成参数 */}
          <section className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-muted">Temperature</span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                className="w-full rounded border border-border bg-bg px-2 py-1"
                value={cfg.temperature}
                onChange={(e) => update({ temperature: Number(e.target.value) })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted">Max Tokens</span>
              <input
                type="number"
                className="w-full rounded border border-border bg-bg px-2 py-1"
                value={cfg.maxTokens}
                onChange={(e) => update({ maxTokens: Number(e.target.value) })}
              />
            </label>
          </section>

          <section>
            <span className="mb-1 block text-sm text-muted">系统提示词</span>
            <textarea
              className="h-28 w-full rounded border border-border bg-bg px-2 py-1 text-sm"
              value={cfg.systemPrompt}
              onChange={(e) => update({ systemPrompt: e.target.value })}
            />
          </section>

          <section className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-muted">Skills 目录</span>
              <input
                className="w-full rounded border border-border bg-bg px-2 py-1"
                value={cfg.skillsDir}
                onChange={(e) => update({ skillsDir: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted">MCP 配置路径</span>
              <input
                className="w-full rounded border border-border bg-bg px-2 py-1"
                value={cfg.mcpConfigPath}
                onChange={(e) => update({ mcpConfigPath: e.target.value })}
              />
            </label>
          </section>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={cfg.autoApproveTools}
              onChange={(e) => update({ autoApproveTools: e.target.checked })}
            />
            <span>自动放行危险操作（不弹确认框）</span>
          </label>

          {/* 工具清单 */}
          <section>
            <h3 className="mb-2 font-medium">已加载工具（{tools.length}）</h3>
            {(['builtin', 'skill', 'mcp'] as const).map((src) =>
              toolsBySource[src].length ? (
                <div key={src} className="mb-2">
                  <div className="mb-1 text-xs uppercase tracking-wide text-muted">
                    {src === 'builtin' ? '内置' : src === 'skill' ? 'Skills' : 'MCP'}（{toolsBySource[src].length}）
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {toolsBySource[src].map((t) => (
                      <span
                        key={t.name}
                        title={t.description}
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          t.dangerous ? 'bg-red-500/15 text-red-400' : 'bg-border/50 text-gray-300'
                        }`}
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null
            )}
          </section>

          <div className="flex items-center gap-2 text-[11px] text-muted">
            <FolderOpen className="h-3.5 w-3.5" />
            数据目录: {dataDir}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={onClose} className="rounded border border-border px-4 py-1.5 text-sm hover:bg-border/40">
            取消
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
