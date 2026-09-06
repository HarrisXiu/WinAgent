# WinAgent 项目功能与资产盘点报告

> 生成日期：2026-09-02
> 用途：作为项目重新进行 dsh 插件化改造的参考底稿。所有已实现功能、核心资产、技术决策均在此归档。

---

## 一、项目概览

| 项 | 值 |
|---|---|
| 项目名 | WinAgent（Windows AI Agent 桌宠 + 知识库） |
| 架构 | Tauri v2（Rust 后端 + React 前端） |
| 前框架 | Electron（已完成 → Tauri 迁移） |
| 核心定位 | Windows 桌面 AI 助手：安洁莉娜人设桌宠 + 完整 Agent 工具能力 + Obsidian 兼容个人知识库 |
| 双窗口 | 主窗口（桌宠聊天）+ 独立 Wiki 窗口（知识库管理） |

### 目录结构

```
WinAgent/
├── src-tauri/src/           # Rust 后端
│   ├── agent/               # Agent 会话循环 + 上下文压缩
│   ├── commands/            # Tauri IPC 命令层（config/tools/agent/wiki）
│   ├── config/              # ConfigStore 配置持久化
│   ├── docx/                # Word 文档生成（PowerShell COM）
│   ├── llm/                 # OpenAI 兼容客户端（流式/非流式/thinking 参数）
│   ├── mcp/                 # MCP 协议客户端管理器
│   ├── skills/              # Skill 加载器（manifest.json + 脚本执行）
│   ├── tools/               # 内置工具注册表（11 类文件，~55 个工具）
│   ├── wiki/                # 知识库七模块
│   │   ├── vault.rs         # VaultManager（Obsidian 兼容 vault）
│   │   ├── search.rs        # SearchIndex（全文检索 + 打分）
│   │   ├── graph.rs         # GraphEngine（关系图谱）
│   │   ├── ai_pipeline.rs   # AiPipeline（AI 分析/摄入/自定义分析）
│   │   ├── workflow.rs      # LINT / REFLECT / MERGE 工作流
│   │   ├── ingest.rs        # INGEST 摄入流水线
│   │   └── contract.rs      # CLAUDE.md 行为契约读取
│   └── types.rs             # 全部共享类型
├── src/renderer/src/        # React 前端
│   ├── App.tsx              # 主窗口（桌宠聊天 + 附件 + 拖拽）
│   ├── tauri-bridge.ts      # window.winagent API 桥（替代 Electron preload）
│   ├── lib/useAgent.ts      # Agent 事件流 hook
│   └── components/
│       ├── Message.tsx      # 聊天消息（markdown 渲染 + 工具卡片）
│       ├── ToolCard.tsx     # 工具调用展开卡片
│       ├── Settings.tsx     # 设置面板（7 个 tab）
│       └── wiki/            # Wiki 窗口组件（13 个）
└── dsh-plugin/              # 旧 dsh 插件尝试（已推送 GitHub，将重做）
```

---

## 二、Agent 核心（src-tauri/src/agent/）

### AgentService（`agent/mod.rs`，417 行）

- **会话循环**：`process()` 最大 25 轮工具调用（`MAX_ROUNDS = 25`）
- **工具执行**：同步注册表 `ToolRegistry::execute()`，dangerous 工具经 `pending_confirms`（oneshot channel）弹前端确认框
- **视觉降级**：主模型不支持图片时自动走 `VisionAssist`（换模型描述图片→文本回填）；`is_image_unsupported_error()` 识别 API 报错自动降级重试
- **Vision 检测**：`detect_vision()` 按模型名关键词表（gpt-4o/vl/gemini/claude-3/qwen-vl/glm-4v 等）自动判断
- **Token 用量**：`report_usage()` 逐轮上报 last/session 用量事件
- **中止**：`stop()` 经 watch channel 中断流式请求
- **系统提示词**：`system_message()` = `pet_prompt`（安洁莉娜人设）+ 能力说明（自动注入工具名清单 + 执行规则 + 图片生成规则 + 文件编辑规则 + Word 文档规则）

