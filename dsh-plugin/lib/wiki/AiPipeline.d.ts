import type { ProviderConfig, IngestAnalysis, NoteRelation, CustomAnalysisOutput } from '../shared/types';
export interface AiAnalysisResult {
    tags: string[];
    summary: string;
    relations: NoteRelation[];
    /** 质量审查建议（0-3 条可执行改进，不落盘，随分析即时返回） */
    suggestions: string[];
}
/** 已有概念页的轻量信息（用于概念名称对齐） */
export interface ExistingConceptInfo {
    slug: string;
    title: string;
    aliases: string[];
}
/** 知识库候选笔记（关系发现用）：path 为可跳转的 relPath，title 为显示标题 */
export interface CandidateNote {
    path: string;
    title: string;
}
/** 笔记类型：按类型注入定制审查规则 */
export type NoteType = 'source' | 'concept' | 'entity' | 'raw' | 'note';
export interface AnalyzeOptions {
    /** 页面类型（由调用方按 relPath 判断），决定 prompt 中的定制规则 */
    noteType?: NoteType;
    /** 知识库行为契约（vault CLAUDE.md 的相关小节）：注入后「改契约 → AI 分析行为随之变化」闭环成立 */
    contract?: string;
    /** 开放问题列表（QUESTIONS.md）：判断本笔记能否回答，能回答的原样复制进 suggestions */
    openQuestions?: string[];
    /** 笔记 frontmatter 关键标量（entity_type/confidence/source_count 等）：模型据此检查字段合理性 */
    frontmatter?: Record<string, unknown>;
}
/**
 * AI 分析管道
 * 复用现有 LLM 客户端，对笔记进行标签、摘要、关系发现与质量审查
 */
export declare class AiPipeline {
    /**
     * 进行中的操作 → 独立 AbortController。
     * analyze / custom / ingest 各占一个 key，并发互不覆盖。
     */
    private controllers;
    /** 取消全部进行中的 AI 操作（analyze/custom/ingest 一网打尽，供用户主动中止） */
    cancel(): void;
    /** 注册一个新操作并返回其 signal；同 key 已有进行中的请求先取消（防连点） */
    private track;
    private untrack;
    /**
     * 对单篇笔记执行完整分析（标签 + 摘要 + 关系发现 + 质量审查建议）。
     * 单次 LLM 调用同时产出全部内容（共享上下文，省 2/3 token 与延迟）。
     * @param provider LLM 提供者配置
     * @param title 笔记标题
     * @param body 笔记正文（markdown）
     * @param candidates 知识库中其他笔记（path + title），关系发现的 target 直接映射为可跳转路径
     * @param opts 可选：契约注入 / 页面类型定制 / 开放问题列表
     */
    analyze(provider: ProviderConfig, title: string, body: string, candidates: CandidateNote[], opts?: AnalyzeOptions): Promise<AiAnalysisResult>;
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
    customAnalyze(provider: ProviderConfig, sourceTitle: string, sourceBody: string, requirement: string, contract: string, existingTags?: Array<{
        tag: string;
        template: string;
    }>): Promise<CustomAnalysisOutput>;
    /**
     * INGEST 分析：对单个原始来源执行编译（LLM Wiki 模式）
     * 一次调用生成 sources 页所需的全部结构化内容，
     * 并要求 LLM 基于已有概念列表做概念名称对齐（matchSlug）
     * @param openQuestions 开放问题列表（来自 QUESTIONS.md，判断本来源是否能回答）
     * @param isPersonal 是否为个人写作（raw/personal/，走个人写作流程）
     * @param contract 知识库行为契约（vault 根 CLAUDE.md 前 MAX_CONTRACT_CHARS 字符，每次摄入重新读盘）
     */
    ingestSource(provider: ProviderConfig, rawTitle: string, rawBody: string, existingConcepts: ExistingConceptInfo[], openQuestions?: string[], isPersonal?: boolean, contract?: string): Promise<IngestAnalysis>;
}
/** 从 LLM 返回中解析 JSON 对象（直接 parse → ```json 代码块 → 首个 {...}，三级兜底；WorkflowService 等处复用） */
export declare function parseJsonObject(text: string): any | null;
