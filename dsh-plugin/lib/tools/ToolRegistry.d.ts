import type { AppConfig, ToolInfo, ToolSchema, ToolSource } from '../shared/types';
import type { Tool } from './types';
export declare class ToolRegistry {
    private tools;
    private wikiTools;
    private mcp;
    private addAll;
    /** 注册知识库工具（在 initialize 前调用，工具将在下次 initialize 时生效） */
    setWikiTools(tools: Tool[]): void;
    initialize(cfg: AppConfig): Promise<void>;
    /** 分别加载 skills 与 mcp（传入已解析的绝对路径） */
    loadExternal(skillsDirAbs: string, mcpConfigAbs: string): Promise<void>;
    getSchemas(): ToolSchema[];
    getInfos(): ToolInfo[];
    getSource(name: string): ToolSource;
    isDangerous(name: string): boolean;
    execute(name: string, args: Record<string, any>): Promise<{
        ok: boolean;
        result: string;
    }>;
    dispose(): void;
}