### ContextManager（`agent/context.rs`）

- `estimate_tokens()`：粗估 chars/3，图片固定 765 token
- `needs_compact()`：超过 `compact_threshold_tokens` 触发压缩
- `compact()`：AI 摘要旧对话 → 摘要 system 消息 + 保留最近 `keep_recent_turns` 轮

---

## 三、LLM 客户端（src-tauri/src/llm/mod.rs）

- `OpenAIClient::chat_stream()`：OpenAI 兼容流式/非流式对话，支持 tool calls 回传
- **深度思考参数**：`enable_thinking` / `reasoning` / `thinking` 三种字段名自适应下发，API 不识别时自动去参重试
- `fetch_models()`：拉取 provider 模型列表
- **Provider 多配置**：openai 兼容 / ollama 两类；`AppConfig.activeProviderId` 切换

---

## 四、内置工具（src-tauri/src/tools/，~55 个）

> 注册模式：`ToolRegistry`（HashMap + `Arc<dyn Fn>` executor），`tool()` 辅助函数定义 schema（name/description/props/required/dangerous）。`initialize()` 时统一打 `source = "builtin"` 标签。

### file_tools（13 个）
`list_directory` `read_file` `write_file` `edit_file` `multi_edit_file` `delete_file` `copy_file` `move_file` `search_files` `find_files` `get_file_info` `create_directory` `grep`

### system_tools（13 个）
`get_system_info` `list_processes` `kill_process` ⚠️ `run_command` ⚠️ `take_screenshot` `list_startup_items` `add_startup_item` ⚠️ `remove_startup_item` ⚠️ `registry_list` `registry_read` `registry_write` ⚠️ `registry_delete_value` ⚠️ `registry_delete_key` ⚠️

### input_tools（8 个，全部 dangerous）
`type_text` `key_press` `key_combination` `mouse_click` `mouse_move` `mouse_scroll` `get_cursor_pos` `get_screen_size`

### window_tools（4 个）
`find_windows` `set_window_state` `bring_window_to_front` `close_window`

### http_tools（2 个）
`http_request`（GET/POST/PUT/DELETE + headers + body）`http_download`

### docx_tools（4 个）
- `doc_to_markdown`：PowerShell + Word COM 提取标题/列表/表格 → Markdown（`r#######"..."#######` 原始字符串嵌入 PS 脚本，`===DOC2MD_START/END===` 定界输出）
- `create_word_document`：PowerShell COM 精细排版生成 Word
- `markdown_to_word`：Markdown 风格 → Word
- `latex_formula_to_omml`：LaTeX 公式 → Word OMML

### pdf_tools（1 个）
- `pdf_to_markdown`：调 Python + PyMuPDF（`pymupdf`/`fitz` 双 import fallback），按字号/粗体识别标题层级，识别 bullet/编号列表，页间 `---`；Python 路径双 fallback（`python` → `Python312\python.exe` 绝对路径）

### image_tools（2 个）
`generate_image_prompt`（MJ/SD 绘图提示词模板）`take_screenshot`（base64 返回）

### registry_tools（2 个，占位）
`list_tools` `reload_tools`（实际由 Tauri command 处理）

### wiki_tools（9 个，占位桥接）
`search_knowledge_base` `read_note` `list_notes` `read_raw_file` `add_question` `save_knowledge_output` `lint_knowledge_base` `merge_knowledge_pages` `reflect_knowledge_base`
> ⚠️ 这些是 schema 占位，真实逻辑在 `commands/wiki.rs` 中通过 app state（VaultManager/SearchIndex/GraphEngine）执行。

---

## 五、知识库系统（src-tauri/src/wiki/）

### VaultManager（`vault.rs`，772 行）
- **Obsidian 兼容 vault**：目录结构 `raw/{articles,clippings,images,pdfs,notes,personal}` + `wiki/{sources,concepts,entities,outputs}` + `index.md`/`log.md`/`overview.md`/`QUESTIONS.md`
- Frontmatter 解析/序列化、wikilink 提取、slugify、笔记 CRUD、开放问题管理、日志追加
- `flatten_notes()` 树→平铺

