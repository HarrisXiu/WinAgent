# WinAgent 现状能力盘点（代码审计，工作树状态，2026-11-03）

> 说明：本笔记是纯静态代码审计，未构建、未运行任何仓库代码；「Cited Findings」是读代码得到的事实，「Inferences」是据此推出但未实测的判断。来源一律以 `相对仓库根的路径:行号` 标注（代替 URL），仓库根为 `C:\Users\53031\Desktop\WinAgent`。行号对应当前含未提交改动的工作树。`config.json` 的值未读取。grep 均排除了 `node_modules`、`lib`（编译产物）、`out`、`release`、`third-party`。文件名简写均指仓库内唯一的同名文件：`AgentService.ts`、`ContextManager.ts`、`ConversationStore.ts` 在 `dsh-plugin/src/agent/`；`OpenAIClient.ts`、`TaskChat.ts`、`OutputLimit.ts` 在 `dsh-plugin/src/llm/`；`ConfigStore.ts` 在 `dsh-plugin/src/config/`；`ToolRegistry.ts`、`fileTools.ts`、`systemTools.ts`、`inputTools.ts`、`windowTools.ts`、`httpTools.ts`、`officeTools.ts`、`registryTools.ts`、`wikiTools.ts` 在 `dsh-plugin/src/tools/`；`SkillLoader.ts` 在 `dsh-plugin/src/skills/`；`McpManager.ts` 在 `dsh-plugin/src/mcp/`；`RuleService.ts`、`KnowledgeRetriever.ts`、`SearchIndex.ts`、`IngestionService.ts`、`DetailedAnalysis.ts`、`WorkspaceStore.ts`、`WorkflowService.ts`、`wiki-host.ts`、`contract.ts` 在 `dsh-plugin/src/wiki/`；`bootstrap.ts`、`server.ts`、`services.ts` 在 `dsh-plugin/src/`；`shared/types.ts` 指 `dsh-plugin/src/shared/types.ts`；`App.tsx` 在 `src/renderer/src/`；`Message.tsx`、`Settings.tsx`、`ToolCard.tsx` 在 `src/renderer/src/components/`；`useAgent.ts` 在 `src/renderer/src/lib/`。

## 1. Agent 循环：如何运行？最大轮数、重试、流式、取消、并行工具调用、后台任务

### Takeaway
单会话、单任务、串行工具执行的经典 while 循环（上限 25 轮），流式和思考流做得扎实，针对网关差异的「降级重试」很细；但没有通用的网络/限流重试和请求超时，工具不可取消，主循环也没有处理 `finish_reason=length`。

### Cited Findings
**循环主体**
- 入口 `AgentService.process()`；上限常量 `MAX_ROUNDS = 25`，循环为 `for round 1..25` — `dsh-plugin/src/agent/AgentService.ts:13`、`:515`、`:567`
- 每轮顺序：检查 abort → 需要时压缩 → 重建 system 消息并追加规范 → 取工具清单 → `chatStream` → 记录助手消息 → 无工具调用则结束，否则执行工具后进入下一轮 — `AgentService.ts:568-583`、`:587-602`、`:653-686`、`:692-732`
- 达到 25 轮后循环自然退出，直接发 `done`，没有任何「已达上限」提示 — `AgentService.ts:772-773`
- 进入循环前会解析规范（`rules.resolve`）并做自动 RAG；专题任务没有证据时不调用模型，直接返回固定回答 — `AgentService.ts:524-526`、`:543-555`
- 桌面主进程在每次发送前先探测模型输出上限并写回 `maxTokens`（默认开启 `autoMaxTokens`）— `src/main/index.ts:533-547`

**流式**
- 默认 `stream: true`，可在设置关闭（`dsh-plugin/src/config/ConfigStore.ts:155`）；手写 SSE 解析，同时分发正文和思考增量（`reasoning_content` / `reasoning`），累积分片的 tool_calls，并请求 `stream_options.include_usage` — `dsh-plugin/src/llm/OpenAIClient.ts:205`、`:242-305`
- 事件流类型：round / assistant_delta / reasoning_delta / assistant_message / tool_call / tool_result / compact / vision / knowledge / rules / rule_report / usage / error / done — `dsh-plugin/src/shared/types.ts:253-267`

**重试与降级（全部是特定错误的单次重试）**
- 网关不认识思考参数：去参重试一次 — `OpenAIClient.ts:170-179`
- HTTP 400 且可解析出输出上限：记住上限后重试一次 — `OpenAIClient.ts:222-231`
- 模型拒收图片：历史中的图片降级为视觉辅助描述或文字提示后重试一次 — `AgentService.ts:606-619`
- 模型拒收 PDF 直传：剥离 file part，改提示用工具读取后重试一次 — `AgentService.ts:621-633`
- 后台任务思考耗尽预算：加 16000 余量重试一次 — `dsh-plugin/src/llm/TaskChat.ts:24`、`:83-87`
- 规范检查未通过且无产物：追加反馈消息自动修正至多 1 次 — `AgentService.ts:679-683`
- 网络错误、429、5xx 没有重试：直接抛出并结束本轮（发 `error` 事件）— `OpenAIClient.ts:217-220`、`:231`；`AgentService.ts:774-777`。在 `dsh-plugin/src/llm`、`agent` 中 grep `backoff|retry|retries` 无命中
- 对话请求没有超时：`fetch` 只带用户 abort 信号；15s/12s 超时只用在模型列表与输出上限探测 — `OpenAIClient.ts:211-216`、`:367`；`dsh-plugin/src/llm/OutputLimit.ts:44`

**主循环的弱点（对比 taskChat 的防线）**
- 判定结束只看 `finishReason !== 'tool_calls' || toolCalls.length === 0`，`length` 截断被当作正常完成，空正文也无防线 — `AgentService.ts:674-686`。而 taskChat 对截断/空正文都会抛错 — `TaskChat.ts:83-97`
- 助手消息在上述判断之前已带 tool_calls 入历史；如果 finish_reason 不是 `tool_calls` 但有工具调用，这些调用不会执行也没有结果 — `AgentService.ts:653-674`
- 工具参数 JSON 解析失败时，历史中改写为 `{}`，并以空参数继续执行工具，不把解析错误反馈给模型 — `AgentService.ts:662-668`、`:703-708`
- `hasArtifacts` 靠工具名正则判定：`/write|create|save|docx|pdf|execute|shell|python|powershell/` — `AgentService.ts:722`

**取消**
- `stop()` 触发 AbortController；abort 只在轮次开头检查，并传给 `chatStream`、视觉识别、规范检查 — `AgentService.ts:178-180`、`:568`、`:594`、`:343`、`:676`
- 主进程 `agent:stop` 同时把待决确认全部按拒绝处理 — `src/main/index.ts:581-585`
- 工具执行不可取消：`Tool.run(args)` 没有 signal 参数，`registry.execute` 也不传；工具 for 循环内部不检查 abort — `dsh-plugin/src/tools/types.ts:8`、`dsh-plugin/src/tools/ToolRegistry.ts:95-104`、`AgentService.ts:692-732`
- 压缩的 `taskChat` 调用也没传 signal — `dsh-plugin/src/agent/ContextManager.ts:123-130`

