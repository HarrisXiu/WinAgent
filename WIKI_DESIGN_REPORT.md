# WinAgent Wiki 子系统深度设计报告

> 生成日期：2026-09-03
> 用途：作为新 dsh 插件（重做版）**Wiki 部分**的实施底稿。基于三套实现的逐文件代码精读，
> 全部事实性断言带 `file:line` 引用；分叉点均已核实并给出裁决。
> 配套文档：`PROJECT_ASSETS_REPORT.md`（全项目盘点，其 §五 为本报告的前置摘要）、
> `.plugin-work/dsh-web-plugin-api.md`（DSH 插件机制）、`.plugin-work/winagent-services.md`（Electron 服务层）。

---

## 一、定位与阅读方式

### 1.1 与 PROJECT_ASSETS_REPORT.md 的关系

`PROJECT_ASSETS_REPORT.md`（2026-09-02）是全项目底稿，其 §十一 明确旧 dsh-plugin 已废弃
（GitHub 归档 commit 923f126）、§十二 给出插件化改造清单。本报告是 **Wiki 子系统专项深挖**：
把"七模块 + 五工作流 + IPC 表面 + 三版差异"逐项落到代码行级，并给出新插件 Wiki 部分应实现的
**规范行为定义**（§6.5）。

### 1.2 三套实现与各自角色

| 实现 | 位置 | 角色 | 状态 |
|---|---|---|---|
| Rust 版 | `src-tauri/src/wiki/`（7 文件）+ `commands/wiki.rs` | 桌面版现行运行时；模块架构、IPC 表面、若干算法改进的**权威来源** | 活跃 |
| Electron TS 版 | `src/main/wiki/`（6 文件）+ `src/main/index.ts`（INGEST 编排） | **契约（CLAUDE.md）完整行为的唯一实现**；盘上数据格式的写入者 | 遗留但行为权威 |
| 旧插件 TS 版 | `dsh-plugin/src/wiki/`（7 文件含 wiki-host.ts）+ `src/server.ts` | TS 行为的忠实移植 + DSH HTTP/事件传输的**已验证映射** | 结构废弃，代码可复用 |

### 1.3 「Rust 为基准」的正确用法（本报告核心结论）

代码核实发现：**Rust 版不是 TS 版的超集，而是简化重实现**。契约 `wiki/CLAUDE.md` 规定的多项
行为（SHA-256 完整性、个人写作、Evolution Log、confidence 自动升级、index/overview 维护、
REFLECT Stage 0、MERGE redirect 页）只在 TS 版实现（对照见 §6.2）；且盘上数据格式由 TS 版
写入（§2.7）。因此新插件（TS 包）的规范基准是：

> **TS 版的完整契约行为 + Rust 版的可取改进（§6.3）+ 两版缺陷修复（§6.4）**，三者合并为 §6.5
> 的规范行为定义。Rust 版作为模块划分、API 表面（§5）与算法改进的参考基准。

### 1.4 盘上 vault 现状（2026-09-03 采样）

`wiki/`（仓库根）为 **TS 版初始化的空骨架**：5 个页面模板齐全
（`wiki/wiki/templates/`：source/concept/entity/synthesis/personal-writing），系统文件均带
`type: system-*` + `graph-excluded: true` frontmatter（`wiki/wiki/index.md:1-4`、
`QUESTIONS.md:1-4`、`log.md:1-4`、`overview.md:1-13`），`wiki/wiki/sources|concepts` 为空，
`raw/` 六个子目录为空。即：**尚无已编译内容，模板与系统文件格式就是数据契约的实物样本**。

---

## 二、数据模型与目录契约

### 2.1 目录骨架

| 层 | 目录 | 由谁创建 |
|---|---|---|
| 原始层（不可变） | `raw/{articles,clippings,images,pdfs,notes,personal}` | TS `VaultManager.ts:15,62`；Rust `vault.rs:31` |
| 编译层（唯一检索区） | `wiki/{sources,concepts,entities,synthesis,templates,outputs}` | TS `VaultManager.ts:16,63-65`；**Rust 只建 4 个**（sources/concepts/entities/outputs，`vault.rs:31-32`），缺 synthesis/templates |
| 附件 | `attachments/` | TS `VaultManager.ts:40,60`；Rust 不建 |
| 遗留输出 | `outputs/`（vault 根） | TS `VaultManager.ts:43,66`；Rust 不建 |

### 2.2 系统文件清单与保护范围

| 文件 | frontmatter | 格式要点 | 创建者 |
|---|---|---|---|
| `wiki/index.md` | `type: system-index, graph-excluded` | Sources/Concepts/Entities 三段，`- [[slug]] — title`（TS `VaultManager.ts:237-265`）；Rust 版为中文段头且无 frontmatter（`vault.rs:340-357`） | 两版 |
| `wiki/log.md` | `type: system-log, graph-excluded` | TS 行格式 `YYYY-MM-DD HH:MM \| entry`（`VaultManager.ts:227`）；Rust 为 `- [YYYY-MM-DD HH:MM] entry`（`vault.rs:333-335`）——**格式不兼容** | 两版 |
| `wiki/overview.md` | `type: system-overview, graph-excluded` | Health Dashboard 表格（TS `VaultManager.ts:200-217`）；Rust 为键值列表（`vault.rs:359-367`） | 两版 |
| `wiki/QUESTIONS.md` | `type: system-questions, graph-excluded` | Open/Resolved 两段；TS 复选框格式 `- [ ] 问题（opened 日期）`（`VaultManager.ts:86-113`）；Rust 假定 `- 问题` 纯行（`vault.rs:315-329, 480-487`）——**互操作断裂**，见 §6.4-7 | 两版 |
| `wiki/ANALYSIS_TAGS.md` | `type: system-analysis-tags, graph-excluded` | `- tag \| template` 行（TS `VaultManager.ts:146-183`）；Rust 存在 frontmatter `tags` JSON 数组（`vault.rs:431-467`）——**格式不兼容** | TS（Rust 不创建该文件） |
| `CLAUDE.md`（vault 根） | 无 | 行为契约，用户维护；TS 缺省时写入内置 `WINAGENT_CONTRACT_MD`（`VaultManager.ts:320-326`、`contract.ts:108-171`）；**Rust 初始化不创建**（`vault.rs:29-53`） | TS |
| `USER_GUIDE.md`（vault 根） | `type: system-guide, graph-excluded` | 契约修订时自动追加变更记录（TS `VaultManager.ts:749-776`）；Rust 不创建 | TS |

