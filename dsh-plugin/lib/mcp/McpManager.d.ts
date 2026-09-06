import type { Tool } from '../tools/types';
export declare class McpManager {
    private transports;
    load(mcpConfigPath: string): Promise<Tool[]>;
    dispose(): void;
}
