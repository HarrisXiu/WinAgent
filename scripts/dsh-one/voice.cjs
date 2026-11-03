'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { ConfigStore, getDataDir } = require('./config/ConfigStore');
const { VoiceStore } = require('./voice/VoiceStore');
const { VoiceService } = require('./voice/VoiceService');
const { EventBus } = require('./event-bus');

exports.create = async function () {
  const store = new ConfigStore();
  await store.load();
  const voices = new VoiceStore(getDataDir());
  const voice = new VoiceService(store, voices, new EventBus());
  const tools = [{
    schema: {
      name: 'speak_text', description: 'MiMo TTS：合成文本并保存为 WAV/MP3，返回音频路径，可用 DSH present_files 展示播放。支持内置和 clone:<id> 克隆音色。需配置 WinAgent voice.enabled/apiKey。',
      parameters: { type: 'object', properties: {
        text: { type: 'string', description: '要朗读的文本' },
        stylePrompt: { type: 'string', description: '朗读风格' },
        voice: { type: 'string', description: '内置音色名或 clone:<id>' },
        output_path: { type: 'string', description: '输出音频绝对路径；省略时使用数据目录 audio/ 下随机文件名' },
      }, required: ['text'] },
    }, dangerous: true,
    async run(a, exec) {
      const audio = await voice.speak(a.text, { voice: a.voice, stylePrompt: a.stylePrompt, signal: exec?.signal });
      const ext = audio.mime === 'audio/mpeg' ? '.mp3' : '.wav';
      const output = a.output_path ? path.resolve(a.output_path) : path.join(getDataDir(), 'audio', crypto.randomUUID() + ext);
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, Buffer.from(audio.audioBase64, 'base64'), { flag: 'wx' });
      return JSON.stringify({ path: output, mime: audio.mime });
    },
  }, {
    schema: { name: 'list_voice_clones', description: '列出本地克隆音色。', parameters: { type: 'object', properties: {} } },
    run: async () => JSON.stringify(await voices.list()),
  }, {
    schema: { name: 'add_voice_clone', description: '将本地 WAV/MP3 样本复制到克隆音色库，返回音色 ID。', parameters: { type: 'object', properties: {
      name: { type: 'string', description: '音色名称' }, path: { type: 'string', description: '样本绝对路径' },
    }, required: ['name', 'path'] } }, dangerous: true,
    run: async a => JSON.stringify(await voices.add(a.name, a.path)),
  }];
  return { tools, dispose() {} };
};
