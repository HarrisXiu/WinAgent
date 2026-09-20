/**
 * 朗读会话编排：一段文本 → 多段合成 → 逐段经 bus 广播给渲染层播放。
 *
 * - start() 立即返回 {sessionId, total}，合成在后台 pump 中按序进行
 * - 滑窗预取：nextToSynth < lastAcked + 1 + PREFETCH（渲染层播到第 index 段时 ack(index)）。
 *   没有滑窗的话合成远快于播放，会一次性合成全文，用户中途停止时前面的请求全白花
 * - 单会话模型：新会话自动取消旧会话（与渲染层「同一时刻只播一条」一致）
 * - 每段复用 MimoTtsClient.speak 作单发原语
 *
 * 事件：bus.push('voiceSegment', VoiceSegmentEvent) / bus.push('voiceSessionEnd', VoiceSessionEndEvent)
 */
import { Logger } from '../util/Logger'
import type { EventBus } from '../event-bus'
import { isCancelled, speak } from './MimoTtsClient'

/** 渲染层播放到某段后的预取余量 */
const PREFETCH = 2

/** 朗读来源 */
export type SpeechSource = 'manual' | 'auto' | 'agent' | 'test'

export interface SessionStartOptions {
  /** 已解析的音色（clone:<id> 已展开为样本 dataURL） */
  voice: string
  stylePrompt: string
  source: SpeechSource
  apiKey: string
  baseUrl: string
  outputFormat: 'wav' | 'mp3'
}

interface Session {
  id: string
  segments: string[]
  total: number
  /** 渲染层已确认在播的段下标（-1 = 尚未开播） */
  lastAcked: number
  /** 下一个待合成的段下标 */
  nextToSynth: number
  /** pump 循环是否在跑（防重入） */
  pumping: boolean
  aborted: boolean
  controller: AbortController
  opts: SessionStartOptions
}

export class SpeechSessionManager {
  private bus: EventBus
  private current: Session | null = null
  private seq = 0

  constructor(bus: EventBus) {
    this.bus = bus
  }

  /** 开启新会话（自动取消旧会话）；立即返回，合成在后台进行 */
  start(segments: string[], opts: SessionStartOptions): { sessionId: string; total: number } {
    this.cancel()
    const id = `vs_${Date.now().toString(36)}_${++this.seq}`
    const session: Session = {
      id,
      segments,
      total: segments.length,
      lastAcked: -1,
      nextToSynth: 0,
      pumping: false,
      aborted: false,
      controller: new AbortController(),
      opts
    }
    this.current = session
    void this.pump(session)
    return { sessionId: id, total: session.total }
  }

  /** 渲染层播到第 index 段（0-based）时回执，驱动滑窗前进 */
  ack(sessionId: string, index: number): void {
    const s = this.current
    if (!s || s.id !== sessionId) return
    s.lastAcked = Math.max(s.lastAcked, index)
    void this.pump(s)
  }

  /** 取消会话（不带 id = 取消当前） */
  cancel(sessionId?: string): void {
    const s = this.current
    if (!s) return
    if (sessionId !== undefined && s.id !== sessionId) return
    s.aborted = true
    s.controller.abort()
    this.current = null
    this.bus.push('voiceSessionEnd', { sessionId: s.id, total: s.total })
  }

  /** 顺序合成循环；ack / start 会再次触发，pumping 标志防重入 */
  private async pump(s: Session): Promise<void> {
    if (s.pumping) return
    s.pumping = true
    try {
      while (!s.aborted && s.nextToSynth < s.total && s.nextToSynth <= s.lastAcked + 1 + PREFETCH) {
        const index = s.nextToSynth++
        try {
          const r = await speak({
            apiKey: s.opts.apiKey,
            baseUrl: s.opts.baseUrl,
            text: s.segments[index],
            stylePrompt: s.opts.stylePrompt,
            voice: s.opts.voice,
            outputFormat: s.opts.outputFormat,
            signal: s.controller.signal
          })
          if (s.aborted) return
          this.bus.push('voiceSegment', {
            sessionId: s.id,
            index,
            total: s.total,
            mime: r.mime,
            audioBase64: r.audioBase64,
            source: s.opts.source
          })
        } catch (e) {
          this.current = null
          if (!s.aborted && !isCancelled(e)) {
            const msg = e instanceof Error ? e.message : String(e)
            Logger.error(`语音合成失败（段 ${index + 1}/${s.total}）: ${msg}`)
            this.bus.push('voiceSessionEnd', { sessionId: s.id, total: s.total, error: msg })
          }
          // 取消（含 TTS_CANCELLED 哨兵）已由 cancel() 推过结束事件，这里静默收尾
          return
        }
      }
      // 全部段落合成完毕：结束由渲染层播完最后一段后自行收尾
      if (!s.aborted && s.nextToSynth >= s.total) this.current = null
    } finally {
      s.pumping = false
    }
  }
}
