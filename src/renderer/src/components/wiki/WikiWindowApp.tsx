import { useCallback, useRef, useState } from 'react'
import {
  BookOpen, Upload, MessageSquare, HeartPulse, ScanSearch, GitMerge, HelpCircle, Link2, X,
  Loader2, Check, Sparkles, FolderOpen, FileUp
} from 'lucide-react'
import WikiLayout from './WikiLayout'
import ConfirmHighDialog, { type ConfirmHighItem } from './ConfirmHighDialog'
import { useWiki } from '../../lib/useWiki'
import type { LintWorkflowResult, NoteMeta } from '../../../../shared/types'

interface BatchState {
  phase: 'review' | 'running'
  rawFile: string
  sourcePath: string
  total: number
  doneCount: number
}

interface Toast {
  id: number
  text: string
  ok: boolean
}

let toastSeq = 0

/**
 * 知识库独立窗口（?view=wiki 渲染）。
 * 顶栏工作流按钮 + 批量摄入标定流程 + WikiLayout 三栏浏览。
 */
export default function WikiWindowApp(): JSX.Element {
  const wiki = useWiki()
  const [batch, setBatch] = useState<BatchState | null>(null)
  const [confirmHigh, setConfirmHigh] = useState<ConfirmHighItem[] | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [busy, setBusy] = useState(false)
  // 工作流对话框
  const [queryOpen, setQueryOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [urlOpen, setUrlOpen] = useState(false)
  // LINT 发现 SOURCE MODIFIED → 重新摄入提示
  const [reingestFiles, setReingestFiles] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const toast = useCallback((text: string, ok: boolean): void => {
    const id = ++toastSeq
    setToasts((prev) => [...prev, { id, text, ok }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 8000)
  }, [])

  // ==================== 批量摄入（交互式标定） ====================

  const startBatch = useCallback(async (relPaths: string[]): Promise<void> => {
    setBusy(true)
    try {
      const { rawFile, first, total } = await window.winagent.wiki.ingestBatchStart(relPaths)
      setBatch({ phase: 'review', rawFile, sourcePath: first.sourcePath, total, doneCount: 1 })
      if (first.confirmHigh?.length) setConfirmHigh(first.confirmHigh)
      await wiki.openNote(first.sourcePath)
      toast(`已编译第 1 篇（共 ${total} 篇），请对照审查编译质量`, true)
    } catch (err: any) {
      toast(`批量摄入启动失败: ${err.message || '未知错误'}`, false)
    } finally {
      setBusy(false)
    }
  }, [wiki, toast])

  /** 文件选择器批量摄入 */
  const handleFilesPicked = useCallback(async (files: FileList | File[] | null): Promise<void> => {
    if (!files || files.length === 0) return
    const relPaths: string[] = []
    for (const f of Array.from(files)) {
      const filePath = (f as any).path
      if (!filePath) continue
      try {
        relPaths.push(await wiki.importFile(filePath))
      } catch (err: any) {
        toast(`导入失败 ${f.name}: ${err.message || '无法读取该文件'}`, false)
      }
    }
    if (relPaths.length > 0) await startBatch(relPaths)
  }, [wiki, toast, startBatch])

  /** 拖拽委派（WikiLayout handleDrop 转交）：1 个走单文件快路径，多个走批量标定 */
  const handleDropFiles = useCallback(async (files: File[]): Promise<void> => {
    if (!files || files.length === 0) return
    if (files.length === 1) {
      const f = files[0]
      const filePath = (f as any).path
      if (!filePath) return
      try {
        const relPath = await wiki.importFile(filePath)
        const result = await window.winagent.wiki.ingest(relPath)
        const total = result.created.length + result.updated.length
        toast(`✓ 已编译: ${result.sourcePath} + ${total} 个页面`, true)
        if (result.confirmHigh?.length) setConfirmHigh(result.confirmHigh)
        await wiki.openNote(result.sourcePath)
      } catch (err: any) {
        toast(`INGEST 失败: ${err.message || 'AI 分析错误'}（文件已保存在 raw/，可稍后重试）`, false)
      }
    } else {
      await handleFilesPicked(files)
    }
  }, [wiki, toast, handleFilesPicked])

  const handleBatchContinue = useCallback(async (): Promise<void> => {
    setBatch((b) => (b ? { ...b, phase: 'running' } : b))
    try {
      const done = await window.winagent.wiki.ingestBatchContinue()
      if (done.confirmHigh.length > 0) setConfirmHigh(done.confirmHigh)
      const okCount = done.results.length
      const errCount = done.errors.length
      toast(`批量摄入完成：${okCount} 篇成功${errCount ? `，${errCount} 篇失败` : ''}`, errCount === 0)
      setBatch(null)
      // 打开最后一份 source 页供查看
      if (done.results.length > 0) {
        const last = done.results[done.results.length - 1]
        await wiki.openNote(last.sourcePath)
      }
    } catch (err: any) {
      toast(`批量摄入失败: ${err.message || '未知错误'}`, false)
      setBatch((b) => (b ? { ...b, phase: 'review' } : b))
    }
  }, [wiki, toast])

  const handleBatchAbort = useCallback(async (): Promise<void> => {
    await window.winagent.wiki.ingestBatchAbort()
    setBatch(null)
    toast('已停止批量摄入（文件保留在 raw/，可稍后手动编译）', true)
  }, [toast])

  /** 标定审查：「调整契约规则」→ 打开 vault 根 CLAUDE.md 编辑 */
  const handleEditContract = useCallback((): void => {
    void wiki.openNote('CLAUDE.md')
  }, [wiki])

  // ==================== 工作流按钮 ====================

  const runLint = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.winagent.wiki.workflowLint()
      if (r.ok) {
        await wiki.openNote(r.reportPath)
        if ((r as LintWorkflowResult).modifiedRawFiles?.length > 0) {
          setReingestFiles((r as LintWorkflowResult).modifiedRawFiles)
          toast('⚠ 检测到来源文件被修改，建议重新摄入', false)
        } else {
          toast(r.summary.split('\n')[0], true)
        }
      } else {
        toast(r.error || 'LINT 执行失败', false)
      }
    } catch (err: any) {
      toast(`LINT 失败: ${err.message || '未知错误'}`, false)
    } finally {
      setBusy(false)
    }
  }, [wiki, toast])

  const runReflect = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.winagent.wiki.workflowReflect()
      if (r.ok) {
        await wiki.openNote(r.reportPath)
        toast('综合分析完成，已打开 synthesis 报告', true)
      } else {
        toast(r.error || 'REFLECT 执行失败', false)
      }
    } catch (err: any) {
      toast(`REFLECT 失败: ${err.message || '未知错误'}`, false)
    } finally {
      setBusy(false)
    }
  }, [wiki, toast])

  /** 重新摄入：LINT 发现 SOURCE MODIFIED 的 raw 文件逐个重新编译 */
  const handleReingest = useCallback(async (): Promise<void> => {
    if (reingestFiles.length === 0) return
    setBusy(true)
    let ok = 0
    let fail = 0
    try {
      for (const p of reingestFiles) {
        try {
          await window.winagent.wiki.ingest(p)
          ok++
        } catch {
          fail++
        }
      }
      toast(`重新摄入完成：${ok} 个成功${fail ? `，${fail} 个失败` : ''}`, fail === 0)
      setReingestFiles([])
    } finally {
      setBusy(false)
    }
  }, [reingestFiles, toast])

  const runQuery = useCallback(async (q: string): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.winagent.wiki.workflowQuery(q)
      if (r.ok) {
        await wiki.openNote(r.reportPath)
        toast('AI 问答完成，答案已落盘 wiki/outputs/', true)
      } else {
        toast(r.error || '问答失败', false)
      }
    } catch (err: any) {
      toast(`问答失败: ${err.message || '未知错误'}`, false)
    } finally {
      setBusy(false)
      setQueryOpen(false)
    }
  }, [wiki, toast])

  const runMerge = useCallback(async (keep: string, remove: string, area: string): Promise<void> => {
    if (!keep || !remove || keep === remove) {
      toast('请选择两个不同的页面', false)
      return
    }
    setBusy(true)
    try {
      const r = await window.winagent.wiki.workflowMerge(keep, remove, area)
      if (r.ok) {
        await wiki.openNote(r.reportPath)
        toast('合并完成（wikilink 已更新，被合并页已替换为 redirect）', true)
      } else {
        toast(r.error || '合并失败', false)
      }
    } catch (err: any) {
      toast(`合并失败: ${err.message || '未知错误'}`, false)
    } finally {
      setBusy(false)
      setMergeOpen(false)
    }
  }, [wiki, toast])

  const runUrlImport = useCallback(async (url: string): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.winagent.wiki.importUrl(url)
      if (r.ok && r.relPath) {
        toast(`✓ 网页已导入并编译: ${r.relPath}`, true)
        if (r.sourcePath) await wiki.openNote(r.sourcePath)
        else await wiki.refreshNotes()
      } else {
        toast(r.error || '导入失败', false)
      }
    } catch (err: any) {
      toast(`导入失败: ${err.message || '未知错误'}`, false)
    } finally {
      setBusy(false)
      setUrlOpen(false)
    }
  }, [wiki, toast])

  // ==================== 渲染 ====================

  const iconBtn =
    'flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-gray-600 transition-colors hover:bg-pink-100/70 hover:text-accent disabled:opacity-40'

  return (
    <div className="wiki-window flex h-full flex-col bg-bg">
      {/* ================= 顶栏工具栏 ================= */}
      <header className="relative z-20 flex items-center gap-2 border-b border-border bg-white/80 px-3 py-1.5 backdrop-blur">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-700">
          <BookOpen className="h-4 w-4 text-accent" />
          知识库
        </span>
        <span className="hidden max-w-72 truncate text-[11px] text-muted lg:inline" title={wiki.vaultPath}>
          {wiki.vaultPath}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button className={iconBtn} onClick={() => fileInputRef.current?.click()} disabled={busy} title="选择多个文件批量摄入（先编译 1 篇供审查）">
            <Upload className="h-3.5 w-3.5" />
            批量摄入
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { void handleFilesPicked(e.target.files); e.target.value = '' }}
          />
          <button className={iconBtn} onClick={() => setQueryOpen(true)} disabled={busy} title="AI 问答（溯源 + Confidence Notes）">
            <MessageSquare className="h-3.5 w-3.5" />
            AI 问答
          </button>
          <button className={iconBtn} onClick={() => { void runLint() }} disabled={busy} title="健康检查（10 项）">
            <HeartPulse className="h-3.5 w-3.5" />
            健康检查
          </button>
          <button className={iconBtn} onClick={() => { void runReflect() }} disabled={busy} title="综合分析（Stage 0 反向检验 + Gap Analysis）">
            <ScanSearch className="h-3.5 w-3.5" />
            综合分析
          </button>
          <button className={iconBtn} onClick={() => setMergeOpen(true)} disabled={busy} title="去重合并两个页面">
            <GitMerge className="h-3.5 w-3.5" />
            去重合并
          </button>
          <button className={iconBtn} onClick={() => { void wiki.openNote('wiki/QUESTIONS.md') }} disabled={busy} title="开放问题队列">
            <HelpCircle className="h-3.5 w-3.5" />
            开放问题
          </button>
          <button className={iconBtn} onClick={() => setUrlOpen(true)} disabled={busy} title="URL 导入（抓取网页 → raw/clippings → 自动编译）">
            <Link2 className="h-3.5 w-3.5" />
            URL 导入
          </button>
        </div>
      </header>

      {/* ================= 标定审查条（批量摄入暂停态） ================= */}
      {batch && batch.phase === 'review' && (
        <div className="relative z-40 border-b border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50 px-4 py-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-purple-700">
              <Sparkles className="h-3.5 w-3.5" />
              第 1 篇已编译（共 {batch.total} 篇）— 请对照「编译内容 | 原文」审查质量
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => { void handleBatchContinue() }}
                disabled={busy}
                className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-purple-500 to-accent px-3 py-1 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                质量达标，继续批量 {batch.total - batch.doneCount} 篇
              </button>
              <button
                onClick={handleEditContract}
                disabled={busy}
                className="flex items-center gap-1 rounded-lg border border-accent/40 bg-white px-3 py-1 text-[12px] font-medium text-accent transition-colors hover:bg-pink-50"
                title="打开 vault 根 CLAUDE.md 编辑规则，保存后继续批量立即生效"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                调整契约规则
              </button>
              <button
                onClick={() => { void handleBatchAbort() }}
                disabled={busy}
                className="flex items-center gap-1 rounded-lg border border-border bg-white px-3 py-1 text-[12px] text-gray-600 transition-colors hover:bg-red-50 hover:text-red-500"
              >
                <X className="h-3.5 w-3.5" />
                停止
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量执行中进度条 */}
      {batch && batch.phase === 'running' && (
        <div className="relative z-40 border-b border-accent/20 bg-accent/5 px-4 py-1.5 text-[12px] text-accent">
          <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
          正在串行编译剩余文件…（已编译 {batch.doneCount}/{batch.total}）
        </div>
      )}

      {/* SOURCE MODIFIED 重新摄入提示条 */}
      {reingestFiles.length > 0 && (
        <div className="relative z-40 flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2">
          <span className="text-[12.5px] font-medium text-amber-700">
            ⚠ 检测到 {reingestFiles.length} 个来源文件被修改（SHA-256 变化），建议重新摄入
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => { void handleReingest() }}
              disabled={busy}
              className="flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <FileUp className="h-3.5 w-3.5" />
              全部重新摄入（{reingestFiles.length}）
            </button>
            <button
              onClick={() => setReingestFiles([])}
              className="rounded-lg border border-border bg-white px-3 py-1 text-[12px] text-gray-600 transition-colors hover:bg-amber-100"
            >
              忽略
            </button>
          </div>
        </div>
      )}

      {/* ================= Wiki 三栏 ================= */}
      <div className="flex min-h-0 flex-1 flex-col">
        <WikiLayout
          onSwitchVaultPath={() => toast('请在主窗口「设置 → 高级」中更换知识库路径', true)}
          onDropFiles={handleDropFiles}
        />
      </div>

      {/* ================= 对话框 ================= */}
      {queryOpen && <QueryDialog onClose={() => setQueryOpen(false)} onQuery={runQuery} />}
      {mergeOpen && <MergeDialog notes={wiki.notes} onClose={() => setMergeOpen(false)} onMerge={runMerge} />}
      {urlOpen && <UrlImportDialog onClose={() => setUrlOpen(false)} onImport={runUrlImport} />}
      {confirmHigh && (
        <ConfirmHighDialog
          items={confirmHigh}
          onClose={() => setConfirmHigh(null)}
          onDone={() => setConfirmHigh(null)}
        />
      )}

      {/* ================= toasts ================= */}
      {toasts.length > 0 && (
        <div className="fixed bottom-20 right-4 z-50 w-80 space-y-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`rounded-xl border px-4 py-3 text-[13px] shadow-lg backdrop-blur ${
                t.ok ? 'border-green-200 bg-green-50/95 text-green-700' : 'border-red-200 bg-red-50/95 text-red-600'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 leading-relaxed">{t.text}</span>
                <button onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} className="shrink-0 text-muted hover:text-gray-700">
                  <X className="inline h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ==================== AI 问答对话框 ====================

function QueryDialog({ onClose, onQuery }: { onClose: () => void; onQuery: (q: string) => Promise<void> }): JSX.Element {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (): Promise<void> => {
    if (!q.trim() || loading) return
    setLoading(true)
    await onQuery(q.trim())
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-pink-900/20 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10">
            <MessageSquare className="h-5 w-5 text-accent" />
          </div>
          <h3 className="text-[15px] font-semibold text-gray-800">AI 问答</h3>
        </div>
        <p className="mb-3 text-[12.5px] leading-relaxed text-gray-500">
          基于知识库检索回答。答案每条主张带 [[source]] 溯源，结尾附 Confidence Notes 与 Limitations，并落盘 wiki/outputs/。
        </p>
        <textarea
          className="h-24 w-full resize-none rounded-xl border border-border bg-pink-50/40 px-3 py-2 text-[13px] leading-relaxed text-gray-700 outline-none focus:border-accent/50"
          placeholder="例如：根据我的知识库，注意力机制的核心思想是什么？"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() } }}
          autoFocus
        />
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} disabled={loading} className="rounded-lg border border-border px-4 py-1.5 text-sm text-gray-600 transition-colors hover:bg-pink-50 disabled:opacity-50">
            取消
          </button>
          <button
            onClick={() => { void submit() }}
            disabled={!q.trim() || loading}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-accent to-purple-500 px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? '检索分析中…' : '提问'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ==================== 去重合并对话框 ====================

