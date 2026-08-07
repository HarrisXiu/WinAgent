import { MessageSquare, Trash2, Quote, Calendar } from 'lucide-react'
import type { NoteAnnotation } from '../../../../shared/types'

interface Props {
  annotations: NoteAnnotation[]
  onRemove: (id: string) => void
}

export default function AnnotationPanel({ annotations, onRemove }: Props): JSX.Element {
  if (annotations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center px-4">
        <Quote className="mb-2 h-8 w-8 text-muted/20" />
        <p className="text-[12px] text-muted/60 leading-relaxed">
          暂无注释
        </p>
        <p className="mt-1 text-[11px] text-muted/40 leading-relaxed">
          在编辑模式中选中文本，<br />点击"添加注释"即可创建
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col p-3 space-y-2">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
        注释 ({annotations.length})
      </div>

      {annotations.map((ann) => (
        <div
          key={ann.id}
          className="group rounded-lg border border-border bg-white/70 p-2.5 transition-colors hover:border-accent/20 hover:bg-accent/[0.02]"
        >
          {/* 引用范围 */}
          <div className="mb-1.5 flex items-center gap-1.5">
            <Quote className="h-3 w-3 shrink-0 text-accent/40" />
            <span className="text-[10px] font-medium text-accent/60 uppercase tracking-wide">
              {ann.range}
            </span>
            <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={() => onRemove(ann.id)}
                className="rounded p-0.5 text-muted/50 hover:bg-red-50 hover:text-red-400 transition-colors"
                title="删除此注释"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* 注释文本 */}
          <p className="text-[12px] text-gray-600 leading-relaxed whitespace-pre-wrap">
            {ann.text}
          </p>

          {/* 时间 */}
          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted/50">
            <Calendar className="h-2.5 w-2.5" />
            {formatDate(ann.created)}
          </div>
        </div>
      ))}
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin} 分钟前`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr} 小时前`
    const diffDay = Math.floor(diffHr / 24)
    if (diffDay < 30) return `${diffDay} 天前`
    return d.toLocaleDateString('zh-CN')
  } catch {
    return iso
  }
}
