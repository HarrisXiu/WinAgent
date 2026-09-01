/**
 * dsh-winagent 插件入口：cordis 插件对象。
 * 挂载后通过 /winagent/* 提供 WinAgent（Windows 操作 Agent）的 Web UI 与 API。
 * @module dsh-winagent
 */
import { ConfigStore } from './config/ConfigStore'
import { ToolRegistry } from './tools/ToolRegistry'
import { AgentService } from './agent/AgentService'
import { EventBus } from './event-bus'
import { createServerHost } from './server'

export const name = 'dsh-winagent'

export const inject = ['webServer']

export function apply(ctx: any): void {
  if (!ctx.webServer) return

  const bus = new EventBus()
  const store = new ConfigStore()
  const registry = new ToolRegistry()
  const agent = new AgentService(store, registry)
  const host = createServerHost(ctx, store, registry, agent, bus)

  host.registerRoutes(ctx.webServer)
  void host.init().catch((err: unknown) => {
    ctx.logger?.warn?.('dsh-winagent init failed: ' + String((err as Error)?.message || err))
  })

  ctx.effect(() => () => host.dispose())
}
