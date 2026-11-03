# 开源 Agent Harness 与中国 Agent 产品的近期创新（截至 2026-11-03）

## 1. 各项目近期发布了什么？（重点 2026 年 5–11 月）

### Takeaway
这一轮的主线已从"更强的 CLI"转向"常驻服务 + 多客户端 + 可验证的后台执行"。OpenCode 2.0、Hermes v0.22、DeerFlow 2.1、OpenClaw 2.0 都是架构级发布。中国模型厂商（Kimi、Z.ai、MiniMax、Qwen）现在都有开源的自家 harness，用来配合模型分发（ZCode 是 2026 年 9 月才开源）。Manus 2.0 仍是闭源产品，Genspark 主产品的机制未能验证。Roo Code 扩展已于 2026-05-15 关停。

### Cited Findings

**规模快照（GitHub API，2026-11-03 读取；star 未做刷量审计，只能当粗略信号）**
- OpenClaw 393.8k，最新 v2026.10.10（2026-11-03）— [openclaw/openclaw](https://github.com/openclaw/openclaw/releases)
- Hermes Agent 260.1k，最新 v0.22.6（2026-11-02）— [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent/releases)
- OpenCode 224.2k，最新 v2.2.5（2026-10-30），仓库已从 sst 迁到 anomalyco — [anomalyco/opencode](https://github.com/anomalyco/opencode/releases)
- DeerFlow 84.9k，v2.1.0（2026-09-24）— [bytedance/deer-flow](https://github.com/bytedance/deer-flow/releases)
- Cline 71.2k，v4.1.26 与 SDK v0.2.0（均为 2026-10-26）— [cline/cline](https://github.com/cline/cline/releases)
- Goose 56.2k，v1.57.0（2026-10-28），仓库已迁到 aaif-goose，属 Linux Foundation 下的 Agentic AI Foundation — [aaif-goose/goose](https://github.com/aaif-goose/goose)
- Qwen Code 28.9k，v0.26.6（2026-11-02）— [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code/releases)
- Kilo Code 27.8k，v7.8.25（2026-10-28）— [Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode/releases)
- Roo Code 24.3k，已归档，末版 v3.54.0（2026-05-15）— [RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code)
- Kimi Code CLI 8.1k（2026-05-22 建仓，MIT），v2.4.1（2026-10-30）；旧版 Python kimi-cli 11.4k 已归档，末版 1.52.0（2026-09-22）— [kimi-code](https://github.com/MoonshotAI/kimi-code)，[kimi-cli](https://github.com/MoonshotAI/kimi-cli)
- ZCode 8.4k（2026-09-20 建仓，Apache-2.0），v3.17.1（2026-10-30），README 记至 v3.17.2（2026-11-03）— [zai-org/ZCode](https://github.com/zai-org/ZCode)
- MiniMax Code 2.2k（2026-06-01 建仓），v0.7.2（2026-10-31）— [MiniMax-AI/minimax-code](https://github.com/MiniMax-AI/minimax-code)

**OpenClaw**
- 2.0（博客日期 2026-08-30）：官方称 16,000+ PR、933 位贡献者，占历史 PR 约一半。重点是安装简化（直接复用已有的 ChatGPT/Claude 订阅、API key、本地模型）、重做浏览器端，以及"共享云会话"（多人协作、带上下文交接）— [官方博客](https://openclaw.ai/blog/openclaw-2-accidentally)
- v2026.10.10（2026-11-03）：Chat Details 面板；实验性 Advisor，会用额外模型调用检查进行中的任务是否走偏，官方明说可能漏报也可能给出不必要的建议；Subagents 面板可只读查看 swarm worker 的 transcript — [changelog](https://raw.githubusercontent.com/openclaw/openclaw/main/CHANGELOG/2026.10.10.md)
- v2026.10.9（2026-10-29）：把 `tools.fs.workspaceOnly` 扩展到 Gateway 构建的工具，修复 Windows 下 npm 回滚被拒导致安装损坏的问题，磁盘写满后无需重启即可恢复 — [release](https://github.com/openclaw/openclaw/releases/tag/v2026.10.9)
- 官方博客列表有一篇标题称 Microsoft Autopilot 基于 OpenClaw（2026-09-25）。我只看到标题，未能打开正文，属未验证 — [blog 页脚](https://openclaw.ai/blog/openclaw-2-accidentally)

**Hermes Agent**
- v0.22.0（release 正文写 2026-10-13，GitHub 发布于 10-14）：官方称约 6,080 PR，是 v0.21 周期的约 2.5 倍。内容包括：首启由引导对话完成（免费试用模型 `nous/welcome`，无需 key）；Connectors 走 Nous tool gateway；一键 llama.cpp 本地模型，按 GPU/RAM 选构建；SemVer 稳定通道；签名 MSIX 与 Microsoft Store；600 个固定到已审 commit 的插件目录；密码管理器登录，模型看不到密码；Bot Screen 可实时接管（处理登录、2FA、CAPTCHA）；每台机器一个 gateway 和一个 backend 服务所有 profile；子智能体可实时 Steer/Stop — [v0.22.0](https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.0)
- 同版本：源码从约 106 万行减到 69.8 万行（-34%）；约 19 个少用工具改为按需搜索加载，桌面端每次发送的 tool schema 约减半；模型选择器显示订阅剩余额度和限流恢复时间 — [v0.22.0](https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.0)
- 较早背景：v0.2.0 发布于 2026-03-12，当时使用日期制 tag — [releases](https://github.com/NousResearch/hermes-agent/releases)

**DeerFlow（ByteDance）**
- v2.0.0（2026-06-25）：与 1.x 无共享代码的重写。README 称 2026-02-28 因 v2 登上 GitHub Trending 第一，因此正式 tag 晚于公开发布约 4 个月。自带可修改 `SOUL.md`/`config.yaml` 的自定义 agent；用户可绑定自己的 Slack、Telegram、Discord、飞书、钉钉、微信、企微账号 — [v2.0.0](https://github.com/bytedance/deer-flow/releases/tag/v2.0.0)，[README](https://github.com/bytedance/deer-flow)
- v2.1.0（2026-09-24，772 PR）：主题是可信、规模和可运维，具体机制见第 2 节 — [v2.1.0](https://github.com/bytedance/deer-flow/releases/tag/v2.1.0)
- README 主推 Doubao-Seed-2.0-Code、DeepSeek v3.2、Kimi 2.5，并附火山引擎 Coding Plan 推广链接，模型推荐带商业导流，需打折看 — [README](https://github.com/bytedance/deer-flow)

**OpenCode**
- 2.0（HN 发帖 2026-10-14）：常驻单后台进程，TUI、Web、桌面共用；API 重写，且 agent 能调用自身 API（如把会话移到 worktree、中断其他会话）；Code Mode；后台 subagent 和后台 shell；80+ 内部插件，全部可热加载；`@opencode/sdk` — [官方说明](https://anoma.ly/notes/opencode-2-0/)，[HN 890 分](https://news.ycombinator.com/item?id=50094994)

**Cline / Kilo / Roo**
- Cline 已重构为 SDK 优先：CLI、VS Code、JetBrains、桌面共用同一引擎。桌面端采用 Tauri + Bun sidecar + Next.js，支持 macOS 和 Windows，提供定时 routines；SDK 列出多智能体团队、connectors、定时自动化 — [README](https://github.com/cline/cline)
- Kilo CLI 明确是 OpenCode 的 fork，覆盖 VS Code、JetBrains、CLI、云端 agent，README 称支持 500+ 模型 — [README](https://github.com/Kilo-Org/kilocode)
- Roo Code 扩展于 2026-05-15 关停（README 原话写明）。roocode.com 现主推云端产品 Roomote，卖点是核验自身工作、用另一个模型做 review、交付带预览的 PR。关停的具体原因我没有查到 — [README](https://github.com/RooCodeInc/Roo-Code)，[roocode.com](https://roocode.com/)

**Goose**
- Rust 实现，提供桌面、CLI、API；可通过 ACP 复用 Claude/ChatGPT/Gemini 订阅；支持自定义发行版（预配 provider、扩展、品牌）— [README](https://github.com/aaif-goose/goose)
- v1.57.0（2026-10-28）：allowlist 强制 HTTPS 并校验重定向，策略失败即阻断；scheduler 使用 recipe 设置 — [release](https://github.com/aaif-goose/goose/releases/tag/v1.57.0)

**Qwen Code / Qwen Agent**
- Qwen Code 现覆盖终端、IDE、桌面、Web、聊天（Telegram、钉钉、微信、飞书），README 标注 Auto-Memory、Auto-Skills、SubAgents、Agent Teams — [README](https://github.com/QwenLM/qwen-code)
- 功能文档还列出 goals、scheduled-tasks、computer-use、browser-use、arena、mem0、sandbox、worktree、context-cost 等条目（我只读了其中几篇）— [docs/users/features](https://github.com/QwenLM/qwen-code/tree/main/docs/users/features)
- Qwen-Agent 框架基本停滞：最后推送 2026-03-04，最后 release 为 v0.0.26（2025-05-29）— [Qwen-Agent](https://github.com/QwenLM/Qwen-Agent)

**Kimi**
- Kimi Code CLI 是单二进制分发的 TS 重写，支持视频输入、对话式 `/mcp-config`、插件安装时显示信任等级、lifecycle hooks、ACP。Windows 上必须先装 Git for Windows，因为要用 Git Bash 作 shell — [README](https://github.com/MoonshotAI/kimi-code)
- 模型：K3（2026 年 7 月，官方自述 2.8T 参数、1M 上下文，自承弱于 Claude Fable 5 和 GPT 5.6 Sol）— [K3 博客](https://www.kimi.com/blog/kimi-k3)；K3.1 Pro（HN 发帖 2026-10-23，权重承诺 11-04 前发布）。官方给出 Terminal-Bench 4.0 分数 65.7%，属厂商自报 — [K3.1 博客](https://www.kimi.ai/blog/kimi-k3-1-pro)

**Z.ai ZCode**
- 2026-07-01 上线，定位 GLM-5.2 官方 harness — [HN 511 分](https://news.ycombinator.com/item?id=48753715)。现为 GLM-5.3 官方 harness，提供桌面、Web、终端 — [官网](https://zcode.z.ai/en)
- 2026-09-18 被曝静默上传工作区后，于 9 月 20–21 日开源（详见第 3 节）— [ferstar](https://blog.ferstar.org/en/posts/zcode-silent-workspace-snapshot-upload/)
- v3.14.3（2026-09-24 发布）：运行中可调 workflow 并发上限，减少 workflow 工具占用的上下文 — [release](https://github.com/zai-org/ZCode/releases/tag/v3.14.3)

**MiniMax**
- M3.1 Flash（2026-10-19）：官方称在线推理快近 3 倍、成本降 70%，属自报 — [官方](https://www.minimax.io/blog/minimax-m31f)，[HN 518 分](https://news.ycombinator.com/item?id=50154540)
- 除 MiniMax Code 外，还有 mcode-stack（团队工作流与 skills）、OpenAgentCore（自托管的 OpenAI Agents API 实现，可跑 Codex、Claude Code、MiniMax Code）— [MiniMax-AI 组织](https://github.com/MiniMax-AI)
- 较早背景：Mini-Agent 为演示项目，最后推送 2026-02-14 — [Mini-Agent](https://github.com/MiniMax-AI/Mini-Agent)

**Manus（闭源）**
- 2026-08-11 公告"将恢复独立运营"，为合规删除部分用户在 2025-12-29 及之后产生的数据（8 月 23–24 日 SGT），提供备份和恢复工具 — [A Note to Our Users](https://manus.im/blog/a-note-to-our-users)；2026-09-01 宣布正式恢复独立 — [公告](https://manus.im/blog/manus-resumes-independent-operations)
- Manus 2.0（2026-09-28）：新 harness Cascade；Cloud Computer；Automations 从定时扩展到事件触发（邮件、日历、Slack、Notion 等）；桌面端升级为 Manus Studio；Cue 个人 agent 应用 — [官方](https://manus.im/blog/introducing-manus-2-0)
- Manus Flex（2026-09-29）：BYOK，推理费直付 provider，其余基础设施仍耗 credits；首批合作方 OpenRouter、Fireworks、Modal — [官方](https://manus.im/blog/introducing-manus-flex)
- 较早背景：Manus Desktop 的 My Computer 能力（2026-03-16），通过本地终端 CLI 操作文件和应用 — [官方](https://manus.im/blog/manus-my-computer-desktop)

**Genspark**
- 能确认的只有 GenOffice：开源 AI Office 套件，2026-07-31 建仓，11.6k star，BYOK，带 `genoffice` CLI 和 agent skill，供 Claude Code、Codex、Cursor 本地生成和编辑 docx/xlsx/pptx — [genspark-ai/genoffice](https://github.com/genspark-ai/genoffice)

### Inferences
- "模型厂商自带 harness"已成标配（Kimi、Z.ai、MiniMax、Qwen）。这既是分发渠道，也是模型调优的反馈来源，所以这些 harness 的默认模型选择不能算中立建议。
- OpenCode 和 Cline 的基础地位在上升：Kilo CLI 直接 fork OpenCode，Cline 把核心做成 SDK。对于桌面应用开发者，"嵌入现成 agent 核心"已是现实选项。

### Gaps
- **研究方法受限**：WebSearch 和 WebFetch 在本次运行中全部报模型配置错误（`glm-5.1`），未能使用。我改用 `gh api`、HN Algolia API 和直接 HTTP 读取公开页面，只读文本，未下载安装或执行任何内容。因此覆盖面偏向 GitHub、官方站点和 HN。
- **中文媒体基本未覆盖**：36氪被 WAF 拦截，量子位返回 403，机器之心搜索页无正文。Reddit 未查。中国区的采用情况和评测因此是明显缺口。
- Genspark 官网返回 403，其主产品（agent、Claw 类能力）的机制未能验证。
- MiniMax Agent 消费端产品未能验证；`agent.minimax.io` 只返回了 MiniMax Code 标题。
- 未核实 OpenCode 2.0 的确切 tag 日期（`v2.0.0` 这个 tag 查询返回 404），上文日期取自 HN 发帖时间。
- Kimi K2.6 博客提取文本中没有日期。

## 2. 各项目的具体机制是什么？

### Takeaway
最值得看的机制有五类：受限的 swarm（Kimi、DeerFlow、Qwen）、脚本化编排（OpenCode Code Mode、ZCode dynamic workflow、Hermes RPC）、可验证回执（DeerFlow）、技能生命周期管理（Hermes 和 Qwen 的 curator）、为保缓存而冻结的记忆快照（Hermes）。

### Cited Findings

**Subagent / Swarm 编排**
- Kimi Code `AgentSwarm`：用 `prompt_template` + `{{item}}` 批量派生，上限 128 个，超出部分自动排队。只有用户能开启 swarm 模式；关闭时调用被拒。至少 2 个 item，展开后的 prompt 必须互不相同，否则启动前即拒绝；可用 `resume_agent_ids` 续跑失败或超时的 agent；该调用必须是当次响应的唯一工具调用 — [agent-swarm.md](https://github.com/MoonshotAI/kimi-code/blob/main/packages/agent-core-v2/src/features/swarm/tools/agent-swarm/agent-swarm.md)
- Kimi 在 changelog 中改为 swarm 只能由用户开启、agent 不能自行启动，并在开启时加高用量警告；另一 PR 将 subagent 限制在配置的模型池内 — [CHANGELOG](https://github.com/MoonshotAI/kimi-code/blob/main/apps/kimi-code/CHANGELOG.md)，[PR 列表](https://github.com/MoonshotAI/kimi-code/releases)
- Kimi 消费端 swarm 的官方数字：K2.5 为 100 子智能体、1,500 步，K2.6 为 300 子智能体、4,000 步（较早背景，属营销口径）— [K2.6 博客](https://www.kimi.com/blog/kimi-k2-6)，[Agent Swarm 博客](https://www.kimi.com/blog/agent-swarm)
- DeerFlow 2.1：系统维护的 delegation ledger 防止重复委派，并设总量上限；全进程共用一个容量控制器；可选的 `batch_task` 用 SQL 持久化批次，支持 lease、重试、暂停、恢复、取消；`task(context_mode="snapshot")` 携带派发时的父会话副本 — [v2.1.0](https://github.com/bytedance/deer-flow/releases/tag/v2.1.0)
- Qwen `/coordinate`（实验性 Agent Team）：leader 最多分配 3 条独立工作流；调查 worker 被强制只读（不能执行 shell 或写文件）；可让一个 writer 在 leader 拥有的 worktree 中写入。另有 Arena 模式，多模型在隔离 worktree 中竞争同一任务 — [文档](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/multi-agent-coordination.md)
- OpenCode 2.0：后台 subagent 可指定不同模型，长任务可按热键转入后台，完成后通知主 agent — [官方说明](https://anoma.ly/notes/opencode-2-0/)
- ZCode dynamic workflow：主 agent 针对 TS facade 写脚本，纯函数编译器做类型检查、schema 合成、依赖推断；运行层是子进程 + vm cell + NDJSON host bridge；生产 driver 用 SQLite journal 支持恢复 — [README](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/dynamic-workflow/README.md)

**上下文工程**
- OpenCode Code Mode：`@opencode/codemode` 是自研的极简 JS 解释器（不用 Node VM 或 QuickJS），把 MCP 和 OpenAPI 转成可在脚本中调用的函数，一次往返完成"调用—映射—再调用"。2.0 中所有 MCP 默认进入 code mode，官方称可加上千个 MCP 而上下文膨胀极小（官方说法，未见独立测量）— [官方说明](https://anoma.ly/notes/opencode-2-0/)
- Hermes：Python 脚本通过 RPC 调工具，把多步流水线压缩成不占上下文的回合 — [README](https://github.com/NousResearch/hermes-agent)
- Hermes 技能三级披露：`skills_list`（约 3k token）→ `skill_view(name)` → `skill_view(name, path)`。会话中新增技能时，不改系统提示以保住 prompt cache，而是在下一条消息附一次性说明，等 compaction 时才写入系统提示 — [Skills 文档](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
- DeerFlow：外置工具结果只留有字符预算的结构化摘要（保留完整文件引用和 `read_file` 指引）；已完成子任务摘要化，中间结果落盘 — [README](https://github.com/bytedance/deer-flow)
- Manus Cascade：项目初始保持轻量，按需引入专门能力。官方称"某一测试配置"下 token 少 23.2%、用时少 28.2%、成本少 32%（单一配置下的自报数字）— [Manus 2.0](https://manus.im/blog/introducing-manus-2-0)
- Kimi Code 2.4.1（2026-10-30）把单文件读取上限从 50 万字符降到 10 万字符或约 2.5 万 token，并缩短内置工具和子智能体提示 — [release](https://github.com/MoonshotAI/kimi-code/releases)

**长期记忆**
- Hermes：`MEMORY.md`（2,200 字符）和 `USER.md`（1,375 字符）在会话开始时以冻结快照注入系统提示。不自动压缩：超限时工具返回错误，agent 必须当回合自行合并后重试。不允许两个进程共用一个 Hermes home — [Memory 文档](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)
- Hermes 跨会话检索：FTS5 会话搜索 + LLM 摘要；可选 Honcho 用户建模 — [README](https://github.com/NousResearch/hermes-agent)
- OpenClaw Dreaming：默认开启的后台记忆整合，把强短期信号移入长期记忆。机器状态存在 SQLite，重写 `MEMORY.md` 前保存 preimage，人可读输出写入 `DREAMS.md` — [Dreaming 文档](https://docs.openclaw.ai/concepts/dreaming)
- DeerFlow 2.1：`memory.manager_class` 可插拔（OpenViking、mem0、Honcho）；内置 FTS5/BM25；LLM 辅助合并与过期清理；保证注入 correction fact；混合淘汰策略 — [v2.1.0](https://github.com/bytedance/deer-flow/releases/tag/v2.1.0)
- Qwen：人写的 `QWEN.md` 分全局、项目、本地三级，另有 agent 自写的 Auto-memory — [Memory 文档](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/memory.md)

**技能自创建 / 自改进**
- Hermes：复杂任务后自动创建技能，使用中自我修补 — [README](https://github.com/NousResearch/hermes-agent)。Curator 负责防膨胀：统计 view/use/patch，按 active → stale → archived 迁移；由空闲检查触发（默认间隔 7 天、空闲 2 小时）而非 cron；用辅助模型提出合并建议；不自动删除；hub 安装的技能不动 — [Curator 文档](https://hermes-agent.nousresearch.com/docs/user-guide/features/curator)
- Qwen Auto Skill：30 天无成功使用或编辑标记为 stale，90 天移入 `.qwen/archived-skills/`，每 7 天最多维护一次；支持 pin 和 `/curator run --dry-run`；应用类操作要求受信任工作区且不在 safe mode — [Skills 文档](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/skills.md)
- DeerFlow 2.0：agent 可在普通对话中持久化修改自身 `SOUL.md` 和配置，按用户隔离 — [v2.0.0](https://github.com/bytedance/deer-flow/releases/tag/v2.0.0)
- OpenCode 2.0：可在会话中为自己写插件并通过热加载立即使用 — [官方说明](https://anoma.ly/notes/opencode-2-0/)
- Kimi K2.6：可把高质量文件（PDF、表格、PPT、Word）转成 Skill（较早背景，官方说法）— [K2.6 博客](https://www.kimi.com/blog/kimi-k2-6)

**可验证执行（较新的方向）**
- DeerFlow 2.1：每次工具调用带 runtime 盖章的防篡改回执，有界回执账本进入模型上下文；subagent 报告必须引用回执和可验证的交付物句柄，由 lead agent 交叉检查；`acceptance_criteria` 在父侧确定性检查（文件是否存在、测试命令退出码），无法判定的标为 UNVERIFIED — [v2.1.0](https://github.com/bytedance/deer-flow/releases/tag/v2.1.0)
- Manus 共创始人总结的内部经验："Autonomy needs a finish line"：只有成功可被检查时才放手，其余由人决定。这是经验陈述，不是机制文档 — [Rebuilding Manus](https://manus.im/blog/rebuilding-manus-with-manus)

**沙箱**
- DeerFlow 2.1：新增 E2B、BoxLite（micro-VM + warm pool）、Tenki、OpenSandbox；本地 Docker 可选 `isolated` 或域名 allowlist 出站，被拒域名可通过 Human Input 卡片批准；默认 seccomp 并丢弃 capabilities — [v2.1.0](https://github.com/bytedance/deer-flow/releases/tag/v2.1.0)
- Hermes：六种终端后端（local、Docker、SSH、Modal、Daytona、Vercel Sandbox），Daytona 和 Modal 空闲时休眠 — [README](https://github.com/NousResearch/hermes-agent)
- Hermes 审批：`approvals.mode` 为 smart/manual/off，且 `cron_mode`、`single_query_mode`、`unattended_mode` 默认 deny，即无人值守时遇到危险命令直接拒绝 — [Security 文档](https://hermes-agent.nousresearch.com/docs/user-guide/security)

**消息网关**
- Hermes：单一 gateway 进程服务 Telegram、Discord、Slack、WhatsApp、Signal、CLI，跨平台连续对话；v0.22 起每机一个 gateway 服务全部 profile — [README](https://github.com/NousResearch/hermes-agent)，[v0.22.0](https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.0)
- OpenClaw：未知 DM 发送者默认得到配对码而非被处理；群组默认 allowlist 且需 mention；但容器镜像默认暴露绑定，官方明说"一个 gateway 一个信任边界"，不是对抗性多租户边界 — [Security 文档](https://docs.openclaw.ai/gateway/security)
- 中国 IM 覆盖：DeerFlow 支持飞书、钉钉、微信、企微 — [v2.0.0](https://github.com/bytedance/deer-flow/releases/tag/v2.0.0)；Qwen Code 支持钉钉、微信、飞书 — [README](https://github.com/QwenLM/qwen-code)

**定时 / 后台任务**
- DeerFlow 2.1：`once`、`cron`、`interval`；可保存前预览未来触发时间；忙碌时的触发项持久排队，跨重启保留 — [v2.1.0](https://github.com/bytedance/deer-flow/releases/tag/v2.1.0)
- Manus Automations：由连接服务的事件触发，用一句话定义监视对象和后续动作 — [Manus 2.0](https://manus.im/blog/introducing-manus-2-0)
- OpenCode 2.0：脚本经 `@opencode/client` 自动发现本地服务，官方指出这尤其适合定时任务；`/pair` 连接其他应用 — [官方说明](https://anoma.ly/notes/opencode-2-0/)
- Hermes：内置 cron，可投递到任意平台 — [README](https://github.com/NousResearch/hermes-agent)

**模型路由 / 成本控制**
- DeerFlow 2.1：per-run token 预算由 lead 和 subagent 累加共享；按 provider 的请求准入限流；按 agent 设置模型 — [v2.1.0](https://github.com/bytedance/deer-flow/releases/tag/v2.1.0)。可用自然语言指定子任务、单回合或整个会话的模型，子任务选择不影响主模型 — [README](https://github.com/bytedance/deer-flow)
- Hermes：Desktop 中可为 subagent 单独配置 provider、模型和限额；默认在 resume、分支、compaction 后回放先前推理 — [README](https://github.com/NousResearch/hermes-agent)，[v0.22.0](https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.0)
- Qwen Web Shell：token 面板显示请求成功率、输出速度和分模型指标 — [v0.26.6](https://github.com/QwenLM/qwen-code/releases/tag/v0.26.6)

**Windows 相关**
- Hermes 原生支持 Windows，有 MSIX（x64、ARM64）；README 专门说明捆绑的 `uv.exe` 常被杀软误报及核验方法 — [README](https://github.com/NousResearch/hermes-agent)
- DeerFlow 2.0 在 Windows 和 Linux 上都拒绝符号链接形式的上传目标 — [v2.0.0](https://github.com/bytedance/deer-flow/releases/tag/v2.0.0)
- ZCode 发布 Windows x64 和 arm64 构建，并附 SHA256SUMS — [v3.17.1](https://github.com/zai-org/ZCode/releases/tag/v3.17.1)

### Inferences
- swarm 的实际设计重点是限制而非规模：Kimi 的营销是 300，但 CLI 上限 128、需用户开启并带用量警告；Qwen 上限 3 条且强制只读。这说明成本和写冲突才是真实约束。
- Hermes 的"冻结快照 + 下条消息附说明"和"写满报错、当回合合并"合起来是一套围绕 prompt cache 的完整设计，比单纯做记忆搜索更值得研究。
- 自创建技能本身不难，难点是治理。Hermes 和 Qwen 都做了几乎相同的 stale/archive/不删除流程，说明两边都碰到了技能膨胀问题。

### Gaps
- 我读到的材料里没有看到 Windows 原生隔离机制（AppContainer、Job Object 等），沙箱方案都依赖 Docker、微虚拟机或云端。这不代表一定没有，我没有逐一审阅代码。
- Manus Cascade 和 Genspark 无公开实现细节。
- Auto Skill 的创建触发条件（Qwen）和 Hermes 技能创建的判定逻辑，我只读到了维护部分和 README 描述，未读源码。
- 未见任何项目发布"自改进技能确实提升成功率"的独立评测。

## 3. 哪些有真实牵引力，哪些是炒作？有哪些失败和安全事件？

### Takeaway
安全事件密集：OpenCode Console 密钥泄露（2026-10）、ZCode 静默上传工作区（2026-09）、OpenClaw 累计 722 条已发布公告，以及多个本地服务的跨站攻击漏洞。牵引力信号强的是 OpenClaw、Hermes、OpenCode，但 star 数和严肃使用并不等同；"300 子智能体"和各类自报效率数字应视为营销。

### Cited Findings

**近 6 个月的事件**
- **OpenCode 密钥泄露（2026-10-17）**：HN 转述的官方通知称，一个正在退役的旧系统遭未授权访问，保存在工作区的第三方 provider key 可能暴露，要求用户吊销更换 — [HN 977 分](https://news.ycombinator.com/item?id=50133401)。官方推文（经 HN 转述）称影响 1.4% 的 Console 用户，且与"大规模蒸馏攻击"有关，评论者对这一说法表示困惑 — [HN](https://news.ycombinator.com/item?id=50139083)。推文原文我未能直接读取。
- **OpenCode 本地服务漏洞**：跨站请求可触发服务升级，在 npm 安装方式下安装任意包（高危，2026-09-24）— [GHSA-632h-h47v-g4x4](https://github.com/anomalyco/opencode/security/advisories/GHSA-632h-h47v-g4x4)
- **OpenCode 隐私争议（较早）**：2026-01 有用户发现使用本地模型时，会话标题仍在网络外部生成；HN 上有人在泄露事件后翻出此事，但这些评论的指控带情绪，需区分 — [issue #10416](https://github.com/anomalyco/opencode/issues/10416)
- **ZCode 静默上传（2026-09-18）**：独立开发者 ferstar 逆向后称，登录状态下应用静默打包整个工作区（含 `.git` 全历史、LFS、reflog、全局配置）并上传到阿里云 OSS。信封加密的 RSA 公钥由服务端下发，私钥只在云端，用户自己无法解密本地这份密文 — [ferstar 原文](https://blog.ferstar.org/en/posts/zcode-silent-workspace-snapshot-upload/)
- ZCode 事件细节（来自二手转述）：单次捕获为 345MB 工作区、42,411 个文件、313MB 密文；UI 开关只控制训练授权和服务端索引，不停止打包上传；隐私政策未提及 — [Tokenstead](https://tokenstead.ai/guides/zcode-silent-git-history-upload)。HN 有评论指该文是对原文的 LLM 改写，所以细节以原文为准 — [HN 262 分](https://news.ycombinator.com/item?id=49752422)
- ZCode 后续：ferstar 称官方 9 月 21 日发声明并开源，声明说上传是为了会话 checkpoint 回滚；但公开代码中的 checkpoint 完全基于本地 Git。他核对 v3.14.3 后，未发现原上传链路 — [ferstar 原文](https://blog.ferstar.org/en/posts/zcode-silent-workspace-snapshot-upload/)。官方声明原文我未读到，上述说法是 ferstar 的转述。
- ZCode 开源的局限：ferstar 指出历史被压平，PR 被锁、Issue 被关，且版本 tag 对应不能证明闭源二进制与公开源码一致（没有可复现构建）— [ferstar 原文](https://blog.ferstar.org/en/posts/zcode-silent-workspace-snapshot-upload/)。我核实到：`has_issues=false`；`repoSnapshotIndexingEnabled` 和 `optimizeAgentExperienceEnabled` 在 GitHub 代码搜索中零结果（索引可能不全）；`upload-credential` 这一字符串仍出现在反馈和遥测相关文件路径中，我没有读这些文件，无法判断其用途 — [zai-org/ZCode](https://github.com/zai-org/ZCode)
- **Cline 本地服务漏洞**：Kanban Server 跨域 WebSocket 劫持（严重，2026-05-08）— [GHSA-5c57-rqjx-35g2](https://github.com/cline/cline/security/advisories/GHSA-5c57-rqjx-35g2)；Hub Dashboard 跨域 WebSocket 劫持（高危，2026-06-23）— [GHSA-3cj3-hqcr-g934](https://github.com/cline/cline/security/advisories/GHSA-3cj3-hqcr-g934)
- **OpenClaw 公告总量**：截至 2026-11-03，GitHub 上已发布 722 条（严重 14、高危 249、中危 390、低危 69），按月分布：1 月 3、2 月 220、3 月 204、4 月 108、5 月 67、6 月 45、9 月 75 — [Security Advisories](https://github.com/openclaw/openclaw/security/advisories)（我用 API 去重统计得出。数量多也反映披露流程活跃，不能直接换算成"比同类更不安全"）
- **OpenClaw 公告中有代表性的类别**（均 2026-09-11）：
  - 审批过期：批准后的工作目录变化未失效 — [GHSA-3mq7-q27j-mq7q](https://github.com/openclaw/openclaw/security/advisories/GHSA-3mq7-q27j-mq7q)
  - 审批扩权：文件传输批准扩大持久授权 — [GHSA-7jfq-rmfm-29wp](https://github.com/openclaw/openclaw/security/advisories/GHSA-7jfq-rmfm-29wp)
  - 后台记忆越权：Dreaming 可能扩大受限发送者的权限 — [GHSA-62qm-6fjj-6g23](https://github.com/openclaw/openclaw/security/advisories/GHSA-62qm-6fjj-6g23)
  - 路径逃逸：Unicode 回退绕过 workspaceOnly — [GHSA-5rx7-34fw-64qg](https://github.com/openclaw/openclaw/security/advisories/GHSA-5rx7-34fw-64qg)
  - 凭据误发：OpenAI 兼容传输可能把 key 发到错误端点 — [GHSA-vhpg-cq3w-v8p9](https://github.com/openclaw/openclaw/security/advisories/GHSA-vhpg-cq3w-v8p9)
- **Manus 数据删除（2026-08）**：因合规要求删除部分用户数据，这是业务层面的中断事件，而非攻击 — [A Note to Our Users](https://manus.im/blog/a-note-to-our-users)
- **Roo Code 关停（2026-05-15）**：一个 24k star 的项目也可能直接停止，依赖方需要有备选 — [README](https://github.com/RooCodeInc/Roo-Code)
- **Hermes 抄袭争议（2026-05）**：有人指 Hermes 衍生自 EvoMap Evolver 且未署名；issue #10232 现在标题和正文都只剩 "."，已关闭。HN 帖仅 8 分，我未能验证原指控 — [issue](https://github.com/NousResearch/hermes-agent/issues/10232)，[HN](https://news.ycombinator.com/item?id=48187581)

**较早背景（2026 年 1–4 月）**
- ClawHub 下载量第一的 "Twitter" skill 被发现是分阶段的恶意软件投递：skill 说明要求安装"必需依赖"，链接落到诱导 agent 执行命令的页面，再解码载荷、下载二进制并移除 macOS 隔离属性 — [1Password（2026-02）](https://1password.com/blog/from-magic-to-malware-how-openclaws-agent-skills-become-an-attack-surface)，[HN 334 分](https://news.ycombinator.com/item?id=46898615)
- OpenClaw 提权漏洞 CVE-2026-33579（2026-04，NVD 原文我未读）— [HN 514 分](https://news.ycombinator.com/item?id=47628608)；Composio 的批评文章（2026-03）— [HN 397 分](https://news.ycombinator.com/item?id=47479962)
- 被未授权发布到 npm 的 cline@2.3.0，其 postinstall 脚本会安装 openclaw（2026-02）— [GHSA-9ppg-jx86-fqw7](https://github.com/cline/cline/security/advisories/GHSA-9ppg-jx86-fqw7)
- OpenCode Web UI XSS 可致命令执行（严重）和未认证 HTTP 服务（高危），均为 2026-01-12 — [GHSA-c83v-7274-4vgp](https://github.com/anomalyco/opencode/security/advisories/GHSA-c83v-7274-4vgp)，[GHSA-vxw4-wv6m-9hhh](https://github.com/anomalyco/opencode/security/advisories/GHSA-vxw4-wv6m-9hhh)
- 订阅复用的政策风险：Google 限制通过 OpenClaw 使用的订阅账号（2026-02）— [HN 802 分](https://news.ycombinator.com/item?id=47115805)；Anthropic 不再允许 Claude Code 订阅用于 OpenClaw（2026-04-03）— [HN 1099 分](https://news.ycombinator.com/item?id=47633396)；随后 OpenClaw 文档称 CLI 用法又被允许（2026-04-21）— [HN 511 分](https://news.ycombinator.com/item?id=47844269)。以上我只读了标题，未读全文。

**已有的修复动作**
- ClawHub 现在把发布版本先置于 pending，针对具体制品跑自动安全检查，通过后才进入搜索和安装 — [Publishing 文档](https://docs.openclaw.ai/clawhub/publishing)。扫描效果未见第三方评估。
- OpenClaw 提供 `openclaw security audit` 和 MITRE ATLAS 映射的威胁模型 — [Security 文档](https://docs.openclaw.ai/gateway/security)
- Hermes 插件目录固定到已审 commit，禁止修补 Hermes 内部或携带不可扫描的二进制 — [v0.22.0](https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.0)
- DeerFlow 2.1 把 Docker 默认绑定改为 loopback（作为破坏性变更发布）— [v2.1.0](https://github.com/bytedance/deer-flow/releases/tag/v2.1.0)；并明确声明 Gateway admin 等同于主机代码执行，因为 `npx`、`uvx` 本身就是拉取并运行远程包 — [README](https://github.com/bytedance/deer-flow#gateway-admin-is-equivalent-to-code-execution)
- Kimi Code 安装插件时展示信任等级 — [README](https://github.com/MoonshotAI/kimi-code)

**牵引力信号**
- HN 热度（5 月后）：Kimi K3.1 Pro 1096 分 — [HN](https://news.ycombinator.com/item?id=50212065)；OpenCode 2.0 890 分；MiniMax M3.1 Flash 518 分；ZCode 上线 511 分；OpenClaw 2.0 仅 148 分 — [HN](https://news.ycombinator.com/item?id=49505310)。模型发布的讨论度明显高于 harness 发布。
- Hermes 的 OpenClaw 迁移指南获 122 分、105 条评论（2026-06-18）— [HN](https://news.ycombinator.com/item?id=48586005)。评论两极：有人认为 Hermes 更精致、OpenClaw 能力更深；有人说不明白这类产品的用途；一位用户称默认加载下仅列出技能就占 10k+ 上下文（单人轶事，与文档的约 3k 不同）。
- MiniMax M3.1 Flash 官方称匿名阶段处理超 200 万亿 token，这是厂商自报 — [官方](https://www.minimax.io/blog/minimax-m31f)
- 2026 年下半年 HN 上出现一批专做 agent 沙箱和权限的创业公司（Agent37、OneCLI、Alter 等），说明这是真实痛点；我只看了标题 — [Agent37](https://news.ycombinator.com/item?id=50059096)，[OneCLI](https://news.ycombinator.com/item?id=49363710)，[Alter](https://news.ycombinator.com/item?id=50176908)

### Inferences
- **炒作成分较高**：300 子智能体、"组织自己设计自己"的叙事、Hermes README 自称唯一内置学习闭环的 agent（Qwen 已有类似机制）、官方自报的效率百分比、OpenCode 的"上千 MCP"。
- **牵引力较实**：常驻服务 + 多端、code mode、本地优先加 BYOK、消息网关的个人自动化。OpenCode 的"数百万日活"和 OpenClaw 的贡献者数字都是官方自述。
- 反复出现的漏洞模式是"本地服务 + 浏览器"：OpenCode（1 月、9 月）和 Cline（5 月、6 月）都栽在跨站访问本地端口上。常驻服务越来越普遍，这类风险只会变多。
- ZCode 事件的教训不只是"别上传"。它说明宿主层 sidecar 不经过 agent 权限系统，因此任何工具级权限都管不到；另一条教训是设置开关的语义必须与实际行为一致。
- 这类事件中的审批类漏洞（批准范围随时间或上下文扩大）说明，"持久授权"比"单次授权"更难做对。

### Gaps
- 2026 年 5–11 月暴露 Gateway 的扫描数据（如 Censys、Shodan 计数）和 ClawHub 恶意 skill 的最新数量，我没有找到一手来源，不作引用。
- OpenClaw 公告在 7、8、10 月为零，可能是批量发布的节奏，我无法确认当前修复状况。
- Hermes 通过仓库安全公告 API 查询结果为 0，这可能意味着它不使用 GitHub 公告渠道，不代表没有漏洞。
- ZCode 事件仅有一位研究者的主要捕获，我未找到独立复现。
- star 真实性未审计；未找到可靠的日活或付费数据，OpenCode 的"数百万日活用户"是官方说法。

## 4. 正在收敛的模式是什么？对 WinAgent 有何借鉴？

### Takeaway
收敛方向很清晰：常驻单服务多客户端、按需加载工具和技能、脚本化工具编排、受限且可见的并行、文件 + FTS5 + 后台整合的记忆、SKILL.md 标准、定时加事件触发、BYOK。WinAgent 最值得优先借鉴的是低成本且已被多方验证的部分，后台自治和技能市场则应谨慎后置。

### Cited Findings
- **常驻服务 + 多客户端**：OpenCode 2.0 单后台进程 — [说明](https://anoma.ly/notes/opencode-2-0/)；Hermes 每机一个 gateway 和 backend — [v0.22.0](https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.0)；Cline 共享引擎 — [README](https://github.com/cline/cline)；ZCode 桌面、Web、终端 — [README](https://github.com/zai-org/ZCode)
- **脚本化工具编排**：OpenCode Code Mode — [说明](https://anoma.ly/notes/opencode-2-0/)；Hermes RPC 脚本 — [README](https://github.com/NousResearch/hermes-agent)；ZCode dynamic workflow — [README](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/dynamic-workflow/README.md)
- **工具和能力懒加载**：Hermes 按需工具 — [v0.22.0](https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.0)；Manus Cascade 和 Studio — [Manus 2.0](https://manus.im/blog/introducing-manus-2-0)；Kimi 把工具披露与执行解耦的重构 PR — [releases](https://github.com/MoonshotAI/kimi-code/releases)
- **SKILL.md 成为事实标准**：Hermes 兼容 agentskills.io — [README](https://github.com/NousResearch/hermes-agent)；Qwen 同时读取 `.agents/skills/` — [Skills 文档](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/skills.md)；DeerFlow 把 `SKILL.md` 目录定义为运行时包边界 — [v2.1.0](https://github.com/bytedance/deer-flow/releases/tag/v2.1.0)
- **ACP 成为编辑器和 harness 的互通层**：Kimi `kimi acp` — [README](https://github.com/MoonshotAI/kimi-code)；Goose 通过 ACP 用订阅 — [README](https://github.com/aaif-goose/goose)；DeerFlow 支持 MiniMax Code ACP — [v2.1.0](https://github.com/bytedance/deer-flow/releases/tag/v2.1.0)
- **子智能体可见可控**：Hermes Steer/Stop — [v0.22.0](https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.0)；OpenClaw Subagents 面板 — [changelog](https://raw.githubusercontent.com/openclaw/openclaw/main/CHANGELOG/2026.10.10.md)；ZCode 运行中调并发 — [v3.14.3](https://github.com/zai-org/ZCode/releases/tag/v3.14.3)
- **对话式上手**：OpenClaw 2.0 在对话中完成配置 — [博客](https://openclaw.ai/blog/openclaw-2-accidentally)；Hermes 引导对话 — [v0.22.0](https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.0)
- **BYOK / 模型开放**：连闭源的 Manus 也推出 Flex — [官方](https://manus.im/blog/introducing-manus-flex)

### Inferences
以下是我基于上述材料对 WinAgent 的判断，不是来源中的结论，也未结合 WinAgent 现有代码逐项评估。

**优先借鉴（成本低、多方验证）**
1. 记忆冻结快照加写满报错（Hermes），对缓存命中和记忆质量都有帮助。
2. 工具结果落盘 + 有预算的摘要（DeerFlow），长会话省 token 的直接办法。
3. 无人值守默认拒绝危险操作（Hermes 的 `cron_mode: deny`），并做父侧确定性验收（DeerFlow 的 `acceptance_criteria`，文件存在、退出码，无法判定就标 UNVERIFIED）。
4. 把所有后台模型调用纳入 per-run token 预算（DeerFlow）。OpenClaw Advisor 和 Dreaming 这类后台功能都有额外模型调用；这与 WinAgent 记忆中的 taskChat 后台调用规则方向一致。
5. 技能生命周期：stale/archive/pin/dry-run，不自动删除（Hermes、Qwen）。

**值得做原型（需要评估）**
6. 受限 swarm：`{{item}}` 模板 + 用户开关 + 用量警告 + 排队 + 可续跑（Kimi）。形式简单，比自由派生更可控。
7. Code Mode：对 MCP 工具数量多的场景收益大，但脚本执行本身要有隔离。ZCode 的子进程 + vm + NDJSON bridge 和 OpenCode 的自研解释器是两种可参考的实现。
8. 只读 worker + 单一 writer（Qwen），用简单方式规避并发写冲突。

**谨慎后置**
9. 公开技能市场：恶意 skill 的攻击面已被证实。至少先做 pending 扫描和固定 commit，并把技能文本当作不可信输入。
10. 默认开启的后台记忆重写和 agent 自改配置：OpenClaw 的 Dreaming 已出过权限类公告，建议保留 preimage 并让用户可审阅。
11. 复用第三方订阅登录：政策曾多次反复（Google、Anthropic），不宜作为核心路径。

**安全底线（从事件中直接得出）**
12. 若有本地 HTTP 或 WebSocket 服务：校验 Origin，强制认证，默认绑定 loopback；不要让跨站请求触发升级或安装。OpenCode 和 Cline 都在这上面出过问题。
13. 不存或尽量不托管用户的第三方 key。OpenCode 这次暴露的是保存在其工作区的第三方 key，入口是一个正在退役的旧系统。
14. 宿主进程的任何上传都要进入用户可见的开关和隐私文档，且开关语义要与实际行为一致（ZCode 教训）。
15. 审批要绑定工作目录和范围，上下文变化后失效（OpenClaw 公告）。路径限制要考虑 Unicode 和符号链接（OpenClaw、DeerFlow）。

**Windows 分发要点**
16. 捆绑 Python、uv 等可能触发杀软误报，需要提前准备签名和核验说明（Hermes）。签名 MSIX 或稳定通道都已是同类产品的基线。依赖 Git Bash（Kimi）虽然省事，但会增加首次使用门槛。

### Gaps
- 未对比 WinAgent 当前实现，上述优先级需结合实际架构（如 Electron 主进程与暂停中的 dsh-plugin）再定。
- Windows 原生沙箱的同类实践未找到可引用的资料，需要单独研究。
- 上述机制的实际效果（如 Code Mode 省多少 token、受限 swarm 的成功率）缺少独立评测，目前都是官方说法或架构推断。