**并行工具调用**
- 模型一次返回多个调用时按顺序 `await` 执行 — `AgentService.ts:692`、`:721`。`Promise.all` 在 agent 目录只出现于会话列表读取 — `dsh-plugin/src/agent/ConversationStore.ts:15`。请求体不设 `parallel_tool_calls`，只有 `tool_choice:'auto'` — `OpenAIClient.ts:200-203`

**后台任务**
- 同一时刻只跑一个 Agent 任务：`process` 重入抛错，主进程 `agentBusy` 拒绝发送，没有排队 — `AgentService.ts:516`；`src/main/index.ts:292`、`:566`
- 「查看」与「运行」分离：任务运行时可切到其他对话查看或起草，任务继续并在结束后落盘（未提交的新功能）— `src/main/index.ts:282-283`、`:556-562`；`src/renderer/src/lib/useAgent.ts:45-49`、`:211-225`；`src/renderer/src/App.tsx:645`
- Wiki 导入是独立的后台作业：按文件并行、可单独取消、片段级缓存可续跑，重启后把 running 标记为 interrupted — `dsh-plugin/src/wiki/IngestionService.ts:11-34`、`:94`；`dsh-plugin/src/wiki/DetailedAnalysis.ts:37-38`；`dsh-plugin/src/wiki/WorkspaceStore.ts:76-80`；测试 `tests/wiki-workspace.test.cjs:118`、`:218`、`:225`
- 「重新生成」靠发送前的会话内存快照回滚（只在本次启动内有效）— `src/main/index.ts:301-302`、`:572-580`

### Inferences
- 点停止后，同一批次里剩余的工具调用仍会依次执行；其中的危险工具会再次弹确认框（`clearPendingConfirms` 只清已挂起的），开了自动放行则直接执行。未实测。
- 主循环在 `length` 截断时可能静默交付不完整的回答；带残缺 tool_calls 的助手消息在严格网关上可能使下一次请求报错。这是 v0.5.1 事故（`TaskChat.ts:4-8`）同类问题在主循环上的遗留缺口。
- 没有超时意味着流式中途卡死时任务会一直挂住，直到用户手动停止。
- `hasArtifacts` 的正则会漏掉 `edit_file`、`multi_edit_file`、`run_command`、`office_convert`，又会把只读的 `read_pdf`、`render_pdf_page` 和 `create_directory` 算成产物；算成产物时规范修正循环被跳过（`AgentService.ts:679`）。
- 视觉/PDF 降级重试用 `continue` 占用一个轮次编号，影响很小。

### Gaps
- 未实测不同网关在残缺 tool_calls 下的真实行为，也未测量停止按钮的实际延迟。

## 2. 子代理 / 多代理：是否存在？有没有委派或 planner？

### Takeaway
不存在。整个应用只有一个 `AgentService` 实例，一条历史，没有委派工具、没有 planner，也没有模型路由。唯一的「第二模型」是视觉辅助。

### Cited Findings
- 在 `dsh-plugin/src src scripts tests skills` 中 grep `subagent|sub_agent|sub-agent|multi.?agent|delegate|planner|orchestrat|spawn_agent|task_tool`：零命中
- 在 `dsh-plugin/src src/renderer/src src/main` 中 grep `todo_write|update_plan|write_todos|todowrite|\bplan\b`：零命中
- 核心装配只创建一个 agent — `dsh-plugin/src/bootstrap.ts:101`；历史是实例字段 — `AgentService.ts:135`
- 关于多步任务只有 system prompt 里的一句规则：逐步执行并报告每步结果 — `AgentService.ts:217`
- 视觉辅助模型是唯一可单独配置的第二模型（`visionAssist.providerId/model`）— `AgentService.ts:51-64`、`:311-369`；`ConfigStore.ts:149-154`
- 压缩、规范编译/检查都使用当前激活的 provider，没有「便宜模型」路由配置 — `AgentService.ts:572`、`:676`；`src/main/index.ts:718`
- `AgentService` 从服务层导出，类本身可以再实例化，`abort`、`history` 都是实例字段 — `dsh-plugin/src/services.ts:9`；`AgentService.ts:135-136`

### Inferences
- 从类结构看，并行子代理的最小实现是多个 `AgentService` 实例共用一个 `ToolRegistry`，但确认弹窗 `confirm` 是单槽状态（`useAgent.ts:56`），事件也没有 agent 标识（`shared/types.ts:253-267`），界面和事件都需要改。

### Gaps
- 无。

## 3. 工具面：每次请求发多少工具？是否全量？有无延迟加载或 tool search？skills 和 MCP 如何加载？

### Takeaway
默认每轮全量发送约 62 个工具的完整 schema（55 内置 + 7 skill，MCP 另加），工具名还在 system prompt 里再列一遍。没有延迟加载和 tool search。专题任务是唯一的裁剪：只留 4 个输出工具。

### Cited Findings
**数量（从源码逐个数 `schema` 块）**
- 内置 55 个：文件 13、系统 8、注册表 5、输入 8、窗口 4、HTTP 2、Office 4、Wiki 10、语音 1 — `dsh-plugin/src/tools/fileTools.ts`、`systemTools.ts`、`registryTools.ts`、`inputTools.ts`、`windowTools.ts`、`httpTools.ts`、`officeTools.ts`、`wikiTools.ts`、`dsh-plugin/src/voice/voiceTools.ts`；注册见 `ToolRegistry.ts:43-46`
- 默认 skill 7 个（首次运行播种到数据目录）：`read_docx`、`read_pdf`、`render_pdf_page`、`extract_pdf_images`、`read_pptx`、`read_xlsx`、`hello` 示例 — `dsh-plugin/assets/skills/`；`dsh-plugin/src/bootstrap.ts:54-75`
- 合计 62 与 dsh-one 验证记录一致 — `dsh-one/WinAgent-插件验证记录.md`（第 6 行）。README 和主进程注释仍写「53+」— `README.md:29`、`src/main/index.ts:4`
- 根目录 `skills/` 不是应用实际加载的目录：运行时从数据目录加载，种子来自 `dsh-plugin/assets/skills`；根目录是较早版本副本 — `bootstrap.ts:57-58`、`:106-107`；`dsh-one/WinAgent-插件分类说明.md:20`

**发送方式**
- `getSchemas()` 返回全部工具，每轮传入请求体 — `ToolRegistry.ts:74-76`；`AgentService.ts:583`、`:593`；`OpenAIClient.ts:200-203`
- system prompt 还逐一列出工具名 — `AgentService.ts:198`、`:215`
- 专题任务把工具裁剪到 `write_file`、`markdown_to_docx`、`write_xlsx`、`write_pptx`，并在执行时拦截模型请求的其他工具 — `AgentService.ts:583`、`:696-701`；测试 `tests/wiki-workspace.test.cjs:99-116`
- 在 `dsh-plugin/src src scripts tests skills` 中 grep `tool_search|toolsearch|deferred|lazy.?load|defer_loading`：零命中
- 粗算内置 schema 约 14,337 字符（去空白，TS 源码，临时脚本静态提取），按项目自己的 `字符/3` 估算约 4,800 token，不含 skill 与 MCP — 估算口径见 `ContextManager.ts:21`
- README 自己承认工具数带来的问题：小模型在 40+ 工具场景容易「忘记」或「编造」工具名 — `README.md:101`

