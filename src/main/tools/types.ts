import type { ToolSchema } from '../../shared/types'

export interface Tool {
  schema: ToolSchema
  /** 是否为危险操作（删除/写注册表/结束进程/执行命令/模拟输入等），触发二次确认 */
  dangerous?: boolean
  run(args: Record<string, any>): Promise<string>
}

export function str(v: unknown, def = ''): string {
  return v === undefined || v === null ? def : String(v)
}
export function num(v: unknown, def = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}
export function bool(v: unknown, def = false): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v.toLowerCase() === 'true'
  return def
}
