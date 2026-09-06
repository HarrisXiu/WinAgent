import { EventBus } from '../event-bus';
import type { ConfigStore } from '../config/ConfigStore';
import { VaultManager } from './VaultManager';
import { SearchIndex } from './SearchIndex';
import { GraphEngine } from './GraphEngine';
import { AiPipeline } from './AiPipeline';
import type { AISuggestion, AnalysisTag, BatchIngestDoneResult, BatchIngestStartResult, GraphData, ImportAnalyzeResult, IngestResult, NoteContent, NoteData, NoteMeta, SearchResult, TagWithCount, WorkflowResult, LintWorkflowResult, NoteAnnotation } from '../shared/types';
/** 扁平化笔记树 */
export declare function flattenWikiNotes(notes: NoteMeta[]): NoteMeta[];
export declare class WikiHost {
    private store;
    private bus;
    vault: VaultManager;
    search: SearchIndex;
    graph: GraphEngine;
    pipeline: AiPipeline;
    private batchSession;
    private autoIngestQueue;
    private recentIngests;
    /** 进行中的 REFLECT/QUERY 工作流取消器（workflowCancel 用） */
    private workflowAbort;
    constructor(store: ConfigStore, bus: EventBus);
    init(): Promise<void>;
    dispose(): void;
    /** 后台索引 wiki 层笔记（raw 层不索引） */
    indexWikiVault(): Promise<void>;
    /** 从 VaultManager 收集笔记并重建图谱（只含 wiki/ 层，排除 graph-excluded） */
    rebuildGraph(): Promise<void>;
    private indexOne;
    /** 按读取结果建索引：附带 frontmatter 的 aliases/confidence/source_count（检索分层与 RAG 用） */
    private indexFromContent;
    listNotes(): Promise<NoteMeta[]>;
    readNote(relPath: string): Promise<NoteContent>;
    writeNote(relPath: string, data: NoteData): Promise<void>;
    deleteNote(relPath: string): Promise<void>;
    createNote(relPath: string, title: string): Promise<void>;
    getBacklinks(targetPath: string): Promise<Array<{
        path: string;
        title: string;
    }>>;
    getAllTags(): Promise<TagWithCount[]>;
    getNotesByTag(tag: string): Promise<NoteMeta[]>;
    searchNotes(query: string, limit?: number): SearchResult[];
    getGraphData(): GraphData;
    getGraphNode(nodeId: string): GraphData;
    aiAnalyze(relPath: string): Promise<AISuggestion>;
    aiCancel(): void;
    private emitIngestProgress;
    private emitCustomProgress;
    private scheduleAutoIngest;
    listWikiPages(dir: string): Promise<Array<{
        slug: string;
        title: string;
    }>>;
    listConceptSlugs(): Promise<Array<{
        slug: string;
        title: string;
        aliases: string[];
    }>>;
    /** 执行一次 INGEST（LLM Wiki 编译）：raw 文件 → sources/concepts/entities 页 */
    runIngest(rawRelPath: string): Promise<IngestResult>;
    ingestBatchStart(paths: string[]): Promise<BatchIngestStartResult>;
    ingestBatchContinue(): Promise<BatchIngestDoneResult>;
    ingestBatchAbort(): Promise<{
        ok: boolean;
    }>;
    private listCompiledRawFiles;
    workflowLint(): Promise<LintWorkflowResult>;
    workflowReflect(): Promise<WorkflowResult>;
    /** 取消进行中的 REFLECT/QUERY 工作流（LLM 请求一并中止） */
    workflowCancel(): void;
    workflowMerge(keep: string, remove: string, area: string): Promise<WorkflowResult>;
    workflowQuery(query: string): Promise<WorkflowResult>;
    importUrl(url: string): Promise<{
        ok: boolean;
        relPath?: string;
        sourcePath?: string;
        error?: string;
    }>;
    importFile(srcPath: string, targetDir?: string): Promise<string>;
    importAnalyze(filePaths: string[], requirement: string): Promise<ImportAnalyzeResult>;
    /** 浏览器上传：写入 raw/uploaded/<name> 并立即 INGEST（可选定制分析） */
    uploadAndIngest(name: string, buf: Buffer, requirement: string): Promise<ImportAnalyzeResult>;
    conceptConfirm(slug: string, area: 'concepts' | 'entities'): Promise<{
        ok: boolean;
        error?: string;
    }>;
    getAnalysisTags(): Promise<AnalysisTag[]>;
    addAnalysisTags(tags: AnalysisTag[]): Promise<AnalysisTag[]>;
    listAttachments(subDir?: string): Promise<string[]>;
    addAnnotation(relPath: string, text: string, range: string): Promise<NoteAnnotation>;
    removeAnnotation(relPath: string, annotationId: string): Promise<void>;
    getVaultPath(): string;
    setVaultPath(p: string): Promise<void>;
}
