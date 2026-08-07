import { Link2, FileText, CornerDownRight, ExternalLink } from 'lucide-react'

interface Props {
  backlinks: Array<{ path: string; title: string }>
  currentNotePath: string
  onNavigate: (path: string) => void
}

export default function BacklinksPanel({
  backlinks, currentNotePath, onNavigate
}: Props): JSX.Element {
  return (
    <div className="flex flex-col p-3">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
        引用此笔记的页面 ({backlinks.length})
      </div>

      {backlinks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Link2 className="mb-2 h-6 w-6 text-muted/30" />
          <p className="text-[12px] text-muted/60">暂无反向链接</p>
          <p className="mt-1 text-[11px] text-muted/40">
            在其他笔记中输入 [[链接]] 即可创建
          </p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {backlinks.map(({ path, title }) => {
            const isCurrent = path === currentNotePath
            return (
              <button
                key={path}
                onClick={() => onNavigate(path)}
                disabled={isCurrent}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors ${
                  isCurrent
                    ? 'cursor-default bg-accent/5'
                    : 'hover:bg-accent/5 hover:text-accent'
                }`}
              >
                {isCurrent ? (
                  <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-accent/60" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted/50" />
                )}
                <span className={`flex-1 truncate ${isCurrent ? 'font-medium text-accent' : 'text-gray-700'}`}>
                  {title}
                </span>
                {isCurrent && (
                  <span className="text-[10px] text-accent/50">当前</span>
                )}
                {!isCurrent && (
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted/30 opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* 底部提示 */}
      {backlinks.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <p className="text-[10px] leading-relaxed text-muted/50">
            反向链接会在其他笔记通过 [[wiki 链接]] 引用此笔记时自动显示
          </p>
        </div>
      )}
    </div>
  )
}
