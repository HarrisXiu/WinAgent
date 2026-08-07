import { useState, useCallback } from 'react'
import { Tags, Link2, Sparkles, MessageSquare, X } from 'lucide-react'
import TagPanel from './TagPanel'
import BacklinksPanel from './BacklinksPanel'
import AIPanel from './AIPanel'
import AnnotationPanel from './AnnotationPanel'
import type { NoteContent, NoteMeta, NoteAnnotation, TagWithCount, AISuggestion } from '../../../../shared/types'

type TabKey = 'tags' | 'backlinks' | 'ai' | 'annotations'

interface Props {
  currentNote: NoteContent | null
  allTags: TagWithCount[]
  backlinks: Array<{ path: string; title: string }>
  allNotes: NoteMeta[]
  onAddTag: (tag: string) => void
  onRemoveTag: (tag: string) => void
  onNavigate: (path: string) => void
  onClose: () => void
  onAnalyze: () => Promise<void>
  onCancelAi: () => void
  aiSuggestion: AISuggestion | null
  aiAnalyzing: boolean
  aiError: string | null
  annotations: NoteAnnotation[]
  onRemoveAnnotation: (id: string) => void
}

export default function WikiRightPanel({
  currentNote, allTags, backlinks, allNotes,
  onAddTag, onRemoveTag, onNavigate, onClose,
  onAnalyze, onCancelAi, aiSuggestion, aiAnalyzing, aiError,
  annotations, onRemoveAnnotation
}: Props): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>('tags')

  const tabs: Array<{ key: TabKey; icon: typeof Tags; label: string; count?: number }> = [
    { key: 'tags', icon: Tags, label: '标签', count: currentNote?.tags.length },
    { key: 'backlinks', icon: Link2, label: '反链', count: backlinks.length },
    { key: 'ai', icon: Sparkles, label: 'AI' },
    { key: 'annotations', icon: MessageSquare, label: '注释', count: currentNote?.annotations?.length }
  ]

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-l border-border bg-white/60 backdrop-blur">
      {/* 标题栏 */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <span className="text-[13px] font-medium text-gray-600">
          {currentNote ? '笔记详情' : '面板'}
        </span>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-muted transition-colors hover:bg-pink-100/70 hover:text-accent"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 选项卡 */}
      <div className="flex border-b border-border">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex flex-1 items-center justify-center gap-1 px-2 py-2 text-[11px] font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-b-2 border-accent text-accent'
                  : 'text-muted hover:text-gray-600'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-0.5 rounded-full bg-accent/10 px-1.5 py-0 text-[10px] text-accent">
                  {tab.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* 面板内容 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'tags' && (
          <TagPanel
            currentTags={currentNote?.tags || []}
            allTags={allTags}
            onAddTag={onAddTag}
            onRemoveTag={onRemoveTag}
            onTagClick={(tag) => {
              // 标签筛选（未来可用）
            }}
          />
        )}
        {activeTab === 'backlinks' && (
          <BacklinksPanel
            backlinks={backlinks}
            currentNotePath={currentNote?.path || ''}
            onNavigate={onNavigate}
          />
        )}
        {activeTab === 'ai' && (
          <AIPanel
            onAnalyze={onAnalyze}
            onCancel={onCancelAi}
            onNavigate={onNavigate}
            suggestion={aiSuggestion}
            analyzing={aiAnalyzing}
            error={aiError}
          />
        )}
        {activeTab === 'annotations' && (
          <AnnotationPanel
            annotations={annotations}
            onRemove={onRemoveAnnotation}
          />
        )}
      </div>
    </aside>
  )
}
