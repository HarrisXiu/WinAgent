import { spawn } from 'child_process'

export interface RunResult {
  stdout: string
  stderr: string
  code: number
}

/** 执行一段 PowerShell 脚本，返回输出。用于实现无需原生模块的 Windows 能力。 */
export function runPowerShell(script: string, timeoutMs = 30000): Promise<RunResult> {
  return new Promise((resolve) => {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true }
    )
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        ps.kill()
      } catch {
        /* ignore */
      }
    }, timeoutMs)
    ps.stdout.on('data', (d) => (stdout += d.toString()))
    ps.stderr.on('data', (d) => (stderr += d.toString()))
    ps.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code: code ?? -1 })
    })
    ps.on('error', (e) => {
      clearTimeout(timer)
      resolve({ stdout, stderr: String(e), code: -1 })
    })
  })
}

/** 执行任意命令行（cmd），返回输出。 */
export function runCmd(command: string, cwd?: string, timeoutMs = 60000): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = spawn('cmd.exe', ['/c', command], { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        proc.kill()
      } catch {
        /* ignore */
      }
    }, timeoutMs)
    proc.stdout.on('data', (d) => (stdout += d.toString()))
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code: code ?? -1 })
    })
    proc.on('error', (e) => {
      clearTimeout(timer)
      resolve({ stdout, stderr: String(e), code: -1 })
    })
  })
}

/** 供 PowerShell 单引号字符串安全插值 */
export function psQuote(s: string): string {
  return "'" + String(s).replace(/'/g, "''") + "'"
}
