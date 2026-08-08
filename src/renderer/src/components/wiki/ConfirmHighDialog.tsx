import { useState } from 'react'
import { Sparkles } from 'lucide-react'

export interface ConfirmHighItem {
  slug: string
  title: string
  sourceCount: number
}

interface Props {
  items: ConfirmHighItem[]
  onClose: () => void
  /** 确认/跳过处理完成后的回调（关闭对话框） */
  onDone: () => void
}

/**
 * confidence: high 用户背书确认（概念 5+ 来源时弹出）。
 * 主窗口与知识库独立窗口共用。
 */
export default function ConfirmHighDialog({ items, onClose, onDone }: Props): JSX.Element {
  const [confirming, setConfirming] = useState(false)

  const handleConfirm = async (approve: boolean): Promise<void> => {
    if (confirming) return
    setConfirming(true)
    try {
      if (approve) {
        for (const c of items) {
          await window.winagent.wiki.confirmConcept(c.slug, 'concepts')
        }
      }
    } finally {
      setConfirming(false)
      onDone()
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-pink-900/20 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100">
            <Sparkles className="h-5 w-5 text-purple-500" />
          </div>
          <h3 className="text-[15px] font-semibold text-gray-800">确认概念置信度为 high？</h3>
        </div>
        <p className="mb-3 text-sm text-gray-600">
          以下概念已达到 5+ 个来源且无重大矛盾。high 是你的主动背书（而非计数器输出），确认后后续查询会高权重引用它们：
        </p>
        <div className="mb-4 space-y-2">
          {items.map((c) => (
            <div key={c.slug} className="flex items-center justify-between rounded-xl border border-border bg-pink-50/50 px-3 py-2">
              <span className="text-[13px] font-medium text-gray-700">{c.title}</span>
              <span className="font-mono text-[11px] text-muted">{c.slug} · {c.sourceCount} sources</span>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => { void handleConfirm(false) }}
            disabled={confirming}
            className="rounded-lg border border-border px-4 py-1.5 text-sm text-gray-600 transition-colors hover:bg-pink-50 disabled:opacity-50"
          >
            保持现状
          </button>
          <button
            onClick={() => { void handleConfirm(true) }}
            disabled={confirming}
            className="rounded-lg bg-gradient-to-br from-purple-400 to-accent px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {confirming ? '确认中…' : '确认 high'}
          </button>
        </div>
        <div className="mt-3 text-right">
          <button onClick={onClose} className="text-xs text-muted hover:text-gray-700">
            稍后处理（保持 low/medium）
          </button>
        </div>
      </div>
    </div>
  )
}
