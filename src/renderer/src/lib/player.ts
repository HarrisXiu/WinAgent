/**
 * 分段音频播放队列：全局同一时刻只跑一个队列，逐段顺序播放。
 *
 * - enqueue 追加一段（dataURL）；首段入队即开播
 * - 当前段开播时预创建下一段的 Audio，减小段间空隙
 * - error 事件兜底：dataURL 解码失败也会推进队列/回调错误，界面不会卡死在「播放中」
 *   （<audio> 解码失败只触发 error 不触发 ended）
 */

export interface AudioQueueCallbacks {
  /** 某段开始播放（0-based 下标） */
  onSegmentStart?: (index: number) => void
  /** 当前已入队的段落播完；流式合成可能仍有后续段落 */
  onAllEnd?: () => void
  /** 某段播放出错（已跳过该段继续；持续失败会逐段回调） */
  onError?: (message: string) => void
}

interface QueueItem {
  url: string
  index: number
  audio?: HTMLAudioElement
}

export class AudioQueue {
  private cb: AudioQueueCallbacks
  private items: QueueItem[] = []
  /** 正在播放的下标；-1 = 空闲 */
  private current = -1
  private paused = false
  /** 队列短暂排空后仍保持会话段号，只有 stopAll 才重置 */
  private nextSegmentIndex = 0

  constructor(cb: AudioQueueCallbacks = {}) {
    this.cb = cb
  }

  /** 队列是否空闲（无正在播放的段） */
  get idle(): boolean {
    return this.current < 0
  }

  /** 追加一段；若队列空闲则立即开播 */
  enqueue(url: string): void {
    this.items.push({ url, index: this.nextSegmentIndex++ })
    if (this.current < 0) {
      this.paused = false
      this.playIndex(0)
    }
  }

  /** 停止一切并清空队列（不回调 onAllEnd；调用方自行收尾） */
  stopAll(): void {
    const audio = this.items[this.current]?.audio
    if (audio) {
      audio.pause()
      audio.src = ''
    }
    // 释放尚未播到的预创建元素
    for (const item of this.items) {
      if (item.audio && item !== this.items[this.current]) {
        item.audio.pause()
        item.audio.src = ''
        item.audio = undefined
      }
    }
    this.items = []
    this.current = -1
    this.paused = false
    this.nextSegmentIndex = 0
  }

  pause(): void {
    if (this.current < 0 || this.paused) return
    this.items[this.current]?.audio?.pause()
    this.paused = true
  }

  resume(): void {
    if (this.current < 0 || !this.paused) return
    this.paused = false
    void this.items[this.current]?.audio?.play().catch(() => {})
  }

  /** 跳过当前段（等同该段自然播完） */
  skipCurrent(): void {
    if (this.current < 0) return
    this.advance(this.current)
  }

  private playIndex(index: number): void {
    const item = this.items[index]
    if (!item) {
      // 队列被外部清空等异常路径
      this.current = -1
      return
    }
    this.current = index
    this.paused = false
    let audio = item.audio
    if (!audio) {
      audio = new Audio(item.url)
      item.audio = audio
    }
    audio.addEventListener('ended', () => {
      if (this.items[this.current] === item) this.advance(index)
    })
    audio.addEventListener('error', () => {
      if (this.items[this.current] !== item) return
      this.cb.onError?.(audio?.error?.message || '音频解码失败')
      this.advance(index)
    })
    // 预创建下一段，减小段间空隙
    const next = this.items[index + 1]
    if (next && !next.audio) {
      const a = new Audio(next.url)
      a.preload = 'auto'
      a.load()
      next.audio = a
    }
    void audio.play().catch(() => {
      // 自动播放被拒等场景：按该段结束处理，避免 UI 卡在「播放中」
      if (this.items[this.current] === item) this.advance(index)
    })
    this.cb.onSegmentStart?.(item.index)
  }

  /** 该段结束（自然播完 / 出错 / 跳过）→ 推进 */
  private advance(index: number): void {
    if (this.current !== index) return
    const audio = this.items[index]?.audio
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    const next = index + 1
    if (next < this.items.length) {
      this.playIndex(next)
    } else {
      this.current = -1
      this.paused = false
      this.items = []
      this.cb.onAllEnd?.()
    }
  }
}
