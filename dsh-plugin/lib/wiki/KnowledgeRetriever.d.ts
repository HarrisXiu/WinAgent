import type { ConfigStore } from '../config/ConfigStore';
import type { SearchIndex } from './SearchIndex';
import type { VaultManager } from './VaultManager';
import type { KnowledgeContext, KnowledgeReference } from '../shared/types';
import { WorkspaceStore } from './WorkspaceStore';
export interface KnowledgeInjection {
    text: string;
    count: number;
    references: KnowledgeReference[];
}
export declare const KNOWLEDGE_MARK = "\u3010\u77E5\u8BC6\u5E93\u68C0\u7D22";
export declare function rankChunks<T extends {
    text: string;
}>(query: string, chunks: T[]): T[];
export declare class KnowledgeRetriever {
    private vault;
    private search;
    private store;
    private workspace?;
    constructor(vault: VaultManager, search: SearchIndex, store: ConfigStore, workspace?: WorkspaceStore);
    retrieve(userInput: string, context?: KnowledgeContext): Promise<KnowledgeInjection | null>;
}
