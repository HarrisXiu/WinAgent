import type { NoteMeta, NoteContent, NoteData, NoteAnnotation, NoteRelation, TagWithCount, AnalysisTag } from '../shared/types';
export interface VaultChangeEvent {
    type: 'created' | 'modified' | 'deleted';
    path: string;
}
type ChangeCallback = (event: VaultChangeEvent) => void;
/** LLM Wiki 分层目录结构（raw 人类所有 / wiki LLM 编译层 / outputs 输出） */
export declare const RAW_SUBDIRS: string[];
export declare const WIKI_SUBDIRS: string[];
export declare const SYSTEM_FILES: string[];
/** INGEST 管线可处理的文件扩展名（与 runIngest 中的分类一致） */
export declare const INGESTIBLE_EXTS: string[];
export declare class VaultManager {
    private vaultPath;
    private notesDir;
    private attachmentsDir;
    private rawDir;
    private wikiDir;
    private outputsDir;
    private changeCallbacks;
    private watcher;
    constructor(vaultPath: string);
    getVaultPath(): string;
    getRawDir(): string;
    getWikiDir(): string;
    initialize(): Promise<void>;
    /** 判断是否为系统文件（index/log/overview/QUESTIONS/CLAUDE.md，不参与图谱） */
    isSystemFile(relPath: string): boolean;
    /** 追加一个开放问题到 wiki/QUESTIONS.md */
    addQuestion(question: string): Promise<void>;
    /** 读取 QUESTIONS.md 中的开放问题列表 */
    getOpenQuestions(): Promise<string[]>;
    /** 将开放问题移入 Answered（INGEST 匹配到答案时） */
    answerQuestion(question: string): Promise<void>;
    /** 读取分析要求 Tag 列表（wiki/ANALYSIS_TAGS.md 的 Tags 段，逐行 `- 标签 | 模板`） */
    getAnalysisTags(): Promise<AnalysisTag[]>;
    /** 合并写入分析要求 Tag（按 tag 字符串去重），返回合并后全量 */
    addAnalysisTags(tags: AnalysisTag[]): Promise<AnalysisTag[]>;
    /** 把定制分析报告追加到 source 页正文末尾（## Custom Analysis 区块），frontmatter 记录要求与时间 */
    appendCustomAnalysis(sourceRelPath: string, requirement: string, report: string): Promise<void>;
    /** 更新 wiki/overview.md 的 Health Dashboard */
    updateOverview(stats: Record<string, number | string>): Promise<void>;
    /** 判断文件是否属于 raw 层（只读区） */
    isRawPath(relPath: string): boolean;
    /** 追加一行操作日志到 wiki/log.md */
    appendLog(entry: string): Promise<void>;
    /** 重建 wiki/index.md 的列表段（Sources/Concepts/Entities） */
    updateIndex(sources: Array<{
        slug: string;
        title: string;
    }>, concepts: Array<{
        slug: string;
        title: string;
    }>, entities: Array<{
        slug: string;
        title: string;
    }>): Promise<void>;
    private ensureSystemFiles;
    /** 创建页面模板（LLM Wiki 模式标准结构） */
    private ensureTemplates;
    setVaultPath(newPath: string): Promise<void>;
    onChange(cb: ChangeCallback): () => void;
    private emit;
    private startWatching;
    private stopWatching;
    /** 递归列出目录中所有 .md 文件，构建树形结构（单个目录读取失败不影响整体） */
    listNotes(dir?: string): Promise<NoteMeta[]>;
    /** 列出 raw/ 目录下所有可摄入的文件（不限 .md），返回相对路径列表 */
    listRawFiles(): Promise<string[]>;
    /** 解析笔记中所有的 [[wiki links]] */
    parseWikiLinks(body: string): string[];
    /** 读取笔记完整内容 */
    readNote(relPath: string): Promise<NoteContent>;
    /** 写入（创建/更新）笔记 */
    writeNote(relPath: string, data: NoteData): Promise<void>;
    /** 文档维护规则：CLAUDE.md 每次修订时同步 USER_GUIDE.md 变更记录 */
    private syncContractChangelog;
    deleteNote(relPath: string): Promise<void>;
    /** 创建新笔记（空模板），标题自动 sanitize 防止路径嵌套 */
    createNote(relPath: string, title: string): Promise<void>;
    /** 解析 [[wiki link]] 为实际文件路径 */
    resolveLink(fromPath: string, linkTarget: string): string | null;
    /** 查找引用某个笔记的所有笔记（反向链接） */
    getBacklinks(targetPath: string): Promise<Array<{
        path: string;
        title: string;
    }>>;
    /** 获取所有标签及其计数 */
    getAllTags(): Promise<TagWithCount[]>;
    /** 按标签筛选笔记 */
    getNotesByTag(tag: string): Promise<NoteMeta[]>;
    /** 导入外部文件到 vault（LLM Wiki 模式：按类型路由到 raw/ 子目录） */
    importFile(sourcePath: string, targetDir?: string): Promise<string>;
    /** 列出附件 */
    listAttachments(subDir?: string): Promise<string[]>;
    /** 更新笔记的 AI 分析结果（tags 合并；摘要/关系/分析时间写入 frontmatter，刷新后保留） */
    updateAiResults(relPath: string, aiSummary?: string, aiTags?: string[], aiRelations?: NoteRelation[]): Promise<void>;
    /** 添加注释到笔记 */
    addAnnotation(relPath: string, text: string, range: string): Promise<NoteAnnotation>;
    /** 删除注释 */
    removeAnnotation(relPath: string, annotationId: string): Promise<void>;
    dispose(): void;
    private fileExists;
    private flattenNotes;
}
export {};
