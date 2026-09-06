# 计划：Wiki 子系统深度设计文档（WIKI_DESIGN_REPORT.md）

## 目标

在仓库根目录创建 `WIKI_DESIGN_REPORT.md`（中文）：专注 Wiki 子系统的深度设计文档，作为
**新 dsh 插件（重做版）Wiki 部分**的实施底稿。本任务**只写文档，不改任何源代码**。

定位：与 `PROJECT_ASSETS_REPORT.md`（2026-09-02，全项目盘点底稿，其 §十一 明确旧 dsh-plugin
已废弃、将重新设计插件化）配套的 Wiki 专项深挖文档。

## 已确认的决策

| 决策点 | 结论 |
|---|---|
| 交付物 | Wiki 深度设计文档（含插件化分析） |
| 规范行为基准 | `src-tauri/src/wiki/`（Rust 版）为基准；对账两版 TS 差异，得出单一「规范行为定义」 |
| 文档位置 | 仓库根目录 `WIKI_DESIGN_REPORT.md` |
| 语言 | 中文 |

## 背景事实（已核实）

- Wiki 存在 **3 个已分叉的实现**：
  1. `src-tauri/src/wiki/`（Rust，规范版）：vault.rs(772行)/search.rs/graph.rs/ai_pipeline.rs(660行)/ingest.rs(655行)/workflow.rs/contract.rs
  2. `src/main/wiki/`（TS，Electron 遗留，6 文件）+ `src/main/index.ts`（INGEST 编排）
  3. `dsh-plugin/src/wiki/`（TS，旧插件移植版，7 文件含 wiki-host.ts 884 行）——旧插件已废弃但
     其 `src/server.ts`（572 行）已验证过 wiki HTTP API 表面映射（约 34 条 `/winagent/api/wiki/*` 路由）
- 行为契约：`wiki/CLAUDE.md`（用户维护的"宪章"，定义 INGEST/QUERY/LINT/REFLECT/MERGE 五工作流、
  wikilink 铁律、confidence 阶梯）；`wiki/USER_GUIDE.md`
- Rust 版 IPC 表面：`src-tauri/src/commands/wiki.rs`（572 行，34 个 command：window/vault/notes/
  links/tags/search/graph/ai/ingest 含 batch/workflow×4/import×3/analysisTags/concept/attachments/annotations）
- 前端：`src/renderer/src/components/wiki/`（15 个组件）+ `src/renderer/src/lib/useWiki.ts`
- DSH 平台研究已就绪：`.plugin-work/dsh-web-plugin-api.md`（插件编写笔记）、
  `.plugin-work/dsh-integration-plan.md`（UI/传输集成方案）、`.plugin-work/winagent-services.md`
  （Electron 服务层可移植性清单，其 §8 为 Wiki 子系统分析）
- 真实 vault 数据在仓库根 `wiki/`（raw/ + wiki/{sources,concepts,entities,synthesis,templates,outputs}
  + 系统文件 + attachments/ + outputs/）

## 已知分叉点（文档必须逐项核实并对账，不得凭记忆断言）

