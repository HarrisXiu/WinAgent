import { useState, useCallback, useRef, useEffect } from 'react'
import type { NoteMeta, NoteContent, NoteData, TagWithCount, SearchResult, NoteAnnotation, GraphData, AISuggestion, VaultChangeEvent, IngestResult } from '../../../shared/types'

export interface WikiState {
  vaultPath: string
  notes: NoteMeta[]
  currentNote: NoteContent | null
  tags: TagWithCount[]
  searchResults: SearchResult[] | null
  graphData: GraphData | null
  editing: boolean
  selectedPath: string | null
  loading: boolean
}

export function useWiki() {
  const [state, setState] = useState<WikiState>({
    vaultPath: '',
    notes: [],
    currentNote: null,
    tags: [],
    searchResults: null,
    graphData: null,
    editing: false,
    selectedPath: null,
    loading: false
  })

  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    // 初始加载
    initWiki()
    // 监听 vault 变更
    const unsub = window.winagent.wiki.onVaultChanged((_event) => {
      refreshNotes()
    })
    return unsub
  }, [])

  const initWiki = useCallback(async () => {
    const vaultPath = await window.winagent.wiki.vaultPath()
    const notes = await window.winagent.wiki.listNotes()
    const tags = await window.winagent.wiki.getAllTags()
    setState((s) => ({ ...s, vaultPath, notes, tags }))
  }, [])

  const refreshNotes = useCallback(async () => {
    const notes = await window.winagent.wiki.listNotes()
    const tags = await window.winagent.wiki.getAllTags()
    setState((s) => ({ ...s, notes, tags }))
  }, [])

  const openNote = useCallback(async (relPath: string) => {
    setState((s) => ({ ...s, loading: true, selectedPath: relPath }))
    try {
      const note = await window.winagent.wiki.readNote(relPath)
      setState((s) => ({ ...s, currentNote: note, editing: false, loading: false }))
    } catch {
      setState((s) => ({ ...s, loading: false }))
    }
  }, [])

  const saveNote = useCallback(async (data: NoteData) => {
    const cur = stateRef.current
    if (!cur.currentNote) return
    await window.winagent.wiki.writeNote(cur.currentNote.path, data)
    await refreshNotes()
    // 重新读取以获取更新后的内容
    const updated = await window.winagent.wiki.readNote(cur.currentNote.path)
    setState((s) => ({ ...s, currentNote: updated, editing: false }))
  }, [refreshNotes])

  const createNote = useCallback(async (relPath: string, title: string) => {
    await window.winagent.wiki.createNote(relPath, title)
    await refreshNotes()
    await openNote(relPath)
  }, [refreshNotes, openNote])

  const deleteNote = useCallback(async (relPath: string) => {
    await window.winagent.wiki.deleteNote(relPath)
    setState((s) => ({
      ...s,
      currentNote: s.currentNote?.path === relPath ? null : s.currentNote,
      selectedPath: s.selectedPath === relPath ? null : s.selectedPath,
      editing: false
    }))
    await refreshNotes()
  }, [refreshNotes])

  const closeNote = useCallback(() => {
    setState((s) => ({ ...s, currentNote: null, editing: false, selectedPath: null }))
  }, [])

  const startEditing = useCallback(() => {
    setState((s) => ({ ...s, editing: true }))
  }, [])

  const cancelEditing = useCallback(() => {
    // 重新读取以丢弃更改
    const cur = stateRef.current
    if (cur.currentNote) {
      openNote(cur.currentNote.path)
    }
  }, [openNote])

  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      setState((s) => ({ ...s, searchResults: null }))
      return
    }
    const results = await window.winagent.wiki.search(query, 20)
    setState((s) => ({ ...s, searchResults: results }))
  }, [])

  const getBacklinks = useCallback(async (targetPath: string) => {
    return window.winagent.wiki.getBacklinks(targetPath)
  }, [])

  const loadGraph = useCallback(async () => {
    const data = await window.winagent.wiki.getGraphData()
    setState((s) => ({ ...s, graphData: data }))
    return data
  }, [])

  const setVaultPath = useCallback(async (newPath: string) => {
    await window.winagent.wiki.setVaultPath(newPath)
    await initWiki()
  }, [initWiki])

  const importFile = useCallback(async (srcPath: string, targetDir?: string) => {
    const relPath = await window.winagent.wiki.importFile(srcPath, targetDir)
    await refreshNotes()
    return relPath
  }, [refreshNotes])

  /** LLM Wiki 编译：raw 文件 → sources/concepts/entities 页 */
  const ingest = useCallback(async (rawRelPath: string): Promise<IngestResult> => {
    const result = await window.winagent.wiki.ingest(rawRelPath)
    await refreshNotes()
    return result
  }, [refreshNotes])

  const addAnnotation = useCallback(async (text: string, range: string) => {
    const cur = stateRef.current
    if (!cur.currentNote) return null
    const annotation = await window.winagent.wiki.addAnnotation(cur.currentNote.path, text, range)
    // 刷新笔记
    await openNote(cur.currentNote.path)
    return annotation
  }, [openNote])

  const removeAnnotation = useCallback(async (annotationId: string) => {
    const cur = stateRef.current
    if (!cur.currentNote) return
    await window.winagent.wiki.removeAnnotation(cur.currentNote.path, annotationId)
    await openNote(cur.currentNote.path)
  }, [openNote])

  const getTags = useCallback(async () => {
    const tags = await window.winagent.wiki.getAllTags()
    setState((s) => ({ ...s, tags }))
    return tags
  }, [])

  const getNotesByTag = useCallback(async (tag: string) => {
    return window.winagent.wiki.getNotesByTag(tag)
  }, [])

  return {
    ...state,
    // actions
    openNote,
    saveNote,
    createNote,
    deleteNote,
    closeNote,
    startEditing,
    cancelEditing,
    search,
    refreshNotes,
    getBacklinks,
    loadGraph,
    setVaultPath,
    importFile,
    ingest,
    addAnnotation,
    removeAnnotation,
    getTags,
    getNotesByTag
  }
}
