import { useState } from 'react'
import { Bot, Brain, ChevronRight, FileText, ImageIcon, Loader2, Square, Volume2 } from 'lucide-react'
import type { ChatTurn } from '../lib/useAgent'
import { useSpeech } from '../lib/useSpeech'
import { renderMarkdown } from '../lib/markdown'
import ToolCard from './ToolCard'
import { useSkin } from '../theme/SkinProvider'
import type { AiState } from '../theme/skins'

export default function Message({ turn, aiState = 'idle', voiceOn = false, onOpenKnowledge }: { turn: ChatTurn; aiState?: AiState; voiceOn?: boolean; onOpenKnowledge?: (path:string,chunkId?:string)=>void }): JSX.Element {
  const [showReason, setShowReason] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
  const saveKnowledge = async (): Promise<void> => {
    setSaveStatus('保存中…')
    try {
      const refs = turn.references || []
      const path = `wiki/outputs/chat-${turn.id.replace(/[^a-zA-Z0-9_-]/g,'')}.md`
      await window.winagent.wiki.writeNote(path, { title: turn.content.replace(/[#*\n]/g,' ').slice(0,50), tags:['对话结论','AI草稿'], body:`${turn.content}\n\n## 来源\n\n${refs.map(r=>`- [${r.title}](wiki:${encodeURIComponent(r.path)}?chunk=${r.chunkId||''}) · 提取文本行 ${r.lineStart}–${r.lineEnd}`).join('\n')}` })
      setSaveStatus('已保存到知识库')
    } catch(e) { setSaveStatus(`保存失败：${String(e)}`) }
  }
  // 语音播放态读全局 context：手动/自动/Agent 三条来源统一，
  // 只有正在朗读「本条」时才显示播放态（修自动朗读与气泡脱节的 bug）
  const speech = useSpeech()
  const skin = useSkin()
  const isUser = turn.role === 'user'
  /** 本条消息是否正处于播放会话中（loading/playing/paused） */
  const mine = speech.messageId === turn.id
  const speechActive = mine && speech.state !== 'idle'

  const toggleSpeech = (): void => {
    // 合成中点击 = 取消；播放中点击 = 停止
    if (speechActive) {
      speech.stop()
      return
    }
    speech.speak(turn.content, { messageId: turn.id, source: 'manual' })
  }

  const attachments = turn.attachments && turn.attachments.length > 0 && (
    <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
      {turn.attachments.map((att, i) => (
        <div key={i} className="flex items-center gap-2 rounded-xl border border-border bg-panel/80 px-1.5 py-1 shadow-card">
          {att.isImage && att.dataUrl ? (
            <img src={att.dataUrl} alt={att.name} className="h-9 w-9 rounded-lg object-cover" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10">
              <FileText className="h-4 w-4 text-accent" />
            </div>
          )}
          <span className="max-w-36 truncate text-xs text-text-secondary">{att.name}</span>
        </div>
      ))}
    </div>
  )

  if (isUser) {
    return (
      <div className="flex flex-col items-end px-2 py-2">
        {attachments}
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-accent to-accent2/90 px-4 py-2.5 text-[14px] leading-relaxed text-accent-fg shadow-lg shadow-accent/20">
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
        {skin.avatar ? (
          <img src={skin.avatar} alt={skin.name || '助手头像'} className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-panel" aria-hidden="true">
            <Bot className="h-5 w-5 text-accent" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        {turn.reasoning && (
          <div className="mb-1.5">
            <button
              className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-surface-hover/60 hover:text-accent"
              onClick={() => setShowReason((s) => !s)}
            >
              <ChevronRight className={`h-3 w-3 transition-transform ${showReason ? 'rotate-90' : ''}`} />
              <Brain className="h-3 w-3" />
              思考过程
            </button>
            {showReason && (
              <div className="mt-1.5 whitespace-pre-wrap rounded-xl border border-border bg-panel/80 p-3 text-[13px] leading-relaxed text-muted">
                {turn.reasoning}
              </div>
            )}
          </div>
        )}

        {turn.content && (
          <div
            className="md-body text-[14px]"
            onClick={e=>{
              const a=(e.target as HTMLElement).closest('a');const href=a?.getAttribute('href')||''
              if(href.startsWith('wiki:')){e.preventDefault();const [raw,query]=href.slice(5).split('?');const path=decodeURIComponent(raw);const chunk=new URLSearchParams(query).get('chunk')||undefined
                if(turn.references?.some(r=>r.path===path))onOpenKnowledge?.(path,chunk)
              }
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.content) }}
          />
        )}

        {!!turn.references?.length&&<details className="my-3 rounded-lg border border-border px-3 py-2 text-xs"><summary className="cursor-pointer text-accent">本轮知识来源 · {turn.references.length} 个片段</summary><div className="mt-2 flex flex-col gap-2">{turn.references.map((r,i)=><button key={`${r.path}-${r.chunkId}-${i}`} className="text-left text-text-secondary hover:text-accent" onClick={()=>onOpenKnowledge?.(r.path,r.chunkId)}>{r.title} · 提取文本行 {r.lineStart}–{r.lineEnd}</button>)}</div></details>}
        {turn.ruleReport&&<details className="my-3 rounded-lg border border-border px-3 py-2 text-xs" open={turn.ruleReport.checks.some(c=>c.status==='fail')}><summary className="cursor-pointer text-accent">规范检查 · {turn.ruleReport.checks.filter(c=>c.status==='pass').length} 项通过评估 · {turn.ruleReport.checks.filter(c=>c.status!=='pass').length} 项待处理</summary><p className="my-2 text-muted">{turn.ruleReport.scope}</p>{turn.ruleReport.checks.map(c=><div key={c.ruleId} className="border-t border-border py-2"><strong>{c.status==='pass'?'模型评估通过':c.status==='fail'?'未满足':'需核验'} · {c.requirement}</strong><p className="mt-1 text-muted">{c.reason}</p></div>)}</details>}
        {turn.content&&!turn.streaming&&<div className="my-2 flex items-center gap-2 text-xs"><button className="text-accent" onClick={()=>void saveKnowledge()} disabled={saveStatus==='保存中…'}>保存结论到知识库</button><span role="status" className="text-muted">{saveStatus}</span></div>}

        {/* 语音朗读：回复完成后显示（需在设置中启用语音）；播放态/错误读全局状态 */}
        {!turn.streaming && turn.content && voiceOn && (
          <div className="mt-1.5 flex items-center gap-2">
            <button
              aria-label={speechActive ? '停止朗读' : '朗读本条回复'}
              aria-pressed={speechActive}
              className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-surface-hover/60 hover:text-accent"
              onClick={toggleSpeech}
            >
              {mine && speech.state === 'loading' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : speechActive ? (
                <Square className="h-3 w-3" />
              ) : (
                <Volume2 className="h-3 w-3" />
              )}
              {mine && speech.state === 'loading'
                ? '取消合成…'
                : speechActive
                  ? speech.state === 'paused'
                    ? '已暂停 · 停止'
                    : '停止'
                  : '朗读'}
            </button>
            {mine && speech.error && (
              <span role="alert" className="text-xs text-danger">
                {speech.error}
              </span>
            )}
          </div>
        )}

        {turn.streaming && !turn.content && turn.toolCalls.length === 0 && (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <span className="flex gap-0.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:300ms]" />
            </span>
            {skin.stateText[aiState] || '正在思考…'}
          </div>
        )}

        {turn.toolCalls.map((tc) => (
          <ToolCard key={tc.id} tc={tc} />
        ))}
      </div>
    </div>
  )
}
