export type ProviderType = 'openai' | 'ollama';
export interface ProviderConfig {
    id: string;
    label: string;
    type: ProviderType;
    /** OpenAI 类型请含 /v1，例如 https://api.openai.com/v1；Ollama 类型填 http://localhost:11434 */
    baseUrl: string;
    apiKey: string;
    model: string;
    /** 是否支持图片识别（vision）：undefined=自动检测，true/false=用户显式指定 */
    supportsVision?: boolean;
    /** 是否支持文件直传（PDF 等 document 输入）：undefined=自动尝试（失败自动降级工具读取），true=强制，false=禁用 */
    supportsFiles?: boolean;
}
/**
 * 视觉辅助：主模型不支持图片识别时，先调用另一个视觉模型描述图片，
 * 再把描述文本交给主模型继续完成任务。
 */
export interface VisionAssistConfig {
    /** 是否启用 */
    enabled: boolean;
    /**
     * 用作视觉识别的 provider id。
     * 留空表示「与主模型同一 API」，复用当前 provider 的 baseUrl / apiKey，仅换模型名。
     */
    providerId: string;
    /**
     * 视觉模型名。同一 API 双模型时必填；
     * 选了其他 provider 时留空则用该 provider 自己的模型。
     */
    model: string;
    /** 给视觉模型的指令，留空用内置默认值 */
    prompt: string;
}
/**
 * 深度思考（推理）开关。
 * auto=不下发任何思考参数，由模型自己决定；on/off=显式要求开启或关闭。
 * 若目标 API 不认识该参数，客户端会自动去掉参数重试一次。
 */
export type ThinkingMode = 'auto' | 'on' | 'off';
/**
 * 对话模式：已合并为单一桌宠模式（安洁莉娜人设 + 完整 Agent 工具能力）
 * 保留字段兼容旧配置
 */
