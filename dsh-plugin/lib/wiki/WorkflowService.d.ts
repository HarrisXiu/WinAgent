import type { VaultManager } from './VaultManager';
import type { SearchIndex } from './SearchIndex';
import type { ConfigStore } from '../config/ConfigStore';
import type { WorkflowResult } from '../shared/types';
/** LINT 结果（UI 需要结构化 issues 与重新摄入列表） */
export interface LintWorkflowResult extends WorkflowResult {
    /** 全部问题行（含检查编号） */
    issues: string[];
    /** 检查 6 SHA-256 变化的 raw 文件路径（UI 提供「重新摄入」按钮） */
    modifiedRawFiles: string[];
}
export declare function runLint(vm: VaultManager): Promise<LintWorkflowResult>;
/** Jaccard 相似度（字符集合） */
export declare function jaccard(a: string, b: string): number;
export declare function runMerge(vm: VaultManager, keep: string, remove: string, area: string): Promise<WorkflowResult>;
export declare function runReflect(vm: VaultManager, store: ConfigStore, signal?: AbortSignal): Promise<WorkflowResult>;
/** Stage 0 反向检验：核验每个 source 页的 raw_file 存在性 + SHA-256 一致 + possibly_outdated */
export declare function runStage0Check(vm: VaultManager): Promise<Array<{
    path: string;
    status: 'ok' | 'raw-missing' | 'sha-mismatch' | 'outdated';
    reason: string;
}>>;
export declare function runQuery(vm: VaultManager, searchIndex: SearchIndex, store: ConfigStore, query: string, signal?: AbortSignal): Promise<WorkflowResult>;
