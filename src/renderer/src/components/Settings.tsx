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

  // 视觉辅助实际生效的接口与模型
  const activeProvider = cfg.providers.find((p) => p.id === cfg.activeProviderId)
  const visionBase = cfg.visionAssist.providerId
    ? cfg.providers.find((p) => p.id === cfg.visionAssist.providerId)
    : activeProvider
  const visionBaseModel = visionBase?.model || ''
  const visionEffectiveModel =
    cfg.visionAssist.model.trim() || (cfg.visionAssist.providerId ? visionBaseModel : '')
  const visionSourceLabel = cfg.visionAssist.providerId
    ? visionBase?.label || '未知 Provider'
    : `${activeProvider?.label || '主模型'}（同一 API）`
  const visionWarning = !cfg.visionAssist.enabled
    ? ''
    : !visionBase
      ? '选定的 Provider 不存在。'
      : !visionEffectiveModel
        ? '请填写视觉模型名。'
        : visionBase.id === activeProvider?.id && visionEffectiveModel === activeProvider?.model
          ? '视觉模型与主模型完全相同，视觉辅助不会生效。'
          : ''

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
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted">
                    <span>图片识别:</span>
                    <select
                      className="rounded border border-border bg-bg px-1.5 py-0.5"
                      value={p.supportsVision === undefined ? 'auto' : p.supportsVision ? 'yes' : 'no'}
                      onChange={(e) => {
                        const v = e.target.value
                        updateProvider(i, { supportsVision: v === 'auto' ? undefined : v === 'yes' })
                      }}
                    >
                      <option value="auto">自动检测</option>
                      <option value="yes">支持</option>
                      <option value="no">不支持</option>
                    </select>
                  </div>
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

          {/* 视觉辅助 */}
          <section className="rounded-lg border border-border bg-bg/50 p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={cfg.visionAssist.enabled}
                onChange={(e) =>
                  update({ visionAssist: { ...cfg.visionAssist, enabled: e.target.checked } })
                }
              />
              <span>视觉辅助（主模型不支持图片时，调用视觉模型识别）</span>
            </label>
            <p className="mt-1 text-[11px] text-muted">
              主模型为纯语言模型时，图片先交由下方选定的视觉模型识别，识别结果以文本形式回填给主模型继续完成任务。
            </p>
            {cfg.visionAssist.enabled && (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-sm">
                    <span className="mb-1 block text-muted">接口来源</span>
                    <select
                      className="w-full rounded border border-border bg-bg px-2 py-1 text-sm"
                      value={cfg.visionAssist.providerId}
                      onChange={(e) =>
                        update({ visionAssist: { ...cfg.visionAssist, providerId: e.target.value } })
                      }
                    >
                      <option value="">与主模型同一 API（只换模型名）</option>
                      {cfg.providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-muted">
                      视觉模型名{cfg.visionAssist.providerId ? '（留空用该 Provider 的模型）' : ''}
                    </span>
                    <input
                      className="w-full rounded border border-border bg-bg px-2 py-1 text-sm"
                      placeholder={cfg.visionAssist.providerId ? visionBaseModel : '例如 mimo-v2.5'}
                      value={cfg.visionAssist.model}
                      onChange={(e) =>
                        update({ visionAssist: { ...cfg.visionAssist, model: e.target.value } })
                      }
                    />
                  </label>
                </div>
                {visionWarning && <p className="text-[11px] text-red-400">{visionWarning}</p>}
                {!visionWarning && (
                  <p className="text-[11px] text-muted">
                    实际调用：{visionSourceLabel} · 模型 {visionEffectiveModel}
                  </p>
                )}
                <label className="block text-sm">
                  <span className="mb-1 block text-muted">识别指令（留空用默认）</span>
                  <textarea
                    className="h-20 w-full rounded border border-border bg-bg px-2 py-1 text-sm"
                    placeholder="默认：完整客观描述图片，文字原文转写，公式用 LaTeX，表格用 Markdown"
                    value={cfg.visionAssist.prompt}
                    onChange={(e) =>
                      update({ visionAssist: { ...cfg.visionAssist, prompt: e.target.value } })
                    }
                  />
                </label>
              </div>
            )}
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

          {/* 请求行为 */}
          <section className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={cfg.stream}
                onChange={(e) => update({ stream: e.target.checked })}
              />
              <span>流式输出（关闭后等模型生成完毕再一次性显示）</span>
            </label>
            <label className="flex items-center gap-3 text-sm">
              <span>深度思考</span>
              <select
                className="rounded border border-border bg-bg px-2 py-1"
                value={cfg.thinkingMode}
                onChange={(e) => update({ thinkingMode: e.target.value as AppConfig['thinkingMode'] })}
              >
                <option value="auto">自动（不下发参数，由模型决定）</option>
                <option value="on">开启</option>
                <option value="off">关闭</option>
              </select>
            </label>
            <p className="text-[11px] text-muted">
              深度思考会下发 <code>enable_thinking</code> / <code>reasoning</code> / <code>thinking</code>{' '}
              参数；若接口不认识会自动去掉参数重试，不会报错。
            </p>
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
