/**
 * 全局语音控制条：会话活跃（或残留错误未读）时浮现。
 * 展示第 n/N 段进度、来源标签，提供 暂停/继续 · 跳过本段 · 停止，以及错误展示。
 * （自动朗读失败等此前只进 console 的错误在这里可见。）
 */
import { AlertCircle, Loader2, Pause, Play, SkipForward, Square, Volume2, X } from 'lucide-react'
import { useSpeech, type SpeechSource } from '../lib/useSpeech'

const SOURCE_LABEL: Record<SpeechSource, string> = {
  manual: '朗读',
  auto: '自动朗读',
  agent: 'Agent 开口',
  test: '音色试听'
}

export default function SpeechBar(): JSX.Element | null {
  const speech = useSpeech()
  const visible = speech.state !== 'idle' || !!speech.error
  if (!visible) return null

  const active = speech.state !== 'idle'
  const pct = speech.total > 0 ? Math.round((speech.index / speech.total) * 100) : 0

  return (
    <div className="fixed bottom-24 left-1/2 z-40 w-[min(92%,520px)] -translate-x-1/2">
      <div className="rounded-2xl border border-border bg-panel/95 px-4 py-2.5 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-3">
          {speech.state === 'loading' ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
          ) : speech.error && !active ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
          ) : (
            <Volume2 className="h-4 w-4 shrink-0 text-accent" />
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 font-medium text-accent">
                {speech.source ? SOURCE_LABEL[speech.source] : '朗读'}
              </span>
              <span className="truncate text-muted">
                {speech.total > 0 ? `第 ${speech.index}/${speech.total} 段` : '正在合成…'}
              </span>
              {speech.state === 'paused' && <span className="shrink-0 text-muted">（已暂停）</span>}
            </div>
            {/* 进度条 */}
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-accent/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-accent2 transition-all duration-300"
                style={{ width: `${Math.max(pct, active ? 4 : 0)}%` }}
              />
            </div>
          </div>

          {active && (
            <div className="flex shrink-0 items-center gap-1">
              {speech.state === 'paused' ? (
                <button
                  aria-label="继续播放"
                  title="继续播放"
                  onClick={() => speech.resume()}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-hover/70 hover:text-accent"
                >
                  <Play className="h-4 w-4" />
                </button>
              ) : (
                <button
                  aria-label="暂停"
                  title="暂停"
                  onClick={() => speech.pause()}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-hover/70 hover:text-accent"
                >
                  <Pause className="h-4 w-4" />
                </button>
              )}
              <button
                aria-label="跳过本段"
                title="跳过本段"
                onClick={() => speech.skip()}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-hover/70 hover:text-accent"
              >
                <SkipForward className="h-4 w-4" />
              </button>
              <button
                aria-label="停止朗读"
                title="停止朗读"
                onClick={() => speech.stop()}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-danger/90 text-white shadow-md shadow-danger/30 transition-colors hover:bg-danger"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {!active && speech.error && (
            <button
              aria-label="关闭错误提示"
              title="关闭"
              onClick={() => speech.stop()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-hover/70 hover:text-text"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {speech.error && (
          <p role="alert" className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-danger">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {speech.error}
          </p>
        )}
      </div>
    </div>
  )
}
