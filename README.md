# WinAgent

当前版本：**v0.5.0**。

 **Windows 桌面 AI 助手**（基于 **Electron**，业务逻辑复用 dsh-winagent 插件服务层）。兼容 **OpenAI 格式 API** 与 **本地 Ollama**，内置**完整 Windows 工具集**（53+ 个工具）与 **LLM Wiki 个人知识库**——你只负责剪藏，AI 负责理解和沉淀。支持 **MiMo TTS 语音朗读与声音克隆**（Agent 可以真的开口说话）、**可换装主题包**（默认简洁主题，可选《明日方舟》安洁莉娜桌宠形象或上传自制立绘）、**skills（含 SKILL.md 格式）** 与 **MCP** 扩展挂载，可打包为**免安装便携版**。

欢迎各位大佬的评论和指导，所有评论和邮件我都会认真阅读和回复，期待与大家交流！如有兴趣也欢迎加入此项目。
邮箱(email):530313@qq.com;


## 功能特性

- **多 Provider**：OpenAI / DeepSeek / 任意 OpenAI 兼容端 / 本地 Ollama，一键切换
- **模型自动拉取**：Ollama `/api/tags`、OpenAI 兼容 `/v1/models`
- **输出上限自动检测**：按 API 地址与模型读取输出上限并回填设置；没有元数据时使用最小校验请求。明确的范围错误自动更新并重试一次；无法确认时使用服务端默认值，不用上下文长度替代输出长度。
- **统一工作台**：借鉴 ZCode 的侧栏与面板交互，左侧提供“助理”“专题任务”“Skills 与 MCP”“Wiki 知识库”；助理是固定聊天，专题任务各有独立聊天和 Wiki 标签。会话、草稿与侧栏宽度可恢复。
- **文件/图片/PDF 附件**：图片自动以 vision 格式发送，文本文件内容内嵌；PDF（≤15MB）在 provider 支持时直接以文件输入发送（拒收自动降级）；不支持 vision 的模型自动降级为视觉辅助或路径描述
- **Vision 模型识别**：自动按模型名关键词检测（`gpt-4o`、`vision`、`vl`、`llava`、`gemini`、`claude-3`、`qwen-vl`、`glm-4v` 等），也可在设置中手动指定「支持/不支持/自动检测」
- **视觉辅助（双模型协作）**：主模型为纯语言模型时，自动调用另一个视觉模型识别图片，再把识别结果回填给主模型继续完成任务。**支持同一 API 下用两个模型**（如主模型 `mimo-v2.5-pro` + 视觉模型 `mimo-v2.5`）
- **流式输出开关**：可关闭流式，改为生成完毕后一次性返回
- **深度思考开关**：自动 / 开启 / 关闭三态，接口不认识参数时自动去参重试
- **Token 消耗统计**：顶栏实时显示会话累计 token，悬停查看输入/输出细分与最近一次用量
- **流式对话**：Markdown 渲染、代码高亮、思维链折叠、工具调用可视化
- **语音朗读（MiMo TTS）**：每条回复可 🔊 朗读；Markdown 清洗（剥离代码块/思维链/emoji/裸链接）→ 按句分段 → 后台逐段合成 + 滑窗预取；全局控制条显示进度，支持暂停/继续/跳过/停止（Esc 停止）
- **声音克隆**：上传 wav/mp3 参考音频即可克隆音色（`mimo-v2.5-tts-voiceclone` 零样本克隆，无服务端注册，样本只存本地）；克隆音色库支持试听/重命名/删除；另有 9 个内置音色（冰糖/茉莉/苏打/白桦/Mia/Chloe/Milo/Dean/mimo_default）
- **Agent 主动说话**：内置 `speak_text` 工具，Agent 可自行决定朗读——配合桌宠人设，安洁莉娜真的能"开口"
- **主题包（外观皮肤）**：默认 plain 简洁主题（无吉祥物）；内置安洁莉娜全套立绘（代码分割懒加载，普通主题不为 5.5MB GIF 买单）；可上传自制主题包——五态立绘（待机/思考/工具/识别/说话）+ 头像逐槽位上传，缺省槽位自动回退 idle；素材经 `winagent-skin://` 自定义协议送达渲染层（白名单 + 路径穿越校验）
- **完整 Windows 工具集（53+ 个）**：
  - 文件：`list_directory`、`read_file`、`write_file`、`edit_file`、`multi_edit_file`、`delete_file`、`copy_file`、`move_file`、`search_files`、`find_files`、`get_file_info`、`create_directory`、`grep`
  - 系统：`list_processes`、`kill_process`、`run_command`、`get_system_info`、`take_screenshot`、`list_startup_items`、`add_startup_item`、`remove_startup_item`
  - 注册表：`registry_list`、`registry_read`、`registry_write`、`registry_delete_value`、`registry_delete_key`
  - 输入模拟：`mouse_move`、`mouse_click`、`mouse_scroll`、`key_press`、`key_combination`、`type_text`、`get_cursor_pos`、`get_screen_size`
  - 窗口：`find_windows`、`set_window_state`、`bring_window_to_front`、`close_window`
  - 网络：`http_request`、`http_download`
  - 文档生成与转换：`markdown_to_docx`、`write_xlsx`、`write_pptx`、`office_convert`
  - 知识库：`search_knowledge_base`、`retrieve_knowledge`、`read_note`、`list_notes`、`read_raw_file`、`add_question`、`save_knowledge_output`、`lint_knowledge_base`、`merge_knowledge_pages`、`reflect_knowledge_base`
- **文档生成（模型优先）**：模型产出 Markdown / 结构化 JSON，工具做确定性序列化——`markdown_to_docx`（pandoc 检测到则优先，否则内置纯 JS 链）、`write_xlsx`（SheetJS）、`write_pptx`（pptxgenjs）；数学公式以 **Word 原生可编辑公式（OMML）** 插入（非图片，双击可用公式编辑器修改）
- **文档读取与视觉理解（混合回退链）**：PDF 附件直传 → `render_pdf_page` 整页渲染 PNG 视觉阅读（扫描件/复杂排版，pdfjs-dist + @napi-rs/canvas）→ `read_pdf` / `read_docx(with_images)` 等 skills 哑提取 + 模型结构化（纯 JS 零系统依赖）；`[[IMG:]]` 标记协议——skill 输出图片标记，Agent 自动转为视觉输入（非 vision 模型走视觉辅助）
- **格式互转**：`office_convert` 四级降级链（纯 JS SheetJS → pandoc → LibreOffice headless → Office COM），Office 文档 → PDF 等常用转换本机装有 Office 即可用；不可达时报错附安装指引
- **Skills 挂载**：左侧“Skills 与 MCP”追加技能目录；支持单个 `SKILL.md` 目录和包含多个技能的父目录，保留默认 `skills/` 与已加入目录。
- **MCP 挂载**：同页编辑 `mcpServers` 配置并连接外部 MCP server（stdio / HTTP）；下方按内置、Skills、MCP 查看和搜索真实已加载工具。
- **上下文压缩**：长对话自动/手动压缩，避免超出上下文窗口
- **危险操作确认**：删除/写注册表/结束进程/执行命令/模拟输入等默认弹窗确认
- **Ollama 兼容优化**：消息格式自动清洗（content null 处理、tool_calls 结构标准化、tool 结果补 name 字段），避免 `invalid tool call arguments` 兼容性错误
- **API Key 存储**：`config.json` 中的 `apiKey` 以明文存于用户私有目录（`%APPDATA%/com.winagent.app/`），请勿分享该目录；旧版 DPAPI 密文（`enc:v1:` 前缀）加载时自动清空，重填一次即可
- **上下文压缩（两阶段）**：阶段一免 LLM 轻量压缩（截断旧工具结果、剥离旧图片 base64），阶段二 LLM 摘要旧消息；摘要失败自动降级，不中断对话
- **便携**：数据（`config.json`、`wiki/`）保存在 `%APPDATA%/com.winagent.app/`，遵循 Windows 应用数据规范
- **Angelina 主题（可选皮肤）**：在「设置 → 外观」中选择头像、配色与角色人设。v0.5.0 工作台使用常驻功能侧栏，主界面不再用大立绘占据导航区；已有主题素材仍可管理。
- **单一桌宠模式（Agent 能力合并）**：AI 以安洁莉娜的角色人设陪伴聊天（人设提示词可编辑），同时拥有专业 Agent 的**完整工具能力**——读文件、操作 Windows、检索知识库，系统提示词运行时自动附加工具清单，不会"拒绝访问本地文件"
- **知识工作区**：资料、专题标签、持久规则与处理记录直接嵌入主窗口；可核对原文、给文件增删专题标签、删除 Wiki 文件，选段后返回当前聊天。
- **全文详细知识**：逐段保存解释、步骤、参数、条件、例外与原文证据，不再只分析前 6000 字符。模型输出截断时自动细分片段重试；完成的片段保留缓存。
- **任务规范自动执行**：用户明确将资料编译并启用为论文、报告、编码或自定义规则；适用的新任务自动加载，工具调用与上下文压缩后仍保留。回答完成后逐条进行模型评估，纯文本未满足项最多自动修正一次。
- **原文检索与阅读**：自动检索、固定资料、关闭检索三种范围；注入真实原文片段并附定位链接。PDF 支持内嵌原版阅读，扫描页无文字时提示 OCR 限制。
- **SKILL.md 格式支持**：除原生 `manifest.json` 外，支持 Anthropic 官方 `SKILL.md` 格式 skill，GitHub 上的 skill 可直接放入 `skills/` 目录使用
- **图片生成提示词**：需要图片时模型直接生成可复制的绘图 Prompt（可直接粘贴的英文 Prompt + 中文拆解，适配 Midjourney / Stable Diffusion / 即梦AI 等），不编造图片
- **DSH 插件版（dsh-winagent）**：同一套 Agent 能力以插件形式装进 DeepSeek Harness（`dsh plugin --profile web add` 一条命令安装，详见下文「DSH 插件版」），在 DSH Web 界面里直接使用，无需桌面壳

