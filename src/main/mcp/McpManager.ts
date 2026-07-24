import { promises as fs } from 'fs'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import type { Tool } from '../tools/types'
import { Logger } from '../util/Logger'

interface McpServerConfigBase {
  disabled?: boolean
}
interface McpStdioConfig extends McpServerConfigBase {
  command: string
  args?: string[]
  env?: Record<string, string>
}
interface McpHttpConfig extends McpServerConfigBase {
  url: string
  headers?: Record<string, string>
}
type McpServerConfig = McpStdioConfig | McpHttpConfig

interface McpFile {
  mcpServers: Record<string, McpServerConfig>
}

const PROTOCOL_VERSION = '2024-11-05'

interface Transport {
  request(method: string, params?: any): Promise<any>
  notify(method: string, params?: any): void
  close(): void
}

class StdioTransport implements Transport {
  private proc: ChildProcessWithoutNullStreams
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()

  constructor(cfg: McpStdioConfig) {
    this.proc = spawn(cfg.command, cfg.args || [], {
      env: { ...process.env, ...(cfg.env || {}) },
      windowsHide: true
    })
    this.proc.stdout.on('data', (d) => this.onData(d.toString()))
    this.proc.stderr.on('data', (d) => Logger.info(`[MCP:stderr] ${d.toString().trim()}`))
    this.proc.on('error', (e) => Logger.error(`[MCP] 进程错误: ${String(e)}`))
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''
    for (const line of lines) {
      const t = line.trim()
      if (!t) continue
      let msg: any
      try {
        msg = JSON.parse(t)
      } catch {
        continue
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message || 'MCP error'))
        else p.resolve(msg.result)
      }
    }
  }

  request(method: string, params?: any): Promise<any> {
    const id = this.nextId++
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n'
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.proc.stdin.write(payload)
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`MCP 请求超时: ${method}`))
        }
      }, 30000)
    })
  }

  notify(method: string, params?: any): void {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params: params || {} }) + '\n')
  }

  close(): void {
    try {
      this.proc.kill()
    } catch {
      /* ignore */
    }
  }
}

class HttpTransport implements Transport {
  private nextId = 1
  constructor(private cfg: McpHttpConfig) {}

  async request(method: string, params?: any): Promise<any> {
    const res = await fetch(this.cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(this.cfg.headers || {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params: params || {} })
    })
    const json: any = await res.json()
    if (json.error) throw new Error(json.error.message || 'MCP error')
    return json.result
  }

  notify(method: string, params?: any): void {
    void fetch(this.cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.cfg.headers || {}) },
      body: JSON.stringify({ jsonrpc: '2.0', method, params: params || {} })
    }).catch(() => {})
  }

  close(): void {
    /* stateless */
  }
}

export class McpManager {
  private transports: Transport[] = []

  async load(mcpConfigPath: string): Promise<Tool[]> {
    let file: McpFile
    try {
      file = JSON.parse(await fs.readFile(mcpConfigPath, 'utf-8'))
    } catch {
      return []
    }
    const servers = file.mcpServers || {}
    const tools: Tool[] = []
    for (const [name, cfg] of Object.entries(servers)) {
      if (cfg.disabled) continue
      try {
        const transport: Transport =
          'url' in cfg ? new HttpTransport(cfg) : new StdioTransport(cfg)
        await transport.request('initialize', {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'WinAgent', version: '1.0.0' }
        })
        transport.notify('notifications/initialized')
        const list = await transport.request('tools/list')
        const mcpTools = list?.tools || []
        for (const t of mcpTools) {
          const toolName = `mcp__${name}__${t.name}`
          tools.push({
            schema: {
              name: toolName,
              description: `[MCP:${name}] ${t.description || t.name}`,
              parameters: t.inputSchema || { type: 'object', properties: {}, required: [] }
            },
            dangerous: true,
            run: async (args) => {
              const result = await transport.request('tools/call', { name: t.name, arguments: args })
              const content = result?.content
              if (Array.isArray(content)) {
                return content.map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n')
              }
              return JSON.stringify(result)
            }
          })
        }
        this.transports.push(transport)
        Logger.info(`[MCP] 服务器 '${name}' 已连接，注册 ${mcpTools.length} 个工具`)
      } catch (e) {
        Logger.error(`[MCP] 服务器 '${name}' 启动失败: ${String(e)}`)
      }
    }
    return tools
  }

  dispose(): void {
    this.transports.forEach((t) => t.close())
    this.transports = []
  }
}
