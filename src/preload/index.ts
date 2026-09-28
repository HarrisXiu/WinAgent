import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AgentEvent, AppConfig, ToolInfo, ProviderConfig,
  NoteMeta, NoteContent, NoteData, NoteAnnotation,
  GraphData, SearchResult, TagWithCount, AISuggestion, VaultChangeEvent, IngestResult, IngestProgress,
  BatchIngestStartResult, BatchIngestDoneResult, WorkflowResult, LintWorkflowResult,
  AnalysisTag, ImportAnalyzeResult, KnowledgeContext, KnowledgeSource, RuleSet, RuleTask, WikiJob,
  SessionStartResult, SkinMeta, SkinSlot, VoiceCloneMeta,
  VoiceSegmentEvent, VoiceSessionEndEvent
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

  /** 配置变更广播（另一窗口保存设置后实时同步，主题双窗口联动） */
  onConfigChanged: (cb: (cfg: AppConfig) => void): (() => void) => {
    const listener = (_e: unknown, cfg: AppConfig): void => cb(cfg)
    ipcRenderer.on('config:changed', listener)
    return () => ipcRenderer.removeListener('config:changed', listener)
  },

  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickDirectory'),

  listTools: (): Promise<ToolInfo[]> => ipcRenderer.invoke('tools:list'),
  reloadTools: (): Promise<ToolInfo[]> => ipcRenderer.invoke('tools:reload'),
  getMcpConfig: (): Promise<string> => ipcRenderer.invoke('tools:mcp:get'),
  saveMcpConfig: (text: string): Promise<ToolInfo[]> => ipcRenderer.invoke('tools:mcp:save', text),

  fetchModels: async (provider: string | ProviderConfig): Promise<string[]> => {
    const result: { models?: string[]; error?: string } = await ipcRenderer.invoke('models:fetch', provider)
    if (result.error) throw new Error(result.error)
    return result.models || []
  },
  detectOutputLimit: async (provider: ProviderConfig, force = false): Promise<import('../shared/types').OutputLimit> => {
    const result = await ipcRenderer.invoke('models:outputLimit', provider, force)
    if (result.error) throw new Error(result.error)
    return result.limit
  },

  readFile: (filePath: string): Promise<AttachmentData> =>
    ipcRenderer.invoke('file:read', filePath),
  filePath: (file: File): string => webUtils.getPathForFile(file),

  send: (text: string, attachments?: AttachmentData[], context?: KnowledgeContext): Promise<void> =>
    ipcRenderer.invoke('agent:send', text, attachments, context),
  stop: (): Promise<void> => ipcRenderer.invoke('agent:stop'),
  reset: (): Promise<void> => ipcRenderer.invoke('agent:reset'),
  compact: (): Promise<void> => ipcRenderer.invoke('agent:compact'),
  chats: {
    list: (): Promise<import('../shared/types').ConversationSummary[]> => ipcRenderer.invoke('chats:list'),
    open: (id = ''): Promise<import('../shared/types').SavedConversation> => ipcRenderer.invoke('chats:open', id),
    createTopic: (title: string): Promise<import('../shared/types').SavedConversation> => ipcRenderer.invoke('chats:createTopic', title),
    save: (id: string, turns: unknown[], context?: KnowledgeContext, draft?: string): Promise<void> => ipcRenderer.invoke('chats:save', id, turns, context, draft)
  },

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

  // ==================== Voice（TTS 分段朗读会话 + 克隆音色） ====================
  tts: {
    /** 开启分段朗读会话：立即返回 {sessionId, total}，各段经 onSegment 逐段下发 */
    start: (text: string, opts?: { voice?: string; stylePrompt?: string; source?: 'manual' | 'auto' | 'agent' | 'test' }): Promise<SessionStartResult> =>
      ipcRenderer.invoke('tts:start', text, opts),
    /** 播到第 index 段（0-based）时回执，驱动服务端滑窗预取（单向，无往返） */
    ack: (sessionId: string, index: number): void => { ipcRenderer.send('tts:ack', sessionId, index) },
    /** 取消朗读会话（不带 id = 取消当前） */
    cancel: (sessionId?: string): void => { ipcRenderer.send('tts:cancel', sessionId) },
    /** 一段音频合成完毕（渲染层入队播放） */
    onSegment: (cb: (d: VoiceSegmentEvent) => void): (() => void) => {
      const listener = (_e: unknown, d: VoiceSegmentEvent): void => cb(d)
      ipcRenderer.on('voice:segment', listener)
      return () => ipcRenderer.removeListener('voice:segment', listener)
    },
    /** 会话结束（error 缺省 = 被取消或正常播完） */
    onSessionEnd: (cb: (d: VoiceSessionEndEvent) => void): (() => void) => {
      const listener = (_e: unknown, d: VoiceSessionEndEvent): void => cb(d)
      ipcRenderer.on('voice:session:end', listener)
      return () => ipcRenderer.removeListener('voice:session:end', listener)
    }
  },

  voices: {
    list: (): Promise<VoiceCloneMeta[]> => ipcRenderer.invoke('voice:list'),
    /** 内置音色列表（服务层下发，渲染层不硬编码） */
    builtinList: (): Promise<Array<{ value: string; label: string }>> =>
      ipcRenderer.invoke('voice:builtinList'),
    /** 弹文件对话框选择参考音频（wav/mp3）并导入，返回最新列表 */
    add: (name?: string): Promise<VoiceCloneMeta[]> => ipcRenderer.invoke('voice:add', name),
    /** 重命名克隆音色，返回最新列表 */
    rename: (id: string, name: string): Promise<VoiceCloneMeta[]> =>
      ipcRenderer.invoke('voice:rename', id, name),
    /** 删除克隆音色，返回最新列表 */
    remove: (id: string): Promise<VoiceCloneMeta[]> => ipcRenderer.invoke('voice:remove', id),
    /** 克隆音色试听（走朗读会话，可取消、进全局控制条） */
    test: (id: string, sampleText?: string): Promise<SessionStartResult> =>
      ipcRenderer.invoke('voice:test', id, sampleText),
    /** 音色库变更广播（任一窗口增删后同步） */
    onChanged: (cb: (list: VoiceCloneMeta[]) => void): (() => void) => {
      const listener = (_e: unknown, list: VoiceCloneMeta[]): void => cb(list)
      ipcRenderer.on('voice:changed', listener)
      return () => ipcRenderer.removeListener('voice:changed', listener)
    }
  },

  // ==================== Skins（主题包：外观素材库） ====================
  skins: {
    list: (): Promise<SkinMeta[]> => ipcRenderer.invoke('skins:list'),
    /** 新建空主题包（素材随后逐槽位上传），返回最新列表 */
    create: (name: string): Promise<SkinMeta[]> => ipcRenderer.invoke('skins:create', name),
    /** 弹文件对话框上传槽位图片（png/gif/jpg/webp），返回最新列表 */
    setSlot: (id: string, slot: SkinSlot): Promise<SkinMeta[]> =>
      ipcRenderer.invoke('skins:setSlot', id, slot),
    /** 清空槽位，返回最新列表 */
    clearSlot: (id: string, slot: SkinSlot): Promise<SkinMeta[]> =>
      ipcRenderer.invoke('skins:clearSlot', id, slot),
    /** 重命名主题包，返回最新列表 */
    rename: (id: string, name: string): Promise<SkinMeta[]> =>
      ipcRenderer.invoke('skins:rename', id, name),
    /** 删除主题包，返回最新列表 */
    remove: (id: string): Promise<SkinMeta[]> => ipcRenderer.invoke('skins:remove', id),
    /** 主题包变更广播（任一窗口操作后同步；config:changed 同时携带当前 skin id） */
    onChanged: (cb: (list: SkinMeta[]) => void): (() => void) => {
      const listener = (_e: unknown, list: SkinMeta[]): void => cb(list)
      ipcRenderer.on('skin:changed', listener)
      return () => ipcRenderer.removeListener('skin:changed', listener)
    }
  },

  /** 人设默认值（主题包联动切换用）：{ personaPrompt, petPrompt } */
  getConfigPrompts: (): Promise<{ personaPrompt: string; petPrompt: string }> =>
    ipcRenderer.invoke('config:prompts'),

  // ==================== Wiki API ====================
  wiki: {
    returnToChat: (value: {path:string;title:string;text?:string}): Promise<void> => ipcRenderer.invoke('wiki:workspace:chat',value),
    onChatContext: (cb:(value:{path:string;title:string;text?:string})=>void): (()=>void) => {
      const listener=(_e:unknown,value:{path:string;title:string;text?:string}):void=>cb(value)
      ipcRenderer.on('wiki:workspace:chat',listener)
      return ()=>ipcRenderer.removeListener('wiki:workspace:chat',listener)
    },
    sources: (): Promise<KnowledgeSource[]> => ipcRenderer.invoke('wiki:workspace:sources'),
    jobs: (): Promise<WikiJob[]> => ipcRenderer.invoke('wiki:workspace:jobs'),
    cancelJob: (id: string): Promise<void> => ipcRenderer.invoke('wiki:workspace:cancel', id),
    pickFiles: (): Promise<string[]> => ipcRenderer.invoke('wiki:workspace:pickFiles'),
    ruleSets: (): Promise<RuleSet[]> => ipcRenderer.invoke('wiki:rules:list'),
    compileRules: (sourcePath: string, task: RuleTask, keywords: string[]): Promise<RuleSet> => ipcRenderer.invoke('wiki:rules:compile', sourcePath, task, keywords),
    toggleRules: (id: string, enabled: boolean): Promise<void> => ipcRenderer.invoke('wiki:rules:toggle', id, enabled),
    openOriginal: (rawPath: string): Promise<void> => ipcRenderer.invoke('wiki:workspace:openOriginal', rawPath),
    pdfData: (sourceId: string): Promise<Uint8Array> => ipcRenderer.invoke('wiki:workspace:pdf', sourceId),
    /** 打开/聚焦知识库独立窗口 */
    openWindow: (): void => { void ipcRenderer.invoke('wiki:window:open') },

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

    ingest: (rawRelPath: string, force = false): Promise<IngestResult> =>
      ipcRenderer.invoke('wiki:ingest', rawRelPath, force),
    onIngestProgress: (cb: (p: IngestProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: IngestProgress): void => cb(p)
      ipcRenderer.on('wiki:ingest:progress', listener)
      return () => ipcRenderer.removeListener('wiki:ingest:progress', listener)
    },
    confirmConcept: (slug: string, area: 'concepts' | 'entities'): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('wiki:concept:confirm', slug, area),

    // 批量摄入（交互式标定）
    ingestBatchStart: (paths: string[]): Promise<BatchIngestStartResult> =>
      ipcRenderer.invoke('wiki:ingest:batchStart', paths),
    ingestBatchContinue: (): Promise<BatchIngestDoneResult> =>
      ipcRenderer.invoke('wiki:ingest:batchContinue'),
    ingestBatchAbort: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('wiki:ingest:batchAbort'),

    // 工作流（LINT / REFLECT / MERGE / QUERY）
    workflowLint: (): Promise<LintWorkflowResult> => ipcRenderer.invoke('wiki:workflow:lint'),
    workflowReflect: (): Promise<WorkflowResult> => ipcRenderer.invoke('wiki:workflow:reflect'),
    workflowMerge: (keep: string, remove: string, area: string): Promise<WorkflowResult> =>
      ipcRenderer.invoke('wiki:workflow:merge', keep, remove, area),
    workflowQuery: (query: string): Promise<WorkflowResult> =>
      ipcRenderer.invoke('wiki:workflow:query', query),

    // URL 导入（网页抓取 → raw/clippings → INGEST）
    importUrl: (url: string): Promise<{ ok: boolean; relPath?: string; sourcePath?: string; error?: string }> =>
      ipcRenderer.invoke('wiki:import:url', url),

    importFile: (srcPath: string, targetDir?: string): Promise<string> =>
      ipcRenderer.invoke('wiki:import:file', srcPath, targetDir),

    // 拖入分析流程：导入 → 编译 → 定制分析（requirement 为空 = 仅编译入库）
    importAnalyze: (filePaths: string[], requirement: string): Promise<ImportAnalyzeResult> =>
      ipcRenderer.invoke('wiki:import:analyze', filePaths, requirement),
    onCustomProgress: (cb: (p: IngestProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: IngestProgress): void => cb(p)
      ipcRenderer.on('wiki:custom:progress', listener)
      return () => ipcRenderer.removeListener('wiki:custom:progress', listener)
    },

    // 分析要求 Tag（拖入弹窗可选项）
    listAnalysisTags: (): Promise<AnalysisTag[]> => ipcRenderer.invoke('wiki:analysisTags:list'),
    addAnalysisTags: (tags: AnalysisTag[]): Promise<AnalysisTag[]> =>
      ipcRenderer.invoke('wiki:analysisTags:add', tags),

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
