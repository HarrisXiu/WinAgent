/**
 * 有序事件总线：agent/wikii 事件按 seq 递增，客户端带 seq 长轮询增量拉取。
 * @module dsh-winagent/event-bus
 */
export interface BusEvent {
    seq: number;
    type: string;
    data: unknown;
}
export declare class EventBus {
    private events;
    private seq;
    private waitSeq;
    private waiters;
    /** push 时的同步订阅者（Electron 主进程 IPC 转发用），返回退订函数 */
    private subscribers;
    push(type: string, data: unknown): void;
    /** 订阅 push 事件（同步回调）；返回退订函数 */
    subscribe(cb: (e: BusEvent) => void): () => void;
    /** seq 之后的所有事件；没有则等 timeoutMs，到期返回空数组。 */
    waitSince(seq: number, timeoutMs: number): Promise<BusEvent[]>;
}
