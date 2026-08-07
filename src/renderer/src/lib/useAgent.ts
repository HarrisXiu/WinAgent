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

export function useAgent() {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [usage, setUsage] = useState<TokenUsage | null>(null)
  const [lastUsage, setLastUsage] = useState<TokenUsage | null>(null)
  const currentAssistant = useRef<number>(-1)

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
          // 每一轮开新的 assistant 气泡
          setTurns((prev) => {
            const next = [...prev]
            next.push({ role: 'assistant', content: '', reasoning: '', toolCalls: [], streaming: true })
            currentAssistant.current = next.length - 1
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
        case 'vision':
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
          setStatus('出错')
          break
        case 'done':
          setBusy(false)
          setStatus('')
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
    setTurns((prev) => [...prev, { role: 'user', content: text, toolCalls: [], attachments }])
    setBusy(true)
    setStatus('思考中…')
    await window.winagent.send(text, attachments as any)
  }, [busy])

  const stop = useCallback(() => {
    window.winagent.stop()
    setBusy(false)
    setStatus('已停止')
  }, [])

  const reset = useCallback(async () => {
    await window.winagent.reset()
    setTurns([])
    setStatus('')
    setUsage(null)
    setLastUsage(null)
  }, [])

  const compact = useCallback(async () => {
    setStatus('压缩中…')
    await window.winagent.compact()
  }, [])

  const respondConfirm = useCallback((approved: boolean) => {
    if (confirm) window.winagent.replyConfirm(confirm.id, approved)
    setConfirm(null)
  }, [confirm])

  return { turns, busy, status, confirm, usage, lastUsage, send, stop, reset, compact, respondConfirm }
}
