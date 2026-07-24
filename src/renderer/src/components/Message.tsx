import { useState } from 'react'
import { Brain, ChevronRight, User, Bot, FileText } from 'lucide-react'
import type { ChatTurn } from '../lib/useAgent'
import { renderMarkdown } from '../lib/markdown'
import ToolCard from './ToolCard'

export default function Message({ turn }: { turn: ChatTurn }): JSX.Element {
  const [showReason, setShowReason] = useState(false)
  const isUser = turn.role === 'user'

  return (
    <div className={`flex gap-3 px-4 py-3 ${isUser ? '' : 'bg-panel/40'}`}>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isUser ? 'bg-accent/20 text-accent' : 'bg-green-600/20 text-green-400'
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        {turn.reasoning && (
          <div className="mb-2">
            <button
              className="flex items-center gap-1 text-xs text-muted hover:text-gray-300"
              onClick={() => setShowReason((s) => !s)}
            >
              <ChevronRight className={`h-3 w-3 transition-transform ${showReason ? 'rotate-90' : ''}`} />
              <Brain className="h-3 w-3" />
              思考过程
            </button>
            {showReason && (
              <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-bg/60 p-2 text-[13px] text-muted">
                {turn.reasoning}
              </div>
            )}
          </div>
        )}

        {turn.attachments && turn.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {turn.attachments.map((att, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-bg/60 px-2 py-1">
                {att.isImage && att.dataUrl ? (
                  <img src={att.dataUrl} alt={att.name} className="h-16 w-16 rounded object-cover" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded bg-border/40">
                    <FileText className="h-5 w-5 text-muted" />
                  </div>
                )}
                <span className="max-w-40 truncate text-xs text-gray-300">{att.name}</span>
              </div>
            ))}
          </div>
        )}

        {turn.content && (
          <div
            className="md-body text-[14px] leading-relaxed text-gray-100"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.content) }}
          />
        )}

        {turn.streaming && !turn.content && turn.toolCalls.length === 0 && (
          <div className="text-sm text-muted">▍</div>
        )}

        {turn.toolCalls.map((tc) => (
          <ToolCard key={tc.id} tc={tc} />
        ))}
      </div>
    </div>
  )
}