**Skills**
- 两种格式：`manifest.json`（原生）和 `SKILL.md`（frontmatter）— `dsh-plugin/src/skills/SkillLoader.ts:67-90`
- 每个 skill 注册成一个函数工具。SKILL.md 的描述内嵌正文前 200 字；有 `entry` 就跑脚本（stdin JSON → stdout），没有就在调用时返回 SKILL.md 全文 — `SkillLoader.ts:121-136`
- `execSkill` 没有超时，子进程继承 `process.env` — `SkillLoader.ts:30-50`；`dsh-plugin/src/platform.ts:27-34`
- `dangerous` 默认不设，即默认不弹确认 — `SkillLoader.ts:100`、`:118`
- 同名工具用 `Map.set` 静默覆盖 — `ToolRegistry.ts:25-27`；dsh-one 的扩展加载器才对重名报错 — `scripts/dsh-one/extensions.cjs:13-16`
- 可追加目录 `skillsDirs`，界面页「Skills 与 MCP」支持添加与重载 — `bootstrap.ts:111-114`；`src/main/index.ts:503-507`；`src/renderer/src/components/workbench/ToolsWorkspace.tsx`
- `skills/README.md` 只写了 manifest.json 格式，没有提 SKILL.md — `skills/README.md:3`

**MCP**
- 手写客户端，协议版本 `2024-11-05`，只调用 `initialize`、`tools/list`、`tools/call` — `dsh-plugin/src/mcp/McpManager.ts:24`、`:143-149`、`:161`
- 传输：stdio（30s 超时）和无状态 HTTP POST（只收 JSON，无超时）— `McpManager.ts:32-96`、`:98-124`。代码里没有 SSE、会话 ID、OAuth 处理，没有 resources / prompts / list_changed
- 启动时串行连接全部启用的 server 并全量注册 — `McpManager.ts:138-176`；`bootstrap.ts:132`
- MCP 工具一律 `dangerous: true`，命名 `mcp__<server>__<tool>` — `McpManager.ts:152`、`:159`
- 非文本内容被 `JSON.stringify` 塞进文本 — `McpManager.ts:163-165`
- 默认 `mcp.json` 只有两个 disabled 示例 — `mcp.json`；`bootstrap.ts:80-88`

### Inferences
- 没有分层加载：每次请求（包括只是闲聊）都要付全部 schema 的 token；启用多个 MCP server 后问题放大。
- 只读 MCP 工具也要逐次确认，容易造成确认疲劳，并把用户推向全局自动放行。
- MCP 的 HTTP 传输是早期简化实现，对要求 Streamable HTTP 会话或 OAuth 的远程 server 大概率不兼容（未实测）。
- 一个挂起的 MCP server 启动时可能拖慢启动，每次请求 30s 超时。

### Gaps
- 未读取用户实际数据目录（`%APPDATA%\com.winagent.app`），用户机器上实际加载的 skill、MCP 数量未知。
- token 数是粗算，不是真实 tokenizer 结果。

## 4. 上下文管理：压缩阶段、提示缓存意识、token 预算、taskChat 后台调用路径

### Takeaway
有两阶段压缩和一条很成熟的后台调用防线（taskChat），但 token 估算是粗糙的字符/3，只算历史，阈值固定且和模型上下文窗口无关，完全没有提示缓存意识。

### Cited Findings
**压缩**
- 触发：每轮开头 `estimateTokens(history) > compactThresholdTokens`，默认 24000，保留 6「轮」— `AgentService.ts:570-576`；`ContextManager.ts:59-61`；`ConfigStore.ts:145-146`
- 估算：`字符/3`，图片固定 800，PDF 固定 4000 — `ContextManager.ts:6`、`:20-41`
- 估算只算历史，不算 system prompt、工具 schema、规范块 — `ContextManager.ts:59-61`
- 阶段一（不调 LLM）：旧工具结果截到 500 字符，剥离旧知识注入块和旧图片/PDF；降到阈值 80% 以下就结束 — `ContextManager.ts:76-103`
- 阶段二（LLM）：旧消息压成一条 `system` 角色的「历史摘要」，输入保留尾部 40000 字符，输出 1024 token；失败退回阶段一结果 — `ContextManager.ts:105-139`；测试 `tests/task-chat.test.cjs:73`
- 切分保证不把 tool 消息与其 tool_calls 拆开 — `ContextManager.ts:47-51`
- `keep = keepRecentTurns * 2` 实际是消息数，不是轮数；历史条数不够多时直接返回 — `ContextManager.ts:70-71`
- 手动压缩：`/compact` 与工具栏按钮 — `src/renderer/src/App.tsx:46-48`、`:607`；`src/main/index.ts:593-598`
- 单个工具结果没有统一上限：`run_command` 全量返回 stdout/stderr；`read_file` 默认 20000 字符；`http_request` 截 20000 字符 — `dsh-plugin/src/tools/systemTools.ts:86-90`；`fileTools.ts:86-92`；`httpTools.ts:39-40`
- 单轮工具图片上限 6 张 — `AgentService.ts:16`、`:735-739`
- 规范块每轮重新注入，不随压缩丢失；超过 48000 字符直接报错，不静默截断 — `AgentService.ts:581`；`dsh-plugin/src/wiki/RuleService.ts:24-25`；测试 `tests/wiki-workspace.test.cjs:191`

**提示缓存**
- 在 `dsh-plugin/src src scripts tests skills` 中 grep `cache_control|prompt.?cach|cached_tokens|prompt_cache|cache_read|cache_creation`：零命中
- `parseUsage` 只读 prompt/completion/total，不读缓存命中字段 — `OpenAIClient.ts:124-131`
- 只走 OpenAI 兼容的 `/chat/completions`（provider 类型 openai/ollama）— `OpenAIClient.ts:44-48`。对话历史回传时不发 `reasoning_content` — `OpenAIClient.ts:61-64`

**Token 预算**
- 只自动探测输出上限（`autoMaxTokens`），缓存到 provider 配置 — `src/main/index.ts:407-414`、`:533-547`；`dsh-plugin/src/llm/OutputLimit.ts`
- grep `context_length|contextWindow|context_window|inputTokenLimit|max_input|max_context`：零命中，即不感知输入上下文窗口
- 用量只统计并显示，没有上限或费用控制 — `AgentService.ts:164-176`；`src/renderer/src/App.tsx:607`。在 `agent/`、`shared/types.ts`、`src/main` grep `maxCost|costLimit|budget|预算` 只有两条注释

