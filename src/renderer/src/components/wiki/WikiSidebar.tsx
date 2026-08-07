import { useState, useRef, useCallback } from 'react'
import { Search, Plus, FolderOpen, PanelRightClose, PanelRightOpen, GitGraph } from 'lucide-react'
import FileExplorer from './FileExplorer'
import type { NoteMeta, SearchResult } from '../../../../shared/types'

interface Props {
  vaultPath: string
  notes: NoteMeta[]
  selectedPath: string | null
  searchResults: SearchResult[] | null
  onSelectNote: (path: string) => void
  onCreateNote: (parentDir?: string) => void
  onDeleteNote: (path: string) => void
  onSearch: (query: string) => void
  onSetVaultPath: () => void
  onToggleRightPanel: () => void
  showRightPanel: boolean
  onToggleGraph: () => void
  showGraph: boolean
}

export default function WikiSidebar({
  vaultPath, notes, selectedPath,
  searchResults, onSelectNote,
  onCreateNote, onDeleteNote, onSearch,
  onSetVaultPath, onToggleRightPanel, showRightPanel,
  onToggleGraph, showGraph
}: Props): JSX.Element {
  const [searchQuery, setSearchQuery] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()

  const handleSearch = useCallback((value: string) => {
    setSearchQuery(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => onSearch(value), 250)
  }, [onSearch])

  const displayName = vaultPath ? vaultPath.split(/[/\\]/).pop() || 'Vault' : 'Vault'

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-white/60 backdrop-blur">
      {/* Vault 标题 */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <FolderOpen className="h-4 w-4 text-accent" />
        <span
          className="flex-1 truncate text-[13px] font-medium text-gray-700 cursor-pointer hover:text-accent"
          title={vaultPath}
          onClick={onSetVaultPath}
        >
          {displayName}
        </span>
        <button
          onClick={onToggleGraph}
          className={`rounded-md p-1 transition-colors ${
            showGraph ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-pink-100/70 hover:text-accent'
          }`}
          title="量子关系图谱"
        >
          <GitGraph className="h-4 w-4" />
        </button>
        <button
          onClick={onToggleRightPanel}
          className="rounded-md p-1 text-muted transition-colors hover:bg-pink-100/70 hover:text-accent"
          title={showRightPanel ? '隐藏右侧面板' : '显示右侧面板'}
        >
          {showRightPanel ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </button>
      </div>

      {/* 搜索框 */}
      <div className="border-b border-border px-2 py-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted" />
          <input
            className="flex-1 bg-transparent text-[12px] text-gray-700 outline-none placeholder:text-muted"
            placeholder="搜索笔记..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
      </div>

      {/* 搜索结果或文件树 */}
      {searchResults ? (
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {searchResults.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted">无匹配结果</div>
          ) : (
            searchResults.map((r) => (
              <button
                key={r.path}
                className="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-pink-100/50"
                onClick={() => { onSelectNote(r.path); setSearchQuery(''); onSearch('') }}
              >
                <div className="text-[13px] font-medium text-gray-700 truncate">{r.title}</div>
                <div className="mt-0.5 text-[11px] text-muted truncate">{r.snippet}</div>
              </button>
            ))
          )}
        </div>
      ) : (
        <FileExplorer
          notes={notes}
          selectedPath={selectedPath}
          onSelect={onSelectNote}
          onCreate={onCreateNote}
          onDelete={onDeleteNote}
        />
      )}

      {/* 新建笔记按钮 */}
      <div className="border-t border-border p-2">
        <button
          onClick={() => onCreateNote()}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-accent transition-colors hover:bg-pink-100/70"
        >
          <Plus className="h-4 w-4" />
          新建笔记
        </button>
      </div>
    </aside>
  )
}
