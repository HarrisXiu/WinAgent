/**
 * Tauri bridge: reimplements the Electron preload `window.winagent` API
 * using Tauri v2 invoke() and event listen().
 *
 * This file is imported in main.tsx BEFORE React renders, so that
 * `window.winagent` is available when components mount.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'

// ── Drag & Drop bridge ───────────────────────────────────
// Tauri on Windows intercepts drag-drop at the native level;
// HTML5 drop events don't receive file paths.
// We listen to Tauri's onDragDropEvent and dispatch custom
// events that React components can listen to.

let dragActive = false

getCurrentWebview().onDragDropEvent((event) => {
  if (event.payload.type === 'enter') {
    dragActive = true
    window.dispatchEvent(new CustomEvent('tauri:dragenter'))
  } else if (event.payload.type === 'over') {
    if (!dragActive) {
      dragActive = true
      window.dispatchEvent(new CustomEvent('tauri:dragenter'))
    }
  } else if (event.payload.type === 'drop') {
    dragActive = false
    window.dispatchEvent(new CustomEvent('tauri:drop', {
      detail: { paths: event.payload.paths }
    }))
  } else if (event.payload.type === 'leave') {
    dragActive = false
    window.dispatchEvent(new CustomEvent('tauri:dragleave'))
  }
})

// ── helpers ──────────────────────────────────────────────
type Listener = (payload: unknown) => void

function onEvent<T>(eventName: string, cb: (e: T) => void): () => void {
  let unlisten: UnlistenFn | null = null
  listen<T>(eventName, (ev) => cb(ev.payload)).then((fn) => {
    unlisten = fn
  })
  return () => {
    if (unlisten) unlisten()
  }
}

// ── API surface (mirrors preload/index.ts) ───────────────

const api = {
  // Config
  getConfig: (): Promise<any> => invoke('config_get'),
  saveConfig: (cfg: any): Promise<any> => invoke('config_save', { cfg }),
  getDataDir: (): Promise<string> => invoke('config_data_dir'),

  onConfigChanged: (cb: (cfg: any) => void): (() => void) => {
    return onEvent('config:changed', cb)
  },

  // Dialog
  pickDirectory: (): Promise<string | null> => invoke('pick_directory'),

  // Tools
  listTools: (): Promise<any[]> => invoke('tools_list'),
  reloadTools: (): Promise<any[]> => invoke('tools_reload'),

  // Models
  fetchModels: (providerId: string): Promise<string[]> =>
    invoke('models_fetch', { providerId }),

  // File
  readFile: (filePath: string): Promise<any> =>
    invoke('read_file', { filePath }),

  // Agent
  send: (text: string, attachments?: any[]): Promise<void> =>
    invoke('agent_send', { text, attachments }),
  stop: (): Promise<void> => invoke('agent_stop'),
  reset: (): Promise<void> => invoke('agent_reset'),
  compact: (): Promise<void> => invoke('agent_compact'),

  onEvent: (cb: (e: any) => void): (() => void) => {
    return onEvent('agent:event', cb)
  },

  onConfirm: (cb: (req: any) => void): (() => void) => {
    return onEvent('agent:confirm', cb)
  },
  replyConfirm: (id: string, approved: boolean): void => {
    invoke('agent_confirm_reply', { id, approved })
  },

  // Wiki
  wiki: {
    openWindow: (): void => { void invoke('wiki_window_open') },

    vaultPath: (): Promise<string> => invoke('wiki_vault_path'),
    setVaultPath: (p: string): Promise<void> =>
      invoke('wiki_vault_set_path', { p }),

    listNotes: (): Promise<any[]> => invoke('wiki_notes_list'),
    readNote: (relPath: string): Promise<any> =>
      invoke('wiki_notes_read', { relPath }),
    writeNote: (relPath: string, data: any): Promise<void> =>
      invoke('wiki_notes_write', { relPath, data }),
    deleteNote: (relPath: string): Promise<void> =>
      invoke('wiki_notes_delete', { relPath }),
    createNote: (relPath: string, title: string): Promise<void> =>
      invoke('wiki_notes_create', { relPath, title }),

    getBacklinks: (targetPath: string): Promise<any[]> =>
      invoke('wiki_links_backlinks', { targetPath }),

    getAllTags: (): Promise<any[]> => invoke('wiki_tags_list'),
    getNotesByTag: (tag: string): Promise<any[]> =>
      invoke('wiki_tags_notes', { tag }),

    search: (query: string, limit?: number): Promise<any[]> =>
      invoke('wiki_search', { query, limit }),

    getGraphData: (): Promise<any> => invoke('wiki_graph_data'),
    getGraphNode: (nodeId: string): Promise<any> =>
      invoke('wiki_graph_node', { nodeId }),
    rebuildGraph: (): Promise<void> => invoke('wiki_graph_rebuild'),

    aiAnalyze: (relPath: string): Promise<any> =>
      invoke('wiki_ai_analyze', { relPath }),
    aiCancel: (): Promise<void> => invoke('wiki_ai_cancel'),

    ingest: (rawRelPath: string): Promise<any> =>
      invoke('wiki_ingest', { rawRelPath }),
    onIngestProgress: (cb: (p: any) => void): (() => void) => {
      return onEvent('wiki:ingest:progress', cb)
    },
    confirmConcept: (slug: string, area: string): Promise<any> =>
      invoke('wiki_concept_confirm', { slug, area }),

    ingestBatchStart: (paths: string[]): Promise<any> =>
      invoke('wiki_ingest_batch_start', { paths }),
    ingestBatchContinue: (): Promise<any> => invoke('wiki_ingest_batch_continue'),
    ingestBatchAbort: (): Promise<any> => invoke('wiki_ingest_batch_abort'),

    workflowLint: (): Promise<any> => invoke('wiki_workflow_lint'),
    workflowReflect: (): Promise<any> => invoke('wiki_workflow_reflect'),
    workflowMerge: (keep: string, remove: string, area: string): Promise<any> =>
      invoke('wiki_workflow_merge', { keep, remove, area }),
    workflowQuery: (query: string): Promise<any> =>
      invoke('wiki_workflow_query', { query }),

    importUrl: (url: string): Promise<any> =>
      invoke('wiki_import_url', { url }),
    importFile: (srcPath: string, targetDir?: string): Promise<string> =>
      invoke('wiki_import_file', { srcPath, targetDir }),

    importAnalyze: (filePaths: string[], requirement: string): Promise<any> =>
      invoke('wiki_import_analyze', { filePaths, requirement }),
    onCustomProgress: (cb: (p: any) => void): (() => void) => {
      return onEvent('wiki:custom:progress', cb)
    },

    listAnalysisTags: (): Promise<any[]> => invoke('wiki_analysis_tags_list'),
    addAnalysisTags: (tags: any[]): Promise<any[]> =>
      invoke('wiki_analysis_tags_add', { tags }),

    listAttachments: (subDir?: string): Promise<any[]> =>
      invoke('wiki_attachments_list', { subDir }),

    addAnnotation: (relPath: string, text: string, range: string): Promise<any> =>
      invoke('wiki_annotations_add', { relPath, text, range }),
    removeAnnotation: (relPath: string, annotationId: string): Promise<void> =>
      invoke('wiki_annotations_remove', { relPath, annotationId }),

    onVaultChanged: (cb: (e: any) => void): (() => void) => {
      return onEvent('wiki:vault:changed', cb)
    },
  },
}

// Inject into window so existing React code works unchanged
;(window as any).winagent = api

export type WinAgentApi = typeof api
