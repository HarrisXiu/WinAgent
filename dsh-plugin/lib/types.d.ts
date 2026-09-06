import { promises as fs } from 'fs';
import path from 'path';
/** LLM function-calling 工具 schema（OpenAI 格式） */
export interface ToolSchema {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description?: string;
            items?: any;
        }>;
        required?: string[];
    };
}
/** 工具条目：schema + 执行器 */
export interface Tool {
    schema: ToolSchema;
    /** 危险操作（写入/删除/移动等），宿主可据此做二次确认 */
    dangerous?: boolean;
    /** 所属模块，用于分组展示（'file' | 'docx'） */
    module?: string;
    run(args: Record<string, any>): Promise<string>;
}
/** 工具信息（列表展示用） */
export interface ToolInfo {
    name: string;
    description: string;
    dangerous: boolean;
    module: string;
}
export declare function str(v: unknown, def?: string): string;
export declare function num(v: unknown, def?: number): number;
export declare function bool(v: unknown, def?: boolean): boolean;
/** 简易工具注册表 */
export declare class ToolRegistry {
    private tools;
    register(tools: Tool[]): void;
    get(name: string): Tool | undefined;
    list(): Tool[];
    getInfos(): ToolInfo[];
    getSchemas(): ToolSchema[];
    execute(name: string, args: Record<string, any>): Promise<string>;
}
export { fs, path };
