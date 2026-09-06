import type { AppConfig, ChatMessage, ProviderConfig } from '../shared/types';
/** 估算每张图片的 token 开销 */
export declare const IMAGE_TOKEN_COST = 800;
export declare function estimateTokens(messages: ChatMessage[]): number;
export declare class ContextManager {
    private cfg;
    constructor(cfg: AppConfig);
    needsCompact(history: ChatMessage[]): boolean;
    /**
     * 两阶段压缩：
     * 阶段一（免 LLM）：截断旧的大体积工具结果、剥离旧消息中的图片，通常可释放大部分 token；
     * 阶段二（LLM 摘要）：若仍超阈值，把旧消息总结为一条 system 摘要，只保留最近轮次。
     * LLM 摘要失败时降级返回阶段一结果，不中断当前请求。
     */
    compact(provider: ProviderConfig, history: ChatMessage[]): Promise<ChatMessage[]>;
}