**taskChat 路径**
- 所有后台调用的统一出口，规则写在文件头：强制 `thinking:'off'`；学习「关不掉思考」的模型并加 16000 余量重试一次；截断或空正文抛 `ModelOutputError`，消息带元数据诊断（不含正文和密钥）— `TaskChat.ts:1-18`、`:39-44`、`:70-100`
- 调用方：上下文压缩、视觉识别、AI 分析、定制分析、Wiki 详细分析、规范编译、规范检查、REFLECT、问答 — `ContextManager.ts:123`；`AgentService.ts:328`；`dsh-plugin/src/wiki/AiPipeline.ts:169`、`:268`；`DetailedAnalysis.ts:44`；`RuleService.ts:43`、`:107`；`dsh-plugin/src/wiki/WorkflowService.ts:416`、`:618`。全仓库唯一直接调 `chatStream` 的业务代码是主循环 — `AgentService.ts:587`
- 「总会思考」的学习结果只存进程内存，不持久化 — `TaskChat.ts:27`
- 测试 7 项 — `tests/task-chat.test.cjs:23-73`

### Inferences
- 触发判断漏算了 system、工具 schema（约 5k）和规范块（最多约 16k），默认阈值 24000 下实际上下文可能远大于估算；中文 `字符/3` 也可能偏离真实值。
- 压缩只在下一轮开头运行，且不碰最近消息，所以一次超大 `run_command` 输出会直接进入下一次请求，可能超窗。
- 无提示缓存意识，但结构上偶然友好：system 与工具清单每轮确定性重建、RAG 注入在 user 消息尾部（`AgentService.ts:118-132`）。压缩会重写前缀。缓存命中率目前不可观测。

### Gaps
- 未测量实际缓存命中率和 system prompt 的真实 token 数。

## 5. 记忆：除 Wiki 外有跨会话长期记忆吗？Wiki 和「任务规范」评估如何工作？

### Takeaway
没有 agent 记忆系统。跨会话留存只有：对话存档（只对同一对话有效）、Wiki（BM25 检索，无向量）、编译后的任务规范。规范这条线设计严谨（原文证据、哈希版本、运行时校验），但评估只查聊天正文，不查生成的文件。

### Cited Findings
**记忆**
- 在 `dsh-plugin/src src/main src/renderer/src` 中 grep `long.?term|memory|记忆|user.?profile|embedding|vector|向量`：唯一命中是 `resetTaskChatMemory`（TaskChat 的测试辅助函数）— `TaskChat.ts:34`
- 对话落盘：`conversations/<id>.json`，含 turns 和 `state`（history、activeRules、usage），重启后恢复 — `dsh-plugin/src/agent/ConversationStore.ts`；`src/main/index.ts:278-279`、`:556-562`；测试 `tests/conversations.test.cjs:7`。不同对话之间不互通
- 用户可编辑的持久指令只有人设 `petPrompt` — `ConfigStore.ts:27-31`、`:159`；`AgentService.ts:234`
- 模型主动留存的渠道：`save_knowledge_output` 写入 `wiki/outputs/`，`add_question` 记到 QUESTIONS.md，由 system prompt 引导 — `dsh-plugin/src/tools/wikiTools.ts:177`、`:198-233`；`AgentService.ts:227`。没有「记住这件事」式的工具，也没有自动提取用户偏好

**Wiki**
- 三层：`raw/` 不可变原件、`wiki/` 模型编译层 — `dsh-plugin/src/wiki/contract.ts:115`
- 检索：内存倒排索引（BM25 简化版），中文 bigram + 低权重 unigram，字段加权，启动时重建 — `dsh-plugin/src/wiki/SearchIndex.ts:20-36`；`dsh-plugin/src/wiki/wiki-host.ts:134-135`
- 自动 RAG：每轮用用户原话作查询（默认 topK 3、minScore 0.12），命中片段拼到 user 消息尾部；模式 auto / selected / off；专题模式只限带标签的文件，超 48000 字符直接报错 — `dsh-plugin/src/wiki/KnowledgeRetriever.ts:17-51`；`ConfigStore.ts:161-165`；`AgentService.ts:541-564`
- 注入片段带引用链接与行号，界面显示「本轮知识来源」并可跳回原文 — `KnowledgeRetriever.ts:50`；`src/renderer/src/components/Message.tsx:125`、`:132`
- 导入管线：解析 → 无损分片（2400 字）→ 逐片 LLM 整理 → 校验引句确实出现在原文 → 写来源页；片段缓存可续跑；新文件落入 `raw/` 自动触发 — `IngestionService.ts:35-92`；`WorkspaceStore.ts:9-26`；`DetailedAnalysis.ts:32-60`；`wiki-host.ts:128-133`、`:323-342`、`:388-391`
- 当前 `runIngest` 走 IngestionService，其结果 `conceptPaths`、`entityPaths` 为空 — `wiki-host.ts:388-391`；`IngestionService.ts:40`。LINT / REFLECT / MERGE / QUERY 工作流在 `WorkflowService.ts:24`、`:254`、`:365`、`:559`
- 设计文档：`WIKI_DESIGN_REPORT.md`（§四 五工作流）、`docs/wiki-redesign-v2.md`（§6 管线、§8A 持久规则）

**任务规范与评估**
- 编译：用户选定资料与任务类型，逐片 LLM 提取条款（requirement、level、condition、exceptions、quote）；`quote` 必须逐字存在于原文，否则整个规则集不启用 — `RuleService.ts:30-66`
- 匹配：规则集按正则判定的任务意图（paper/report/code/continue/read/other）、`all`、`@标题`、自定义关键词匹配；「继续」类输入沿用之前的规则快照 — `RuleService.ts:10-17`、`:72-79`
- 版本校验：原文哈希变化则拒绝执行、要求重新编译 — `RuleService.ts:80-89`
- 注入：每轮追加到 system 消息 — `AgentService.ts:580-581`
- 评估：模型结束回答时，每个规则集调一次 `taskChat`（temperature 0，4500 token）逐条给 pass/fail/review；未得到结果的条款标 review、方法 manual，不会静默算通过 — `RuleService.ts:97-119`
- 修正：有 fail 且无产物时最多自动修正 1 次 — `AgentService.ts:675-684`
- 产物不检查：有产物时追加一条 `artifact-review`，明说未读取生成文件 — `RuleService.ts:99`、`:120`
- 报告存 `.winagent/tasks`，任务上下文存 `.winagent/task-context` — `RuleService.ts:93-96`、`:121`；`WorkspaceStore.ts:81`；界面折叠展示，有 fail 时自动展开 — `Message.tsx:133`
- 规范对工具调用的约束只存在于提示词里（`RuleService.ts:25`），没有在工具执行前做校验 — `AgentService.ts:692-732`

### Inferences
- 用户偏好和历史决策无法跨对话传递，除非写进 Wiki 或人设；这是和带记忆的 agent 差距最明显的一项。
- BM25 没有语义召回，换说法提问时依赖模型自己换关键词（system prompt 有此引导，`AgentService.ts:224`）。
- 规范评估是「模型评模型」的运行时自检，不是离线 eval；它的诚实标注（模型评估 / 需核验）值得保留。

### Gaps
- 未逐行审计 `VaultManager.ts`（1068 行）、`GraphEngine.ts`、`AiPipeline.ts`，Wiki 细节以设计文档为准，且设计文档日期（2026-09-03）早于 v0.5.0 重构，部分内容可能已过时。

## 6. 权限与安全：危险操作确认、沙箱、白名单、工具输出的提示注入防护、文件变更检查点/回滚、API Key 存储

