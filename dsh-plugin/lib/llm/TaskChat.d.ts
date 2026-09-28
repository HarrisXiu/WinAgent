/**
 * 后台任务（非对话）模型调用的统一出口：Wiki 分析、规范编译/检查、LINT/REFLECT/问答、上下文压缩。
 *
 * ⚠️ 防回归（2026-09-28，v0.5.1）：「思考模型耗尽输出预算」一类问题的集中处理点。
 * 事故经过：deepseek-flash 默认开启深度思考，思考 token 计入 max_tokens，
 * Wiki 详细分析 6500 tokens 的预算在写出正文前就被思考耗尽 → finish_reason=length、正文为空，
 * 旧代码据此二分重试最多 127 次烧光额度，最后报出误导性的「模型输出过短」。
 * 同样的隐患当时还存在于另外 8 处调用（预算低至 1024），其中上下文压缩会把空摘要当作历史、静默丢失对话。
 *
 * 规则（新增后台调用请一律走 taskChat，不要直接 chatStream）：
 * 1. 一律下发 thinking:'off'——后台任务只要结果，不要思考过程。
 * 2. 网关忽略/拒绝关闭思考时（响应里仍有思考内容），记住该模型「总会思考」，
 *    之后的调用自动在预算上叠加思考余量。
 * 3. 思考耗尽预算导致截断时，带余量重试一次；仍失败则报出明确原因。
 * 4. 截断或空正文绝不当作成功返回——抛 ModelOutputError，消息附诊断（不含正文/密钥）。
 *
 * 再次出现时的排查：`npm run diagnose:model`（见 README「故障排查」）。
 */
import type { ChatMessage, ProviderConfig } from '../shared/types';
import { type ChatResult } from './OpenAIClient';
/** 模型无法关闭思考时，在任务预算之上额外预留给思考过程的 token 数 */
export declare const REASONING_HEADROOM = 16000;
export declare function modelThinksAnyway(provider: ProviderConfig): boolean;
/** 测试用：清空已学习的模型行为 */
export declare function resetTaskChatMemory(): void;
/** 模型输出不可用（截断 / 空正文）。message 面向用户，diagnostic 为可记录的元数据 */
export declare class ModelOutputError extends Error {
    readonly diagnostic: string;
    readonly kind: 'reasoning' | 'length' | 'empty';
    constructor(message: string, diagnostic: string, kind: 'reasoning' | 'length' | 'empty');
}
export interface TaskChatOptions {
    /** 任务名称，出现在报错中，如「Wiki 详细分析 part-2」 */
    purpose: string;
    temperature: number;
    /** 任务正文所需的输出预算（不含思考余量） */
    maxTokens: number;
    signal?: AbortSignal;
    stream?: boolean;
    /** 为 true 时正文过长导致的截断照常返回（调用方自行拆分重试）；思考导致的截断仍会抛出 */
    allowTruncated?: boolean;
}
/** 诊断元数据：只含长度与计数，不含正文、提示词或密钥 */
export declare function describeResult(result: Pick<ChatResult, 'finishReason' | 'content'> & {
    reasoning?: string;
    usage?: {
        completion: number;
    };
}, maxTokens: number): string;
export declare function taskChat(provider: ProviderConfig, messages: ChatMessage[], opts: TaskChatOptions): Promise<ChatResult>;
