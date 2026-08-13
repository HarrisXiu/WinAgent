import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, FileText, Loader2, Sparkles, Tag, X } from 'lucide-react'
import type { AnalysisTag, ImportAnalyzeResult } from '../../../../shared/types'

export interface ImportAnalyzeFile {
  name: string
  path: string
}

interface Props {
  files: ImportAnalyzeFile[]
  tags: AnalysisTag[]
  /** 取消 = 不导入任何文件 */
  onClose: () => void
  /** 流程结束（done 渐隐后或手动关闭） */
  onDone: (r: ImportAnalyzeResult) => void
}

interface FileProgress {
  percent: number
  stage?: string
}

/**
 * 拖入文件后的分析要求弹窗：
 * edit（选 tag / 输入要求）→ running（编译 + 定制分析进度）→ done（结果摘要，5 秒渐隐）。
 */
export default function ImportAnalyzeDialog({ files, tags, onClose, onDone }: Props): JSX.Element {
  const [phase, setPhase] = useState<'edit' | 'running' | 'done'>('edit')
  const [leaving, setLeaving] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [progress, setProgress] = useState<Record<string, FileProgress>>({})
  const [result, setResult] = useState<ImportAnalyzeResult | null>(null)
  const [error, setError] = useState('')
  const timersRef = useRef<number[]>([])

  // 组件卸载时清理定时器（防止拖入新文件后旧弹窗的 onDone 误关新弹窗）
  useEffect(() => {
    const timers = timersRef.current
    return () => { timers.forEach((t) => clearTimeout(t)) }
  }, [])

  // 订阅编译与定制分析进度
  useEffect(() => {
    const off1 = window.winagent.wiki.onIngestProgress((p) => {
      setProgress((prev) => ({ ...prev, [p.file]: { percent: p.percent, stage: p.stage } }))
    })
    const off2 = window.winagent.wiki.onCustomProgress((p) => {
      setProgress((prev) => ({ ...prev, [p.file]: { percent: p.percent, stage: p.stage } }))
    })
    return () => { off1(); off2() }
  }, [])

  /** 多选 tag：选中即把 template 追加进输入框（可编辑）；取消选中不自动删文本（避免误删用户编辑） */
  const toggleTag = (t: AnalysisTag): void => {
    setSelectedTags((prev) =>
      prev.includes(t.tag) ? prev.filter((x) => x !== t.tag) : [...prev, t.tag]
    )
    setPrompt((prev) => {
      if (prev.includes(t.template)) return prev
      return prev.trim() ? `${prev}\n${t.template}` : t.template
    })
  }

  /** 提交：skipAnalysis = 直接编译入库（跳过定制分析） */
  const submit = async (skipAnalysis: boolean): Promise<void> => {
    if (phase !== 'edit') return
    setPhase('running')
    setError('')
    try {
      const r = await window.winagent.wiki.importAnalyze(
        files.map((f) => f.path),
        skipAnalysis ? '' : prompt.trim()
      )
      setResult(r)
      setPhase('done')
      // 5 秒后渐隐，300ms 过渡结束再关闭
      timersRef.current.push(window.setTimeout(() => setLeaving(true), 5000))
      timersRef.current.push(window.setTimeout(() => onDone(r), 5300))
    } catch (err: any) {
      setError(err.message || '导入失败')
      setPhase('edit')
    }
  }

  const closeNow = (): void => {
    if (result) onDone(result)
    else onClose()
  }

  return (
    <div
      className={`fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm transition-all duration-300 ${leaving ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className={`w-full max-w-lg rounded-2xl border border-border bg-panel p-5 shadow-2xl transition-all duration-300 ${leaving ? 'translate-y-2 opacity-0' : ''}`}>
        {phase === 'edit' && (
          <>
            <div className="mb-3 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10">
                <Sparkles className="h-5 w-5 text-accent" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-semibold text-text">要如何分析这些文件？</h3>
                <p className="truncate text-[12px] text-muted">{files.map((f) => f.name).join('、')}</p>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-text" title="取消导入">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-3 max-h-40 overflow-auto rounded-xl border border-border bg-surface/40 p-2.5">
              {files.map((f) => (
                <div key={f.path} className="flex items-center gap-2 px-1 py-0.5 text-[13px] text-text-secondary">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted" />
                  <span className="min-w-0 truncate">{f.name}</span>
                </div>
              ))}
            </div>

            {/* 已有分析 tag（多选，填入输入框可编辑） */}
            <div className="mb-3">
              {tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => {
                    const active = selectedTags.includes(t.tag)
                    return (
                      <button
                        key={t.tag}
                        onClick={() => toggleTag(t)}
                        className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                          active
                            ? 'border-accent/50 bg-accent/10 text-accent'
                            : 'border-border bg-surface/40 text-text-secondary hover:bg-surface'
                        }`}
                        title={t.template}
                      >
                        <Tag className="h-3 w-3" />
                        {t.tag}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="text-[12px] text-muted">暂无历史分析 tag（完成分析后 AI 会自动归纳）</p>
              )}
            </div>

            <textarea
              className="h-24 w-full resize-none rounded-xl border border-border bg-surface/40 px-3 py-2 text-[13px] leading-relaxed text-text outline-none focus:border-accent/50"
              placeholder="例如：总结本文核心论点，并与知识库已有内容对比"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(false) } }}
              autoFocus
            />

            {error && (
              <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[12px] text-danger">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0">{error}</span>
              </div>
            )}

            <div className="mt-3 flex items-center justify-between gap-2">
              <button onClick={onClose} className="rounded-lg border border-border px-4 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface">
                取消
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => { void submit(true) }}
                  className="rounded-lg border border-border px-4 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface"
                  title="只编译进知识库，不做定制分析"
                >
                  直接编译入库
                </button>
                <button
                  onClick={() => { void submit(false) }}
                  disabled={!prompt.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-accent to-accent2 px-4 py-1.5 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  开始分析
                </button>
              </div>
            </div>
          </>
        )}

        {phase === 'running' && (
          <>
            <div className="mb-3 flex items-center gap-2.5">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
              <h3 className="text-[15px] font-semibold text-text">正在编译并分析…</h3>
            </div>
            <div className="space-y-2">
              {files.map((f) => {
                const p = progress[f.name] || { percent: 0, stage: '等待处理…' }
                return (
                  <div key={f.path} className="rounded-xl border border-border bg-surface/40 px-3 py-2">
                    <div className="mb-1 flex items-center justify-between gap-2 text-[12.5px]">
                      <span className="min-w-0 truncate text-text">{f.name}</span>
                      <span className="shrink-0 text-muted">{p.stage} {p.percent}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-border/50">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-accent to-accent2 transition-all duration-300"
                        style={{ width: `${p.percent}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="mt-3 text-center text-[12px] text-muted">处理期间请勿关闭窗口</p>
          </>
        )}

        {phase === 'done' && result && (
          <div className={`rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-[13px] text-success`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                导入完成
              </div>
              <button onClick={closeNow} className="rounded-lg p-1 text-muted transition-colors hover:bg-success/10 hover:text-success" title="关闭">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1.5">
              {result.files.map((f) => (
                <div key={f.name} className="text-[12.5px] leading-relaxed">
                  {f.ingestError ? (
                    <span>✗ {f.name}：{f.ingestError}</span>
                  ) : f.analysisError ? (
                    <span>⚠ {f.name}：已编译，定制分析失败：{f.analysisError}</span>
                  ) : (
                    <span>✓ {f.name} → {f.sourcePath}</span>
                  )}
                  {f.analysis?.summary && (
                    <div className="mt-0.5 pl-4 text-muted">{f.analysis.summary.slice(0, 80)}{f.analysis.summary.length > 80 ? '…' : ''}</div>
                  )}
                </div>
              ))}
              {result.newTags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 pt-1 text-[12px]">
                  <span className="text-muted">已归纳分析 tag：</span>
                  {result.newTags.map((t) => (
                    <span key={t.tag} className="flex items-center gap-0.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5">
                      <Tag className="h-3 w-3" />
                      {t.tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
