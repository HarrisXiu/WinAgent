import type { EventBus } from '../event-bus';
/** 朗读来源 */
export type SpeechSource = 'manual' | 'auto' | 'agent' | 'test';
export interface SessionStartOptions {
    /** 已解析的音色（clone:<id> 已展开为样本 dataURL） */
    voice: string;
    stylePrompt: string;
    source: SpeechSource;
    apiKey: string;
    baseUrl: string;
    outputFormat: 'wav' | 'mp3';
}
export declare class SpeechSessionManager {
    private bus;
    private current;
    private seq;
    constructor(bus: EventBus);
    /** 开启新会话（自动取消旧会话）；立即返回，合成在后台进行 */
    start(segments: string[], opts: SessionStartOptions): {
        sessionId: string;
        total: number;
    };
    /** 渲染层播到第 index 段（0-based）时回执，驱动滑窗前进 */
    ack(sessionId: string, index: number): void;
    /** 取消会话（不带 id = 取消当前） */
    cancel(sessionId?: string): void;
    /** 顺序合成循环；ack / start 会再次触发，pumping 标志防重入 */
    private pump;
}
