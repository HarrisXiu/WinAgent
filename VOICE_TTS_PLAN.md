# WinAgent 语音功能 + 语音克隆（基于 MiMo TTS）

为 WinAgent 增加语音输出能力：Agent 回复可朗读（内置音色/克隆音色），用户可上传参考音频克隆任意声音；全部走小米 MiMo TTS 的 OpenAI 兼容接口。

## 背景与 API 事实

- **端点**：`POST https://api.xiaomimimo.com/v1/chat/completions`，鉴权头 `api-key: <key>`（与现有 `OpenAIClient` 同构，可复用 HTTP 模式）
- **三个模型**：
  - `mimo-v2.5-tts` — 内置音色（`mimo_default`/`冰糖`/`茉莉`/`苏打`/`白桦`/`Mia`/`Chloe`/`Milo`/`Dean`），支持 `stream:true` + `pcm16` 流式
  - `mimo-v2.5-tts-voiceclone` — 零样本克隆：`audio.voice` 传 `data:audio/wav;base64,...`（mp3/wav 参考音频）
  - `mimo-v2.5-tts-voicedesign` — 文本描述生成音色（`user` 消息必填描述）
- **请求结构**：`messages` 中 `assistant` 角色放待合成文本，`user` 角色可选放风格指令；`audio: {format, voice}`；响应 `choices[0].message.audio.data` 为 base64
- **无服务端音色注册**：克隆是无状态的——每次请求都带参考音频 base64，本地只需存样本文件
- TTS 系列目前**限时免费**；需要用户在设置里填 MiMo API Key

## 架构落点

```
dsh-plugin/src/voice/MimoTtsClient.ts   ← 新增：TTS HTTP 客户端（复用 OpenAIClient 风格）
dsh-plugin/src/voice/VoiceStore.ts      ← 新增：克隆音色库管理（dataDir/voices/*.wav + voices.json）
dsh-plugin/src/config/ConfigStore.ts    ← AppConfig 增加 voice 配置块
src/main/index.ts                       ← 新增 IPC：tts:speak / tts:stop / voice:*
src/preload/index.ts                    ← window.winagent.tts / .voices API
src/renderer/src/components/Message.tsx ← 每条 assistant 消息加 🔊 按钮
src/renderer/src/components/Settings.tsx← 语音设置区 + 克隆音色管理 UI
```

## 实施步骤

### 1. 配置层（`shared/types.ts` + `ConfigStore.ts`）
- `AppConfig.voice`：`{ enabled, apiKey, baseUrl(默认 api.xiaomimimo.com/v1), model('mimo-v2.5-tts'), voice('mimo_default'), autoPlay(false), stylePrompt('') }`
- `voiceClones`: `[{ id, name, file, createdAt }]`（样本存 `dataDir/voices/`，元数据存 `voices.json`）
- apiKey 沿用现有 `enc:v1:` 加密存储约定

### 2. TTS 客户端（`dsh-plugin/src/voice/MimoTtsClient.ts`）
- `speak(text, opts): Promise<{audioBase64, format}>` — 组装 messages（assistant=文本，user=stylePrompt 可选）+ audio 参数，POST，解析 `message.audio.data`
- `speakStream(text, opts, onChunk)` — `stream:true` + `pcm16`，逐 chunk 回调（第二阶段，先留接口）
- 文本预处理：剥离 Markdown 标记/代码块/思维链，截断过长文本（如 2000 字）

### 3. 音色库（`dsh-plugin/src/voice/VoiceStore.ts`）
- `list() / add(name, srcAudioPath) / remove(id) / getSampleBase64(id)`
- 校验：仅 mp3/wav，≤10MB；复制到 `dataDir/voices/<id>.<ext>`
- 克隆调用 = `model:'mimo-v2.5-tts-voiceclone'` + `voice:'data:audio/<fmt>;base64,<样本>'`

### 4. 主进程 IPC（`src/main/index.ts`）
- `tts:speak(text, {voiceId?})` → 返回 `{audioBase64, mime}`；`tts:stop` → 中止进行中的合成
- `voice:list / voice:add(文件对话框选音频) / voice:remove / voice:test(id, sampleText)`
- 复用 `dialog.showOpenDialog` 选参考音频；`sendToWindows` 广播音色库变更

### 5. Preload + 渲染层
- `window.winagent.tts.speak/stop`、`window.winagent.voices.*`
- `Message.tsx`：assistant 气泡加播放/停止按钮，`<audio>` 播放 `data:audio/wav;base64,...`
- `Settings.tsx` 新增「语音」区：开关、API Key、内置音色下拉（9 个）、自动朗读开关、风格指令输入框；「克隆音色」子区：列表 + 上传 + 试听 + 删除
- `App.tsx`：autoPlay 时在 agent 回复完成事件后自动调 `tts.speak`

### 6. Agent 工具集成（可选增强）
- 新增内置工具 `speak_text(text, voiceId?)`：让 Agent 能主动朗读（配合 pet 人设——安洁莉娜用克隆音色说话）
- 注册进 `ToolRegistry`，schema 描述"将文本转为语音播放"

## 边界与假设

- **不含语音输入（ASR）**：MiMo TTS 只做合成；语音输入需另接 ASR 服务，后续单独立项
- **第一阶段用非流式 wav**（实现简单、可立即播放）；流式 pcm16 低延迟播放留作第二阶段（需 AudioContext 喂 PCM）
- 桌面版优先；dsh-plugin 服务层天然可被 DSH web 版复用（server.ts 加路由即可，不在本期）
- 长回复自动截断/分段合成，避免单次请求过大

## 测试

- 单测：MimoTtsClient 请求体组装（mock fetch）；VoiceStore 增删查与 base64 读取
- 手动：`npm run dev` → 设置填 key → 内置音色朗读一条回复 → 上传 wav 克隆 → 切克隆音色朗读 → autoPlay 验证
- 回归：`npm run build` 通过；无 key 时语音按钮优雅降级（提示去设置）
