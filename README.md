# WinAgent

 **Windows 桌面 AI Agent**。兼容 **OpenAI 格式 API** 与 **本地 Ollama**，带聊天窗口、可本地切换模型、内置完整 Windows 工具集，支持**文件/图片附件输入**，并预留 **skills（本地脚本插件）** 与 **MCP** 两种扩展挂载接口。可打包为**免安装便携 exe**，在不同电脑上拷贝即用。

## 下一步目标为构建llm wiki 当前为将来的个人知识库入口 欢迎各位大佬的评论和指导 所有评论和邮件我都会认真阅读和回复的 期待与大佬们交流如果有兴趣也欢迎加入此项目
   邮箱(email):530313@qq.com;


## 功能特性

- **多 Provider**：OpenAI / DeepSeek / 任意 OpenAI 兼容端 / 本地 Ollama，一键切换
- **模型自动拉取**：Ollama `/api/tags`、OpenAI 兼容 `/v1/models`
- **文件/图片附件**：输入框 + 按钮选择文件和图片，图片自动以 vision 格式发送，文本文件内容内嵌；不支持 vision 的模型自动降级为路径描述
- **Vision 模型识别**：自动按模型名关键词检测（`gpt-4o`、`vision`、`vl`、`llava`、`mimo`、`gemini`、`claude-3`、`qwen-vl` 等），也可在设置中手动指定「支持/不支持/自动检测」
- **流式对话**：Markdown 渲染、代码高亮、思维链折叠、工具调用可视化
- **完整 Windows 工具集（43+ 个）**：
  - 文件：`list_directory`、`read_file`、`write_file`、`edit_file`、`multi_edit_file`、`delete_file`、`copy_file`、`move_file`、`search_files`、`find_files`、`get_file_info`、`create_directory`、`grep`
  - 系统：`list_processes`、`kill_process`、`run_command`、`get_system_info`、`take_screenshot`、`list_startup_items`、`add_startup_item`、`remove_startup_item`
  - 注册表：`registry_list`、`registry_read`、`registry_write`、`registry_delete_value`、`registry_delete_key`
  - 输入模拟：`mouse_move`、`mouse_click`、`mouse_scroll`、`key_press`、`key_combination`、`type_text`、`get_cursor_pos`、`get_screen_size`
  - 窗口：`find_windows`、`set_window_state`、`bring_window_to_front`、`close_window`
  - 网络：`http_request`、`http_download`
  - Word 文档：`create_word_document`、`markdown_to_word`、`latex_formula_to_omml`
- **Word 文档生成**：直接输出 `.docx`，支持标题/段落/列表/表格/分页，数学公式以 **Word 原生可编辑公式（OMML）** 插入（非图片，双击可用公式编辑器修改）
- **Skills 挂载**：`skills/` 目录下的脚本插件（node/python/command）
- **MCP 挂载**：`mcp.json` 挂载外部 MCP server（stdio / HTTP）
- **上下文压缩**：长对话自动/手动压缩，避免超出上下文窗口
- **危险操作确认**：删除/写注册表/结束进程/执行命令/模拟输入等默认弹窗确认
- **Ollama 兼容优化**：消息格式自动清洗（content null 处理、tool_calls 结构标准化、tool 结果补 name 字段），避免 `invalid tool call arguments` 兼容性错误
- **API Key 加密存储**：`config.json` 中的 `apiKey` 经 Electron `safeStorage`（Windows DPAPI）加密存储（`enc:v1:` 前缀），密钥绑定当前 Windows 用户，配置文件拷到其他机器或用户无法解密；旧版明文首次启动自动升级为密文
- **上下文压缩（两阶段）**：阶段一免 LLM 轻量压缩（截断旧工具结果、剥离旧图片 base64），阶段二 LLM 摘要旧消息；摘要失败自动降级，不中断对话
- **便携**：数据（`config.json`、`Logs/`）保存在 exe 同级目录

## 快速开始

**普通用户**：从 [Releases](https://github.com/HarrisXiu/WinAgent/releases) 下载 `WinAgent-<version>-portable.exe`，双击即用，无需安装。

**开发者**（需 Node.js 18+）：

```bash
git clone https://github.com/HarrisXiu/WinAgent.git
cd WinAgent
npm install
npm run dev
```

## 打包便携版

```bash
npm run dist
```

产物在 `release/WinAgent-<version>-portable.exe`。这是**免安装便携版**：拷到任意 Windows 电脑双击即可运行，`config.json` / `skills/` / `mcp.json` / `Logs/` 会在 exe 同级目录读写。
## 注意：config.json中包含ApiKey 请注意隐私保护

> 提示：`npm run pack` 生成免打包的解压目录（`release/win-unpacked/`），便于调试。

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
- **图片**：支持 vision 的模型（`gpt-4o`、`qwen2.5-vl`、`llava`、`mimo-v2.5` 等）直接识别；不支持的模型自动降级为路径描述，不会报错。可在「设置 → 图片识别」中手动覆盖（自动检测 / 支持 / 不支持）
- **文本文件**（`.txt`/`.md`/`.json`/`.js`/`.ts`/`.py` 等）：内容自动读取并拼入消息
- **其他文件**：传递文件名和路径信息，可配合工具操作

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
  "mcpConfigPath": "mcp.json"
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

### v1.0.0（2026-07-31）

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