## 快速开始

**普通用户**：从 [Releases](https://github.com/HarrisXiu/WinAgent/releases) 下载 `WinAgent-<version>-win64.exe`（便携版），双击即用——**免安装、单文件**，数据保存在 `%APPDATA%/com.winagent.app/`，覆盖升级直接用新 exe 替换旧文件即可。

**开发者**（需 Node.js 18+）：

```bash
git clone https://github.com/HarrisXiu/WinAgent.git
cd WinAgent
npm install
npm run dev
```

> 桌面版主进程复用 `dsh-plugin/` 的服务层（`dsh-winagent` file: 依赖）；改了插件代码后先 `npm run plugin:build` 再 `npm run dev`。

## 打包

```bash
npm run plugin:build     # 先编译桌面版复用的插件服务层
npm run dist             # electron-vite build + electron-builder（便携版 exe → release/）
npm run pack             # 仅打包目录不生成安装包（调试用）
npm run build:icon       # 从 Angelina/PNG/送货.png 重新生成多尺寸 ICO 图标
```

v0.5.0 构建产物为 `release/WinAgent-0.5.0-win64.exe`（Windows x64 便携版）。

开发验证：`npx tsc --noEmit` 检查类型，`npm run test:speech` 在隐藏的 Electron 窗口中验证分段播放与缓存重播；回归测试使用模拟音频和语音接口，不调用真实 TTS API。

**数据目录**：应用数据保存在 `%APPDATA%/com.winagent.app/`（即 `C:\Users\<用户名>\AppData\Roaming\com.winagent.app\`），包括 `config.json`、`wiki/`（知识库）、`skills/`、`mcp.json`。首次启动时 skills 与 mcp.json 模板自动播种。

> ⚠ 注意：`config.json` 中包含 API Key（明文），请注意隐私保护、勿分享该目录。打包前请先关闭正在运行的应用（否则 exe/dll 被占用无法覆盖）。

## 使用本地 Ollama (使用本地小模型可能导致agent无法正确调用工具 不建议使用)

1. 安装 Ollama：https://ollama.com/download
2. 启动服务并拉取一个**支持工具调用（function calling）**的模型：
   ```bash
   ollama serve
   ollama pull llama3.1:8b
   ```
   > 9b 及以下模型在 40+ 工具场景容易“忘记”或“编造”工具名，建议使用 14b+ 或改用 API。
3. 在 WinAgent 顶栏选择 `Ollama (本地)` provider，点击刷新按钮拉取模型列表。

## 使用 OpenAI API

在“设置 → 模型 Providers”中填写 `Base URL`（需含 `/v1`）、`API Key`、`模型`。例如：

- OpenAI：`https://api.openai.com/v1`
- DeepSeek：`https://api.deepseek.com/v1`

## 语音朗读与声音克隆（MiMo TTS）

基于小米 MiMo TTS 的 OpenAI 兼容接口（默认 `https://api.xiaomimimo.com/v1`，用 chat/completions 结构承载 TTS 请求）。在「设置 → 语音」中填写 MiMo API Key 并开启后可用；未启用/未填 Key 时语音入口优雅降级并引导去设置。

- **朗读回复**：assistant 消息气泡上的 🔊 按钮手动朗读；或开启「自动朗读」让每条回复完成后自动播放
- **缓存重播**：同一条回复的音频全部合成后，再次点击直接播放缓存，不重复请求 TTS；即使合成完成后提前停止，也能从头重播。缓存保留当前运行期间最近使用的 20 条完整音频，重启后清空；文本、音色、风格指令或输出格式改变时重新合成。未完成或失败的合成不会作为完整音频重播。
- **分段管线**：Markdown 清洗成可朗读纯文本 → 按句切分 → 后台逐段合成（播放进度经 ack 回执驱动滑窗预取）；底部全局控制条显示「第 n/N 段」，支持暂停/继续/跳过本段/停止，Esc 快捷停止
- **内置音色**：`mimo_default` / 冰糖 / 茉莉 / 苏打 / 白桦 / Mia / Chloe / Milo / Dean 共 9 个，下拉即选
- **声音克隆**：「设置 → 语音 → 克隆音色」上传 wav/mp3 参考音频即得克隆音色——克隆是无状态的（`clone:<id>` 解析为样本 dataURL 随请求下发），样本只存本地 `dataDir/voices/`，支持试听（走朗读会话、可取消）、行内重命名、删除
- **风格指令**：`stylePrompt` 以 user 消息下发（如「用开心的语气说」），留空用内置默认
- **Agent 开口**：`speak_text` 内置工具让 Agent 主动朗读——用户说「读出来/说给我听」，或桌宠人设下安洁莉娜主动说话
- 输出格式可选 `wav`（直接播放）/ `mp3`（体积更小）；克隆音色试听与自动朗读统一走全局会话，控制条同源管理

> 语音 API Key 与模型 Provider 的 apiKey 走同一存储约定：明文存于用户私有数据目录（`%APPDATA%/com.winagent.app/config.json`），请勿分享。

## 主题包（外观皮肤）

「设置 → 外观」中切换主题包（`theme.skin`）：

- `plain`（默认）：无吉祥物、中性文案的简洁主题
- `angelina`：内置安洁莉娜头像与人设；素材经动态 import 代码分割，不选它不加载。新版工作台以任务导航与阅读为主，原有大立绘与漂浮装饰不再展示。
- `custom:<id>`：自制主题包。新建后逐槽位上传图片（png/gif/jpg/webp，单张 ≤5MB）：待机 / 思考 / 工具 / 识别 / 说话五态立绘 + 头像，**只需上传 idle 也能用**（缺省槽位自动回退）；支持重命名、清空单槽、整包删除

素材存 `dataDir/skins/`，经 `winagent-skin://` 自定义协议供渲染层 `<img>` 直接引用（id/slot 白名单 + 路径穿越双校验，`?v=mtime` 缓存失效）。切换主题包时可一键应用配套人设提示词默认值；自定义包被删除自动回退 plain，不会空白。

## 文件/图片附件

- 点击输入框左侧 **+** 按钮选择文件，支持多选
- 图片显示缩略图预览，文本文件显示文件图标
- **图片**：支持 vision 的模型（`gpt-4o`、`qwen2.5-vl`、`llava` 等）直接识别；不支持的模型走视觉辅助或降级为路径描述，不会报错。可在「设置 → 图片识别」中手动覆盖（自动检测 / 支持 / 不支持）
- **文本文件**（`.txt`/`.md`/`.json`/`.js`/`.ts`/`.py` 等）：内容自动读取并拼入消息
- **PDF**（≤15MB）：支持文件输入的模型直接以 document 形式发送（网关拒收自动降级为 `read_pdf` / `render_pdf_page` 工具读取）；超限传递路径信息
- **其他文件**：传递文件名和路径信息，可配合工具操作

## 视觉辅助（纯语言主模型 + 视觉模型协作）

当主模型不支持图片（如 `deepseek-chat`、大多数本地 Ollama 模型）时，可让另一个视觉模型先“看图”，再把描述文本交回主模型接续完成任务。

**工作流程**

```
用户上传图片
  ↓
主模型不支持 vision？→ 否 → 直接 multipart 发给主模型
  ↓ 是
视觉辅助已启用且配置正确？→ 否 → 退化为路径描述 + 提示
  ↓ 是
视觉模型逐张识别图片 → 描述文本
  ↓
描述文本拼入用户消息 → 主模型继续推理/调用工具
```

**配置方式**（设置 → 视觉辅助）

| 项 | 说明 |
|----|------|
| 启用开关 | 勾选后才会在主模型不支持图片时触发 |
| 接口来源 | 选「与主模型同一 API」则复用当前 Provider 的 Base URL / API Key；也可选另一个 Provider |
| 视觉模型名 | 同一 API 双模型时必填；选了其他 Provider 时留空则用该 Provider 自己的模型 |
| 识别指令 | 给视觉模型的提示词，留空用内置默认（原文转写、公式用 LaTeX、表格用 Markdown） |

设置面板会实时回显**实际调用的接口与模型**，配置无效（模型名空、与主模型完全相同）时给出警告。

**两种典型用法**

| 场景 | 接口来源 | 视觉模型名 |
|------|---------|-----------|
| 同一家 API 下两个模型 | 与主模型同一 API | 例如 `mimo-v2.5`（主模型为 `mimo-v2.5-pro`）|
| 跨家搭配 | 选另一个 Provider | 留空或填写覆盖模型名 |

> 每张图片单独一次请求，避免多图混淆；单张失败不影响其他图片和主流程。识别进度在状态栏实时显示。
> 若主模型被误判为支持图片（接口返回“不支持图片输入”），会自动降级走视觉辅助路径重试，不会直接报错。

## 流式输出与深度思考

设置 → 请求行为：

- **流式输出**（默认开）：关闭后不再逐字显示，等模型生成完毕一次性返回。部分网关对流式 + 工具调用兼容不佳时可关掉。
- **深度思考**：
  - `自动`（默认）—— 不下发任何思考参数，由模型自己决定
  - `开启` / `关闭` —— 同时下发 `enable_thinking`、`reasoning.enabled`、`thinking.type` 三种主流字段，兼容 Qwen3 / vLLM / OpenRouter / Claude 兼容端

> 若接口不认识思考参数并报错，客户端会**自动去掉参数重试一次**，不会因此失败。思维链内容兼容 `reasoning_content`（DeepSeek/Qwen）与 `reasoning`（OpenRouter）两种字段。

## Token 消耗统计

顶栏实时显示本会话累计 token（如 `12.3k tokens`），鼠标悬停可看到：

- 会话累计的输入 / 输出 / 总计
- 最近一次请求的用量
- 是否为估算值

统计口径：

- 优先取接口返回的真实 `usage`（流式下通过 `stream_options.include_usage` 获取）
- 接口未返回时本地估算，数字前加 `~` 前缀
- 包含工具调用循环的每一轮、视觉辅助模型、上下文压缩摘要的开销
- `/clear` 或清空对话后归零

## 文档生成、转换与视觉理解

让 Agent 生成 Word / Excel / PPT，公式以 **Word 原生可编辑公式**（OMML）写入，而非图片——在 Word 中双击即可用公式编辑器修改。架构为**模型优先三层管线**：模型产出 Markdown / 结构化 JSON（理解、排版决策、内容生成都交给模型），工具只做确定性序列化。

例子：

> 帮我写一份关于二次方程的数学讲义，包含求根公式和判别式，保存到桌面 quadratic.docx
> 把这份报告做成 10 页 PPT，保存到桌面 report.pptx

### 生成与转换工具

| 工具 | 用途 |
|------|------|
| `markdown_to_docx` | Markdown 一键转 Word：`#` 标题、`-`/`1.` 列表、`\| 表格 \|`、`$$块级公式$$`/`$行内公式$`、`---` 分页；检测到 pandoc 优先用 pandoc 引擎，否则内置纯 JS 引擎（零依赖，字体/字号/横向参数生效） |
| `write_xlsx` | 创建 Excel：`sheets` JSON 数组精确控制（{name, rows}），或直接给 Markdown 表格文本（数字字符串自动转数值） |
| `write_pptx` | 创建 PowerPoint（16:9）：slides JSON（title / subtitle / bullets / text / notes），三种版式（封面页 / 标题+要点 / 双栏要点） |
| `office_convert` | 格式互转枢纽：xlsx↔csv/json、md↔docx↔html↔txt（需 pandoc）、任意 Office 文档 → PDF（LibreOffice / MS Office 自动探测）、`.doc` → `.docx`；四级降级链，不可达时报错附安装指引 |

### 文档读取与视觉理解（混合回退链）

PDF 附件（≤15MB）优先**文件直传**（provider 支持时，拒收自动降级）；扫描件 / 复杂排版用 `render_pdf_page` 整页渲染成 PNG 由视觉模型直接看；常规文档用 `read_pdf` / `read_docx` 等 skills 哑提取文本（纯 JS 零系统依赖）+ 模型结构化。`read_docx(with_images)` 解包文档内嵌图片、`extract_pdf_images` 抽取 PDF 嵌入图——图片以 `[[IMG:]]` 标记返回，Agent 自动转为视觉输入（非 vision 模型走视觉辅助描述），base64 不进文本上下文。

### 公式写法

用 LaTeX 语法，已验证支持分式、根号、上下标、积分、求和、希腊字母等：

```
行内：质能方程 $E = mc^2$ 表明…
块级：$$x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$$
```

> 实现为 `LaTeX → MathML（temml）→ OMML（mathml2omml）→ OOXML 写入 docx（jszip）`，纯 JS 无原生模块，**无需安装 Word 也能生成**。已修复 `mml2omml` 双重转义 bug 和空公式位多余空格问题。

## Wiki 知识与规则工作区

左侧有“助理”“专题任务”“Skills 与 MCP”“Wiki 知识库”四个入口。Wiki 负责阅读和管理文件；点击“加入当前聊天”或引用原文时，回到当前助理或专题聊天。切换入口保留 Wiki 阅读位置和聊天草稿。

“助理”只有一个固定聊天，可以访问整个 Wiki；“新建专题任务”创建独立聊天，同时生成 `专题:<名称>` 标签。在 Wiki 阅读页点击标签即可将文件加入或移出专题，一份文件可以属于多个专题。专题聊天每轮只注入本专题所有已标记文件的内容，持久规则也只采用本专题文件编译的规则；没有标记文件时会要求先添加，资料超出单轮阅读预算时会明确报错。专题不开放 Wiki 读取、外部读取或命令工具，仍可用输出文件工具生成文档。要在专题中使用附件，先把它导入 Wiki 并添加标签。

聊天消息、模型历史、规则版本快照和草稿保存在 `%APPDATA%/com.winagent.app/conversations/`。执行中的任务需结束或停止后再切换。`Ctrl+B` 收起 / 展开侧栏，`Ctrl+Shift+N` 新建专题任务；分隔线支持拖拽与方向键调整。

### 导入、阅读与提问

1. 在“资料”中导入 PDF、Word、PPT、Excel、Markdown 或文本。原始文件保存在 `raw/`；解析完成后先可检索，详细分析在后续逐段完成。
2. 打开资料，在“详细知识”“原文与证据”之间切换。详细正文保留定义、解释、步骤、数值与单位、条件、例外和局限；证据引句必须能在对应原文中找到。
3. PDF 可以选择“PDF 原版阅读”；提取文本带页码标记。扫描件与无法提取文字的图片不会被标记为已完成知识分析，需要先 OCR。
4. 助理中点击“加入当前聊天”可固定资料；选中原文后点“选段加入提问”，内容进入助理聊天输入框。专题中需先为该文件添加当前专题标签。回答引用可回到对应原文片段。
5. 阅读页的“专题任务标签”可直接添加或移除标签。“删除文件”会在确认后删除 Wiki 来源页；导入资料还会一并删除原文件、分析记录及关联规则。

### 让论文规范在以后自动生效

1. 导入论文规范，打开其资料页，展开“将这份资料作为任务规范”。
2. 选择“论文写作与修改”，点击“编译并启用规范”。所有可读取片段都会参与编译，条款保留强制程度、条件、例外及原文证据。
3. 在主界面直接提出“帮我写一篇论文”。系统显示本次采用的规范版本，并在每轮模型调用时加入规则；无需再次复制规范。程序重启后启用状态仍保留。
4. 回复完成后查看“规范检查”。语义检查明确标为模型评估；缺少依据、检查失败或实际文件内容与版式尚未检查时标为需核验，不宣称全部通过。纯文本答复的未满足项最多自动修正一次。

支持论文、报告、代码、所有任务、自定义关键词范围，也可以通过 `@规范标题` 显式选定。总结论文不会自动匹配论文写作格式；继续修改同一任务时保留原规则快照。关闭普通知识检索不会停用规则。停用规则影响后续新任务，原文变化后需重新分析和编译。

### 处理记录与存储

“处理记录”显示真实处理阶段、已完成片段、错误、取消和重试入口。重启后未完成任务标为可恢复，点击重新处理继续；同来源、模型与分析版本的成功片段使用缓存。详细分析遇到输出长度截断会继续细分片段；如果模型连最小片段都无法返回完整 JSON，会提示换用输出能力更高的模型。重新分析直接覆盖对应 AI 知识正文，不做旧笔记迁移；原始资料保留，直到用户点击删除。

```text
<vault>/
├── raw/                  原始资料
├── wiki/sources/         全文详细知识 Markdown
├── wiki/outputs/         保存的对话结论
└── .winagent/
    ├── sources/          原文片段、版本、详细知识结构
    ├── analysis-cache/   逐段分析缓存
    ├── jobs/             处理进度与恢复记录
    ├── rules/            已编译规则集及启用状态
    ├── task-context/     任务采用的完整规则版本快照
    └── tasks/            规范检查结果
```

备份时应复制整个 vault，包括 `.winagent/`；任务记录另存于数据目录的 `conversations/`。当前检索使用本地关键词索引；语义向量检索、自动 OCR、规范语义冲突消解与实际 DOCX/PDF 版式自动验收尚未实现。后台任务按用户点击恢复。

开发验证：`npm run test:wiki`、`npm run test:output-limit`、`npm run test:conversations`、`npm run test:wiki-ui`、`npm run test:workbench-ui`、`npx tsc --noEmit`。界面测试在隔离的隐藏 Electron 窗口运行；模型测试使用离线响应，不消耗用户 API 额度。

### 输出 Token 上限

“设置 → 生成参数”默认启用自动检测。按服务商地址与模型读取公开的输出字段（包括 Google 原生模型的 `outputTokenLimit`），缺少字段时发送只要求回复 `OK` 的参数校验请求，不附带对话、资料或工具。检测可能产生一次极小的模型请求；成功响应会立即取消流。

确认的上限回填最大输出 Tokens 并缓存一天；“重新检测”跳过缓存。无法确认时填入 `0`，实际请求不发送 `max_tokens`，交给 API 默认值。请求遇到明确的输出范围错误时重新记录上限并重试一次；网关连自身宣称的上限也拒绝时，重试使用服务端默认值。认证、配额和上下文超限不是输出上限，不会伪装为检测成功。

### 开源代码来源

工作台交互参考 [ZCode](https://github.com/zai-org/ZCode)，复用其侧面板标签溢出计算，并改编侧栏宽度保存、指针与键盘调整逻辑。固定来源版本及修改说明见 [第三方声明](third-party/ZCode/NOTICE.md)，Apache-2.0 许可证和上游声明随源码与 EXE 打包分发。WinAgent 的 Skills/MCP 页面使用本地工具注册表。

## 配置文件

`config.json`（`%APPDATA%/com.winagent.app/` 目录下，首次运行自动生成）：

```jsonc
{
  "activeProviderId": "ollama",
  "providers": [
    // apiKey 以明文保存于用户私有目录，请勿分享 config.json
    { "id": "ollama", "label": "Ollama (本地)", "type": "ollama", "baseUrl": "http://localhost:11434", "apiKey": "", "model": "qwen2.5:32b", "supportsVision": undefined },
    // supportsVision: undefined=自动检测, true=强制支持, false=强制不支持
  ],
  "temperature": 0.3,
  "maxTokens": 4096,
  "autoMaxTokens": true,     // 按 API / 模型检测并回填，未知时为 0（服务端默认）
  "autoApproveTools": false,
  "compactThresholdTokens": 24000,
  "keepRecentTurns": 6,
  "skillsDir": "skills",
  "skillsDirs": [],         // 从 Skills 与 MCP 页面追加的技能目录
  "mcpConfigPath": "mcp.json",
  "petPrompt": "…",          // 人设提示词（纯人设；工具清单与执行规则由系统动态拼接，勿写进人设）
  "knowledgeRag": {
    "enabled": true,         // 对话自动 RAG：每轮提问自动检索知识库并注入结果
    "topK": 3,               // 每次注入的最大条数
    "minScore": 0.12         // 注入的相关度阈值（归一化 0~1）
  },
  "visionAssist": {
    "enabled": false,        // 主模型不支持图片时，是否调用视觉模型代为识别
    "providerId": "",        // 空 = 与主模型同一 API；否则指定另一个 provider id
    "model": "",             // 视觉模型名，同一 API 双模型时必填
    "prompt": ""             // 识别指令，留空用内置默认
  },
  "stream": true,            // 流式输出
  "thinkingMode": "auto",    // 深度思考：auto / on / off
  "theme": {
    "mode": "light",             // light / dark / auto
    "accent": "#f4719c",
    "accent2": "#6db7d9",
    "skin": "plain"              // plain 默认 | angelina 内置 | custom:<id> 自制主题包
  },
  "voice": {
    "enabled": false,            // 语音功能总开关
    "apiKey": "",                // MiMo API Key（与 providers 同一存储约定）
    "baseUrl": "https://api.xiaomimimo.com/v1",
    "voice": "mimo_default",     // 内置音色名 或 "clone:<voiceId>"
    "autoPlay": false,           // 回复完成后自动朗读
    "stylePrompt": "",           // 朗读风格指令，如「用开心的语气说」
    "outputFormat": "wav"        // wav / mp3
  }
}
```

## 斜杠命令

- `/clear`：清空对话
- `/compact`：压缩上下文

## 扩展

- **Skills**：见 `skills/README.md`。
- **MCP**：编辑 `mcp.json`，把要用的 server 的 `disabled` 去掉或设为 `false`。

## 安全提示

WinAgent 拥有较高系统权限（删文件、改注册表、执行命令、模拟输入、访问网络）。默认对危险操作弹窗确认；请谨慎开启“自动放行”。部分操作（写 HKLM、改系统目录）需以管理员身份运行。

**API Key 存储**：`config.json` 中的 `apiKey` 以明文保存于用户私有数据目录（桌面版 `%APPDATA%/com.winagent.app/`，插件版 `$DSH_HOME/winagent/`），均为本机当前用户的私有位置，请勿分享该目录或 config.json。旧版 DPAPI 密文（`enc:v1:` 前缀）加载时自动清空，需重填一次。

## 故障排查：启动白屏

v0.5.0 起界面渲染出错会显示报错面板，请把面板上的错误信息反馈到 Issues。若窗口仍是纯白（错误发生在界面之外，如主进程或预加载脚本），在项目目录执行以下命令获取渲染进程日志：

```bash
npx electron . --enable-logging=stderr --v=0
```

输出中 `CONSOLE(...)` 与 `Uncaught` 开头的行即为报错原因。

## 技术栈

**Electron** + TypeScript + React + Vite（electron-vite）+ TailwindCSS。桌面版主进程是精简编排层（窗口 + IPC + 数据目录），**全部业务逻辑（Agent 循环、53+ 工具、LLM Wiki、skills/MCP）复用 `dsh-plugin/` 服务层**（`dsh-winagent` file: 依赖）——一套 TS 代码同时服务桌面版与 DSH Web 插件。文档解析（PDF / PPTX / DOCX / XLSX）通过子进程调用插件自带解析脚本。

## DSH 插件版（dsh-winagent）

把 WinAgent 的完整 Agent 能力做成 DeepSeek Harness（DSH）Web 插件：**OpenAI 兼容 API / 本地 Ollama + 53+ Windows 工具 + skills + MCP + LLM Wiki 知识库**，装在 DSH Web 界面里直接使用。插件代码在仓库的 [`dsh-plugin/`](./dsh-plugin) 目录，数据目录为 `$DSH_HOME/winagent/`。

### 安装

```powershell
# 本地链接安装（开发）：在 dsh 所在环境执行
dsh plugin --profile web add link:<本仓库绝对路径>\dsh-plugin
# 或发布 npm 后：
dsh plugin --profile web add dsh-winagent
# 或从 GitHub 安装（本仓库发布后）：
dsh plugin --profile web add github:HarrisXiu/WinAgent
```

安装完成后**重启 dsh web**，浏览器 **F5 刷新**：页面右下角出现 **WinAgent** 悬浮按钮，点击打开插件界面；插件也会出现在 DSH「设置 → 插件」清单里。

### 功能

- 聊天界面：流式输出、思维链折叠、工具调用卡片、危险操作确认弹窗、图片/文本附件、视觉辅助
- 设置：Provider 管理（OpenAI 兼容 / Ollama）、请求行为、深度思考、危险工具放行、人设提示词、skills / mcp / vault 路径
- 知识库：文件树、全文搜索、编辑、URL 导入、上传文件自动编译入库（LLM Wiki）、LINT / REFLECT 工作流
- 文档处理：模型优先三层管线（读取回退链 / `[[IMG:]]` 视觉注入 / 生成 / `office_convert` 互转）；`GET /winagent/api/capabilities` 返回本地能力探测结果
- 工具：53+ 内置 Windows 工具 + skills（manifest.json / SKILL.md）+ MCP（stdio / HTTP）挂载

### 开发

```powershell
cd dsh-plugin
npx tsc -p tsconfig.json   # 或仓库根目录 npm run plugin:build
```

> 说明：桌面版的个性化桌宠主题不在插件范围内；人设提示词仍可在插件设置中自由修改。插件运行在 dsh web 进程内，以当前 Windows 用户权限执行工具，危险操作默认弹窗确认。

## 更新日志

### v0.5.0（2026-09-28）

- 更正此前误标的 v4.5 / 4.5.0，桌面包与服务插件统一为 0.5.0。
- 主界面改为 ZCode 风格侧栏工作台：助理、专题任务、Skills 与 MCP、Wiki 并列；助理固定聊天、专题独立聊天，历史和草稿支持恢复。
- 新建专题任务自动生成标签；Wiki 文件可直接增删专题标签与删除资料。专题检索、规范和工具访问受标签范围限制。
- Skills 目录支持追加和单目录导入，MCP 配置可直接编辑连接，现有工具按来源展示与搜索。
- 自动检测 API / 模型输出上限并回填；明确范围错误更新缓存后重试，无法确认时使用服务端默认参数。
- 重构 Wiki 为主界面内的资料、专题、规则与处理记录工作区，独立窗口也使用相同阅读组件，提问回到主会话。
- 全文分块分析与原文证据校验，移除导入 6000 字符限制及固定少量概念空页；增加逐段缓存、截断自动细分、失败恢复、单任务取消。
- 持久任务规范的编译、启停、任务匹配、每轮加载、版本快照和逐条检查；纯文本检查不通过时限一次修正。
- 对话使用原文片段，支持固定资料、引用定位、选段提问与保存结论；加入 PDF 原版阅读及页码文本。
- 模型列表、输出上限检测以及助理/Wiki 的实际模型请求统一使用 Electron 网络栈，沿用系统代理；保存前可测试当前填写的服务商配置。连接失败时提示 DNS、代理、证书或超时类别。
- **修复启动白屏**：`wiki/ANALYSIS_TAGS.md` 以对象数组（`{tag, template}`）保存 tags，被当作笔记标签透传到知识工作区，`startsWith` 抛错导致整个主窗口白屏。服务层新增 `normalizeTags` 保证笔记 tags 恒为字符串数组（数字/布尔转字符串，对象丢弃），渲染层增加类型守卫。
- **白屏兜底**：新增 `ErrorBoundary`，包在渲染根部与常驻挂载的知识工作区外层。此后任何界面渲染异常都会显示报错信息与「重试 / 重新加载窗口」按钮，不再表现为无提示的白屏；知识工作区出错仅影响面板本身，聊天不受影响。

**此前同批次的朗读修复（原误标 v4.5，2026-09-26）**

**朗读修复与缓存重播**
- 修复点击朗读或试听时出现 `MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check`：页面媒体策略允许语音使用的 `data:` 音频地址。
- 修复两段音频之间等待合成时提前结束整条朗读的问题，保留会话并等待后续音频，完整合成后写入缓存。
- 修复播放队列暂时排空后段号重置的问题，保持播放进度与服务端预取回执连续。
- 再次朗读同一条回复直接重播已有音频；完整合成后停止播放也保留缓存。缓存按最近使用顺序保留 20 条，内容或音色参数变化时重新合成。
- 新增 `npm run test:speech`，覆盖慢速分段、重复重播、停止后重播、不完整或失败结果以及文本和音色参数变化。

**语音朗读与声音克隆（MiMo TTS）**
- 新增 `dsh-plugin/src/voice/` 语音子系统：`MimoTtsClient`（OpenAI 兼容 chat/completions 承载 TTS；内置音色走 `mimo-v2.5-tts`，样本 dataURL 自动切 `mimo-v2.5-tts-voiceclone`）、`plainTextForSpeech` Markdown 清洗、`VoiceStore` 克隆音色库、`VoiceService` 门面（`clone:<id>` 解析 + 未配置友好报错）、`SpeechSession` 分段会话（按句切分 + ack 回执驱动滑窗预取 + 可取消）
- 渲染层：`SpeechBar` 全局控制条（第 n/N 段进度 / 暂停 / 继续 / 跳过 / 停止 / 错误展示）、`useSpeech` + `player.ts` 播放管线、assistant 气泡 🔊 朗读按钮、Esc 停止朗读、回复完成自动朗读（可选）
- `speak_text` 内置工具：Agent 可主动朗读（经 bus 广播 voiceSegment 事件到渲染层播放）
- 设置 → 语音：总开关、MiMo API Key、内置音色（9 个）+ 克隆音色统一下拉、自动朗读、风格指令、wav/mp3 输出；克隆音色管理（上传 wav/mp3 / 试听 / 行内重命名 / 删除），变更经 `voice:changed` 广播双窗口同步
- 音色库样本仅存本地 `dataDir/voices/`；语音 apiKey 与 providers 同一存储约定

**主题包（外观皮肤）系统**
- `ThemeConfig.skin`：`plain`（默认，无吉祥物简洁主题）/ `angelina`（内置，素材经动态 import 懒加载）/ `custom:<id>`（用户自制）
- `SkinStore`（`dsh-plugin/src/theme/`）：素材存 `dataDir/skins/<id>/<slot>.<ext>`（png/gif/jpg/webp ≤5MB），槽位 idle/think/tool/vision/talk/avatar 可缺省（回退 idle）
- `winagent-skin://` 自定义协议：特权注册（standard/secure/stream），id/slot 白名单 + 路径穿越双校验，`?v=mtime` 缓存失效
- 渲染层 `SkinProvider` + `skins.ts` 解析层（立绘/头像/装饰/状态文案/欢迎语按包取值）；自定义包被删自动回退 plain
- 设置 → 外观：主题包选择/新建/逐槽位上传（文件对话框）/清空/重命名/删除，`skin:changed` 广播同步；切换主题包可联动应用人设默认值（`config:prompts` 下发内置默认）

### v0.4.0（2026-09-06）

**主体回调 TS：桌面版回归 Electron，删除 Rust 后端**
- 桌面版主进程重写为精简编排层（窗口 + IPC + 数据目录），全部业务逻辑复用 `dsh-plugin/` 服务层（`dsh-winagent` file: 依赖）——一套 TS 代码同时服务桌面版与 DSH Web 插件，不再维护两套实现
- 删除 `src-tauri/` 与旧 `src/main/` 服务副本（git 历史保留）；数据目录沿用 `%APPDATA%/com.winagent.app/`，既有 wiki vault / config 无缝延续
- 拖拽改回 Electron `File.path` + HTML5 事件（`drag-shim.ts` 派发同名自定义事件，`App.tsx` / `WikiLayout.tsx` 零改动）

**文档处理模型优先重构（Office/PDF 三层管线）**
- 工具变薄变确定：模型承担理解/结构化/内容生成，工具只做哑提取与确定性序列化；删除旧工具（`generate_image_prompt`、`create_word_document`、`markdown_to_word`、`latex_formula_to_omml`）
- 生成整合：`markdown_to_docx`（pandoc 检测优先 / 内置 temml+mathml2omml 纯 JS 链兜底）+ 新增 `write_xlsx`（SheetJS）、`write_pptx`（pptxgenjs）、`office_convert` 四级降级格式互转（纯 JS → pandoc → LibreOffice → Office COM）
- 视觉理解链：新增 `render_pdf_page`（pdfjs-dist + @napi-rs/canvas 整页渲染）与 `extract_pdf_images`（嵌入图抽取）skill；`read_docx` 支持 `with_images` 解包 word/media/；`[[IMG:]]` 标记协议——skill 输出图片标记，Agent 剥离转为视觉输入（非 vision 模型走视觉辅助），base64 不进文本上下文
- PDF 附件直传：provider 支持文件输入时 PDF（≤15MB）直接作为 document 输入发送，网关拒收自动降级为 `read_pdf` / `render_pdf_page` 工具路径；`ProviderConfig.supportsFiles` 可显式控制
- 能力探测基础设施：`capabilities.ts`（pandoc / LibreOffice / Office COM / pdfjs 渲染链 / PyMuPDF，启动预热缓存）+ `GET /winagent/api/capabilities` + 系统提示词自动注入能力摘要
- skills 播种改为按文件夹增量合并（老数据目录自动获得新增 skill）；可选依赖 `pdfjs-dist` / `@napi-rs/canvas`（未装时视觉渲染能力降级，其余不受影响）

**LLM Wiki 知识增强（对话自动 RAG）**
- **自动检索注入**：每轮提问自动检索知识库，把相关笔记（标题/路径/confidence/摘要）注入上下文；未命中时明确提示「知识库中没有相关内容」，杜绝模型凭空作答而不告知
- **检索引擎重写**：IDF 加权评分（BM25 简化版）+ 字段权重（title/aliases/tags/summary/content）+ aliases 单独索引 + 中文单字查询支持 + 归一化分数（0~1）
- **System prompt 重构**：人设与规则职责分离（`petPrompt` 纯人设、规则动态拼接），消除 4210 字符的重复规则块；知识库触发条件从关键词式放宽为「知识类问题优先依据库内知识作答」
- 新增 `retrieve_knowledge` 深度检索工具（一次取多篇全文）；`merge_knowledge_pages` 升级为危险操作（强制确认弹窗）；search 结果附带 confidence

**AI 分析管线修复**
- INGEST 输出截断/解析失败从静默空兜底改为如实报错（对齐契约 §9）；REFLECT 增加 Limitations 字段（回音室风险标注落盘）；QUERY 的 confidence 表述与契约 §7 对齐（high 仅由用户背书）
- 概念/实体提取数量口径统一（契约 §1）；slug 统一纯英文 kebab（`slugifyKebab`，契约 §0）；批量摄入 abort 修复 null 解引用并取消在飞请求；REFLECT/QUERY 支持取消
- GraphEngine 悬空边修复 + AI 发现的关系（aiRelations）入图谱

### v0.3.0（2026-08-15）

**从 Electron 迁移至 Tauri v2**
- 整体架构从 Electron（Node.js 后端）迁移至 **Tauri v2**（Rust 后端），前端保持 React + Vite + TailwindCSS 不变
- IPC 通信从 Electron `contextBridge` / `ipcMain` 改为 Tauri `invoke` / `listen`，前端通过 `tauri-bridge.ts` 适配层保持 `window.winagent` API 兼容
- 配置 Tauri ACL 权限（`src-tauri/capabilities/default.json`），为核心 IPC、事件、对话框、文件系统、shell 操作授予最小权限
- 数据目录从 exe 同级改为 `%APPDATA%/com.winagent.app/`，遵循 Windows 应用数据规范
- 打包格式从 zip（解压即用）改为 MSI / NSIS 安装包（Tauri bundler）

**拖拽功能修复（Tauri 原生拖放）**
- 从 Electron 的 HTML5 `File.path` 方案改为 **Tauri 原生 `onDragDropEvent`**，在 `tauri.conf.json` 中启用 `dragDropEnabled: true`
- `tauri-bridge.ts` 拦截 Tauri 拖放事件并派发 `tauri:dragenter` / `tauri:drop` / `tauri:dragleave` 自定义 DOM 事件
- `App.tsx` 和 `WikiLayout.tsx` 监听自定义事件，使用 Tauri 返回的文件路径字符串替代 `File` 对象
- 知识库窗口拖放同步适配，`WikiWindowApp.tsx` 的 `handleDropFiles` / `handleFilesPicked` 改为接收 `{name, path}` 对象

**白屏问题修复**
- 根因：前端缺少 Tauri IPC 桥接层，`window.winagent` API 未定义导致 React 渲染崩溃
- 修复：在 `main.tsx` 中于 React 渲染前导入 `tauri-bridge.ts`，确保 `window.winagent` 在组件挂载前就绪
- 调整 CSP 配置以允许 Tauri 协议资源加载

**对话与知识库功能修复**
- 根因一：缺少 Tauri v2 ACL 权限声明，`invoke` / `listen` 调用被安全策略拦截 → 新建 `capabilities/default.json` 授予 `core:default`、`dialog:default`、`shell:default`、`fs:default` 等权限
- 根因二：`ToolRegistry::initialize()` 未被调用，`AgentService` 使用独立的空注册表 → 改为共享 `Arc<ToolRegistry>`，在 `lib.rs` setup 阶段初始化并注入
- 根因三：`VaultManager::initialize()` 未调用，知识库目录结构不存在 → setup 阶段自动初始化 vault
- 根因四：`SearchIndex` 和 `GraphEngine` 启动时未构建，搜索和图谱为空 → 从磁盘笔记重建索引与图
- wiki 工具注册移入 `ToolRegistry::initialize()` 内部，避免 `lib.rs` 访问私有类型

**AI 分析管线优化**
- **无死锁取消**：`AiPipeline` 从 `Mutex<AiPipeline>` 改为 `Arc<AiPipeline>`（内部可变），配合 `tokio::sync::watch` 单调 epoch 实现非阻塞取消——取消请求可以立即送达正在运行的分析任务，不会因 Mutex 锁竞争而死锁
- **guarded 任务竞速**：每个分析步骤用 `guarded()` 包装，在任务完成与取消信号之间竞速，取消时立即返回 `Cancelled` 错误
- **JSON 解析鲁棒性**：`complete_json` 函数处理 LLM 输出中常见的 prose 包裹、markdown 代码块围栏；`extract_json_object` 用括号配对提取 JSON 主体；解析失败时发起一轮 **repair 请求** 让 LLM 修正格式
- **UTF-8 安全截断**：`snippet` / `clip_body` 函数按字符边界截断多字节字符串，避免 panic
- **数据验证与清洗**：
  - `normalize_tags`：trim、去重、限制 3-8 个标签、每个 2-8 字符
  - `sanitize_relations`：验证 relation target 必须逐字匹配候选笔记路径，过滤 LLM 编造的路径
  - `slug_list` / `str_array`：统一处理 LLM 返回的数组字段，容错字符串与数组混用
  - `dedupe_nonempty`：去除空字符串与重复项
- 批量摄入中止（`batch_abort`）正确调用 `AiPipeline::cancel()`，而非无效的标志位

### v0.2.3（2026-08-13）

**拖入分析弹窗（重构剪藏流程）**
- 主窗口拖入文件不再无条件编译，改为弹出「分析要求」弹窗：文件列表 + 历史分析 tag 多选 + 可编辑输入框
- 三个入口：**开始分析**（编译 + 定制分析）/ **直接编译入库**（降级，跳过定制分析）/ **取消**（放弃导入）
- 弹窗内实时展示进度：导入 → AI 编译（sources/concepts/entities）→ 定制分析 → 归纳 tag；结果绿色卡片 5 秒渐隐消失
- 定制分析：用户要求注入 AI prompt（与契约 CLAUDE.md 同轨），报告逐条回应要求、不编造、原文引用注明位置，追加到来源页 `## Custom Analysis` 区块（正文，可被检索）
- 分析 Tag：AI 把每次要求归纳为「短标签 + 一句话模板」，多选填入输入框后可继续编辑；持久化于 `wiki/ANALYSIS_TAGS.md`（系统文件，可手动编辑/删除）

**对话检索强化**
- 对话中提及知识库/笔记/wiki 内容时，AI 主动调用 `search_knowledge_base` 检索（返回标题 + AI 摘要 + 正文片段，通常可直接回答）
- 命中不理想自动换关键词（同义词/英文/缩写）重试；需要细节时 `read_note` 读全文
- 回答注明来源笔记标题，核心结论溯源到 wiki/sources/ 具体来源页，来源矛盾时显式标注分歧
- 检索结果随附 AI 摘要（SearchIndex 索引与检索链路扩展 summary 字段）

**绿色成功提示 5 秒渐隐**
- wiki 编译成功 toast / 主窗口处理卡片 / 独立窗口摄入提示：成功态 5 秒后淡出（300ms transition），错误提示保持常驻手动关闭

### v0.2.2（2026-08-11）

**主题系统（CSS 变量驱动）**
- 全部硬编码配色重构为 CSS 变量令牌（RGB 通道格式），Tailwind 语义色经 `rgb(var(--x) / <alpha-value>)` 接线，133 处透明度修饰符（`bg-accent/10` 等）正常
- 支持三种模式：浅色 / 深色 / **跟随系统**（auto 模式随 Windows 亮暗自动切换，matchMedia 实时响应）
- 自定义主色：设置 → 外观 → accent / accent2 两个拾色器（含 hex 手输），其余色阶（hover 态、边框、浅色面板、光晕、按钮文字）由 **colord** 自动推导
- 对比度兜底：深色模式主色与背景自动提亮至 WCAG AA（≥3:1）；主色上的文字色按对比度自动选黑/白；纯黑/纯白/荧光色等极端输入不产生不可读组合
- 跨窗口实时同步：`config:save` 广播 `config:changed`，主窗口与知识库窗口任一修改主题，另一窗口即时生效
- 图谱（canvas）与 CodeMirror 编辑器跟随主题：canvas 从 CSS 变量读取调色板并订阅主题变更重绘，节点渐变由用户主色推导（自定义主色贯穿图谱）；编辑器主题引用 CSS 变量，无需重建实例
- 代码高亮深色适配：`[data-theme='dark']` 下 github-dark 色板覆盖
- 修复启动闪色：`BrowserWindow.backgroundColor` 按解析后主题取值（原主窗口深色首帧与浅色 body 不一致）
- 默认主题 = 原品牌配色（浅色 + 粉蓝 #f4719c / #6db7d9），「恢复默认配色」一键还原

**AI 分析管线增强**
- `analyze()` 注入知识库契约（CLAUDE.md 相关小节：总则 / wikilink / confidence / 个人写作 / 质量红线）——改契约 → AI 分析行为随之变化
- 按页面类型定制审查规则（source / concept / entity / raw / 普通笔记）
- 新增质量建议输出（stub 提示、缺溯源 wikilink、可回答开放问题、矛盾检测）
- AIPanel 一键应用：插入摘要到正文顶部、插入关联笔记 wikilink（遵循契约铁律 `[[slug]]` 裸 slug）
- 修复 LINT 检查 2 把裸 slug 合规链接误判为断链（`pageIds` 补 basename）；图谱链接解析同根因修复
- 契约截断改为行级（章节标题完整不切半），`extractContractSections` 按优先级抽取小节

**文档读取 Skills 扩展**
- 新增 `read_docx`、`read_pptx`、`read_xlsx` 三个 skill，分别读取 Word / PowerPoint / Excel 文档文本（纯 JS 提取，无需 Office/LibreOffice）
- 共享提取核心 `skills/pdf/extract.js`：支持 pdf/pptx/docx/xlsx/xlsm/doc/xls/ppt 全格式，各 skill 复用同一核心
- `read_pdf.js` 重构为瘦入口（-175 行），消除与新增 skills 的重复代码
- GraphEngine 链接解析修复：`knownIds` 补 basename 裸 slug（`GraphEngine.ts`），与 LINT 检查 2 同根因——契约铁律 `[[slug]]` 裸 slug 链接在图谱中现在也能正确解析

### v0.2.1（2026-08-08）

**知识库独立窗口（第二窗口）**
- 主窗口顶栏点击 📖 图标弹出知识库独立窗口（`?view=wiki` 渲染 `WikiWindowApp`），与主窗口解耦，可独立拖拽、缩放、关闭
- 独立窗口顶栏工具栏：批量摄入、AI 问答、健康检查、综合分析、去重合并、开放问题、URL 导入
- 批量摄入交互式标定流程：先编译第 1 篇供用户审查 → 确认质量达标后继续批量 → 可中途「调整契约规则」（编辑 CLAUDE.md 后立即生效）或停止
- 拖拽文件到独立窗口：1 个走单文件快路径，多个走批量标定
- Toast 通知系统：操作结果以右下角气泡提示（成功/失败），8 秒自动消失
- LINT 发现 SOURCE MODIFIED 时弹出重新摄入提示条，一键全部重编译

**Wiki 浏览器增强**
- 右侧详情面板四标签页：标签（Tag）、反链（Backlinks）、AI 分析、注释（Annotations）
- 注释功能：编辑模式选中文本 → 添加注释 → 右侧面板管理/删除
- 反向链接面板：显示引用当前笔记的所有页面，点击跳转
- 标签面板：当前笔记标签管理 + 全库标签云（含计数），点击按标签筛选
- AI 分析面板：对当前笔记调用 LLM 生成建议标签、关联概念、摘要
- ConfirmHighDialog：概念达 5+ 来源时弹窗确认是否晋升 confidence: high
- 量子粒子图谱视图：全库 wikilink 关系可视化

**工作流扩展**
- AI 问答（workflow:query）：基于知识库检索回答，答案带 [[source]] 溯源 + Confidence Notes + Limitations，落盘 wiki/outputs/
- 去重合并（workflow:merge）：Jaccard 相似度检测重复概念/实体，保留页吸收 aliases + Sources + Evolution Log，全库 wikilink 改写，被合并页替换为 redirect
- 综合分析（workflow:reflect）：Stage 0 反向检验（SHA-256 校验来源完整性）+ Gap Analysis（识别知识缺口），生成 synthesis 报告
- 健康检查（workflow:lint）：10 项检查含 SOURCE MODIFIED 检测（raw 文件 SHA-256 变化时提示重新摄入）

**URL 导入**
- 粘贴网页 URL → 抓取正文 → 保存到 raw/clippings/（含 source_url frontmatter）→ 自动 AI 编译为 sources/concepts/entities 页

**修复：INGEST 管线无法处理非 .md 文件**
- 文件监听器（`VaultManager.startWatching`）原先只放行 `.md` 文件，PDF/Word/PPT/Excel/图片等放入 `raw/` 后不触发自动编译 → 新增 `INGESTIBLE_EXTS` 常量覆盖全部可摄入格式，watcher 按扩展名过滤
- `listNotes()` 只列出 `.md` 文件，启动补偿扫描 `ingestPendingRawFiles()` 无法发现未编译的非 Markdown 文件 → 新增 `listRawFiles()` 方法递归扫描 `raw/` 下所有可摄入文件，`ingestPendingRawFiles()` 改用此方法
- `AiPipeline.ingestSource()` 的 `maxTokens` 从 1500 提高到 3000，减少复杂来源 JSON 输出被截断导致解析失败的概率
- LLM 输出无法解析为 JSON 时输出 `console.warn` 日志，便于排查

**修复：Wiki 界面内容过长无法滚动**
- flexbox height 链断裂：`WikiWindowApp` 包裹 `WikiLayout` 的容器非 flex 布局，导致子元素 `flex-1` 无效、高度由内容撑开 → 容器加 `flex flex-col`，整条 height 链贯通
- `WikiEditor` 根元素 `h-full` → `min-h-0 flex-1`，所有 `MarkdownPreview` 包裹容器加 `flex flex-col` + `min-h-0 overflow-hidden`
- `MarkdownPreview` 自身 `h-full overflow-auto` → `min-h-0 flex-1 overflow-auto`，内容过长时在 flex 布局中正确滚动

### v0.2.0（2026-08-07）

**LLM Wiki 个人知识库（Karpathy 模式）**
- 三层架构：raw/（原始文件只读）+ wiki/（编译层）+ outputs/，目录自动初始化
- 拖拽任意文档（PDF/PPTX/DOCX/XLSX/PPT/DOC/XLS/MD/TXT）→ 自动导入 raw/ → 提取文本 → AI 编译为 sources/concepts/entities 页面，带实时进度条
- 概念名称对齐（slug + aliases 匹配，避免重复建页）、Evolution Log、confidence 体系（5+ 来源用户确认晋升 high）
- possibly_outdated 标注、SHA-256 完整性、个人写作流程（raw/personal/）
- 系统文件自动维护：index.md / log.md / overview.md / QUESTIONS.md
- 知识库面板：分层文件树（raw 只读 / wiki 可编辑）、中缝拖拽调宽、量子粒子图谱、raw 源码/预览切换
- Agent 知识库工具 9 个：search_knowledge_base、read_note、list_notes、read_raw_file、add_question、save_knowledge_output、lint_knowledge_base（9 项检查）、merge_knowledge_pages、reflect_knowledge_base
- raw/ 目录自动监视：任何方式放入的文件自动编译（防抖 + 去重）

**Agent 模式合并入桌宠模式**
- 移除模式切换，单一安洁莉娜桌宠：人设 + 完整 Agent 工具能力
- 系统提示词运行时自动附加工具清单与执行规则，不再"拒绝访问本地文件"

**文档格式支持**
- PDF（pdf-parse）、PPTX/DOCX/XLSX（jszip）、PPT（Office COM 转换）、DOC（word-extractor）、XLS（SheetJS）全格式文本提取
- 旧版二进制格式识别、未知二进制 NUL 检测，提取失败给出明确原因

**其他**
- SKILL.md 格式适配（Anthropic 官方 skill 可直接挂载）+ PDF 读取 skill
- skills 路径打包回退（resources/skills）、pdf-parse 1.x require 加载修复
- 注释功能修复（CodeMirror 选中文本获取）、预览滚动修复、系统文件保护
- 打包模式改为 zip（解压即用）+ 首次启动询问桌面快捷方式
- 版本号 0.2.0

### v0.1.0（2026-08-06）

**Angelina 主题界面**
- 全面换装《明日方舟》安洁莉娜可爱风：奶油色浅色主题、玫瑰粉主色 + 天蓝点缀、粉色渐变光晕
- 空状态展示安洁莉娜「坐坐」GIF 动图，漂浮气泡/爱心/魔法棒/云朵装饰
- 左侧常驻大立绘：随对话实时状态切换动画——思考中📖看书 / 执行工具🧭探险 / 识别图片📷拍照 / 回答中🪑坐坐，并显示状态文字
- AI 消息头像动态化，思考占位显示跳动三点 + 状态提示
- 代码高亮切换为浅色主题，Markdown 样式整体适配

**Agent / 桌宠双模式**
- 新增 `chatMode` 配置（`agent` / `pet`），顶栏胶囊按钮一键切换
- 桌宠模式使用可编辑的安洁莉娜人设提示词（`petPrompt`），角色扮演 + 保留工具能力「跑腿」
- 设置 → 系统提示词页可切换模式并编辑对应提示词；切换模式自动清空会话

**图片生成提示词**
- 新增 `generate_image_prompt` 内置工具：返回可复制英文 Prompt + 中文拆解 + 使用建议
- 支持 17 种风格关键词（写实/动漫/赛博朋克/水彩/3D/国风等）与 6 种宽高比
- 系统提示词新增「图片生成规则」：需要图片时只输出提示词，不编造图片

**其他**
- 打包图标更换为安洁莉娜角色图（多尺寸 ICO）
- 修复 `3D` 对象键语法错误

### v0.0.3（2026-08-03）

**视觉辅助（双模型协作）**
- 新增 `visionAssist` 配置（`enabled` / `providerId` / `model` / `prompt`）
- 主模型不支持 vision 时，自动调用选定的视觉模型逐张识别图片，描述文本回填给主模型继续任务
- 识别指令可自定义，默认要求原文转写、公式用 LaTeX、表格用 Markdown
- 新增 `vision` 事件（start/done/error），状态栏实时显示识别进度
- 单张图片识别失败不中断整体流程，错误以文本形式告知主模型
- 设置界面新增「视觉辅助」区：开关、接口来源选择、视觉模型名、指令编辑框，实时回显实际调用目标并对无效配置告警
- `detectVision()` 抽为公共函数，关键词列表提升为模块级常量
- `ConfigStore.load()` 对 `visionAssist` 做深合并，兼容旧配置

**同一 API 双模型**
- `visionAssist` 新增 `model` 字段；`providerId` 留空表示复用主 Provider 的 baseUrl / apiKey，仅换模型名
- 新增 `resolveVisionProvider()` 统一解析接口来源与模型，解析结果强制标记 `supportsVision: true`，避免关键词误判
- 同 API 同模型时返回 undefined，防止自己调自己

**流式输出开关**
- 新增 `stream` 配置（默认 true）
- `OpenAIClient` 实现非流式请求路径，支持 `tool_calls` / `reasoning_content` 解析，并回调一次让界面拿到内容

**深度思考开关**
- 新增 `thinkingMode` 配置（`auto` / `on` / `off`）
- 同时下发 `enable_thinking`、`reasoning.enabled`、`thinking.type`，兼容主流网关
- 接口不认识参数时自动去参重试一次
- 流式解析兼容 OpenRouter 的 `delta.reasoning` 字段

**Token 消耗统计**
- 新增 `TokenUsage` 类型与 `usage` 事件
- 优先使用接口真实 `usage`；流式下自动下发 `stream_options.include_usage`
- 接口未返回时本地估算，显示时加 `~` 前缀区分
- 统计覆盖每轮工具循环、视觉辅助模型与上下文压缩摘要
- 顶栏显示会话累计，悬停查看输入/输出细分与最近一次用量；清空对话后归零

**修复**
- 主模型被误判为支持 vision 导致 404（`No endpoints found that support image input`）：新增 `isImageUnsupportedError()` 识别各网关文案，自动降级走视觉辅助路径重试（仅一次，防死循环）
- 从自动检测关键词中移除 `mimo`：`mimo-v2.5-pro` 实际不支持图片输入，属误报
- `buildUserContent()` 抽出并支持 `forceNoVision`，降级路径复用同一逻辑
- 降级时按 `role` 定位最后一条用户消息，避免上下文压缩后下标错位

### v0.0.2（2026-07-31）

**Word 文档与公式**
- 新增 `create_word_document`、`markdown_to_word`、`latex_formula_to_omml` 三个内置工具
- LaTeX → MathML（temml）→ OMML（mathml2omml）→ OOXML（jszip）纯 JS 管线，无需安装 Word
- 修复 `mml2omml` 双重转义 bug：正则 `<m:t` 误匹配 `<m:type` 导致结构标签被转义为 `&lt;...&gt;`，Word 无法打开
- 修复公式空位多余空格：trim `m:t` 文本内容，移除 `xml:space="preserve"`，清理空 `m:r` 残留
- `create_word_document` 的 `blocks` 参数从 `string` 改为 `array` 类型，消除双重 JSON 编码导致的解析失败

**Vision 图片识别**
- 新增 `supportsVision` 字段（`ProviderConfig`），支持三态：`undefined`（自动检测）/ `true`（强制支持）/ `false`（强制不支持）
- 设置界面新增「图片识别」下拉选择（自动检测 / 支持 / 不支持）
- 自动检测关键词扩充：`mimo`、`glm-4v`、`yi-vl`、`internvl`、`qwen2.5-vl` 等
- 添加 `[Vision]` 检测日志，便于排查模型识别问题

**安全**
- API Key 加密存储：Electron `safeStorage`（Windows DPAPI），`enc:v1:` 前缀，绑定用户
- 旧版明文 `apiKey` 首次启动自动迁移为密文
- 解密失败时清空 `apiKey`，不泄露错误信息
- `save()` 磁盘写密文、内存保持明文，正常使用不受影响

**上下文压缩**
- 重构 token 估算：正确处理 multipart 消息（文本 + 图片）的 token 开销
- 两阶段压缩算法：阶段一截断旧工具结果 + 剥离旧图片 base64（免 LLM），阶段二 LLM 摘要旧消息
- LLM 摘要失败自动降级返回阶段一结果，不中断当前请求
- `safeSplitIndex`：确保压缩切分点不以 `tool` 消息开头，避免 API 报错


