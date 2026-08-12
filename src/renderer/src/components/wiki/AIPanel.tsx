import { useState } from 'react'
import { Sparkles, Loader2, Tag, FileText, Link2, RotateCw, AlertCircle, FilePlus2, ListPlus } from 'lucide-react'
import type { AISuggestion } from '../../../../shared/types'

interface Props {
  onAnalyze: () => Promise<void>
  onCancel: () => void
  onNavigate: (path: string) => void
  suggestion: AISuggestion | null
  analyzing: boolean
  error: string | null
  /** raw 只读层：隐藏一键应用按钮（LLM Wiki 不可变原则） */
  readonly?: boolean
  /** 一键应用：把 AI 摘要插入正文顶部 */
  onApplySummary?: () => void
  /** 一键应用：把关联笔记以 wikilink 追加到正文底部 */
  onApplyRelations?: () => void
}

export default function AIPanel({
  onAnalyze, onCancel, onNavigate,
  suggestion, analyzing, error,
  readonly = false, onApplySummary, onApplyRelations
}: Props): JSX.Element {
  return (
    <div className="flex flex-col p-3">
      {/* 操作按钮 */}
      <div className="mb-3">
        {analyzing ? (
          <button
            onClick={onCancel}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] font-medium text-danger transition-colors hover:bg-danger/10"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            分析中，点击取消
          </button>
        ) : (
          <button
            onClick={onAnalyze}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent2 px-3 py-2 text-[13px] font-medium text-accent-fg transition-all hover:from-accent/90 hover:to-accent2/90 hover:shadow-lg hover:shadow-accent/30"
          >
            <Sparkles className="h-4 w-4" />
            AI 分析当前笔记
          </button>
        )}
      </div>

      {/* 错误信息 */}
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-2.5">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
          <p className="text-[12px] text-danger leading-relaxed">{error}</p>
        </div>
      )}

      {/* 分析结果 */}
      {suggestion && (suggestion.tags || suggestion.summary || suggestion.relations || suggestion.suggestions) ? (
        <div className="space-y-3">
          {/* 建议标签 */}
          {suggestion.tags && suggestion.tags.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                <Tag className="h-3 w-3" />
                建议标签
              </div>
              <div className="flex flex-wrap gap-1">
                {suggestion.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-accent/30 bg-accent/5 px-2 py-0.5 text-[11px] text-accent"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* AI 摘要 */}
          {suggestion.summary && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                <FileText className="h-3 w-3" />
                AI 摘要
              </div>
              <p className="rounded-lg bg-purple/10 px-2.5 py-2 text-[12px] leading-relaxed text-text-secondary">
                {suggestion.summary}
              </p>
            </div>
          )}

          {/* 关系发现 */}
          {suggestion.relations && suggestion.relations.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                <Link2 className="h-3 w-3" />
                关联笔记
              </div>
              <div className="space-y-1">
                {suggestion.relations.map((rel) => (
                  <button
                    key={rel.target}
                    onClick={() => onNavigate(rel.target)}
                    className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent/5"
                  >
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent/50" />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-text">
                        {rel.title || rel.target}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted/70 leading-relaxed">
                        {rel.reason}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 质量建议 */}
          {suggestion.suggestions && suggestion.suggestions.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                <AlertCircle className="h-3 w-3" />
                质量建议
              </div>
              <ul className="space-y-1 rounded-lg border border-amber-100 bg-warning/10 p-2.5">
                {suggestion.suggestions.map((s, i) => (
                  <li key={i} className="text-[12px] leading-relaxed text-warning">• {s}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 一键应用（raw 只读层隐藏：LLM Wiki 不可变原则） */}
          {!readonly && (suggestion.summary || (suggestion.relations && suggestion.relations.length > 0)) && (
            <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2">
              {suggestion.summary && onApplySummary && (
                <button
                  onClick={onApplySummary}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[12px] font-medium text-accent transition-colors hover:bg-accent/10"
                >
                  <FilePlus2 className="h-3.5 w-3.5" />
                  插入摘要到正文顶部
                </button>
              )}
              {suggestion.relations && suggestion.relations.length > 0 && onApplyRelations && (
                <button
                  onClick={onApplyRelations}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[12px] font-medium text-accent transition-colors hover:bg-accent/10"
                >
                  <ListPlus className="h-3.5 w-3.5" />
                  插入关联笔记（wikilink）
                </button>
              )}
            </div>
          )}
        </div>
      ) : !analyzing && !error ? (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <Sparkles className="mb-2 h-6 w-6 text-muted/30" />
          <p className="text-[12px] text-muted/60">
            点击上方按钮，让 AI 分析当前笔记
          </p>
          <p className="mt-1 text-[11px] text-muted/40">
            自动生成标签、摘要和关联笔记
          </p>
        </div>
      ) : analyzing && !suggestion ? (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <Loader2 className="mb-2 h-5 w-5 animate-spin text-accent/50" />
          <p className="text-[12px] text-muted/60">AI 正在分析笔记内容...</p>
          <p className="mt-1 text-[11px] text-muted/40">这可能需要几秒钟</p>
        </div>
      ) : null}
    </div>
  )
}
