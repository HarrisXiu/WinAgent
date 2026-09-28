import { useEffect, useRef, useState } from 'react'
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
  Wrench,
  Palette,
  RotateCcw,
  Volume2,
  Loader2,
  Play,
  Pencil,
  Check,
  ImagePlus,
  Bot,
  Sparkles
} from 'lucide-react'
import type { AppConfig, ProviderConfig, ThemeConfig, SkinMeta, SkinSlot, ToolInfo, VoiceCloneMeta } from '../../../shared/types'
import { useSpeech } from '../lib/useSpeech'
import avatarThumb from '../assets/angelina/avatar.png'

/** 默认配色（品牌粉蓝，与改造前硬编码配色一致）；不含 skin——恢复配色不动主题包 */
const DEFAULT_THEME: Omit<ThemeConfig, 'skin'> = { mode: 'light', accent: '#f4719c', accent2: '#6db7d9' }

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
  { key: 'voice', label: '语音', icon: Volume2 },
  { key: 'generation', label: '生成参数', icon: SlidersHorizontal },
  { key: 'theme', label: '外观', icon: Palette },
  { key: 'system', label: '系统提示词', icon: MessageSquareText },
  { key: 'advanced', label: '高级', icon: Cpu },
  { key: 'tools', label: '工具', icon: Wrench }
] as const
export type TabKey = (typeof TABS)[number]['key']

const inputCls = 'w-full rounded-lg border border-border bg-panel px-2.5 py-1.5 text-sm text-text'