**isSystemFile 保护范围分叉**：TS = 5 个 wiki 系统文件 + `wiki/outputs/*` + `CLAUDE.md` +
`USER_GUIDE.md`（`VaultManager.ts:74-83`）；Rust = 仅 5 个 wiki 系统文件（`vault.rs:271-274`）。
后果：经 Rust 的 `wiki_notes_delete` 可删除 vault 根 `CLAUDE.md`（见 §6.4-6）。

### 2.3 页面类型与 frontmatter 契约

模板定义于 TS `VaultManager.ts:373-516`（`ensureTemplates`），INGEST 写入端为 `src/main/index.ts:886-967`：

| 类型 | frontmatter 字段 | 正文骨架 |
|---|---|---|
| `source` | `type/title/date/source_url/domain/tags/processed/raw_file/raw_sha256/last_verified/possibly_outdated`（+可选 `language/canonical_source`） | Summary / Key Points / Concepts Extracted / Entities Extracted / Contradictions / My Notes（`index.ts:936-965`） |
| `personal-writing` | 上表 + `status: draft / confidence_at_writing`（+后续 `superseded_by`） | Core Argument / Key Claims / Evidence Referenced / Limitations（`index.ts:913-935`） |
| `concept` | `type/title/date/updated/tags/source_count/confidence/domain_volatility/last_reviewed/aliases` | Definition / Key Points / My Position / Contradictions / Sources / Evolution Log（`index.ts:1026-1053`） |
| `entity` | `type/title/date/tags/entity_type/aliases` | Description / Key Contributions / Related Concepts / Sources（`index.ts:1082-1101`） |
| `synthesis` | `type/title/date/tags/source_count/confidence` | Thesis / Evidence / Counter-evidence / Synthesis / Confidence Notes / Limitations / Sources（`VaultManager.ts:455-480`） |

**Rust INGEST 写 source 页时不含上述任何 frontmatter 契约字段**（`ingest.rs:79-103` 只写
title/tags/ai_analyzed_at），来源溯源改放正文 ``**来源文件**: [[raw/...]]``（`ingest.rs:476`）——
这同时违反 wikilink 铁律（链接指向 raw 层路径）。

### 2.4 wikilink 与 slug 规则

- 契约铁律：链接一律 `[[english-kebab-slug]]`，中文名/英文全名进 `aliases`（`wiki/CLAUDE.md` §6）。
- **提取正则分叉**：TS 剥离显示别名与锚点 `\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]`
  （`VaultManager.ts:661`、`WorkflowService.ts:84`）；Rust 保留整段 `\[\[([^\]]+)\]\]`
  （`vault.rs:751-756`）——`[[slug|别名]]` 在 Rust 会提取出 `slug|别名` 当作链接目标。
- **slugify**：TS = ascii 小写连字符，空则 `concept-<base36 时间戳>`（`wiki-host.ts:39-42`）；
  Rust = 同规则但回退 `concept-<毫秒%100000>`（`vault.rs:758-771`）。

### 2.5 confidence 阶梯与开放问题

- 阶梯（CLAUDE.md §7）：`low → medium（source_count ≥3，自动）→ high（仅用户背书，
  `confirm_concept`：`vault.rs:489-501` / `wiki-host.ts:836-851`）`；`source_count ≥5` 时系统
  提请确认（`confirmHigh`，`src/main/index.ts:991-995`）。**Rust INGEST 从不触发**
  （`IngestResult.confirm_high` 恒为 `None`，`ingest.rs:215`）。
- stale 阈值：`domain_volatility` high/medium/low → 90/180/365 天（`WorkflowService.ts:151-167`）。
- QUESTIONS 格式分叉见 §6.4-7。

### 2.6 字段命名分叉（与盘上数据的互操作性）

| 语义 | TS 写盘（盘上现状） | Rust 读取 | 后果 |
|---|---|---|---|
| AI 摘要/时间/关系 | `aiSummary / aiAnalyzedAt / aiRelations`（`VaultManager.ts:708-710, 738-743`） | `ai_summary / ai_analyzed_at / ai_relations`（`vault.rs:161-165`） | Rust 读不到 TS 写的 AI 字段：搜索摘要加权失效（`search.rs:43`） |
| 图谱排除 | `graph-excluded`（连字符，`VaultManager.ts:712`） | `graph_excluded`（下划线，`vault.rs:166`） | Rust 图谱不过滤系统文件（靠 path 前缀兜底） |
| 来源哈希 | `raw_sha256`（`index.ts:897`） | LINT 检查读 `raw_hash`（`workflow.rs:100`） | Rust 哈希检查为死键，永远不触发 |

### 2.7 盘上采样结论

系统文件均为 TS 格式（§1.4）。**新插件必须按 TS 格式读写**（gray-matter 全量 YAML），
Rust 的手写 YAML 子集解析器（`vault.rs:684-749`）不识别块内嵌套对象等写法，不应作为插件基准。

---

## 三、七模块架构精读

> 每模块给出：职责 / 公开 API / 核心算法与分叉。行号标注 `R=` Rust、`T=` TS。

### 3.1 VaultManager（R `vault.rs` 771 行 / T `VaultManager.ts` 1035 行）

职责：vault 目录初始化、笔记 CRUD、frontmatter 解析/序列化、wikilink 提取、反链/标签、
开放问题、日志/索引/概览、AI 结果持久化、导入、分析 tag、批注、附件。