| # | 分叉点 | Rust（基准） | TS 两版 | 对账动作 |
|---|---|---|---|---|
| 1 | LINT 检查项 | workflow.rs（报告称 9 项：broken-wikilink/stub/no-tags/no-ai-summary/orphan/hash-changed/duplicate-title/no-confidence/stale-index） | WorkflowService.ts 10 项（含 frontmatter/近重复 Jaccard/别名重叠/wikilink 格式/系统文件被链接） | 逐项列出两版全集，产出新插件应实现的规范检查清单 |
| 2 | 搜索打分 | search.rs（标题×10/词×5/tag×3/正文×0.5/AI摘要×2 加权 + make_snippet 200字） | SearchIndex.ts（token 命中计数 + CJK bigram 倒排索引） | 确认 Rust 是否也有 CJK 分词；定义规范打分与分词方案 |
| 3 | PDF/文档提取 | ingest.rs 走 Python+PyMuPDF 子进程（python 路径双 fallback） | 插件走 Node 子进程 `assets/skills/pdf/read_doc.js`（pdf-parse/JSZip）；src/main 同 | 定义新插件的提取策略（Node 技能链 vs Python）及依赖检测 |
| 4 | AI 取消机制 | ai_pipeline.rs `Arc<Self>` + watch channel `cancel_epoch` 无锁取消 | AiPipeline.ts 每 analyze/custom/ingest 键控 AbortController | 规范：新插件 TS 实现按 AbortController 语义对齐 cancel_epoch 行为 |
| 5 | JSON 容错 | `complete_json()` 平衡花括号扫描 + 一次自修复重试 | `parseJsonObject`（裸 JSON/```json fence/首个{}提取） | 规范：合并两种策略 |
| 6 | 图谱边权 | graph.rs：wikilink 1.0 + 共享 tag 0.5×count | GraphEngine.ts：link 2 + tag 1，度归一化 | 选定规范权重 |
| 7 | 拖入自动摄入 | 待核实（Rust 是否有 auto-ingest 去重/防抖） | wiki-host.ts `scheduleAutoIngest`（60s 去重 + 1.5s 防抖） | 核实 Rust 行为后定规范 |
| 8 | MERGE 语义 | workflow.rs `run_merge`（待核实是否有 redirect 页 + 全库 wikilink 改写） | WorkflowService.ts：aliases 并集/Sources 并集/`[[remove]]`→`[[keep]]` 全库改写/被合并页变 redirect | 核实后定规范 |
| 9 | confidence 升级 | ingest.rs：≥3→medium，≥5→confirm_high 待用户确认（待核实细节） | 同语义（个人写作不计数） | 核实两版细节一致后固化规则 |
| 10 | 事件/进度 | Tauri emit（wiki:vault:changed / wiki:ingest:progress 等，待核实全集） | 插件 EventBus 长轮询 / Electron IPC | 列出规范事件全集 |

## 文档结构（WIKI_DESIGN_REPORT.md 章节大纲）

1. **定位与阅读方式** —— 与 PROJECT_ASSETS_REPORT.md 的关系；规范基准声明（Rust 版）；
   三实现的关系图（Rust=现行桌面版 / src/main=Electron 遗留 / dsh-plugin=旧插件，均非新插件基座）
2. **数据模型与目录契约** —— vault 目录结构（raw/wiki/outputs/attachments + 系统文件）；
   frontmatter schema（source/concept/entity/personal-writing 四类页面，引用 types.rs 与真实样例）；
   wikilink 铁律与 slug 规则；confidence 阶梯（low/medium/high + source_count + 用户背书）；
   个人写作特殊规则。来源：`wiki/CLAUDE.md` + `vault.rs` + `types.rs` + `wiki/wiki/` 真实样本
3. **七模块架构精读** —— 每模块：职责 / 公开 API（方法签名表）/ 核心算法与不变式 /
   外部依赖（fs/LLM/子进程/事件）。来源：`src-tauri/src/wiki/*.rs` 逐文件
4. **五工作流精读** —— INGEST（单篇 10 步管线 + batch 交互标定状态机 + 自动摄入）、
   QUERY（检索→读全文→带溯源回答→落盘）、LINT（检查项全集）、REFLECT（Stage0 反向检验→模式/
   矛盾/Gap/孤立→synthesis 落盘）、MERGE（合并语义）。每步给 file:line 引用与进度事件。
   来源：`ingest.rs` + `workflow.rs` + `commands/wiki.rs`
5. **IPC 与事件表面** —— 34 个 command 清单（名称/参数/返回/副作用如重建索引）、事件全集、
   前端消费方式（15 个 wiki 组件 + useWiki.ts 各自调用面）。来源：`commands/wiki.rs` + `lib.rs`
   + `src/renderer/src/components/wiki/` + `useWiki.ts`
6. **三实现差异对账表** —— 上表 10 项分叉逐项裁决：Rust 行为为准 + TS 差异 + 新插件应实现的
   规范行为（每行双引用 file:line）
7. **dsh 插件化分析（Wiki 部分）** ——
   - 模块可移植性表：纯逻辑（vault/search/graph/contract/LINT/MERGE）vs LLM 依赖
     （ai_pipeline/ingest/REFLECT/QUERY）vs 子进程依赖（文档提取）
   - 宿主依赖：HTTP 路由（`ctx.webServer.register`）+ 客户端注入（tapIndex/index-inject）+
     事件传输（长轮询或 SSE，引用 `.plugin-work/dsh-web-plugin-api.md` 结论）；LLM 配置来源
   - 旧插件的已验证资产：`dsh-plugin/src/server.ts` 的 34 条 wiki 路由映射与
     `wiki-host.ts` 的编排移植可直接参考复用
   - v1 范围建议（cheap-first：vault 读写/搜索/标签/反链/LINT/MERGE；LLM-gated：INGEST/AI 分析/
     REFLECT/QUERY；风险项：二进制文档提取、大 vault 索引性能、DSH 沙箱内子进程限制）
   - 风险清单（引 winagent-services.md §6.10/§10.9 的子进程/EPERM 注意点）
8. **开放问题** —— 留给插件实施时决策的事项（iframe 挂件 vs dsh.client 原生插件形态、
   事件传输选型、v1 是否含 LLM 工作流、提取链选型）

## 执行步骤（按序）

1. **精读 Rust 规范实现**：`src-tauri/src/wiki/` 7 文件 + `src-tauri/src/commands/wiki.rs` +
   `src-tauri/src/types.rs`（wiki 相关类型）+ `src-tauri/src/lib.rs`（事件注册与启动装配）。
   提取：每模块 API 表、五工作流逐步骤、34 command 清单、事件全集。
2. **核实 10 项分叉**：逐项对照 `src/main/wiki/*.ts`、`src/main/index.ts`（runIngest 编排）、
   `dsh-plugin/src/wiki/wiki-host.ts`、`dsh-plugin/src/server.ts`，双引用落表。
   特别核实：Rust 是否有 auto-ingest 防抖、MERGE redirect 语义、search.rs 的 CJK 处理。
3. **采样真实 vault**：读 `wiki/wiki/sources/`、`wiki/wiki/concepts/`、`wiki/wiki/QUESTIONS.md`、
   `wiki/wiki/index.md` 等真实文件（**只读**），确认 frontmatter 实际字段与页面骨架。
4. **盘点前端消费面**：15 个 wiki 组件 + `useWiki.ts`，列组件→command/事件 依赖矩阵
   （供插件 UI 复用决策）。
5. **写文档**：按上述 8 章大纲写入根目录 `WIKI_DESIGN_REPORT.md`；所有事实性断言带
   `file:line` 引用；风格对齐 PROJECT_ASSETS_REPORT.md（中文、表格化、技术决策必读块）。
6. **验证自查**（见下）。

## 约束

- **只写一个文件**：`WIKI_DESIGN_REPORT.md`。不改任何源代码、不改 `wiki/` vault 任何内容
  （CLAUDE.md 质量红线：raw/ 不可变、系统文件受保护）、不改旧 dsh-plugin、不改 .plugin-work。
- 不得臆造：分叉表每行必须两版代码亲自核实；未核实的写「待核实」而不是猜。
- 文档是"底稿"不是"实施计划"：插件编码任务留待后续（开放问题章节收口）。

## 验证

- 对照检查：34 个 command 全覆盖；五工作流每步有 file:line；10 项分叉每行有双引用与裁决。
- 一致性：与 `PROJECT_ASSETS_REPORT.md` §五 无矛盾（若发现该报告与代码不符，以代码为准并在
  文档中显式标注勘误）。
- 数据契约样例：frontmatter 字段表与 `wiki/wiki/` 真实文件一致。
- 完成后无需运行任何构建/测试（纯文档任务）。

## 开放问题（文档内记录，不阻塞本任务）

- 新插件形态：iframe 挂件式（旧插件模式，已验证）vs `dsh.client` 原生客户端插件
  （`.plugin-work/dsh-integration-plan.md` 路线）——文档保持中立，列出两条路线对 Wiki 部分的要求
- v1 是否包含 LLM 工作流（INGEST/REFLECT/QUERY/AI 分析）及默认关闭开关设计
- 二进制文档（PDF 等）提取链在新插件的选型与依赖检测方案
