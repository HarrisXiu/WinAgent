# DeepSeek Harness 与 Super-agent（dsh-superagent）调研笔记

> 调研日期 2026-11-03。Star 数等均为当日 GitHub API 读数。
> 证据分级：【一手】= DeepSeek 官方仓库、官方公众号文章、官方 API 文档、GitHub Release；【二手】= 第三方；【推断】= 本笔记的判断。
> 工具限制：本次 WebSearch 和 WebFetch 均报模型配置错误（`glm-5.1` 不可用），未能使用。实际资料来自 GitHub API（gh）、npm registry、HN Algolia API，以及用 curl 直接读取的页面。中文媒体覆盖因此没有查全，详见第 1 节 Gaps。

## 1. 用户说的 "deepseekharness 发布的 superagent" 是否属实？指的是什么？

### Takeaway
基本属实，置信度很高，但名称和性质要校正。它指的是 DeepSeek Harness 团队 2026-10-31 同时发布的设计文章《Super-agent 设计探索：迈向更自主的 Agent 系统》和开源研究原型 `deepseek-ai/dsh-superagent-prototype`。官方明确说这**不是正式产品**，也不是 DSH 主线的内置功能，而是一个跑在 DSH 上的 bundle。它和 ByteDance DeerFlow 的 "SuperAgent harness" 没有关系。

