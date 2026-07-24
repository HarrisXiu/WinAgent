import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { ConfigStore, getDataDir } from './config/ConfigStore'
import { ToolRegistry } from './tools/ToolRegistry'
import { AgentService } from './agent/AgentService'
import { fetchModels } from './llm/OpenAIClient'
import { Logger } from './util/Logger'
import type { AgentEvent, AppConfig, ChatMessage } from '../shared/types'

let mainWindow: BrowserWindow | null = null
const store = new ConfigStore()
const registry = new ToolRegistry()
let agent: AgentService

// 待处理的危险操作确认
const pendingConfirms = new Map<string, (approved: boolean) => void>()
let confirmSeq = 0

async function reloadTools(cfg: AppConfig): Promise<void> {
  await registry.initialize(cfg)
  const skillsDir = store.resolvePath(cfg.skillsDir)
  const mcpPath = store.resolvePath(cfg.mcpConfigPath)
  await registry.loadExternal(skillsDir, mcpPath)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#0d1117',
    title: 'WinAgent',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function sendEvent(e: AgentEvent): void {
  mainWindow?.webContents.send('agent:event', e)
}

function confirmTool(name: string, args: string): Promise<boolean> {
  return new Promise((resolve) => {
    const id = `cf_${++confirmSeq}`
    pendingConfirms.set(id, resolve)
    mainWindow?.webContents.send('agent:confirm', { id, name, args })
  })
}

function registerIpc(): void {
  ipcMain.handle('config:get', () => store.get())

  ipcMain.handle('config:save', async (_e, cfg: AppConfig) => {
    await store.save(cfg)
    await reloadTools(cfg)
    return store.get()
  })

  ipcMain.handle('config:dataDir', () => getDataDir())

  ipcMain.handle('file:read', async (_e, filePath: string) => {
    const ext = path.extname(filePath).toLowerCase()
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']
    const isImage = imageExts.includes(ext)
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp'
    }
    const mime = mimeMap[ext] || 'application/octet-stream'
    const name = path.basename(filePath)

    if (isImage) {
      const buf = await fs.readFile(filePath)
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      return { name, path: filePath, mime, isImage: true, dataUrl }
    }

    // 文本类文件读取内容，其他文件只返回路径信息
    const textExts = ['.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', '.py', '.java',
      '.c', '.cpp', '.h', '.css', '.html', '.xml', '.yml', '.yaml', '.csv', '.log', '.sh', '.bat']
    if (textExts.includes(ext)) {
      const textContent = await fs.readFile(filePath, 'utf-8')
      return { name, path: filePath, mime, isImage: false, textContent: textContent.slice(0, 50000) }
    }
    return { name, path: filePath, mime, isImage: false }
  })

  ipcMain.handle('tools:list', () => registry.getInfos())

  ipcMain.handle('tools:reload', async () => {
    await reloadTools(store.get())
    return registry.getInfos()
  })

  ipcMain.handle('models:fetch', async (_e, providerId: string) => {
    const cfg = store.get()
    const provider = cfg.providers.find((p) => p.id === providerId) || store.activeProvider()
    return fetchModels(provider)
  })

  ipcMain.handle('agent:send', async (_e, text: string, attachments?: any[]) => {
    await agent.process(text, { onEvent: sendEvent, confirmTool }, attachments)
  })

  ipcMain.handle('agent:stop', () => agent.stop())
  ipcMain.handle('agent:reset', () => agent.reset())
  ipcMain.handle('agent:compact', async () => {
    await agent.compactNow({ onEvent: sendEvent, confirmTool })
  })

  ipcMain.on('agent:confirm:reply', (_e, payload: { id: string; approved: boolean }) => {
    const resolve = pendingConfirms.get(payload.id)
    if (resolve) {
      resolve(payload.approved)
      pendingConfirms.delete(payload.id)
    }
  })
}

app.whenReady().then(async () => {
  const cfg = await store.load()
  agent = new AgentService(store, registry)
  registerIpc()
  await reloadTools(cfg)
  Logger.info('WinAgent 启动完成，数据目录: ' + getDataDir())
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  registry.dispose()
  if (process.platform !== 'darwin') app.quit()
})
