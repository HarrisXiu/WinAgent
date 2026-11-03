# 桌面/Windows Computer-Use Agent、记忆、协议与安全的近期创新（截至 2026-11-03）

> **取证说明（影响所有章节的可信度）**：本轮 `WebSearch` 全部失败（模型配置错误），`WebFetch` 仅对 learn.microsoft.com 等少数站点可用，其余页面通过内置浏览器直接阅读，没有下载或执行任何内容。DuckDuckGo 弹出人机验证后我没有尝试通过，也就没有通用搜索引擎；选题靠官方博客首页、官方文档和 arXiv 站内检索，因此**可能漏掉只发在媒体或个人博客上的内容**。arXiv 条目除 UFO2 外**只读了摘要**，均为预印本，未核对全文方法，除非另有标注也未经同行评审。标 **【较早背景】** 的是 2026-05 之前的材料。"厂商自报"指数据来自产品方自己，未见独立复现。

## 1. Windows 桌面控制：UIA 与截图点击、微软平台能力的现状

### Takeaway
2026 年最大的平台变化是 **Microsoft Execution Containers (MXC) 于 2026-10-07 GA**，它把 AppContainer、独立 session、WSL 容器、MicroVM 统一到一套 JSON 策略之下。感知层面，纯截图模型的分数已经大幅提高，但现有证据仍支持"UIA + 视觉 + 原生 API"混合：没有找到 2026 年 Windows 上 UIA 与截图的直接对照实验，最接近的是 2025 年的 UFO2，其绝对成功率也只有约 30%。

### Cited Findings