### Takeaway
只有一层：按工具名的静态 `dangerous` 布尔值加弹窗（或全局自动放行）。没有沙箱、路径范围和检查点，API Key 明文存储。最严重的缺口是：读任意文件和发任意 HTTP 请求都不需要确认，且工具输出没有任何不可信标记，构成完整的数据外泄链路。

### Cited Findings
**确认机制**
- `registry.isDangerous(name) && !cfg.autoApproveTools` 时等待 `confirmTool`，拒绝则把「用户拒绝了该操作」写入工具结果 — `AgentService.ts:710-719`
- 弹窗显示工具名和 JSON 参数；默认焦点在「拒绝」，Esc 即拒绝 — `src/renderer/src/App.tsx:500-503`、`:907-932`
- 主进程的确认 promise 没有超时 — `src/main/index.ts:817-823`
- 选项只有允许/拒绝，没有「本会话允许」「按路径允许」；全局开关在设置（默认关）— `Settings.tsx:895-903`；`ConfigStore.ts:144`
- 内置 55 个中 22 个标记危险：write_file、edit_file、multi_edit_file、delete_file、move_file、kill_process、run_command、add/remove_startup_item、注册表写删 3 个、mouse_move/click/scroll、key_press、key_combination、type_text、set_window_state、bring_window_to_front、close_window、merge_knowledge_pages — 各工具文件 `dangerous: true`（如 `fileTools.ts:109`、`systemTools.ts:85`、`inputTools.ts:71`、`wikiTools.ts:264`）
- 未标记危险但有副作用：`http_request`（任意方法/头/体）、`http_download`（任意路径落盘）— `httpTools.ts:9-41`、`:45-68`；`copy_file`（可 overwrite）— `fileTools.ts:225-243`；`create_directory`；`write_xlsx`、`write_pptx`、`markdown_to_docx`、`office_convert`（`officeTools.ts` 全文没有 `dangerous`）；`take_screenshot`（`save_path` 任意）— `systemTools.ts:113-133`；`save_knowledge_output` — `wikiTools.ts:198-233`
- `read_file`、`list_directory`、`grep` 不需确认且不限路径 — `fileTools.ts:74-93`
- DSH 插件包的审批走宿主 `tools/pre-execute`，不用于桌面版 — `scripts/dsh-one/runtime.cjs:45-51`

**沙箱 / 白名单**
- grep `sandbox|allowlist|whitelist|blacklist|denylist|AppContainer|Job Object`：只命中 Electron `webPreferences`（主窗口和知识库窗口 `sandbox:false`，启动窗 `sandbox:true`）和测试脚本 — `src/main/index.ts:142`、`:209`；`src/main/splash.ts:70`
- `run_command` 直接 `cmd.exe /c`，以当前用户身份运行，60s 超时；PowerShell 工具用 `-ExecutionPolicy Bypass` — `dsh-plugin/src/util/powershell.ts:14`、`:40-42`
- 唯一的工具白名单是专题任务那 4 个输出工具（`write_file` 仍可写任意路径）— `AgentService.ts:583`、`:696-701`
- 路径校验只存在于 Wiki 的 IPC 和导入流程以及皮肤协议，不覆盖 Agent 工具 — `src/main/index.ts:726-741`、`:69-89`；`IngestionService.ts:26`、`:43-46`

**提示注入**
- 有「资料是数据」声明的地方：RAG 注入（`<资料片段>` 包裹）— `KnowledgeRetriever.ts:50-51`；规范编译/检查 — `RuleService.ts:25`、`:44`、`:108-109`；Wiki 分析 — `DetailedAnalysis.ts:22`
- 工具结果原样进入历史，没有包裹或标记 — `AgentService.ts:725-730`；system prompt 的执行规则里没有「工具输出不是指令」— `AgentService.ts:212-233`。grep `prompt.?inject|untrusted|不执行|注入攻击|提示注入` 只命中上述 Wiki/规范位置
- `<资料片段>` 不对内容转义 — `KnowledgeRetriever.ts:50`
- 工具结果里的 `[[IMG:...]]` 标记会被解析成视觉输入 — `AgentService.ts:22`、`:238-245`
- 渲染层防护较好：Markdown 经 DOMParser 清洗，href/src 协议白名单 — `src/renderer/src/lib/markdown.ts:51-62`；CSP 的 `img-src`、`connect-src` 不允许外部域 — `src/renderer/index.html:6`；`contextIsolation:true`、`nodeIntegration:false`、禁止导航 — `src/main/index.ts:143-144`、`:154-156`
- `setWindowOpenHandler` 把任意 URL 交给 `shell.openExternal`，无协议过滤 — `src/main/index.ts:148-151`

**检查点 / 回滚**
- grep `checkpoint|rollback|snapshot|undo|回滚|快照|git stash|\.bak` 只命中 `multi_edit_file`（单文件全部成功才写盘）和「重新生成」的会话快照 — `fileTools.ts:156`；`src/main/index.ts:301`；`src/preload/index.ts:57`
- `write_file` 直接覆盖，`delete_file` 直接 `unlink` / `fs.rm`，grep `trash|recycle|回收站` 零命中 — `fileTools.ts:110-115`、`:214-221`
- 「重新生成」只回滚对话，不回滚文件 — `src/main/index.ts:572-580`

**API Key**
- 明文存储：`encryptKey`/`decryptKey` 是空实现，旧的 `enc:v1:` 密文加载时被清空；注释明确「加密属独立议题」— `ConfigStore.ts:9-20`、`:264-270`；README 也说明 — `README.md:367`
- `src/main` 没有用 `safeStorage`（全仓 grep 只有 ConfigStore 的注释提及）
- `config:get` 把含 Key 的完整配置发给渲染进程 — `src/main/index.ts:425`
- 仓库根的 `config.json` 被 `.gitignore` 忽略且未被跟踪（`.gitignore:5`；`git ls-files` 只返回 `mcp.json`）。文件内有 3 个 `apiKey` 字段（只数了 key 出现次数，没读值，不确定是否非空）
- 错误信息和诊断脚本避免泄漏 Key — `OpenAIClient.ts:320`；`scripts/diagnose-model.cjs:10`；测试 `tests/output-limit.test.cjs:67`
- 但日志完整记录工具参数和用户输入，没有脱敏 — `AgentService.ts:565`、`:695`；工具结果记前 200 字符 — `:729`

### Inferences
- 外泄链路：网页或文档里的注入内容（`http_request`/`read_file`/MCP 结果未标记）→ 模型 `read_file` 读 `%APPDATA%\com.winagent.app\config.json` → `http_request` POST 出去。全程不弹窗。这是当前最该修的问题，而且大部分只要改危险标记和加路径/域名策略。
- `http_download` 无确认地写任意路径，可写入用户启动目录等位置，等于绕过 `add_startup_item` 的确认。
- 确认粒度过粗：每次 `mouse_move` 都弹窗，桌面操作流程几乎只能开全局自动放行，而一旦开启，上述所有防线归零。
- 没有检查点意味着误改只能靠用户自己的备份；对一个能覆盖任意文件的 agent 是实质风险。

