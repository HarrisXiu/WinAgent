/**
 * 全局语音播放状态：单一事实来源，经 context 下发给 SpeechBar 与 Message。
 *
 * 三条来源（气泡手动朗读 / autoPlay 自动朗读 / Agent 的 speak_text / 试听）从此走同一状态机：
 * speak() → tts:start → 服务端逐段合成 → voice:segment 事件入队播放 → 播到该段时 tts:ack
 * 回执驱动服务端滑窗预取 → 播完/出错/取消统一在此收尾。
 *
 * 合成缓存：键包含 messageId、文本和音色参数，内容或音色变化后重新合成；
 * LRU 封顶 20 条（缓存的是 base64 音频 dataURL，不封顶会持续涨内存）。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { AppConfig, VoiceSegmentEvent, VoiceSessionEndEvent } from '../../../shared/types'
import { AudioQueue } from './player'

export type SpeechSource = 'manual' | 'auto' | 'agent' | 'test'
export type SpeechState = 'idle' | 'loading' | 'playing' | 'paused'

export interface SpeechOpts {
  /** 关联的消息 id（气泡朗读态依据；缺省不关联，如 Agent 主动开口/试听） */
  messageId?: string
  source?: SpeechSource
  /** 覆盖音色（内置音色名或 clone:<id>），缺省用配置默认音色 */
  voice?: string
}

export interface SpeechView {
  state: SpeechState
  messageId: string | null
  source: SpeechSource | null
  /** 正在播放的段（1-based；0 = 尚未开播） */
  index: number
  total: number
  error: string
}

export interface SpeechApi extends SpeechView {
  speak(text: string, opts?: SpeechOpts): void
  stop(): void
  pause(): void
  resume(): void
  skip(): void
}

const SpeechContext = createContext<SpeechApi | null>(null)

export function useSpeech(): SpeechApi {
  const ctx = useContext(SpeechContext)
  if (!ctx) throw new Error('useSpeech 必须在 SpeechProvider 内使用')
  return ctx
}

/** 渲染层侧的取消判定（与服务端 TTS_CANCELLED 哨兵同源） */
function isCancelledError(e: unknown): boolean {
  if (e instanceof Error) {
    if (e.name === 'AbortError') return true
    return e.message.includes('TTS_CANCELLED')
  }
  return false
}

/** 合成缓存条数上限 */
const CACHE_MAX = 20

interface CurrentSession {
  id: string
  total: number
  messageId: string | null
  source: SpeechSource
  /** 缓存键；null = 不缓存（Agent 开口/试听） */
  key: string | null
  urls: string[]
  error: string
}

