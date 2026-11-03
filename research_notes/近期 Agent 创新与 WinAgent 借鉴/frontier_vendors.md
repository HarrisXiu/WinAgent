# 前沿厂商近期 Agent 产品与平台创新（截至 2026-11-03）

> 读法：标注「较早背景」的条目早于 2026-05；其余都在 2026-05 至 2026-11 窗口内。所有数字都是厂商自报，除非另有说明。工具受限情况见最后一节 Gaps。

## Anthropic：Claude Code、Agent SDK、Skills、subagents/agent teams、hooks、Managed Agents、memory、computer use、context management 有什么新东西？

### Takeaway
Anthropic 的新东西分两层：Claude Code 客户端在做「长任务 + 编排 + 自动审批」（`/goal`、agent view、dynamic workflows、auto mode、idle compaction）；Claude Platform 把同样的能力做成托管 API（Managed Agents 的 session、memory store、Dreams、Outcomes、advisor、budget、workflow run）。前者的机制大多可以照抄，后者的接口形状值得借鉴，但实现绑定 Anthropic。

### Cited Findings

**Claude Code：长任务与编排**
- 2026-05-11（2.1.139）新增 `/goal`：设定完成条件，Claude 跨 turn 持续工作直到满足，可在交互模式、`-p` 和 Remote Control 中使用，并实时显示耗时、turn 数、token 数 — [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- 2026-05-11（2.1.139）新增 agent view（research preview）：所有 session 的单一列表，按运行中、等待用户、已完成区分；2026-05-19（2.1.144）后台 session 可通过 `/resume` 恢复 — [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- Dynamic workflows：我找到的最早相关条目是 2026-05-29（2.1.157）的「Workflow keyword trigger」设置；2026-07-06（2.1.202）增加 small/medium/large 规模设置，文档明确它是建议值而非硬上限，同日增加 `workflow.run_id` 等 OTel 属性；2026-07-24 增加 `workflowSizeGuideline` 配置键 — [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- 2026-10-03（2.1.289）mod 可用 `agent.spawn` 启动 teammate，并在 `$.agent.list()` 中暴露 idle 和 waiting 状态；agent teams 本身是 2026-02-05 的 research preview（较早背景） — [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- 2026-11-03（2.1.317）`SendMessage` 发给运行中的后台 agent 时送达更早：其正在运行的命令被移到后台而不是被终止 — [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- 2026-10-31（2.1.316）新增 `CLAUDE_CODE_SUBAGENT_EFFORT`；2026-11-03 起，与主对话模型不同的 subagent 使用该模型自己的 effort 设置或默认值，而不继承 session 的 effort — [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- 2026-08-07（2.1.224）新增 `claude self-hosted-runner`，让 web、移动端、桌面端 session 运行在用户自己的机器或容器上（Team/Enterprise） — [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- 2026-10-01（2.1.287）内置 mod「You should know」：一个旁路 agent 监视会话并提示用户或 Claude 可能漏掉的事 — [Claude Code changelog](https://code.claude.com/docs/en/changelog)

**Claude Code：context 与成本**
- 2026-10-14（2.1.299）idle compaction：200K+ token 的对话闲置约 54 分钟后，在 1 小时 prompt cache 过期前压缩，避免下一条消息重新处理全部内容；2026-10-30（2.1.314）扩展到 VS Code 和桌面端 — [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- 2026-10-09（2.1.296）subagent frontmatter 增加 `autoCompactWindow`，subagent 可比主对话更早压缩；2026-08-27 增加 per-agent 的 `experimental.cacheTtl`（5m/1h） — [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- 2026-09-04（2.1.261）`/skill-doctor`：显示哪些已加载 skill 没被使用以及占用多少 context；2026-09-25（2.1.283）`/doctor prompt-audit`：审计 CLAUDE.md、skills、agents、commands 中为旧模型写的提示模式 — [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- 2026-09-11（2.1.269）`claude plugin eval`：对插件跑 eval 套件，输出可复现的评分（JSON + HTML） — [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- 2026-11-03（2.1.317）移除 Read 工具的「文件自上次读取未变化」占位返回，重复读取未变文件现在返回内容；changelog 未说明原因 — [Claude Code changelog](https://code.claude.com/docs/en/changelog)

**Claude Code：权限、hooks、安全**
- auto mode（基于分类器的审批）持续加规则：2026-09-01 增加 Containment Escape 规则（云元数据凭据获取、egress 规避、跨租户访问不再自动批准），2026-08-25 增加规则编辑 UI，2026-10-16 可指定分类器模型（`CLAUDE_CODE_AUTO_MODE_MODEL`），2026-10-15 OTel 中可区分分类器决定与权限规则 — [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- 2026-10-30（2.1.314）`permissions.blockWritesOutsideWorkingDirectories`：所有权限模式下都拒绝写工作目录之外的路径 — [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- 2026-06-15（2.1.178）权限规则支持 `Tool(param:value)` 匹配工具入参，例如 `Agent(model:opus)` 禁止 Opus subagent — [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- Hooks：2026-05-11 PostToolUse 的 `continueOnBlock`，把拒绝原因反馈给模型并继续 turn；2026-10-27 prompt/agent hooks 限制为每 session 最多 24 个并发；2026-11-03 Agent SDK hook callback 新增 `onFailure: "block"`（失败即阻断，fail-closed） — [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- 2026-11-03（2.1.317）网页或 shell 工具调用要把账号邮箱发到网络前会询问 — [Claude Code changelog](https://code.claude.com/docs/en/changelog)

**Claude Platform / Managed Agents（托管）**
- 2026-05-06：Multiagent orchestration 和 Outcomes 进入 beta；webhooks 上线；Dreams 进入 research preview —— dream 读取一个 memory store 和历史 session transcript，产出重组后的新 memory store（合并重复、替换过时条目、提炼新洞见） — [Claude Platform release notes](https://platform.claude.com/docs/en/release-notes/overview)
- 2026-05-19：self-hosted sandboxes；工具输出超过 100K 字符（约 25K token）时自动落盘到 sandbox，模型只收到截断预览和文件路径 — [Claude Platform release notes](https://platform.claude.com/docs/en/release-notes/overview)
- 2026-06-09：scheduled deployments（cron）和 vault 环境变量凭据；2026-06-30：凭据 `injection_location`，在 egress 时替换到请求头或请求体；event deltas 流式预览 — [Claude Platform release notes](https://platform.claude.com/docs/en/release-notes/overview)
- 2026-08-07：session budget，达到硬上限时以 `budget_reached` 暂停，调整预算后可恢复；advisor，主线程可在 turn 中咨询更强的模型；可从挂载的 GitHub 仓库 `.claude/skills` 自动发现 skills — [Claude Platform release notes](https://platform.claude.com/docs/en/release-notes/overview)
- 2026-08-19：Agent Skills 和 `/v1/skills` 结束 beta；self-hosted sandbox 可挂载 memory store（worker 下载到 `mount_path` 并回写改动） — [Claude Platform release notes](https://platform.claude.com/docs/en/release-notes/overview)
- 2026-09-03：`ant apply`，从仓库文件声明式创建 agents、environments、skills、memory stores、deployments，并写 lockfile；2026-09-10：permission policy 增加 `auto`（服务端评估，放行、拒绝或暂停等审批），`ant beta:sessions connect` 把终端接到 session — [Claude Platform release notes](https://platform.claude.com/docs/en/release-notes/overview)
- 2026-09-14：Messages API 按需 compaction（beta）：返回带签名的 compaction block，后续请求用它替换被压缩消息；可后台运行，可保留最近若干 turn 原文 — [Claude Platform release notes](https://platform.claude.com/docs/en/release-notes/overview)
- 2026-10-07：`web_fetch` 只能抓取 session 中此前已出现过的 URL（用户消息、搜索结果、已抓取页面），模型自己输出的、system prompt 里的、bash/MCP 输出里的 URL 都不算，用于降低数据外泄风险 — [Claude Platform release notes](https://platform.claude.com/docs/en/release-notes/overview)
- 2026-10-07：Python/TS SDK 提供 browser use 和 computer use 工具类（beta）：继承后按工具写方法，对接自己的自动化，SDK 负责工具循环、URL/文件策略和审批回调 — [Claude Platform release notes](https://platform.claude.com/docs/en/release-notes/overview)
- 2026-10-09：Managed Agents dynamic workflows（beta）：agent 可写一个程序，分阶段运行多个 agent 并汇总结果，服务端后台执行，通过 `workflow_run.*` 事件跟踪 — [Claude Platform release notes](https://platform.claude.com/docs/en/release-notes/overview)
- 2026-10-14：OpenTelemetry 导出（beta），覆盖 Messages API 和 Managed Agents — [Claude Platform release notes](https://platform.claude.com/docs/en/release-notes/overview)
- 2026-11-02：message threads（beta）：服务端保存对话，后续请求只发新消息；thread 在最后一次请求后 5 分钟过期 — [Claude Platform release notes](https://platform.claude.com/docs/en/release-notes/overview)
- 2026-10-15：Models API 暴露 `capabilities.thinking.types.between_tools`，2026-10-06 暴露 `capabilities.server_tools`，客户端可按模型能力决定功能开关 — [Claude Platform release notes](https://platform.claude.com/docs/en/release-notes/overview)

### Inferences
- Claude Code 和 Managed Agents 正在收敛到同一组原语：goal/outcome、workflow、advisor、budget、auto 审批、memory。这组原语本身可以视作「harness 功能清单」。
- 把「workflow 规模」做成建议值而非硬上限，以及把 fail-open 改成可选 fail-closed，说明厂商在把控制权逐步交给配置，而不是写死在提示词里。

### Gaps
- 没有拿到 dynamic workflows 在 Claude Code 中首次发布的确切版本和日期，只有最早的相关设置条目。
- 未单独核实 Claude Agent SDK 的独立 changelog；上面的 SDK 信息来自 Claude Code changelog 和 Platform release notes。
- 未读 Outcomes、Dreams、memory store 的详细文档，只有 release notes 的描述；auto memory 的客户端实现细节未核实。
- Claude Code changelog 条目有几百条，我按关键词筛选后再抽样阅读，可能遗漏重要条目。computer use 在 Claude Code 客户端的进展未专门核实。

## OpenAI：Codex（app/CLI）、Agents SDK、Responses API、AGENTS.md、ChatGPT agent、后台/云任务、automations 有什么新东西？

### Takeaway
OpenAI 在两个方向上推进：一是产品合并（Codex 并入 ChatGPT 桌面端，加上 Remote、Computer Use、事件触发任务）；二是 API 上移（2026-09-10 的 Agents API 托管 Codex harness，同时 Agent Builder 和 Evals 平台被宣布弃用）。对第三方最实用的是 Responses API 的长任务控制和缓存诊断，但这些在 Chat Completions 兼容接口上不一定存在。

### Cited Findings

**API 与 SDK**
- 2026-09-10：Agents API 公开 beta：托管 Codex harness，OpenAI 负责 session 编排、context compaction 和恢复；durable sessions、可接自有工具和 MCP；可用 OpenAI 托管 sandbox，也可接自有或第三方 sandbox — [OpenAI API changelog](https://developers.openai.com/api/docs/changelog)
- 2026-09-29：Agents API 增加 computer use（OpenAI 托管浏览器，网站审批和登录由应用处理）；2026-10-09：sandbox 可预热，且只在活跃 turn 计费；2026-10-16：托管 sandbox 内置 Artifact SDK 和办公文档 skills — [OpenAI API changelog](https://developers.openai.com/api/docs/changelog)
- 2026-09-03：Responses API 新增 async tool calling（工具运行时模型继续工作，结果到了再返回）、mid-turn steering（经 WebSocket 在响应进行中发送指令）、中途调整 reasoning effort 且保留已缓存前缀 — [OpenAI API changelog](https://developers.openai.com/api/docs/changelog)
- 2026-07-09：GPT-5.6 带来 Programmatic Tool Calling、显式 prompt caching 控制、persisted reasoning，以及 Responses API 的 Multi-agent orchestration（beta）；2026-09-29 GPT-6.1 Sol 也支持 Multi-agent（beta），可在一个 Responses 请求内委派 subagent — [OpenAI API changelog](https://developers.openai.com/api/docs/changelog)
- 缓存工具链：2026-05-29 无 ZDR 的组织 `prompt_cache_retention` 默认改为 24h；2026-08-20 Prompt Caching dashboard；2026-09-08 Prompt Cache Diagnostics GA（对比前一次响应，给出未命中原因）；2026-10-20 12 小时缓存选项，写入价为输入价 2.5 倍 — [OpenAI API changelog](https://developers.openai.com/api/docs/changelog)
- 2026-10-06 Decisions API beta，2026-10-22 GA（`gpt-6-luna`）：把文本和图片转成类型化答案，宣称比 Responses API 快 10 倍，每请求最多 400 个问题 — [OpenAI API changelog](https://developers.openai.com/api/docs/changelog)
- 2026-06-03：宣布弃用 reusable prompt objects、Evals 平台和 Agent Builder — [OpenAI API changelog](https://developers.openai.com/api/docs/changelog)
- 2026-05-19：Secure MCP Tunnel（企业）：通过客户托管的 tunnel-client 连接私有 MCP 服务器；2026-05-06：Agents SDK TypeScript 版支持 sandbox agents 和内置开源 harness — [OpenAI API changelog](https://developers.openai.com/api/docs/changelog)
- 2026-10-15：Agents SDK Python 0.24.0：修复项包括「有待审批时推迟自动 compaction」「sibling 工具失败时保留已完成工具的输出」「工具回调失败后保留输出」「从无效 sandbox 工具参数恢复」 — [openai-agents-python releases](https://github.com/openai/openai-agents-python/releases)

**Codex / ChatGPT 桌面端**
- 2026-07-09（26.707）：Codex 并入 ChatGPT 桌面端（macOS、Windows）；2026-08-11 Linux 预览，并支持从 Claude Code、Claude Cowork、Cursor 导入配置和近期工作 — [ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog)
- 2026-06-25（26.623）：Codex Remote GA，手机上启动或继续连接主机上的任务并审批，使用一对一 QR 配对；2026-06-18：Record & Replay（macOS，把演示的流程变成可复用 skill）和本地/远程 thread handoff — [ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog)
- 2026-08-25：scheduled tasks 可由 Gmail、Slack、GitHub 事件触发；同日 Site tools（WebMCP），内置浏览器可使用网站提供的工具 — [ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog)
- 2026-06-11：Browser use 的 Developer mode，受控 CDP 访问；2026-06-16：Computer Use、Chrome 扩展、Memories 扩展到 EEA/UK/瑞士；2026-08-13：Computer History（macOS，opt-in，把跨应用活动转成 memories 和时间线） — [ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog)
- 2026-10-09：Composer predictions（beta）：Codex 回复后预测下一条消息，Tab 接受为可编辑草稿，不会自动发送 — [ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog)

**Codex CLI（日期取自 changelog 中条目所属版本）**
- 0.145.0（2026-07-21）：multi-agent V2 稳定（可配置 sub-agent 模型、reasoning、并发、角色）；`/import` 迁移 Cursor 和 Claude Code 的设置、MCP、插件、session、项目 memory；并发 skill/plugin 发现 — [ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog)
- Hooks：0.148.0（2026-08-18）hooks 可异步运行并调用 MCP 工具；0.150.0（2026-08-26）新增 Interrupt hooks — [ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog)
- `/goal`：0.142.2（2026-06-09）前后已可在 Codex Mobile 管理 goal；0.151.0（2026-08-29）嵌套 subagent 的 token 计入根 goal 预算 — [ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog)
- Guardian（模型审批审查）：0.151.0 修复「权限变化后旧分类结果仍可授权」；0.153.0（2026-09-03）审查历史在 compaction、重启、fork 后保留，并隔离 subagent 历史 — [ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog)
- 0.162.0（2026-10-08）：可为「自定义 Responses 兼容 provider」配置 live web access 和 remote compaction 能力 — [ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog)
- 0.165.0（2026-10-27）：新 profile 默认启用 memory v2，支持导入外部 agent 的 memory；0.166.0（2026-10-29）：`codex doctor --network-only`；修复 resume/fork 丢失 reasoning token 统计导致过早 compaction — [ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog)；[openai/codex releases](https://github.com/openai/codex/releases)
- 2026-09-05：移除 `codex mcp-server`，集成改用 Codex app server，但 app-server 仍标注为实验性、不支持生产负载 — [ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog)

### Inferences
- OpenAI 弃用 Agent Builder 和 Evals、转而推托管 harness，显示厂商判断 harness 比可视化搭建更有价值。这是我的解读，OpenAI 没有这样表述。
- Agents SDK 0.24.0 的修复项是一份免费的边界情况清单：compaction 不能打断待审批状态，部分工具失败不能丢弃其他结果。

### Gaps
- 未找到「ChatGPT agent」这一名称在窗口内的更新；changelog 中现在的产品名是 ChatGPT Work，两者关系未核实。
- 未找到 AGENTS.md 规范在窗口内的新版本信息；只有 2026-02 工程博客中的用法（较早背景）。
- Codex CLI 条目是从折叠内容中提取的，日期按所属版本标题推断。memory v2 和 Guardian 的具体机制未读文档。Responses API 的 multi-agent、Programmatic Tool Calling 也未读详细文档。

## Google：Gemini CLI、Antigravity、ADK、A2A 有什么新东西？

### Takeaway
Google 把 agent 重心从 Gemini CLI 转到 Antigravity（2.0 独立桌面端、CLI、SDK），Gemini CLI 收缩为企业 Code Assist 工具，近期更新以安全和可靠性为主。ADK 变成功能很密的开源框架，并且支持 OpenAI 模型；A2A 在 2026-03 的 1.0 之后只有补丁版本。

### Cited Findings
- 2026-05-19：Antigravity 2.0 发布，是不含 IDE 的独立桌面应用（macOS、Linux、Windows）；能力包括动态子 Agent、统一管理的异步任务、JSON 格式 Hooks、Cron 计划任务；对话按可对应多文件夹的「项目」组织，并强制执行项目级设置和权限 — [Antigravity 2.0 博客](https://antigravity.google/blog/introducing-google-antigravity-2)
- 同一发布的斜杠命令：`/goal`（持续运行不再请求中间输入）、`/grill-me`（编码前反问以对齐计划）、`/schedule`、`/browser`（因 agent 判断不准何时用浏览器，改为显式命令控制） — [Antigravity 2.0 博客](https://antigravity.google/blog/introducing-google-antigravity-2)
- Google 的表态：产品层、harness 层、模型层需要协同优化，并把 harness 接入 Gemini 训练与评估栈 — [Antigravity 2.0 博客](https://antigravity.google/blog/introducing-google-antigravity-2)
- 2026-06-18：免费和 Google AI Pro/Ultra 用户转到 Antigravity CLI；Gemini CLI 现在面向 Code Assist Standard/Enterprise，README 明确不针对 Gemini 4+ 优化，也不建议用于模型 benchmark，因为其 harness 未调优、分数不具代表性 — [gemini-cli README](https://github.com/google-gemini/gemini-cli)
- 2026-08-12：自定义 Agent：Markdown + YAML frontmatter，放在 `.agents/agents/` 或 `~/.gemini/config/agents/`，可限定模型、工具、skills 子集、MCP、hooks；`mainAgent: true` / `subagent: true` 让同一定义既能当主 agent 也能当子 agent（「执行对称性」） — [Custom Agents 博客](https://antigravity.google/blog/introducing-custom-agents)
- 该博客把自定义 Agent 的价值定位为控制 context：即使 skill 渐进加载，所有 skill 的描述本身仍占大量 context，因此按角色只暴露相关子集 — [Custom Agents 博客](https://antigravity.google/blog/introducing-custom-agents)
- 2026-08-27：Teamwork（`/teamwork-preview`，所有付费方案）：agent 在数小时至数天内互相提议、批判、改进；「模式」是规范说明而不是可执行程序，编排逻辑与 agent 描述分离，框架读取模式并按需动态决定 agent 数量；内置模式包括迭代式编码、分布式编码、长证明、自我验证等 — [Teamwork 博客](https://antigravity.google/blog/teamwork-when-ai-becomes-a-research-partner)
- Teamwork 的自报成果：解决七个开放问题，TCSBench 71%（内部测试最高），cycle-accurate RISC-V 模拟器可启动操作系统，向 Eigen、ParlayHash 上游合入优化。未独立核实 — [Teamwork 博客](https://antigravity.google/blog/teamwork-when-ai-becomes-a-research-partner)
- Antigravity 其他日期：2026-08-20 IDE 扩展，2026-08-21 Remote Control，2026-09-28 Google 插件中的自定义 Agent，2026-10-29 插件市场 — [Antigravity 博客索引](https://antigravity.google/blog)
- Antigravity App v2.28.0（2026-10-27）内置浏览器和 PDF 查看器；v2.26.0（2026-10-22）把问题和权限提示停靠在输入框上方，用户可继续输入 — [Antigravity changelog](https://antigravity.google/docs/changelog)
- Gemini CLI 按版本：v0.45（2026-06-03）简化 ContextManager；v0.50（2026-07-08）工具注册发现；v0.53（2026-07-28）eval 覆盖率报告、A2A server 强制 workspace trust、缓解无限 ReAct 循环；v0.59（2026-09-08）fail-closed workspace trust；v0.60（2026-09-15）环境变更需用户同意，对不可信工具输出强制 envelope 来源元数据；v0.63（2026-10-06）非交互模式自主执行 plan，限制工具输出大小；v0.64（2026-10-13）文件工具串行化和原子写，CLI 状态原子持久化并可从备份恢复，聊天记录改为 append-only delta 加有界窗口 — [Gemini CLI release notes](https://geminicli.com/docs/changelogs/)
- ADK Python：v2.10（2026-09-24）skill 生命周期（ephemeral、活跃 skill 上限，实验性），eval 指标覆盖耗时、token、模型调用次数，并适配 OpenAI reasoning 参数；无 eval case 时 `AgentEvaluator` 改为报错而不是通过 — [ADK v2.10.0](https://github.com/google/adk-python/releases/tag/v2.10.0)
- ADK：v2.11（2026-10-01）`abort_signal` 优雅取消，workflow 工具确认，`ModelConsultTool`（按 turn 和 session 限额咨询另一模型），SQLite memory；v2.12（2026-10-13）`after_tool_callback` 过滤工具输出，节点 `require_confirmation`，长 session 首请求延迟降 40%；v2.13（2026-10-22）12 个实验特性转稳定，分类器节点，MongoDB memory 用关键词召回、不需要 embedding，默认 OTel GenAI v2 — [ADK releases](https://github.com/google/adk-python/releases)
- A2A：v1.0.0（2026-03-12，较早背景）含 `tasks/list`、OAuth 流现代化（移除 implicit/password，增加 device code/PKCE）；v1.0.1（2026-05-26）是修复版，也是我读取时 releases 页面标注的 Latest — [A2A releases](https://github.com/a2aproject/A2A/releases)

### Inferences
- Gemini CLI README 主动声明「harness 没调优就不要拿来 benchmark」，等于官方承认同一模型换 harness 效果差异显著。
- A2A 近期没有新特性版本，对桌面单机 app 的优先级应低于 MCP（这是判断，不是厂商表述）。

### Gaps
- 未读 Antigravity CLI、SDK 的详细文档和 2026-05-19 的 feature deep dive；Antigravity changelog 页面默认只显示 App 分类。
- 未读 Google 关于 Gemini CLI 迁移的 transition post 原文，只有 README 的摘要。
- developers.googleblog.com 未访问，可能有 ADK/A2A 额外公告。

## 其他：Cursor、GitHub Copilot/Agent HQ、Microsoft 有什么新东西？

### Takeaway
Cursor 走向云端 fleet（Projects、Subscriptions、VM subagent、Origin 托管代码、Agent SDK），GitHub 在 2026-10-28 Universe 上集中发布 Fusion 模型路由、Automations 自我改进、Agentic Workflows GA。Microsoft 把 Copilot SDK 重塑为共享 harness，并用 Agent Framework 提供多 provider 的开源框架。

### Cited Findings

**Cursor**
- 2026-10-20：Agent SDK GA：agent 即代码目录（`instructions.md`、`tools/`、`skills/`、`mcp-connections/`、`channels/`）；channels 支持 GitHub/GitLab/Bitbucket、Slack、webhook、cron；`agent-sdk eval` 对工具调用、入参和回复结构做断言；`agent-sdk github replay <pr-url>` 把真实 PR 转成签名 webhook，可保存为 eval fixture — [Cursor changelog](https://cursor.com/changelog)
- 2026-10-16：云端 agent 可生成可分享的交互式画布；Environments API beta；环境最多支持 300 个仓库 — [Cursor changelog](https://cursor.com/changelog)
- 2026-10-06：iOS 远程控制本地 agent：agent 仍在电脑上运行，需桌面端批准配对，可开启「Keep this computer awake」，不依赖云端 agent — [Cursor changelog](https://cursor.com/changelog)
- 2026-09-23：Rollouts：PR 创建后写监控规划（风险、预期效果、信号、埋点缺口）到 PR 评论，用户可编辑；部署时对照日志、指标、trace，按环境报告已验证健康、回归或无法确定；目前不会自行合并或回滚。同日 Security Review bot — [Cursor changelog](https://cursor.com/changelog)
- 2026-09-10：Projects（beta）：协调 agent 不写代码，只规划、委派、交回成果；共享文件集在云端和本地机器之间同步，agent 持续写入研究成果和偏好；Subscriptions 让协调 agent 监听 Slack、定时或跟踪 PR — [Cursor changelog p.2](https://cursor.com/changelog/page/2)
- 2026-09-02：自托管机器与 worker 池：工具执行留在自己的网络内，闲置机器可休眠并在重连窗口内恢复；可运行在 AWS Lambda、Cloudflare、Daytona、Modal、E2B 等基础设施 — [Cursor changelog p.2](https://cursor.com/changelog/page/2)
- 2026-08-19：harness 改进：Subscriptions（agent 订阅事件源，有新动态时恢复）、自定义模式（把 skill 固定在聊天中）、subagent 各自运行在独立 VM、`/goal`、steering（后续消息等到下一次工具调用才送达，不打断执行） — [Cursor changelog p.2](https://cursor.com/changelog/page/2)
- 2026-08-17：Origin 代码托管早期 beta；2026-10-13：Origin 应用市场公开提交 — [Cursor changelog p.2](https://cursor.com/changelog/page/2)；[Cursor changelog](https://cursor.com/changelog)
- 2026-08-14：Cursor 被 SpaceX 收购；2026-09-21 发布 Grok 4.7 — [Cursor blog](https://cursor.com/blog)
- 2026-10-29：Cursor 安全公告标题称其 VS Code 扩展市场中发现恶意版本的 Anthropic.claude-code（2.1.312 和 2.1.313）。我只读到标题，未读正文 — [Cursor blog 索引](https://cursor.com/blog)

**GitHub Copilot（2026-10-28 均为 Universe 发布）**
- Copilot Fusion GA：不选单一模型，按 prompt 路由，提供三种工作流：Single；Cascade（便宜模型起草，质量检查后决定接受或升级到强模型）；Critique（一个模型起草，另一个审查，原模型修改）。GitHub 称 Fusion Max 在 Artificial Analysis Coding Agent Index 得 60 分，与 Claude Code + Opus 5.5 Max 相差 2 分以内，平均 API 成本约一半、token 约一半、时间少约 40%。自报，未独立核实 — [GitHub changelog](https://github.blog/changelog/2026-10-28-route-and-orchestrate-models-with-github-copilot-fusion)
- Automations 自我改进：用真实结果作反馈信号（人是否改了标签、是否接受评论、PR 是否被合并），每周一个 improvement automation 分析信号并提出对 prompt、工具、触发器的修改，须人工审核后才生效 — [GitHub changelog](https://github.blog/changelog/2026-10-28-copilot-automations-now-learn-from-outcomes-and-self-improve)
- Automations 增强：外部 API 触发，24 个新事件触发器，automation 可相互链式触发，自定义 MCP 工具，按 run/天/周/月设 AI credit 上限 — [GitHub changelog](https://github.blog/changelog/2026-10-28-new-tools-triggers-and-cost-controls-for-copilot-automations)
- Agentic Workflows GA：Markdown 编译成 Actions YAML，默认只读，运行在沙箱容器和 Agent Workflow Firewall 后，输出经 safe outputs 校验，并有独立 threat detection job；`gh aw forecast` 预估花费 — [GitHub changelog](https://github.blog/changelog/2026-10-28-github-agentic-workflows-generally-available)
- Agent Merge 集成到 PR：选择 Watch and fix 后，Copilot 在云端修 Actions 失败和合并冲突，可与 auto-merge 组合 — [GitHub changelog](https://github.blog/changelog/2026-10-28-agent-merge-watches-and-fixes-pull-requests-in-the-cloud)
- Copilot app：Projects（public preview，跨仓库的 goal、上下文和多 agent）；Computer Use（public preview，macOS 和 Windows，控制应用前需批准，组织可禁用） — [GitHub changelog](https://github.blog/changelog/2026-10-28-github-copilot-app-universe-releases)
- 2026-10-26：assisted permissions GA：LLM 评估命令、路径、URL 请求，明显安全的自动通过，其余需人工批准；企业可禁 Allow All 而保留 Assisted — [GitHub changelog](https://github.blog/changelog/2026-10-26-github-copilot-assisted-permissions-generally-available)
- 2026-10-07：本地沙箱 GA：基于 Microsoft eXecution Container (MXC)，把统一策略翻译成 Windows、macOS、Linux 原生控制；可限制文件、网络、Git/GitHub 凭据，也覆盖本地 MCP 和语言服务器；沙箱策略与模型无关 — [GitHub changelog](https://github.blog/changelog/2026-10-07-local-sandboxing-for-github-copilot-now-generally-available)
- 2026-10-01：dynamic workflows：用代码定义流程（顺序、并行、结构化结果传递、subagent 互相验证、checkpoint 暂停和恢复），区别于由模型动态委派的 `/fleet` — [GitHub changelog](https://github.blog/changelog/2026-10-01-dynamic-workflows-in-copilot-cli-and-the-copilot-app)

**Microsoft**
- 2026-10-28：GitHub Copilot SDK 转为 Microsoft Copilot SDK，成为 Microsoft 和 GitHub 产品共享 agent 基础的编程接口，迁移分阶段进行 — [GitHub changelog](https://github.blog/changelog/2026-10-28-github-copilot-sdk-is-becoming-microsoft-copilot-sdk)
- 2026-10-30：Agent Framework Python 1.24.0：实验性的 agent 触发 in-run compaction 和 skill 卸载（`AgentTriggeredCompactionStrategy`、`UnloadSkillsCompactionStrategy`），Agent Hooks middleware，本地 MCP 工具的显式默认审批模式；包列表包含 anthropic、bedrock、foundry、gemini、mistral、ollama、openai 客户端 — [agent-framework releases](https://github.com/microsoft/agent-framework/releases)

### Inferences
- `/goal`（Claude Code、Codex、Antigravity、Cursor）、远程控制本地 agent（Codex、Antigravity、Cursor）、LLM 审批分类器（Claude Code auto mode、Codex Guardian、Copilot assisted）、代码定义的 workflow（Claude Code/Managed Agents、Copilot），已经是多家共有的模式，可以视为新的基线。
- GitHub 把 `/fleet` 和 dynamic workflows 分开讲，是一个有用的产品区分：模型决定怎么编排，还是代码决定怎么编排。

### Gaps
- 未找到并核实 Agent HQ 在窗口内的官方更新，changelog 索引的 Copilot 标签页中未直接出现该名称；只看了 2026-10 的条目，9 月之前的 Copilot 条目未展开。
- 未读 Microsoft Copilot 产品本身或 learn.microsoft.com；Agent Framework 1.0 的发布日期未核实。MXC 是否开源或可供第三方使用未核实。
- GitHub changelog 中 Fusion 本地模型、plugin 默认设置、GitHub intelligence、Issue artifacts 我只看到标题。Cursor 2026-07-30 的云端环境搭建博客未读。

## 已发布的工程经验：harness 设计、context engineering、长任务模式、agent 评估、实测结果

### Takeaway
跨厂商最一致的结论是：harness 组件都是对模型弱点的假设，会随模型升级过期，要逐个移除并测量。实测数据最具体的是 Cursor 的 token 效率文章，安全数据最具体的是 Anthropic 的 containment 文章。

### Cited Findings

**窗口内**
- Cursor，2026-09-23，token 效率：多项改动合计把用户 token 成本降 7% 且质量未降。具体做法：
  - 精简系统提示约 66%（去掉一长串「不要」「必须」「重要」式指令，定义好工具行为，模型通常就会照做）— [Cursor 博客](https://cursor.com/blog/improved-token-efficiency)
  - 工具按需加载：多数工具真正用到的对话不足 20%；只把读、搜索、编辑、shell，以及 `ask_question`（部分模型容易幻觉调用）和 `create_plan` 留在静态 context，静态工具描述 token 降 60%；此前 MCP 工具移到动态 context 使调用过 MCP 的会话总 token 降 46.9% — [Cursor 博客](https://cursor.com/blog/improved-token-efficiency)
  - 提升缓存：工具和系统指令只放极少变动的内容，可变设置放到缓存断点之后的「幻影用户消息」（skills、subagents、环境信息），冷缓存未命中率降 20% — [Cursor 博客](https://cursor.com/blog/improved-token-efficiency)
  - Read 工具改为每 10 行标一次行号，缓存读取 token 降 1.6%，质量未降 — [Cursor 博客](https://cursor.com/blog/improved-token-efficiency)
  - 移除强烈鼓励用 subagent 的指令（模型已原生掌握）；subagent 仅在用户或 harness 明确指示时才换模型 — [Cursor 博客](https://cursor.com/blog/improved-token-efficiency)
  - 方法论：优化 harness 要靠大规模 A/B 测试；eval 快但往往代表困难问题，不反映真实请求分布；同时跟踪 token、成本、延迟、工具调用错误和整体用量 — [Cursor 博客](https://cursor.com/blog/improved-token-efficiency)
- Anthropic，2026-05-25，containment：
  - 遥测显示用户批准了约 93% 的权限提示，逐次审批存在疲劳，因此转向分类器加环境隔离 — [How we contain Claude](https://www.anthropic.com/research/how-we-contain-claude)
  - auto mode 约拦截 83% 的过度行为，约 17% 漏过，约 0.4% 良性命令被挡；官方明确它是沙箱内的一层防御，不能替代沙箱 — [How we contain Claude](https://www.anthropic.com/research/how-we-contain-claude)
  - Opus 4.7 在 Gray Swan ART 上单次攻击成功率约 0.1%，100 次自适应攻击后约 5–6% — [How we contain Claude](https://www.anthropic.com/research/how-we-contain-claude)
  - 原则：先在环境层做确定性隔离再在模型层引导；隔离强度匹配用户的监督能力（开发者和知识工作者威胁模型不同）；慎用自研组件，标准 hypervisor、syscall 过滤、容器运行时撑住了，自研部分暴露了缺陷 — [How we contain Claude](https://www.anthropic.com/research/how-we-contain-claude)
  - 工具输出即使工具可信也是攻击面；检查返回值的分类器可以是小而快的模型；凭据留在宿主 keychain，VM 只拿按 session 限权、可单独吊销的 token — [How we contain Claude](https://www.anthropic.com/research/how-we-contain-claude)
  - 前瞻风险：持久 memory 投毒（注入内容每次启动都被重新加载，需要 session 启动时的分类器）；subagent 输出如果被视为比原始工具结果更可信，会形成信任升级 — [How we contain Claude](https://www.anthropic.com/research/how-we-contain-claude)
- GitHub，2026-10-28：Cascade 和 Critique 是可复用的多模型工作流；Automations 用真实结果信号改进 prompt，变更由人审核（见上一节）— [Fusion](https://github.blog/changelog/2026-10-28-route-and-orchestrate-models-with-github-copilot-fusion)；[Automations](https://github.blog/changelog/2026-10-28-copilot-automations-now-learn-from-outcomes-and-self-improve)
- Google，2026-08-27：松散组织的 agent 会偏离正轨、盲目赞同早期错误并在其上继续构建，因此 Teamwork 让团队主动互相挑战，把模式规范与编排框架分离 — [Teamwork 博客](https://antigravity.google/blog/teamwork-when-ai-becomes-a-research-partner)

**较早背景（2026-05 之前，但仍被广泛引用）**
- Anthropic，2026-03-24，harness design：
  - 两个失败模式：context 填满后失去连贯性；自我评估时夸赞平庸工作 — [Harness design](https://www.anthropic.com/research/harness-design-long-running-apps)
  - 分离生成者和评估者：调教独立评估者变严格，比让生成者自我批判容易得多；评估者用 few-shot 校准，用 Playwright MCP 实际操作页面后再打分，把主观问题转成可打分标准 — [Harness design](https://www.anthropic.com/research/harness-design-long-running-apps)
  - planner 把 1–4 句 prompt 扩成 spec，只写产品和高层设计，避免早期技术细节错误级联 — [Harness design](https://www.anthropic.com/research/harness-design-long-running-apps)
  - 简化方法：一次性大砍难以判断什么是承重结构，改为一次移除一个组件并观察。evaluator 不是是否题：任务超出模型可靠单独完成的范围时才值得付费 — [Harness design](https://www.anthropic.com/research/harness-design-long-running-apps)
  - 实测：一个 DAW 构建 3 小时 50 分钟、$124.70，其中 planner $0.46，三轮 build 合计约 $113.85，三轮 QA 合计约 $10.39；QA 仍抓到桩实现 — [Harness design](https://www.anthropic.com/research/harness-design-long-running-apps)
- Anthropic，2026-04-08，Managed Agents：把 session（append-only 事件日志）、harness、sandbox 解耦：工具调用统一为 `execute(name, input) → string`；harness 崩溃后 `wake(sessionId)`、`getSession(id)` 恢复；session 不等于 context window，`getEvents()` 可按位置切片回读，压缩不再是不可逆决定；凭据永远不进 sandbox（Git token 在初始化时接入，MCP 经代理从 vault 取）；context resets 在 Sonnet 4.5 必要，到 Opus 4.5 成了累赘 — [Managed Agents](https://www.anthropic.com/research/managed-agents)
- Anthropic，2026-04-23，质量事故复盘：三个独立改动叠加造成退化：默认 effort 从 high 降到 medium；清理闲置 session 旧 thinking 的 bug 导致每个 turn 都清理，表现为健忘；减少啰嗦的系统提示指令损害编码质量。内部使用和 eval 起初都没复现 — [April postmortem](https://www.anthropic.com/research/april-23-postmortem)
- OpenAI，2026-02-11，harness engineering：约 100 万行、约 1,500 个 PR，由 3 名（后增至 7 名）工程师驱动，每人每天约 3.5 个 PR，单次运行常超 6 小时（自报）— [Harness engineering](https://openai.com/index/harness-engineering/)
  - AGENTS.md 约 100 行，当目录用，深度内容放结构化 `docs/`，并由 linter、CI 和定期 doc-gardening agent 维护新鲜度；执行计划和决策日志入库 — [Harness engineering](https://openai.com/index/harness-engineering/)
  - 自定义 lint 的报错信息直接写修复指令，注入 agent context；用不变量而不是微观管理实现；agent 在运行时看不到的知识等于不存在 — [Harness engineering](https://openai.com/index/harness-engineering/)
  - 每个 worktree 可启动独立应用实例和临时可观测性栈，让 agent 能查日志和指标、用 CDP 验证 UI — [Harness engineering](https://openai.com/index/harness-engineering/)
  - OpenAI 明确说明这种自主度依赖该仓库的结构和工具，不应假定可直接泛化 — [Harness engineering](https://openai.com/index/harness-engineering/)
- Cursor，2026-02-05，自动驾驶代码库：共享状态文件加锁让 20 个 agent 的吞吐降到 1–3 个的水平；单一 executor 身兼多职会异常（休眠、自己干活、过早宣称完成）；最终设计是递归 planner 加互不通信的 worker，worker 写交接说明（包含偏差、发现、顾虑）向上传递；移除 integrator 瓶颈；要求每次提交 100% 正确会导致严重串行化，接受小而稳定的错误率反而更好；freshness 做法是频繁从头重写 scratchpad 而不是追加；一周 1,000 万次工具调用，峰值约 1,000 commit/小时 — [Self-driving codebases](https://cursor.com/blog/self-driving-codebases)

### Inferences
- 经验之间存在张力。Cursor 精简系统提示、Anthropic 移除组件，说的是少即是多；但 Anthropic 的复盘说明一句减少啰嗦的提示就能损害质量。两者合起来的结论是：可以删，但必须有真实流量或回放对比来兜底。
- 这些实测大多来自强模型。对 OpenAI 兼容接口背后的弱模型，部分「模型已原生掌握」的结论未必成立，「去掉指令」要按模型分别验证。

### Gaps
- 没有找到第三方对上述数字的独立复现，全部视为厂商自报。
- OpenAI harness 文章的「熵与垃圾收集」后半部分、Cursor 文章的结尾、Harness design 的 V1 数据和 Managed Agents「Many brains」后半部分因截断未读全；containment 文章的三个隔离模式和事故细节未读全。
- Anthropic 2026-10-13 的「Redesigning source control」只读到摘要（合并量增长十倍以上，五个月迁移到自研版本控制）；Google 的 OS 构建博客、Cursor 2026-08-18「任意规模的 Git」未读。

## 哪些机制模型无关、可迁移到小团队桌面 app，哪些依赖专有基础设施？

### Takeaway
绝大多数高价值机制其实是 harness 里的普通代码：goal 循环、预算、工具按需加载、输出落盘、事件日志、审批分类器、代码定义 workflow。真正绑定厂商的是服务端状态和签名工件（compaction block、threads、托管 sandbox、Dreams 的托管形态），以及缓存控制这类依赖 provider 的能力。

### Cited Findings
以下「来源」说明机制出处；「可迁移性」判断是我的推断，不是厂商声明。

| 机制 | 出处 | 可迁移性（推断） |
|---|---|---|
| `/goal` + 完成条件 + 实时显示 turn/token/耗时；嵌套 subagent 计入根预算 | [Claude Code](https://code.claude.com/docs/en/changelog)、[Codex](https://learn.chatgpt.com/docs/changelog) | 模型无关，纯循环逻辑 |
| 独立评估者 + 可打分标准；实际操作产物后再评分 | [Harness design](https://www.anthropic.com/research/harness-design-long-running-apps) | 模型无关；成本高，按任务难度启用 |
| 工具输出超阈值落盘，只给预览和路径 | [Claude Platform 2026-05-19](https://platform.claude.com/docs/en/release-notes/overview) | 模型无关，易实现 |
| 工具和 skill 按需加载；按角色限定子集 | [Cursor](https://cursor.com/blog/improved-token-efficiency)、[Antigravity](https://antigravity.google/blog/introducing-custom-agents) | 模型无关；依赖模型会用搜索工具，需按模型测 |
| 稳定前缀 + 可变内容后置 | [Cursor](https://cursor.com/blog/improved-token-efficiency) | 排序技巧通用；显式断点、12h 缓存、诊断依赖 provider |
| Session 事件日志与 context 分离，append-only，可回放恢复 | [Managed Agents](https://www.anthropic.com/research/managed-agents)、[Gemini CLI v0.64](https://geminicli.com/docs/changelogs/) | 模型无关；本地 SQLite 或 JSONL 即可 |
| Idle compaction（缓存过期前压缩） | [Claude Code](https://code.claude.com/docs/en/changelog) | 压缩逻辑通用；时机依赖 provider 的缓存 TTL |
| 待审批期间推迟压缩；部分工具失败保留已完成结果 | [Agents SDK 0.24.0](https://github.com/openai/openai-agents-python/releases) | 模型无关，直接抄 |
| LLM 审批分类器 + 确定性规则；旧分类结果在权限变化后失效 | [Claude Code](https://code.claude.com/docs/en/changelog)、[Copilot](https://github.blog/changelog/2026-10-26-github-copilot-assisted-permissions-generally-available)、[Codex](https://learn.chatgpt.com/docs/changelog) | 模型无关；Anthropic 明确不能替代沙箱 |
| 只允许抓取会话中已出现过的 URL | [Claude Platform 2026-10-07](https://platform.claude.com/docs/en/release-notes/overview) | 模型无关，客户端即可强制 |
| Hook fail-closed；hook 并发上限 | [Claude Code](https://code.claude.com/docs/en/changelog) | 模型无关 |
| 代码定义 workflow（并行、结构化传递、checkpoint） | [Copilot](https://github.blog/changelog/2026-10-01-dynamic-workflows-in-copilot-cli-and-the-copilot-app)、[Managed Agents](https://platform.claude.com/docs/en/release-notes/overview) | 模型无关；开源参考有 [ADK](https://github.com/google/adk-python/releases) |
| Cascade / Critique 多模型工作流 | [Copilot Fusion](https://github.blog/changelog/2026-10-28-route-and-orchestrate-models-with-github-copilot-fusion) | 模式通用；质量检查器要自己建和校准 |
| Advisor / `ModelConsultTool`（带限额咨询强模型） | [Claude Platform](https://platform.claude.com/docs/en/release-notes/overview)、[ADK v2.11](https://github.com/google/adk-python/releases) | 模型无关，一个工具加预算即可 |
| 自我改进：结果信号 → 提议 prompt 修改 → 人工审核 | [Copilot Automations](https://github.blog/changelog/2026-10-28-copilot-automations-now-learn-from-outcomes-and-self-improve) | 模型无关；需要先有可观测的结果信号 |
| Memory 整理（合并重复、替换过时）；memory 带修改时间戳 | [Dreams](https://platform.claude.com/docs/en/release-notes/overview)、[Claude Code 2.1.214](https://code.claude.com/docs/en/changelog) | 概念可迁移，用后台任务实现；托管 API 不可用 |
| Skill 审计（未用 skill 及其 context 成本）；旧提示审计 | [Claude Code](https://code.claude.com/docs/en/changelog) | 模型无关 |
| 真实事件回放作 eval fixture；断言工具调用而不是只看文本 | [Cursor Agent SDK](https://cursor.com/changelog) | 模型无关，思路直接可用 |
| 从竞品导入配置和 memory | [Codex](https://learn.chatgpt.com/docs/changelog) | 模型无关；只需维护格式映射 |
| 问题和权限提示停靠，用户可继续输入；steering 在下个工具调用时送达 | [Antigravity](https://antigravity.google/docs/changelog)、[Cursor](https://cursor.com/changelog/page/2) | 模型无关，纯产品交互 |
| 手机远程控制本地 agent，配对 + 防休眠 | [Cursor](https://cursor.com/changelog)、[Codex](https://learn.chatgpt.com/docs/changelog) | 模型无关，但需要中继服务和移动端，小团队成本高 |
| 本地沙箱跨平台策略 | [Copilot MXC](https://github.blog/changelog/2026-10-07-local-sandboxing-for-github-copilot-now-generally-available) | 模型无关，但 Windows 上实现难；MXC 可用性未核实 |

**依赖专有基础设施或特定 API（只能借鉴形状）**
- 签名 compaction block、message threads、between_tools thinking — [Claude Platform](https://platform.claude.com/docs/en/release-notes/overview)
- Agents API 托管 harness 和 sandbox、Responses 的 mid-turn steering、async tool calling、Multi-agent、Programmatic Tool Calling、Cache Diagnostics — [OpenAI API changelog](https://developers.openai.com/api/docs/changelog)
- Managed Agents 的 vault、egress 注入、Dreams API、workflow run 执行环境 — [Claude Platform](https://platform.claude.com/docs/en/release-notes/overview)
- Cursor Origin、VM subagent、云端 fleet；Copilot Agent Merge 云环境 — [Cursor](https://cursor.com/changelog/page/2)；[GitHub](https://github.blog/changelog/2026-10-28-agent-merge-watches-and-fixes-pull-requests-in-the-cloud)
- 可借鉴的是形状：`execute(name, input) → string`、`provision`、`wake`、`getEvents` 这组接口可在本地实现，凭据隔离可用系统 keychain 加代理 — [Managed Agents](https://www.anthropic.com/research/managed-agents)；[How we contain Claude](https://www.anthropic.com/research/how-we-contain-claude)

### Inferences
- 对只用 OpenAI 兼容接口的桌面 app，投入产出比最高的第一批大概是：工具输出落盘、工具按需加载、稳定前缀排序、goal + 预算、事件日志恢复、URL 来源限制、hook/审批 fail-closed。这些不需要 provider 配合，也不需要云端。
- 第二批是独立评估者、Cascade/Critique、advisor、memory 整理。它们会增加模型调用，要有预算上限和后台调用通道。
- 暂缓的是云端 fleet、VM 级隔离、远程控制、自有插件市场。这些是基础设施投入，对小团队收益不确定。
- 能力要按模型探测而不是写死：Anthropic Models API 已暴露 capabilities，Codex 也支持给自定义 provider 配置能力声明，这对接入多种 OpenAI 兼容模型尤其相关 — [Claude Platform](https://platform.claude.com/docs/en/release-notes/overview)；[Codex 0.162.0](https://learn.chatgpt.com/docs/changelog)
- 迁移风险：这些机制的效果数字几乎都来自前沿模型和厂商自有 harness，在其他模型上需要重新测量。

### Gaps
- 本次调研的工具受限：WebSearch 和 WebFetch 都因内部模型配置错误（glm-5.1 不可用）而失败，全部内容通过内置浏览器只读访问已知官方页面获得，未使用搜索引擎。因此没有发现范围之外的来源，覆盖面偏向 changelog；没有下载或执行任何内容。
- 部分页面返回中文本地化版本（Cursor、OpenAI、Antigravity），译文可能有偏差；链接使用的是非本地化入口。
- 没有查看 WinAgent 当前代码，因此可迁移性判断没有对照其现有实现，也未估算工作量。
- 哪些 OpenAI 兼容 provider 支持缓存断点、并行工具调用、reasoning 字段，不在本次范围内，未核实。