### Gaps
- 未审计 `officeTools.ts` 全部写盘分支的覆盖行为。未实测任何注入场景。

## 7. 桌面控制：只有截图与模拟输入，还是有 UI Automation / 无障碍树？

### Takeaway
只有坐标级模拟输入和窗口管理，没有 UIA 或无障碍树。更糟的是截图不会反馈给模型：`take_screenshot` 只返回文件路径，所以目前的桌面控制基本是盲操作。

### Cited Findings
- 输入：`mouse_move/click/scroll`（user32 经 PowerShell Add-Type）、`key_press`、`key_combination`、`type_text`（`SendKeys`）、`get_cursor_pos`、`get_screen_size` — `dsh-plugin/src/tools/inputTools.ts:5-14`、`:60-202`
- 窗口：`find_windows`（按 `Get-Process` 的 `MainWindowTitle`）、`set_window_state`、`bring_window_to_front`、`close_window` — `dsh-plugin/src/tools/windowTools.ts:5-131`
- 截图：全虚拟屏幕存 PNG，只返回 `已截图: <路径>` — `systemTools.ts:113-133`。`[[IMG:` 标记只出现在 docx/PDF skill 和 AgentService，不在截图工具 — grep `\[\[IMG:` 于 `dsh-plugin/assets/skills`、`dsh-plugin/src`
- 没有读图工具：`read_file` 按 utf-8 读 — `fileTools.ts:87`
- 在 `dsh-plugin/src src scripts tests skills` 中 grep `UIAutomation|UI Automation|AutomationElement|accessibility|IUIAutomation|FlaUI|uia`：只有一条误命中（测试 PDF 的 base64）
- 在 `dsh-plugin/src/tools` 中 grep `DpiAware|SetProcessDPI|GetWindowRect|PrintWindow|ocr|OCR`：零命中，即没有 DPI 处理、窗口矩形、单窗口截图和 OCR
- 在 `dsh-plugin/src`、`src/main` 中 grep `playwright|puppeteer|cdp|browser_use|chromium`：零命中，没有浏览器自动化
- `key_combination` 对 `win` 有缺陷：`win` 不进修饰符分支，落到 `keyToSendKeys('win')`，被当字面量 `win` 发送 — `inputTools.ts:47-58`、`:40-45`
- `type_text` 用 SendKeys — `inputTools.ts:170-176`
- 每个动作都新起一个 PowerShell 进程（30s 超时）— `dsh-plugin/src/util/powershell.ts:10-16`
- 动作类工具都标 danger，每步弹确认 — `inputTools.ts:71`、`:92`、`:114`、`:131`、`:150`、`:169`

### Inferences
- 没有「看 → 想 → 做」闭环：模型无法自己看到屏幕，要看图只能靠用户手动把截图作为附件上传。
- 没有 DPI 处理时，高缩放屏幕上截图像素坐标和 SetCursorPos 坐标可能对不上（未实测）。
- 每次动作都要启动 PowerShell 并编译 Add-Type，延迟较高（未测量）。
- UIA 工具是这一领域差距最大的一项，且可以用 skill 或 MCP 形式交付，不一定要改 dsh-plugin（见问题 11）。

### Gaps
- 未实测 SendKeys 在中文 IME 下的表现。

## 8. 调度与自动化：有定时任务、触发器或消息网关吗？

### Takeaway
都没有。唯一的「触发器」是知识库文件监听：新文件进入 `raw/` 时自动做 Wiki 分析。应用关闭窗口即退出，没有托盘或常驻服务。

### Cited Findings
- 在 `dsh-plugin/src src scripts tests skills` 中 grep `cron|schedule|setInterval|node-schedule|ScheduledTask|schtasks|trigger|webhook|telegram|feishu|lark|slack|dingtalk|wecom|discord`：只命中 `scheduleAutoIngest` — `wiki-host.ts:131`、`:323`
- 自动导入：`raw/` 新文件触发，1.5 秒防抖，60 秒去重 — `wiki-host.ts:128-133`、`:323-342`
- 窗口全关即退出进程 — `src/main/index.ts:871-874`；在 `src/main` grep `\bTray\b|setLoginItemSettings|powerSaveBlocker`：零命中
- 单实例锁 — `src/main/index.ts:834-845`
- 打包目标是 portable exe — `electron-builder.yml`（win.target）
- `add_startup_item` 只是写注册表 Run 键的工具，不是调度能力 — `systemTools.ts:153-172`
- DSH 宿主下 `server.ts` 暴露 HTTP 路由（`/winagent/api/...`），只在插件形态可用 — `dsh-plugin/src/server.ts:258-264`、`:480-527`

### Inferences
- 模型理论上可以用 `run_command` 调 `schtasks`，但定时启动的命令没法回到一个 Agent 会话。
- 自动导入会在文件落入 `raw/` 时自动消耗 API 额度，用户无确认（`wiki-host.ts:335`）。

### Gaps
- 无。

## 9. 可观测性与评估：日志、追踪、diagnose:model、测试

### Takeaway
有按天的文本日志、token 用量、实时事件和结构化作业/规范记录，`diagnose:model` 是很实用的诊断工具；没有结构化 trace、回放和 agent 行为 eval，没有 CI，主循环的危险确认路径没有测试覆盖。

### Cited Findings
**日志与记录**
- `Logs/agent_YYYY-MM-DD.log`，纯文本，无轮转和清理 — `dsh-plugin/src/util/Logger.ts:9-31`
- 记录内容：用户输入、工具调用参数、工具结果前 200 字符、用量、压缩 — `AgentService.ts:172-175`、`:565`、`:575`、`:695`、`:729`
- 用量事件逐轮上报，无 usage 时本地估算并标 `estimated` — `AgentService.ts:638-648`；顶栏显示 — `src/renderer/src/App.tsx:607`
- 结构化记录：`.winagent/{jobs,sources,rules,tasks,task-context,analysis-cache,completed}` — `WorkspaceStore.ts:28-34`、`:81`；`RuleService.ts:95`；`IngestionService.ts:39`、`:87`；`DetailedAnalysis.ts:37-38`
- 在 `dsh-plugin/src src/main src/preload scripts tests` 中 grep `opentelemetry|langfuse|telemetry|traceId|trace_id|\bevals?\b|benchmark|golden`：零命中

**diagnose:model**
- `npm run diagnose:model [-- --provider <id>] [-- --source <id>]`：先发一次关思考的小 JSON 请求，判定连接问题、思考能否关、是否截断、能否输出 JSON；`--source` 用真实资料片段再跑一次 Wiki 分析（请求上限 3 次）；只输出元数据 — `scripts/diagnose-model.cjs:1-11`、`:36-65`、`:67-96`；`package.json`（scripts）；故障表 `README.md:371`
- 限制：只诊断后台任务路径，不覆盖主循环和工具调用（探测请求不带 tools，`scripts/diagnose-model.cjs:44-47`）