function MergeDialog({
  notes, onClose, onMerge
}: {
  notes: NoteMeta[]
  onClose: () => void
  onMerge: (keep: string, remove: string, area: string) => Promise<void>
}): JSX.Element {
  const [area, setArea] = useState<'concepts' | 'entities'>('concepts')
  const [keep, setKeep] = useState('')
  const [remove, setRemove] = useState('')

  // 从笔记树中提取 area 下的 slug 列表
  const collectSlugs = (items: NoteMeta[], prefix: string): string[] => {
    const slugs: string[] = []
    for (const n of items) {
      if (n.kind === 'file' && n.path.startsWith(`wiki/${area}/`) && n.path.endsWith('.md')) {
        slugs.push(n.path.replace(`wiki/${area}/`, '').replace(/\.md$/, ''))
      }
      if (n.children) slugs.push(...collectSlugs(n.children, prefix))
    }
    return slugs
  }
  const slugs = Array.from(new Set(collectSlugs(notes, ''))).sort()

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-pink-900/20 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100">
            <GitMerge className="h-5 w-5 text-purple-500" />
          </div>
          <h3 className="text-[15px] font-semibold text-gray-800">去重合并</h3>
        </div>
        <p className="mb-3 text-[12.5px] text-gray-500">
          保留页吸收 aliases 并集、Sources/Evolution Log 并集去重，全库 wikilink 改写，被合并页替换为 redirect。
        </p>
        <div className="mb-3 flex gap-2">
          {(['concepts', 'entities'] as const).map((a) => (
            <button
              key={a}
              onClick={() => { setArea(a); setKeep(''); setRemove('') }}
              className={`flex-1 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                area === a ? 'border-accent/50 bg-accent/10 text-accent' : 'border-border text-gray-600 hover:bg-pink-50'
              }`}
            >
              {a === 'concepts' ? '概念' : '实体'}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          <select
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-gray-700"
            value={keep}
            onChange={(e) => setKeep(e.target.value)}
          >
            <option value="">保留的主页面…</option>
            {slugs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-gray-700"
            value={remove}
            onChange={(e) => setRemove(e.target.value)}
          >
            <option value="">被合并的页面…</option>
            {slugs.filter((s) => s !== keep).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-1.5 text-sm text-gray-600 transition-colors hover:bg-pink-50">
            取消
          </button>
          <button
            onClick={() => { void onMerge(keep, remove, area) }}
            disabled={!keep || !remove}
            className="rounded-lg bg-gradient-to-br from-purple-400 to-accent px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            确认合并
          </button>
        </div>
      </div>
    </div>
  )
}

// ==================== URL 导入对话框 ====================

function UrlImportDialog({ onClose, onImport }: { onClose: () => void; onImport: (url: string) => Promise<void> }): JSX.Element {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (): Promise<void> => {
    if (!url.trim() || loading) return
    setLoading(true)
    await onImport(url.trim())
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-pink-900/20 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100">
            <Link2 className="h-5 w-5 text-blue-500" />
          </div>
          <h3 className="text-[15px] font-semibold text-gray-800">URL 导入</h3>
        </div>
        <p className="mb-3 text-[12.5px] text-gray-500">
          抓取网页正文 → 保存到 raw/clippings/（含 source_url）→ 自动 AI 编译为 sources/concepts/entities 页。
        </p>
        <input
          className="w-full rounded-xl border border-border bg-pink-50/40 px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-accent/50"
          placeholder="https://example.com/article"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }}
          autoFocus
        />
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} disabled={loading} className="rounded-lg border border-border px-4 py-1.5 text-sm text-gray-600 transition-colors hover:bg-pink-50 disabled:opacity-50">
            取消
          </button>
          <button
            onClick={() => { void submit() }}
            disabled={!url.trim() || loading}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-400 to-accent px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            {loading ? '抓取编译中…' : '导入'}
          </button>
        </div>
      </div>
    </div>
  )
}