| API（两版同名） | R | T 差异/独有 |
|---|---|---|
| `initialize` | `vault.rs:29-53`（10 目录+4 系统文件） | 另建 attachments/outputs/synthesis/templates + CLAUDE.md/USER_GUIDE.md/ANALYSIS_TAGS.md + 5 模板（`VaultManager.ts:58-72, 267-516`）；**启动 fs.watch 递归监视**（`:539-568`，按 INGESTIBLE_EXTS 过滤，emit created/modified/deleted） |
| `listNotes` | `vault.rs:55-104`（全 vault 递归，隐藏 `.` 项） | 隐藏根级 CLAUDE.md/USER_GUIDE.md（`:604-605`）、排除 attachments 目录；文件夹在前 |
| `readNote` | `vault.rs:137-190` | 非文本扩展名返回空正文（`:677-693`）；AI 字段 camelCase；`graph-excluded` 连字符 |
| `writeNote` | `vault.rs:192-247`（保留旧 frontmatter 其余字段） | CLAUDE.md 写入时同步 USER_GUIDE.md 变更记录（`:749-776`）；AI 字段未传则保留 |
| `createNote` | `vault.rs:254-269`（**无标题消毒**） | 标题消毒 `\/:*?"<>|` → `-` 并用于文件名（`:782-799`） |
| `deleteNote` | `vault.rs:249-252`（无保护，保护在 command 层） | 同（保护在 command 层） |
| `isSystemFile` | 5 文件（`vault.rs:271-274`） | + outputs/* + CLAUDE.md + USER_GUIDE.md（`VaultManager.ts:74-83`） |
| `getBacklinks` | slug **或**全路径匹配（`vault.rs:284`） | 仅全路径匹配（`VaultManager.ts:848-851`）→ 对契约格式的裸 slug 链接**漏报** |
| `getAllTags/getNotesByTag` | `vault.rs:292-313` | 同 |
| `getOpenQuestions/answerQuestion` | `- ` 行 + `✓ ~~删除线~~`（`vault.rs:315-329, 480-487`） | `- [ ]` 复选框 + `（answered … opened …）`（`VaultManager.ts:116-143`） |
| `appendLog/updateIndex/updateOverview` | `vault.rs:331-367`（Rust 格式） | TS 格式（§2.2） |
| `updateAiResults` | `vault.rs:369-399`（tags 并集，snake_case） | `VaultManager.ts:959-977`（camelCase） |
| `importFile` | 默认 `raw/articles`，`fs::copy` **同名覆盖**（`vault.rs:401-414`） | 按扩展名路由 images/pdfs/articles/notes + 同名 `-1/-2` 去重 + md 补 frontmatter（`VaultManager.ts:887-944`） |
| `listRawFiles` | `vault.rs:416-429`（walkdir 全部文件） | 按 INGESTIBLE_EXTS 过滤（`VaultManager.ts:634-657`） |
| `getAnalysisTags/addAnalysisTags` | frontmatter JSON 数组（`vault.rs:431-467`） | `- tag \| template` 正文行（`VaultManager.ts:146-183`） |
| `appendCustomAnalysis` | `vault.rs:469-478` | + frontmatter `custom_analyzed_at/custom_requirement`（`VaultManager.ts:185-198`） |
| `confirmConcept` | `vault.rs:489-501` | `wiki-host.ts:836-851`（插件版） |
| `listAttachments` | **扫 `raw/`**（`vault.rs:503-530`） | 扫 `attachments/`（`VaultManager.ts:946-957`）——同名 API 语义不同 |
| `addAnnotation/removeAnnotation` | `vault.rs:532-574` | `VaultManager.ts:979-1009` |
| 独有 | `resolve_link` 无 | `resolveLink`（**死代码缺陷**，§6.4-11）、`dispose()`（关 watcher）、`getRawDir/getWikiDir` |

序列化：TS 用 gray-matter（全量 YAML）；Rust 手写子集解析/序列化（`vault.rs:590-749`）。

### 3.2 SearchIndex（R `search.rs` 157 行 / T `SearchIndex.ts` 162 行）

| 维度 | T（规范） | R 现状 |
|---|---|---|
| 结构 | 倒排索引 token → path 集合（`SearchIndex.ts:14`） | `HashMap<path, IndexedNote>` 全量线性扫描（`search.rs:5`） |
| 分词 | 英数/中文 run ≥2 字 + **中文 bigram** + 去重（`SearchIndex.ts:17-36`） | Unicode 字母数字 run（**中文整句成单 token，无 bigram**，`search.rs:127-133`）→ 中文查询召回差 |
| 打分 | 命中 token 计数（`SearchIndex.ts:80-106`） | 加权：标题含整句 +10、词含 +5、tag +3、正文词频 ×0.5、AI 摘要 +2（`search.rs:84-124`） |
| 内容上限 | 正文 50000 字、摘要 500 字（`SearchIndex.ts:46-48`） | 无上限 |
| 摘录 | 首个命中词 ±(60/140) 窗口（`SearchIndex.ts:143-161`） | 滑动窗口找最优 200 字——**字节切片在中文正文上会 panic**（`search.rs:140-143`，§6.4-2）且 O(n²) |
| 持久化 | `export()/import()` 钩子（`SearchIndex.ts:117-140`） | 无 |

**规范取定**：新插件实现「TS 倒排 + bigram」结构，采纳 Rust 的加权打分维度（标题/tag/摘要），
snippet 用字符安全切片。

### 3.3 GraphEngine（R `graph.rs` 153 行 / T `GraphEngine.ts` 158 行）

| 维度 | T（规范） | R 现状 |
|---|---|---|
| 链接解析 | knownIds = 全路径（去 .md）+ basename 裸 slug（`GraphEngine.ts:26-32`） | slug_map basename → path + `.md` 后缀回退（`graph.rs:24-32, 39-50`） |
| link 边权 | 2（`GraphEngine.ts:70`） | 1.0（`graph.rs:55-60`） |
| tag 边权 | 1（每对一条，`GraphEngine.ts:75-83`） | 0.5 × 共享 tag 数（`graph.rs:72-91`） |
| strength | `degree / maxDegree`（**度越高越强**，`GraphEngine.ts:85-97`） | `1/(1+0.1·degree)`（**度越高越弱**，语义相反，`graph.rs:94`） |
| 附加 API | `getNode`、`getBacklinkIds`（link 边，`GraphEngine.ts:108-111, 149-157`） | 无 |
| 邻域 | BFS k-hop（T `:118-147` / R `graph.rs:119-152`） | 同 |

**规范取定**：T 的权重与 strength 语义（前端按 strength 定节点尺寸，hub 应更大）；
tag 边权可采纳 R 的 0.5×count 变体但需同步前端渲染预期。

### 3.4 AiPipeline（R `ai_pipeline.rs` 659 行 / T `AiPipeline.ts` 444 行）

| 维度 | T | R（改进，建议采纳） |
|---|---|---|
| 取消 | 每键 AbortController（analyze/custom/ingest），`cancel()` 只杀 analyze（`AiPipeline.ts:56-79`） | `watch<u64> cancel_epoch` 全局取消（含批量，`ai_pipeline.rs:28-66`） |
| JSON 容错 | 直接解析 → ```json fence → 首个 `{...}`，**无重试**（`AiPipeline.ts:375-399`） | 字符串感知的平衡花括号扫描（处理嵌套/转义，`ai_pipeline.rs:529-560`，带单测 `:574-602`）+ **失败一次自修复重试**（`:98-123`） |
| analyze | 0.3 / 1000 tok，正文头截 4000（`AiPipeline.ts:145-150, 137`）；tags 无上限（`:156`） | 0.2 / 2048，正文头 3/4+尾 1/4 截 4000（`:435-445`）；tags 规范化 ≤8 个、≤16 字、去重去 `#`（`:206, 447-463`）；relations 白名单校验 ≤5（`:483-517`） |
| ingestSource | 0.3 / 3000，头截 6000；个人写作规则；matchSlug **不校验**（信任 LLM，靠落盘时 exists 兜底）（`AiPipeline.ts:271-365, 406-444`） | 0.2 / 4096，头尾截 8000；**matchSlug 对照真实 slug 集合校验（防幻觉合并）**、answeredQuestions 逐字匹配保留（`:289-310`）；slug/标题回退链（`:312-319`）；strict serde 反序列化，缺字段显式报错（`:286-287`） |
| customAnalyze | 0.3 / 2000，头截 6000（`AiPipeline.ts:191-259`） | 0.4 / 4096，头尾截 8000；注入已有 analysisTags 防重复（`:330-340`） |
| 契约注入 | 全文 `readContract`（ingest/reflect/query）+ 分节（analyze） | ingest 仅注入 总则/wikilink/confidence 三节（`ingest.rs:61`）——**比 TS 弱** |
| 单测 | 无 | 11 个（`ai_pipeline.rs:562-659`） |

**规范取定**：R 的取消/JSON 自修复/matchSlug 防幻觉/头尾截断/tag 上限 + T 的契约注入范围
（ingest 用全文 `readContract`）与个人写作规则。

### 3.5 ingest（R `ingest.rs` 654 行 / T `src/main/index.ts:796-1149` + 插件 `wiki-host.ts:341-588`）

职责差异极大，详见 §4.1。模块级要点：Rust 把文档提取内置为
`extract_text`（md/txt 直读；pdf → **Python+PyMuPDF 子进程，含硬编码用户 Python 绝对路径回退**
`ingest.rs:569`；docx → zip+正则剥标签 `:587-604`；xlsx → calamine `:606-627`；**其余扩展名一律
按 UTF-8 lossy 读入** `:540-546` → 图片会产出乱码文本，见 §6.4-18）；TS/插件版走
`assets/skills/pdf/read_doc.js` Node 子进程（覆盖 pdf/pptx/docx/xlsx/xlsm/doc/xls/ppt，
`wiki-host.ts:58-82`）。

### 3.6 workflow（R `workflow.rs` 393 行 / T `WorkflowService.ts` 643 行）

LINT/REFLECT/MERGE/QUERY 四工作流，行为差异见 §4.3-4.5。TS 导出 `runStage0Check` 供 REFLECT
复用（`WorkflowService.ts:488-528`）；`jaccard` 导出（`:241-248`）。

### 3.7 contract（R `contract.rs` 83 行 / T `contract.ts` 171 行）

- 共同：`MAX_CONTRACT_CHARS = 8000`（R `:4` / T `:14`）；读 vault 根 CLAUDE.md；优先节排序
  稳定重排（R `:19-59` / T `:53-82`）。
- 截断策略：T 行级截断保证 `## ` 标题完整、超长行按字符切（`contract.ts:21-46`）；
  R 按行边界截断但不保证不超限的行内截断语义一致（`contract.rs:72-82`）。
- T 额外导出内置契约 `WINAGENT_CONTRACT_MD`（`contract.ts:108-171`，与盘上 `wiki/CLAUDE.md` 一致）；
  R 无内置缺省（vault 无 CLAUDE.md 时注入为空）。

---

## 四、五工作流精读

### 4.1 INGEST（编译）

**T 版 10 步管线（规范，`src/main/index.ts:796-1149`；插件版同构 `wiki-host.ts:341-588`）**：

| 步 | 行为 | 引用 |
|---|---|---|
| 0 | `recentIngests` 预标记（防 watcher 双编译） | `index.ts:798-799` |
| 1 | 读 raw：文本直读；office/pdf 走提取子进程（失败→空文本+emptyReason 继续）；图片→空文本；未知扩展名 NUL 字节判二进制 | `index.ts:808-852` |
| 2 | SHA-256(raw 字节) + raw frontmatter `date`>730 天 → `possibly_outdated` | `index.ts:856-863` |
| 3 | 已有概念（slug+title+**aliases**）+ 开放问题 + 契约全文（每次读盘）+ `isPersonal` | `index.ts:865-870` |
| 4 | LLM `ingestSource`（无文本→合成最小 analysis，跳过 LLM） | `index.ts:872-884` |
| 5 | 写 `wiki/sources/<slug>.md`（完整 frontmatter §2.3 + 个人写作分叉模板） | `index.ts:886-968` |
| 6-7 | 概念页：matchSlug→更新（**Evolution Log 追加、source_count+1（个人不计数）、≥3 自动 medium、≥5 未 high → confirmHigh**）否则新建（aliases=[中文名, 英文名]）；实体页同理 | `index.ts:970-1105` |
| 8 | `updateIndex`（三区全量重建）+ `updateOverview`（5 指标）+ `answerQuestion` | `index.ts:1107-1126` |
| 9 | `appendLog('ingest \| …')` | `index.ts:1129-1132` |
| 10 | 逐页重建搜索索引 + 图谱 + `wiki:vault:changed` + 进度 5/10/25/55/70/85/100 | `index.ts:1134-1148` |

**R 版现状（`ingest.rs:10-218`）**：提取文本（失败即整个 INGEST 失败 `:29`）→ 30% 进度 →
LLM → 写 source 页（无契约 frontmatter，正文含 `[[raw/…]]`）→ 概念/实体页追加一行
`- [[source-slug]] — 定义` → log → 标记问题 → 单页重索引 → 图谱 → 100% 进度。
**缺失**：SHA-256、possibly_outdated、个人写作、Evolution Log、source_count/confidence/confirmHigh、
updateIndex/updateOverview（见 §6.2）。

**批量摄入（交互式标定）**：
- T/插件：`BatchSession {pending, done, errors, active}` 状态机；`batchStart` 以 source 页
  frontmatter `raw_file` 集合去重后编译第 1 篇暂停审查（`wiki-host.ts:592-607`）；
  `batchContinue` 串行编译其余、聚合计 confirmHigh（同 slug 取最大 sourceCount，
  `wiki-host.ts:609-638`）；`batchAbort` 丢弃会话。
- R：`batch_start` 只编第 1 篇（`ingest.rs:220-241`）；`batch_continue` **重扫 raw/ 全部文件**、
  以「文件名去扩展名 == source slug」启发式判定未编译（`ingest.rs:252-267`）；`batch_abort` =
  `ai.cancel()`（`:306-308`）。

**拖入自动摄入（仅 TS/插件）**：fs.watch → `raw/` created → `scheduleAutoIngest`：
60 秒去重窗口 + 1.5 秒防抖（`index.ts:622-658` / `wiki-host.ts:276-295`）；启动时
`ingestPendingRawFiles` 补编译无 source 页的 raw 文件（`winagent-services.md` §10.6；
Rust 启动装配无此逻辑，`lib.rs:77-127`）。

**URL 导入**：T 全量校验（http/https、20s 超时、UA、content-type 必须 html/xhtml、正文 30000 字
上限、frontmatter `source_url/domain`、`raw/clippings/<date>-<host>-<slug>.md`）+ 预标记去重
（`index.ts:705-793`）；R 最小实现（reqwest 无超时/无 content-type 检查/无上限，`ingest.rs:310-352`）。

### 4.2 QUERY（检索问答）

| 维度 | T（规范，`WorkflowService.ts:563-643`） | R（`workflow.rs:308-393`） |
|---|---|---|
| 检索 | top 5 → 读 3 篇 ×2500 字 | top 10 → 读 5 篇 ×500 字 |
| 契约 | 全文注入（`:601-602`） | 无 |
| 约束 | 每条主张 `[[source-slug]]` 溯源 + confidence 分层 + 证据不足明说 + 结尾 Confidence Notes/Limitations + 回音室提示（`:607-612`） | 仅「注明来源笔记路径」一句 |
| 落盘 | `wiki/outputs/<date>-query-<slug>.md`（fm `query-output, graph-excluded`）+ log | `wiki/outputs/query-report.md`（固定名，覆盖历史） |
| LLM | 0.3 / 2000 | 0.3 / 2048 |

### 4.3 LINT（健康检查）

**T 10 项（规范，`WorkflowService.ts:22-238`）**：1 frontmatter(type/date) `:65-78`；
2 broken-wikilink（剥显示/锚点，三形式解析）`:80-96`；3 index 一致性 `:98-102`；
4 stub（**字符数** <100）`:104-112`；5 近重复（concept slug Jaccard>0.7）`:114-123`；
6 SHA-256（`raw_sha256` vs raw 字节，含 raw 缺失）`:125-149`；7 stale（90/180/365×last_reviewed）
`:151-167`；8 别名重叠（concepts）`:169-186`；9 wikilink 格式（英文 kebab）`:188-201`；
10 系统文件禁链 `:203-214`。报告 `wiki/outputs/lint-<date>.md`（fm `lint-report`）+ appendLog。

**R 9 项（`workflow.rs:10-174`）**：broken-link（不剥显示别名）`:18-33`；stub（**字节长度**<100）
`:35-43`；no-tags(wiki/) `:45-51`；no-ai-summary(sources/) `:53-61`；orphan（O(n²) 反链，仅豁免
index/log）`:63-80`；hash-changed（读 **`raw_hash` 死键**，`raw_sha256` 永不命中；不检 raw 缺失）
`:82-108`；duplicate-title `:110-120`；no-confidence(concepts) `:122-131`；stale-index `:133-142`。
报告 `wiki/outputs/lint-report.md`（固定名）+ 无 log。

**裁决**：新插件实现 T 的 10 项 + 补 R 独有可取项（no-tags / no-ai-summary / duplicate-title /
no-confidence 可并入 T 集合形成 **13 项规范**）；修复死键与字节长度问题。

### 4.4 REFLECT（综合分析）

| 维度 | T（规范，`WorkflowService.ts:363-486`） | R（`workflow.rs:176-248`） |
|---|---|---|
| Stage 0 | `runStage0Check`：raw_file 存在性 + SHA-256 + possibly_outdated → 未通过降权提示（`:368-376, 488-528`） | 无 |
| 输入 | concepts/entities/sources 分区简报 400/300/500 字 | 所有 wiki/ 笔记 200 字摘录、总量 8000 字 |
| 输出 | **严格 JSON** {patterns, contradictions, gaps, orphans, synthesis} + 回音室强制声明 | 自由 markdown |
| 落盘 | `wiki/synthesis/reflect-<date>-synthesis.md`（fm `synthesis, confidence: medium`）+ `gap-report-<date>.md` + overview 更新 + log | `wiki/outputs/reflect-report.md`（固定名） |
| LLM | 0.3 / 1500 + 契约注入 | 0.4 / 4096 无契约 |

### 4.5 MERGE（去重合并）

| 维度 | T（规范，`WorkflowService.ts:252-359`） | R（`workflow.rs:250-306`） |
|---|---|---|
| frontmatter | aliases 并集 + 双方 title（`:279-286`） | 仅 tags 并集 |
| 正文 | Sources 段并集 + Evolution Log 并集（`:288-317`） | 整体拼接 + `## 合并自 [[remove]]` |
| wikilink 改写 | **仅 wiki/ 层**（`:319-343`） | **全 vault 含 raw/**（`:280-291`）——违反红线 §9 |
| 被合并页 | 替换为 redirect 页（fm `redirect`，`:345-351`） | **直接删除** |
| 记录 | appendLog | `wiki/outputs/merge-report.md` |

---

## 五、IPC 与事件表面

### 5.1 Rust Tauri command 全集（34 个，`lib.rs:150-198` 注册 / `commands/wiki.rs` 实现）

| 组 | command（副作用） |
|---|---|
| Window | `wiki_window_open`（复用 `index.html?view=wiki`，`commands/wiki.rs:11-32`） |
| Vault | `wiki_vault_path`；`wiki_vault_set_path`（重建索引 `:44-61`） |
| Notes | `wiki_notes_list/read`；`wiki_notes_write`（重索引；**图谱重建省略** `:99`）；`wiki_notes_delete`（系统文件拦截+摘索引）；`wiki_notes_create` |
| Links/Tags | `wiki_links_backlinks`；`wiki_tags_list`；`wiki_tags_notes` |
| Search/Graph | `wiki_search`；`wiki_graph_data`；`wiki_graph_node`（半径 1）；`wiki_graph_rebuild` |
| AI | `wiki_ai_analyze`（候选=wiki/ 去自身；noteType 按路径；契约节 [总则/wikilink/confidence/个人写作/质量红线]；结果持久化+重索引+图谱+emit）`:202-287`；`wiki_ai_cancel` |
| Ingest | `wiki_ingest`；`wiki_ingest_batch_start/continue`；`wiki_ingest_batch_abort`（=ai.cancel） |
| Workflow | `wiki_workflow_lint/reflect/merge/query`（成功各 emit vault:changed） |
| Import | `wiki_import_url`；`wiki_import_file`；`wiki_import_analyze` |
| 其他 | `wiki_analysis_tags_list/add`；`wiki_concept_confirm`（+重索引）；`wiki_attachments_list`；`wiki_annotations_add/remove` |

### 5.2 事件全集

| 事件 | 载荷 | 发起点 |
|---|---|---|
| `wiki:vault:changed` | `{type: created/modified/deleted, path}`；merge 时 `{type: merge, keep, remove}` | Rust `commands/wiki.rs:284`、`ingest.rs:206`、`workflow.rs:164,240,298,385`；T `index.ts:1145`（IPC 同名） |
| `wiki:ingest:progress` | `IngestProgress {file, stage, percent, done?, error?}` | Rust `ingest.rs:65-71,198-204,274-280`；T `index.ts:691-694` |
| `wiki:custom:progress` | 同上形状 | 仅 T `index.ts:696-699`（Rust 无独立 custom 通道） |
| `agent:event` / `agent:confirm` / `config:changed` | AgentEvent 联合 / 确认请求 / 配置变更 | T `winagent-services.md` §10.3-10.4（Wiki 之外，插件需一并映射） |

注意：**Rust 版没有 vault 文件系统 watcher**（`lib.rs:77-127` 无任何 watch 装配；
`types.rs:459-468` 的 `VaultChangeEvent` 定义未接线；`Cargo.toml:28` 虽声明 `notify = "7"`
依赖但 src 下零使用）——vault 变更事件只在 Rust 主动写盘后发出。

### 5.3 前端消费矩阵（桌面 React，`src/renderer/`）

| 消费方 | 调用的 API / 事件 | 引用 |
|---|---|---|
| `lib/useWiki.ts` | vaultPath/listNotes/getAllTags/readNote/writeNote/createNote/deleteNote/search/getBacklinks/getGraphData/setVaultPath/importFile/ingest/addAnnotation/removeAnnotation/getNotesByTag + `onVaultChanged` 订阅 | `useWiki.ts:36-192` |
| `wiki/WikiWindowApp.tsx` | ingestBatchStart/Continue/Abort、importFile、ingest、workflowLint/Reflect/Query/Merge、importUrl、openNote('CLAUDE.md')（标定闭环「调整契约规则」） | `:63,83,100,116,134,141,149,171,194,210,232,250` |
| `wiki/WikiLayout.tsx` | `onIngestProgress`、aiAnalyze/aiCancel、getBacklinks、loadGraph、saveNote（tag/一键应用摘要与关联）、批注、拖拽 importFile+ingest（Tauri `onDragDropEvent` 桥） | `:38,67,76,84-87,110-163,176-226` |
| `wiki/ConfirmHighDialog.tsx` | `confirmConcept(slug,'concepts')` | `:30` |
| `wiki/ImportAnalyzeDialog.tsx` | `importAnalyze` + `onIngestProgress`/`onCustomProgress` | `:46-52,72` |
| `wiki/GraphView.tsx` | 纯 Canvas 渲染器（力导向在客户端；读 CSS 变量配色） | `GraphView.tsx:1-60` |
| 其余（WikiSidebar/FileExplorer/WikiEditor/CodeMirrorEditor/MarkdownPreview/WikiRightPanel/AIPanel/BacklinksPanel/TagPanel/AnnotationPanel） | 展示层，经 useWiki/props 回调 | — |

### 5.4 旧插件 HTTP 映射（已验证可复用，`dsh-plugin/src/server.ts`）

- 34 条 `/winagent/api/wiki/*` 路由（`server.ts:350-467`）：与 5.1 的 34 个 command 相比，
  去掉 `wiki_window_open`、新增浏览器专用 `POST /wiki/upload`（§5.4 末条），数量恰好持平。
- 事件传输：**长轮询** `GET /winagent/api/agent/events?seq=<n>`（`bus.waitSince(seq, 25000)`，
  `server.ts:344-348`）；确认走 `POST /winagent/api/agent/confirm`（`:335-343`）。
- 浏览器上传：`POST /winagent/api/wiki/upload?name=&requirement=`（≤100MB，写入
  `raw/uploaded/<ts>-<name>` 后走 importAnalyze，`server.ts:437-446` + `wiki-host.ts:824-832`）。
- UI 注入：悬浮按钮 + iframe `/winagent/ui`（`server.ts:474-492`）。

---

## 六、三实现差异对账与规范行为定义

### 6.1 架构级差异总表

| # | 维度 | T（Electron/插件） | R（桌面） | 裁决（新插件） |
|---|---|---|---|---|
| 1 | frontmatter 引擎 | gray-matter 全量 YAML（`VaultManager.ts:3`） | 手写子集（`vault.rs:684-749`） | **T**（盘上数据兼容） |
| 2 | AI 字段命名 | camelCase（`VaultManager.ts:708-710`） | snake_case（`vault.rs:161-165`） | **T**（盘上兼容；写入时两个名都写可兜底） |
| 3 | 图谱排除键 | `graph-excluded`（`:712`） | `graph_excluded`（`vault.rs:166`） | **T**（读取时兼容两种拼写） |
| 4 | QUESTIONS 格式 | `- [ ]` 复选框（`VaultManager.ts:86-143`） | `- ` 纯行（`vault.rs:315-329,480-487`） | **T**（R 格式互操作断裂，§6.4-7） |
| 5 | wikilink 提取 | 剥显示/锚点（`VaultManager.ts:661`） | 保留整段（`vault.rs:751-756`） | **T** |
| 6 | LINT | 10 项（§4.3） | 9 项异构 | **T ∪ R 可取项 = 13 项**（§4.3 裁决） |
| 7 | 搜索 | 倒排+bigram+计数 | 线性+加权+无 bigram | **T 结构 + R 加权维度**（§3.2） |
| 8 | 图谱 | link 2 / tag 1 / strength=d·max⁻¹ | link 1 / tag 0.5n / strength 递减 | **T 语义**（§3.3） |
| 9 | INGEST 管线 | 契约完整 10 步 | 简化 6 步 | **T 管线 + R 改进**（§4.1/§6.5） |
| 10 | 取消模型 | 每键 AbortController，cancel 只杀 analyze | 全局 epoch，cancel 杀全部 | **R 语义**（batch abort 需要），但 analyze 取消不应误杀 ingest → 按 key epoch |
| 11 | JSON 容错 | 3 级解析无重试 | 平衡扫描 + 自修复重试 + 单测 | **R** |
| 12 | MERGE | redirect 页 + 结构化并集 | 删除 + 全库改写（含 raw） | **T**（R 违反红线） |
| 13 | vault 初始化 | 全量骨架+契约+模板+watcher | 最小骨架，无 watcher | **T** |
| 14 | 自动摄入 | 60s 去重 + 1.5s 防抖 + 启动补编译 | 无 | **T** |
| 15 | 报告命名 | 带日期（lint-<date> 等） | 固定名（覆盖历史） | **T** |
| 16 | 导入/附件 | 扩展名路由+重名去重；attachments/ | 覆盖复制；raw/ | **T** |

### 6.2 Rust 缺失的契约行为（重建清单）

1. source 页 frontmatter 契约字段全缺（raw_file/raw_sha256/last_verified/possibly_outdated/
   language/canonical_source），溯源降级为正文 `[[raw/…]]`（违反 wikilink 铁律）——`ingest.rs:79-103,476`
2. 个人写作（raw/personal/）全流程缺失
3. source_count / confidence 自动升级 / confirmHigh 提请缺失（恒 None，`ingest.rs:215`）
4. 概念页 Evolution Log 缺失（仅追加来源行，`ingest.rs:112-118`）
5. INGEST 后 `updateIndex`/`updateOverview` 不执行（index/overview 必然过期）
6. REFLECT：无 Stage 0、无 synthesis/ 页、无 gap report、无 overview 更新、输出非严格 JSON
7. QUERY：无契约注入、无逐主张溯源、无 Confidence Notes/Limitations
8. MERGE：无 aliases 并集、无 redirect 页、改写波及 raw/
9. 无 vault watcher / 自动摄入 / 启动补编译（`lib.rs:77-127`）
10. vault 初始化不建 CLAUDE.md/USER_GUIDE.md/ANALYSIS_TAGS.md/synthesis/templates（`vault.rs:29-53`）
11. 批量摄入无标定会话状态机、无 `raw_file` 集合去重（文件名启发式代替，`ingest.rs:252-267`）

### 6.3 Rust 相对 TS 的改进（并入规范）

1. `complete_json`：字符串感知平衡花括号提取 + 一次自修复重试 + 11 个单测（`ai_pipeline.rs:73-124,529-659`）
2. matchSlug 防幻觉：对照真实 slug 集合校验；answeredQuestions 逐字匹配保留（`ai_pipeline.rs:289-310`）
3. `clip_body` 头 3/4 + 尾 1/4（保结论，`ai_pipeline.rs:435-445`）
4. tag 规范化上限（≤8 个、≤16 字、大小写去重、剥 `#`，`ai_pipeline.rs:447-463`）
5. `get_backlinks` 兼容裸 slug（`vault.rs:284`）——修复 TS 反链漏报（`VaultManager.ts:848-851`）
6. analyze 参数上调（0.2/2048）与 LINT 可取新增项（no-tags/no-ai-summary/duplicate-title/no-confidence）

### 6.4 阅读中发现的具体缺陷（两版合计，新插件须避开）

1. R LINT-6 读 `raw_hash`（`workflow.rs:100`）但无任何写入方（T 写 `raw_sha256`，`index.ts:897`）→ 死检查；且不检 raw 缺失
2. R `make_snippet` 字节切片 `&body_lower[i..end]`（`search.rs:140-143`）：中文正文上 end 非字符边界会 **panic**；且 O(n²)
3. R LINT stub 用字节长度（`workflow.rs:39`）：中文约 33 字即触发
4. R MERGE 改写波及 raw/（`workflow.rs:280-291`）——违反 CLAUDE.md §9「不删除、不修改 raw/ 下任何文件」。
   注：契约 §5 自身措辞为「**全库** [[remove-slug]] 改写」，与 §9 存在内部张力；本报告以 §9
   红线为准裁决（T 版实现取 wiki/ 层改写，是二者自洽的解释），新插件沿用并建议用户修订契约措辞
5. R INGEST 不更新 index/overview（`ingest.rs:156-196` 无调用）
6. R `isSystemFile` 不含 CLAUDE.md/USER_GUIDE.md/outputs（`vault.rs:271-274`）→ `wiki_notes_delete` 可删契约文件
7. R QUESTIONS 与盘上复选框格式互操作断裂：读取带出 `[ ] …（opened …）` 残渣、回答永不命中（`vault.rs:315-329,480-487`）
8. R wikilink 提取把 `slug|别名`/`slug#锚` 当目标（`vault.rs:751-756`）
9. R 图谱 strength 语义反向（hub 更小，`graph.rs:94`）
10. R `wiki_notes_write` 不重建图谱（`commands/wiki.rs:99` 注释明示省略）
11. T `resolveLink` 为死代码（try/return 未真正检查存在性，`VaultManager.ts:812-832`）
12. T analyze 的 tags 无上限（`AiPipeline.ts:156`）
13. T 概念页更新每次追加新 `## Evolution Log` 标题（`index.ts:996-1009`）→ 章节标题随摄入次数累积
14. R `list_attachments` 扫 raw/（`vault.rs:503-530`）与 T attachments/ 语义同名不同义
15. R `import_file` 同名覆盖（`vault.rs:411`）
16. R URL 导入无超时/类型检查/上限/合法性校验（`ingest.rs:319-326`）
17. R `batch_continue` 文件名启发式判定未编译（`ingest.rs:258-267`）：跨文件 slug 撞名时漏编
18. R `extract_text` 对未知扩展名（含图片）按 UTF-8 lossy 硬读（`ingest.rs:540-546`）→ 图片产出乱码文本送 LLM；提取失败直接令整个 INGEST 失败（`:29`），违背 T 的「空文本合成页继续」设计（`index.ts:874-884`）

### 6.5 规范行为定义（新插件 Wiki 层实现基准）

| 工作流 | 基准 | 叠加 |
|---|---|---|
| 数据层 | TS frontmatter/系统文件/模板格式（§2） | 读取兼容 snake_case 与连字符拼写（§6.1-2/3） |
| INGEST | T 10 步管线 + 批量标定状态机 + 自动摄入（§4.1） | R：JSON 自修复、matchSlug 防幻觉、头尾截断、tag 上限；修复 §6.4-13/18 |
| QUERY | T（溯源+Confidence Notes+落盘 dated） | R 检索参数可调（top10×500） |
| LINT | T 10 项 + R 新增 3 项（no-tags/no-ai-summary/duplicate-title/no-confidence 取 3 合并）= **13 项**；报告带日期 | 修复死键/字节长度 |
| REFLECT | T（Stage0+严格 JSON+synthesis 页+gap report+overview） | LLM 参数可对齐 R（0.3/4096） |
| MERGE | T（aliases 并集+Sources/Evolution 并集+wiki/ 层改写+redirect 页） | — |
| AI 分析 | T（分节契约注入+个人写作规则+relations 白名单） | R（cancel 语义按 key、自修复、tag 上限） |
| 搜索/图谱 | T 结构 + R 打分维度；图谱 T 权重/strength | 修复 §6.4-2/9 |

---

## 七、dsh 插件化分析（Wiki 部分）

### 7.1 模块可移植性（目标：Node 20+ ESM TS 包）

| 模块 | 来源 | 依赖 | 结论 |
|---|---|---|---|
| VaultManager/SearchIndex/GraphEngine/contract | TS `src/main/wiki/`（或直接复用旧插件 `dsh-plugin/src/wiki/` 同构副本） | fs/path/crypto + gray-matter | 纯逻辑，**按 §6.5 修订后直迁** |
| WorkflowService（LINT/MERGE/Stage0） | 同上 | 无 LLM | 纯逻辑直迁 |
| AiPipeline + INGEST/REFLECT/QUERY 的 LLM 调用 | TS | `OpenAIClient`（旧插件已带，`dsh-plugin/src/llm/OpenAIClient.ts`）+ 插件自有 config | 需宿主无关的 provider 配置（旧插件方案：`$DSH_HOME/winagent/config.json`，README §安全说明） |
| 文档提取链 | 二选一 | Node 技能子进程（`assets/skills/pdf/read_doc.js`，覆盖 8 格式，旧插件已验证）vs Python+PyMuPDF（桌面专用，含硬编码路径缺陷） | **插件取 Node 链**；注意 piped-stdio 在受限沙箱的 EPERM 风险（`winagent-services.md` §6.10） |
| vault watcher | T `VaultManager.ts:539-568`（fs.watch） | Node 内置 | 直迁；DSH 为常驻进程可长期持有 |

### 7.2 宿主依赖与传输（依据 `.plugin-work/dsh-web-plugin-api.md`）

- HTTP：`ctx.webServer.register({kind:'exact', path, handler})`——旧插件已验证 34 条 wiki 路由
  模式（§5.4），新插件可整体继承路由表。
- UI 注入：`tapIndex`（经典脚本/iframe，旧插件模式）或结构化 `webserver/index-inject`
  （`dsh-web-plugin-api.md` §(c)）。
- 事件：长轮询已被旧插件验证（25s hold，§5.4）；SSE 为文档推荐的替代（gzip 已豁免
  text/event-stream）。两者对 Wiki 事件（低频）均够用。
- 生命周期：`ctx.effect(() => disposers)` 统一注销路由；vault watcher/dispose 对齐。

### 7.3 旧插件已验证资产（复用判定）

| 资产 | 判定 |
|---|---|
| `dsh-plugin/src/server.ts` 路由表 + 长轮询 + 上传 | **直接复用**（结构废弃指整体插件形态，非此层逻辑） |
| `dsh-plugin/src/wiki/wiki-host.ts`（884 行，T 行为完整移植） | **直接复用为基线**，叠加 §6.5 修订 |
| `dsh-plugin/src/wiki/{VaultManager,SearchIndex,GraphEngine,AiPipeline,WorkflowService,contract}.ts` | 与 src/main 同构，作为修订底稿 |
| `dsh-plugin/assets/ui/`（vanilla JS UI） | 参考其 API 消费方式；UI 形态按 §8-Q1 决策 |
| `dsh-plugin/assets/skills/`（文档提取） | 直接复用 |

### 7.4 v1 范围建议（cheap-first）

- **P0 纯逻辑**：vault CRUD + 文件树 + 搜索（TS 结构+R 打分）+ tags/backlinks + 图谱数据 +
  contract 读取 + LINT(13) + MERGE + QUESTIONS/ANALYSIS_TAGS/批注/附件 + 系统 API（config/tools）。
- **P1 LLM-gated**：INGEST 单篇 + 批量标定 + AI 分析（analyze/custom）+ QUERY + confirmHigh 弹窗；
  开关进插件设置（默认开）。
- **P2 集成型**：URL 导入、importAnalyze（拖入分析弹窗流程）、浏览器上传、文档提取链、
  自动摄入 watcher + 启动补编译。

### 7.5 风险清单

1. 大 vault 全量重建为 O(n) 内存/时间（TS 与 R 同）——首版可接受，预留 export/import 持久化钩子（`SearchIndex.ts:117-140`）
2. 长轮询并发连接数与 DSH webserver 的连接上限；SSE 切换需验证 gzip 豁免路径
3. 并发 INGEST 与单例 `batchSession` 的重入保护（`wiki-host.ts:593,611` 模式需保留）
4. 浏览器上传体积（旧插件 100MB 上限）与 DSH 反代超时
5. API Key 明文存储于 `$DSH_HOME/winagent/config.json`（旧插件 README 已声明，沿用）
6. CSS/全局样式与 DSH 宿主冲突——`PROJECT_ASSETS_REPORT.md` §四/`.plugin-work/dsh-integration-plan.md` §4 的变量改名+作用域方案

---

## 八、开放问题（插件实施时决策）

1. **插件形态**：iframe 挂件（旧插件，已验证、零宿主耦合）vs `dsh.client` 原生客户端插件
   （`.plugin-work/dsh-integration-plan.md` 路线，slot 挂载、HMR）。对 Wiki 后端无影响，
   只决定 UI 移植方式与 `tauri-bridge` 的替代层写法。
2. **事件传输终选**：长轮询（已验证）vs SSE（更省连接）。Wiki 事件低频，两者皆可。
3. **桌面 Rust 是否向 §6.5 规范对齐**：Rust 缺契约行为（§6.2），长期存在「三版不一致」时
   以哪版为准的问题；本报告以 TS+改进为准，Rust 对齐与否属独立决策。
4. **P1 LLM 工作流的默认开关与降级**：无 provider 配置时 UI 应只暴露 P0 能力。
5. **报告命名**：建议统一带日期（T 风格），是否保留 R 的固定名兼容读取由 UI 决定。
6. **上传/附件目录**：浏览器上传落 `raw/uploaded/`（旧插件）是否为正式契约目录（需进
   RAW_SUBDIRS 与模板说明）。
7. **Agent 侧 wiki 工具**（search_knowledge_base 等 9 个，`PROJECT_ASSETS_REPORT.md` §四）：
   是否随 v1 提供——旧插件已验证桥接模式（`dsh-plugin/src/tools/wikiTools.ts` ← WikiHost）。
