import { promises as fs } from 'fs'
import path from 'path'

/** LLM function-calling 工具 schema（OpenAI 格式） */
export interface ToolSchema {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description?: string; items?: any }>
    required?: string[]
  }
}

/** 工具条目：schema + 执行器 */
export interface Tool {
  schema: ToolSchema
  /** 危险操作（写入/删除/移动等），宿主可据此做二次确认 */
  dangerous?: boolean
  /** 所属模块，用于分组展示（'file' | 'docx'） */
  module?: string
  run(args: Record<string, any>): Promise<string>
}

/** 工具信息（列表展示用） */
export interface ToolInfo {
  name: string
  description: string
  dangerous: boolean
  module: string
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

/** 简易工具注册表 */
export class ToolRegistry {
  private tools = new Map<string, Tool>()

  register(tools: Tool[]): void {
    for (const t of tools) this.tools.set(t.schema.name, t)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  list(): Tool[] {
    return [...this.tools.values()]
  }

  getInfos(): ToolInfo[] {
    return this.list().map((t) => ({
      name: t.schema.name,
      description: t.schema.description,
      dangerous: !!t.dangerous,
      module: t.module || 'unknown',
    }))
  }

  getSchemas(): ToolSchema[] {
    return this.list().map((t) => t.schema)
  }

  async execute(name: string, args: Record<string, any>): Promise<string> {
    const t = this.tools.get(name)
    if (!t) throw new Error(`未知工具: ${name}`)
    return t.run(args ?? {})
  }
}

export { fs, path }
