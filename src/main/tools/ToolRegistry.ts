import type { AppConfig, ToolInfo, ToolSchema, ToolSource } from '../../shared/types'
import type { Tool } from './types'
import { fileTools } from './fileTools'
import { systemTools } from './systemTools'
import { registryTools } from './registryTools'
import { inputTools } from './inputTools'
import { windowTools } from './windowTools'
import { httpTools } from './httpTools'
import { docxTools } from './docxTools'
import { imageTools } from './imageTools'
import { loadSkills } from '../skills/SkillLoader'
import { McpManager } from '../mcp/McpManager'
import { Logger } from '../util/Logger'

interface Entry {
  tool: Tool
  source: ToolSource
}

export class ToolRegistry {
  private tools = new Map<string, Entry>()
  private mcp = new McpManager()

  private addAll(tools: Tool[], source: ToolSource): void {
    for (const t of tools) this.tools.set(t.schema.name, { tool: t, source })
  }

  async initialize(cfg: AppConfig): Promise<void> {
    this.tools.clear()
    this.mcp.dispose()
    // 内置工具
    this.addAll(
      [...fileTools, ...systemTools, ...registryTools, ...inputTools, ...windowTools, ...httpTools, ...docxTools, ...imageTools],
      'builtin'
    )
    void cfg
    Logger.info(`[Tools] 内置工具 ${this.tools.size} 个`)
  }

  /** 分别加载 skills 与 mcp（传入已解析的绝对路径） */
  async loadExternal(skillsDirAbs: string, mcpConfigAbs: string): Promise<void> {
    try {
      const skills = await loadSkills(skillsDirAbs)
      this.addAll(skills, 'skill')
      Logger.info(`[Tools] Skills ${skills.length} 个`)
    } catch (e) {
      Logger.error(`[Tools] Skills 加载失败: ${String(e)}`)
    }
    try {
      const mcpTools = await this.mcp.load(mcpConfigAbs)
      this.addAll(mcpTools, 'mcp')
      Logger.info(`[Tools] MCP ${mcpTools.length} 个`)
    } catch (e) {
      Logger.error(`[Tools] MCP 加载失败: ${String(e)}`)
    }
  }

  getSchemas(): ToolSchema[] {
    return [...this.tools.values()].map((e) => e.tool.schema)
  }

  getInfos(): ToolInfo[] {
    return [...this.tools.values()].map((e) => ({
      name: e.tool.schema.name,
      description: e.tool.schema.description,
      source: e.source,
      dangerous: !!e.tool.dangerous
    }))
  }

  getSource(name: string): ToolSource {
    return this.tools.get(name)?.source || 'builtin'
  }

  isDangerous(name: string): boolean {
    return !!this.tools.get(name)?.tool.dangerous
  }

  async execute(name: string, args: Record<string, any>): Promise<{ ok: boolean; result: string }> {
    const entry = this.tools.get(name)
    if (!entry) return { ok: false, result: `未知工具: ${name}` }
    try {
      const result = await entry.tool.run(args || {})
      return { ok: true, result }
    } catch (e) {
      return { ok: false, result: `错误: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  dispose(): void {
    this.mcp.dispose()
  }
}
