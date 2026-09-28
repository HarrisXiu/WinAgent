import type { KnowledgeSource, SourceChunk, WikiJob, RuleSet, TaskRuleReport } from '../shared/types';
export declare const digest: (text: string | Buffer) => string;
/** Lossless splitting: every character belongs to a chunk; anchors refer to extracted text lines. */
export declare function splitSource(text: string, budget?: number): SourceChunk[];
/** One atomic file per record, in the vault so backups and vault switching include state. */
export declare class WorkspaceStore {
    private root;
    constructor(root: () => string);
    private file;
    read<T>(kind: string, id: string): Promise<T | null>;
    write<T>(kind: string, id: string, value: T): Promise<void>;
    remove(kind: string, id: string): Promise<void>;
    list<T>(kind: string): Promise<T[]>;
    sources(): Promise<KnowledgeSource[]>;
    rules(): Promise<RuleSet[]>;
    jobs(): Promise<WikiJob[]>;
    recover(): Promise<void>;
    saveReport(report: TaskRuleReport): Promise<void>;
}
