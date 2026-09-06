"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiPipeline = void 0;
exports.parseJsonObject = parseJsonObject;
const OpenAIClient_1 = require("../llm/OpenAIClient");
const Logger_1 = require("../util/Logger");
/** 各类型笔记的定制审查规则 */
const TYPE_RULES = {
    source: `【本页类型：来源页（wiki/sources/）】
- 检查 Key Points 是否完整（3-8 条）、正文是否标注来源（[[source-slug]] 溯源）
- 与知识库其他笔记矛盾时，在 suggestions 中明确指出分歧`,
    concept: `【本页类型：概念页（wiki/concepts/）】
- 检查 definition 是否为一句话定义、是否引用 [[source-slug]] 溯源
- 概念页缺少溯源链接时在 suggestions 中提示「应引用来源页」`,
    entity: `【本页类型：实体页（wiki/entities/）】
- 检查描述是否为一句话、type（person/tool/institution/paper）是否合适`,
    raw: `【本页类型：原始文件（raw/ 只读层）】
- 内容为人类原始输入，AI 永不修改；建议聚焦「可编译为哪些概念/来源页」`,
    note: ''
};
/**
 * AI 分析管道
 * 复用现有 LLM 客户端，对笔记进行标签、摘要、关系发现与质量审查
 */
class AiPipeline {
    /**
     * 进行中的操作 → 独立 AbortController。
     * analyze / custom / ingest 各占一个 key，并发互不覆盖。
     */
    controllers = new Map();
    /** 取消全部进行中的 AI 操作（analyze/custom/ingest 一网打尽，供用户主动中止） */
    cancel() {
        for (const [key, controller] of this.controllers) {
            controller.abort();
            this.controllers.delete(key);
        }
    }
    /** 注册一个新操作并返回其 signal；同 key 已有进行中的请求先取消（防连点） */
    track(key) {
        this.controllers.get(key)?.abort();
        const ac = new AbortController();
        this.controllers.set(key, ac);
        return ac.signal;
    }
    untrack(key) {
        this.controllers.delete(key);
    }
    /**
     * 对单篇笔记执行完整分析（标签 + 摘要 + 关系发现 + 质量审查建议）。
     * 单次 LLM 调用同时产出全部内容（共享上下文，省 2/3 token 与延迟）。
     * @param provider LLM 提供者配置
     * @param title 笔记标题
     * @param body 笔记正文（markdown）
     * @param candidates 知识库中其他笔记（path + title），关系发现的 target 直接映射为可跳转路径
     * @param opts 可选：契约注入 / 页面类型定制 / 开放问题列表
     */
    async analyze(provider, title, body, candidates, opts = {}) {
        const signal = this.track('analyze');
        const { noteType = 'note', contract = '', openQuestions = [] } = opts;
        // frontmatter 关键标量序列化为一行（entity_type 等字段在 frontmatter 中，正文看不到）
        const fmScalars = opts.frontmatter
            ? Object.entries(opts.frontmatter)
                .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
                .slice(0, 8)
            : [];
        const frontmatterLine = fmScalars.length
            ? `\n当前笔记 frontmatter 关键字段：${fmScalars.map(([k, v]) => `${k}=${v}`).join(', ')}`
            : '';
        // 候选去重 + 过滤空路径（当前笔记自身由调用方排除）
        const seen = new Set();
        const others = candidates.filter((c) => c.path && !seen.has(c.path) && !!seen.add(c.path));
        const candidateMap = new Map(others.map((c) => [c.path.toLowerCase(), c]));
        // 契约注入：改 CLAUDE.md → 分析行为随之变化
        const contractRule = contract
            ? `\n\n=== 知识库行为契约（CLAUDE.md，必须遵守）===\n${contract}`
            : '';
        // 页面类型定制规则
        const typeRule = TYPE_RULES[noteType]
            ? `\n\n${TYPE_RULES[noteType]}`
            : '';
        // 开放问题列表：能回答的原样复制问题文本进 suggestions
        const questionRule = openQuestions.length
            ? `\n\n=== 开放问题列表（若本笔记能回答其中问题，将问题原文放入 suggestions） ===\n${openQuestions.map((q) => `- ${q}`).join('\n')}`
            : '';
        const messages = [
            {
                role: 'system',
                content: `你是一个知识管理助手。分析给定笔记，输出严格合法的 JSON 对象（不要 markdown 代码块、不要多余文字）：
{
  "tags": ["3-8 个标签，中英文混合、每个 2-8 个字，涵盖主题/领域/类型"],
  "summary": "2-4 句中文摘要，概括核心内容与关键观点，不要以「本文」「这篇文章」等开头",
  "relations": [{"target": "最相关候选笔记的精确路径", "reason": "一句话相关原因"}],
  "suggestions": ["0-3 条具体可执行的改进建议；没有问题返回空数组"]
}
要求：
- relations 取 0-5 条；没有明显相关的候选时返回空数组
- relations 的 target 必须逐字复制下方候选列表每行「- 」之后、「（标题」之前的路径部分，禁止编造或改写
- suggestions 类型示例：正文过短（stub，<100 字）建议补充内容、缺少 [[source-slug]] 溯源、正文可回答开放问题（写问题原文）、与某笔记存在矛盾（写原因）
- tags 示例：["机器学习", "神经网络", "AI", "教程"]${typeRule}${questionRule}${contractRule}`
            },
            {
                role: 'user',
                content: `当前笔记标题：${title}${frontmatterLine}
当前笔记内容：${truncate(body, 4000)}

知识库中其他笔记（每行格式：- 路径（标题: xxx））：
${others.map((c) => `- ${c.path}（标题: ${c.title}）`).join('\n') || '（暂无其他笔记）'}`
            }
        ];
        try {
            const result = await (0, OpenAIClient_1.chatStream)(provider, messages, {
                temperature: 0.3,
                maxTokens: 1200,
                stream: false,
                signal
            });
            assertNotTruncated(result, 'AI 分析');
            const parsed = parseJsonObject(result.content);
            if (!parsed || typeof parsed !== 'object') {
                throw new Error(`AI 分析结果无法解析为 JSON。前 200 字符: ${result.content.slice(0, 200)}`);
            }
            const tags = strArr(parsed.tags);
            const summary = typeof parsed.summary === 'string' ? String(parsed.summary).trim() : '';
            const suggestions = strArr(parsed.suggestions).slice(0, 3);
            // relations 校验：target 必须命中候选列表中的真实路径（映射回可跳转 relPath + 回填显示标题）
            const relations = Array.isArray(parsed.relations)
                ? parsed.relations
                    .filter((r) => r && typeof r.target === 'string' && r.target.trim())
                    .map((r) => ({
                    target: r.target.trim(),
                    reason: typeof r.reason === 'string' ? r.reason.trim() : ''
                }))
                    .filter((r) => {
                    if (candidateMap.has(r.target.toLowerCase()))
                        return true;
                    // 编造的 target 不静默丢弃：记日志便于发现模型对齐问题
                    Logger_1.Logger.warn(`[AiPipeline] relations 编造 target 已过滤: "${r.target}"（不在候选列表中）`);
                    return false;
                })
                    .map((r) => ({ ...r, title: candidateMap.get(r.target.toLowerCase()).title }))
                    .slice(0, 5)
                : [];
            return { tags, summary, relations, suggestions };
        }
        catch (e) {
            // 如实报错（由调用方传播给前端 aiError），AbortError 由调用方静默处理
            throw e instanceof Error ? e : new Error(`AI 分析失败: ${String(e)}`);
        }
        finally {
            this.untrack('analyze');
        }
    }
    /**
     * 定制分析：按用户输入的分析要求（拖入文件弹窗中填写）分析一篇已编译的 source 页。
     * 产出弹窗摘要 + 完整报告 + 归纳的分析要求 tag（下次拖入时作为可选项复用）。
     * @param provider LLM 提供者配置
     * @param sourceTitle source 页标题
     * @param sourceBody source 页正文（含 ## Summary / Key Points）
     * @param requirement 用户分析要求原文
     * @param contract 知识库行为契约（vault CLAUDE.md），注入后报告行为随之变化
     * @param existingTags 已有分析要求 tag（ANALYSIS_TAGS.md）：新 tag 与已有语义一致时复用其名称
     */
    async customAnalyze(provider, sourceTitle, sourceBody, requirement, contract, existingTags = []) {
        const signal = this.track('custom');
        // 契约注入：与 analyze/ingestSource 同一模板，改 CLAUDE.md → 报告行为随之变化
        const contractRule = contract
            ? `\n\n=== 知识库行为契约（CLAUDE.md，必须遵守）===\n${contract}`
            : '';
        // 已有 tag 模板注入：让归纳的 tag 优先复用既有名称（复用闭环）
        const existingTagsRule = existingTags.length
            ? `\n\n=== 已有分析要求 tag（本次归纳的 tag 与已有语义一致时，必须复用其 tag 名） ===\n${existingTags.map((t) => `- ${t.tag}（${t.template}）`).join('\n')}`
            : '';
        const messages = [
            {
                role: 'system',
                content: `你是知识管理助手。根据用户的分析要求分析给定的来源页，输出严格合法的 JSON 对象（不要 markdown 代码块、不要多余文字）：
{
  "summary": "1-2 句中文，概括本次分析的结论（弹窗摘要展示）",
  "report": "完整的 markdown 分析报告（中文，逐条满足用户要求，结构清晰）",
  "analysisTags": [{"tag": "2-8 字短标签", "template": "一句话可复用的分析要求"}]
}
要求：
- report 不编造内容，所有结论必须来自来源页；引用原文时注明所在章节
- report 若指出该来源与其他知识内容的矛盾，明确标注分歧
- analysisTags 归纳 1-3 个「用户本次分析要求」的短标签与一句话模板，便于下次复用同样的分析方式${existingTagsRule}${contractRule}`
            },
            {
                role: 'user',
                content: `分析要求：${requirement}

来源页标题：${sourceTitle}

来源页内容：${truncate(sourceBody, 6000)}`
            }
        ];
        try {
            const result = await (0, OpenAIClient_1.chatStream)(provider, messages, {
                temperature: 0.3,
                maxTokens: 2000,
                stream: false,
                signal
            });
            assertNotTruncated(result, '定制分析');
            const parsed = parseJsonObject(result.content);
            if (!parsed || typeof parsed !== 'object') {
                throw new Error(`定制分析结果无法解析为 JSON。前 200 字符: ${result.content.slice(0, 200)}`);
            }
            const summary = typeof parsed.summary === 'string' ? String(parsed.summary).trim() : '';
            const report = typeof parsed.report === 'string' ? String(parsed.report).trim() : '';
            if (!summary || !report) {
                throw new Error('定制分析结果缺少 summary/report 字段');
            }
            const analysisTags = Array.isArray(parsed.analysisTags)
                ? parsed.analysisTags
                    .filter((t) => t && typeof t.tag === 'string' && typeof t.template === 'string')
                    .map((t) => ({ tag: t.tag.trim().slice(0, 24), template: t.template.trim() }))
                    .filter((t) => t.tag && t.template)
                    .slice(0, 3)
                : [];
            return { summary, report, analysisTags };
        }
        catch (e) {
            // 如实报错（调用方记 analysisError，编译仍算成功）
            throw e instanceof Error ? e : new Error(`定制分析失败: ${String(e)}`);
        }
        finally {
            this.untrack('custom');
        }
    }
    // === 私有方法 ===
    /**
     * INGEST 分析：对单个原始来源执行编译（LLM Wiki 模式）
     * 一次调用生成 sources 页所需的全部结构化内容，
     * 并要求 LLM 基于已有概念列表做概念名称对齐（matchSlug）
     * @param openQuestions 开放问题列表（来自 QUESTIONS.md，判断本来源是否能回答）
     * @param isPersonal 是否为个人写作（raw/personal/，走个人写作流程）
     * @param contract 知识库行为契约（vault 根 CLAUDE.md 前 MAX_CONTRACT_CHARS 字符，每次摄入重新读盘）
     */
    async ingestSource(provider, rawTitle, rawBody, existingConcepts, openQuestions = [], isPersonal = false, contract = '') {
        const signal = this.track('ingest');
        const conceptList = existingConcepts.length
            ? existingConcepts
                .map((c) => `- slug: ${c.slug} | 中文名: ${c.title} | aliases: ${c.aliases.join(', ') || '无'}`)
                .join('\n')
            : '（暂无已有概念）';
        const questionList = openQuestions.length
            ? openQuestions.map((q) => `- ${q}`).join('\n')
            : '（暂无开放问题）';
        const personalRule = isPersonal
            ? `【个人写作模式】本来源是用户自己写的文章（raw/personal/）：
- summary 简写为核心论点（第一人称视角）
- keyPoints 为文章的主要论点
- 概念 definition 作为「个人立场」表述
- 不参与已有概念的 source_count 计数（但 matchSlug 对齐规则照常）`
            : '';
        const contractRule = contract
            ? `\n\n=== 知识库行为契约（CLAUDE.md，必须遵守）===\n${contract}`
            : '';
        const messages = [
            {
                role: 'system',
                content: `你是一个个人知识库管理员。给定一篇原始来源，你要把它编译成知识库结构。
输出必须是一个严格合法的 JSON 对象（不要 markdown 代码块、不要多余文字），格式：
{
  "slug": "英文小写连字符文件名（如 attention-is-all-you-need，不要中文）",
  "title": "来源的中文标题",
  "summary": "2-4 句中文摘要，概括核心内容",
  "keyPoints": ["3-8 条核心要点，每条一句话"],
  "concepts": [
    {"name": "概念中文名", "nameEn": "概念英文名（若无则省略）", "definition": "一句话定义", "matchSlug": "命中已有概念的 slug（否则省略）"}
  ],
  "entities": [
    {"name": "实体名", "type": "person|tool|institution|paper", "description": "一句话描述", "matchSlug": "命中已有实体的 slug（否则省略）"}
  ],
  "contradictions": ["与知识库已有内容的分歧（若无则省略）"],
  "answeredQuestions": ["本来源能回答的开放问题原文（若下方开放问题列表中有能回答的，复制原问题文本；没有则省略该字段"],
  "language": "来源写作语言代码（zh/en/ja/…，无法判断则省略）",
  "canonicalSource": "若本来源是译文/转述/转载，填原始出处（URL 或标题）；原创来源省略该字段"
}
数量要求：concepts 提取 3-8 个（仅提取文中实际出现的核心概念，不足 3 个时按实际数量）；entities 0-6 个；keyPoints 3-8 条。
${personalRule}
概念对齐规则（重要）：
- 下方提供了知识库中已有概念列表（slug + 中文名 + aliases）
- 提取概念时，若该概念与已有概念的 slug、中文名、aliases 或语义相同 → 在 matchSlug 填入已有概念的 slug，表示"更新已有页"
- 只有确实不存在时才作为新概念（不填 matchSlug）
- 实体同理（知识库已有实体在下方列出时对齐）${contractRule}`
            },
            {
                role: 'user',
                content: `来源标题：${rawTitle}

来源内容：
${truncate(rawBody, 6000)}

=== 知识库已有概念列表 ===
${conceptList}

=== 开放问题列表（判断本来源是否能回答） ===
${questionList}

请编译以上来源，输出 JSON。`
            }
        ];
        try {
            const result = await (0, OpenAIClient_1.chatStream)(provider, messages, {
                temperature: 0.3,
                maxTokens: 4000,
                stream: false,
                signal
            });
            assertNotTruncated(result, 'INGEST 分析');
            const parsed = parseJsonObject(result.content);
            if (!parsed) {
                // 契约 §9：失败必须如实报错，不得静默吞掉（静默空兜底会写出「(无摘要)」的坏页）
                throw new Error(`LLM 输出无法解析为 JSON。前 200 字符: ${result.content.slice(0, 200)}`);
            }
            return sanitizeIngest(parsed);
        }
        catch (e) {
            throw new Error(`INGEST 分析失败: ${e instanceof Error ? e.message : String(e)}`);
        }
        finally {
            this.untrack('ingest');
        }
    }
}
exports.AiPipeline = AiPipeline;
/** 截断文本到指定长度 */
function truncate(text, maxLen) {
    if (text.length <= maxLen)
        return text;
    return text.slice(0, maxLen) + '\n\n...（内容已截断）';
}
/** LLM 输出被 maxTokens 截断时如实报错（契约 §9：失败必须报错，不得静默吞掉） */
function assertNotTruncated(result, label) {
    if (result.finishReason === 'length') {
        throw new Error(`${label}输出被 maxTokens 截断，结果不完整。请调大 maxTokens 后重试`);
    }
}
/** 从 LLM 返回中解析 JSON 对象（直接 parse → ```json 代码块 → 首个 {...}，三级兜底；WorkflowService 等处复用） */
function parseJsonObject(text) {
    if (!text)
        return null;
    // 直接解析
    try {
        const parsed = JSON.parse(text.trim());
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
            return parsed;
    }
    catch { /* continue */ }
    // 提取 ```json ... ``` 代码块
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) {
        try {
            const parsed = JSON.parse(codeBlock[1].trim());
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                return parsed;
        }
        catch { /* continue */ }
    }
    // 提取第一个 {...} 对象
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
        try {
            const parsed = JSON.parse(objMatch[0]);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                return parsed;
        }
        catch { /* fail */ }
    }
    return null;
}
/** 字符串数组清洗（过滤空串） */
function strArr(v) {
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [];
}
/** 清洗并校验 INGEST 分析结果（字段兜底） */
function sanitizeIngest(raw) {
    const str = (v, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
    const concepts = Array.isArray(raw.concepts) ? raw.concepts : [];
    const entities = Array.isArray(raw.entities) ? raw.entities : [];
    return {
        slug: str(raw.slug, 'untitled')
            .toLowerCase()
            .replace(/[^a-z0-9\-\s]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '') || 'untitled',
        title: str(raw.title, '未命名来源'),
        summary: str(raw.summary),
        keyPoints: strArr(raw.keyPoints).slice(0, 8),
        concepts: concepts
            .filter((c) => c && typeof c.name === 'string' && c.name.trim())
            .map((c) => ({
            name: str(c.name),
            nameEn: str(c.nameEn, undefined) || undefined,
            definition: str(c.definition),
            matchSlug: str(c.matchSlug, undefined) || undefined
        }))
            .slice(0, 8),
        entities: entities
            .filter((e) => e && typeof e.name === 'string' && e.name.trim())
            .map((e) => ({
            name: str(e.name),
            type: str(e.type, 'person'),
            description: str(e.description),
            matchSlug: str(e.matchSlug, undefined) || undefined
        }))
            .slice(0, 6),
        contradictions: strArr(raw.contradictions),
        answeredQuestions: strArr(raw.answeredQuestions),
        language: str(raw.language, undefined) || undefined,
        canonicalSource: str(raw.canonicalSource, undefined) || undefined
    };
}