**测试**
- `node --test` 文件 6 个，共 51 个 `test(`：`wiki-workspace` 15、`dsh-one` 11、`output-limit` 9、`task-chat` 7、`models-fetch` 6、`conversations` 3 — `tests/*.test.cjs`
- UI 测试 harness：`tests/workbench-ui.tsx`、`tests/wiki-ui.tsx`、`tests/speech-replay.tsx`，由 `scripts/test-*.cjs` 在 Electron 离屏窗口驱动，含截图 — `scripts/test-workbench-ui.cjs:17-24`
- 主循环只有用 mock 的两条路径：专题工具拦截、规范每轮注入与压缩后保留 — `tests/wiki-workspace.test.cjs:99-116`、`:191-216`。mock 里 `isDangerous:()=>false` 且 `autoApproveTools:true`，所以危险确认分支没有覆盖
- `.github/workflows/` 是空目录；`package.json` 没有聚合的 `test` 脚本，只有分散的 `test:*`
- 模型评估相关只有运行时的规范检查（见问题 5）；没有固定任务集或回归评分

### Inferences
- 排查一次 agent 运行只能翻纯文本日志和对话 JSON，没有轮次/工具调用的结构化时间线、耗时和失败统计。
- 日志未脱敏且无轮转，长期运行会累积敏感内容。

### Gaps
- 未运行测试，当前通过情况未知（`docs/wiki-live-test-checkpoint.md` 记录 2026-09-28 时 33 项通过，之后测试有增加）。

## 10. UI：工作台结构、任务/计划展示、审批、产物

### Takeaway
工作台是「左侧导航 + 中间对话」，围绕助理、专题任务和 Wiki 组织；工具卡片、思考折叠、知识来源和规范报告都有。没有计划/任务进度视图，没有产物面板或文件 diff。

### Cited Findings
- 结构：可收起、可调宽的左侧栏（助理、Skills 与 MCP、Wiki 知识库；专题任务列表，含搜索、归档、右键管理；设置）；顶栏（面包屑、状态、token、压缩）；上下文条（知识范围、固定资料、规范标签）；消息区；输入框 — `src/renderer/src/App.tsx:593-615`；`src/renderer/src/components/workbench/`
- Wiki 有内嵌页和独立窗口（`?view=wiki`），阅读页、PDF 原版阅读、选段加入提问 — `src/main/index.ts:194-239`、`:705-708`、`:734-742`；`src/renderer/src/components/wiki/KnowledgeWorkspace.tsx`；`README.md:251-257`
- 进度展示只有状态文本「第 N 轮（历史 M 条）」，每轮开一个新的助手气泡 — `useAgent.ts:230-241`
- 工具卡片：工具名、来源（内置/Skill/MCP）、运行状态，展开看参数和结果（显示截断到 4000 字）— `src/renderer/src/components/ToolCard.tsx:20-67`；`Message.tsx:196-197`
- 没有计划/任务清单 UI：grep `\bplan\b` 在 `src/renderer/src` 无命中；欢迎页的「写一份文档」只是预填一句让模型「列出写作计划」的提示词 — `App.tsx:615`
- 审批：模态框，见问题 6 — `App.tsx:907-932`
- 产物：`artifact` 只出现在 AgentService 和 RuleService 的逻辑判断中（`hasArtifacts`），渲染层无命中；grep `\bdiff\b|DiffView|FilePreview` 在 `src/renderer/src` 无文件命中。生成的文件只以工具结果文字（路径）出现
- 规范报告与知识来源以可折叠块附在消息后 — `Message.tsx:132-133`
- 其他：重新生成、复制、Slash 命令 `/clear` `/compact`、语音朗读条、主题包和配色方案 — `useAgent.ts:343-359`；`App.tsx:46-48`；`src/renderer/src/components/SpeechBar.tsx`；`src/renderer/src/theme/colorSchemes.ts`（未跟踪新增）
- 工作树的未提交改动集中在界面和主进程（App.tsx 变更 513 行，另有 useAgent、Message、Settings、workbench.css、启动窗、配色方案）— `git diff --stat`、`README.md:444-451`

### Inferences
- 长任务的进度只能从工具卡片序列判断，用户不知道总体计划和剩余步骤。
- 没有产物面板和 diff，用户无法在批准前或完成后直观看到文件改动；审批框只能看 JSON 参数，大段 `edit_file` 内容难以审查。

### Gaps
- 未逐行审计 `Settings.tsx`（1402 行）和 `GraphView.tsx`。未实际打开应用查看界面。

## 11. 项目决策的影响：dsh-plugin 暂停后，新功能会落在哪里？

### Takeaway
决策与现实有结构性冲突：Agent 核心（循环、上下文、工具、配置）全部在 `dsh-plugin/src`，而外部 agent 创新大多正好落在这里。`src/main + renderer` 能做的是外围（调度、审批策略、请求层包裹、UI）；循环内改动要么解除暂停，要么把核心迁出来。

### Cited Findings
**决策与实际情况**
- 用户记忆：2026-09-29 起「暂时抛弃 dsh 插件部分」，新功能做在 `src/main` + `src/renderer`，复用服务层公开 API — `C:\Users\53031\.claude\projects\C--Users-53031-Desktop-WinAgent\memory\winagent-single-ts-service.md:15`
- 暂停确实被执行：`dsh-plugin/src` 工作树只有一行注释改动（ConfigStore 的注释），最近一次提交是 2026-09-28 — `git diff -- dsh-plugin/src`、`git log -- dsh-plugin/src`
- 主进程已留下 TODO，等重启插件工作时下沉 — `src/main/index.ts:305-306`；专题重命名/归档/删除和 Wiki 打标都做在主进程 — `src/main/index.ts:307-385`
- 桌面版运行时依赖服务层：`require('dsh-winagent/services')`，经 file: 依赖指向 `dsh-plugin`，加载编译产物 `lib/` — `src/main/index.ts:26`；`package.json`（`"dsh-winagent": "file:./dsh-plugin"`）；`dsh-plugin/package.json:13-15`；打包也包含它 — `electron-builder.yml`
- 主进程只调 `core.agent.process(...)`，循环是黑盒 — `src/main/index.ts:551-554`
- `dsh-one/`（未跟踪，文件日期 2026-09-30，晚于暂停决定）是由 `scripts/build-dsh-one.cjs` 从 `dsh-plugin/src` 拷贝生成的 12 个独立 DSH 包，68 个工具，有自己的审批、超时和取消前检查 — `dsh-one/plugins.json`（`sourceFiles`/`origins`）；`dsh-one/WinAgent-插件分类说明.md:3`；`scripts/dsh-one/runtime.cjs:45-68`
- `bootstrap.ts` 注释称插件宿主和桌面共用装配，但 `server.ts` 没有调用 `createWinAgentCore`，只共用 `seedDataDir`，装配逻辑是自己的 — `bootstrap.ts:3`；`server.ts:56-59`、`:76-85`；grep `createWinAgentCore` 于 `server.ts` 无命中

