import { useState, useCallback, useEffect } from 'react'
import { GitGraph, X } from 'lucide-react'
import WikiSidebar from './WikiSidebar'
import WikiEditor from './WikiEditor'
import WikiRightPanel from './WikiRightPanel'
import GraphView from './GraphView'
import { useWiki } from '../../lib/useWiki'
import type { NoteMeta, GraphData, AISuggestion } from '../../../../shared/types'

interface Props {
  onSwitchVaultPath: () => void
  /** 紧凑模式：默认关闭右侧详情面板，适合在侧边栏中展示 */
  compact?: boolean
}

export default function WikiLayout({ onSwitchVaultPath, compact }: Props): JSX.Element {
  const wiki = useWiki()
  const [dragOver, setDragOver] = useState(false)
  const [showRightPanel, setShowRightPanel] = useState(!compact)
  const [showGraph, setShowGraph] = useState(false)
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [backlinks, setBacklinks] = useState<Array<{ path: string; title: string }>>([])

  // AI 分析状态
  const [aiSuggestion, setAiSuggestion] = useState<AISuggestion | null>(null)
  const [aiAnalyzing, setAiAnalyzing] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  // INGEST 处理状态（拖拽编译）
  const [ingestMsg, setIngestMsg] = useState<{ text: string; ok: boolean; percent?: number } | null>(null)

  // 订阅 INGEST 进度
  useEffect(() => {
    return window.winagent.wiki.onIngestProgress((p) => {
      setIngestMsg((m) =>
        m && !m.ok
          ? { ...m, text: `${p.stage} ${p.file}`, percent: p.percent, ok: true }
          : m
      )
    })
  }, [])

  // 获取所有笔记标题（用于 [[wiki link]] 自动补全）
  const allNoteTitles = getAllTitles(wiki.notes)

  // 当当前笔记变化时，获取反向链接
  useEffect(() => {
    if (wiki.currentNote) {
      wiki.getBacklinks(wiki.currentNote.path).then(setBacklinks)
    } else {
      setBacklinks([])
    }
  }, [wiki.currentNote?.path])

  // 打开图谱时加载数据
  const handleToggleGraph = useCallback(async () => {
    if (!showGraph) {
      const data = await wiki.loadGraph()
      setGraphData(data)
      setShowGraph(true)
    } else {
      setShowGraph(false)
    }
  }, [showGraph, wiki])

  const handleGraphNodeClick = useCallback((nodeId: string) => {
    const notePath = nodeId.endsWith('.md') ? nodeId : `${nodeId}.md`
    wiki.openNote(notePath)
  }, [wiki])

  const handleAddTag = useCallback(async (tag: string) => {
    if (!wiki.currentNote) return
    const newTags = [...new Set([...wiki.currentNote.tags, tag])]
    await wiki.saveNote({
      title: wiki.currentNote.title,
      body: wiki.currentNote.rawBody,
      tags: newTags
    })
  }, [wiki])

  const handleRemoveTag = useCallback(async (tag: string) => {
    if (!wiki.currentNote) return
    const newTags = wiki.currentNote.tags.filter((t) => t !== tag)
    await wiki.saveNote({
      title: wiki.currentNote.title,
      body: wiki.currentNote.rawBody,
      tags: newTags
    })
  }, [wiki])

  // AI 分析
  const handleAnalyze = useCallback(async () => {
    if (!wiki.currentNote || aiAnalyzing) return
    setAiAnalyzing(true)
    setAiError(null)
    setAiSuggestion(null)
    try {
      const result = await window.winagent.wiki.aiAnalyze(wiki.currentNote.path)
      setAiSuggestion(result)
    } catch (err: any) {
      setAiError(err.message || 'AI 分析失败')
    } finally {
      setAiAnalyzing(false)
    }
  }, [wiki.currentNote?.path, aiAnalyzing])

  const handleCancelAi = useCallback(() => {
    window.winagent.wiki.aiCancel()
    setAiAnalyzing(false)
  }, [])

  // 注释管理
  const handleAddAnnotation = useCallback(async (text: string, range: string) => {
    if (!wiki.currentNote) return
    await wiki.addAnnotation(text, range)
    // addAnnotation 内部已调用 openNote 刷新 currentNote
  }, [wiki])

  const handleRemoveAnnotation = useCallback(async (id: string) => {
    if (!wiki.currentNote) return
    await wiki.removeAnnotation(id)
  }, [wiki])

  // 当打开新的笔记时清空 AI 结果
  useEffect(() => {
    setAiSuggestion(null)
    setAiError(null)
  }, [wiki.currentNote?.path])

  // 全局拖拽处理
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget === e.target) {
      setDragOver(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)

    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    for (const file of Array.from(files)) {
      const filePath = (file as any).path
      if (!filePath) continue
      try {
        // 导入到 raw/ 分类目录
        const relPath = await wiki.importFile(filePath)
        // 所有源文件立即触发 INGEST（md/txt/pdf 分析内容，图片创建基础来源页）
        setIngestMsg({ text: `正在编译 ${file.name}…`, ok: true })
        try {
          const result = await window.winagent.wiki.ingest(relPath)
          const total = result.created.length + result.updated.length
          setIngestMsg({ text: `✓ 已编译: ${result.sourcePath} + ${total} 个页面`, ok: true })
          // 打开编译后的来源页
          wiki.openNote(result.sourcePath)
        } catch (err: any) {
          console.error('INGEST 失败:', err)
          setIngestMsg({ text: `✗ INGEST 失败: ${err.message || 'AI 分析错误'}（文件已保存在 raw/，可稍后重试）`, ok: false })
          wiki.openNote(relPath)
        }
      } catch (err: any) {
        console.error('导入文件失败:', err)
        setIngestMsg({ text: `✗ 导入失败: ${err.message || '无法读取该文件'}`, ok: false })
      }
    }
  }, [wiki])

  // 处理 Wiki 链接点击
  const handleLinkClick = useCallback(async (target: string) => {
    const targetMd = target.endsWith('.md') ? target : `${target}.md`
    const findNote = (notes: NoteMeta[], targetPath: string): NoteMeta | null => {
      for (const n of notes) {
        if (n.path === targetPath || n.path.replace(/\.md$/, '') === target) return n
        if (n.children) {
          const found = findNote(n.children, targetPath)
          if (found) return found
        }
      }
      return null
    }
    const note = findNote(wiki.notes, targetMd)
    if (note) {
      wiki.openNote(note.path)
    } else {
      const title = target.replace(/\.md$/, '')
      await wiki.createNote(targetMd, title)
    }
  }, [wiki])

  // raw 层只读（LLM Wiki 不可变原则）
  const readonly = !!wiki.currentNote && wiki.currentNote.path.startsWith('raw/')

  return (
    <div
      className="flex min-h-0 flex-1 relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 左侧边栏 */}
      <WikiSidebar
        vaultPath={wiki.vaultPath}
        notes={wiki.notes}
        selectedPath={wiki.selectedPath}
        searchResults={wiki.searchResults}
        onSelectNote={wiki.openNote}
        onCreateNote={async () => {
          // 新建笔记固定到 wiki/ 根（用户手写页面），标题 sanitize 防止嵌套目录
          const title = `新笔记 ${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}`
          const name = `${title.replace(/[\\/:*?"<>|]/g, '-')}.md`
          await wiki.createNote(`wiki/${name}`, title)
        }}
        onDeleteNote={async (path) => {
          if (confirm(`确定删除 "${path}"？`)) {
            await wiki.deleteNote(path)
          }
        }}
        onSearch={wiki.search}
        onSetVaultPath={onSwitchVaultPath}
        onToggleRightPanel={() => setShowRightPanel((v) => !v)}
        showRightPanel={showRightPanel}
        onToggleGraph={handleToggleGraph}
        showGraph={showGraph}
      />

      {/* 中央编辑区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <WikiEditor
          note={wiki.currentNote}
          editing={wiki.editing}
          allNoteTitles={allNoteTitles}
          readonly={readonly}
          onSave={wiki.saveNote}
          onStartEdit={wiki.startEditing}
          onCancelEdit={wiki.cancelEditing}
          onDelete={async (path) => {
            if (confirm(`确定删除 "${path}"？此操作不可撤销。`)) {
              await wiki.deleteNote(path)
            }
          }}
          onLinkClick={handleLinkClick}
          onAddAnnotation={handleAddAnnotation}
        />

        {/* 简易状态栏 */}
        {wiki.currentNote && (
          <div className="wiki-statusbar">
            <span>{wiki.currentNote.path}</span>
            <span>·</span>
            <span>{wiki.currentNote.rawBody.length} 字</span>
            {readonly && (
              <>
                <span>·</span>
                <span className="text-amber-500">📥 原始来源（只读）</span>
              </>
            )}
            {wiki.currentNote.tags.length > 0 && (
              <>
                <span>·</span>
                <span>{wiki.currentNote.tags.length} 个标签</span>
              </>
            )}
            {wiki.currentNote.links.length > 0 && (
              <>
                <span>·</span>
                <span>{wiki.currentNote.links.length} 个链接</span>
              </>
            )}
            <span className="ml-auto flex items-center gap-2 text-[11px]">
              <button
                onClick={handleToggleGraph}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
                  showGraph ? 'bg-accent/15 text-accent' : 'text-muted/60 hover:text-accent'
                }`}
                title="量子关系图谱"
              >
                <GitGraph className="h-3.5 w-3.5" />
                图谱
              </button>
              {!readonly && <span>Ctrl+S 保存 · [[wiki链接]]</span>}
            </span>
          </div>
        )}
      </div>

      {/* 右侧面板 */}
      {showRightPanel && (
        <WikiRightPanel
          currentNote={wiki.currentNote}
          allTags={wiki.tags}
          backlinks={backlinks}
          allNotes={wiki.notes}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onNavigate={wiki.openNote}
          onClose={() => setShowRightPanel(false)}
          onAnalyze={handleAnalyze}
          onCancelAi={handleCancelAi}
          aiSuggestion={aiSuggestion}
          aiAnalyzing={aiAnalyzing}
          aiError={aiError}
          annotations={wiki.currentNote?.annotations || []}
          onRemoveAnnotation={handleRemoveAnnotation}
        />
      )}

      {/* 浮动量子图谱 — 渲染在 flex 容器之上 */}
      {showGraph && (
        <GraphView
          data={graphData}
          onNodeClick={handleGraphNodeClick}
          onClose={() => setShowGraph(false)}
        />
      )}

      {/* 拖拽导入遮罩 */}
      {dragOver && (
        <div
          className="wiki-drop-overlay"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="text-center">
            <div className="mb-3 text-5xl">📥</div>
            <div className="text-xl font-semibold text-white">释放文件以导入到知识库</div>
            <div className="mt-2 text-sm text-white/60">AI 将自动编译为 sources / concepts / entities 页面</div>
          </div>
        </div>
      )}

      {/* INGEST 处理结果 toast（含进度条） */}
      {ingestMsg && (
        <div
          className={`absolute right-3 top-3 z-50 w-64 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${
            ingestMsg.ok
              ? 'border-green-200 bg-green-50/95 text-green-700'
              : 'border-red-200 bg-red-50/95 text-red-600'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{ingestMsg.text}</span>
            <button
              onClick={() => setIngestMsg(null)}
              className="ml-1 shrink-0 text-muted hover:text-gray-700"
            >
              <X className="inline h-3 w-3" />
            </button>
          </div>
          {ingestMsg.ok && ingestMsg.percent !== undefined && ingestMsg.percent < 100 && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-accent/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-accent2 transition-all duration-300"
                style={{ width: `${Math.max(ingestMsg.percent, 4)}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 递归获取所有笔记标题 */
function getAllTitles(notes: import('../../../../shared/types').NoteMeta[]): string[] {
  const titles: string[] = []
  for (const n of notes) {
    if (n.kind === 'file') titles.push(n.title)
    if (n.children) titles.push(...getAllTitles(n.children))
  }
  return titles
}
