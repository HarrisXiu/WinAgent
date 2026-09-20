"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeechSessionManager = void 0;
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
const Logger_1 = require("../util/Logger");
const MimoTtsClient_1 = require("./MimoTtsClient");
/** 渲染层播放到某段后的预取余量 */
const PREFETCH = 2;
class SpeechSessionManager {
    bus;
    current = null;
    seq = 0;
    constructor(bus) {
        this.bus = bus;
    }
    /** 开启新会话（自动取消旧会话）；立即返回，合成在后台进行 */
    start(segments, opts) {
        this.cancel();
        const id = `vs_${Date.now().toString(36)}_${++this.seq}`;
        const session = {
            id,
            segments,
            total: segments.length,
            lastAcked: -1,
            nextToSynth: 0,
            pumping: false,
            aborted: false,
            controller: new AbortController(),
            opts
        };
        this.current = session;
        void this.pump(session);
        return { sessionId: id, total: session.total };
    }
    /** 渲染层播到第 index 段（0-based）时回执，驱动滑窗前进 */
    ack(sessionId, index) {
        const s = this.current;
        if (!s || s.id !== sessionId)
            return;
        s.lastAcked = Math.max(s.lastAcked, index);
        void this.pump(s);
    }
    /** 取消会话（不带 id = 取消当前） */
    cancel(sessionId) {
        const s = this.current;
        if (!s)
            return;
        if (sessionId !== undefined && s.id !== sessionId)
            return;
        s.aborted = true;
        s.controller.abort();
        this.current = null;
        this.bus.push('voiceSessionEnd', { sessionId: s.id, total: s.total });
    }
    /** 顺序合成循环；ack / start 会再次触发，pumping 标志防重入 */
    async pump(s) {
        if (s.pumping)
            return;
        s.pumping = true;
        try {
            while (!s.aborted && s.nextToSynth < s.total && s.nextToSynth <= s.lastAcked + 1 + PREFETCH) {
                const index = s.nextToSynth++;
                try {
                    const r = await (0, MimoTtsClient_1.speak)({
                        apiKey: s.opts.apiKey,
                        baseUrl: s.opts.baseUrl,
                        text: s.segments[index],
                        stylePrompt: s.opts.stylePrompt,
                        voice: s.opts.voice,
                        outputFormat: s.opts.outputFormat,
                        signal: s.controller.signal
                    });
                    if (s.aborted)
                        return;
                    this.bus.push('voiceSegment', {
                        sessionId: s.id,
                        index,
                        total: s.total,
                        mime: r.mime,
                        audioBase64: r.audioBase64,
                        source: s.opts.source
                    });
                }
                catch (e) {
                    this.current = null;
                    if (!s.aborted && !(0, MimoTtsClient_1.isCancelled)(e)) {
                        const msg = e instanceof Error ? e.message : String(e);
                        Logger_1.Logger.error(`语音合成失败（段 ${index + 1}/${s.total}）: ${msg}`);
                        this.bus.push('voiceSessionEnd', { sessionId: s.id, total: s.total, error: msg });
                    }
                    // 取消（含 TTS_CANCELLED 哨兵）已由 cancel() 推过结束事件，这里静默收尾
                    return;
                }
            }
            // 全部段落合成完毕：结束由渲染层播完最后一段后自行收尾
            if (!s.aborted && s.nextToSynth >= s.total)
                this.current = null;
        }
        finally {
            s.pumping = false;
        }
    }
}
exports.SpeechSessionManager = SpeechSessionManager;