export function SpeechProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [view, setView] = useState<SpeechView>({ state: 'idle', messageId: null, source: null, index: 0, total: 0, error: '' })
  const cfgRef = useRef<AppConfig | null>(null)
  const currentRef = useRef<CurrentSession | null>(null)
  /** speak/stop 世代号：使在途 tts:start 的迟到结果失效 */
  const genRef = useRef(0)
  const errRef = useRef('')
  const cacheRef = useRef(new Map<string, string[]>())
  const queueRef = useRef<AudioQueue | null>(null)

  useEffect(() => {
    void window.winagent.getConfig().then((c) => (cfgRef.current = c))
    return window.winagent.onConfigChanged((c) => (cfgRef.current = c))
  }, [])

  const cacheComplete = useCallback((cur: CurrentSession): void => {
    // 合成完整即缓存，不要求用户听完；部分内容和失败结果不能用于重播。
    if (cur.key && !cur.error && !errRef.current && cur.total > 0 && cur.urls.length === cur.total) {
      const cache = cacheRef.current
      cache.delete(cur.key)
      cache.set(cur.key, [...cur.urls])
      while (cache.size > CACHE_MAX) {
        const oldest = cache.keys().next().value
        if (oldest === undefined) break
        cache.delete(oldest)
      }
    }
  }, [])

  const finish = useCallback((): void => {
    currentRef.current = null
    const error = errRef.current
    errRef.current = ''
    setView({ state: 'idle', messageId: null, source: null, index: 0, total: 0, error })
  }, [])

  const getQueue = useCallback((): AudioQueue => {
    if (!queueRef.current) {
      queueRef.current = new AudioQueue({
        onSegmentStart: (i) => {
          const cur = currentRef.current
          setView((v) => ({ ...v, state: 'playing', index: i + 1, total: cur?.total || v.total }))
          // 缓存重播没有服务端会话，无需 ack
          if (cur && cur.id !== 'cache') window.winagent.tts.ack(cur.id, i)
        },
        onAllEnd: () => {
          const cur = currentRef.current
          if (!cur) return
          if (cur.id === 'cache' || cur.error || cur.urls.length === cur.total) {
            finish()
          } else {
            // 当前音频播完不等于全文合成完：保留会话，等待下一段。
            setView((v) => ({ ...v, state: 'loading' }))
          }
        },
        onError: (msg) => {
          if (!errRef.current) errRef.current = msg
          const key = currentRef.current?.key
          if (key) cacheRef.current.delete(key)
          setView((v) => ({ ...v, error: v.error || msg }))
        }
      })
    }
    return queueRef.current
  }, [finish])

  const stop = useCallback((): void => {
    ++genRef.current
    const prev = currentRef.current
    currentRef.current = null
    if (prev && prev.id !== 'cache') window.winagent.tts.cancel(prev.id)
    getQueue().stopAll()
    errRef.current = ''
    setView({ state: 'idle', messageId: null, source: null, index: 0, total: 0, error: '' })
  }, [getQueue])

  const speak = useCallback((text: string, opts: SpeechOpts = {}): void => {
    const gen = ++genRef.current
    const cfg = cfgRef.current
    const source = opts.source ?? 'manual'
    const voice = opts.voice || cfg?.voice.voice || 'mimo_default'
    const key = opts.messageId
      ? JSON.stringify([opts.messageId, text, voice, cfg?.voice.stylePrompt || '', cfg?.voice.outputFormat || 'wav'])
      : null

    // 停掉进行中的会话（单会话模型）
    const prev = currentRef.current
    currentRef.current = null
    if (prev && prev.id !== 'cache') window.winagent.tts.cancel(prev.id)
    getQueue().stopAll()
    errRef.current = ''

    const messageId = opts.messageId ?? null
    const baseView = { messageId, source, error: '' } as const

    // 命中合成缓存：直接重播，不发起请求
    if (key) {
      const urls = cacheRef.current.get(key)
      if (urls && urls.length > 0) {
        cacheRef.current.delete(key)
        cacheRef.current.set(key, urls)
        currentRef.current = { id: 'cache', total: urls.length, messageId, source, key, urls, error: '' }
        setView({ state: 'loading', ...baseView, index: 0, total: urls.length })
        const queue = getQueue()
        for (const u of urls) queue.enqueue(u)
        return
      }
    }

    setView({ state: 'loading', ...baseView, index: 0, total: 0 })
    void (async () => {
      try {
        const r = await window.winagent.tts.start(text, { voice: opts.voice, source })
        if (gen !== genRef.current) {
          // 等待期间被新的 speak/stop 顶掉：立即取消这次会话
          window.winagent.tts.cancel(r.sessionId)
          return
        }
        currentRef.current = { id: r.sessionId, total: r.total, messageId, source, key, urls: [], error: '' }
        setView((v) => ({ ...v, total: r.total }))
      } catch (e) {
        if (gen !== genRef.current) return
        currentRef.current = null
        const msg = e instanceof Error ? e.message : String(e)
        setView({ state: 'idle', messageId: null, source: null, index: 0, total: 0, error: isCancelledError(e) ? '' : msg })
      }
    })()
  }, [getQueue])

  // voice:segment → 入队；voice:session:end → 错误展示 / 兜底收尾
  useEffect(() => {
    const offSegment = window.winagent.tts.onSegment((d: VoiceSegmentEvent) => {
      const cur = currentRef.current
      if (!cur || cur.id !== d.sessionId) return
      const url = `data:${d.mime};base64,${d.audioBase64}`
      cur.urls.push(url)
      cacheComplete(cur)
      setView((v) => (v.total === d.total ? v : { ...v, total: d.total }))
      getQueue().enqueue(url)
    })
    const offEnd = window.winagent.tts.onSessionEnd((d: VoiceSessionEndEvent) => {
      const cur = currentRef.current
      if (!cur || cur.id !== d.sessionId) return
      if (d.error) {
        cur.error = d.error
        if (!errRef.current) errRef.current = d.error
        setView((v) => ({ ...v, error: v.error || d.error! }))
        // 尚未开播（首段就失败）：队列不会自然排空，这里直接收尾
        if (getQueue().idle) finish()
      } else if (getQueue().idle) {
        // 无错误的结束（兜底；正常取消路径 stop() 已先清 currentRef）
        finish()
      }
    })
    return () => {
      offSegment()
      offEnd()
    }
  }, [cacheComplete, finish, getQueue])

  // 卸载时停掉音频（dev 热重载等场景）
  useEffect(() => () => queueRef.current?.stopAll(), [])

  const pause = useCallback((): void => {
    getQueue().pause()
    setView((v) => (v.state === 'playing' ? { ...v, state: 'paused' } : v))
  }, [getQueue])

  const resume = useCallback((): void => {
    getQueue().resume()
    setView((v) => (v.state === 'paused' ? { ...v, state: 'playing' } : v))
  }, [getQueue])

  const skip = useCallback((): void => {
    getQueue().skipCurrent()
  }, [getQueue])

  const api = useMemo<SpeechApi>(
    () => ({ ...view, speak, stop, pause, resume, skip }),
    [view, speak, stop, pause, resume, skip]
  )

  return <SpeechContext.Provider value={api}>{children}</SpeechContext.Provider>
}
