import { useState } from 'react'
import { Brain, ChevronRight, FileText, ImageIcon } from 'lucide-react'
import type { ChatTurn } from '../lib/useAgent'
import { renderMarkdown } from '../lib/markdown'
import ToolCard from './ToolCard'
import { AI_STATE_GIF, type AiState } from '../App'

const STATE_TEXT: Partial<Record<AiState, string>> = {
  think: 'Angelina 正在思考…',
  tool: 'Angelina 正在执行工具…',
  vision: 'Angelina 正在识别图片…',
  talk: 'Angelina 正在回答…'
}

export default function Message({ turn, aiState = 'idle' }: { turn: ChatTurn; aiState?: AiState }): JSX.Element {
  const [showReason, setShowReason] = useState(false)
  const isUser = turn.role === 'user'

  const attachments = turn.attachments && turn.attachments.length > 0 && (
    <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
      {turn.attachments.map((att, i) => (
        <div key={i} className="flex items-center gap-2 rounded-xl border border-border bg-white/80 px-1.5 py-1 shadow-card">
          {att.isImage && att.dataUrl ? (
            <img src={att.dataUrl} alt={att.name} className="h-9 w-9 rounded-lg object-cover" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10">
              <FileText className="h-4 w-4 text-accent" />
            </div>
          )}
          <span className="max-w-36 truncate text-xs text-gray-600">{att.name}</span>
        </div>
      ))}
    </div>
  )

  if (isUser) {
    return (
      <div className="flex flex-col items-end px-2 py-2">
        {attachments}
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-accent to-accent2/90 px-4 py-2.5 text-[14px] leading-relaxed text-white shadow-lg shadow-accent/20">
          <div className="whitespace-pre-wrap">{turn.content}</div>
          {turn.streaming && !turn.content && <span className="text-sm">▍</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 px-2 py-2.5">
      <div
        className={`mt-0.5 shrink-0 rounded-full bg-gradient-to-br from-accent/60 to-accent2/60 p-[2px] transition-shadow ${
          aiState === 'idle' ? 'shadow-card' : 'shadow-glow'
        }`}
      >
        <img src={AI_STATE_GIF[aiState]} alt="Angelina" className="h-9 w-9 rounded-full object-cover" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        {turn.reasoning && (
          <div className="mb-1.5">
            <button
              className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-pink-100/60 hover:text-accent"
              onClick={() => setShowReason((s) => !s)}
            >
              <ChevronRight className={`h-3 w-3 transition-transform ${showReason ? 'rotate-90' : ''}`} />
              <Brain className="h-3 w-3" />
              思考过程
            </button>
            {showReason && (
              <div className="mt-1.5 whitespace-pre-wrap rounded-xl border border-border bg-white/80 p-3 text-[13px] leading-relaxed text-muted">
                {turn.reasoning}
              </div>
            )}
          </div>
        )}

        {turn.content && (
          <div
            className="md-body text-[14px]"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.content) }}
          />
        )}

        {turn.streaming && !turn.content && turn.toolCalls.length === 0 && (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <span className="flex gap-0.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:300ms]" />
            </span>
            {STATE_TEXT[aiState] || 'Angelina 正在思考…'}
          </div>
        )}

        {turn.toolCalls.map((tc) => (
          <ToolCard key={tc.id} tc={tc} />
        ))}
      </div>
    </div>
  )
}
