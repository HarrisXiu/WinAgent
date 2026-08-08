# WinAgent

 **Windows 桌面 AI 助手**。兼容 **OpenAI 格式 API** 与 **本地 Ollama**，以《明日方舟》安洁莉娜的桌宠形象陪伴聊天，同时内置**完整 Windows 工具集**（53+ 个工具）与 **LLM Wiki 个人知识库**——你只负责剪藏，AI 负责理解和沉淀。支持 **skills（含 SKILL.md 格式）** 与 **MCP** 扩展挂载，可打包为**免安装压缩包**，在不同电脑上拷贝即用。

欢迎各位大佬的评论和指导，所有评论和邮件我都会认真阅读和回复，期待与大家交流！如有兴趣也欢迎加入此项目。
邮箱(email):530313@qq.com;


## 功能特性

- **多 Provider**：OpenAI / DeepSeek / 任意 OpenAI 兼容端 / 本地 Ollama，一键切换
- **模型自动拉取**：Ollama `/api/tags`、OpenAI 兼容 `/v1/models`
- **文件/图片附件**：输入框 + 按钮选择文件和图片，图片自动以 vision 格式发送，文本文件内容内嵌；不支持 vision 的模型自动降级为路径描述
- **Vision 模型识别**：自动按模型名关键词检测（`gpt-4o`、`vision`、`vl`、`llava`、`gemini`、`claude-3`、`qwen-vl`、`glm-4v` 等），也可在设置中手动指定「支持/不支持/自动检测」
- **视觉辅助（双模型协作）**：主模型为纯语言模型时，自动调用另一个视觉模型识别图片，再把识别结果回填给主模型继续完成任务。**支持同一 API 下用两个模型**（如主模型 `mimo-v2.5-pro` + 视觉模型 `mimo-v2.5`）
- **流式输出开关**：可关闭流式，改为生成完毕后一次性返回
- **深度思考开关**：自动 / 开启 / 关闭三态，接口不认识参数时自动去参重试
- **Token 消耗统计**：顶栏实时显示会话累计 token，悬停查看输入/输出细分与最近一次用量
- **流式对话**：Markdown 渲染、代码高亮、思维链折叠、工具调用可视化
- **完整 Windows 工具集（53+ 个）**：
  - 文件：`list_directory`、`read_file`、`write_file`、`edit_file`、`multi_edit_file`、`delete_file`、`copy_file`、`move_file`、`search_files`、`find_files`、`get_file_info`、`create_directory`、`grep`
  - 系统：`list_processes`、`kill_process`、`run_command`、`get_system_info`、`take_screenshot`、`list_startup_items`、`add_startup_item`、`remove_startup_item`
  - 注册表：`registry_list`、`registry_read`、`registry_write`、`registry_delete_value`、`registry_delete_key`
  - 输入模拟：`mouse_move`、`mouse_click`、`mouse_scroll`、`key_press`、`key_combination`、`type_text`、`get_cursor_pos`、`get_screen_size`
  - 窗口：`find_windows`、`set_window_state`、`bring_window_to_front`、`close_window`
  - 网络：`http_request`、`http_download`
  - Word 文档：`create_word_document`、`markdown_to_word`、`latex_formula_to_omml`
  - 知识库：`search_knowledge_base`、`read_note`、`list_notes`、`read_raw_file`、`add_question`、`save_knowledge_output`、`lint_knowledge_base`、`merge_knowledge_pages`、`reflect_knowledge_base`
