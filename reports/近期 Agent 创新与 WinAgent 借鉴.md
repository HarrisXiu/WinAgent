# 先修核心缺口，再借鉴 Agent 新模式

最值得 WinAgent 借鉴的，不是 Super-agent 的 Router/Worker 或各家的 swarm，而是几乎所有厂商都在做的基本功：确定性的安全边界、可观测的缓存与运行记录、工具输出落盘、感知闭环。DeepSeek Harness 团队确实在 2026-10-31 发布了 Super-agent，但它是设计文章加研究原型，官方声明不是正式产品，实验数据来自合成负载，且优势集中在高事件率场景，对单用户桌面应用的外推没有证据。Codex 式的“切模型保留缓存”要拆开回答：切模型并保留对话，WinAgent 在架构上已经可以（未在 app 中实测）；跨不同模型复用缓存，连 Codex 也没有证据支持，WinAgent 不应把它当作目标。今天最该先做的是两件几乎不花钱的事：用一次真实工具循环确认 `reasoning_content` 问题，以及加上缓存命中率统计。真正需要你拍板的是 dsh-plugin 暂停令：排名靠前的安全和可靠性修复大多落在 `dsh-plugin/src`，不放开就只能做外围，所以建议只为桌面版核心窄幅解除暂停。下文的工作量都是我按一人估算的，不是测量值。

## 16 项建议按“先止血、再度量、后扩能力”排序

下表已对照代码审计笔记 `winagent_inventory.md` 去掉 WinAgent 已有的能力。证据等级只描述外部依据的强度，代码现状均来自静态审计。文中 `AgentService.ts` 这类简写指 `dsh-plugin/src/` 下的同名文件，`App.tsx`、`useAgent.ts` 指 `src/renderer/src/` 下的文件。新增的后台模型调用（第 13 项的完成判定、第 14 项的语义过滤）一律走 taskChat，目前唯一直接调 `chatStream` 的业务代码是主循环（`AgentService.ts:587`），这条边界不应被打破。

| # | 建议 | 工作量（估） | 不碰 dsh-plugin 能落地吗 | 先出预览 | 外部证据等级 |
|---|---|---|---|---|---|
| 1 | 实测并处理 `reasoning_content` 回传 | 手测几分钟；修复 0.5 天 | 测试能；修复不能 | 否 | 一手文档，未实测 |
| 2 | 本地观测层：缓存命中率 + 事件 JSONL | 1–2 天 | 能；进 `usage` 事件要改 `parseUsage` | 否 | 一手文档，厂商实践 |
| 3 | 安全批次：补危险标记、路径与域名策略、输出标记 | 3–4 天 | 基本不能（仅外链过滤可在 `src/main`） | 否；审批框改造另算且要预览 | 预印本，合成实验 |
| 4 | 主循环可靠性：截断、达上限、重试、超时、取消 | 2–3 天 | 重试和超时能，其余不能 | 否 | 厂商修复记录，本项目事故 |
| 5 | API Key 加密 | 1 天 | 不能 | 否 | 厂商实践，事件教训 |
| 6 | 工具输出上限与落盘 | 1 天 | 不能 | 否 | 厂商设计，无效果数据 |
| 7 | 截图回传与 UIA 感知 skill | 截图 0.5–1 天；UIA 3–5 天 | 能 | 否 | 预印本，多为旧模型或专门训练 |
| 8 | 文件检查点与回滚 | 2–3 天，恢复界面另算 | 干净实现不能 | 是 | 产品文档 |
| 9 | MXC 可行性验证（本机 Home 版） | 1 天 | 能 | 否 | 微软公告，无独立评估 |
| 10 | 规范移出 system prompt（待第 2 项数据） | 1 天加回归 | 不能 | 否 | 厂商自报，预印本警示 |
| 11 | 工具按需加载 | 2–3 天加分模型测试 | 干净实现不能 | 否 | 厂商自报 |
| 12 | MCP 客户端升级 | 2–3 天 | 不能 | 否 | 一手规范 |
| 13 | Goal、预算与计划视图 | 3–5 天 | 驱动可在 `src/main`；预算硬停较 hack | 是 | 多家产品共识，无效果数据 |
| 14 | 定时、事件触发与托盘 | 3–5 天 | 能，但必须排在第 3 项之后 | 是 | 产品发布，无效果数据 |
| 15 | 文件式冻结记忆 | 2–3 天 | 干净实现不能 | 若加管理面板则要 | 预印本，利益相关方 |
| 16 | 可选 `prompt_cache_key` | 0.5 天 | 能 | 否 | 一手代码，收益未知 |

