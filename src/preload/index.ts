import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentEvent, AppConfig, ToolInfo,
  NoteMeta, NoteContent, NoteData, NoteAnnotation,
  GraphData, SearchResult, TagWithCount, AISuggestion, VaultChangeEvent, IngestResult, IngestProgress
} from '../shared/types'

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
    ipcRenderer.send('agent:confirm:reply', { id, approved }),

  // ==================== Wiki API ====================
  wiki: {
    vaultPath: (): Promise<string> => ipcRenderer.invoke('wiki:vault:path'),
    setVaultPath: (p: string): Promise<void> => ipcRenderer.invoke('wiki:vault:setPath', p),

    listNotes: (): Promise<NoteMeta[]> => ipcRenderer.invoke('wiki:notes:list'),
    readNote: (relPath: string): Promise<NoteContent> => ipcRenderer.invoke('wiki:notes:read', relPath),
    writeNote: (relPath: string, data: NoteData): Promise<void> =>
      ipcRenderer.invoke('wiki:notes:write', relPath, data),
    deleteNote: (relPath: string): Promise<void> => ipcRenderer.invoke('wiki:notes:delete', relPath),
    createNote: (relPath: string, title: string): Promise<void> =>
      ipcRenderer.invoke('wiki:notes:create', relPath, title),

    getBacklinks: (targetPath: string): Promise<Array<{ path: string; title: string }>> =>
      ipcRenderer.invoke('wiki:links:backlinks', targetPath),

    getAllTags: (): Promise<TagWithCount[]> => ipcRenderer.invoke('wiki:tags:list'),
    getNotesByTag: (tag: string): Promise<NoteMeta[]> => ipcRenderer.invoke('wiki:tags:notes', tag),

    search: (query: string, limit?: number): Promise<SearchResult[]> =>
      ipcRenderer.invoke('wiki:search', query, limit),

    getGraphData: (): Promise<GraphData> => ipcRenderer.invoke('wiki:graph:data'),
    getGraphNode: (nodeId: string): Promise<GraphData> => ipcRenderer.invoke('wiki:graph:node', nodeId),
    rebuildGraph: (): Promise<void> => ipcRenderer.invoke('wiki:graph:rebuild'),

    aiAnalyze: (relPath: string): Promise<AISuggestion> =>
      ipcRenderer.invoke('wiki:ai:analyze', relPath),
    aiCancel: (): Promise<void> => ipcRenderer.invoke('wiki:ai:cancel'),

    ingest: (rawRelPath: string): Promise<IngestResult> =>
      ipcRenderer.invoke('wiki:ingest', rawRelPath),
    onIngestProgress: (cb: (p: IngestProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: IngestProgress): void => cb(p)
      ipcRenderer.on('wiki:ingest:progress', listener)
      return () => ipcRenderer.removeListener('wiki:ingest:progress', listener)
    },
    confirmConcept: (slug: string, area: 'concepts' | 'entities'): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('wiki:concept:confirm', slug, area),

    importFile: (srcPath: string, targetDir?: string): Promise<string> =>
      ipcRenderer.invoke('wiki:import:file', srcPath, targetDir),

    listAttachments: (subDir?: string): Promise<string[]> =>
      ipcRenderer.invoke('wiki:attachments:list', subDir),

    addAnnotation: (relPath: string, text: string, range: string): Promise<NoteAnnotation> =>
      ipcRenderer.invoke('wiki:annotations:add', relPath, text, range),
    removeAnnotation: (relPath: string, annotationId: string): Promise<void> =>
      ipcRenderer.invoke('wiki:annotations:remove', relPath, annotationId),

    onVaultChanged: (cb: (e: VaultChangeEvent) => void): (() => void) => {
      const listener = (_e: unknown, ev: VaultChangeEvent): void => cb(ev)
      ipcRenderer.on('wiki:vault:changed', listener)
      return () => ipcRenderer.removeListener('wiki:vault:changed', listener)
    }
  }
}

contextBridge.exposeInMainWorld('winagent', api)

export type WinAgentApi = typeof api
