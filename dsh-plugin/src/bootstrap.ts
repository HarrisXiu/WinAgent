/**
 * WinAgent 服务核心装配：EventBus → ConfigStore → ToolRegistry → AgentService → WikiHost。
 * DSH 插件宿主（server.ts）与 Electron 桌面版主进程共用同一装配逻辑，避免两处漂移。
 * @module dsh-winagent/bootstrap
 */
import { promises as fs } from 'fs'
import path from 'path'
import { EventBus } from './event-bus'
import { ConfigStore, getDataDir } from './config/ConfigStore'
import { ToolRegistry } from './tools/ToolRegistry'
import { AgentService } from './agent/AgentService'
import { WikiHost } from './wiki/wiki-host'
import { KnowledgeRetriever } from './wiki/KnowledgeRetriever'
import { createWikiTools } from './tools/wikiTools'
import { Logger } from './util/Logger'
import { getCapabilities } from './util/capabilities'
import { PACKAGE_ROOT } from './platform'

/** WinAgent 服务核心：一次装配，宿主按需使用 */
export interface WinAgentCore {
  bus: EventBus
  store: ConfigStore
  registry: ToolRegistry
  agent: AgentService
  wikiHost: WikiHost
  /** 重新加载内置工具 + skills + MCP（配置保存后调用） */
  reloadTools(): Promise<void>
  dispose(): void
}

async function copyDir(src: string, dst: string): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    const s = path.join(src, e.name)
    const d = path.join(dst, e.name)
    if (e.isDirectory()) {
      await fs.mkdir(d, { recursive: true })
      await copyDir(s, d)
    } else {
      await fs.copyFile(s, d)
    }
  }
}

/** 首次使用播种数据目录：skills（pdf/docx/pptx/xlsx 读取器 + 视觉渲染/抽图）与 mcp.json 默认模板 */
export async function seedDataDir(): Promise<void> {
  const dir = getDataDir()
  await fs.mkdir(dir, { recursive: true })
  const skillsDir = path.join(dir, 'skills')
  const bundled = path.join(PACKAGE_ROOT, 'assets', 'skills')
  // 按文件夹增量合并：老数据目录也能拿到后续版本新增的 skills（已存在的文件夹不动，尊重用户修改）
  const bundledSkills = await fs.readdir(bundled).catch(() => [] as string[])
  for (const name of bundledSkills) {
    const src = path.join(bundled, name)
    const dst = path.join(skillsDir, name)
    try {
      const st = await fs.stat(src)
      if (!st.isDirectory()) continue
      await fs.access(path.join(dst, 'SKILL.md')).then(
        () => { /* 已存在，跳过 */ },
        async () => {
          await fs.mkdir(path.dirname(dst), { recursive: true })
          await copyDir(src, dst)
        }
      )
    } catch { /* ignore 单个 skill 播种失败 */ }
  }
  const mcpPath = path.join(dir, 'mcp.json')
  try {
    await fs.access(mcpPath)
  } catch {
    await fs.writeFile(mcpPath, JSON.stringify({
      mcpServers: {
        _example_filesystem: {
          disabled: true,
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\Users']
        },
        _example_http: { disabled: true, url: 'http://localhost:8000/mcp' }
      }
    }, null, 2), 'utf-8')
  }
}

/**
 * 装配完整服务核心。
 * 注意：必须在进程入口先设置 WINAGENT_DATA_DIR（桌面版），再调用本函数。
 */
export async function createWinAgentCore(): Promise<WinAgentCore> {
  const bus = new EventBus()
  const store = new ConfigStore()
  const registry = new ToolRegistry()
  const agent = new AgentService(store, registry)

  const reloadTools = async (): Promise<void> => {
    const cfg = store.get()
    await registry.initialize(cfg)
    const p = cfg.skillsDir || 'skills'
    const skillsDir = path.isAbsolute(p) ? p : path.join(getDataDir(), p)
    const mp = cfg.mcpConfigPath || 'mcp.json'
    const mcpPath = path.isAbsolute(mp) ? mp : path.join(getDataDir(), mp)
    await registry.loadExternal(skillsDir, mcpPath)
  }

  await seedDataDir()
  // 预热能力探测缓存（pandoc/soffice/Office COM/pdfjs/PyMuPDF）：避免首轮对话卡在同步探测
  getCapabilities()
  const cfg = await store.load()
  const wikiHost = new WikiHost(store, bus)
  await wikiHost.init()
  registry.setWikiTools(createWikiTools(wikiHost.vault, wikiHost.search, store))
  await registry.initialize(cfg)
  await reloadTools()
  // 自动 RAG：每轮提问自动检索知识库并注入结果
  agent.setKnowledgeRetriever(new KnowledgeRetriever(wikiHost.vault, wikiHost.search, store))

  Logger.info('WinAgent 服务核心装配完成，数据目录: ' + getDataDir())

  return {
    bus, store, registry, agent, wikiHost,
    reloadTools,
    dispose(): void {
      wikiHost.dispose()
      registry.dispose()
    }
  }
}
