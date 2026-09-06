/**
 * 有序事件总线：agent/wikii 事件按 seq 递增，客户端带 seq 长轮询增量拉取。
 * @module dsh-winagent/event-bus
 */
export interface BusEvent {
  seq: number
  type: string
  data: unknown
}

export class EventBus {
  private events: BusEvent[] = []
  private seq = 0
  private waitSeq = 0
  private waiters = new Map<number, () => void>()
  /** push 时的同步订阅者（Electron 主进程 IPC 转发用），返回退订函数 */
  private subscribers = new Set<(e: BusEvent) => void>()

  push(type: string, data: unknown): void {
    this.seq++
    const event: BusEvent = { seq: this.seq, type, data }
    this.events.push(event)
    if (this.events.length > 4000) this.events.splice(0, this.events.length - 4000)
    for (const wake of [...this.waiters.values()]) wake()
    for (const cb of [...this.subscribers]) {
      try { cb(event) } catch { /* 订阅者异常不影响事件分发 */ }
    }
  }

  /** 订阅 push 事件（同步回调）；返回退订函数 */
  subscribe(cb: (e: BusEvent) => void): () => void {
    this.subscribers.add(cb)
    return () => this.subscribers.delete(cb)
  }

  /** seq 之后的所有事件；没有则等 timeoutMs，到期返回空数组。 */
  waitSince(seq: number, timeoutMs: number): Promise<BusEvent[]> {
    const newer = this.events.filter((e) => e.seq > seq)
    if (newer.length > 0) return Promise.resolve(newer)
    return new Promise((resolve) => {
      const id = ++this.waitSeq
      const timer = setTimeout(() => {
        this.waiters.delete(id)
        resolve([])
      }, timeoutMs)
      this.waiters.set(id, () => {
        clearTimeout(timer)
        this.waiters.delete(id)
        resolve(this.events.filter((e) => e.seq > seq))
      })
    })
  }
}
