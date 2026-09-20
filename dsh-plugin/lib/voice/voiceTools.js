"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVoiceTools = createVoiceTools;
function createVoiceTools(voice) {
    const tools = [
        {
            schema: {
                name: 'speak_text',
                description: '将文本转为语音并播放给用户（朗读）。适用于用户要求「读出来/说给我听」，或你希望主动开口说话的场合。长文本会自动分段朗读；代码、表格、链接等结构化内容不适合朗读。',
                parameters: {
                    type: 'object',
                    properties: {
                        text: { type: 'string', description: '要朗读的文本（口语化短句效果最佳）' },
                        stylePrompt: { type: 'string', description: '可选：朗读风格指令，如「用开心的语气说」' }
                    },
                    required: ['text']
                }
            },
            async run(args) {
                const text = String(args.text ?? '').trim();
                if (!text)
                    return '未提供要朗读的文本';
                try {
                    const stylePrompt = String(args.stylePrompt ?? '').trim();
                    await voice.startSession(text, { source: 'agent', ...(stylePrompt ? { stylePrompt } : {}) });
                    return '已开始朗读';
                }
                catch (e) {
                    return `语音合成失败: ${e instanceof Error ? e.message : String(e)}`;
                }
            }
        }
    ];
    return tools;
}