### Cited Findings
- 【一手】仓库 `deepseek-ai/dsh-superagent-prototype` 位于 DeepSeek 官方 org，创建于 2026-10-31T09:32Z；唯一一个公开提交 `feat: add the dsh-superagent research prototype` 的时间为 2026-10-31T12:05Z，作者署名 DeepSeek Harness Team；MIT 许可，TypeScript，约 15,458 star、1,651 fork；无 release、无 tag，Issues 关闭 — [GitHub 仓库](https://github.com/deepseek-ai/dsh-superagent-prototype)
- 【一手】README 原文开头："Research prototype for reference only, not an official DeepSeek product"；公开版与内部版、与文章描述的实现都不完全相同，文章部分设计是未来方向，原型并未实现 — [README](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/README.md)
- 【一手】设计文章标题《Super-agent 设计探索：迈向更自主的 Agent 系统》，发布账号为公众号 "DeepSeek Harness 团队"，页面内 create_time 为 2026-10-31T12:29Z。文章开头声明它是架构思路探讨，"并非对 DeepSeek Harness 现有产品功能的介绍"；结尾说部分设计已在原型中实现，该插件"并非 DeepSeek 的正式产品" — [微信原文](https://mp.weixin.qq.com/s/zoS7GlReWPhfCjENGxXCdg)
- 【一手】官方 X 账号 @DeepSeekHarness 于 2026-11-01 11:37Z 发布文章的英文版（X Article）。经 fxtwitter 接口读到约 279 万浏览、1.3 万赞；英文版是否机器翻译仅见第三方列表描述 — [X 帖子](https://x.com/DeepSeekHarness/status/2116857257245987236)
- 【一手】版本号：`dsh-superagent` package.json 为 0.1.0，依赖 `dsh ^0.2.1-alpha.2` — [package.json](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/package.json)
- 【一手】命名：文章写作 "Super-agent"，包名和代码写作 `dsh-superagent`，面板侧边栏显示 **Superagent** — [005 Panel](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/005-panel.md)
- 【二手，交叉验证】HN 上从发布当天起出现多条提交，如 2026-10-31 "DeepSeek open-sources dsh-superagent, a coding agent largely built by agents"（11 分）— [HN](https://news.ycombinator.com/item?id=50316116)；2026-10-31 "DeepSeek put the architecture for their always-on autonomous agent on GitHub"（7 分）— [HN](https://news.ycombinator.com/item?id=50321277)。这些提交分数都不高，且都是 0 评论。
- 易混淆项：
  - **ByteDance DeerFlow**：仓库描述就写着 "long-horizon SuperAgent harness"，约 84,933 star；与 DeepSeek 无隶属关系 — [bytedance/deer-flow](https://github.com/bytedance/deer-flow)
  - **superagent-ai/superagent**：是 AI 应用的 prompt injection 和数据泄露防护工具，不是 agent 框架，约 6,813 star — [GitHub](https://github.com/superagent-ai/superagent)
  - **SuperAGI**：自主 agent 框架，约 17,729 star，最后 push 为 2025-01-22（较旧，已不活跃）— [GitHub](https://github.com/TransformerOptimus/SuperAGI)
  - **forwardemail/superagent**：Node/浏览器 HTTP 客户端，与 agent 无关 — [GitHub](https://github.com/forwardemail/superagent)
  - **Genspark Super Agent**：商业产品，HN 最早记录见 2025-04（较旧）— [HN 检索结果指向的视频](https://www.youtube.com/watch?v=mXJkGF37rAE)
- 第三方蹭名项目，不要当作官方：`uppifyagency/deepseek-super-agent-harness` 自述 "Unofficial implementation… Not affiliated with DeepSeek"，创建于 2026-11-03 — [GitHub](https://github.com/uppifyagency/deepseek-super-agent-harness)；`lahavi/awesome-superagent` 是第三方资源列表，2026-11-02 创建 — [GitHub](https://github.com/lahavi/awesome-superagent)；另有 [super-agent.io](https://super-agent.io/deepseek-super-agent/troubleshooting/) 和 [theainewsreport.com](https://theainewsreport.com/2026-11-02-deepseek-dsh-superagent-permissions-explained.html) 等站点，未核验其内容，不作依据。

### Inferences
- 用户的说法方向正确，置信度约 95%：时间（三天前）、发布方（DeepSeek Harness 团队）、名称都吻合，DeerFlow 2.0 的发布时间（2026-06）和发布方都不符。
- 对外表述时建议写成 "DeepSeek Harness 团队发布的 Super-agent 设计文章与研究原型"，而不是 "DSH 发布了 SuperAgent 产品/功能"。
- 这次发布的价值主要在**架构思路和实验数据**，代码是次要的；原型本身服务的场景（单 GitHub 仓库的团队编码 agent）和 WinAgent（个人 Windows 桌面）差距很大。

### Gaps
- 因搜索工具不可用，未能系统检索机器之心、量子位、知乎、掘金、CSDN、36氪。用 curl 试过两次 Bing，只返回 DSH 产品页和第三方站点，没有找到中文媒体对 Super-agent 的报道。这**不代表**中文媒体没有报道。
- X Article 正文未读到（接口只返回链接和互动数据），分析以微信中文原文为准。
- 用户的信息来源未知，无法排除其转述的是某篇二手报道。

## 2. DeepSeek Harness 是什么？谁做的？版本状况如何？

### Takeaway
DSH 是 DeepSeek 官方开源（MIT）的 agent harness，主打 "everything is a plugin"，基于 Cordis 框架，2026-08 公开，目前仍是 developer preview，所有 GitHub release 都标为 prerelease，仍在快速迭代并明确会有破坏性变更。

### Cited Findings
- 【一手】`deepseek-ai/deepseek-harness`："open-source agent harness developed by DeepSeek AI"，MIT；仓库创建于 2026-08-13；约 270,506 star、32,882 fork；提交活跃，最新 push 为 2026-11-03 — [README](https://github.com/deepseek-ai/deepseek-harness)
- 【一手】README 明确写着 developer preview，"THERE WILL BE COMPATIBILITY-BREAKING CHANGES" — [README](https://github.com/deepseek-ai/deepseek-harness)
- 【一手】运行方式：`npx @deepseek-ai/dsh web`，Web UI 默认在 `127.0.0.1:3080`；官网提供 macOS 和 Windows 64 位桌面版下载 — [README](https://github.com/deepseek-ai/deepseek-harness)、[官网](https://www.deepseek.com/en/harness/)
- 【一手】架构：底层是 Cordis（plugin 向共享 context 贡献 service、typed event 和可逆 effect）。模型适配器、工具注册表、session 日志，甚至 agent loop 本身都是 plugin，可经配置替换；"没有需要打补丁的特权核心" — [architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- 【一手】组合模型：**profile**（命名组合，模板有 `web`、`headless`、`sdk`、`sdk-minimal`、`acp`）+ **bundle**（Cordis 配置行及其代码的分发格式）+ 分层 patch（`cordis.patch.yml`），可用 `dsh --profile web --dump-config` 查看启动树 — [architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- 【一手】桌面版是 Electron，内置 dsh 运行时；私有 Desktop Host 调用共享的 CLI profile runner 和完整 Web 应用，窗口加载打包好的 Web 资源 — [architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- 【一手】`packages/` 下有 team、goal、workflow、jobs、spill、sandbox、compaction、computer-use、browser-use、ptc-runtime、schedule、mcp、skill、lsp、ssh 等包组 — [packages 目录](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages)
  - **goal**：每个 session 一个跨重启、resume、fork 的持久目标，可选自动 continuation — [goal README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/goal/README.md)
  - **workflow**：由模型编写编排脚本来 fan-out subagent — [workflow README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workflow/README.md)
  - **team**：subagent 树共享任务板 — [team README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/team/README.md)
- 【一手】安全：SAFETY.md 写明未经安全审计，沙箱和审批不保证隔离，不可作为不可信负载的唯一安全控制 — [SAFETY.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/SAFETY.md)
- 【一手】发布时间线（均来自 [GitHub Releases](https://github.com/deepseek-ai/deepseek-harness/releases) 和 [npm](https://www.npmjs.com/package/@deepseek-ai/dsh)）：
  - 2026-08-10：npm 首个版本 `0.0.1-rc.1`
  - 2026-08-13：仓库创建；HN "DeepSeek Harness developer preview" 747 分、314 评论 — [HN](https://news.ycombinator.com/item?id=49285244)
  - 2026-09-28 / 09-29：`v0.2.0-rc.1` / `rc.2`。rc.2 的桌面版可管理和安装 dsh 命令；实验性异步问答（等待超时后 Agent 可继续独立工作，用户可稍后回答）— [rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2)
  - 2026-10-17：`v0.2.1-rc.1`。自定义插件索引源、"让 Agent 创建插件"入口、插件热更新、极简模式、Claude Code 和 Codex 组合包、实验性 Claude Code Mods 兼容层、Session 状态记录接口、Git Worktrees 插件、SSH helper 运行时、消息内密钥识别与脱敏 — [rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.1)
  - 2026-10-28：`v0.2.2-alpha.2`。实验性 `subagent_oar` 工具（把独立任务交给本机 Codex 或 Claude CLI）、按轮次和步骤看上下文、缓存、模型与工具耗时的统计插件、"变更请求与工作树" — [alpha.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-alpha.2)
  - 2026-10-30：`v0.2.1-rc.5`，当前 npm `latest` 标签指向它 — [rc.5](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.5)
  - 2026-11-03：`v0.2.2-alpha.3`。统一右键与键盘菜单、文件预览常驻目录树、变更请求与工作树统一代码审查入口、Trajectory 可折叠子调用 — [alpha.3](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-alpha.3)
- 【一手，本地】WinAgent 与 DSH 的关系：仓库里有 `dsh-plugin/`（包名 `dsh-winagent` 0.5.1）和 `dsh-one/`（12 个分类插件、68 个静态工具），验证记录中实测的是 "DSH 0.2.0-rc.2"。本地文件见 `C:\Users\53031\Desktop\WinAgent\dsh-one\WinAgent-插件验证记录.md`。

### Inferences
- WinAgent 的插件验证基线（0.2.0-rc.2）已落后当前 npm latest（0.2.1-rc.5）；考虑到官方声明会有破坏性变更，若继续维护插件需重新验证。但项目记忆记录了 2026-09-29 起 dsh-plugin 暂停，新功能做在 `src/main` + renderer，所以这件事的优先级由用户决定。
- 270k star 对一个不到三个月的仓库来说很高，只作热度参考，不能代表实际使用规模或质量。

### Gaps
- Cordis 论文（arXiv 2608.25512，README 引用）未阅读。
- DSH 没有非 prerelease 版本，因此不存在"稳定版"日期；未逐一阅读全部 release notes，上面只列与 agent 能力相关的条目。

## 3. Super-agent 的设计：文章提出了什么？（架构思路，一手文章）

### Takeaway
核心论点是：单任务的上限取决于模型能力，**多任务的上限取决于人的注意力**。为此把 Session 从用户概念降级为实现细节，并用五个模块（双层架构、事件驱动、全双工多信道交互、计算-状态-环境分离、外部 Watchdog）让 Agent 成为连续、高效、主动、持久的实体。作者明确说没有新理论，只是把经典系统思想用到 agent 上。

### Cited Findings
以下全部出自【一手】[微信原文](https://mp.weixin.qq.com/s/zoS7GlReWPhfCjENGxXCdg)。

- **问题定义**：团队观察到一个人通常只能同时跟进 3 到 5 个活跃 Session；只在本地单会话 Agent 上接 CLI、MCP 或连接器，仍受单会话同步阻塞、多任务上下文混乱、设备离线即停的限制。
- **四个基础特征**：连续（只感觉到一个 Agent）、高效（不等上一任务完成就能接单）、主动（观察事件，不需要时保持安静）、持久（始终在线，异常自愈）。
- **双层架构（第 2 节）**：
  - Router 层常驻，承接所有人类交互，充当全局序点、协调点和记忆；不执行具体任务，"甚至可以不配备 Bash 工具"，用较轻量模型往往够用。
  - Worker 层上下文隔离、挂完整工具、配最强模型，向 Router 汇报；内部可再开 Subagent 或 Agent Team，对 Router 透明。
  - 与常见 Agent Team 的区别：Team Lead 负责单任务内部拆解，推理负载重；Router 只处理任务之间的关联与分派。
  - 让用户手动管理 Session 被形容为"从底层 LLM API 延续下来的设计惯性"。
- **事件驱动（第 3 节）**：
  - 3.1 两级过滤：确定性程序策略是 Fast Path（来源、群组、白名单），LLM 语义策略是 Slow Path（用提示词写，可随时增改）。
  - 3.2 订阅与直通：Worker 订阅 Thread，后续事件由程序直达 Worker，不经 Router；Worker 可退订或交回；订阅是多对多，多个 Worker 靠同一 Thread 的事件感知彼此，不需要点对点通信。
  - 3.3 上下文当 Cache 管理：Inline（把近期很可能用到的内容内联）和 Spill（超预算内容放窗口外，只留引用或摘要，附续读入口）；从 ID+摘要起步，按局部性逐步内联相邻内容。
  - 3.3 链式召回（Chain of Recall）：Trigger、Thread、Worker Session 都有唯一 ID，每次召回结果又内联下一跳的摘要和 ID，形成可逐跳展开的引用图。
  - 3.4 投机执行：先在后台尝试，有价值才交付，否则丢弃。实例是内部群的"静默复现并修复"策略，只有确认问题并找到简单修复后才出声，否则全程安静。
- **面向人的交互（第 4 节）**：
  - 全双工：把耗时工具改成异步 `start()` / `stop()`，立即返回 Started，完成结果作为新事件投递。文章说明这一机制已在 DSH 实现但尚未默认开启。
  - 多信道：IM 上单次回复不超过 100 词（团队验证过的硬规定）；GitHub、邮件等异步信道走结构化、高密度交付。
- **存算分离（第 5 节）**：Agent Loop 做成云端无状态计算，Session 状态进数据库；重状态执行环境留在原地，端侧只放不保存会话状态的轻量 daemon。支持 BYOM（Bring Your Own Machine）和间歇在线设备。文章明确引用 Anthropic 的"脑手分离"（Decoupling the brain from the hands）作为同类思路，差别在于这里优先接入用户的个人机器。
- **Watchdog（第 6 节）**：主系统外独立的 Watchdog Session，由定时消息驱动，构成外部 Control Loop。除基础设施故障外，还由模型判断 Worker 是否有实质进展、是否偏离目标；维护者可用自然语言问它故障原因，也可以让它在线修提示词和触发规则。
- **实验（第 7 节，作者自称基于合成负载、仅作初步参考）**：
  - 消融实验：约 300 条消息、约 20 个工作请求，编码工作用只消耗时间的工具代替，每方案跑 5 次。Super-agent 任务完成时间 p50 为 12.4 分钟、p95 为 15.7 分钟。
  - 单 Session + Subagent 在中性提示下，5 次运行一次都没调用 Subagent，p95 为 29.5 分钟；改成提示优先委派后 4/5 次委派，仍慢于 Super-agent，且剩下 1 次形成长尾。
  - 去掉直通后完成时间基本不变，但 Router 决定数增加约 30%，读缓存 token 从 2323 万增到 3177 万（约 37%）。结论是直通省 token，不提升速度和质量。
  - Super-agent 的读缓存 token 高于单 Session，即用更多 token 换更短、更稳定的完成时间。
  - Router 批处理：Trigger 到达率从约 1 条/分升到约 40 条/分时，平均 batch 从 1.0 升到 2.8，单次请求耗时从 2.5 秒升到 3.9 秒，单个决定分摊的推理时间从 6.4 秒降到 1.6 秒。
- **作者承认的开放问题（第 8 节）**：Router 何时切分；跨月长程记忆是主要瓶颈；脱离 Session 后如何做人机协作和中途接管；上下文边界与 A2A；安全隐私（云端被攻破或 prompt injection 会波及所有端侧设备，需要让 Agent 不接触凭据本身而使用凭据）。

### Inferences
- 实验的编码工作是 mock 的，所以数据只说明调度能力，**不能**说明 Super-agent 的代码产出更好。"显著优于"也只是在该合成负载下成立，且没有报告显著性检验。
- 最有说服力的一点是定性结果：模型不会可靠地自己选择委派。这说明分工应该由系统结构保证，而不是靠提示词劝说。

### Gaps
- 文章中的图未读取（只读到图注），实验曲线的具体形状未核对。
- 内部实例的规模（团队人数、日均 Trigger）文章未给出，只说"在我们目前的团队规模下已经够用"。

## 4. 原型实际实现了什么？（代码和文档，及与文章的差异）

### Takeaway
原型是一个面向**单个 GitHub 仓库**、可选接入 Feishu 的主动式编码 agent，以 DSH bundle 形式发布，单机运行，状态存 SQLite。双层架构、两级过滤、订阅直通、异步后台都落地了；存算分离和 Watchdog 在文档中找不到。其工程价值最高的部分是一套严格的领域模型和授权模型。

### Cited Findings
- 【一手】定位：监听 GitHub 和可选的 Feishu；有权限的人发起请求时开工单，在独立 session 和目录中工作，在原对话回复（如提 PR）；Web 面板展示需要人处理的事项 — [README](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/README.md)
- 【一手】总原则："take as little human attention as possible, and give as much value as possible"。每条消息、设置、面板元素都按注意力成本评估；只在被请求或有成文规则时行动，只在有人必须行动或能用上结果时说话，每次只问一个具体问题，按影响而不是工作量决定何时停，诚实报告 — [000 Philosophy](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/000-philosophy.md)
- 【一手】领域模型：Source → Trigger → Thread → Eval（gate + assessment）→ Decision → Ticket（带不可变 Mandate）→ Assignment → Executor，结果经 Channel 返回。Correlation 只加上下文、不路由；Ticket 定义自己的状态，不跟随 DSH Session 状态 — [001 Domain](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/001-domain.md)
- 【一手】文档保留了 "Rejected concepts" 表，逐条写出被否决的设计及理由，如 "按报告自由文本推断等待人工"（需要结构化字段）、"Policy 变更时取消运行中 Ticket"（会留下半成品）— [001 Domain](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/001-domain.md)
- 【一手】授权：host 用代码强制执行 allowed list、规则和 Mandate；消息、评论、引用文档只是决策输入，不能改变权限。上下文通道（Subscription）和授权通道（Eval）是分开的：bot 和 CI 消息能作为上下文到达 Ticket，但不授予新权限 — [002 Authorization](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md)
- 【一手】强度分 explicit 和 inferred。accept mode 三档：`off`、`observe`（默认，正面判断只记录为 "would accept"）、`auto`。显式请求在所有模式下都生效；建议从 observe 开始，审阅记录后再切 auto — [002 Authorization](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md)
- 【一手】Policy 有版本：版本变更丢弃运行中的 Eval 并重新排队，给受影响的 live Ticket 发 policy-changed 输入，但**不**立即撤销 Mandate；恢复已结束 Ticket 前要重新校验 — [002 Authorization](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md)
- 【一手】Ticket 阶段是从上到下首条匹配的互斥表（person/delivery、person/answer、person/review、person/blocked·failed、working/queued、idle、working），面板标签说明等谁、等什么 — [003 Execution](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md)
- 【一手】异步落地：worker preset 把前台 shell 命令 5 秒后转后台，让 worker 下一步就能收到新消息；回合结束后后台任务最多 30 分钟；job 或 subagent 完成后唤醒 Executor — [003 Execution](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md)
- 【一手】Router 不等待：`noWait` guard 拒绝 `sleep`、超过 30 秒的 shell 超时和超过 5 秒的 job 等待 — [007 Architecture](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md)
- 【一手】并发：配置的并发上限之外，再留一个槽给人的消息或状态请求，所以新任务不会挡住人继续已有 Ticket — [003 Execution](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md)
- 【一手】恢复：决定之后的动作"先存储、后执行"（effect 队列）；重启时运行中的 Assignment 以 "host restarted" 结束，新 Assignment 带恢复说明，要求先检查目录、git 历史和 GitHub，再决定是否重复对外动作；对瞬时错误（408、429、5xx、连接错误）重试 3 次并退避 — [003 Execution](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md)
- 【一手】持久化：单个 SQLite 文件 `<stateDir>/orchestrator.sqlite`；`Engine` 是 Trigger、Thread、Decision、Ticket、Assignment 的唯一写入者，方法全同步，每个命令一个事务；端口在事务内入队外部工作，提交后才由适配器执行 — [007 Architecture](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md)
- 【一手】工具面：main Session 有 14 个应用工具，`orchestrator_route` 一次接受 1–20 个决定且逐条独立执行；Executor 有 6 个（read、ack、report、thread_unrelated、thread_follow、trigger_handback）— [007 Architecture](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md)
- 【一手】提示词：组装时 Policy 段放最后，"so a Policy change leaves the preceding prompt text unchanged"；每次模型请求都读最新版本；每次保存生成不可变版本；升级时团队覆盖项标 "Default updated" 并展示差异。优先级从强到弱：host 强制事实 > 内置和生成段 > 规则 > 团队段 > 外部文本（外部文本只是数据）— [004 Prompts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/004-prompts.md)
- 【一手】消息规范：聊天默认一句话，硬上限 100 词；routing note 最多 30 词；每条 GitHub 消息默认以 "This is by an automated agent, not a human" 开头；无真实 before 截图的 UI 改动不算 ready；每个自动 reviewer 每 PR 最多三轮 — [004 Prompts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/004-prompts.md)
- 【一手】面板只回答三个问题：现在有没有需要我处理的？系统健康吗？这项工作的历史是什么？健康状态不占空间；计数必须等于其链接列表的长度 — [005 Panel](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/005-panel.md)
- 【一手】安装：让编码 agent 读 SETUP.md，由它一次问一个问题完成配置 — [README](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/README.md)
- 【一手】可扩展点：Source 是 kind + instance，有专门的 cookbook 讲新增 Source — [008 Cookbook](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/008-cookbook.md)
- **文章与原型的差异**（均为【一手】文档对比）：

| 主题 | 文章 | 原型 |
| --- | --- | --- |
| Router 工具 | "甚至可以不配备 Bash" | main Session 有 `bash`、`read` 等，"避免读代码"只是提示词规则，不是工具限制 — [007](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md) |
| 谁对外说话 | Worker 不直接与人交互，由 Router 统一回复 | Executor 用 `orchestrator_ack` 在原消息下确认请求，并自行处理跟进 — [004](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/004-prompts.md) |
| 持久与部署 | Agent Loop 上云，端侧 daemon | 单 profile、单 SQLite，服务绑定 `127.0.0.1` — [006](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md) |
| Watchdog | 独立外部 Session | 文档、提示词及抽查的 4 个源文件中无 "watchdog"；有 health 条目、退避重试和重启恢复作为替代 |
| 投机执行 | 作为独立概念 | 无此术语；可由 inferred 规则 + 静默规则 + `dropped` 报告组合出近似效果（后半句为【推断】） |
| Inline & Spill | 明确命名 | 文档未用这两个词；Trigger card 内联、截断内容给 resource pointer，机制相同 — [004](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/004-prompts.md) |

- 【一手】原型不是安全边界：两个 preset 都以 `danger-full-access` 和操作者 OS 用户身份运行 — [006](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md)；Executor 执行命令无需审批，blocked commands 和目录只是默认值，"not a security boundary"，可用绝对路径绕过 — [003](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md)。信任模型本身也列在 Open questions 中 — [007](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md)

### Inferences
- 记忆方面原型没有独立的长期记忆子系统：`src/core/memory.ts` 只是测试用内存仓储实现（[源码](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/src/core/memory.ts)），连续性靠常驻 main Session、引用图和 Thread 历史。不要把它宣传成"有长期记忆"，文章自己也承认跨月记忆是瓶颈。
- 沙箱同理：原型没有沙箱隔离；不要照抄其 `danger-full-access` 模型到面向普通用户的桌面应用。

### Gaps
- 未完整阅读 `src/` 源码。"Watchdog、daemon 未实现"的依据是：README、SETUP、全部 docs 和主要 prompts 的关键词检索无命中，文件名无匹配，抽查 4 个源文件（runtime、retry-health、sessions、cordis.patch.yml）无命中。GitHub 代码搜索对该仓库返回 0 条，可能是新仓库尚未索引，不能当证据。
- 未实际运行原型（按要求不下载执行），所有行为描述都来自文档，未经实测。

## 5. DeerFlow 2.x（最可能的混淆对象）是什么？

### Takeaway
DeerFlow 2.0 是 ByteDance 基于 LangGraph/LangChain 重写的、自带电池的 "super agent harness"，走"单任务长程 + 沙箱 + 记忆 + 子代理"路线。它和 DeepSeek Super-agent 不是一回事，但 2.1 的可验证执行和批量委派同样值得参考。

### Cited Findings
- 【一手】2.0.0 正式 release 为 2026-06-25：ground-up rewrite，与 1.x 无共享代码，围绕 sub-agents、持久记忆、沙箱执行、skills/tools 编排 — [v2.0.0](https://github.com/bytedance/deer-flow/releases/tag/v2.0.0)
- 【一手】README 说明基于 LangGraph 和 LangChain，"no longer a framework you wire together" — [README](https://github.com/bytedance/deer-flow)
- 【二手】"Super Agent Harness" 的说法早于正式 release，第三方源码解析书 2026-03-11 已在使用（较旧）— [coolclaws/deerflow-book](https://github.com/coolclaws/deerflow-book)
- 【一手】2.0 亮点：agent 可在聊天中修改自己的 `SOUL.md` / `config.yaml`；用户可绑定自己的 IM 账号（Slack、Telegram、Discord、Feishu、钉钉、微信、企业微信）；可配置的循环检测；子代理 token 用量实时展示 — [v2.0.0](https://github.com/bytedance/deer-flow/releases/tag/v2.0.0)
- 【一手】2.1.0（2026-09-24，772 个合并 PR）主题是 trust、scale、operability — [v2.1.0](https://github.com/bytedance/deer-flow/releases/tag/v2.1.0)：
  - 可验证执行：每次工具调用带防篡改 receipt，子代理报告必须引用 receipt，父侧确定性校验 `acceptance_criteria`（文件存在、测试退出码），无法判定的报告 UNVERIFIED
  - 规模：委派账本防重复委派，总量上限，`batch_task` 提供 SQL 持久化、可恢复批处理（lease、重试、暂停/恢复/取消）
  - 记忆可插拔：OpenViking、mem0、Honcho 后端，内置 FTS5/BM25，LLM 辅助整合和过期清理
  - 沙箱：新增 E2B、BoxLite（micro-VM）、Tenki、OpenSandbox，以及本地 Docker 的网络出站 allowlist
  - 其他：out-of-tree 扩展、OIDC/SSO、RBAC

### Inferences
- 两者的差异可概括为：DeerFlow 把**一个长任务**做可靠（沙箱、记忆、可验证），Super-agent 把**很多并发任务和人的注意力**管好（路由、订阅、授权、少打扰）。两者互补，不冲突。

### Gaps
- 未完整阅读 DeerFlow README 和 CHANGELOG（仅读 release notes 主体及 README 目录），2.1 的 breaking changes 未逐条分析。

## 6. 第三方桌面 Agent 可以借鉴哪些具体设计？

### Takeaway
最值得借鉴的不是"多 agent"本身，而是**由系统结构保证分工、把确定性判断放在模型前面、把权限和上下文分开、按注意力成本设计 UI**。这些都能在单机上低成本实现，不需要上云。

### Cited Findings
可借鉴点所依据的原始设计均已在第 3、4 节列出并给出来源；这里只列最关键的依据：
- 分工靠结构：单 Session 在中性提示下 5 次运行 0 次委派 — [文章 7.1](https://mp.weixin.qq.com/s/zoS7GlReWPhfCjENGxXCdg)
- 权限和上下文分离，外部文本只是数据 — [002](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md)、[004](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/004-prompts.md)
- 先存储后执行、重启带恢复说明 — [003](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md)
- 可验证执行（DeerFlow）— [v2.1.0](https://github.com/bytedance/deer-flow/releases/tag/v2.1.0)

### Inferences
以下全部是【推断】，尚未结合 WinAgent 代码做可行性评估；优先级按"投入小、收益明确"排序。按项目记忆，落点应在 `src/main` + renderer，后台模型调用应走 taskChat（防止思考耗尽预算的既有约束）；涉及界面大改的需先出预览。

| # | 可借鉴设计 | 在 WinAgent 中的样子 | 投入 |
| --- | --- | --- | --- |
| 1 | 异步工具 + 超时转后台 | 长命令 N 秒后转后台并返回 Started，完成后作为事件注入，用户可随时插话 | 中 |
| 2 | Inline & Spill 与续读入口 | 工具结果和文档设长度上限，超出部分截断并给可读取的引用，而不是整段塞入上下文 | 小 |
| 3 | 一句话 + 结构化提问 | 后台任务只在有结果、需决策、失败时通知；一次只问一个问题；设字数硬上限 | 小 |
| 4 | Fast/Slow Path 两级过滤 | 若做文件夹、邮件、剪贴板、Wiki 剪藏等事件触发，先用确定性规则滤噪，再调模型 | 中 |
| 5 | Observe 模式（只记录"本来会做什么"） | 任何主动行为默认只记录，用户审阅后才切 auto；很适合桌面端建立信任 | 小-中 |
| 6 | Ticket 与 Mandate | 每个后台任务记录"谁发起、范围、依据哪条规则"，扩大范围要新建任务；外部网页和文档内容不能提权 | 中 |
| 7 | 互斥的任务状态表 + 只显示需要人的面板 | 任务面板按"等谁、等什么"分组，健康状态不占空间 | 中 |
| 8 | 先存储后执行 + 恢复说明 | 对外动作写入队列（SQLite），重启后提示 agent 先核对现状，再决定是否重复 | 中 |
| 9 | 按 Thread 路由的 Worker | 单一聊天界面背后按话题分 Worker；Router 用便宜模型（Flash），Worker 用强模型 | 大 |
| 10 | 进展型 Watchdog | 定时让轻量模型判断长任务有无实质进展、是否死循环；比进程存活检测更有用 | 中 |
| 11 | 投机执行 | 如 Wiki 新剪藏时后台预先分析，结果有价值才提示。注意费用，需设预算和开关 | 中 |
| 12 | 可验证交付（DeerFlow） | 子任务宣称完成时由父侧确定性校验（文件存在、退出码），否则标 UNVERIFIED | 中 |
| 13 | Prompt 版本化 + 动态段放最后 | 人设和规则分版本保存；动态内容放系统提示词末尾以保持前缀缓存命中 | 小 |
| 14 | Setup 由 agent 带着做 | 复杂配置（MCP、Provider）由 agent 一次问一个问题完成 | 小 |
| 15 | 保留 "Rejected concepts" 文档 | 记录否决过的设计及原因，避免 agent 和后来者反复提议 | 很小 |

不建议照搬：
- 云端 Agent Loop + daemon：WinAgent 是个人桌面应用，这部分复杂度高，而且文章自己承认有重大安全隐患。可以只借鉴"计算与状态分离"（状态全部落盘，进程可随时重启）。
- `danger-full-access`：原型面向有运维能力的开发者，且要求专用 profile 和专用 GitHub 账号；WinAgent 现有的危险操作确认不应放松。
- 跨月长程记忆：官方也未解决，这方面 WinAgent 的 LLM Wiki 是自己的路线，不必向原型看齐。

### Gaps
- 未评估 WinAgent 现有代码能否直接支持上述各项（如 agent loop 是否已具备异步工具），需要后续结合代码判断。
- 文章的效果数据来自团队编码和合成负载，**没有**个人桌面场景的证据；第 9 项（Router/Worker）在单用户、低事件率下是否值得，目前没有数据。文章的批处理和吞吐优势都出现在高事件率下。

## 7. 相关的 DeepSeek 近期动态（模型和 API 对 Agent 的影响）

### Takeaway
最近半年 DeepSeek 明显转向 agent 场景：V4-Pro GA、V4.1-Flash、三档思考强度、1M 上下文、自研 Search/Fetch API。对 WinAgent 影响最直接的是思考默认开启、带工具时必须回传 `reasoning_content`，以及缓存命中价差极大。

### Cited Findings
- 【一手】更新时间线 — [Change Log](https://api-docs.deepseek.com/updates)：
  - 2026-07-31：DeepSeek-V4-Flash 正式版 API 公测，原生支持 Responses API 格式并适配 Codex
  - 2026-08-13：V4-Pro GA；思考强度支持 low / high / max；官方建议简单任务 low、日常 Agent 任务 high、复杂场景 max
  - 2026-08-16 16:00 UTC：峰谷定价生效，谷时为峰时半价
  - 2026-08-21：V4-Flash-Vision-Exp
  - 2026-09-10：V4.1-Flash（新架构家族中最小的模型，原生多模态）；V4 Pro 继续提供
  - 2026-10-17：V4.1-Flash-1017，声称缩短任务耗时和输出长度，并针对 DSH、CodeBuddy、WorkBuddy 优化，建议升级到 DSH 0.2.1-rc.1 及以上；同日开放自研 Search/Fetch API
  - 2026-04-24 也有一条更新（较旧，内容未读）
  - 以上各版本的 benchmark 分数都是 DeepSeek 自报，未见第三方复现。
- 【一手】当前模型：`deepseek-flash`（V4.1-Flash-1017，支持 Vision）和 `deepseek-v4-pro`（V4-Pro-0813，不支持 Vision）；上下文 1M，最大输出 384K；支持 Tool Calls、JSON Output、Responses API、Anthropic API。旧名 `deepseek-v4-flash` 等仍可用，但实际路由到 V4.1 Flash — [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- 【一手】思考模式 — [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)：
  - **默认开启，默认强度 high**；OpenAI 格式用 `extra_body={"thinking":{"type":"enabled/disabled"}}` 开关，`reasoning_effort` 调强度（minimal 映射到 low，medium、xhigh 映射到 high，ultra 映射到 max）
  - 思考模式下 `temperature`、`presence_penalty`、`frequency_penalty` 不生效，也不报错
  - **请求带 `tools` 时，此前各轮的 `reasoning_content` 都应回传并拼入上下文；不带 `tools` 时无需回传，回传也会被忽略**
- 【一手】上下文缓存 — [Context Caching](https://api-docs.deepseek.com/guides/kv_cache)：默认开启、无需改代码；基于前缀，命中要求完整匹配已持久化的前缀单元；单元产生于用户输入末尾和模型输出末尾、公共前缀检测，以及长内容按固定 token 间隔切分。
- 【一手】价格（每百万 token，峰时）— [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)：
  - Flash：缓存命中 $0.006，未命中 $0.3，输出 $1.2
  - V4 Pro：缓存命中 $0.044，未命中 $1.32，输出 $3.96
  - 谷时减半；峰时为周一至周五 01:00–04:00 和 06:00–10:00 UTC
- 【一手】Search/Fetch：`POST /v1/tools/search` 和 `/v1/tools/fetch`，每千次成功请求 $0.75 — [Search & Fetch](https://api-docs.deepseek.com/guides/search)。价格页称经 DSH、Claude Code、Codex 使用时的服务端工具调用自北京时间 2026-11-01 00:00 起按次计费 — [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- 【一手】并发限制：Flash 2500，V4 Pro 500 — [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)

### Inferences
- 缓存命中和未命中的价差约为 Flash 50 倍、Pro 30 倍。这解释了 Super-agent 的做法：把 Policy 段放在提示词最后以保持前缀稳定，并按读缓存 token 衡量开销。WinAgent 若在系统提示词靠前位置注入时间戳等动态内容，会损失大量缓存命中，值得检查。
- "Router 用 Flash、Worker 用 Pro" 与文章"Router 用轻量模型、Worker 用最强模型"一致，但要注意 V4 Pro 不支持 Vision，涉及图片的 Worker 可能反而要用 Flash。
- 带工具时必须回传 `reasoning_content`，这与项目记忆中的 v0.5.1 思考耗尽预算事故相关：默认开启思考的模型，后台调用要显式关闭或预留预算。README 已记载 TaskChat 的相关处理；工具循环这条路径是否正确回传，建议用代码核实。

### Gaps
- 未读 Tool Calls、Rate Limit、Search 计费细则页面。
- 价格页关于 2026-11-01 开始计费的措辞为"currently free"，而该日期已过，页面可能未更新；实际是否已开始计费未核实。
