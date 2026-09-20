/**
 * 语音服务门面：主进程 IPC 只与本类交互。
 * 负责配置读取（未配置时报友好错误）、文本预处理与切分、克隆音色（clone:<id>）解析、
 * 会话编排（SpeechSessionManager）；单段合成委托 MimoTtsClient.speak。
 */
import type { ConfigStore } from '../config/ConfigStore'
import type { EventBus } from '../event-bus'
import type { SessionStartResult, TtsResult } from '../shared/types'
import { plainTextForSpeech, speak } from './MimoTtsClient'
import { splitForSpeech } from './segment'
import { SpeechSessionManager, type SpeechSource } from './SpeechSession'
import { VoiceStore } from './VoiceStore'

const CLONE_PREFIX = 'clone:'

export class VoiceService {
  private store: ConfigStore
  private voices: VoiceStore
  private sessions: SpeechSessionManager

  constructor(store: ConfigStore, voices: VoiceStore, bus: EventBus) {
    this.store = store
    this.voices = voices
    this.sessions = new SpeechSessionManager(bus)
  }

  get voiceStore(): VoiceStore {
    return this.voices
  }

  private requireReady(): { apiKey: string; baseUrl: string; outputFormat: 'wav' | 'mp3'; stylePrompt: string; defaultVoice: string } {
    const cfg = this.store.get().voice
    if (!cfg.enabled) throw new Error('语音功能未启用，请在设置 → 语音中开启')
    if (!cfg.apiKey) throw new Error('未配置 MiMo API Key，请在设置 → 语音中填写')
    return {
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      outputFormat: cfg.outputFormat === 'mp3' ? 'mp3' : 'wav',
      stylePrompt: cfg.stylePrompt || '',
      defaultVoice: cfg.voice || 'mimo_default'
    }
  }

  /** 解析音色：'clone:<id>' → 样本 dataURL；其余原样返回 */
  private async resolveVoice(voice?: string): Promise<string> {
    const v = voice || this.requireReady().defaultVoice
    if (!v.startsWith(CLONE_PREFIX)) return v
    return this.voices.getSampleDataUrl(v.slice(CLONE_PREFIX.length))
  }

  /**
   * 单发合成并返回音频（完整管线；会话路径请用 startSession）。
   * @param opts.voice 覆盖音色：内置音色名或 'clone:<voiceId>'；缺省用配置的默认音色
   * @param opts.stylePrompt 覆盖风格指令；缺省用配置值
   */
  async speak(text: string, opts?: { voice?: string; stylePrompt?: string; signal?: AbortSignal }): Promise<TtsResult> {
    const ready = this.requireReady()
    const voice = await this.resolveVoice(opts?.voice)
    const plain = plainTextForSpeech(text)
    if (!plain) throw new Error('没有可朗读的文本（纯代码块/空白内容不朗读）')
    return speak({
      apiKey: ready.apiKey,
      baseUrl: ready.baseUrl,
      text: plain,
      stylePrompt: opts?.stylePrompt ?? ready.stylePrompt,
      voice,
      outputFormat: ready.outputFormat,
      signal: opts?.signal
    })
  }

  /**
   * 开启分段朗读会话：清洗 + 切分后立即返回 {sessionId, total}，
   * 各段在后台按序合成，经 bus 广播 voiceSegment；播放进度由 ack 驱动滑窗预取。
   */
  async startSession(
    text: string,
    opts?: { voice?: string; stylePrompt?: string; source?: SpeechSource }
  ): Promise<SessionStartResult> {
    const ready = this.requireReady()
    const voice = await this.resolveVoice(opts?.voice)
    const plain = plainTextForSpeech(text)
    if (!plain) throw new Error('没有可朗读的文本（纯代码块/空白内容不朗读）')
    return this.sessions.start(splitForSpeech(plain), {
      voice,
      stylePrompt: opts?.stylePrompt ?? ready.stylePrompt,
      source: opts?.source ?? 'manual',
      apiKey: ready.apiKey,
      baseUrl: ready.baseUrl,
      outputFormat: ready.outputFormat
    })
  }

  /** 播放进度回执（渲染层播到第 index 段时调用，驱动滑窗预取） */
  ack(sessionId: string, index: number): void {
    this.sessions.ack(sessionId, index)
  }

  /** 取消朗读会话（不带 id = 取消当前会话） */
  cancelSession(sessionId?: string): void {
    this.sessions.cancel(sessionId)
  }

  /** 克隆音色试听（走会话：可取消、纳入全局控制条） */
  async testClone(id: string, sampleText?: string): Promise<SessionStartResult> {
    return this.startSession(sampleText || '你好，这是我的克隆音色试听~', {
      voice: `${CLONE_PREFIX}${id}`,
      source: 'test'
    })
  }
}