### 需要你决定：只为桌面核心解除暂停

全部 16 项中，第 1 项的修复和第 3、4、5、6、10、12 项主体都要改 `dsh-plugin/src`。原因是桌面版运行时就依赖它：`src/main/index.ts:26` 通过 `dsh-winagent/services` 加载编译产物，主进程把 `core.agent.process()` 当黑盒调用（`src/main/index.ts:551-554`）。选项有三个。继续暂停，能做第 2、7、9、14、16 项和第 1 项的测试，但第 14 项建在未修的安全缺口上反而更危险。窄幅解除（**我的建议**），只允许为桌面版改 `agent/`、`llm/`、`tools/`、`config/`、`skills/`、`mcp/`，插件形态的新功能继续暂停，也不重新验证 DSH 宿主；改完 `npm run plugin:build` 即可使用，`dsh-one` 只在要发布时才重新生成。迁出核心到 `src/main` 工程量最大，也违背 2026-09-06 为消除多实现漂移做的架构收敛。这个选项我没有估算成本，目前也不建议。代码里无法判断你愿不愿意解除，这需要你本人决定。

### 第一档：现有能力的缺陷，先于任何新功能

**第 1 项，`reasoning_content`。** 详见下一节。它排第一，是因为验证只要几分钟，而一旦属实，DeepSeek 思考模式下的多轮工具调用就走不通。

