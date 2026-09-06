import type { ChatMessage, ProviderConfig, ThinkingMode, TokenUsage, ToolCall, ToolSchema } from '../shared/types';
export interface ChatOptions {
    temperature: number;
    maxTokens: number;
    tools?: ToolSchema[];
    signal?: AbortSignal;
    /** 默认 true；为 false 时一次性返回完整回复 */
    stream?: boolean;
    /** 深度思考开关，默认 auto（不下发参数） */
    thinking?: ThinkingMode;
}
export interface ChatResult {
    content: string;
    reasoning: string;
    toolCalls: ToolCall[];
    finishReason: string;
    /** 接口返回的 token 用量；未返回时为 undefined，由调用方估算 */
    usage?: TokenUsage;
}
export interface StreamCallbacks {
    onContent?: (delta: string) => void;
    onReasoning?: (delta: string) => void;
}
export declare function chatStream(provider: ProviderConfig, messages: ChatMessage[], opts: ChatOptions, cb?: StreamCallbacks): Promise<ChatResult>;
/** 拉取可用模型列表 */
export declare function fetchModels(provider: ProviderConfig): Promise<string[]>;