- **Word 文档生成**：直接输出 `.docx`，支持标题/段落/列表/表格/分页，数学公式以 **Word 原生可编辑公式（OMML）** 插入（非图片，双击可用公式编辑器修改）
- **Skills 挂载**：`skills/` 目录下的脚本插件（node/python/command）
- **MCP 挂载**：`mcp.json` 挂载外部 MCP server（stdio / HTTP）
- **上下文压缩**：长对话自动/手动压缩，避免超出上下文窗口
- **危险操作确认**：删除/写注册表/结束进程/执行命令/模拟输入等默认弹窗确认
- **Ollama 兼容优化**：消息格式自动清洗（content null 处理、tool_calls 结构标准化、tool 结果补 name 字段），避免 `invalid tool call arguments` 兼容性错误
- **API Key 加密存储**：`config.json` 中的 `apiKey` 经 Electron `safeStorage`（Windows DPAPI）加密存储（`enc:v1:` 前缀），密钥绑定当前 Windows 用户，配置文件拷到其他机器或用户无法解密；旧版明文首次启动自动升级为密文
- **上下文压缩（两阶段）**：阶段一免 LLM 轻量压缩（截断旧工具结果、剥离旧图片 base64），阶段二 LLM 摘要旧消息；摘要失败自动降级，不中断对话
- **便携**：数据（`config.json`、`Logs/`）保存在 exe 同级目录
- **Angelina 可爱主题**：《明日方舟》安洁莉娜主题界面——奶油色系 UI、动态角色立绘（左侧常驻，随对话状态切换「思考/执行工具/识别图片/回答」动作动画）、空状态 GIF 动图
- **单一桌宠模式（Agent 能力合并）**：AI 以安洁莉娜的角色人设陪伴聊天（人设提示词可编辑），同时拥有专业 Agent 的**完整工具能力**——读文件、操作 Windows、检索知识库，系统提示词运行时自动附加工具清单，不会"拒绝访问本地文件"
- **LLM Wiki 个人知识库（Karpathy 模式）**：基于 Andrej Karpathy `llm-wiki` 思路——**你只负责剪藏，LLM 负责理解和沉淀**。三层架构（raw 原始文件只读 / wiki 编译层 / outputs 输出），拖拽文件自动编译为 sources/concepts/entities 页面，支持概念对齐、confidence 体系、QUESTIONS 队列、LINT/REFLECT/MERGE
- **文档自动解析**：拖入 PDF / PPTX / DOCX / XLSX / PPT / DOC / XLS / Markdown / 文本，自动提取文本 → AI 分析 → 生成知识库页面（带进度条）；PPT 通过 Office COM 转换，旧版格式全覆盖
- **知识库面板**：侧边滑出，文件树分层展示（📥 raw 只读 / 📚 wiki 可编辑），中缝可拖拽调整宽度，量子粒子关系图谱
- **SKILL.md 格式支持**：除原生 `manifest.json` 外，支持 Anthropic 官方 `SKILL.md` 格式 skill，GitHub 上的 skill 可直接放入 `skills/` 目录使用
- **图片生成提示词**：`generate_image_prompt` 工具——需要图片时生成可直接复制到 Midjourney / Stable Diffusion / 即梦AI 的绘图 Prompt（支持 17 种风格、6 种宽高比），不编造图片

## 快速开始

