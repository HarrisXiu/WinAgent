import type { ProviderConfig, IngestAnalysis, KnowledgeSection, SourceChunk } from '../shared/types';
import { WorkspaceStore } from './WorkspaceStore';
export declare function parseObject(text: string): any;
export declare function analyzeDetailed(provider: ProviderConfig, title: string, text: string, options?: {
    signal?: AbortSignal;
    workspace?: WorkspaceStore;
    force?: boolean;
    onProgress?: (completed: number, total: number) => void | Promise<void>;
}): Promise<IngestAnalysis>;
export declare function sectionsMarkdown(sections: KnowledgeSection[], chunks: SourceChunk[]): string;
