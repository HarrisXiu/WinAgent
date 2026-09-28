import type { SavedConversation, ConversationSummary } from '../shared/types';
export declare class ConversationStore {
    private root;
    constructor(root: string);
    private file;
    list(): Promise<ConversationSummary[]>;
    read(id: string): Promise<SavedConversation>;
    write(record: SavedConversation): Promise<void>;
}