**不改 dsh-plugin 就能用的公开挂载点**
- `services.setChatFetcher(fetcher)`：所有对话和后台 LLM 请求都经过它 — `OpenAIClient.ts:39-42`、`:211`；已在用 — `src/main/index.ts:851`
- `confirmTool` 回调：仅在工具危险且未自动放行时调用 — `AgentService.ts:711-712`；`src/main/index.ts:817-823`
- `onEvent` / `core.bus`：全部 agent 事件 — `src/main/index.ts:552`、`:262-273`
- `agent.exportSession()` / `restoreSession()` — `AgentService.ts:186-194`
- `services` 导出 `AgentService`、`ToolRegistry`、`ContextManager`、`ConversationStore`、`KnowledgeRetriever` 等类，可在主进程再实例化 — `dsh-plugin/src/services.ts`
- 数据目录的 `skillsDirs` 与 `mcp.json`：可以不改插件就加工具 — `bootstrap.ts:103-115`
- 工具注册没有公开 API：`addAll` 是 private，只有 `setWikiTools`、`setVoiceTools` 后再 `reloadTools` 这条侧路 — `ToolRegistry.ts:25-37`
- `store.get()` 每轮读取，`petPrompt` 可被主进程改 — `AgentService.ts:234`

### Inferences
以下落点是我的工程判断，不是代码事实：

| 候选能力 | 可在 src/main + renderer 完成 | 必须改 dsh-plugin/src |
| --- | --- | --- |
| 定时任务、触发器、消息网关、托盘 | 是（调用现有 runAgent；受单任务限制） | 否 |
| 计划/任务进度 UI、产物面板、审批 UI 增强 | 大部分（基于事件）；结构化计划需要新工具 | 计划工具可走 skill/MCP |
| 结构化 trace、运行回放 | 是（订阅 `agentEvent`，包裹 chatFetcher） | 否 |
| 网络/429 重试、请求超时 | 是（包裹 chatFetcher） | 否，但工具超时要改 |
| 提示缓存参数注入、缓存命中统计 | 部分（chatFetcher 能改请求体和读响应，流式解析要自己 tee） | 真正进 `usage` 事件需要改 `parseUsage` |
| 延迟加载 / tool search | 能用 chatFetcher 过滤 `tools` 字段实现，较 hack | 干净的实现要改 `AgentService:583` 和 `ToolRegistry` |
| 审批策略（白名单、按路径、本会话允许） | 只对已标危险的工具有效（confirmTool） | 把 `http_request` 等标危险、参数级策略要改 |
| 文件检查点 / 回滚 | 只能在 confirmTool 前做，自动放行和非危险工具覆盖不到 | 干净的实现要在 `registry.execute` 或工具内 |
| UIA / 无障碍树工具 | 是（作为 skill 或 MCP，数据目录挂载；需要自带种子逻辑） | 否 |
| 截图回传模型 | 可新增 skill 输出 `[[IMG:...]]`（`AgentService.ts:22`） | 改 `take_screenshot` 本身才彻底 |
| 工具输出不可信标记、并行工具、工具取消、`length` 处理、达上限提示 | 否 | 是（`AgentService`、`Tool` 接口） |
| 压缩策略、token 估算、上下文窗口感知 | 否（`ContextManager` 在循环内实例化，`AgentService.ts:519`） | 是 |
| 子代理 | 可在主进程实例化多个 `AgentService`，委派工具走侧路注册；UI 单确认槽要改 | 干净的实现要改 |
| 长期记忆 | 只能 hack（拼进用户文本或改 `petPrompt`）；或走 Wiki + MCP/skill | 干净的注入点在 `systemMessage` |
| API Key 加密 | 否（读写都在 `ConfigStore`，`createWinAgentCore` 内部构造，`bootstrap.ts:99`） | 是 |

- 最高价值的安全和可靠性修复（工具输出标记、危险标记、取消、截断处理）都要改 `dsh-plugin/src`。报告建议里应该明确提出：要么只对桌面版依赖的 agent/llm/tools 核心解除暂停，要么把它们迁到 `src/main`；否则继续在主进程打补丁和 hack，和 2026-09-06 为消除多实现漂移做的架构收敛目标相悖。
- 桌面专属逻辑已经开始累积在 `src/main/index.ts`（875 行）；重启插件工作时下沉成本在上升，且 `dsh-one` 是生成物，改 `dsh-plugin/src` 后需要重新生成才能同步。
- 解除暂停的成本不高：改 `dsh-plugin/src` 后 `npm run plugin:build` 重编 `lib/`，桌面版即可使用，现有 `test:*` 脚本都会先构建插件 — `package.json`（scripts）。

### Gaps
- 用户是否愿意为核心修改解除暂停需要询问用户本人；代码里无法回答。

## 12. 综合：已有与缺失对照（供报告对照外部创新）

### Takeaway
强项在知识与规范（可溯源 Wiki、证据校验的规则编译、诚实的检查报告）和模型兼容性防线；弱项集中在 agent 核心：安全边界、工具面规模、上下文精度、多代理、记忆、桌面感知、自动化和评估。

### Cited Findings
**已有（证据见上文各问题）**
- 流式 + 思考流、网关差异降级、输出上限自动探测（问题 1、4）
- taskChat 后台调用防线（问题 4）
- 两阶段上下文压缩、规范不随压缩丢失（问题 4）
- 自动 RAG、证据引用、专题范围隔离（问题 3、5）
- 任务规范：原文证据编译、哈希版本校验、每轮注入、运行时模型检查、诚实标注（问题 5）
- Skills（manifest + SKILL.md）、MCP（stdio + 简单 HTTP）（问题 3）
- 危险操作弹窗、专题工具白名单（问题 6）
- 渲染层 Markdown 清洗与严格 CSP（问题 6）
- Wiki 后台作业：可取消、可续跑、片段缓存（问题 1、5）
- 视觉辅助模型协作、PDF 直传与工具回退（问题 1、2）
- 运行中切换对话、重新生成（问题 1）
- diagnose:model、51 个 node 测试、Electron UI 测试 harness（问题 9）

**缺失或很弱（均经 grep 与代码阅读确认，见上文）**
- 子代理 / 委派 / planner / 模型路由（问题 2）
- 工具延迟加载 / tool search（问题 3）
- 提示缓存意识、上下文窗口感知、精确 token 计数、token/费用预算（问题 4）
- 跨会话 agent 记忆、语义检索（问题 5）
- 沙箱、路径/域名范围、细粒度审批；`http_request`、`read_file` 不需确认（问题 6）
- 工具输出的提示注入防护（问题 6）
- 文件检查点 / 回滚（问题 6）
- API Key 加密，日志脱敏（问题 6）
- 截图回传模型、UIA / 无障碍树、DPI 处理、浏览器自动化（问题 7）
- 定时任务、事件触发、消息网关、常驻托盘（问题 8）
- 结构化 trace、agent eval、CI（问题 9）
- 计划视图、产物面板、文件 diff（问题 10）
- 并行工具执行、工具取消、通用重试与超时、主循环截断处理（问题 1）

### Inferences
- 建议报告优先级（我的判断）：第一档是安全和可靠性（工具输出标记、补危险标记、Key 加密、主循环截断和取消），因为这些是现有能力的缺陷，不是新功能；第二档是截图回传加 UIA，这直接决定 Windows 操作助手这一定位是否成立；第三档是 tool search、提示缓存、记忆、子代理、调度。

### Gaps
- 本笔记只说明 WinAgent 的现状；外部 agent 的创新由其他研究员覆盖，二者的逐项对比留给报告撰写者。
