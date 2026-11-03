import { useEffect, useRef, useState } from 'react'
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


type RuleChip = { id: string; title: string; version: string; count: number }

/** 列表摘要 + 归档标记（归档存于对话记录的附加字段，由主进程 chats:list 补出） */
export type TopicSummary = ConversationSummary & { archived?: boolean }

/**
 * 对话状态机。「查看」与「运行」分离：Agent 同一时刻只跑一个任务（主进程单会话），
 * 但任务运行中可以切到别的对话查看/起草——后台任务的事件写进 runTurnsRef，
 * 只有正在查看它时才同步上屏；结束后自动落盘。
 */
export function useAgent(callbacks?: UseAgentCallbacks) {
  const [turns, setTurnsState] = useState<ChatTurn[]>([])
  // 界面 turns 的同步镜像：事件回调与 send/regenerate 读它，避免闭包读到旧值
  const turnsRef = useRef<ChatTurn[]>([])
  const setViewTurns = (next: ChatTurn[]): void => { turnsRef.current = next; setTurnsState(next) }
  const [status, setStatus] = useState('')
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [usage, setUsage] = useState<TokenUsage | null>(null)
  const [lastUsage, setLastUsage] = useState<TokenUsage | null>(null)
  const [visionActive, setVisionActive] = useState(false)
  const [activeRules, setActiveRules] = useState<RuleChip[]>([])
  const [knowledgeError, setKnowledgeError] = useState('')
  const [conversations, setConversations] = useState<TopicSummary[]>([])
  const [conversationId, setConversationId] = useState('')
  const [conversationKind, setConversationKind] = useState<'assistant'|'topic'>('assistant')
  const [topicTag, setTopicTag] = useState('')
  const [switching, setSwitching] = useState(true)
  // ── 运行中的任务（可能不是正在查看的对话） ──
  const [runningId, setRunningId] = useState('')
  const runIdRef = useRef('')
  const runTurnsRef = useRef<ChatTurn[]>([])
  /** 运行期间的状态栏/用量/规范快照：切回运行中的对话时恢复 */
  const runMetaRef = useRef<{ status: string; usage: TokenUsage | null; lastUsage: TokenUsage | null; rules: RuleChip[] | null }>({ status: '', usage: null, lastUsage: null, rules: null })
  /** 本轮是否已真正开始（收到过 round 事件）；未开始就失败的请求不可「重新生成」 */
  const startedRef = useRef(false)
  const viewIdRef = useRef('')
  /** 可重新生成的对话 id（主进程持有该对话最近一次发送前的快照，仅本次启动内有效） */
  const [regenerableId, setRegenerableId] = useState('')
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const conversationContext = useRef<KnowledgeContext>({mode:'auto',paths:[]})
  const draft = useRef('')
  const [draftRevision,setDraftRevision] = useState(0)
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

  const running = !!runningId
  /** 当前没有任务，或正在查看的就是运行中的对话：状态类事件才上屏 */
  const forView = (): boolean => !runIdRef.current || runIdRef.current === viewIdRef.current
  const viewIsRunning = (): boolean => !!runIdRef.current && runIdRef.current === viewIdRef.current
  const refreshList = (): void => { void window.winagent.chats.list().then(setConversations).catch(() => {}) }

  const applyConversation = (record: SavedConversation): void => {
    viewIdRef.current = record.id
    setConversationId(record.id); setConversationKind(record.kind === 'topic' ? 'topic' : 'assistant'); setTopicTag(record.topicTag || '')
    // 切回运行中的对话：用内存里的实时 turns/状态，而不是尚未落盘的旧存档
    const live = runIdRef.current === record.id
    const meta = runMetaRef.current
    setViewTurns(live ? runTurnsRef.current : record.turns as ChatTurn[])
    setActiveRules(live && meta.rules ? meta.rules : record.state.activeRules.map(r=>({id:r.id,title:r.title,version:r.version,count:r.rules.length})))
    setUsage(live && meta.usage ? meta.usage : record.state.usage); setLastUsage(live ? meta.lastUsage : null)
    setKnowledgeError(''); setStatus(live ? meta.status : ''); setVisionActive(false)
    conversationContext.current=record.context || {mode:'auto',paths:[]}; draft.current=record.draft || ''
    callbacksRef.current?.onConversationLoaded?.(record)
  }
  useEffect(()=>{
    let cancelled=false
    window.winagent.chats.list().then(async ()=>{
      if(cancelled)return
      const record=await window.winagent.chats.open('assistant')
      if(!cancelled){applyConversation(record);setConversations(await window.winagent.chats.list())}
    }).catch(e=>{if(!cancelled)setKnowledgeError(String(e))}).finally(()=>{if(!cancelled)setSwitching(false)})
    return()=>{cancelled=true;clearTimeout(saveTimer.current)}
  },[])
  const saveConversation = async (): Promise<void> => {
    // 运行中的对话由 finishRun 在结束时统一落盘
    if(!conversationId || viewIsRunning())return
    await window.winagent.chats.save(conversationId,turnsRef.current,conversationContext.current,draft.current)
    setConversations(await window.winagent.chats.list())
  }
  useEffect(()=>{
    clearTimeout(saveTimer.current)
    if(!viewIsRunning() && !switching && conversationId && (turns.length||draft.current.trim())) saveTimer.current=setTimeout(()=>{void saveConversation().catch(e=>setKnowledgeError(String(e)))},300)
    return()=>clearTimeout(saveTimer.current)
  },[turns,runningId,switching,conversationId,draftRevision])
  /** 任务运行中也允许切换：后台任务照常执行，切回来能看到实时进度 */
  const switchConversation = async (id='assistant'): Promise<void> => {
    if(switching || (id && id===conversationId))return
    clearTimeout(saveTimer.current);setSwitching(true)
    try { await saveConversation(); applyConversation(await window.winagent.chats.open(id));setConversations(await window.winagent.chats.list()) }
    catch(e){setKnowledgeError(String(e))} finally{setSwitching(false)}
  }
  const createTopic = async (title: string): Promise<void> => {
    if (switching) return
    clearTimeout(saveTimer.current);setSwitching(true)
    try { await saveConversation();applyConversation(await window.winagent.chats.createTopic(title));setConversations(await window.winagent.chats.list()) }
    catch(e){setKnowledgeError(String(e));throw e}finally{setSwitching(false)}
  }
  const setDraftContext = (text: string, context: KnowledgeContext): void => {draft.current=text;conversationContext.current=context;setDraftRevision(n=>n+1)}

  // ── 专题管理：重命名 / 归档 / 删除（运行中的专题由主进程拒绝） ──
  const renameTopic = async (id: string, title: string): Promise<number> => {
    const { wikiFiles } = await window.winagent.chats.renameTopic(id, title)
    if (id === viewIdRef.current) setTopicTag(`专题:${title.trim().replace(/\s+/g, ' ')}`)
    setConversations(await window.winagent.chats.list())
    return wikiFiles
  }
  const archiveTopic = async (id: string, archived: boolean): Promise<void> => {
    await window.winagent.chats.archiveTopic(id, archived)
    setConversations(await window.winagent.chats.list())
  }
  const deleteTopic = async (id: string, removeWikiTag: boolean): Promise<number> => {
    const viewing = id === viewIdRef.current
    // 先掐掉待执行的自动保存：否则会对已删除的记录回写并报 ENOENT
    if (viewing) clearTimeout(saveTimer.current)
    const { wikiFiles } = await window.winagent.chats.deleteTopic(id, removeWikiTag)
    if (regenerableId === id) setRegenerableId('')
    if (viewing) {
      // 不走 switchConversation：它会先保存当前（已删除的）对话
      setSwitching(true)
      try { applyConversation(await window.winagent.chats.open('assistant')) }
      catch (e) { setKnowledgeError(String(e)) }
      finally { setSwitching(false) }
    }
    setConversations(await window.winagent.chats.list())
    return wikiFiles
  }

  // ── 运行中任务的 turns 更新：总是写 runTurnsRef，正在查看时同步上屏 ──
  const updateRunTurns = (fn: (prev: ChatTurn[]) => ChatTurn[]): void => {
    runTurnsRef.current = fn(runTurnsRef.current)
    if (viewIsRunning()) setViewTurns(runTurnsRef.current)
  }
  const patchAssistant = (fn: (t: ChatTurn) => void): void => {
    updateRunTurns((prev) => {
      const idx = currentAssistant.current
      if (idx < 0 || !prev[idx]) return prev
      const next = [...prev]
      const copy = { ...next[idx], toolCalls: [...next[idx].toolCalls] }
      fn(copy)
      next[idx] = copy
      return next
    })
  }
  const setRunStatus = (text: string): void => {
    runMetaRef.current.status = text
    if (forView()) setStatus(text)
  }
  const startRun = (id: string, initial: ChatTurn[]): void => {
    runIdRef.current = id
    runTurnsRef.current = initial
    runMetaRef.current = { status: '思考中…', usage: null, lastUsage: null, rules: null }
    startedRef.current = false
    currentAssistant.current = -1
    referencesRef.current = []
    lastContentRef.current = ''
    setViewTurns(initial)
    setRunningId(id)
    setKnowledgeError('')
    setStatus('思考中…')
  }
  /** 结束运行（done / error / 请求返回三处都会调，幂等）；后台任务在此落盘 */
  const finishRun = (): void => {
    const id = runIdRef.current
    if (!id) return
    // 停止/出错时可能残留 streaming 标记，统一收尾
    const final = runTurnsRef.current.map((t) => (t.streaming ? { ...t, streaming: false } : t))
    runTurnsRef.current = final
    const viewing = viewIdRef.current === id
    if (viewing) setViewTurns(final)
    runIdRef.current = ''
    setRunningId('')
    setVisionActive(false)
    setRegenerableId(startedRef.current ? id : '')
    // 查看中的对话由自动保存 effect 落盘；后台对话在这里只回写 turns（context/draft 保留原值）
    if (!viewing) void window.winagent.chats.save(id, final).then(refreshList).catch((e) => setKnowledgeError(String(e)))
  }

  useEffect(() => {
    const off = window.winagent.onEvent((e: AgentEvent) => {
      switch (e.type) {
        case 'round':
          startedRef.current = true
          setRunStatus(`第 ${e.round} 轮（历史 ${e.historyCount} 条）`)
          lastContentRef.current = ''
          // 每一轮开新的 assistant 气泡
          updateRunTurns((prev) => {
            const next: ChatTurn[] = [...prev, { id: nextTurnId(), role: 'assistant', content: '', reasoning: '', toolCalls: [], streaming: true, references: referencesRef.current }]
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
          setRunStatus(`已压缩上下文：${e.before} → ${e.after} tokens`)
          break
        case 'knowledge':
          referencesRef.current = e.references || []
          if (forView()) setKnowledgeError(e.error || '')
          setRunStatus(e.count > 0
            ? `📚 已检索知识库：注入 ${e.count} 条相关笔记`
            : '📚 已检索知识库：未找到相关内容')
          break
        case 'rules':
          runMetaRef.current.rules = e.sets
          if (forView()) setActiveRules(e.sets)
          break
        case 'rule_report':
          patchAssistant(t => { t.ruleReport = e.report })
          break
        case 'vision':
          // 立绘 vision 态按事件类型判定；不再正则匹配 status 文案
          // （「图片识别完成/失败」也含「识别」，靠文案会把立绘卡在识别态）
          if (forView()) setVisionActive(e.status === 'start')
          if (e.status === 'start') setRunStatus(`视觉模型 ${e.model} 识别图片中…`)
          else if (e.status === 'done') setRunStatus(`图片识别完成（${e.model}）`)
          else setRunStatus(`图片识别失败：${e.text || ''}`)
          break
        case 'usage':
          runMetaRef.current.usage = e.session
          runMetaRef.current.lastUsage = e.last
          if (forView()) { setLastUsage(e.last); setUsage(e.session) }
          break
        case 'error':
          if (forView()) setKnowledgeError(e.message)
          patchAssistant((t) => {
            t.content += `\n\n**⚠ 错误：** ${e.message}`
            t.streaming = false
          })
          setRunStatus('出错')
          finishRun()
          break
        case 'done': {
          // 回复完成（含多轮工具调用后的最终回复）；出错路径不走这里。后台完成的任务不自动朗读
          if (viewIsRunning() && lastContentRef.current) callbacksRef.current?.onTurnComplete?.(lastContentRef.current, lastTurnIdRef.current)
          setRunStatus('')
          lastContentRef.current = ''
          finishRun()
          break
        }
      }
    })

    const offConfirm = window.winagent.onConfirm((req) => setConfirm(req))
    return () => {
      off()
      offConfirm()
    }
    // 处理函数只读 ref 与稳定的 setState，订阅一次即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const send = async (text: string, attachments?: Array<{ name: string; isImage: boolean; dataUrl?: string; path: string; mime?: string }>, context?: KnowledgeContext): Promise<void> => {
    if (!text.trim() || runIdRef.current || switching) return
    conversationContext.current = context || {mode:'auto',paths:[]}; draft.current=''
    startRun(viewIdRef.current, [...turnsRef.current, { id: nextTurnId(), role: 'user', content: text, toolCalls: [], attachments }])
    try { await window.winagent.send(text, attachments as any, context) }
    catch (e) { if (forView()) setKnowledgeError(e instanceof Error ? e.message : String(e)); setRunStatus('发送失败') }
    finally { finishRun() }
  }

  /** 丢弃最新回复，回滚到发送前快照按原问题重跑 */
  const regenerate = async (): Promise<void> => {
    const id = viewIdRef.current
    if (runIdRef.current || switching || regenerableId !== id) return
    const before = turnsRef.current
    const lastUser = before.map((t) => t.role).lastIndexOf('user')
    if (lastUser < 0) return
    startRun(id, before.slice(0, lastUser + 1))
    try { await window.winagent.regenerate() }
    catch (e) {
      // 主进程拒绝（快照失效等）：原样恢复被移除的回复
      if (!startedRef.current) runTurnsRef.current = before
      if (forView()) setKnowledgeError(e instanceof Error ? e.message : String(e))
      setRunStatus('')
    }
    finally { finishRun() }
  }

  const stop = (): void => {
    window.winagent.stop()
    setVisionActive(false)
    setStatus('正在停止…')
  }

  const reset = async (): Promise<void> => {
    if (runIdRef.current) { setKnowledgeError('任务执行中，无法清空对话'); return }
    try { await window.winagent.reset() } catch (e) { setKnowledgeError(e instanceof Error ? e.message : String(e)); return }
    if(conversationId)await window.winagent.chats.save(conversationId,[],conversationContext.current,'')
    setViewTurns([])
    setActiveRules([])
    setKnowledgeError('')
    setStatus('')
    setUsage(null)
    setLastUsage(null)
    setVisionActive(false)
    setRegenerableId('')
    lastContentRef.current = ''
  }

  const compact = async (): Promise<void> => {
    if (runIdRef.current) return
    setStatus('压缩中…')
    setRegenerableId('')
    try { await window.winagent.compact() } catch (e) { setKnowledgeError(e instanceof Error ? e.message : String(e)); setStatus('') }
  }

  const respondConfirm = (approved: boolean): void => {
    if (confirm) window.winagent.replyConfirm(confirm.id, approved)
    setConfirm(null)
  }

  return {
    turns,
    /** 正在查看的对话在运行：显示停止按钮、Esc 可停止 */
    busy: running && runningId === conversationId,
    /** 正在加载/切换对话：短暂禁止发送 */
    switching,
    /** 任意任务在运行（Agent 单任务）：发送/清空/压缩都要等它结束 */
    running,
    runningId,
    canRegenerate: !running && !switching && !!regenerableId && regenerableId === conversationId,
    regenerate,
    renameTopic, archiveTopic, deleteTopic,
    status, confirm, usage, lastUsage, visionActive, activeRules, knowledgeError, send, stop, reset, compact, respondConfirm, conversations, conversationId, conversationKind, topicTag, switchConversation, createTopic, setDraftContext
  }
}
