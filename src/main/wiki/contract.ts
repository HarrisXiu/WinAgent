/**
 * WinAgent 知识库行为契约（CLAUDE.md 默认内容）
 *
 * 本文件是知识库的操作宪章：INGEST / QUERY / LINT / REFLECT / MERGE 全部内置工作流、
 * wikilink 与 confidence 规则以此为准。
 * - 契约以 vault 根目录的 CLAUDE.md 文件呈现，用户可编辑（标定闭环：改契约 → 继续批量生效）
 * - 管线每次执行 runIngest 时重新读盘，取前 MAX_CONTRACT_CHARS 字符注入 LLM system prompt
 */

export const MAX_CONTRACT_CHARS = 3000

export const WINAGENT_CONTRACT_MD = `# WinAgent 知识库契约（CLAUDE.md）

> 本文件是知识库的操作宪章。INGEST/QUERY/LINT/REFLECT/MERGE 全部内置工作流、wikilink 与
> confidence 规则以此为准。本文件由用户维护，AI 不得擅自改写。编辑并保存后，下一次
> 批量摄入立即按新契约执行。

## 0. 总则
- 三层结构：raw/ 人类原始文件（不可变，AI 永不修改）；wiki/ LLM 编译层（唯一检索区）；
  outputs/ 查询与报告输出。
- 全部内容默认中文写作；文件名 slug 一律英文小写连字符（如 attention-is-all-you-need），
  禁止中文、空格与下划线。中文名/英文全名进 frontmatter aliases。
- 未按流程生成的内容不进入 wiki/ 层。

## 1. INGEST（编译）
- 一次只编译一个来源，串行执行。
- 概念提取 3-8 个；已有概念必须 matchSlug 对齐（更新既有页），只有确实不存在才新建。
- 概念定义一句话；Key Points 3-8 条；summary 2-4 句。
- 与其他来源的分歧必须写入 contradictions，不得掩盖。
- 开放问题（QUESTIONS.md）中可回答的必须原样匹配进 answeredQuestions。
- 译文/转述来源须填写 canonical_source（原始出处）；来源写作语言填入 language。
- 不确定的内容写"（待补充）"，绝不臆造、绝不编造引用。

## 2. QUERY（检索问答）
- 先 search 后回答；每条主张必须带 [[source-slug]] 溯源，不允许只引用概念页。
- 按 confidence 分层表述：high=用户背书或 ≥5 源一致；medium=≥3 源；low=单源或不确定。
- 答不出或证据不足时明确说明，不编造。
- 有复用价值的回答落盘 wiki/outputs/，结尾附 Confidence Notes 与 Limitations。

## 3. LINT（健康检查）
- 10 项检查：frontmatter / broken wikilink / index 一致性 / stub / 近重复 / SHA-256 完整性 /
  stale / 别名重叠 / wikilink 格式 / 系统文件被 wikilink。
- 修复优先于新增，不删除历史记录；SOURCE MODIFIED 应引导重新摄入。

## 4. REFLECT（综合分析）
- Stage 0 反向检验：先核验每个来源的 raw_file 存在性、SHA-256 一致、possibly_outdated，
  未通过的来源综合时降权；未找到反驳证据时标注回音室风险。
- 再执行模式扫描 → 矛盾检测 → Gap Analysis → 孤立概念识别；synthesis 落盘 wiki/synthesis/。

## 5. MERGE（去重合并）
- 合并前必须获得用户确认（UI 或对话）。
- 保留页吸收 aliases 并集；Sources 与 Evolution Log 并集去重；全库 [[remove-slug]]
  改写为 [[keep-slug]]；被合并页替换为 redirect 页。

## 6. wikilink 铁律
- 链接一律 [[english-kebab-slug]]，不带 .md、不带中文。
- 中文名/英文全名进 frontmatter aliases，由 aliases 做检索兜底。
- 禁止把 URL 或长标题当链接目标；系统文件（index/log/overview/QUESTIONS/CLAUDE.md）
  不得作为 wikilink 目标。

## 7. confidence 规则
- 层级 low / medium / high；source_count 累计 3+ → medium，5+ 且无重大矛盾 → 系统提请
  用户背书 high。
- high 只由用户确认（confirmation），计数器永不自动升 high。
- confidence 与 domain_volatility 决定 stale 检查阈值（90/180/365 天）。

## 8. 个人写作（raw/personal/）
- 视为"用户的立场声明"：summary 写核心论点，概念 definition 写个人立场。
- 不参与 source_count 计数；维护 status / confidence_at_writing / superseded_by。
- 立场变更时更新 superseded_by 指向新文章，不覆盖旧文。

## 9. 质量红线
- 不删除、不修改 raw/ 下任何文件；系统文件（index/log/overview/QUESTIONS/CLAUDE.md）受保护。
- LLM 输出必须严格合法 JSON，字段不得缺省；失败必须如实报错，不得静默吞掉。
`
