"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceService = void 0;
const MimoTtsClient_1 = require("./MimoTtsClient");
const segment_1 = require("./segment");
const SpeechSession_1 = require("./SpeechSession");
const CLONE_PREFIX = 'clone:';
class VoiceService {
    store;
    voices;
    sessions;
    constructor(store, voices, bus) {
        this.store = store;
        this.voices = voices;
        this.sessions = new SpeechSession_1.SpeechSessionManager(bus);
    }
    get voiceStore() {
        return this.voices;
    }
    requireReady() {
        const cfg = this.store.get().voice;
        if (!cfg.enabled)
            throw new Error('语音功能未启用，请在设置 → 语音中开启');
        if (!cfg.apiKey)
            throw new Error('未配置 MiMo API Key，请在设置 → 语音中填写');
        return {
            apiKey: cfg.apiKey,
            baseUrl: cfg.baseUrl,
            outputFormat: cfg.outputFormat === 'mp3' ? 'mp3' : 'wav',
            stylePrompt: cfg.stylePrompt || '',
            defaultVoice: cfg.voice || 'mimo_default'
        };
    }
    /** 解析音色：'clone:<id>' → 样本 dataURL；其余原样返回 */
    async resolveVoice(voice) {
        const v = voice || this.requireReady().defaultVoice;
        if (!v.startsWith(CLONE_PREFIX))
            return v;
        return this.voices.getSampleDataUrl(v.slice(CLONE_PREFIX.length));
    }
    /**
     * 单发合成并返回音频（完整管线；会话路径请用 startSession）。
     * @param opts.voice 覆盖音色：内置音色名或 'clone:<voiceId>'；缺省用配置的默认音色
     * @param opts.stylePrompt 覆盖风格指令；缺省用配置值
     */
    async speak(text, opts) {
        const ready = this.requireReady();
        const voice = await this.resolveVoice(opts?.voice);
        const plain = (0, MimoTtsClient_1.plainTextForSpeech)(text);
        if (!plain)
            throw new Error('没有可朗读的文本（纯代码块/空白内容不朗读）');
        return (0, MimoTtsClient_1.speak)({
            apiKey: ready.apiKey,
            baseUrl: ready.baseUrl,
            text: plain,
            stylePrompt: opts?.stylePrompt ?? ready.stylePrompt,
            voice,
            outputFormat: ready.outputFormat,
            signal: opts?.signal
        });
    }
    /**
     * 开启分段朗读会话：清洗 + 切分后立即返回 {sessionId, total}，
     * 各段在后台按序合成，经 bus 广播 voiceSegment；播放进度由 ack 驱动滑窗预取。
     */
    async startSession(text, opts) {
        const ready = this.requireReady();
        const voice = await this.resolveVoice(opts?.voice);
        const plain = (0, MimoTtsClient_1.plainTextForSpeech)(text);
        if (!plain)
            throw new Error('没有可朗读的文本（纯代码块/空白内容不朗读）');
        return this.sessions.start((0, segment_1.splitForSpeech)(plain), {
            voice,
            stylePrompt: opts?.stylePrompt ?? ready.stylePrompt,
            source: opts?.source ?? 'manual',
            apiKey: ready.apiKey,
            baseUrl: ready.baseUrl,
            outputFormat: ready.outputFormat
        });
    }
    /** 播放进度回执（渲染层播到第 index 段时调用，驱动滑窗预取） */
    ack(sessionId, index) {
        this.sessions.ack(sessionId, index);
    }
    /** 取消朗读会话（不带 id = 取消当前会话） */
    cancelSession(sessionId) {
        this.sessions.cancel(sessionId);
    }
    /** 克隆音色试听（走会话：可取消、纳入全局控制条） */
    async testClone(id, sampleText) {
        return this.startSession(sampleText || '你好，这是我的克隆音色试听~', {
            voice: `${CLONE_PREFIX}${id}`,
            source: 'test'
        });
    }
}
exports.VoiceService = VoiceService;
