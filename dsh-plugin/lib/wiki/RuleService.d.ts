import type { ProviderConfig, RuleSet, RuleTask, TaskRuleReport } from '../shared/types';
import { WorkspaceStore } from './WorkspaceStore';
import type { VaultManager } from './VaultManager';
export declare function taskIntent(text: string): RuleTask | 'read' | 'continue' | 'other';
export declare function rulesPrompt(sets: RuleSet[]): string;
export declare class RuleService {
    private workspace;
    private vault;
    constructor(workspace: WorkspaceStore, vault: VaultManager);
    compile(provider: ProviderConfig, sourcePath: string, task: RuleTask, keywords?: string[], signal?: AbortSignal): Promise<RuleSet>;
    toggle(id: string, enabled: boolean): Promise<void>;
    resolve(text: string, previous?: RuleSet[], topicTag?: string): Promise<RuleSet[]>;
    recordTask(input: string, sets: RuleSet[]): Promise<void>;
    validate(provider: ProviderConfig, sets: RuleSet[], output: string, hasArtifacts: boolean, signal?: AbortSignal): Promise<TaskRuleReport>;
}