**第 2 项，观测层。** 现状：`parseUsage` 只读 prompt、completion、total（`OpenAIClient.ts:124-131`），日志是纯文本，没有轮次时间线（`Logger.ts:9-31`）。外部依据：DeepSeek 文档提供 `prompt_cache_hit_tokens` 和 `prompt_cache_miss_tokens`（[Context Caching](https://api-docs.deepseek.com/guides/kv_cache)），命中与未命中价差约 50 倍（Flash）和 30 倍（Pro）（[Pricing](https://api-docs.deepseek.com/quick_start/pricing)）；Anthropic 的复盘说明一句提示词改动就能损害质量，而内部使用和 eval 起初都没复现（[April postmortem](https://www.anthropic.com/research/april-23-postmortem)，厂商自述）。落点：在 `src/main` 包裹 `setChatFetcher` 并 tee 响应流，再订阅 `agentEvent` 写 JSONL，字段参考 OTel GenAI，但隔一层适配，因为该约定仍是 Development（[Agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)）。默认不记录正文和工具参数，否则会放大现有日志未脱敏的问题（`AgentService.ts:565`、`:695`）。这一层还是后面第 10、11 项的判据和回放测试的素材（思路见 [arXiv 2601.18827](https://arxiv.org/abs/2601.18827)，预印本）。

**第 3 项，安全批次。** 现状（**代码发现，未在运行时复现**）：`read_file` 和 `http_request` 都没有 `dangerous` 标记（`fileTools.ts:74-93`、`httpTools.ts:9-41`），我已读代码确认；工具结果原样进入历史，没有不可信标记（`AgentService.ts:725-730`）；Key 明文存在 `%APPDATA%\com.winagent.app\config.json`（`ConfigStore.ts:9-20`，文件确实存在，内容我未读）。代码路径上，读取再外发不会触发任何确认，但注入能否真的驱动模型走完这条链没有测过，所以不要把它说成已验证的漏洞。外部依据：在合成环境里，把外泄伪装成必填签名或相似主机后，gpt-4o 的成功率从 0% 升到 100%，目的地白名单和 planner/reader 分离都降到 0%，而 SecAlign 仍有 32.5%、通道分离 38.8%（[Framing Gap](https://arxiv.org/abs/2608.27092)，预印本）。同时要打折：这类确定性防御大多只过了静态基准，此前 12 种模型内防御被自适应攻击以超过 90% 的成功率攻破（[Adaptive Evaluation](https://arxiv.org/abs/2606.26479)，预印本）。做法上，`http_request`、`http_download`、`copy_file` 和 Office 写盘工具补标记；敏感路径（数据目录、凭据目录）对 `read_file` 和 `grep` 硬拒绝；出站域名白名单加“只允许会话中已出现过的 URL”（[Claude Platform 2026-10-07](https://platform.claude.com/docs/en/release-notes/overview)，厂商设计，无效果数字）；工具结果加来源包裹（[Gemini CLI v0.60](https://geminicli.com/docs/changelogs/) 已做），但它只是弱防线。第三方 skill 改为默认危险、加超时、不继承完整环境变量（`SkillLoader.ts:30-50`、`:100`），依据是 66,157 个 ClawHub skill 中确认 627 个恶意（[SCS](https://arxiv.org/abs/2610.33489)，预印本）。`setWindowOpenHandler` 的协议过滤（`src/main/index.ts:148-151`）可以不等解除暂停先做。代价是确认弹窗会变多，而 Anthropic 遥测显示用户批准了约 93% 的提示（[How we contain Claude](https://www.anthropic.com/research/how-we-contain-claude)，厂商自报），所以无 body 的白名单 GET 应自动放行。“本会话允许”这类审批框改造属于界面大改，先出预览。

**第 4 项，主循环可靠性。** 现状：`length` 截断被当作正常完成（`AgentService.ts:674-686`），而 taskChat 会报错（`TaskChat.ts:83-97`）；达到 25 轮直接发 `done`，没有提示（`:772-773`）；工具参数解析失败时以空参数继续执行（`:703-708`）；对话请求没有超时，429 和 5xx 不重试（`OpenAIClient.ts:211-220`）；点停止后同批剩余工具仍会执行（推断，`:692-732`）。这与 v0.5.1 事故同类，只是还留在主循环上。外部依据是修复清单而不是效果数据：Agents SDK 0.24.0 的“sibling 失败保留已完成输出”（[releases](https://github.com/openai/openai-agents-python/releases)）、原型对 408/429/5xx 退避重试 3 次（[003 Execution](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md)）。重试和首字节超时可在 `chatFetcher` 里做，其余要改 `AgentService`；`Tool.run` 加 signal 涉及全部工具，可以先只覆盖 `run_command`。

**第 5 项，Key 加密。** 现状：`encryptKey` 是空实现，`config:get` 还把含 Key 的配置发给渲染进程（`ConfigStore.ts:9-20`、`src/main/index.ts:425`）。外部依据：Anthropic 把凭据留在宿主 keychain（[How we contain Claude](https://www.anthropic.com/research/how-we-contain-claude)）。落点是向 `ConfigStore` 注入 Electron `safeStorage`，因为插件宿主没有这个 API。它不能替代第 3 项，但加密后 `read_file` 读到的只是密文，明文文件不再是一步到手的目标。

### 第二档：补上运行基础，其中感知闭环决定产品定位

**第 6 项，工具输出落盘。** 现状：`run_command` 全量返回（`systemTools.ts:86-90`），压缩又不碰最近消息，一次超大输出会直接进入下一次请求（推断）。外部依据：Claude Platform 超过 100K 字符落盘，只给预览和路径（[release notes](https://platform.claude.com/docs/en/release-notes/overview)）；DeerFlow 的结构化摘要加续读（[README](https://github.com/bytedance/deer-flow)）；Kimi Code 2.4.1 把单文件读取上限降到 10 万字符（[releases](https://github.com/MoonshotAI/kimi-code/releases)）。都是设计，没有效果数字，但实现便宜。

**第 7 项，截图回传与 UIA。** 这是能力差距最大的一项。现状：`take_screenshot` 只返回路径（`systemTools.ts:113-133`），模型看不到屏幕；没有 UIA、窗口矩形和 DPI 处理。**不要直接接 Windows-MCP**：现有客户端把非文本内容 `JSON.stringify` 成文本（`McpManager.ts:163-165`），截图进不了视觉输入；MCP 工具一律危险（`:152`），每步弹窗；它还要求 Python 3.14+（[Windows-MCP](https://github.com/CursorTouch/Windows-MCP)，用户数和延迟均为自报）。更合适的是自写只读 skill：截图输出 `[[IMG:...]]`（`AgentService.ts:22`），UIA 读前台窗口树，放到 `skillsDirs`，不碰 dsh-plugin，但要在 `src/main` 自带种子逻辑。V4 Pro 不支持 Vision（[Pricing](https://api-docs.deepseek.com/quick_start/pricing)），要走视觉辅助路径。预期要压低：UFO2 的 UIA 加视觉混合在 WAA 上只有 27.9%，Operator 20.8%（[arXiv 2504.14603](https://arxiv.org/html/2504.14603)，2025 年旧模型，作者自评）；Qwen-CUA 纯截图在 OSWorld-Verified 上 86.2，换到 OSWorld 2.0 二元完成只有 18.5，且依赖大规模专门训练（[arXiv 2608.02352](https://arxiv.org/abs/2608.02352)，预印本）；8 位盲人用户三周的真实使用中最佳模型 52.5%（[arXiv 2609.00524](https://arxiv.org/abs/2609.00524)，预印本）。**没有找到 2026 年 Windows 上 UIA 与截图的直接对照。** 所以目标应该是“有确认的辅助操作”，不是自治。`key_combination` 的 `win` 缺陷（`inputTools.ts:47-58`，读代码可见 `win` 落入字面量发送，`win+d` 会被当作字符输入）属于**未在运行时复现的代码发现**，顺手修即可。

**第 8 项，文件检查点。** 现状：`write_file` 直接覆盖，`delete_file` 直接 `unlink`（`fileTools.ts:110-115`、`:214-221`），“重新生成”只回滚对话。外部依据：Claude Code 按回合做文件快照，但只跟踪其文件编辑工具（[Checkpointing](https://code.claude.com/docs/en/checkpointing)）。这个盲区要明说：注册表、进程、GUI 不在回滚范围内。删除改走回收站是最便宜的第一步。恢复界面先出预览。

**第 9 项，MXC 验证。** 本机是 Windows 11 Home China，[Windows Sandbox 不支持 Home 版](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-overview)，所以不要把它作为任何方案的依赖。MXC 于 2026-10-07 GA，process container 在 Windows 上用 AppContainer，并有 Permissive、Learning、Enforcement 三种模式（[MXC 公告](https://blogs.windows.com/windowsdeveloper/2026/10/07/microsoft-execution-containers-policy-driven-containment-for-ai-agents/)，无独立安全评估）。**它是否支持 Home 版、有没有 Node SDK、是否要求 package identity 都未查到**；WinAgent 是 portable exe，而 Windows 的 MCP 隔离明确排斥未打包应用（[Containment](https://learn.microsoft.com/en-us/windows/ai/mcp/servers/mcp-containment)）。花一天在这台机器上试，结论决定后面是否规划隔离。即使可行，模拟键鼠类工具也难以放进 process container（推断），分层方案是文件和脚本类进容器，操作当前窗口的继续强确认。

### 第三档：等第 2 项的数据或实际需求再做

**第 10 项，规范移出 system prompt。** 这是有条件的一项，只在第 2 项的数据显示规范变化确实造成明显未命中时才做，依据和风险见 Codex 一节。

**第 11 项，工具按需加载。** 现状：每轮全量发送约 62 个工具，内置部分粗算约 4,800 token（`ToolRegistry.ts:74-76`，字符/3 估算）。外部依据：Cursor 静态工具描述 token 降 60%，MCP 移到动态 context 后相关会话总 token 降 46.9%（[Cursor](https://cursor.com/blog/improved-token-efficiency)，厂商自报）；Hermes 约 19 个工具按需加载后 schema 约减半（[v0.22.0](https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.0)，自报）；Anthropic 的 85% 来自 2025-11 的内测和旧模型（[Advanced tool use](https://www.anthropic.com/research/advanced-tool-use)）。我的判断是，WinAgent 的理由不是省钱而是选工具的准确率：按 Flash 未命中价，4,800 token 每次请求约 $0.0014，而 README 自己承认小模型在 40 多个工具时会“忘记”或“编造”工具名（`README.md:101`）。动态改变 `tools` 字段会破坏前缀，所以要保持列表确定，把发现工具做成常驻入口。先做一次按模型的对照，不要假设前沿模型上的结论适用。

**第 12 项，MCP 客户端。** 现状：手写客户端停在 `2024-11-05`，没有 SSE、会话和 OAuth（`McpManager.ts:24`、`:98-124`）。[MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog) 已移除 initialize 握手并弃用 Roots、Sampling、Logging。新版 server 的实际兼容情况未测。若你用得上远程 MCP 就提前，否则放后。

### 第四档：新能力，建立在前几档之上

**第 13 项，Goal 与预算。** `/goal` 已是 Claude Code、Codex、Antigravity、Cursor 的共同基线（[Claude Code](https://code.claude.com/docs/en/changelog)、[Codex](https://learn.chatgpt.com/docs/changelog)、[Antigravity](https://antigravity.google/blog/introducing-google-antigravity-2)、[Cursor](https://cursor.com/changelog/page/2)），但都没有公开效果数据。WinAgent 现在没有计划视图，也没有预算上限（`AgentService.ts:164-176`）。驱动可以放在 `src/main` 反复调用 `process()`，完成判定必须走 taskChat，并优先用确定性验收（文件存在、退出码），无法判定就标 UNVERIFIED，这是 [DeerFlow 2.1](https://github.com/bytedance/deer-flow/releases/tag/v2.1.0) 的做法，也补上规范检查不读产物的缺口（`RuleService.ts:99`）。界面要先出预览。

**第 14 项，定时与触发。** 现状：关窗即退（`src/main/index.ts:871-874`），单任务（`AgentService.ts:516`），只有 `raw/` 文件监听这一个触发器。这是唯一完全符合“新功能做在 `src/main`”的大项，但必须排在第 3 项之后，否则 `http_request` 会在无人值守时畅通无阻。应照搬三条：无人值守默认拒绝危险操作（[Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/security)）；忙碌时持久排队（[DeerFlow 2.1](https://github.com/bytedance/deer-flow/releases/tag/v2.1.0)）；主动行为默认 observe，只记录“本来会做什么”（[002 Authorization](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md)）。语义过滤属于后台调用，走 taskChat。托盘和任务面板先出预览。

**第 15 项，记忆。** 现状：跨对话只有 Wiki 和人设，没有“记住这件事”。外部证据大多是负面的：文件加 grep 在 LoCoMo 上 74.0%，高于 Mem0 报告的 graph 版 68.5%（[Letta](https://www.letta.com/blog/benchmarking-ai-agent-memory/)，利益相关方，较早）；记忆会让本可解决的任务失败，原始轨迹比压缩记忆更省步数（[MemDev-Bench](https://arxiv.org/abs/2610.27524)，预印本，编码场景）；记忆与 skill 冲突时 89% 的运行不告诉用户（[arXiv 2610.33128](https://arxiv.org/abs/2610.33128)，预印本）；记忆形成的 5 个接口都能被投毒（[MemForm](https://arxiv.org/abs/2610.14431)，预印本）。所以只做最小版：照 [Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory) 用有字符上限的文件，会话开始时冻结注入，写入只来自用户明确指令，不做向量、图和自动整合。干净落点是 `systemMessage`，走 `petPrompt` 虽然不碰 dsh-plugin，但会污染人设语义。

**第 16 项，`prompt_cache_key`。** 排在最后，理由见 Codex 一节。

## `reasoning_content`：文档比笔记更严，代码确实不回传，实测仍是空白

**已确认的部分。** 代码层面，`sanitizeMessages` 组装 assistant 消息时只放 `role`、`content`、`tool_calls`，并留有注释“不发 reasoning_content（Ollama 不认识）”（`OpenAIClient.ts:61-64`）；`AgentService.ts:656` 把它存进了历史，但对所有 provider 都不发送。注释只说明了 Ollama 的理由，而这个行为同样作用于 DeepSeek。文档层面，我今天用 curl 读了笔记引用的页面，措辞比笔记转述的 “should” 更严：带 `tools` 的请求，后续所有请求都必须完整回传 `reasoning_content`，包括没有调用工具的回合，“the API will return a 400 error”（[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)）。配置层面，思考默认开启（同页）；`thinkingMode` 默认 `auto` 不下发任何参数（`ConfigStore.ts:156`、`OpenAIClient.ts:100`）；主循环每轮都带 `tools`（`AgentService.ts:583`、`:593`）；2026-09-28 的记录显示当时用户配置的 `deepseek-flash` 默认确实返回思考内容（`docs/wiki-live-test-checkpoint.md:5`）。

**未确认的部分。** 没有人实测过这条路径。README 记载的真实 API 验证走的是 taskChat（`thinking: 'off'`、不带工具），`diagnose:model` 的探测也不带 `tools`（`scripts/diagnose-model.cjs:44-47`）。我只统计了本机日志和对话存档的结构，没有读内容：`%APPDATA%\com.winagent.app\Logs` 里 2026-09-06 至 09-29 的 7 个日志**没有一条 `[TOOL CALL]`**，唯一的 400 是 `max_tokens` 范围错误，4 个对话存档里也没有同时带 `reasoning_content` 和 `tool_calls` 的助手消息。所以本机记录既不能确认也不能否定。结论：**按文档推断，`deepseek-flash` 加 `auto` 思考时，工具循环的第二次请求应当返回 400；但这还不能算已证实的 bug**，文档与线上行为可能不一致。

**下一步很便宜。** 在 app 里用 DeepSeek、思考设为自动，发一条会触发工具的消息（例如“列出桌面文件”）。失败是响亮的，界面会显示 `LLM 请求失败 [400]`。如果确实报错，修法是按 provider 回传（只要 `sanitizeMessages` 能拿到 provider 或能力标记），Ollama 和不认识该字段的网关继续不发，同时加一条带 `tools` 的回归测试，把工具路径补进 `diagnose:model`。在修复前，把思考设为“关闭”应能绕开（`applyThinking` 会下发 `thinking.type: disabled`），这同样未测。顺带核对预设：`ConfigStore.ts:138` 的默认模型仍是 `deepseek-chat`，而我抓取的价格页文本里已经没有这个名字。估算侧也有小偏差：`ContextManager.ts:36` 把 `reasoning_content` 计入 token，但它当前并未发送。

## Codex 切模型保留缓存：对话能留，跨模型缓存没有证据

**先看 Codex 本身（本节 Codex、OpenAI、DeepSeek 和 WinAgent 的事实均于 2026-11-03 直接核对一手来源和代码）。** Codex 的 `prompt_cache_key` 由 session ID 派生，与模型无关（`codex-rs/core/src/client.rs:714-735`，main 分支；changelog #33035）；模型变化会记为 `model_changed`（`client.rs:468-469`），这段逻辑涉及 `previous_response_id` 引用的上下文。OpenAI 文档说缓存存的是 KV 张量，并写明 “A different model can use different weights and caching behavior”（[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)）。这份文档和 [Codex changelog](https://learn.chatgpt.com/docs/changelog) 都没有跨模型复用的说法。结论是：**跨不同模型复用缓存没有任何证据支持**；切回原模型后命中是合理的，但只是未经测试的推断。你看到的现象可能是另一件事：GPT-6 模型上 `configuration_update` 输入项可以改 reasoning effort 而保留前缀（同见 [API changelog 2026-09-03](https://developers.openai.com/api/docs/changelog) 的中途调整 effort 条目），它只改 effort，不改模型。WinAgent 只走 `/chat/completions`（`OpenAIClient.ts:44-48`），用不上这条 Responses API 路径。

**DeepSeek 也不给承诺。** 文档描述了自动前缀缓存和 `prompt_cache_hit_tokens` 字段，但没有说不同模型是否共享缓存（[Context Caching](https://api-docs.deepseek.com/guides/kv_cache)）。

**WinAgent 现状。** 对话历史与 provider 分离，provider 每次发送时读取（`AgentService.ts:518`）；界面切换只改配置，运行中禁用（`App.tsx:355-370`、`:697`）。所以切模型后对话应当保留，这一点**未在 app 中试过**。切换后的已知风险有两个：历史里的图片在不支持 Vision 的模型上会走已有的降级重试（`AgentService.ts:606-619`）；切入 DeepSeek 思考模式时，来自其他模型的回合没有 `reasoning_content`，API 怎么处理未知。缓存这边有四个事实：规范拼进 system 消息（`AgentService.ts:581`），且每条用户消息都按意图重新匹配（`RuleService.ts:72-79`），所以一次规范变化会让整个前缀失效；压缩截断旧工具结果（`ContextManager.ts:81`），同样重写前缀；没有发送 `prompt_cache_key`（`OpenAIClient.ts:191`）；`parseUsage` 丢弃缓存字段（`OpenAIClient.ts:124`），命中率今天不可见。好消息是 `systemMessage` 里没有时间戳（`AgentService.ts:196-235`），笔记担心的那类动态内容我已核对不存在。

**建议顺序待你决定，放进总排名后是这样。**（1）命中率统计，总排名第 2，不花钱、不碰 dsh-plugin，是其余决定的依据。（2）规范移出 system prompt，总排名第 10，**有条件**：只有统计显示规范变化确实造成明显未命中才做。依据是原型把 Policy 段放在提示词最后以保持前文不变（[004 Prompts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/004-prompts.md)）和 Cursor 冷缓存未命中降 20%（[Cursor](https://cursor.com/blog/improved-token-efficiency)，厂商自报）。风险在于规范现在有“每轮注入、压缩后保留”的测试（`tests/wiki-workspace.test.cjs:191-216`），而预印本发现指令胜负更像由位置决定（[arXiv 2610.33128](https://arxiv.org/abs/2610.33128)），挪位置可能改变合规性，要用规范检查做回归。（3）可选 `prompt_cache_key`，总排名第 16：可在 `chatFetcher` 注入并对拒收的网关回退，但它是 OpenAI 的字段，DeepSeek 文档没有提到，对单用户的收益未知。

**量级上别高估。** 按[价格页](https://api-docs.deepseek.com/quick_start/pricing)的峰时价做个上界算术（我的计算，假设每次请求 30K token、25 轮、全部命中或全部未命中）：Flash 约 $0.0045 对 $0.225，Pro 约 $0.033 对 $0.99。比例悬殊，但在 Flash 上单个长任务最多也只省约 20 美分，用 Pro 才接近 1 美元。这也是统计排在优化前面的原因。另一个可以零代码试验的杠杆是压缩阈值：`compactThresholdTokens` 固定 24000（`ConfigStore.ts:145`，设置页未暴露），而 DeepSeek 上下文是 1M（[Pricing](https://api-docs.deepseek.com/quick_start/pricing)）。阈值太低会频繁重写前缀。这是推断，等有了命中率数据再调。

## 这一轮真正新的东西，大多是把控制权从模型移到结构

**Super-agent 的价值在思路，不在代码。** 仓库 `deepseek-ai/dsh-superagent-prototype` 于 2026-10-31 创建，README 开头就声明 “Research prototype for reference only, not an official DeepSeek product”（[README](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/README.md)），与 ByteDance DeerFlow 的 “SuperAgent harness” 无关。[设计文章](https://mp.weixin.qq.com/s/zoS7GlReWPhfCjENGxXCdg)的论点是，多任务上限取决于人的注意力，于是用常驻 Router 分派、隔离的 Worker 执行。**合成负载**（编码工作用只消耗时间的工具代替，每方案 5 次）下，它的 p95 为 15.7 分钟，单 Session + Subagent 为 29.5 分钟；这只说明调度，不说明代码产出更好，也没有显著性检验。最有用的是一个定性结果：中性提示下模型 5 次运行 0 次委派，说明分工要靠结构而不是劝说。原型与文章也有落差：文档中找不到 Watchdog 和云端存算分离，运行身份是 `danger-full-access`，官方说 “not a security boundary”（[003](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md)）。可以直接拿走的是几条便宜的纪律：权限通道和上下文通道分开、外部文本只是数据（[002](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md)）、observe 模式、先存储后执行。

**其他值得留意的方向有四个。** 第一是可验证执行：DeerFlow 2.1 给工具调用盖回执，由父侧确定性校验验收条件（[v2.1.0](https://github.com/bytedance/deer-flow/releases/tag/v2.1.0)，未见效果评估）。第二是 harness 瘦身：Cursor 精简系统提示约 66%，合计降本 7%，质量未降（[Cursor](https://cursor.com/blog/improved-token-efficiency)，厂商自报），但 Anthropic 的复盘说明同类改动也会伤质量，所以能删的前提是有回放对比。第三是分类器审批加环境隔离：auto mode 约 17% 的过度行为漏过，官方明确不能替代沙箱（[How we contain Claude](https://www.anthropic.com/research/how-we-contain-claude)，厂商自报）。第四是安全事故本身就是证据：ZCode 被曝静默上传工作区（单一研究者捕获，未见独立复现，[ferstar](https://blog.ferstar.org/en/posts/zcode-silent-workspace-snapshot-upload/)），说明宿主层 sidecar 不经过 agent 权限系统；OpenCode Console 暴露第三方 key（[HN 转述](https://news.ycombinator.com/item?id=50133401)）；OpenClaw 722 条公告中有审批过期和审批扩权两类值得警惕（[Advisories](https://github.com/openclaw/openclaw/security/advisories)，数量多也反映披露活跃，不能换算成更不安全）。

**明确不做或后置的。** Router/Worker 和子代理：优势出现在高事件率的合成负载，WinAgent 的确认弹窗是单槽（`useAgent.ts:56`），事件也没有 agent 标识，个人桌面场景没有数据支持。Code Mode 和 Programmatic Tool Calling：会绕过逐工具审批，要等隔离到位，[98.7%](https://www.anthropic.com/research/code-execution-with-mcp) 这类数字也没有实验方法。此外还有云端 Agent Loop、公开技能市场、自动记忆整合、完整 CaMeL、Cascade/Critique（[Fusion](https://github.blog/changelog/2026-10-28-route-and-orchestrate-models-with-github-copilot-fusion) 的数字是自报）、手机远程控制，以及 A2A 和 AG-UI。

**已具备、从建议中去掉的。** SKILL.md 与 manifest 双格式、两阶段压缩且规范不丢失、taskChat 后台防线、证据校验的规范编译与哈希版本校验、带引用的 Wiki 与自动 RAG、可取消可续跑的导入作业、运行中切换查看、渲染层 CSP 与 Markdown 清洗、多 provider 切换。桌面版也没有本地 HTTP 服务（`server.ts` 只在插件形态可用），所以 OpenCode 和 Cline 栽过的跨站本地端口问题暂不适用，将来做网关时要记得校验 Origin。

## 证据的局限决定了哪些结论能信到什么程度

**检索受限。** WebSearch 和 WebFetch 全程因 `glm-5.1` 模型错误失败，研究员改用内置浏览器、`gh api`、HN Algolia 和 curl 读取已知页面。这意味着选题靠官方 changelog、GitHub 和 HN，只发在媒体或个人博客上的内容可能遗漏。**中文科技媒体和 Reddit 基本没有覆盖**：36氪被 WAF 拦截，量子位返回 403，机器之心没有正文，Genspark 官网返回 403。**开源与中国这一段因此最弱**：我们能说明 Kimi、Qwen、ZCode、MiniMax、DeerFlow 的仓库和文档写了什么，但说不清中国区的真实采用、用户口碑和第三方评测，Super-agent 的中文反响也是未知数。star 数未做刷量审计，HN 热度偏向英文开发者社区，厂商 harness 的默认模型推荐也不算中立。因此“这些机制存在且如何工作”的结论较可靠，“哪个产品有牵引力”的判断不可靠，涉及国内模型和网关的行为差异需要你自己测。

**什么都没有运行。** 没有构建或运行 WinAgent，没有运行任何外部 harness，也没有发出模型请求。`key_combination` 缺陷、`read_file` 加 `http_request` 外泄链、`reasoning_content` 问题、切模型保留对话，全部是读代码和读文档的结论。我额外做的只有三类只读核对：读相关代码，curl 读取 DeepSeek 的 Thinking Mode、Tool Calls、Context Caching、Pricing 页，以及对本机日志和对话存档做只计数的结构统计（未输出内容，未读 `config.json`）。MXC 公告我用 curl 重读时返回 403，相关内容以研究笔记为准。

**数字不能直接外推。** 厂商数字几乎都来自前沿模型和自家 harness，没有找到第三方复现；Super-agent 的数据是合成负载；arXiv 条目除 UFO2 外只读了摘要，均为预印本，安全防御类结果还普遍缺少自适应评估。OpenAI 兼容网关之间对缓存字段、并行工具、`reasoning` 字段的支持差异没有调查。工作量和优先级是我的判断，不是实测。

## 结论

调研前的直觉是“WinAgent 落后于多代理和常驻服务的新潮流”，对照代码后结论变了：差距不在新潮流，而在每家都已默认具备的底座，且这些底座恰好全压在被暂停的目录里。Super-agent 最有价值的启示同样指向这里：可靠的行为要由结构保证，不能靠提示词劝说模型。这条原则用在安全上是硬拒绝和白名单，用在缓存上是稳定前缀，用在任务上是确定性验收。

Codex 那个问题也有类似的翻转：值得追的不是“跨模型缓存”这个没有证据的能力，而是先让命中率可见，因为按当前价格，WinAgent 在 Flash 上单个长任务的节省上界只有约 20 美分。本周可以先做三件事：手测一次 DeepSeek 工具循环，加上命中率统计，决定是否窄幅解除暂停。前两件的结果可能直接改变后面的排序。