export type ChatMode = 'pet';
/** 主题模式：light=浅色 / dark=深色 / auto=跟随 Windows 亮暗 */
export type ThemeMode = 'light' | 'dark' | 'auto';
/** 主题配置：用户自定义主色，其余色阶由 colord 自动推导 */
export interface ThemeConfig {
    mode: ThemeMode;
    /** 主色 accent（hex，如 #f4719c） */
    accent: string;
    /** 辅色 accent2（hex，如 #6db7d9） */
    accent2: string;
}
/** 自动 RAG 注入配置：每轮提问自动检索知识库并把结果注入上下文 */
export interface KnowledgeRagConfig {
    enabled: boolean;
    /** 每次注入的最大条数 */
    topK: number;
    /** 注入的相关度阈值（归一化 0~1），低于该值的结果不注入 */
    minScore: number;
}
export interface AppConfig {
    activeProviderId: string;
    providers: ProviderConfig[];
    temperature: number;
    maxTokens: number;
    /** @deprecated 旧版字段，仅兼容旧 config.json；运行时使用 petPrompt，load 时一次性迁移后置空 */
    systemPrompt?: string;
    /** 危险工具是否自动放行（不弹确认） */
    autoApproveTools: boolean;
    /** 历史 token 超过该值触发上下文压缩 */
    compactThresholdTokens: number;
    /** 压缩时保留最近轮数 */
    keepRecentTurns: number;
    /** skills 目录（相对应用根或绝对路径） */
    skillsDir: string;
    /** mcp 配置文件路径 */
    mcpConfigPath: string;
    /** 视觉辅助：纯语言主模型 + 外部视觉模型协作 */
    visionAssist: VisionAssistConfig;
    /** 是否使用流式输出（关闭后一次性返回完整回复） */
    stream: boolean;
    /** 深度思考开关 */
    thinkingMode: ThinkingMode;
    /** @deprecated 旧版字段（对话模式已合并进 petPrompt），仅兼容旧 config.json，运行时不读取 */
    chatMode?: ChatMode;
    /** 人设提示词（纯人设，不含工具/规则；规则由系统动态拼接） */
    petPrompt: string;
    /** Wiki 个人知识库 Vault 路径（默认相对于 dataDir） */
    vaultPath: string;
    /** 自动 RAG 注入（每轮提问检索知识库并注入结果） */
    knowledgeRag: KnowledgeRagConfig;
    /** 主题配置（模式 + 自定义主色，色阶自动推导） */
    theme: ThemeConfig;
}
export interface ToolParameter {
    type: string;
    description?: string;
    [k: string]: unknown;
}
export interface ToolSchema {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, ToolParameter>;
        required?: string[];
    };
}
/** 单次请求的 token 用量 */
export interface TokenUsage {
    prompt: number;
    completion: number;
    total: number;
    /** true = 接口未返回 usage，由本地估算得出 */
    estimated: boolean;
}
export type ToolSource = 'builtin' | 'skill' | 'mcp';
export interface ToolCall {
    id: string;
    name: string;
    arguments: string;
}
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | Array<{
        type: 'text';
        text: string;
    } | {
        type: 'image_url';
        image_url: {
            url: string;
        };
    } | {
        type: 'file';
        file: {
            filename: string;
            file_data: string;
        };
    }>;
    reasoning_content?: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    name?: string;
}
export type AgentEvent = {
    type: 'round';
    round: number;
    historyCount: number;
} | {
    type: 'assistant_delta';
    text: string;
} | {
    type: 'reasoning_delta';
    text: string;
} | {
    type: 'assistant_message';
    content: string;
    reasoning?: string;
} | {
    type: 'tool_call';
    id: string;
    name: string;
    args: string;
    source: ToolSource;
} | {
    type: 'tool_result';
    id: string;
    name: string;
    result: string;
    ok: boolean;
} | {
    type: 'compact';
    before: number;
    after: number;
} | {
    type: 'vision';
    status: 'start' | 'done' | 'error';
    model: string;
    text?: string;
}
/** 自动 RAG：本轮提问已检索知识库（count=0 表示未命中） */
 | {
    type: 'knowledge';
    query: string;
    count: number;
} | {
    type: 'usage';
    last: TokenUsage;
    session: TokenUsage;
} | {
    type: 'error';
    message: string;
} | {
    type: 'done';
};
export interface ToolInfo {
    name: string;
    description: string;
    source: ToolSource;
    dangerous: boolean;
}
export interface ModelInfo {
    id: string;
}
/** 笔记元数据（轻量，不含正文） */
export interface NoteMeta {
    path: string;
    title: string;
    tags: string[];
    created: string;
    updated: string;
    kind: 'file' | 'folder';
    children?: NoteMeta[];
}
/** 笔记注释/批注 */
export interface NoteAnnotation {
    id: string;
    text: string;
    range: string;
    created: string;
}
/** AI 关系发现结果：target 为可跳转的笔记 relPath（如 wiki/concepts/xxx.md），title 为显示标题 */
export interface NoteRelation {
    target: string;
    reason: string;
    title?: string;
}
/** 笔记完整内容 */
export interface NoteContent extends NoteMeta {
    rawBody: string;
    links: string[];
    aiSummary?: string;
    aiAnalyzedAt?: string;
    aiRelations?: NoteRelation[];
    annotations?: NoteAnnotation[];
    /** frontmatter graph-excluded 标记（系统文件不参与图谱） */
    graphExcluded?: boolean;
    /** frontmatter raw_file 字段（source/personal-writing 页指向的原始文件 relPath，双栏对照用） */
    rawFile?: string;
    /** frontmatter confidence（concept/synthesis 页：low/medium/high），检索与 RAG 注入分层表述用 */
    confidence?: string;
    /** frontmatter source_count（concept 页：来源计数） */
    sourceCount?: number;
    /** frontmatter aliases（中文名/英文名别名列表），检索兜底与 RAG 注入用 */
    aliases?: string[];
    /** frontmatter entity_type（entity 页：person/tool/institution/paper） */
    entityType?: string;
}
/** 写入笔记的数据 */
export interface NoteData {
    title: string;
    tags: string[];
    body: string;
    /** AI 分析结果（可选）：写入 frontmatter，未传时保留旧值 */
    aiSummary?: string;
    aiRelations?: NoteRelation[];
    aiAnalyzedAt?: string;
}
/** 图谱节点 */
export interface GraphNode {
    id: string;
    label: string;
    tags: string[];
    degree: number;
    strength: number;
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
}
/** 图谱边 */
export interface GraphEdge {
    source: string;
    target: string;
    type: 'link' | 'tag' | 'ai';
    weight: number;
}
/** 图谱数据 */
export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
}
/** 搜索结果 */
export interface SearchResult {
    path: string;
    title: string;
    snippet: string;
    /** 归一化相关度（0~1，IDF 加权），跨查询可比 */
    score: number;
    /** AI 摘要（索引时传入，检索时随结果返回，便于直接回答） */
    summary?: string;
    /** frontmatter confidence（concept/synthesis 页），按置信度分层表述用 */
    confidence?: string;
    /** frontmatter source_count（concept 页） */
    sourceCount?: number;
}
/** 标签及计数 */
export interface TagWithCount {
    tag: string;
    count: number;
}
/** AI 分析建议 */
export interface AISuggestion {
    tags?: string[];
    summary?: string;
    relations?: NoteRelation[];
    /** 质量审查建议：0-3 条可执行改进（stub 提示 / 缺失溯源 wikilink / 可回答的开放问题等） */
    suggestions?: string[];
}
/** INGEST 单次 LLM 分析结果（LLM Wiki 编译模式） */
export interface IngestConcept {
    name: string;
    nameEn?: string;
    definition: string;
    matchSlug?: string;
}
export interface IngestEntity {
    name: string;
    type: string;
    description: string;
    matchSlug?: string;
}
export interface IngestAnalysis {
    slug: string;
    title: string;
    summary: string;
    keyPoints: string[];
    concepts: IngestConcept[];
    entities: IngestEntity[];
    contradictions?: string[];
    answeredQuestions?: string[];
    /** 来源写作语言（如 zh / en），用于跨语言合并检测 */
    language?: string;
    /** 若本来源是译文/转述，填原始出处（URL 或标题）；原创来源省略 */
    canonicalSource?: string;
}
/** INGEST 完成后的结果（返回前端展示） */
export interface IngestResult {
    sourcePath: string;
    conceptPaths: string[];
    entityPaths: string[];
    created: string[];
    updated: string[];
    logEntry: string;
    /** 达到 5+ 来源且非 high 的概念（等待用户确认晋升） */
    confirmHigh?: Array<{
        slug: string;
        title: string;
        sourceCount: number;
    }>;
    /** 本来源回答了的开放问题 */
    answeredQuestions?: string[];
}
/** 批量摄入：首篇编译完成后的暂停态（交互式标定） */
export interface BatchIngestStartResult {
    /** 第一批原始文件 relPath（双栏对照用） */
    rawFile: string;
    first: IngestResult;
    /** 批量总数（含已编译的首篇） */
    total: number;
}
/** 批量摄入：剩余文件全部编译完成后的汇总 */
export interface BatchIngestDoneResult {
    results: IngestResult[];
    errors: Array<{
        path: string;
        error: string;
    }>;
    /** 聚合的待确认 high 概念（按 slug 去重） */
    confirmHigh: Array<{
        slug: string;
        title: string;
        sourceCount: number;
    }>;
    /** true = 用户中途 abort，results/errors 不完整 */
    aborted?: boolean;
}
/** 分析要求 Tag（用户拖入文件时选择/输入的分析要求，AI 归纳后持久化复用） */
export interface AnalysisTag {
    /** 短标签（chip 展示，2-8 字） */
    tag: string;
    /** 一句话可复用分析要求（选中后填入弹窗输入框） */
    template: string;
}
/** 定制分析输出（AiPipeline.customAnalyze） */
export interface CustomAnalysisOutput {
    /** 弹窗摘要展示（1-2 句） */
    summary: string;
    /** 完整 markdown 报告，追加到 source 页正文 */
    report: string;
    /** AI 归纳的分析要求 tag（1-3 个） */
    analysisTags: AnalysisTag[];
}
/** 拖入分析流程：单文件结果 */
export interface ImportAnalyzeFileResult {
    name: string;
    relPath?: string;
    sourcePath?: string;
    ingestError?: string;
    analysisError?: string;
    analysis?: CustomAnalysisOutput;
}
/** 拖入分析流程：汇总结果（返回前端弹窗展示） */
export interface ImportAnalyzeResult {
    files: ImportAnalyzeFileResult[];
    /** 本次真正新增的分析 tag（弹窗展示用） */
    newTags: AnalysisTag[];
    /** 聚合的待确认 high 概念（按 slug 去重） */
    confirmHigh: Array<{
        slug: string;
        title: string;
        sourceCount: number;
    }>;
}
/** 工作流（LINT/REFLECT/MERGE/QUERY）统一返回 */
export interface WorkflowResult {
    ok: boolean;
    /** 报告页 relPath（渲染层在编辑器中打开它） */
    reportPath: string;
    summary: string;
    error?: string;
}
/** LINT 结果（UI 需要结构化 issues 与重新摄入列表） */
export interface LintWorkflowResult extends WorkflowResult {
    /** 全部问题行（含检查编号） */
    issues: string[];
    /** 检查 6 SHA-256 变化的 raw 文件路径（UI 提供「重新摄入」按钮） */
    modifiedRawFiles: string[];
}
/** INGEST 进度事件（主进程 → 渲染进程） */
export interface IngestProgress {
    file: string;
    stage: string;
    percent: number;
    done?: boolean;
    error?: string;
}
/** Vault 文件变更事件（主→渲染推送） */
export type VaultChangeEvent = {
    type: 'created';
    path: string;
} | {
    type: 'modified';
    path: string;
} | {
    type: 'deleted';
    path: string;
};