### SearchIndex（`search.rs`）
- 全文检索：标题匹配 ×10/词 ×5、tag ×3、正文词频 ×0.5、AI 摘要 ×2 加权打分
- 最佳片段截取（`make_snippet` 200 字）

### GraphEngine（`graph.rs`）
- 节点 = 笔记，边 = wikilink（weight 1.0）+ 共享 tag（weight 0.5×count）
- `get_neighborhood()` BFS 半径查询子图

### AiPipeline（`ai_pipeline.rs`，660 行）
- **内部可变共享**：`Arc<AiPipeline>` 无锁共享，`cancel_epoch`（watch channel）实现分析中取消
- `complete_json()`：平衡花括号扫描提取 JSON + 失败一次自修复重试
- `analyze()`：单笔记 AI 分析 → tags(≤8)/summary/relations(≤5，target 必须逐字取自候选)/suggestions
- `ingest_source()`：来源文件分析 → slug/title/summary/keyPoints/concepts(含 matchSlug 去幻觉校验)/entities/contradictions/answeredQuestions/language/canonicalSource
- `custom_analyze()`：用户自定义分析要求 → summary + report + analysisTags
- 按笔记类型（source/concept/entity/raw）注入差异化提示词规则

### Ingest 流水线（`ingest.rs`，655 行）
- `run_ingest()`：读原文（md/txt/pdf[PyMuPDF]/docx[zip+xml]/xlsx[calamine]）→ AI 分析 → 建/更新 source 页 → 建/更新 concept 页（matchSlug 合并已有）→ 建/更新 entity 页 → 回答开放问题 → 更新搜索索引 → 重建图谱 → 发进度事件
- 批量摄入：`ingest_batch_start/continue/abort` + confidence ≥5 来源需用户确认（`confirm_high`）

### Workflow（`workflow.rs`）
- **LINT**（9 项检查）：broken-wikilink / stub(<100字) / no-tags / no-ai-summary / orphan / hash-changed(SHA-256 对比 raw_hash) / duplicate-title / no-confidence / stale-index → `wiki/outputs/lint-report.md`
- **REFLECT**：AI 综合分析（反向检验/模式扫描/Gap Analysis）→ `wiki/outputs/reflect-report.md`
- **MERGE**：合并重复概念/实体页

### Contract（`contract.rs`）
- 读取 vault 内 `CLAUDE.md` 行为契约指定章节，注入 AI 分析提示词

---

## 六、Skills 与 MCP

### SkillLoader（`skills/mod.rs`）
- `load_skills(dir)`：扫 manifest.json（name/description/params/entry）注册为 tool（source=`skill`）
- `execute_skill(script_path, args)`：spawn 脚本进程执行

### McpManager（`mcp/mod.rs`）
- `load(config_path)`：读 MCP server 配置，连接拉取 tool schema 注册（source=`mcp`）
- `dispose()`：断开全部连接

---

## 七、配置体系（types.rs AppConfig）

- `providers[]`：多 Provider（label/type/baseUrl/apiKey/model/supportsVision auto|yes|no）
- `activeProviderId`
- `visionAssist`：enabled/providerId(空=同 API 换模型)/model/prompt
- `temperature` `maxTokens` `stream` `thinkingMode`(auto/on/off)
- `petPrompt`（人设提示词）
- `skillsDir` `mcpConfigPath` `vaultPath`
- `theme`：mode(light/dark/auto) + accent + accent2（colord 自动推导色阶）
- `autoApproveTools`（危险操作免确认）
- `compactThresholdTokens` `keepRecentTurns`

---

## 八、前端（React + Tailwind + lucide-react）

### 主窗口
- **桌宠动画**：5 状态 GIF（idle 坐着/think 看书/tool 探险/vision 拍照/talk 说话）+ 贴图云朵/泡泡/爱心
- `useAgent` hook：`agent:event` 流式渲染、tool 卡片、confirm 弹窗、usage 统计
- 附件：图片（base64→vision）、文本文件预读
- 拖拽：Tauri 原生 `onDragDropEvent` → 自定义事件桥（HTML5 drop 在 Tauri Windows 下收不到路径）
- Wiki 拖入进度条（`wiki:ingest:progress` 事件，done 5s 渐隐）