**普通用户**：从 [Releases](https://github.com/HarrisXiu/WinAgent/releases) 下载 `WinAgent-<version>-win64.zip`，解压后双击 `win-unpacked/WinAgent.exe` 即用，无需安装。首次启动会询问是否创建桌面快捷方式。

**开发者**（需 Node.js 18+）：

```bash
git clone https://github.com/HarrisXiu/WinAgent.git
cd WinAgent
npm install
npm run dev
```

## 打包

```bash
npm run dist       # 生成 release/WinAgent-<version>-win64.zip（解压即用）
npm run dist:dir   # 只生成 release/win-unpacked/ 文件夹（不压缩，调试用）
npm run build:icon # 从 Angelina/PNG/送货.png 重新生成多尺寸 ICO 图标
```

**免安装便携**：解压 zip 得到 `win-unpacked/` 文件夹，拷到任意 Windows 电脑双击 `WinAgent.exe` 即可运行；`config.json` / `skills/` / `mcp.json` / `Logs/` / `wiki/`（知识库）在 exe 同级目录读写。

> ⚠ 注意：`config.json` 中包含加密的 ApiKey，请注意隐私保护。打包前请先关闭正在运行的应用（否则 exe/dll 被占用无法覆盖）。

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

## 文件/图片附件

- 点击输入框左侧 **+** 按钮选择文件，支持多选
- 图片显示缩略图预览，文本文件显示文件图标
- **图片**：支持 vision 的模型（`gpt-4o`、`qwen2.5-vl`、`llava` 等）直接识别；不支持的模型走视觉辅助或降级为路径描述，不会报错。可在「设置 → 图片识别」中手动覆盖（自动检测 / 支持 / 不支持）
- **文本文件**（`.txt`/`.md`/`.json`/`.js`/`.ts`/`.py` 等）：内容自动读取并拼入消息
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

## Word 文档与数学公式

直接让 Agent 生成 Word，公式以 **Word 原生可编辑公式**（OMML）写入，而非图片——在 Word 中双击即可用公式编辑器修改。

例子：

> 帮我写一份关于二次方程的数学讲义，包含求根公式和判别式，保存到桌面 quadratic.docx

### 三个工具

| 工具 | 用途 |
|------|------|
| `markdown_to_word` | Markdown 文本一键转 Word，支持 `#` 标题、`-`/`1.` 列表、`\| 表格 \|`、`$$块级公式$$`、`$行内公式$`、`---` 分页 |
| `create_word_document` | 结构化块描述（JSON 数组），精细控制排版：字体、字号、对齐、粗斜体、横向页面 |
| `latex_formula_to_omml` | 数学公式编辑器：校验 LaTeX 语法并输出 OMML，写文档前预检复杂公式 |

### 公式写法

用 LaTeX 语法，已验证支持分式、根号、上下标、积分、求和、希腊字母等：

```
行内：质能方程 $E = mc^2$ 表明…
块级：$$x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$$
```

> 实现为 `LaTeX → MathML（temml）→ OMML（mathml2omml）→ OOXML 写入 docx（jszip）`，纯 JS 无原生模块，**无需安装 Word 也能生成**。已修复 `mml2omml` 双重转义 bug 和空公式位多余空格问题。

## LLM Wiki 个人知识库

基于 Andrej Karpathy [llm-wiki](https://github.com/karpathy/llm-wiki) 思路的个人知识库，核心理念：**你只负责剪藏，LLM 负责理解和沉淀**——知识「编译一次、持续维护」，而非每次查询重新推导。

### 三层架构

```
<vault>/（默认为 exe 同级 wiki/ 目录，可在设置中修改）
├── raw/          📥 原始文件（你拥有，AI 只读）—— 拖拽/复制文件进来自动处理
│   ├── articles/ clippings/ images/ pdfs/ notes/ personal/
├── wiki/         📚 编译层（AI 维护，你可浏览/修正）
│   ├── index.md  log.md  overview.md  QUESTIONS.md   （系统文件，自动维护）
│   ├── sources/   每篇来源的摘要页（Summary/Key Points/Concepts/Contradictions）
│   ├── concepts/  概念页（中文 title + aliases + Evolution Log + confidence）
│   ├── entities/  实体页（人物/工具/机构/论文）
│   └── synthesis/ outputs/ templates/
└── outputs/      查询答案、lint 报告
```

### 使用方式

- **剪藏**：把任何文档（PDF / PPTX / DOCX / XLSX / PPT / DOC / XLS / Markdown / 文本）拖进窗口 → 自动导入 raw/ → AI 提取文本、分析内容、生成 sources/concepts/entities 页面（带进度条）。手动复制文件到 raw/ 目录也会被自动监视编译
- **浏览**：点顶栏 📚 打开知识库面板——raw 层只读预览（不可变原则），wiki 层可编辑修正；文件树分层展示，中缝可拖拽调整宽度；量子粒子关系图谱可视化
- **对话检索**：直接问"我的知识库里有什么？"/"搜索知识库中关于 X 的内容"，AI 自动调用 `search_knowledge_base` / `read_note` / `read_raw_file` 检索并溯源回答
- **记录问题**：说"我想搞清楚 X" → 加入 QUESTIONS.md 队列，之后摄入的新来源能回答时自动提示
- **健康检查**：说"检查知识库" → LINT 9 项检查（broken links / stub / SHA-256 完整性 / stale 等）
- **综合分析**：说"综合分析知识库" → REFLECT 四阶段（反向检验 / 模式扫描 / 深度合成 / Gap Analysis）
- **去重合并**：重复概念页 → AI 先与你确认方案再执行 MERGE（保留 redirect 页）

### 机制亮点

- **概念对齐**：新来源提取的概念与已有概念页做 slug/aliases/语义匹配，命中则更新（Evolution Log 追加"强化/修正"），不重复建页
- **confidence 体系**：1 来源 low → 3+ medium → 5+ 弹窗由你确认后晋升 high（你的主动背书，非计数器输出）
- **possibly_outdated**：来源超过 2 年自动标注
- **SHA-256 完整性**：每篇来源记录哈希，LINT 检测 raw 文件是否被篡改
- **个人写作**：放入 `raw/personal/` 的文章走个人写作流程（写入 My Position，不参与 confidence 计数）

## 配置文件

`config.json`（exe 同级目录，首次运行自动生成）：

```jsonc
{
  "activeProviderId": "ollama",
  "providers": [
    // apiKey 保存时自动加密为 "enc:v1:..."（DPAPI），此处展示的是内存中的明文形态
    { "id": "ollama", "label": "Ollama (本地)", "type": "ollama", "baseUrl": "http://localhost:11434", "apiKey": "", "model": "qwen2.5:32b", "supportsVision": undefined },
    // supportsVision: undefined=自动检测, true=强制支持, false=强制不支持
  ],
  "temperature": 0.3,
  "maxTokens": 4096,
  "systemPrompt": "…",
  "autoApproveTools": false,
  "compactThresholdTokens": 24000,
  "keepRecentTurns": 6,
  "skillsDir": "skills",
  "mcpConfigPath": "mcp.json",
  "visionAssist": {
    "enabled": false,        // 主模型不支持图片时，是否调用视觉模型代为识别
    "providerId": "",        // 空 = 与主模型同一 API；否则指定另一个 provider id
    "model": "",             // 视觉模型名，同一 API 双模型时必填
    "prompt": ""             // 识别指令，留空用内置默认
  },
  "stream": true,            // 流式输出
  "thinkingMode": "auto"     // 深度思考：auto / on / off
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

**API Key 加密存储**：`config.json` 中的 `apiKey` 通过 Electron `safeStorage`（Windows DPAPI）加密后以 `enc:v1:` 前缀存储，密钥绑定当前 Windows 用户，配置文件拷到其他机器或用户无法解密。内存与界面中仍为明文以便正常使用；旧版明文配置首次启动自动升级为密文。解密失败（如配置被拷到其他机器）时自动清空 `apiKey`，需用户重新填写，不会泄露错误信息。

## 技术栈

Electron + TypeScript + React + Vite + TailwindCSS。Windows 系统能力通过 Node `fs` 与 PowerShell 实现，**不依赖原生模块**，便于便携打包。

## 更新日志

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

**其他**
- `MAX_ROUNDS` 提升至 25
- Ollama 兼容优化：消息格式自动清洗（content null 处理、tool_calls 结构标准化、tool 结果补 name 字段）
