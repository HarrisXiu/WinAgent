"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventBus = void 0;
class EventBus {
    events = [];
    seq = 0;
    waitSeq = 0;
    waiters = new Map();
    push(type, data) {
        this.seq++;
        this.events.push({ seq: this.seq, type, data });
        if (this.events.length > 4000)
            this.events.splice(0, this.events.length - 4000);
        for (const wake of [...this.waiters.values()])
            wake();
    }
    /** seq 之后的所有事件；没有则等 timeoutMs，到期返回空数组。 */
    waitSince(seq, timeoutMs) {
        const newer = this.events.filter((e) => e.seq > seq);
        if (newer.length > 0)
            return Promise.resolve(newer);
        return new Promise((resolve) => {
            const id = ++this.waitSeq;
            const timer = setTimeout(() => {
                this.waiters.delete(id);
                resolve([]);
            }, timeoutMs);
            this.waiters.set(id, () => {
                clearTimeout(timer);
                this.waiters.delete(id);
                resolve(this.events.filter((e) => e.seq > seq));
            });
        });
    }
}
exports.EventBus = EventBus;