/** 自定义主题包槽位（五态立绘 + 头像） */
const SKIN_SLOT_LABELS: Array<[SkinSlot, string]> = [
  ['idle', '待机'],
  ['think', '思考'],
  ['tool', '工具'],
  ['vision', '识别'],
  ['talk', '说话'],
  ['avatar', '头像']
]

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export default function Settings({ onClose, onSaved, initialTab, pickSkillsOnMount }: Props): JSX.Element {
  const speech = useSpeech()
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [dataDir, setDataDir] = useState('')
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, string[]>>({})
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({})
  const [modelsLoading, setModelsLoading] = useState<Record<string, boolean>>({})
  const modelRequests = useRef<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  const [limitStatus, setLimitStatus] = useState('')
  const [limitBusy, setLimitBusy] = useState(false)
  const limitRequest = useRef(0)
  const limitProvider = cfg?.providers.find(p => p.id === cfg.activeProviderId)
  const detectLimit = async (force = false): Promise<void> => {
    if (!limitProvider?.model) return
    const seq = ++limitRequest.current
    setLimitBusy(true); setLimitStatus('正在检测当前模型的输出上限…')
    try {
      const result = await window.winagent.detectOutputLimit(limitProvider, force)
      if (seq !== limitRequest.current) return
      setCfg(current => current ? { ...current, maxTokens: result.value || 0, providers: current.providers.map(p => p.id === limitProvider.id ? { ...p, outputLimit: result } : p) } : current)
      setLimitStatus(`${result.value ? `已检测：${result.value.toLocaleString()} tokens` : '未检测到明确上限'} · ${result.source}`)
    } catch (e) { if (seq === limitRequest.current) { setLimitStatus(errMsg(e)); setCfg(c => c ? { ...c, maxTokens: 0 } : c) } }
    finally { if (seq === limitRequest.current) setLimitBusy(false) }
  }
  useEffect(() => {
    if (cfg?.autoMaxTokens === false || !limitProvider?.model) return
    const timer = setTimeout(() => { void detectLimit() }, 700)
    return () => { clearTimeout(timer); limitRequest.current++ }
  }, [cfg?.autoMaxTokens, limitProvider?.id, limitProvider?.model, limitProvider?.baseUrl, limitProvider?.apiKey])
  const [tab, setTab] = useState<TabKey>(initialTab ?? 'models')
  // 主题修改防抖计时器（必须声明在所有条件 return 之前）
  const themeDebounceRef = useRef<ReturnType<typeof setTimeout>>()
  // 语音：内置音色 + 克隆音色库 + 试听状态
  const [builtinVoices, setBuiltinVoices] = useState<Array<{ value: string; label: string }>>([])
  const [clones, setClones] = useState<VoiceCloneMeta[]>([])
  const [testingId, setTestingId] = useState('')
  const [voiceErr, setVoiceErr] = useState('')
  // 克隆音色行内重命名
  const [renamingClone, setRenamingClone] = useState<{ id: string; name: string } | null>(null)
  // 主题包：人设默认值 + 自定义包管理
  const [prompts, setPrompts] = useState<{ personaPrompt: string; petPrompt: string } | null>(null)
  const [skins, setSkins] = useState<SkinMeta[]>([])
  const [skinsErr, setSkinsErr] = useState('')
  const [newSkinName, setNewSkinName] = useState('')
  const [renamingSkin, setRenamingSkin] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    window.winagent.getConfig().then(setCfg)
    window.winagent.listTools().then(setTools)
    window.winagent.getDataDir().then(setDataDir)
    window.winagent.getConfigPrompts().then(setPrompts).catch(() => setPrompts(null))
    // 失败不再静默：写入 voiceErr 而不是让音色下拉空白无解释
    window.winagent.voices.builtinList().then(setBuiltinVoices).catch((e) => setVoiceErr(errMsg(e)))
    window.winagent.voices.list().then(setClones).catch((e) => setVoiceErr(errMsg(e)))
    window.winagent.skins.list().then(setSkins).catch((e) => setSkinsErr(errMsg(e)))
    const offVoices = window.winagent.voices.onChanged(setClones)
    const offSkins = window.winagent.skins.onChanged(setSkins)
    return () => {
      offVoices()
      offSkins()
    }
  }, [])

  // 设置面板关闭/卸载时停掉试听（走全局语音会话，含控制条收尾）
  useEffect(() => () => speech.stop(), [])
  // 试听会话结束（含被顶掉/出错）后复位按钮
  useEffect(() => {
    if (speech.state === 'idle') setTestingId('')
  }, [speech.state])

  const addClone = async (): Promise<void> => {
    setVoiceErr('')
    try {
      setClones(await window.winagent.voices.add())
    } catch (e) {
      setVoiceErr(errMsg(e))
    }
  }

  const renameClone = async (id: string, name: string): Promise<void> => {
    setVoiceErr('')
    try {
      setClones(await window.winagent.voices.rename(id, name))
      setRenamingClone(null)
    } catch (e) {
      setVoiceErr(errMsg(e))
    }
  }

  const removeClone = async (clone: VoiceCloneMeta): Promise<void> => {
    if (!window.confirm(`确定删除克隆音色「${clone.name}」吗？删除后不可恢复。`)) return
    setVoiceErr('')
    try {
      setClones(await window.winagent.voices.remove(clone.id))
    } catch (e) {
      setVoiceErr(errMsg(e))
    }
  }

  /** 试听走全局语音会话：可取消、进控制条 */
  const testClone = (id: string): void => {
    setVoiceErr('')
    setTestingId(id)
    speech.speak('你好，这是我的克隆音色试听~', { source: 'test', voice: `clone:${id}` })
  }

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
    if ('baseUrl' in patch || 'apiKey' in patch || 'type' in patch) {
      const id = providers[i].id
      modelRequests.current[id] = (modelRequests.current[id] || 0) + 1
      setModelsByProvider((m) => { const next = { ...m }; delete next[id]; return next })
      setModelErrors((m) => ({ ...m, [id]: '' }))
      setModelsLoading((m) => ({ ...m, [id]: false }))
    }
    update({ providers })
  }

  const fetchModels = async (p: ProviderConfig): Promise<void> => {
    const request = (modelRequests.current[p.id] || 0) + 1
    modelRequests.current[p.id] = request
    setModelsLoading((m) => ({ ...m, [p.id]: true }))
    setModelErrors((m) => ({ ...m, [p.id]: '' }))
    setModelsByProvider((m) => { const next = { ...m }; delete next[p.id]; return next })
    try {
      const models = await window.winagent.fetchModels(p)
      if (modelRequests.current[p.id] !== request) return
      setModelsByProvider((m) => ({ ...m, [p.id]: models }))
    } catch (e) {
      if (modelRequests.current[p.id] !== request) return
      setModelErrors((m) => ({ ...m, [p.id]: errMsg(e) }))
    } finally {
      if (modelRequests.current[p.id] === request) setModelsLoading((m) => ({ ...m, [p.id]: false }))
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

  // 主题修改：防抖 300ms 自动保存（拾色器拖拽不写盘，释放后生效；双窗口实时同步）
  const updateTheme = (patch: Partial<ThemeConfig>): void => {
    const next = { ...cfg, theme: { ...cfg.theme, ...patch } }
    setCfg(next)
    clearTimeout(themeDebounceRef.current)
    themeDebounceRef.current = setTimeout(() => {
      void window.winagent.saveConfig(next).then(onSaved)
    }, 300)
  }

  // ── 主题包（外观皮肤） ─────────────────────────────
  const skinSlotUrl = (s: SkinMeta, slot: SkinSlot): string | null => {
    const f = s.slots[slot]
    return f ? `winagent-skin://${s.id}/${slot}?v=${f.mtime}` : null
  }

  /** 切换主题包：人设联动（B5）——已知默认值静默替换；被手改过则确认后覆盖 */
  const applySkin = async (skinId: string): Promise<void> => {
    setSkinsErr('')
    let petPrompt = cfg.petPrompt
    const target =
      skinId === 'plain' ? prompts?.personaPrompt ?? null : skinId === 'angelina' ? prompts?.petPrompt ?? null : null
    if (target && petPrompt !== target) {
      const knownDefaults = [prompts?.personaPrompt, prompts?.petPrompt].filter(Boolean) as string[]
      if (knownDefaults.includes(petPrompt)) {
        petPrompt = target
      } else if (
        window.confirm(
          '切换主题包会同时切换人设提示词。\n当前提示词已被修改过，是否一并覆盖为该主题包的人设？\n（取消 = 只换外观，保留你调好的提示词）'
        )
      ) {
        petPrompt = target
      }
    }
    const next = { ...cfg, theme: { ...cfg.theme, skin: skinId }, petPrompt }
    setCfg(next)
    try {
      setCfg(await window.winagent.saveConfig(next))
    } catch (e) {
      setSkinsErr(errMsg(e))
    }
  }

  const createSkin = async (): Promise<void> => {
    setSkinsErr('')
    try {
      setSkins(await window.winagent.skins.create(newSkinName))
      setNewSkinName('')
    } catch (e) {
      setSkinsErr(errMsg(e))
    }
  }

  const uploadSkinSlot = async (id: string, slot: SkinSlot): Promise<void> => {
    setSkinsErr('')
    try {
      setSkins(await window.winagent.skins.setSlot(id, slot))
    } catch (e) {
      setSkinsErr(errMsg(e))
    }
  }

  const clearSkinSlot = async (id: string, slot: SkinSlot): Promise<void> => {
    setSkinsErr('')
    try {
      setSkins(await window.winagent.skins.clearSlot(id, slot))
    } catch (e) {
      setSkinsErr(errMsg(e))
    }
  }

  const renameSkin = async (id: string, name: string): Promise<void> => {
    setSkinsErr('')
    try {
      setSkins(await window.winagent.skins.rename(id, name))
      setRenamingSkin(null)
    } catch (e) {
      setSkinsErr(errMsg(e))
    }
  }

  const removeSkin = async (meta: SkinMeta): Promise<void> => {
    if (!window.confirm(`确定删除主题包「${meta.name}」吗？正在使用时界面会回退到普通主题。`)) return
    setSkinsErr('')
    try {
      setSkins(await window.winagent.skins.remove(meta.id))
      if (cfg.theme.skin === `custom:${meta.id}`) await applySkin('plain')
    } catch (e) {
      setSkinsErr(errMsg(e))
    }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex h-[86vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-panel shadow-2xl">
        {/* ============ 左侧导航 ============ */}
        <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-surface/50">
          <div className="flex items-center gap-2.5 px-4 pb-4 pt-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent2 shadow-glow">
              <SettingsIcon className="h-4 w-4 text-accent-fg" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-text">设置</span>
          </div>
          <nav className="flex-1 space-y-0.5 px-2.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                  tab === t.key
                    ? 'bg-accent/10 font-medium text-accent'
                    : 'text-muted hover:bg-surface-hover/60 hover:text-accent'
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
            <div className="truncate rounded-lg bg-panel px-2 py-1 font-mono text-[10.5px] text-muted" title={dataDir}>
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
                  <h3 className="text-[15px] font-medium text-text">模型 Providers</h3>
                  <button
                    onClick={() => update({ providers: [...cfg.providers, newProvider()] })}
                    className="flex items-center gap-1 rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
                  >
                    <Plus className="h-3.5 w-3.5" /> 添加
                  </button>
                </div>
                <div className="space-y-3">
                  {cfg.providers.map((p, i) => (
                    <div key={p.id} className="rounded-xl border border-border/70 bg-surface/40 p-3.5">
                      <div className="mb-2.5 flex gap-2">
                        <input
                          className={inputCls}
                          value={p.label}
                          placeholder="名称"
                          onChange={(e) => updateProvider(i, { label: e.target.value })}
                        />
                        <select
                          className="rounded-lg border border-border bg-panel px-2.5 py-1.5 text-sm text-text"
                          value={p.type}
                          onChange={(e) => updateProvider(i, { type: e.target.value as 'openai' | 'ollama' })}
                        >
                          <option value="openai">OpenAI 兼容</option>
                          <option value="ollama">Ollama</option>
                        </select>
                        <button
                          onClick={() => update({ providers: cfg.providers.filter((_, j) => j !== i) })}
                          className="rounded-lg p-2 text-muted transition-colors hover:bg-danger/90/15 hover:text-danger"
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
                          className="rounded-lg border border-border bg-panel px-2 py-1 text-xs text-text-secondary"
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
                          disabled={modelsLoading[p.id]}
                          className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:text-accent"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${modelsLoading[p.id] ? 'animate-spin' : ''}`} />
                          {modelsLoading[p.id] ? '正在拉取…' : '拉取模型'}
                        </button>
                      </div>
                      {modelErrors[p.id] && (
                        <div role="alert" className="mt-1.5 text-[11px] text-danger">
                          拉取失败：{modelErrors[p.id]}
                        </div>
                      )}
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
              <section className="rounded-xl border border-border/70 bg-surface/40 p-4">
                <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-text">
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
                      <p className="text-[11.5px] text-danger">{visionWarning}</p>
                    ) : (
                      <p className="text-[11.5px] text-muted">
                        实际调用：{visionSourceLabel} · 模型 {visionEffectiveModel}
                      </p>
                    )}
                    <label className="block text-sm">
                      <span className="mb-1.5 block text-xs text-muted">识别指令（留空用默认）</span>
                      <textarea
                        className="h-20 w-full rounded-lg border border-border bg-panel px-2.5 py-2 text-sm leading-relaxed text-text"
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

            {/* ---------- 语音（TTS + 克隆音色） ---------- */}
            {tab === 'voice' && (
              <section className="space-y-4">
                <p className="text-[11.5px] leading-relaxed text-muted">
                  语音合成与声音克隆由小米 MiMo TTS 提供（OpenAI 兼容接口，当前限时免费），需在
                  platform.xiaomimimo.com 申请 API Key。克隆零样本：上传一段 ≤7.5MB 的 wav/mp3
                  参考音频即可复刻音色，样本仅保存在本地数据目录 voices/ 下。
                </p>

                <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-text">
                  <input
                    type="checkbox"
                    className={checkboxCls}
                    checked={cfg.voice.enabled}
                    onChange={(e) => update({ voice: { ...cfg.voice, enabled: e.target.checked } })}
                  />
                  <span>启用语音朗读（回复气泡出现「朗读」按钮）</span>
                </label>

                {cfg.voice.enabled && (
                  <>
                    <div className="space-y-3.5 pl-6">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block text-sm">
                        <span className="mb-1.5 block text-xs text-muted">MiMo API Key</span>
                        <input
                          type="password"
                          className={inputCls}
                          placeholder="在 platform.xiaomimimo.com 申请"
                          value={cfg.voice.apiKey}
                          onChange={(e) => update({ voice: { ...cfg.voice, apiKey: e.target.value } })}
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="mb-1.5 block text-xs text-muted">接口地址</span>
                        <input
                          className={inputCls}
                          value={cfg.voice.baseUrl}
                          onChange={(e) => update({ voice: { ...cfg.voice, baseUrl: e.target.value } })}
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="block text-sm">
                        <span className="mb-1.5 block text-xs text-muted">音色</span>
                        <select
                          className={inputCls}
                          value={cfg.voice.voice}
                          onChange={(e) => update({ voice: { ...cfg.voice, voice: e.target.value } })}
                        >
                          {builtinVoices.map((v) => (
                            <option key={v.value} value={v.value}>
                              {v.label}
                            </option>
                          ))}
                          {clones.map((c) => (
                            <option key={c.id} value={`clone:${c.id}`}>
                              {c.name}（克隆）
                            </option>
                          ))}
                          {!builtinVoices.some((v) => v.value === cfg.voice.voice) &&
                            !clones.some((c) => `clone:${c.id}` === cfg.voice.voice) && (
                              <option value={cfg.voice.voice}>{cfg.voice.voice}（音色已失效）</option>
                            )}
                        </select>
                      </label>
                      <label className="block text-sm">
                        <span className="mb-1.5 block text-xs text-muted">输出格式</span>
                        <select
                          className={inputCls}
                          value={cfg.voice.outputFormat}
                          onChange={(e) =>
                            update({
                              voice: { ...cfg.voice, outputFormat: e.target.value as 'wav' | 'mp3' }
                            })
                          }
                        >
                          <option value="wav">wav（无损，可直接播放）</option>
                          <option value="mp3">mp3（体积更小）</option>
                        </select>
                      </label>
                    </div>

                    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                      <input
                        type="checkbox"
                        className={checkboxCls}
                        checked={cfg.voice.autoPlay}
                        onChange={(e) => update({ voice: { ...cfg.voice, autoPlay: e.target.checked } })}
                      />
                      <span>自动朗读（Agent 回复完成后自动发声）</span>
                    </label>

                    <label className="block text-sm">
                      <span className="mb-1.5 block text-xs text-muted">
                        风格指令（可选，如「用开心的语气说」）
                      </span>
                      <input
                        className={inputCls}
                        placeholder="留空则用自然语气朗读"
                        value={cfg.voice.stylePrompt}
                        onChange={(e) => update({ voice: { ...cfg.voice, stylePrompt: e.target.value } })}
                      />
                    </label>
                    </div>

                    {/* ----- 克隆音色管理（移入语音开关门控内：禁用时无从上传/试听） ----- */}
                    <div className="pl-6">
                      <div className="rounded-xl border border-border/70 bg-surface/40 p-4">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="text-sm font-medium text-text">克隆音色</span>
                    <button
                      onClick={() => void addClone()}
                      className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-accent to-accent2 px-3 py-1.5 text-xs font-medium text-accent-fg shadow-card transition-opacity hover:opacity-90"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      上传参考音频（wav / mp3）
                    </button>
                  </div>
                  {clones.length === 0 ? (
                    <p className="text-[11.5px] text-muted">
                      还没有克隆音色。上传一段 10~20 秒、清晰无杂音的 wav/mp3 人声即可创建。
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {clones.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-panel px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            {renamingClone?.id === c.id ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  autoFocus
                                  className="w-full rounded-md border border-border bg-panel px-2 py-1 text-[13px] text-text"
                                  value={renamingClone.name}
                                  maxLength={30}
                                  onChange={(e) => setRenamingClone({ id: c.id, name: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') void renameClone(c.id, renamingClone.name)
                                    if (e.key === 'Escape') setRenamingClone(null)
                                  }}
                                />
                                <button
                                  aria-label="保存重命名"
                                  title="保存"
                                  onClick={() => void renameClone(c.id, renamingClone.name)}
                                  className="rounded-md p-1 text-muted transition-colors hover:bg-surface-hover/70 hover:text-accent"
                                >
                                  <Check className="h-4 w-4" />
                                </button>
                                <button
                                  aria-label="取消重命名"
                                  title="取消"
                                  onClick={() => setRenamingClone(null)}
                                  className="rounded-md p-1 text-muted transition-colors hover:bg-surface-hover/70 hover:text-muted"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <>
                                <div className="truncate text-[13px] text-text">{c.name}</div>
                                <div className="text-[10.5px] text-muted">
                                  {c.file} · {new Date(c.createdAt).toLocaleString()}
                                </div>
                              </>
                            )}
                          </div>
                          {renamingClone?.id !== c.id && (
                            <>
                              <button
                                aria-label={`重命名音色 ${c.name}`}
                                title="重命名"
                                onClick={() => setRenamingClone({ id: c.id, name: c.name })}
                                className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-hover/70 hover:text-accent"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                aria-label={`试听音色 ${c.name}`}
                                title="试听（走朗读会话，可在控制条取消）"
                                onClick={() => testClone(c.id)}
                                className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-hover/70 hover:text-accent"
                              >
                                {testingId === c.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Play className="h-4 w-4" />
                                )}
                              </button>
                              <button
                                aria-label={`删除音色 ${c.name}`}
                                title="删除"
                                onClick={() => void removeClone(c)}
                                className="rounded-md p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {voiceErr && <p className="mt-2 text-[11.5px] text-danger">{voiceErr}</p>}
                      </div>
                    </div>
                  </>
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
                    <span className="mb-1.5 block text-xs text-muted">最大输出 Tokens</span>
                    <input
                      type="number"
                      className={inputCls}
                      value={cfg.maxTokens}
                      min={0}
                      step={1}
                      disabled={cfg.autoMaxTokens !== false}
                      onChange={(e) => update({ maxTokens: Number(e.target.value) })}
                    />
                  </label>
                </div>

                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.autoMaxTokens !== false} onChange={e => update({ autoMaxTokens: e.target.checked })}/>自动检测 API / 模型输出上限并填入</label>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted"><span role="status">{limitStatus || '0 表示由服务端决定；输出上限与上下文长度不同。'}</span><button className="rounded border border-border px-2 py-1" disabled={limitBusy || !limitProvider?.model} onClick={() => void detectLimit(true)}>{limitBusy ? '检测中…' : '重新检测'}</button></div>

                <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className={checkboxCls}
                    checked={cfg.stream}
                    onChange={(e) => update({ stream: e.target.checked })}
                  />
                  <span>流式输出（关闭后等模型生成完毕再一次性显示）</span>
                </label>

                <label className="flex items-center gap-3 text-sm text-text">
                  <span className="text-xs text-muted">深度思考</span>
                  <select
                    className="rounded-lg border border-border bg-panel px-2.5 py-1.5 text-sm text-text"
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

                <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border/70 bg-surface/40 p-3.5 text-sm text-text">
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

            {/* ---------- 外观（主题包 + 配色） ---------- */}
            {tab === 'theme' && (
              <section className="space-y-4">
                {/* ===== 主题包：普通（默认）/ 安洁莉娜 / 自定义包 ===== */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs text-muted">主题包（外观形象 + 名字 + 人设联动）</span>
                    {skinsErr && <span className="text-[11px] text-danger">{skinsErr}</span>}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {/* 普通（默认） */}
                    <button
                      onClick={() => void applySkin('plain')}
                      aria-pressed={cfg.theme.skin === 'plain'}
                      className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs transition-colors ${
                        cfg.theme.skin === 'plain'
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border bg-panel text-text-secondary hover:bg-surface'
                      }`}
                    >
                      <Bot className="h-8 w-8" />
                      <span className="font-medium">普通（默认）</span>
                      <span className="text-[10.5px] leading-tight text-muted">无吉祥物的纯净界面</span>
                    </button>
                    {/* 安洁莉娜（内置特殊主题） */}
                    <button
                      onClick={() => void applySkin('angelina')}
                      aria-pressed={cfg.theme.skin === 'angelina'}
                      className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs transition-colors ${
                        cfg.theme.skin === 'angelina'
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border bg-panel text-text-secondary hover:bg-surface'
                      }`}
                    >
                      <img src={avatarThumb} alt="安洁莉娜" className="h-8 w-8 rounded-full object-cover shadow-glow" />
                      <span className="font-medium">安洁莉娜</span>
                      <span className="text-[10.5px] leading-tight text-muted">五态立绘 · 角色人设</span>
                    </button>
                    {/* 自定义包 */}
                    {skins.map((s) => {
                      const thumb = skinSlotUrl(s, 'idle') || skinSlotUrl(s, 'avatar')
                      const active = cfg.theme.skin === `custom:${s.id}`
                      return (
                        <button
                          key={s.id}
                          onClick={() => void applySkin(`custom:${s.id}`)}
                          aria-pressed={active}
                          className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs transition-colors ${
                            active
                              ? 'border-accent bg-accent/10 text-accent'
                              : 'border-border bg-panel text-text-secondary hover:bg-surface'
                          }`}
                        >
                          {thumb ? (
                            <img src={thumb} alt={s.name} className="h-8 w-8 rounded-full border border-border object-cover" />
                          ) : (
                            <Sparkles className="h-8 w-8" />
                          )}
                          <span className="max-w-full truncate font-medium">{s.name}</span>
                          <span className="text-[10.5px] leading-tight text-muted">自定义包</span>
                        </button>
                      )
                    })}
                  </div>

                  {/* 新建自定义包 */}
                  <div className="mt-2.5 flex items-center gap-2">
                    <input
                      className={`${inputCls} max-w-52`}
                      placeholder="新主题包名称（如：我的猫）"
                      maxLength={30}
                      value={newSkinName}
                      onChange={(e) => setNewSkinName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newSkinName.trim()) void createSkin()
                      }}
                    />
                    <button
                      onClick={() => void createSkin()}
                      disabled={!newSkinName.trim()}
                      className="flex items-center gap-1 rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" /> 新建主题包
                    </button>
                  </div>

                  {/* 自定义包管理：逐槽位上传 / 重命名 / 删除 */}
                  {skins.length > 0 && (
                    <div className="mt-2.5 space-y-2">
                      {skins.map((s) => (
                        <div key={s.id} className="rounded-xl border border-border/70 bg-surface/40 p-3">
                          <div className="flex items-center gap-2">
                            {renamingSkin?.id === s.id ? (
                              <>
                                <input
                                  autoFocus
                                  className="w-40 rounded-md border border-border bg-panel px-2 py-1 text-[13px] text-text"
                                  value={renamingSkin.name}
                                  maxLength={30}
                                  onChange={(e) => setRenamingSkin({ id: s.id, name: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') void renameSkin(s.id, renamingSkin.name)
                                    if (e.key === 'Escape') setRenamingSkin(null)
                                  }}
                                />
                                <button
                                  aria-label="保存重命名"
                                  title="保存"
                                  onClick={() => void renameSkin(s.id, renamingSkin.name)}
                                  className="rounded-md p-1 text-muted transition-colors hover:bg-surface-hover/70 hover:text-accent"
                                >
                                  <Check className="h-4 w-4" />
                                </button>
                                <button
                                  aria-label="取消重命名"
                                  title="取消"
                                  onClick={() => setRenamingSkin(null)}
                                  className="rounded-md p-1 text-muted transition-colors hover:bg-surface-hover/70"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="text-[13px] font-medium text-text">{s.name}</span>
                                <button
                                  aria-label={`重命名主题包 ${s.name}`}
                                  title="重命名"
                                  onClick={() => setRenamingSkin({ id: s.id, name: s.name })}
                                  className="rounded-md p-1 text-muted transition-colors hover:bg-surface-hover/70 hover:text-accent"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                            <div className="ml-auto">
                              <button
                                aria-label={`删除主题包 ${s.name}`}
                                title="删除（正在使用会回退普通主题）"
                                onClick={() => void removeSkin(s)}
                                className="rounded-md p-1 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {SKIN_SLOT_LABELS.map(([slot, label]) => {
                              const url = skinSlotUrl(s, slot)
                              return (
                                <div key={slot} className="relative">
                                  <button
                                    aria-label={`上传${label}图片`}
                                    title={url ? `替换「${label}」图片` : `上传「${label}」图片`}
                                    onClick={() => void uploadSkinSlot(s.id, slot)}
                                    className={`flex h-16 w-16 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border text-[10px] transition-colors ${
                                      url
                                        ? 'border-border bg-panel hover:border-accent/50'
                                        : 'border-dashed border-border bg-panel/60 text-muted hover:border-accent/50 hover:text-accent'
                                    }`}
                                  >
                                    {url ? (
                                      <img src={url} alt={label} className="h-full w-full object-cover" />
                                    ) : (
                                      <>
                                        <ImagePlus className="h-4 w-4" />
                                        {label}
                                      </>
                                    )}
                                  </button>
                                  {url && (
                                    <button
                                      aria-label={`清空${label}槽位`}
                                      title="清空该槽位"
                                      onClick={() => void clearSkinSlot(s.id, slot)}
                                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-panel text-muted shadow-sm transition-colors hover:text-danger"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                      <p className="text-[11px] leading-relaxed text-muted/70">
                        自定义包只需上传一张「待机」动图/图片即可使用，其余状态未上传时回退待机图；名字会显示在立绘下方，状态文案保持中性。单图 ≤5MB（png / gif / jpg / webp）。
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <span className="mb-1.5 block text-xs text-muted">主题模式</span>
                  <div className="flex gap-2">
                    {(
                      [
                        ['light', '☀️ 浅色'],
                        ['dark', '🌙 深色'],
                        ['auto', '🖥️ 跟随系统']
                      ] as Array<[ThemeConfig['mode'], string]>
                    ).map(([m, label]) => (
                      <button
                        key={m}
                        onClick={() => updateTheme({ mode: m })}
                        className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                          cfg.theme.mode === m
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border bg-panel text-text-secondary hover:bg-surface'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted/70">
                    「跟随系统」随 Windows 亮暗自动切换，两个窗口实时同步；其余色阶由主色经 colord 自动推导。
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm">
                    <span className="mb-1.5 block text-xs text-muted">主色 accent（按钮/高亮/链接）</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-panel p-1"
                        value={cfg.theme.accent}
                        onChange={(e) => updateTheme({ accent: e.target.value })}
                      />
                      <input
                        className="flex-1 rounded-lg border border-border bg-panel px-2.5 py-1.5 font-mono text-xs text-text"
                        value={cfg.theme.accent}
                        spellCheck={false}
                        onChange={(e) => {
                          const v = e.target.value.trim()
                          if (/^#[0-9a-fA-F]{6}$/.test(v)) updateTheme({ accent: v })
                        }}
                      />
                    </div>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1.5 block text-xs text-muted">辅色 accent2（渐变/图谱/次要高亮）</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-panel p-1"
                        value={cfg.theme.accent2}
                        onChange={(e) => updateTheme({ accent2: e.target.value })}
                      />
                      <input
                        className="flex-1 rounded-lg border border-border bg-panel px-2.5 py-1.5 font-mono text-xs text-text"
                        value={cfg.theme.accent2}
                        spellCheck={false}
                        onChange={(e) => {
                          const v = e.target.value.trim()
                          if (/^#[0-9a-fA-F]{6}$/.test(v)) updateTheme({ accent2: v })
                        }}
                      />
                    </div>
                  </label>
                </div>

                {/* 实时预览卡片（内联 style 即时反馈，不等防抖） */}
                <div className="rounded-xl border border-border bg-panel p-4">
                  <span className="mb-2 block text-xs text-muted">实时预览</span>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-white"
                      style={{ background: cfg.theme.accent }}
                    >
                      主色按钮
                    </button>
                    <button
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-white"
                      style={{ background: cfg.theme.accent2 }}
                    >
                      辅色按钮
                    </button>
                    <span
                      className="rounded-full px-2.5 py-1 text-[10.5px]"
                      style={{ background: `${cfg.theme.accent}22`, color: cfg.theme.accent }}
                    >
                      标签（浅色底）
                    </span>
                    <span
                      className="rounded border px-2.5 py-1 text-[10.5px]"
                      style={{ borderColor: `${cfg.theme.accent}66`, color: cfg.theme.accent }}
                    >
                      描边
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-muted/70">
                    accent/accent2 决定全应用的主色调：hover 态、边框、浅色面板、光晕、图谱节点均由它们推导。
                  </p>
                </div>

                <button
                  onClick={() => updateTheme({ ...DEFAULT_THEME })}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface hover:text-accent"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  恢复默认配色（浅色 + 品牌粉蓝）
                </button>
              </section>
            )}

            {/* ---------- 系统提示词 ---------- */}
            {tab === 'system' && (
              <section>
                {(() => {
                  const skinName =
                    cfg.theme.skin === 'angelina'
                      ? '安洁莉娜'
                      : cfg.theme.skin.startsWith('custom:')
                        ? skins.find((s) => `custom:${s.id}` === cfg.theme.skin)?.name || '自定义主题包'
                        : '普通主题'
                  return (
                    <>
                      <h3 className="mb-3 text-[15px] font-medium text-text">提示词</h3>
                      <p className="mb-3 text-[11.5px] text-muted">
                        模式已合并：AI 以当前主题包「{skinName}」的形象与人设陪伴聊天，同时保留完整工具能力为你「跑腿」。此提示词可自由修改或扩写；工具清单与执行规则会在运行时自动附加。切换主题包时会在外观设置里询问是否联动切换人设。
                      </p>
                      <h3 className="mb-1.5 text-[15px] font-medium text-text">
                        {cfg.theme.skin === 'plain' ? '助手人设' : `主题包人设（${skinName}）`}
                      </h3>
                    </>
                  )
                })()}
                <textarea
                  className="h-52 w-full rounded-xl border border-border bg-panel px-3 py-2.5 text-sm leading-relaxed text-text"
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
                <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-surface/40 p-3.5 text-[11.5px] text-muted">
                  <FolderOpen className="h-4 w-4 shrink-0 text-accent" />
                  <span className="truncate" title={dataDir}>
                    数据目录: <span className="font-mono text-text-secondary">{dataDir}</span>
                  </span>
                </div>
              </section>
            )}

            {/* ---------- 工具 ---------- */}
            {tab === 'tools' && (
              <section>
                <h3 className="mb-3 text-[15px] font-medium text-text">已加载工具（{tools.length}）</h3>
                {(['builtin', 'skill', 'mcp'] as const).map((src) =>
                  toolsBySource[src].length ? (
                    <div key={src} className="mb-3.5">
                      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-muted">
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[10px] ${
                            src === 'builtin'
                              ? 'bg-accent/10 text-accent'
                              : src === 'skill'
                                ? 'bg-purple/15 text-purple'
                                : 'bg-info/15 text-info'
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
                                ? 'bg-danger/10 text-danger ring-1 ring-danger/20'
                                : 'bg-surface text-text-secondary'
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
              className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface"
            >
              取消
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-accent to-accent2 px-4 py-2 text-sm font-medium text-accent-fg shadow-glow transition-opacity hover:opacity-90 disabled:opacity-50 disabled:shadow-none"
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
