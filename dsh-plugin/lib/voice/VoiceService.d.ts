/**
 * 语音服务门面：主进程 IPC 只与本类交互。
 * 负责配置读取（未配置时报友好错误）、文本预处理与切分、克隆音色（clone:<id>）解析、
 * 会话编排（SpeechSessionManager）；单段合成委托 MimoTtsClient.speak。
 */
import type { ConfigStore } from '../config/ConfigStore';
import type { EventBus } from '../event-bus';
import type { SessionStartResult, TtsResult } from '../shared/types';
import { type SpeechSource } from './SpeechSession';
import { VoiceStore } from './VoiceStore';
export declare class VoiceService {
    private store;
    private voices;
    private sessions;
    constructor(store: ConfigStore, voices: VoiceStore, bus: EventBus);
    get voiceStore(): VoiceStore;
    private requireReady;
    /** 解析音色：'clone:<id>' → 样本 dataURL；其余原样返回 */
    private resolveVoice;
    /**
     * 单发合成并返回音频（完整管线；会话路径请用 startSession）。
     * @param opts.voice 覆盖音色：内置音色名或 'clone:<voiceId>'；缺省用配置的默认音色
     * @param opts.stylePrompt 覆盖风格指令；缺省用配置值
     */
    speak(text: string, opts?: {
        voice?: string;
        stylePrompt?: string;
        signal?: AbortSignal;
    }): Promise<TtsResult>;
    /**
     * 开启分段朗读会话：清洗 + 切分后立即返回 {sessionId, total}，
     * 各段在后台按序合成，经 bus 广播 voiceSegment；播放进度由 ack 驱动滑窗预取。
     */
    startSession(text: string, opts?: {
        voice?: string;
        stylePrompt?: string;
        source?: SpeechSource;
    }): Promise<SessionStartResult>;
    /** 播放进度回执（渲染层播到第 index 段时调用，驱动滑窗预取） */
    ack(sessionId: string, index: number): void;
    /** 取消朗读会话（不带 id = 取消当前会话） */
    cancelSession(sessionId?: string): void;
    /** 克隆音色试听（走会话：可取消、纳入全局控制条） */
    testClone(id: string, sampleText?: string): Promise<SessionStartResult>;
}
