import type { Tool } from './types';
import type { VaultManager } from '../wiki/VaultManager';
import type { SearchIndex } from '../wiki/SearchIndex';
import type { ConfigStore } from '../config/ConfigStore';
export declare function createWikiTools(vaultManager: VaultManager, searchIndex: SearchIndex, store: ConfigStore): Tool[];
