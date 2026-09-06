import type { ToolSchema } from '../shared/types';
export interface Tool {
    schema: ToolSchema;
    /** 是否为危险操作（删除/写注册表/结束进程/执行命令/模拟输入等），触发二次确认 */
    dangerous?: boolean;
    run(args: Record<string, any>): Promise<string>;
}
export declare function str(v: unknown, def?: string): string;
export declare function num(v: unknown, def?: number): number;
export declare function bool(v: unknown, def?: boolean): boolean;
