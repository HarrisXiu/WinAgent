import type { TtsResult } from '../shared/types';
export interface BuiltinVoice {
    value: string;
    label: string;
}
/** MiMo TTS 内置音色（官方文档 9 个；mimo_default 在中国区即「冰糖」） */
export declare const BUILTIN_VOICES: BuiltinVoice[];
/** 取消哨兵：合成被中止时统一抛出（跨 IPC 后错误信息会被加前缀，用 isCancelled 判定） */
export declare const TTS_CANCELLED = "TTS_CANCELLED";
/** 是否为取消（本地 AbortError 或跨 IPC 传回的 TTS_CANCELLED 哨兵） */
export declare function isCancelled(e: unknown): boolean;
/** 待合成文本的预处理：剥成适合朗读的纯文本（清洗，不切分、不截断） */
export declare function plainTextForSpeech(md: string): string;
export interface SpeakRequest {
    apiKey: string;
    /** 如 https://api.xiaomimimo.com/v1 */
    baseUrl: string;
    /** 已预处理的待合成文本 */
    text: string;
    /** 风格指令（user 角色），空传 '' */
    stylePrompt: string;
    /** 内置音色名，或克隆样本 dataURL（data:audio/...;base64,...） */
    voice: string;
    /** 输出格式 */
    outputFormat: 'wav' | 'mp3';
    signal?: AbortSignal;
}
/** 组装 TTS 请求体（导出便于复用/测试） */
export declare function buildTtsBody(req: SpeakRequest): Record<string, unknown>;
/** 合成单段语音：返回 base64 音频 + MIME */
export declare function speak(req: SpeakRequest): Promise<TtsResult>;
/**
 * 二期预留：pcm16 真流式合成（本轮不实现，签名先行）。
 *
 * 落地路径：请求体改 `stream: true` + `audio.format: 'pcm16'`，按 OpenAIClient.chatStream
 * （../llm/OpenAIClient.ts）既有的 getReader() + TextDecoder + `data:` 行解析范式消费 SSE，
 * 每个 audio 增量帧回调 onChunk；渲染层 player.ts 增 PCM sink（AudioContext + AudioWorklet
 * 环形缓冲）替换 `<audio>` 路径。本轮的会话/ack/队列/控制条骨架可直接复用——届时只需把
 * 「一段 = 一个 wav blob」换成「一段 = 一串 PCM 帧」。
 */
export declare function speakStream(_req: SpeakRequest, _onChunk: (pcmBase64: string) => void): Promise<void>;
