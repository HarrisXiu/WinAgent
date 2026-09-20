/**
 * 语音内置工具：让 Agent 能主动把文本转成语音播放给用户。
 * 桌面版（pet 人设）下 Agent 可用克隆/内置音色「开口说话」。
 * 走分段朗读会话（startSession）：逐段合成经 bus 广播（宿主转发到渲染进程播放），
 * 用户可随时在控制条/气泡上取消。
 */
import type { Tool } from '../tools/types';
import type { VoiceService } from './VoiceService';
export declare function createVoiceTools(voice: VoiceService): Tool[];