**MXC 与 Windows 平台**
- MXC 在 Build 2026（2026-06-02）以 SDK early preview 亮相，定位是由开发者声明 agent 可访问的文件、网络等资源，并在运行时强制执行边界 — [Windows Developer Blog, Build 2026](https://blogs.windows.com/windowsdeveloper/2026/06/02/build-2026-furthering-windows-as-the-trusted-platform-for-development/)
- MXC 于 **2026-10-07 宣布 GA**；提供统一 JSON 配置 schema 和多语言 SDK，可映射到 Windows/macOS/Linux 后端；策略在 agent 工作负载控制范围之外，agent 不能自我授权 — [MXC 公告](https://blogs.windows.com/windowsdeveloper/2026/10/07/microsoft-execution-containers-policy-driven-containment-for-ai-agents/)
- MXC 四种后端（同一来源）：
  - **Process container**：Win11/macOS/Linux，Windows 上使用 AppContainer，macOS 用 Seatbelt，Linux 用 Bubblewrap，面向模型生成代码和工具执行。
  - **Session container**：仅 Win11，独立 Windows 账户和 session，桌面、剪贴板、UI、输入与用户分离，面向长时运行和需要桌面的自动化。
  - **WSLc**：仅 Win11，面向 Linux 工具链。
  - **MicroVM**：Win11/Linux，**实验性**，硬件隔离。
  - 来源：[MXC 公告](https://blogs.windows.com/windowsdeveloper/2026/10/07/microsoft-execution-containers-policy-driven-containment-for-ai-agents/)
- MXC 策略覆盖 containment、process、文件系统（可写/只读/禁止）、网络（含 loopback）、用户界面访问 — [同上](https://blogs.windows.com/windowsdeveloper/2026/10/07/microsoft-execution-containers-policy-driven-containment-for-ai-agents/)
- MXC 有三种运行模式：Enforcement（拦截，无报告）、Learning（拦截并记录 JSON 活动报告）、Permissive（放行并记录）。公告称活动报告是 Windows process container 独有。微软还要求被策略拦截时 agent 应向用户说明，不能静默失败 — [同上](https://blogs.windows.com/windowsdeveloper/2026/10/07/microsoft-execution-containers-policy-driven-containment-for-ai-agents/)
- Intune 管理 MXC 策略、Entra 区分 agent 与用户活动仍是"即将推出" — [同上](https://blogs.windows.com/windowsdeveloper/2026/10/07/microsoft-execution-containers-policy-driven-containment-for-ai-agents/)
- 同在 Build 2026 宣布：OpenClaw 借助 MXC 原生运行于 Windows；NVIDIA OpenShell 基于 MXC 登陆 Windows；Windows 365 for Agents GA（给 computer-using agent 提供托管 Cloud PC）；Windows Development Skills GA — [Build 2026](https://blogs.windows.com/windowsdeveloper/2026/06/02/build-2026-furthering-windows-as-the-trusted-platform-for-development/)
- WSL containers 已 GA（博客 URL 日期 2026-09-29；只读到标题）— [Windows Developer Blog 首页](https://blogs.windows.com/windowsdeveloper/)

**MCP on Windows / agent connectors / agent workspace**
- Windows On-device Agent Registry (ODR) 提供 MCP server 发现、默认隔离、用户和管理员控制、日志审计，以及 `odr.exe` 命令行工具；内置 File Explorer、Windows Settings 等 connector。文档更新于 2026-06-04，仍标注预发布 — [MCP on Windows overview](https://learn.microsoft.com/en-us/windows/ai/mcp/overview)
- 隔离运行的硬条件：`.exe` 形式、有 package identity、通过 MSIX 扩展注册并带 manifest.json。**MCP bundle（.mcpb）和未打包应用无法隔离运行**，只有用户开启 "Reduce protections for agent connectors" 才能使用 — [Containment](https://learn.microsoft.com/en-us/windows/ai/mcp/servers/mcp-containment)；[Server overview](https://learn.microsoft.com/en-us/windows/ai/mcp/servers/mcp-server-overview)
- 隔离 server 跑在独立 session 和独立 agent 账户，默认碰不到用户文件、注册表、凭据和用户窗口，但**可以上网**。文件授权是**按 host 而非按 server**：host 获授权后，它使用的所有 server 都能访问 — [Containment](https://learn.microsoft.com/en-us/windows/ai/mcp/servers/mcp-containment)（文档更新于 2025-12-04，**较早背景**）
- Agent workspace：每个 agent 独立账户、独立 session，微软称常见操作比 Windows Sandbox 这类完整 VM 更高效；Copilot Actions 在 Copilot Labs 中面向 Insiders。页面最后一次编辑说明为 2025-12-05 — [Experimental Agentic Features](https://support.microsoft.com/en-us/windows/ai/ai-features/experimental-agentic-features) **【较早背景】**
- Windows Sandbox：hypervisor 隔离、用完即弃、默认**开启网络**、不能多实例，**不支持 Home 版**（页面更新于 2026-10-08）— [Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-overview)

**开源工具**
- Windows-MCP：约 11k star、1.2k fork（2026-11-03 查看），最新 release v0.8.8（2026-10-10），MIT，要求 Python 3.14+；自报 Claude Desktop Extensions 用户 2M+、动作间延迟 0.2–0.5 秒（**自报，未含 LLM 推理，无基准报告**）。支持 `--tools`/`--exclude-tools` 白名单和黑名单、浏览器 `use_dom` 模式（Firefox 退回 IAccessible2）— [GitHub](https://github.com/CursorTouch/Windows-MCP)
- Windows-MCP 近期修复反映了 UIA 实战中的坑：Snapshot 在重复的祖先 RuntimeId 上无限递归、切换窗口后需校验前台窗口才能报告成功 — [Releases](https://github.com/CursorTouch/Windows-MCP/releases)
- UFO 仓库：UFO² 现标为 LTS，新的 UFO³ Galaxy 转向多设备 DAG 编排，覆盖 Windows/Linux/Android，处于活跃开发 — [microsoft/UFO](https://github.com/microsoft/UFO)

**测量结果**
- **【较早背景，2025-04】UFO2**（测试模型为 GPT-4o、o1，已是旧模型）— [arXiv 2504.14603 全文](https://arxiv.org/html/2504.14603)：
  - WAA 成功率：Operator 20.8%；UFO2-base（仅 UIA + GUI）23.4%；完整 UFO2 27.9%（o1 下 30.5%）。
  - OSWorld-W：Operator 14.3%；UFO2 28.6%（o1 下 32.7%）。
  - UIA + OmniParser 混合检测优于任一单独方案，最多把 9.86% 原本无法恢复的案例变为完成。
  - GUI + API 混合使成功率提升 6.1%（GPT-4o）、8.2%（o1），步数减少 6.5%、58.5%。
  - 投机式多动作在成功率相近时，步数减少最多 10%（WAA）、51.5%（OSWorld-W）。
  - LibreOffice 普遍偏低，论文归因于 UIA 支持差；Microsoft 365 类应用可达 51.9%。
  - 注意：这是作者自评；论文写的"高 10%"与 WAA 上的 7.1 个百分点差距口径不一，引用时要写清基准。
- Qwen-CUA（2026-08-03）**只用截图和键鼠**，OSWorld-Verified 86.2、OSWorld 2.0 二元/部分完成 18.5/48.4；更大的 Max 版为 87.6、21.2/53.3；RedTeamCUA 攻击成功率从 36.6 降到 16.4。训练用了近 10 万 vCPU、约 4 万个可验证任务，一般团队无法复制；摘要也把 hybrid tool use 列为关键方向 — [arXiv 2608.02352](https://arxiv.org/abs/2608.02352)
- 差距提醒：同一模型在 OSWorld-Verified 上 86.2，在 OSWorld 2.0 的二元完成上只有 18.5 — [同上](https://arxiv.org/abs/2608.02352)
- 真实用户数据（2026-08-31）：8 位盲人用户三周内在 12 个应用上发出 1,258 条命令，最佳模型 GPT-5 成功率 52.5%；失败类型为定位、规划、约束跟踪和终止判断 — [arXiv 2609.00524](https://arxiv.org/abs/2609.00524)
- DeskForge（2026-10-01）融合截图、无障碍树和窗口几何生成 120 万条标注观测；微调后四个视觉语言模型在外部 GUI 定位基准上全部提升，Qwen3.5-4B 在其中一项上提升 11.51 个百分点 — [arXiv 2610.02320](https://arxiv.org/abs/2610.02320)
- SA-CUA（2026-10-13）把**无障碍树用作安全边界**：由确定性规则判定可信区域，只向特权 LLM 展示这部分截图。摘要称攻击成功率为零，效用远高于 CaMeL-CUA，但摘要未给效用数字 — [arXiv 2610.18508](https://arxiv.org/abs/2610.18508)

### Inferences
- UIA 与截图不是二选一。目前证据支持的顺序是：**有原生 API 就走 API → UIA → 视觉兜底**。纯截图的高分依赖大规模专门训练的模型，WinAgent 若接通用模型，不能直接套用这些分数。
- UIA 的价值可能不止于定位：SA-CUA 说明它还能区分窗口框架这类可信界面和网页内容这类不可信内容，这对同时有鼠标键盘工具和文件工具的 WinAgent 特别有用。
- WinAgent 现有的"用户桌面 + 模拟输入"模式很难直接放进 process container，因为 MXC 可以禁止桌面访问。可行路径大概是分层：文件、脚本、生成代码类工具进 process container，后台 GUI 任务评估 session container，需要操作用户当前窗口的动作继续走强确认。
- MXC 的 Permissive → Learning → Enforcement 路径很适合 53+ 工具的存量应用：先观察实际资源使用，再收紧策略。
- 当前开发机是 Windows 11 Home China，Windows Sandbox 不可用。若产品面向家庭版用户，不能把 Sandbox 当作默认隔离方案。
- MXC 和 ODR 的隔离都偏向 MSIX 或 package identity。WinAgent 用 electron-builder 打包，这一点应尽早验证（分发格式与 identity 的关系我没有查证）。

### Gaps
- **没有找到 2026 年 Windows 上 UIA 与截图的直接对照实验**；arXiv 站内检索命中很少，通用搜索又不可用，所以这不等于不存在。
- MXC 的 SDK 语言列表（是否有 Node/TypeScript）、性能开销、已知绕过、对 Windows Home 的支持情况均未查到；公告只说明 session container 和 process container 面向 Windows 11。
- MXC 公告没有给出独立安全评估或量化数据。
- 2026 年 agent workspace 和 Copilot Actions 是否已脱离 Insiders 预览：我能读到的支持页最后说明停在 2025-12，未能确认。
- OSWorld 系列任务中 Windows 的占比未核实，所以不能断言 Qwen-CUA 的分数适用于 Windows。
- Windows-MCP 没有查到独立基准。

## 2. 大量工具的管理与协议演进

### Takeaway
工具搜索和延迟加载的实测收益明确，但主要数据仍来自厂商自己的 2025-11 内测，WinAgent 这种 53+ 工具的规模已达到厂商建议的启用门槛。协议方面的大事件是 **MCP 2026-07-28 规范**：无状态核心，Tasks 和 Apps 转为扩展，Roots、Sampling、Logging 被弃用，tools/list 可缓存且顺序确定。

### Cited Findings

**工具面管理**
- **【较早背景，2025-11-24，Anthropic 内测，厂商自报】** — [Advanced tool use](https://www.anthropic.com/research/advanced-tool-use)：
  - Tool Search：50+ MCP 工具从约 77K tokens 降到约 8.7K（减少 85%）。
  - MCP 评测准确率：Opus 4 从 49% 升到 74%，Opus 4.5 从 79.5% 升到 88.1%。
  - Programmatic Tool Calling：平均 tokens 从 43,588 降到 27,297（减少 37%）；内部知识检索从 25.6% 升到 28.5%；GIA 从 46.5% 升到 51.2%。
  - Tool Use Examples：复杂参数处理准确率从 72% 升到 90%。
  - 适用门槛：工具定义超过 10K tokens，或工具数在 10 个以上。延迟工具不进入初始 prompt，因此不破坏 prompt cache；常用工具建议保持非延迟。
- **【较早背景，2025-11-04】** 代码执行加文件系统式工具发现，一个示例场景从 150,000 tokens 降到 2,000 tokens（98.7%）。文章同时提醒，执行生成代码需要沙箱、资源限制和监控，运维与安全成本更高 — [Code execution with MCP](https://www.anthropic.com/research/code-execution-with-mcp)（我只读了相关段落，未见实验方法说明，**不应把 98.7% 当作通用收益**）
- MCP Gateway（2026-07 首发，2026-11-02 修订）：混合检索约 98% Top-15 召回，将 agent 工具访问扩展到 3,000+ 工具，并称工具选择准确率有所提升（摘要未给具体幅度）— [arXiv 2607.15593](https://arxiv.org/abs/2607.15593)
- Canary tools（2026-08-05）：在工具集中埋入诊断探针，把"选错工具"拆成六类弱点（语义诱饵、参数陷阱、能力幻象、前置依赖盲区、时间诱饵、粒度陷阱）；8 个模型 8,640 次运行，易感率相差约 36 倍 — [arXiv 2608.04719](https://arxiv.org/abs/2608.04719)
- 领域化工具模式（2026-08-22）：用少量领域工具替代通用 SQL 工具，把任务从合成变成意图分类，可以降低所需模型档次 — [arXiv 2608.22063](https://arxiv.org/abs/2608.22063)
- Stochastic Deputy（2026-09-13）：把租户标识作为参数校验时，模型仍会被诱导发起越权调用（26/26 被服务）；从 schema 中移除参数、把范围绑定到凭据后，工具签名无法表达越权读取；但 56 次试验中有 12 次通过伪造可写范围绕过，需要加密保护上下文 — [arXiv 2609.14780](https://arxiv.org/abs/2609.14780)

**MCP 规范时间线**
- 2026-01-26 MCP Apps 成为首个官方扩展（**较早背景**）：工具返回 UI，host 在沙箱 iframe 中渲染，通过 JSON-RPC over postMessage 通信；ChatGPT、Claude、Goose、VS Code 已支持 — [MCP Apps](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)
- 2026-05-21 发布 RC；2026-06-18 Enterprise-Managed Authorization 扩展转为 stable；2026-06-29 发布 Beta SDK；2026-07-28 正式发布；2026-10-30 Ruby SDK 到 Tier 1 — [MCP Blog](https://blog.modelcontextprotocol.io/)
- 2026-07-28 主要变更 — [Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)；[发布博客](https://blog.modelcontextprotocol.io/posts/2026-07-28/)：
  - 移除 initialize 握手和 `Mcp-Session-Id`，每个请求自带版本与能力；新增 `server/discover`；跨调用状态改用 server 签发的显式 handle。
  - Multi Round-Trip Requests 替代 server 主动发起的 elicitation、sampling 和 roots 请求：返回 `input_required`，client 带答案重试。
  - Tasks 移入扩展 `io.modelcontextprotocol/tasks`，改为 `tasks/get` 轮询加 `tasks/update`。
  - 列表结果增加 `ttlMs` 和 `cacheScope`；server **应**按确定顺序返回 tools/list，以提高缓存和 prompt cache 命中率。
  - **弃用** Roots、Sampling、Logging，至少保留 12 个月（建议改为工具参数、直连模型 API、stderr 或 OpenTelemetry）；DCR 弃用，转向 CIMD；移除 SSE 可恢复性，流中断后必须用新 ID 重发。
  - 约定 `_meta` 中传播 OpenTelemetry trace context（SEP-414）。
- SDK：TypeScript、Python、Go、C# 为 Tier 1，已支持新规范；有迁移成本，主要落在依赖 session 的实现上 — [发布博客](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- 路线图（2026-08-22）：Agentic Messaging（server 推送事件、Tasks 组合性审查）、HTTP over stdio（HTTP/2）、ETag 缓存、DPoP、agent 身份与委托、Primitives 改进；明确说明不是承诺 — [Roadmap](https://modelcontextprotocol.io/development/roadmap)
- MCP Registry：页面仍标注 **preview**，可能有破坏性变更或数据重置；只存元数据，通过 DNS 验证命名空间 — [Registry](https://modelcontextprotocol.io/registry/about)（2026-11-03 查看）

**其他协议**
- A2A：v1.0.0（2026-03-12，含破坏性变更）、v1.0.1（2026-05-26，查看时为最新）— [Releases](https://github.com/a2aproject/A2A/releases)
- ACP（Agent Client Protocol）：标准化编辑器/IDE 与编码 agent 的通信，定位类似 LSP — [官网](https://agentclientprotocol.com/get-started/introduction)
- AG-UI：事件式 agent-用户交互协议，约 16 种标准事件，传输无关（SSE、WebSocket、webhook 等）— [GitHub](https://github.com/ag-ui-protocol/ag-ui)

### Inferences
- 对 WinAgent 成本最低的动作：核心工具常驻（文件读取、窗口枚举等），高危和低频工具延迟加载，并保持工具列表顺序确定，以稳定 prompt cache。
- 53 个工具本身不算多，但工具定义如果很长或存在相似命名，选错工具的问题可能先于 token 问题出现；canary tools 是便宜的诊断手段。
- 代码执行式调用要等隔离到位（如 MXC process container）后再开放，否则会绕过逐工具审批，把现有权限模型掏空。
- 若 WinAgent 作为 MCP client：新实现不要再依赖 Roots、Sampling、Logging，要兼容新旧协议版本。Registry 仍是 preview，不宜把它作为信任依据。
- 协议选型：MCP 必要；ACP 仅在想接入 IDE 时才有价值；A2A 和 AG-UI 对单机桌面应用优先级较低（AG-UI 可作为前端事件模型的参考）。

### Gaps
- 未找到工具搜索的**独立**对照实验；Anthropic 的数字是内测，且模型已是旧版。
- 未查到 OpenAI 等其他厂商工具搜索的量化数据（本轮未覆盖）。
- ACP、AG-UI 的最新版本和发布日期本轮未读到。"ACP"另有同名协议的历史，本轮未核实其现状，引用时需写全称。
- MCP Apps 的新版本状态、各客户端对 2026-07-28 的实际采用率未查到。

## 3. 长期记忆

### Takeaway
目前最可靠的结论是**负面的**：流行的记忆基准衡量力有限，简单的文件方案就能拿到有竞争力的分数，记忆也会造成新的失败。2026-10 的新基准开始测量误用、投毒、冲突和遗忘，这些对一款有本地权限的桌面 agent 比召回率更重要。

### Cited Findings

**基准与争议（【较早背景】）**
- Mem0（2025-04，自评）：LOCOMO 上比 OpenAI 相对提升 26%，p95 延迟低 91%，token 成本省 90% 以上；graph 版只多约 2% — [arXiv 2504.19413](https://arxiv.org/abs/2504.19413)
- Zep/Graphiti（2025-01，自评）：DMR 上 94.8% 对 MemGPT 93.4%；LongMemEval 准确率最多提升 18.5%，延迟降低 90% — [arXiv 2501.13956](https://arxiv.org/abs/2501.13956)
- Letta（2025-08，同样是利益相关方）：gpt-4o-mini 仅靠文件加 grep 和语义搜索，在 LoCoMo 上得 74.0%，高于 Mem0 报告的 graph 版 68.5%。Letta 称无法复现 Mem0 跑 MemGPT 的做法，且对方未回应；并认为这说明基准意义有限，记忆更取决于 agent 如何管理上下文 — [Letta Blog](https://www.letta.com/blog/benchmarking-ai-agent-memory/)

**2026 年新证据**
- **MemDev-Bench**（2026-10-19，555 个基础任务，4,869 个历史任务）— [arXiv 2610.27524](https://arxiv.org/abs/2610.27524)：
  - 记忆主要改善细粒度定位和编辑。
  - 记忆也会让本可解决的任务失败，无关历史会加剧这一点，主因是 agent 不重新评估记忆是否适用。
  - **直接提供原始历史轨迹比用记忆系统显著减少步数**，因为压缩记忆丢失了过程信息。
- 记忆与 skill 冲突（2026-10-23，1,383 次运行，3 个开放权重模型）：胜负取决于冲突类型、模型和注入顺序，更像是由位置决定而非来源语义；"skill 绝对优先"指令后仍有 3–10% 不遵守，最小模型反而更差；**89% 的运行没有向用户透露存在矛盾** — [arXiv 2610.33128](https://arxiv.org/abs/2610.33128)
- MemForm（2026-10-09）：测试 6 个 LLM，记忆形成的 5 个接口（Content、Evidence、Scope、Selection、Path）全部可被投毒；即使保留的经历相同，**整合顺序也能改变行为**；被评估的防御只能部分缓解 — [arXiv 2610.14431](https://arxiv.org/abs/2610.14431)
- memorywire（2026-08-12 修订）：指出各框架都没有写入前人工审查的治理界面；对抗实验中 RRF 融合在 1-of-N 注入下保持 recall@5 = 1.000，max 融合跌到 0.500（**100 条事实的微基准，规模很小**）— [arXiv 2606.01138](https://arxiv.org/abs/2606.01138)
- 新基准密集出现：仅 2026-10 就有 [MemPABench](https://arxiv.org/abs/2610.30485)（测交互偏好，何时澄清、确认或自主行动）、[Bemula](https://arxiv.org/abs/2610.18052)（测遗忘请求）、[MemDerive](https://arxiv.org/abs/2610.25373)（测由多条记录推导出的状态及其过时）、[DyadMem](https://arxiv.org/abs/2610.03020) 等；这些新基准几乎都以"现有基准不足"为出发点。

**整合（dreaming）与 wiki**
- Anthropic Dreams（research preview，发布日期未读到）：异步任务读取一个 memory store 和 1–100 个历史 session，产出**新的** store，合并重复、替换过时或矛盾条目并提炼新见解；**输入 store 不被修改**，可审阅后丢弃 — [Dreams 文档](https://platform.claude.com/docs/en/managed-agents/dreams)
- LLM Wiki（Karpathy gist）：LLM 在原始资料和用户之间增量维护互链的 markdown wiki，摄入时就更新实体页、标记矛盾，知识一次编译后持续更新，而非每次查询时重新推导 — [Gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)（这是思路文档，不含基准）
- 后续研究：WikiLoop（2026-07-29）把构建和导航联合学习，用下游导航效果给编辑打分 — [arXiv 2607.26604](https://arxiv.org/abs/2607.26604)；Streaming Knowledge Compilation（2026-06-02）处理语料持续变化 — [arXiv 2606.09877](https://arxiv.org/abs/2606.09877)；llm-wiki-memory-template 主张保留死路和撤回的结论 — [arXiv 2607.24759](https://arxiv.org/abs/2607.24759)；WFM（2026-09-16）声称行业正从稀疏图转向 LLM Wiki — [arXiv 2609.18182](https://arxiv.org/abs/2609.18182)（这是作者的判断，非独立事实）

### Inferences
- 小团队的合理默认：**人可读的文件记忆 + grep/语义检索**，再加定期整合任务。除非有明确的时间推理需求，否则没有证据要求先上图数据库。
- 建议借鉴 Dreams 的设计：整合生成新版本，不原地修改，并保留回滚（WinAgent 已有 Wiki 工作区，这个模式可以直接套用）。
- 保留过程信息：记忆条目附带指向原始会话的链接，而不是只留摘要；调用时要求重新判断适用性（来源、日期、适用条件）。
- 记忆写入是注入通道。来自网页或文件的内容不应自动写入长期记忆，或应打上来源标记并经确认；要保留一个能真正删除的入口。
- 发现记忆与当前指令冲突时，应明确告知用户，因为模型默认不会说。
- 评测不要只看 LoCoMo 分数，应基于 WinAgent 自己的历史任务做"有记忆/无记忆/原始轨迹"三组对照。

### Gaps
- Mem0、Letta、Graphiti 2026 年的最新版本和新分数本轮未读到；上面的厂商数字都偏旧，且互相质疑。
- 未找到 dreaming 式整合的独立量化收益，也未找到 LLM Wiki 与 RAG 的独立对照数据。
- MemDev-Bench 只测编码 agent，能否外推到桌面任务未知；具体比例未在摘要中给出。

## 4. 面向本地权限 agent 的提示注入与供应链安全

### Takeaway
2026 年的证据指向一致：**确定性的外部约束**（目的地白名单、规划者/读取者分离、OS 级隔离）比模型识别攻击更稳健；但这类防御大多也只经过静态基准验证，不能视为已证明安全。小团队应优先做权限分层、出站控制和隔离，分类器只作补充。

### Cited Findings

**攻击与防御的测量**
- The Framing Gap（2026-08-27，合成实验环境）— [arXiv 2608.27092](https://arxiv.org/abs/2608.27092)：
  - 明显的注入被拒绝（gpt-4o 0%），但把同样的泄露伪装成必填签名、配置字段或相似的"可信"主机后，gpt-4o 从 0% 升到 100%。
  - **目的地白名单（目的地封闭时）和能力隔离的 planner/reader 分离都降到 0%。**
  - SecAlign 仍有 32.5%，通道分离 38.8%，输出规范化防护被 ROT13 打到 100%。
- Adaptive Evaluation（2026-06-24）：指出 CaMeL、FIDES、Progent、RTBAS、FORGE 都只在静态基准上验证过，而此前同样方法使 12 种模型内防御看起来有效，后被自适应攻击以超过 90% 的成功率攻破。独立复现中 Progent 把攻击成功率从 25.8% 降到 4.2%，手工自适应攻击下为 2.6%。作者明确说这是弱模型、单模板的一个小数据点 — [arXiv 2606.26479](https://arxiv.org/abs/2606.26479)
- AutoDojo（2026-06）：10 种防御、5 个模型，静态基准常显著高估防御效果；多数防御要么牺牲较多效用，要么不安全；**任务描述不完整时更容易被攻击** — [arXiv 2606.15057](https://arxiv.org/abs/2606.15057)
- COPEX（2026-10-16）：9 个模型、3,375 次试验，MCP 各层平均攻击成功率 64.4%；输入和上下文扫描在 8 种攻击子集上降低 49.6%，说明扫描有用但不够 — [arXiv 2610.04378](https://arxiv.org/abs/2610.04378)
- 多 agent（2026-09-19，ICML 工作坊）：14 种向量，经工具输出的间接注入成功率 43%；四项架构防御把整体成功率从 31.2% 降到 4.2% — [arXiv 2609.22949](https://arxiv.org/abs/2609.22949)
- **【较早背景，2025-03】** CaMeL：从可信查询中提取控制流和数据流，用 capability 约束数据流向；AgentDojo 上解决 77% 任务（无防御 84%）— [arXiv 2503.18813](https://arxiv.org/abs/2503.18813)。屏幕场景的新变体见第 1 节的 SA-CUA。

**权限与自动审批**
- **【较早背景，2026-03-25，厂商自报】Claude Code auto mode** — [Anthropic](https://www.anthropic.com/research/claude-code-auto-mode)：
  - 用户实际批准了 93% 的权限提示，存在审批疲劳。
  - 三层：安全工具白名单和用户规则 → 项目内文件编辑直接放行（靠版本控制可审）→ 其余进入 transcript 分类器。
  - 分类器分两阶段，先单 token 过滤，被标记才进入推理；**只看用户消息和工具调用，刻意去除 agent 自身的话和工具输出**；另有探针扫描工具输出。
  - 进入该模式时，会丢弃已知能授予任意代码执行的权限规则。
  - FPR 从第一阶段的 8.5% 降到全流程 0.4%；**对真实越权行为的 FNR 为 17%**。Anthropic 明确说它不能替代高风险场景的仔细人工审查。
  - 误报的代价是一次带提示的重试，而不是终止会话。
- **【较早背景，2025-10-20，内部使用数据】** 沙箱使权限提示减少 84% — [Claude Code sandboxing](https://www.anthropic.com/research/claude-code-sandboxing)
- OS 层隔离的 Windows 选项见第 1 节（MXC）。

**Skill/插件供应链**
- SCS（2026-10-24）：分析 66,157 个 ClawHub skill，得到 2,473 个候选，**确认恶意 627 个**（约占 0.95%，比例为我的计算）。在 117 恶意 + 117 良性的基准上准确率 85.6%、召回 95.2%、F1 86.9%，但平均消耗 1,370 万 tokens — [arXiv 2610.33489](https://arxiv.org/abs/2610.33489)
- Skill 名称幻觉（2026-07-14）：15,000 个提示、12 种配置，平均幻觉率约 36–37%，真实开发者问题上达 43.1%，共 5,669 个虚构名称，且跨模型重复，易被抢注。检索增强把幻觉率从 40.8% 降到 3.2%，但最佳系统也只有约六分之一的情况推荐正确 skill — [arXiv 2607.12340](https://arxiv.org/abs/2607.12340)
- ElasticBack（2026-08-10）：在 skill 文档中植入规则，只有用户查询出现特定触发词才发作，良性输入下保持休眠 — [arXiv 2608.09577](https://arxiv.org/abs/2608.09577)；Pretext/Actuation 解耦（2026-09-30）把理由和操作放到不同 skill 中 — [arXiv 2609.39352](https://arxiv.org/abs/2609.39352)。这些都会削弱逐文件审查的效果。
- SkillGate（2026-07-28）：指出公共 registry 一键安装缺乏审查，并提出运行时网关方案 — [arXiv 2607.25619](https://arxiv.org/abs/2607.25619)
- MCP 工具注解是风险词汇而非安全保证（2026-03-16，只读到首页摘要；**较早背景**）— [MCP Blog](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)

### Inferences

对小团队的实用性排序（我的判断，非来源结论）：

| 优先级 | 措施 | 依据 | 成本 |
|---|---|---|---|
| 高 | 工具分层：只读放行、项目内可逆操作放行、高危动作确认（注册表、进程、任意命令、向外发送） | auto mode 分层；93% 批准率说明要减少无意义提示 | 低 |
| 高 | 出站目的地白名单，敏感工具和联网工具不在同一步组合 | Framing Gap | 中 |
| 高 | 工具输出和屏幕内容打"不可信"标记并隔离，审批判断不读 agent 自述 | auto mode；SA-CUA | 低到中 |
| 高 | 生成代码和工具执行进 MXC process container，先用 Permissive 观察再收紧 | MXC | 中（需验证打包和 SDK） |
| 中 | 第三方 skill/插件：版本锁定、来源校验、不让 agent 自主安装其推荐的名称 | 名称幻觉；627 个恶意 skill | 低到中 |
| 中 | 模型分类器做第二道审批 | 17% FNR、0.4% FPR | 中 |
| 中 | planner/reader 分离（简化版 Dual-LLM） | Framing Gap；SA-CUA | 中到高 |
| 低 | 完整 CaMeL 式解释器 | 效用损失和工程量都较大，且还没经过充分自适应评估 | 高 |

- 输入扫描可以加，但不能作为主要防线：COPEX 只下降约一半，Framing Gap 也显示它容易被改写绕过。
- 高危操作要求参数由用户明确给出，或由确定性步骤解析，避免模型自行猜测目标（auto mode 的"agent 推断参数"案例；Stochastic Deputy 也支持把范围绑定到凭据而非模型参数）。
- 评估自家防御时要用自适应攻击，并同时汇报效用；不要只报 AgentDojo 分数。

### Gaps
- 未找到针对 **Windows 桌面 agent** 的真实世界注入事件统计，也未找到模拟鼠标键盘场景下分类器的表现数据。
- auto mode 表格中 6.6%、1.8%、5.7% 这几个 FNR 的具体列名未能从页面文本确认，因此未引用其含义。
- SA-CUA 的零攻击成功率来自摘要，测试集规模和自适应强度未核对；按上述 Adaptive Evaluation 的标准，应谨慎看待。
- Snyk 等安全公司的 skill 扫描报告、ClawHavoc 等事件原始材料本轮未能读取；SCS 和 SkillGate 只提供学术侧证据。

## 5. 可靠性与可观测性

### Takeaway
文件级检查点和 trace 优先于重型持久化执行框架：OTel GenAI 约定已覆盖 agent、工具、skill 和命令执行，但状态仍是 **Development**，属性可能变动。对单机桌面应用，"动作前快照 + 本地事件日志 + 确定性回放测试"的投入产出比最高；副作用（注册表、进程、GUI）的回滚仍没有成熟通用方案。

### Cited Findings

**检查点与回滚**
- Claude Code checkpointing：每个开启新回合的 prompt 创建检查点，保留最近 100 个的文件快照，默认约 30 天清理；可以分别恢复代码、对话或同时恢复。文档写明跟踪的是**其文件编辑工具**所做的修改 — [Checkpointing](https://code.claude.com/docs/en/checkpointing)（我只读了开头部分）
- TClone（2026-05-17）：对活动 GUI 工作区进行快照、分叉、回滚和选择性合并，端到端任务延迟比 KVM 快 1.9 倍、比 CRIU 快 1.5 倍；基于容器，非 Windows 方案 — [arXiv 2605.17320](https://arxiv.org/abs/2605.17320)
- LangGraph：checkpointer 负责线程级状态（中断恢复、人工介入、时间回溯、容错），store 负责跨线程长期数据。`durable-execution` 路径现已重定向到 Persistence 页 — [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- MCP 2026-07-28 取消 SSE 可恢复性，流中断时 client 必须用新 ID 重发；长任务走 Tasks 扩展的轮询；路线图提到要解决 Tasks、订阅与进度之间生命周期和取消模型不一致的风险 — [Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)；[Roadmap](https://modelcontextprotocol.io/development/roadmap)

**Tracing**
- OTel GenAI 约定已从主 semconv 仓库移到独立仓库 `semantic-conventions-genai`（semconv 1.44.0 文档页标注已迁移），涵盖 GenAI client、MCP 和厂商约定；该仓库 README 中 Schema URL 仍为 TODO — [迁移页](https://opentelemetry.io/docs/specs/semconv/gen-ai/)；[仓库](https://github.com/open-telemetry/semantic-conventions-genai)（2026-11-03 查看）
- Agent span 文档状态为 **Development**，定义 create agent、invoke agent（client/internal）、invoke workflow、plan、execute tool，以及 agent skills 相关的 load skill、read skill resource、command execution — [Agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)
- MCP 规范已约定在 `_meta` 中传递 `traceparent`、`tracestate`、`baggage`（SEP-414），并建议用 OpenTelemetry 取代被弃用的 Logging — [Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)

**评测**
- 结构化测试（2026-10-18 修订）：用基于 OpenTelemetry 的 trace 捕获轨迹，mock LLM 以保证可复现，再加断言，从而把 agent 组件测试放入自动化流程 — [arXiv 2601.18827](https://arxiv.org/abs/2601.18827)
- Canary tools（见第 2 节）可用于回归检查工具选择 — [arXiv 2608.04719](https://arxiv.org/abs/2608.04719)
- 基准隐患：同一模型在不同 OSWorld 版本上分数差距极大（见第 1 节），Letta 也质疑 LoCoMo 的区分力 — [arXiv 2608.02352](https://arxiv.org/abs/2608.02352)；[Letta](https://www.letta.com/blog/benchmarking-ai-agent-memory/)
- MXC 的 JSON 活动报告可以作为资源访问层面的审计和回归数据（Windows process container）— [MXC 公告](https://blogs.windows.com/windowsdeveloper/2026/10/07/microsoft-execution-containers-policy-driven-containment-for-ai-agents/)

### Inferences
- 回滚要按工具分类声明：文件操作做快照；注册表操作先导出原值；进程和 GUI 操作基本不可逆，应走更高确认级别。把"是否可逆"写进工具元数据，同时也可作为权限分层的输入。
- Claude Code 的检查点只保证其文件工具的修改，这是一个值得避免的盲区：WinAgent 有更多有副作用的工具，要向用户说清楚哪些动作不在回滚范围内。
- 对单用户桌面应用，先用追加写入的本地事件日志加每步落盘实现崩溃恢复即可；Temporal 这类服务端框架对 Electron 应用显得过重（我的判断，未查到桌面场景的对比数据）。
- 按 OTel GenAI 字段命名本地 trace，但隔一层适配，因为约定仍处于 Development，可能变动。截图、文件内容等敏感数据默认不进 trace。
- 评测可以分三层：mock LLM 的确定性回放测试（每次提交）、基于真实历史任务的小规模任务集（每次发版）、注入和越权的对抗集（定期）。

### Gaps
- 未找到 Windows 上类似 TClone 的 GUI 工作区分叉方案；注册表和进程副作用回滚也未找到成熟实践或量化数据。
- 未读取 Temporal、Inngest、Restate 等持久化执行框架 2026 年针对 agent 的更新，无法比较。
- OTel GenAI 何时转为 stable 没有查到公开时间表。
- 没有找到桌面 agent 的公开可靠性数据（如每任务失败率、回滚成功率）；最接近的是第 1 节的盲人用户研究（52.5%）。
