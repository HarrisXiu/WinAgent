export interface RunResult {
    stdout: string;
    stderr: string;
    code: number;
}
/** 执行一段 PowerShell 脚本，返回输出。用于实现无需原生模块的 Windows 能力。 */
export declare function runPowerShell(script: string, timeoutMs?: number): Promise<RunResult>;
/** 执行任意命令行（cmd），返回输出。 */
export declare function runCmd(command: string, cwd?: string, timeoutMs?: number): Promise<RunResult>;
/** 供 PowerShell 单引号字符串安全插值 */
export declare function psQuote(s: string): string;
