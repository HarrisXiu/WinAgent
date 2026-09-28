"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelOutputError = exports.REASONING_HEADROOM = void 0;
exports.modelThinksAnyway = modelThinksAnyway;
exports.resetTaskChatMemory = resetTaskChatMemory;
exports.describeResult = describeResult;
exports.taskChat = taskChat;
const OpenAIClient_1 = require("./OpenAIClient");
const OutputLimit_1 = require("./OutputLimit");
/** 模型无法关闭思考时，在任务预算之上额外预留给思考过程的 token 数 */
exports.REASONING_HEADROOM = 16000;
/** 本进程内已观测到「关闭思考无效」的模型（key 同输出上限缓存：type|baseUrl|model） */
const thinksAnyway = new Set();
function modelThinksAnyway(provider) {
    return thinksAnyway.has((0, OutputLimit_1.outputLimitKey)(provider));
}
/** 测试用：清空已学习的模型行为 */
function resetTaskChatMemory() {
    thinksAnyway.clear();
}
/** 模型输出不可用（截断 / 空正文）。message 面向用户，diagnostic 为可记录的元数据 */
class ModelOutputError extends Error {
    diagnostic;
    kind;
    constructor(message, diagnostic, kind) {
        super(message);
        this.diagnostic = diagnostic;
        this.kind = kind;
        this.name = 'ModelOutputError';
    }
}
exports.ModelOutputError = ModelOutputError;
/** 诊断元数据：只含长度与计数，不含正文、提示词或密钥 */
function describeResult(result, maxTokens) {
    const tokens = result.usage ? `，输出 ${result.usage.completion} tokens` : '';
    return `finish_reason=${result.finishReason || '未知'}，max_tokens=${maxTokens}${tokens}，正文 ${result.content.length} 字，思考 ${(result.reasoning || '').length} 字`;
}
function budgetFor(provider, requested, withHeadroom) {
    const wanted = withHeadroom ? requested + exports.REASONING_HEADROOM : requested;
    const limit = (0, OutputLimit_1.knownOutputLimit)(provider)?.value;
    return limit ? Math.min(wanted, limit) : wanted;
}
async function taskChat(provider, messages, opts) {
    const key = (0, OutputLimit_1.outputLimitKey)(provider);
    let headroom = thinksAnyway.has(key);
    for (;;) {
        const maxTokens = budgetFor(provider, opts.maxTokens, headroom);
        const result = await (0, OpenAIClient_1.chatStream)(provider, messages, {
            temperature: opts.temperature, maxTokens, stream: opts.stream ?? false, thinking: 'off', signal: opts.signal
        });
        const reasoning = result.reasoning || '';
        // 要求关闭思考仍返回思考内容：网关忽略了参数，或 chatStream 因参数被拒回退成了 auto
        if (reasoning.trim() && !thinksAnyway.has(key))
            thinksAnyway.add(key);
        const diagnostic = describeResult(result, maxTokens);
        if (result.finishReason === 'length') {
            const byReasoning = reasoning.length > result.content.length;
            if (byReasoning) {
                // 第一次撞上：带思考余量重试一次（仅当余量确实能扩大预算）
                if (!headroom && budgetFor(provider, opts.maxTokens, true) > maxTokens) {
                    headroom = true;
                    continue;
                }
                throw new ModelOutputError(`${opts.purpose}失败：模型的深度思考耗尽了输出额度（${diagnostic}）。该模型或网关不支持关闭思考，请换用非思考模型后重试`, diagnostic, 'reasoning');
            }
            if (opts.allowTruncated)
                return result;
            throw new ModelOutputError(`${opts.purpose}输出被截断（${diagnostic}），请缩小输入范围或换用输出上限更高的模型后重试`, diagnostic, 'length');
        }
        if (!result.content.trim() && !(result.toolCalls?.length)) {
            throw new ModelOutputError(`${opts.purpose}失败：模型返回了空内容（${diagnostic}）`, diagnostic, 'empty');
        }
        return result;
    }
}
