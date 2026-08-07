import { useEffect, useState } from 'react'
import {
  X,
  Plus,
  Trash2,
  RefreshCw,
  Save,
  FolderOpen,
  Settings as SettingsIcon,
  Server,
  Eye,
  SlidersHorizontal,
  MessageSquareText,
  Cpu,
  Wrench
} from 'lucide-react'
import type { AppConfig, ChatMode, ProviderConfig, ToolInfo } from '../../../shared/types'

interface Props {
  onClose: () => void
  onSaved: (cfg: AppConfig) => void
  initialTab?: TabKey
  /** 挂载后自动弹出目录选择器，选中后直接填入 Skills 目录并保存 */
  pickSkillsOnMount?: boolean
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

const TABS = [
  { key: 'models', label: '模型', icon: Server },
  { key: 'vision', label: '视觉辅助', icon: Eye },
  { key: 'generation', label: '生成参数', icon: SlidersHorizontal },
  { key: 'system', label: '系统提示词', icon: MessageSquareText },
  { key: 'advanced', label: '高级', icon: Cpu },
  { key: 'tools', label: '工具', icon: Wrench }
] as const
export type TabKey = (typeof TABS)[number]['key']

const inputCls = 'w-full rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm text-gray-700'

export default function Settings({ onClose, onSaved, initialTab, pickSkillsOnMount }: Props): JSX.Element {
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [dataDir, setDataDir] = useState('')
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<TabKey>(initialTab ?? 'models')

  useEffect(() => {
    window.winagent.getConfig().then(setCfg)
    window.winagent.listTools().then(setTools)
    window.winagent.getDataDir().then(setDataDir)
  }, [])

  // 挂载后自动选择 Skills 文件夹：选好后直接填入并保存，不关闭面板
  useEffect(() => {
    if (!pickSkillsOnMount || !cfg) return
    const pick = async (): Promise<void> => {
      const dir = await window.winagent.pickDirectory()
      if (!dir) return
      const next = { ...cfg, skillsDir: dir }
      setCfg(next)
      setSaving(true)
      try {
        await window.winagent.saveConfig(next)
        const t = await window.winagent.reloadTools()
        setTools(t)
      } catch (e) {
        console.error('保存 Skills 目录失败:', e)
      }
      setSaving(false)
      setTab('advanced')
    }
    void pick()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickSkillsOnMount, cfg === null])

  if (!cfg) return <div className="flex h-full items-center justify-center text-muted">加载中…</div>
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

  const checkboxCls = 'h-4 w-4 accent-accent'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-pink-900/20 p-4 backdrop-blur-sm">
      <div className="flex h-[86vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-white shadow-2xl">
        {/* ============ 左侧导航 ============ */}
        <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-pink-50/50">
          <div className="flex items-center gap-2.5 px-4 pb-4 pt-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent2 shadow-glow">
              <SettingsIcon className="h-4 w-4 text-white" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-gray-700">设置</span>
          </div>
          <nav className="flex-1 space-y-0.5 px-2.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                  tab === t.key
                    ? 'bg-accent/10 font-medium text-accent'
                    : 'text-muted hover:bg-pink-100/60 hover:text-accent'
                }`}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </nav>
          <div className="px-4 pb-4">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted">
              <FolderOpen className="h-3 w-3" />
              数据目录
            </div>
            <div className="truncate rounded-lg bg-white px-2 py-1 font-mono text-[10.5px] text-muted" title={dataDir}>
              {dataDir}
            </div>
          </div>
        </aside>

        {/* ============ 右侧内容 ============ */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {/* ---------- 模型 Providers ---------- */}
            {tab === 'models' && (
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[15px] font-medium text-gray-800">模型 Providers</h3>
                  <button
                    onClick={() => update({ providers: [...cfg.providers, newProvider()] })}
                    className="flex items-center gap-1 rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
                  >
                    <Plus className="h-3.5 w-3.5" /> 添加
                  </button>
                </div>
                <div className="space-y-3">
                  {cfg.providers.map((p, i) => (
                    <div key={p.id} className="rounded-xl border border-border/70 bg-pink-50/40 p-3.5">
                      <div className="mb-2.5 flex gap-2">
                        <input
                          className={inputCls}
                          value={p.label}
                          placeholder="名称"
                          onChange={(e) => updateProvider(i, { label: e.target.value })}
                        />
                        <select
                          className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm text-gray-700"
                          value={p.type}
                          onChange={(e) => updateProvider(i, { type: e.target.value as 'openai' | 'ollama' })}
                        >
                          <option value="openai">OpenAI 兼容</option>
                          <option value="ollama">Ollama</option>
                        </select>
                        <button
                          onClick={() => update({ providers: cfg.providers.filter((_, j) => j !== i) })}
                          className="rounded-lg p-2 text-muted transition-colors hover:bg-red-500/15 hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <input
                        className={`${inputCls} mb-2.5`}
                        value={p.baseUrl}
                        placeholder="Base URL（OpenAI 含 /v1；Ollama 填 http://localhost:11434）"
                        onChange={(e) => updateProvider(i, { baseUrl: e.target.value })}
                      />
                      {p.type === 'openai' && (
                        <input
                          className={`${inputCls} mb-2.5`}
                          value={p.apiKey}
                          type="password"
                          placeholder="API Key"
                          onChange={(e) => updateProvider(i, { apiKey: e.target.value })}
                        />
                      )}
                      <div className="mb-2.5 flex items-center gap-2 text-xs text-muted">
                        <span>图片识别:</span>
                        <select
                          className="rounded-lg border border-border bg-white px-2 py-1 text-xs text-gray-600"
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
                          className={inputCls}
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
                          className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:text-accent"
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> 拉取模型
                        </button>
                      </div>
                      {modelsByProvider[p.id] && (
                        <div className="mt-1.5 text-[11px] text-muted">
                          可用: {modelsByProvider[p.id].join(', ') || '（空）'}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ---------- 视觉辅助 ---------- */}
            {tab === 'vision' && (
              <section className="rounded-xl border border-border/70 bg-pink-50/40 p-4">
                <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    className={checkboxCls}
                    checked={cfg.visionAssist.enabled}
                    onChange={(e) =>
                      update({ visionAssist: { ...cfg.visionAssist, enabled: e.target.checked } })
                    }
                  />
                  <span>视觉辅助（主模型不支持图片时，调用视觉模型识别）</span>
                </label>
                <p className="mt-1.5 pl-6 text-[11.5px] leading-relaxed text-muted">
                  主模型为纯语言模型时，图片先交由下方选定的视觉模型识别，识别结果以文本形式回填给主模型继续完成任务。
                </p>
                {cfg.visionAssist.enabled && (
                  <div className="mt-4 space-y-3.5 pl-6">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block text-sm">
                        <span className="mb-1.5 block text-xs text-muted">接口来源</span>
                        <select
                          className={inputCls}
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
                        <span className="mb-1.5 block text-xs text-muted">
                          视觉模型名{cfg.visionAssist.providerId ? '（留空用该 Provider 的模型）' : ''}
                        </span>
                        <input
                          className={inputCls}
                          placeholder={cfg.visionAssist.providerId ? visionBaseModel : '例如 mimo-v2.5'}
                          value={cfg.visionAssist.model}
                          onChange={(e) =>
                            update({ visionAssist: { ...cfg.visionAssist, model: e.target.value } })
                          }
                        />
                      </label>
                    </div>
                    {visionWarning ? (
                      <p className="text-[11.5px] text-red-400">{visionWarning}</p>
                    ) : (
                      <p className="text-[11.5px] text-muted">
                        实际调用：{visionSourceLabel} · 模型 {visionEffectiveModel}
                      </p>
                    )}
                    <label className="block text-sm">
                      <span className="mb-1.5 block text-xs text-muted">识别指令（留空用默认）</span>
                      <textarea
                        className="h-20 w-full rounded-lg border border-border bg-white px-2.5 py-2 text-sm leading-relaxed text-gray-700"
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
            )}

            {/* ---------- 生成参数 ---------- */}
            {tab === 'generation' && (
              <section className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm">
                    <span className="mb-1.5 block text-xs text-muted">Temperature</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      className={inputCls}
                      value={cfg.temperature}
                      onChange={(e) => update({ temperature: Number(e.target.value) })}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1.5 block text-xs text-muted">Max Tokens</span>
                    <input
                      type="number"
                      className={inputCls}
                      value={cfg.maxTokens}
                      onChange={(e) => update({ maxTokens: Number(e.target.value) })}
                    />
                  </label>
                </div>

                <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className={checkboxCls}
                    checked={cfg.stream}
                    onChange={(e) => update({ stream: e.target.checked })}
                  />
                  <span>流式输出（关闭后等模型生成完毕再一次性显示）</span>
                </label>

                <label className="flex items-center gap-3 text-sm text-gray-700">
                  <span className="text-xs text-muted">深度思考</span>
                  <select
                    className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm text-gray-700"
                    value={cfg.thinkingMode}
                    onChange={(e) => update({ thinkingMode: e.target.value as AppConfig['thinkingMode'] })}
                  >
                    <option value="auto">自动（不下发参数，由模型决定）</option>
                    <option value="on">开启</option>
                    <option value="off">关闭</option>
                  </select>
                </label>
                <p className="text-[11.5px] leading-relaxed text-muted">
                  深度思考会下发 <code className="rounded bg-accent/10 px-1 py-0.5 text-[10.5px] text-accent">enable_thinking</code> /{' '}
                  <code className="rounded bg-accent/10 px-1 py-0.5 text-[10.5px] text-accent">reasoning</code> /{' '}
                  <code className="rounded bg-accent/10 px-1 py-0.5 text-[10.5px] text-accent">thinking</code>{' '}
                  参数；若接口不认识会自动去掉参数重试，不会报错。
                </p>

                <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border/70 bg-pink-50/40 p-3.5 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    className={checkboxCls}
                    checked={cfg.autoApproveTools}
                    onChange={(e) => update({ autoApproveTools: e.target.checked })}
                  />
                  <span>自动放行危险操作（不弹确认框）</span>
                </label>
              </section>
            )}

            {/* ---------- 系统提示词 ---------- */}
            {tab === 'system' && (
              <section>
                <h3 className="mb-3 text-[15px] font-medium text-gray-800">提示词</h3>
                <p className="mb-3 text-[11.5px] text-muted">
                  模式已合并：AI 以安洁莉娜的人设陪伴聊天，同时保留完整工具能力为你「跑腿」。此提示词可自由修改或扩写；工具清单与执行规则会在运行时自动附加。
                </p>
                <h3 className="mb-1.5 text-[15px] font-medium text-gray-800">桌宠人设（安洁莉娜）</h3>
                <textarea
                  className="h-52 w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm leading-relaxed text-gray-700"
                  value={cfg.petPrompt}
                  onChange={(e) => update({ petPrompt: e.target.value })}
                />
              </section>
            )}

            {/* ---------- 高级 ---------- */}
            {tab === 'advanced' && (
              <section className="space-y-4">
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs text-muted">Skills 目录</span>
                  <input
                    className={inputCls}
                    value={cfg.skillsDir}
                    onChange={(e) => update({ skillsDir: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs text-muted">MCP 配置路径</span>
                  <input
                    className={inputCls}
                    value={cfg.mcpConfigPath}
                    onChange={(e) => update({ mcpConfigPath: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs text-muted">知识库 (Vault) 路径</span>
                  <input
                    className={inputCls}
                    value={cfg.vaultPath || ''}
                    placeholder="默认为 data/wiki（Obsidian 兼容格式）"
                    onChange={(e) => update({ vaultPath: e.target.value })}
                  />
                  <p className="mt-1 text-[11px] text-muted/70">修改后需重启应用生效。知识库使用 Obsidian 兼容的 Markdown 格式。</p>
                </label>
                <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-pink-50/40 p-3.5 text-[11.5px] text-muted">
                  <FolderOpen className="h-4 w-4 shrink-0 text-accent" />
                  <span className="truncate" title={dataDir}>
                    数据目录: <span className="font-mono text-gray-600">{dataDir}</span>
                  </span>
                </div>
              </section>
            )}

            {/* ---------- 工具 ---------- */}
            {tab === 'tools' && (
              <section>
                <h3 className="mb-3 text-[15px] font-medium text-gray-800">已加载工具（{tools.length}）</h3>
                {(['builtin', 'skill', 'mcp'] as const).map((src) =>
                  toolsBySource[src].length ? (
                    <div key={src} className="mb-3.5">
                      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-muted">
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[10px] ${
                            src === 'builtin'
                              ? 'bg-accent/10 text-accent'
                              : src === 'skill'
                                ? 'bg-purple-500/15 text-purple-400'
                                : 'bg-cyan-500/15 text-cyan-400'
                          }`}
                        >
                          {src === 'builtin' ? '内置' : src === 'skill' ? 'Skills' : 'MCP'}
                        </span>
                        {toolsBySource[src].length} 个
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {toolsBySource[src].map((t) => (
                          <span
                            key={t.name}
                            title={t.description}
                            className={`rounded-lg px-2 py-1 text-[11px] ${
                              t.dangerous
                                ? 'bg-red-100 text-red-500 ring-1 ring-red-200'
                                : 'bg-pink-50 text-gray-600'
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
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border/70 px-6 py-3.5">
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-pink-50"
            >
              取消
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-accent to-accent2 px-4 py-2 text-sm font-medium text-white shadow-glow transition-opacity hover:opacity-90 disabled:opacity-50 disabled:shadow-none"
            >
              <Save className="h-4 w-4" />
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
