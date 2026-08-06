import { contextBridge, ipcRenderer } from 'electron'
import type { AgentEvent, AppConfig, ToolInfo } from '../shared/types'

export interface AttachmentData {
  name: string
  path: string
  mime: string
  isImage: boolean
  dataUrl?: string
  textContent?: string
}

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg: AppConfig): Promise<AppConfig> => ipcRenderer.invoke('config:save', cfg),
  getDataDir: (): Promise<string> => ipcRenderer.invoke('config:dataDir'),

  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickDirectory'),

  listTools: (): Promise<ToolInfo[]> => ipcRenderer.invoke('tools:list'),
  reloadTools: (): Promise<ToolInfo[]> => ipcRenderer.invoke('tools:reload'),

  fetchModels: (providerId: string): Promise<string[]> => ipcRenderer.invoke('models:fetch', providerId),

  readFile: (filePath: string): Promise<AttachmentData> =>
    ipcRenderer.invoke('file:read', filePath),

  send: (text: string, attachments?: AttachmentData[]): Promise<void> =>
    ipcRenderer.invoke('agent:send', text, attachments),
  stop: (): Promise<void> => ipcRenderer.invoke('agent:stop'),
  reset: (): Promise<void> => ipcRenderer.invoke('agent:reset'),
  compact: (): Promise<void> => ipcRenderer.invoke('agent:compact'),

  onEvent: (cb: (e: AgentEvent) => void): (() => void) => {
    const listener = (_e: unknown, ev: AgentEvent): void => cb(ev)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  },

  onConfirm: (cb: (req: { id: string; name: string; args: string }) => void): (() => void) => {
    const listener = (_e: unknown, req: { id: string; name: string; args: string }): void => cb(req)
    ipcRenderer.on('agent:confirm', listener)
    return () => ipcRenderer.removeListener('agent:confirm', listener)
  },
  replyConfirm: (id: string, approved: boolean): void =>
    ipcRenderer.send('agent:confirm:reply', { id, approved })
}

contextBridge.exposeInMainWorld('winagent', api)

export type WinAgentApi = typeof api