### Settings（7 tab）
models（Provider CRUD + 拉取模型 datalist）/ vision / generation / theme（拾色器+实时预览+防抖保存）/ system（人设编辑）/ advanced（skillsDir/mcpConfigPath/vaultPath）/ tools（builtin/skill/mcp 分组标签墙）

### Wiki 窗口（13 组件）
WikiWindowApp（入口）/ WikiLayout / WikiSidebar（文件树）/ FileExplorer / CodeMirrorEditor（编辑器）/ MarkdownPreview / WikiRightPanel / AIPanel（AI 分析建议）/ BacklinksPanel / TagPanel / AnnotationPanel（批注）/ GraphView（图谱）/ ConfirmHighDialog / ImportAnalyzeDialog

---

## 九、Tauri IPC 命令（lib.rs，约 55 个 invoke handler）

config_get/save/data_dir、pick_directory、read_file、tools_list/reload、models_fetch、agent_send/stop/reset/compact/confirm_reply、wiki 全套（window/vault/notes/links/tags/search/graph/ai/ingest(batch)/workflow(lint/reflect/merge/query)/import(url/file/analyze)/analysisTags/concept/attachments/annotations）

---

## 十、关键技术决策（dsh 插件化必读）

1. **PowerShell 嵌入**：Rust 原始字符串定界符必须比脚本内最大 `#` 串多（本项目遇到 `"######` 需 `r#######`）；避免 `format!` + `{{}}`，改用 `__PLACEHOLDER__` + `.replace()`
2. **PDF 解析**：放弃 Rust `pdf-extract` crate（已从 Cargo.toml 移除），改用 Python + PyMuPDF 子进程；Python 调用需双路径 fallback（`python` stub 问题 → WindowsApps 假 python，实际在 `AppData\Local\Programs\Python\Python312`）
3. **Wiki 工具双轨**：schema 在 `tools/wiki_tools.rs`（供 LLM function calling），真实执行在 `commands/wiki.rs`（需要 app state）。dsh 插件化时必须保持此分离或统一注入 state
4. **工具 source 标签**：`initialize()` 插入时必须设 `source="builtin"`，否则前端按 source 分组为空（曾出 bug）
5. **AiPipeline 无锁取消**：`&self` + `watch<u64>` cancel_epoch 是并发取消的核心模式
6. **Tauri 拖拽**：Windows 下 HTML5 drop 拿不到路径，必须用 `onDragDropEvent` 桥
7. **vision 降级链**：Multipart 发送 → API 报不支持 → 自动转 VisionAssist 描述 → 文本重发

---

## 十一、dsh-plugin 旧资产（已废弃，GitHub 归档）

- 仓库：https://github.com/HarrisXiu/WinWIKIAgent-dsgplugin.git（commit 923f126）
- 内容：`src/*.ts`（TS 源码镜像）+ `lib/*.js`（编译产物）+ `assets/skills|ui` + `cordis.patch.yml`
- 本次将**重新设计插件化**，旧结构仅作参考

---

## 十二、dsh 插件化改造建议清单

- [ ] 明确 dsh 宿主 API surface（哪些能力由宿主提供：LLM 调用/配置/UI 容器）
- [ ] 工具层抽离：`ToolRegistry` + 55 工具 → 插件可注册的独立模块，PowerShell/Python 子进程调用是纯函数可直迁
- [ ] Wiki 层抽离：七模块中 vault/search/graph 是纯 Rust 逻辑可打包；ai_pipeline/ingest 依赖 LLM 客户端需对接宿主
- [ ] Agent 循环：25 轮 + confirm + compact 逻辑依赖宿主事件系统
- [ ] 前端：Wiki 13 组件 + Settings 可作为插件 UI 挂载；拖拽桥依赖 Tauri，dsh 环境需替代方案
- [ ] Python(PyMuPDF)/Word COM 依赖需在插件安装时检测并提示
