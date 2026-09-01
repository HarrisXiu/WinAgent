"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPowerShell = runPowerShell;
exports.runCmd = runCmd;
exports.psQuote = psQuote;
const child_process_1 = require("child_process");
/** 执行一段 PowerShell 脚本，返回输出。用于实现无需原生模块的 Windows 能力。 */
function runPowerShell(script, timeoutMs = 30000) {
    return new Promise((resolve) => {
        const ps = (0, child_process_1.spawn)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            try {
                ps.kill();
            }
            catch {
                /* ignore */
            }
        }, timeoutMs);
        ps.stdout.on('data', (d) => (stdout += d.toString()));
        ps.stderr.on('data', (d) => (stderr += d.toString()));
        ps.on('close', (code) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, code: code ?? -1 });
        });
        ps.on('error', (e) => {
            clearTimeout(timer);
            resolve({ stdout, stderr: String(e), code: -1 });
        });
    });
}
/** 执行任意命令行（cmd），返回输出。 */
function runCmd(command, cwd, timeoutMs = 60000) {
    return new Promise((resolve) => {
        const proc = (0, child_process_1.spawn)('cmd.exe', ['/c', command], { cwd, windowsHide: true });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            try {
                proc.kill();
            }
            catch {
                /* ignore */
            }
        }, timeoutMs);
        proc.stdout.on('data', (d) => (stdout += d.toString()));
        proc.stderr.on('data', (d) => (stderr += d.toString()));
        proc.on('close', (code) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, code: code ?? -1 });
        });
        proc.on('error', (e) => {
            clearTimeout(timer);
            resolve({ stdout, stderr: String(e), code: -1 });
        });
    });
}
/** 供 PowerShell 单引号字符串安全插值 */
function psQuote(s) {
    return "'" + String(s).replace(/'/g, "''") + "'";
}
