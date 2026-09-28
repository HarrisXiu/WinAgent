import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentEvent, TokenUsage, ToolSource, KnowledgeContext, KnowledgeReference, TaskRuleReport, ConversationSummary, SavedConversation } from '../../../shared/types'

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
  references?: KnowledgeReference[]
  ruleReport?: TaskRuleReport
}

export interface ConfirmRequest {
  id: string
  name: string
  args: string
}

/** Agent 回复完成回调（自动朗读等衍生动作在此挂钩；出错不触发） */
export interface UseAgentCallbacks {
  onTurnComplete?: (content: string, turnId: string) => void
  onConversationLoaded?: (record: SavedConversation) => void
}

export function useAgent(callbacks?: UseAgentCallbacks) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [usage, setUsage] = useState<TokenUsage | null>(null)
  const [lastUsage, setLastUsage] = useState<TokenUsage | null>(null)
  const [visionActive, setVisionActive] = useState(false)
  const [activeRules, setActiveRules] = useState<Array<{ id: string; title: string; version: string; count: number }>>([])
  const [knowledgeError, setKnowledgeError] = useState('')
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [conversationId, setConversationId] = useState('')
  const [conversationKind, setConversationKind] = useState<'assistant'|'topic'>('assistant')
  const [topicTag, setTopicTag] = useState('')
  const [switching, setSwitching] = useState(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const conversationContext = useRef<KnowledgeContext>({mode:'auto',paths:[]})
  const draft = useRef('')
  const [draftRevision,setDraftRevision] = useState(0)
  const applyConversation = (record: SavedConversation): void => {
    setConversationId(record.id); setConversationKind(record.kind === 'topic' ? 'topic' : 'assistant'); setTopicTag(record.topicTag || ''); setTurns(record.turns as ChatTurn[])
    setActiveRules(record.state.activeRules.map(r=>({id:r.id,title:r.title,version:r.version,count:r.rules.length})))
    setUsage(record.state.usage); setLastUsage(null); setKnowledgeError(''); setStatus('')
    currentAssistant.current=-1; referencesRef.current=[]; lastContentRef.current=''
    conversationContext.current=record.context || {mode:'auto',paths:[]}; draft.current=record.draft || ''
    callbacksRef.current?.onConversationLoaded?.(record)
  }
  const referencesRef = useRef<KnowledgeReference[]>([])
  const currentAssistant = useRef<number>(-1)
  // 回调用 ref 承接，避免事件订阅因闭包过期而读到旧函数
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks
  // 最近一条 assistant 回复的最终内容与 turn id（done 时供 onTurnComplete 使用）
  const lastContentRef = useRef('')
  const lastTurnIdRef = useRef('')
  // turn 稳定 id 计数器
  const seqRef = useRef(0)
  const sessionId = useRef(crypto.randomUUID())
  const nextTurnId = (): string => `t_${sessionId.current}_${++seqRef.current}`
  useEffect(()=>{
    let cancelled=false
    window.winagent.chats.list().then(async records=>{
      if(cancelled)return
      const record=await window.winagent.chats.open('assistant')
      if(!cancelled){applyConversation(record);setConversations(await window.winagent.chats.list())}
    }).catch(e=>{if(!cancelled)setKnowledgeError(String(e))}).finally(()=>{if(!cancelled)setSwitching(false)})
    return()=>{cancelled=true;clearTimeout(saveTimer.current)}
  },[])
  const saveConversation = async (): Promise<void> => {
    if(!conversationId || busy)return
    await window.winagent.chats.save(conversationId,turns,conversationContext.current,draft.current)
    setConversations(await window.winagent.chats.list())
  }
  useEffect(()=>{
    clearTimeout(saveTimer.current)
    if(!busy && !switching && conversationId && (turns.length||draft.current.trim())) saveTimer.current=setTimeout(()=>{void saveConversation().catch(e=>setKnowledgeError(String(e)))},300)
    return()=>clearTimeout(saveTimer.current)
  },[turns,busy,switching,conversationId,draftRevision])
  const switchConversation = async (id='assistant'): Promise<void> => {
    if(busy || switching || (id && id===conversationId))return
    clearTimeout(saveTimer.current);setSwitching(true)
    try { await saveConversation(); applyConversation(await window.winagent.chats.open(id));setConversations(await window.winagent.chats.list()) }
    catch(e){setKnowledgeError(String(e))} finally{setSwitching(false)}
  }
  const createTopic = async (title: string): Promise<void> => {
    if (busy || switching) return
    clearTimeout(saveTimer.current);setSwitching(true)
    try { await saveConversation();applyConversation(await window.winagent.chats.createTopic(title));setConversations(await window.winagent.chats.list()) }
    catch(e){setKnowledgeError(String(e));throw e}finally{setSwitching(false)}
  }
  const setDraftContext = (text: string, context: KnowledgeContext): void => {draft.current=text;conversationContext.current=context;setDraftRevision(n=>n+1)}

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
            next.push({ id: nextTurnId(), role: 'assistant', content: '', reasoning: '', toolCalls: [], streaming: true, references: referencesRef.current })
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
          referencesRef.current = e.references || []
          setKnowledgeError(e.error || '')
          setStatus(e.count > 0
            ? `📚 已检索知识库：注入 ${e.count} 条相关笔记`
            : '📚 已检索知识库：未找到相关内容')
          break
        case 'rules':
          setActiveRules(e.sets)
          break
        case 'rule_report':
          patchAssistant(t => { t.ruleReport = e.report })
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
          setKnowledgeError(e.message)
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

  const send = useCallback(async (text: string, attachments?: Array<{ name: string; isImage: boolean; dataUrl?: string; path: string; mime?: string }>, context?: KnowledgeContext) => {
    if (!text.trim() || busy) return
    conversationContext.current = context || {mode:'auto',paths:[]}; draft.current=''
    setTurns((prev) => [...prev, { id: nextTurnId(), role: 'user', content: text, toolCalls: [], attachments }])
    setBusy(true)
    currentAssistant.current = -1
    referencesRef.current = []
    setKnowledgeError('')
    setStatus('思考中…')
    try { await window.winagent.send(text, attachments as any, context) }
    catch (e) { setBusy(false); setKnowledgeError(e instanceof Error ? e.message : String(e)); setStatus('发送失败') }
    finally { setBusy(false) }
  }, [busy])

  const stop = useCallback(() => {
    window.winagent.stop()
    setVisionActive(false)
    setStatus('正在停止…')
  }, [])

  const reset = useCallback(async () => {
    await window.winagent.reset()
    if(conversationId)await window.winagent.chats.save(conversationId,[],conversationContext.current,'')
    setTurns([])
    setActiveRules([])
    setKnowledgeError('')
    setStatus('')
    setUsage(null)
    setLastUsage(null)
    setVisionActive(false)
    lastContentRef.current = ''
  }, [conversationId])

  const compact = useCallback(async () => {
    setStatus('压缩中…')
    await window.winagent.compact()
  }, [])

  const respondConfirm = useCallback((approved: boolean) => {
    if (confirm) window.winagent.replyConfirm(confirm.id, approved)
    setConfirm(null)
  }, [confirm])

  return { turns, busy: busy || switching, status, confirm, usage, lastUsage, visionActive, activeRules, knowledgeError, send, stop, reset, compact, respondConfirm, conversations, conversationId, conversationKind, topicTag, switchConversation, createTopic, setDraftContext }
}
