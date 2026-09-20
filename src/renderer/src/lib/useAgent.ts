import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentEvent, TokenUsage, ToolSource } from '../../../shared/types'

export interface ToolCallView {
  id: string
  name: string
  args: string
  source: ToolSource
  result?: string
  ok?: boolean
  running: boolean
}

export interface ChatTurn {
  /** 稳定 id：语音合成缓存按消息身份索引、气泡播放态匹配都用它（数组下标会随插入漂移） */
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  toolCalls: ToolCallView[]
  streaming?: boolean
  attachments?: Array<{ name: string; isImage: boolean; dataUrl?: string; path: string; mime?: string }>
}

export interface ConfirmRequest {
  id: string
  name: string
  args: string
}

/** Agent 回复完成回调（自动朗读等衍生动作在此挂钩；出错不触发） */
export interface UseAgentCallbacks {
  onTurnComplete?: (content: string, turnId: string) => void
}

export function useAgent(callbacks?: UseAgentCallbacks) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [usage, setUsage] = useState<TokenUsage | null>(null)
  const [lastUsage, setLastUsage] = useState<TokenUsage | null>(null)
  const [visionActive, setVisionActive] = useState(false)
  const currentAssistant = useRef<number>(-1)
  // 回调用 ref 承接，避免事件订阅因闭包过期而读到旧函数
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks
  // 最近一条 assistant 回复的最终内容与 turn id（done 时供 onTurnComplete 使用）
  const lastContentRef = useRef('')
  const lastTurnIdRef = useRef('')
  // turn 稳定 id 计数器
  const seqRef = useRef(0)
  const nextTurnId = (): string => `t_${++seqRef.current}`

  const patchAssistant = useCallback((fn: (t: ChatTurn) => void) => {
    setTurns((prev) => {
      const next = [...prev]
      const idx = currentAssistant.current
      if (idx >= 0 && next[idx]) {
        const copy = { ...next[idx], toolCalls: [...next[idx].toolCalls] }
        fn(copy)
        next[idx] = copy
      }
      return next
    })
  }, [])

  useEffect(() => {
    const off = window.winagent.onEvent((e: AgentEvent) => {
      switch (e.type) {
        case 'round':
          setStatus(`第 ${e.round} 轮（历史 ${e.historyCount} 条）`)
          lastContentRef.current = ''
          // 每一轮开新的 assistant 气泡
          setTurns((prev) => {
            const next = [...prev]
            next.push({ id: nextTurnId(), role: 'assistant', content: '', reasoning: '', toolCalls: [], streaming: true })
            currentAssistant.current = next.length - 1
            lastTurnIdRef.current = next[next.length - 1].id
            return next
          })
          break
        case 'assistant_delta':
          patchAssistant((t) => {
            t.content += e.text
          })
          break
        case 'reasoning_delta':
          patchAssistant((t) => {
            t.reasoning = (t.reasoning || '') + e.text
          })
          break
        case 'assistant_message':
          lastContentRef.current = e.content
          patchAssistant((t) => {
            t.content = e.content
            if (e.reasoning) t.reasoning = e.reasoning
            t.streaming = false
          })
          break
        case 'tool_call':
          patchAssistant((t) => {
            t.toolCalls.push({ id: e.id, name: e.name, args: e.args, source: e.source, running: true })
          })
          break
        case 'tool_result':
          patchAssistant((t) => {
            const tc = t.toolCalls.find((c) => c.id === e.id)
            if (tc) {
              tc.result = e.result
              tc.ok = e.ok
              tc.running = false
            }
          })
          break
        case 'compact':
          setStatus(`已压缩上下文：${e.before} → ${e.after} tokens`)
          break
        case 'knowledge':
          setStatus(e.count > 0
            ? `📚 已检索知识库：注入 ${e.count} 条相关笔记`
            : '📚 已检索知识库：未找到相关内容')
          break
        case 'vision':
          // 立绘 vision 态按事件类型判定；不再正则匹配 status 文案
          // （「图片识别完成/失败」也含「识别」，靠文案会把立绘卡在识别态）
          setVisionActive(e.status === 'start')
          if (e.status === 'start') setStatus(`视觉模型 ${e.model} 识别图片中…`)
          else if (e.status === 'done') setStatus(`图片识别完成（${e.model}）`)
          else setStatus(`图片识别失败：${e.text || ''}`)
          break
        case 'usage':
          setLastUsage(e.last)
          setUsage(e.session)
          break
        case 'error':
          patchAssistant((t) => {
            t.content += `\n\n**⚠ 错误：** ${e.message}`
            t.streaming = false
          })
          setBusy(false)
          setVisionActive(false)
          setStatus('出错')
          break
        case 'done':
          setBusy(false)
          setVisionActive(false)
          setStatus('')
          // 回复完成（含多轮工具调用后的最终回复）；出错路径不走这里
          if (lastContentRef.current) callbacksRef.current?.onTurnComplete?.(lastContentRef.current, lastTurnIdRef.current)
          lastContentRef.current = ''
          break
      }
    })

    const offConfirm = window.winagent.onConfirm((req) => setConfirm(req))
    return () => {
      off()
      offConfirm()
    }
  }, [patchAssistant])

  const send = useCallback(async (text: string, attachments?: Array<{ name: string; isImage: boolean; dataUrl?: string; path: string; mime?: string }>) => {
    if (!text.trim() || busy) return
    setTurns((prev) => [...prev, { id: nextTurnId(), role: 'user', content: text, toolCalls: [], attachments }])
    setBusy(true)
    setStatus('思考中…')
    await window.winagent.send(text, attachments as any)
  }, [busy])

  const stop = useCallback(() => {
    window.winagent.stop()
    setBusy(false)
    setVisionActive(false)
    setStatus('已停止')
  }, [])

  const reset = useCallback(async () => {
    await window.winagent.reset()
    setTurns([])
    setStatus('')
    setUsage(null)
    setLastUsage(null)
    setVisionActive(false)
    lastContentRef.current = ''
  }, [])

  const compact = useCallback(async () => {
    setStatus('压缩中…')
    await window.winagent.compact()
  }, [])

  const respondConfirm = useCallback((approved: boolean) => {
    if (confirm) window.winagent.replyConfirm(confirm.id, approved)
    setConfirm(null)
  }, [confirm])

  return { turns, busy, status, confirm, usage, lastUsage, visionActive, send, stop, reset, compact, respondConfirm }
}
