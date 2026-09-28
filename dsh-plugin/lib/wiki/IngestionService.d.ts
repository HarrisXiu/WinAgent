import type { ConfigStore } from '../config/ConfigStore';
import type { VaultManager } from './VaultManager';
import type { SearchIndex } from './SearchIndex';
import type { IngestProgress, IngestResult, KnowledgeSource } from '../shared/types';
import { WorkspaceStore } from './WorkspaceStore';
export declare class IngestionService {
    private workspace;
    private vault;
    private search;
    private store;
    private extract;
    private progress;
    private changed;
    private running;
    constructor(workspace: WorkspaceStore, vault: VaultManager, search: SearchIndex, store: ConfigStore, extract: (file: string, format: string) => Promise<string>, progress: (p: IngestProgress) => void, changed: (p: string) => void);
    cancel(id?: string): void;
    get active(): boolean;
    index(source: KnowledgeSource): void;
    run(rawPath: string, force?: boolean): Promise<IngestResult>;
    private process;
}
