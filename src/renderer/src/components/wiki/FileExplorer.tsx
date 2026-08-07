import { useState } from 'react'
import { ChevronRight, ChevronDown, FileText, Folder, FolderOpen, Plus, Trash2 } from 'lucide-react'
import type { NoteMeta } from '../../../../shared/types'

interface Props {
  notes: NoteMeta[]
  selectedPath: string | null
  onSelect: (path: string) => void
  onCreate: (parentDir: string) => void
  onDelete: (path: string) => void
}

export default function FileExplorer({ notes, selectedPath, onSelect, onCreate, onDelete }: Props): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2">
      {notes.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-muted">
          还没有笔记，点击下方按钮创建第一份笔记
        </div>
      ) : (
        notes.map((note) => (
          <FileTreeNode
            key={note.path}
            note={note}
            depth={0}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onCreate={onCreate}
            onDelete={onDelete}
          />
        ))
      )}
    </div>
  )
}

interface TreeNodeProps {
  note: NoteMeta
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
  onCreate: (parentDir: string) => void
  onDelete: (path: string) => void
}

function FileTreeNode({ note, depth, selectedPath, onSelect, onCreate, onDelete }: TreeNodeProps): JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const [showDelete, setShowDelete] = useState(false)

  const isFolder = note.kind === 'folder'
  const isSelected = selectedPath === note.path
  // raw 层只读区域：不显示新建/删除操作
  const isRawArea = note.path === 'raw' || note.path.startsWith('raw/')
  const isWikiArea = note.path === 'wiki' || note.path.startsWith('wiki/')
  // 系统文件（index/log/overview/QUESTIONS）禁止删除
  const isSystemFile = ['wiki/index.md', 'wiki/log.md', 'wiki/overview.md', 'wiki/QUESTIONS.md'].includes(note.path)

  return (
    <div>
      <div
        className={`wiki-tree-item group ${isSelected ? 'active' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (isFolder) {
            setExpanded(!expanded)
          } else {
            onSelect(note.path)
          }
        }}
        onMouseEnter={() => setShowDelete(true)}
        onMouseLeave={() => setShowDelete(false)}
      >
        {isFolder ? (
          <>
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" />
            )}
            {isRawArea ? (
              <span className="text-sm">📥</span>
            ) : isWikiArea ? (
              <span className="text-sm">📚</span>
            ) : expanded ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-amber-400" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-amber-400" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5 shrink-0" />
            {isRawArea ? (
              <FileText className="h-4 w-4 shrink-0 text-muted/50" />
            ) : (
              <FileText className="h-4 w-4 shrink-0 text-accent/60" />
            )}
          </>
        )}
        <span className={`truncate text-[13px] ${isRawArea ? 'italic text-muted/70' : ''}`}>
          {note.title}
          {isRawArea && note.kind === 'file' && <span className="ml-1 text-[10px] text-muted/50">只读</span>}
        </span>

        {/* 操作按钮（raw 层只读、系统文件受保护，不显示） */}
        {!isRawArea && !isSystemFile && showDelete && (
          <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {isFolder && (
              <button
                title="在此文件夹中新建笔记"
                onClick={(e) => { e.stopPropagation(); onCreate(note.path) }}
                className="rounded p-0.5 hover:bg-pink-100/70"
              >
                <Plus className="h-3 w-3 text-muted" />
              </button>
            )}
            <button
              title="删除"
              onClick={(e) => { e.stopPropagation(); onDelete(note.path) }}
              className="rounded p-0.5 hover:bg-red-100"
            >
              <Trash2 className="h-3 w-3 text-muted hover:text-red-400" />
            </button>
          </div>
        )}
      </div>

      {/* 子节点 */}
      {isFolder && expanded && note.children && (
        <div>
          {note.children.map((child) => (
            <FileTreeNode
              key={child.path}
              note={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onCreate={onCreate}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
