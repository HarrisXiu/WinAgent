import { useState, useCallback } from 'react'
import { Plus, X, Hash } from 'lucide-react'
import type { TagWithCount } from '../../../../shared/types'

interface Props {
  currentTags: string[]
  allTags: TagWithCount[]
  onAddTag: (tag: string) => void
  onRemoveTag: (tag: string) => void
  onTagClick: (tag: string) => void
}

export default function TagPanel({
  currentTags, allTags, onAddTag, onRemoveTag, onTagClick
}: Props): JSX.Element {
  const [input, setInput] = useState('')

  const handleAdd = useCallback(() => {
    const tag = input.trim()
    if (!tag || currentTags.includes(tag)) {
      setInput('')
      return
    }
    onAddTag(tag)
    setInput('')
  }, [input, currentTags, onAddTag])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd()
    if (e.key === 'Escape') setInput('')
  }, [handleAdd])

  return (
    <div className="flex flex-col p-3">
      {/* 当前笔记的标签 */}
      <div className="mb-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          当前笔记标签 ({currentTags.length})
        </div>
        {currentTags.length === 0 ? (
          <p className="py-2 text-center text-[11px] text-muted/70">暂无标签</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {currentTags.map((tag) => (
              <span
                key={tag}
                className="wiki-tag group flex items-center gap-0.5"
              >
                <Hash className="h-3 w-3 opacity-50" />
                {tag}
                <button
                  onClick={() => onRemoveTag(tag)}
                  className="ml-0.5 rounded-full p-0.5 opacity-0 transition-opacity hover:bg-white/20 group-hover:opacity-100"
                  title={`移除标签 "${tag}"`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 添加标签输入 */}
      <div className="mb-3 flex gap-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入新标签..."
          className="flex-1 rounded-md border border-border bg-white/70 px-2.5 py-1.5 text-[13px] placeholder:text-muted/50 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/20"
        />
        <button
          onClick={handleAdd}
          disabled={!input.trim()}
          className="rounded-md bg-accent px-2.5 py-1.5 text-white transition-colors hover:bg-accent/85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* 建议标签 */}
      {allTags.length > 0 && (
        <div className="mb-3">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
            建议标签
          </div>
          <div className="flex flex-wrap gap-1">
            {allTags
              .filter((t) => !currentTags.includes(t.tag))
              .slice(0, 12)
              .map(({ tag }) => (
                <button
                  key={tag}
                  onClick={() => onAddTag(tag)}
                  className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted transition-colors hover:border-accent/30 hover:bg-accent/5 hover:text-accent"
                >
                  + {tag}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* 标签云 */}
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          标签云
        </div>
        {allTags.length === 0 ? (
          <p className="py-2 text-center text-[11px] text-muted/70">
            知识库中暂无标签
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {allTags.map(({ tag, count }) => (
              <button
                key={tag}
                onClick={() => onTagClick(tag)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
                  currentTags.includes(tag)
                    ? 'bg-accent/15 text-accent font-medium'
                    : 'bg-gray-100/70 text-muted hover:bg-accent/10 hover:text-accent'
                }`}
                title={`${count} 篇笔记`}
              >
                <span className="font-medium">{tag}</span>
                <span className="ml-1 text-[10px] opacity-60">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
