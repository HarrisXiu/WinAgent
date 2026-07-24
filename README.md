# WinAgent

 **Windows 桌面 AI Agent**。兼容 **OpenAI 格式 API** 与 **本地 Ollama**，带聊天窗口、可本地切换模型、内置完整 Windows 工具集，支持**文件/图片附件输入**，并预留 **skills（本地脚本插件）** 与 **MCP** 两种扩展挂载接口。可打包为**免安装便携 exe**，在不同电脑上拷贝即用。

## 下一步目标为构建llm wiki 当前为将来的个人知识库入口 欢迎各位大佬的评论和指导 所有评论和邮件我都会认证阅读和回复的 期待与大佬们交流如果有兴趣也欢迎加入此项目
   邮箱(email):530313@qq.com;


## 功能特性

- **多 Provider**：OpenAI / DeepSeek / 任意 OpenAI 兼容端 / 本地 Ollama，一键切换
- **模型自动拉取**：Ollama `/api/tags`、OpenAI 兼容 `/v1/models`
- **文件/图片附件**：输入框 + 按钮选择文件和图片，图片自动以 vision 格式发送，文本文件内容内嵌；不支持 vision 的模型自动降级为路径描述
- **流式对话**：Markdown 渲染、代码高亮、思维链折叠、工具调用可视化
- **完整 Windows 工具集（40+ 个）**：
  - 文件：`list_directory`、`read_file`、`write_file`、`edit_file`、`multi_edit_file`、`delete_file`、`copy_file`、`move_file`、`search_files`、`find_files`、`get_file_info`、`create_directory`、`grep`
  - 系统：`list_processes`、`kill_process`、`run_command`、`get_system_info`、`take_screenshot`、`list_startup_items`、`add_startup_item`、`remove_startup_item`
  - 注册表：`registry_list`、`registry_read`、`registry_write`、`registry_delete_value`、`registry_delete_key`
  - 输入模拟：`mouse_move`、`mouse_click`、`mouse_scroll`、`key_press`、`key_combination`、`type_text`、`get_cursor_pos`、`get_screen_size`
  - 窗口：`find_windows`、`set_window_state`、`bring_window_to_front`、`close_window`
  - 网络：`http_request`、`http_download`
- **Skills 挂载**：`skills/` 目录下的脚本插件（node/python/command）
- **MCP 挂载**：`mcp.json` 挂载外部 MCP server（stdio / HTTP）
- **上下文压缩**：长对话自动/手动压缩，避免超出上下文窗口
- **危险操作确认**：删除/写注册表/结束进程/执行命令/模拟输入等默认弹窗确认
- **Ollama 兼容优化**：消息格式自动清洗（content null 处理、tool_calls 结构标准化、tool 结果补 name 字段），避免 `invalid tool call arguments` 兼容性错误
- **便携**：数据（`config.json`、`Logs/`）保存在 exe 同级目录

## 开发运行

```bash
npm install
npm run dev
```

## 打包便携版

```bash
npm run dist
```

产物在 `release/WinAgent-<version>-portable.exe`。这是**免安装便携版**：拷到任意 Windows 电脑双击即可运行，`config.json` / `skills/` / `mcp.json` / `Logs/` 会在 exe 同级目录读写。

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

## 使用 OpenAI / DeepSeek

在“设置 → 模型 Providers”中填写 `Base URL`（需含 `/v1`）、`API Key`、`模型`。例如：

- OpenAI：`https://api.openai.com/v1`（模型 `gpt-4o` 支持图片识别）
- DeepSeek：`https://api.deepseek.com/v1`（模型 `deepseek-chat`，工具调用强且便宜，不支持图片）

## 文件/图片附件

- 点击输入框左侧 **+** 按钮选择文件，支持多选
- 图片显示缩略图预览，文本文件显示文件图标
- **图片**：支持 vision 的模型（`gpt-4o`、`qwen2.5-vl`、`llava` 等）直接识别；不支持的模型自动降级为路径描述，不会报错
- **文本文件**（`.txt`/`.md`/`.json`/`.js`/`.ts`/`.py` 等）：内容自动读取并拼入消息
- **其他文件**：传递文件名和路径信息，可配合工具操作

## 配置文件

`config.json`（exe 同级目录，首次运行自动生成）：

```jsonc
{
  "activeProviderId": "ollama",
  "providers": [
    { "id": "ollama", "label": "Ollama (本地)", "type": "ollama", "baseUrl": "http://localhost:11434", "apiKey": "", "model": "qwen2.5:32b" }
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

## 技术栈

Electron + TypeScript + React + Vite + TailwindCSS。Windows 系统能力通过 Node `fs` 与 PowerShell 实现，**不依赖原生模块**，便于便携打包。
