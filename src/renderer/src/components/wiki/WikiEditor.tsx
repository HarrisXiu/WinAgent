import { useState, useCallback, useRef } from 'react'
import { Edit3, Eye, Save, X, Trash2, Loader2, MessageSquarePlus, FileCode2, FileText, ImageIcon } from 'lucide-react'
import CodeMirrorEditor, { type CodeMirrorEditorHandle } from './CodeMirrorEditor'
import MarkdownPreview from './MarkdownPreview'
import type { NoteContent, NoteData } from '../../../../shared/types'

interface Props {
  note: NoteContent | null
  editing: boolean
  allNoteTitles: string[]
  /** 只读模式（raw 层原始文件，LLM Wiki 不可变原则） */
  readonly?: boolean
  onSave: (data: NoteData) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onDelete: (path: string) => void
  onLinkClick: (target: string) => void
  onAddAnnotation: (text: string, range: string) => void
}

export default function WikiEditor({
  note, editing, allNoteTitles, readonly = false,
  onSave, onStartEdit, onCancelEdit, onDelete, onLinkClick,
  onAddAnnotation
}: Props): JSX.Element {
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editTags, setEditTags] = useState('')
  const [previewMode, setPreviewMode] = useState(false)
  const [saving, setSaving] = useState(false)
  // 只读模式：源码/渲染视图切换
  const [rawSourceView, setRawSourceView] = useState(false)

  const cmRef = useRef<CodeMirrorEditorHandle>(null)

  // 添加注释（CM6 的选中文本必须通过 view.state 获取，window.getSelection 取不到）
  const handleAddAnnotation = useCallback(() => {
    let selectedText = ''
    if (cmRef.current) {
      selectedText = cmRef.current.getSelectionText().trim()
    } else {
      selectedText = window.getSelection()?.toString().trim() || ''
    }
    if (!selectedText) {
      alert('请先在编辑器中选中一段文本')
      return
    }
    const text = prompt('请输入注释内容:', '')
    if (!text || !text.trim()) return

    // 生成位置标识
    const range = `selection:${selectedText.slice(0, 40).replace(/\s+/g, '_')}`
    onAddAnnotation(text.trim(), range)
  }, [onAddAnnotation])

  // 进入编辑模式时初始化编辑器状态
  const handleStartEdit = useCallback(() => {
    if (note) {
      setEditTitle(note.title)
      setEditBody(note.rawBody)
      setEditTags(note.tags.join(', '))
    }
    onStartEdit()
  }, [note, onStartEdit])

  const handleSave = useCallback(async () => {
    if (!note) return
    setSaving(true)
    try {
      await onSave({
        title: editTitle || note.title,
        tags: editTags.split(',').map((t) => t.trim()).filter(Boolean),
        body: editBody
      })
    } finally {
      setSaving(false)
    }
  }, [note, editTitle, editTags, editBody, onSave])

  const togglePreview = useCallback(() => {
    setPreviewMode((p) => !p)
  }, [])

  // 空状态
  if (!note) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div className="mb-3 rounded-2xl bg-gradient-to-br from-accent/10 to-accent2/10 p-4">
          <Edit3 className="h-8 w-8 text-accent/50" />
        </div>
        <h3 className="mb-1 text-[15px] font-medium text-gray-600">选择或创建一篇笔记</h3>
        <p className="max-w-xs text-[13px] leading-relaxed text-muted">
          从左侧文件树中选择笔记开始编辑，拖拽文件到此处自动编译到知识库
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        {editing ? (
          <input
            className="flex-1 rounded-lg border border-border bg-white px-3 py-1.5 text-[15px] font-semibold text-gray-700 outline-none focus:border-accent/50"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="笔记标题"
            autoFocus
          />
        ) : (
          <h2 className="flex-1 truncate text-[16px] font-semibold text-gray-700">{note.title}</h2>
        )}

        {/* 标签显示 */}
        {!editing && note.tags.length > 0 && (
          <div className="flex items-center gap-1.5">
            {note.tags.map((tag) => (
              <span key={tag} className="wiki-tag">{tag}</span>
            ))}
          </div>
        )}

        {/* 只读徽标（raw 层原始文件） */}
        {readonly && (
          <span
            className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600"
            title="原始来源遵循不可变原则，仅可浏览"
          >
            📥 原始来源 · 只读
          </span>
        )}

        <div className="flex items-center gap-1">
          {readonly ? (
            <button
              onClick={() => setRawSourceView((v) => !v)}
              title={rawSourceView ? '渲染预览' : '查看原文源码'}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                rawSourceView ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-pink-100/70 hover:text-accent'
              }`}
            >
              {rawSourceView ? <Eye className="h-4 w-4" /> : <FileCode2 className="h-4 w-4" />}
            </button>
          ) : editing ? (
            <>
              <button
                onClick={handleAddAnnotation}
                title="选中文本后添加注释"
                className="flex items-center gap-1 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
                注释
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                title="保存"
                className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                保存
              </button>
              <button
                onClick={onCancelEdit}
                title="取消"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-pink-100/70 hover:text-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={togglePreview}
                title={previewMode ? '编辑' : '预览'}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                  previewMode ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-pink-100/70 hover:text-accent'
                }`}
              >
                {previewMode ? <Edit3 className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <button
                onClick={handleStartEdit}
                title="编辑"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-pink-100/70 hover:text-accent"
              >
                <Edit3 className="h-4 w-4" />
              </button>
              <button
                onClick={() => onDelete(note.path)}
                title="删除"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-red-100 hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 标签编辑行 */}
      {editing && (
        <div className="border-b border-border px-4 py-2">
          <input
            className="w-full rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-gray-600 outline-none focus:border-accent/50"
            value={editTags}
            onChange={(e) => setEditTags(e.target.value)}
            placeholder="标签（逗号分隔，如：技术, Rust, 笔记）"
          />
        </div>
      )}

      {/* 编辑器 / 预览 */}
      <div className="flex min-h-0 flex-1">
        {readonly ? (
          // 只读模式（raw 层不可变）：文本文件可渲染预览/源码切换，二进制文件显示占位
          isBinaryFile(note.path) ? (
            <div className="flex h-full flex-col items-center justify-center text-center px-6">
              <div className="mb-3 rounded-2xl bg-accent/10 p-4">
                {isImageFile(note.path) ? (
                  <ImageIcon className="h-8 w-8 text-accent/50" />
                ) : (
                  <FileText className="h-8 w-8 text-accent/50" />
                )}
              </div>
              <h3 className="mb-1 text-[15px] font-medium text-gray-600">{note.title}</h3>
              <p className="mt-2 max-w-xs text-[12px] leading-relaxed text-muted">
                {isImageFile(note.path)
                  ? '这是原始图片文件（raw 层只读），可在文件管理器中打开查看。相关分析已编译到 wiki/sources/。'
                  : '这是二进制文档（raw 层只读），请用对应软件打开查看。相关分析已编译到 wiki/sources/。'}
              </p>
            </div>
          ) : rawSourceView ? (
            <div className="flex-1 overflow-auto bg-white/40 p-4">
              <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-gray-600">
                {note.rawBody}
              </pre>
            </div>
          ) : (
            <div className="flex-1">
              <MarkdownPreview
                content={note.rawBody}
                notePath={note.path}
                onLinkClick={onLinkClick}
              />
            </div>
          )
        ) : (
          <>
            {editing || !previewMode ? (
              <div className={`wiki-editor flex-1 ${previewMode && editing ? 'border-r border-border' : ''}`}>
                {editing ? (
                  <CodeMirrorEditor
                    ref={cmRef}
                    value={editBody}
                    onChange={setEditBody}
                    placeholder="开始写作… Use [[wiki links]] 和 **Markdown** 格式"
                    noteTitles={allNoteTitles}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted">
                    点击 <Edit3 className="mx-1 inline h-4 w-4" /> 编辑按钮开始编辑
                  </div>
                )}
              </div>
            ) : null}

            {/* 预览面板 */}
            {(previewMode || !editing) && (
              <div className={`min-h-0 ${editing && previewMode ? 'w-1/2' : 'flex-1'}`}>
                <MarkdownPreview
                  content={editing ? editBody : note.rawBody}
                  notePath={note.path}
                  onLinkClick={onLinkClick}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** 判断是否为二进制文件（无法按文本渲染） */
function isBinaryFile(p: string): boolean {
  const ext = p.split('.').pop()?.toLowerCase() || ''
  return ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(`.${ext}`)
}

function isImageFile(p: string): boolean {
  return isBinaryFile(p)
}
