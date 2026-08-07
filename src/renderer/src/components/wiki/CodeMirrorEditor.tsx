import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { autocompletion, CompletionContext } from '@codemirror/autocomplete'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  noteTitles?: string[]  // 用于 [[wiki link]] 自动补全
}

export interface CodeMirrorEditorHandle {
  /** 获取当前选中文本（CM6 的选中不在 DOM selection 上，必须走 view.state） */
  getSelectionText: () => string
}

const CodeMirrorEditor = forwardRef<CodeMirrorEditorHandle, Props>(function CodeMirrorEditor(
  { value, onChange, placeholder, noteTitles = [] },
  ref
): JSX.Element {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Wiki link 自动补全
  const wikiLinkCompletion = useCallback(
    (context: CompletionContext) => {
      const word = context.matchBefore(/\[\[([^\]]*)$/)
      if (!word) return null

      const search = word.text.slice(2).toLowerCase()
      const options = noteTitles
        .filter((t) => t.toLowerCase().includes(search))
        .map((t) => ({
          label: t,
          type: 'text' as const,
          apply: `${t}]]`
        }))

      return { from: word.from + 2, options, validFor: /^[^\]]*$/ }
    },
    [noteTitles]
  )

  useEffect(() => {
    if (!editorRef.current) return

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString())
      }
    })

    const wikiLinkExt = autocompletion({ override: [wikiLinkCompletion] })

    const state = EditorState.create({
      doc: value,
      extensions: [
        markdown({ base: markdownLanguage }),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        placeholderExt(placeholder || '输入 Markdown 内容...'),
        EditorView.lineWrapping,
        updateListener,
        wikiLinkExt,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '14px'
          },
          '.cm-scroller': {
            fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, "Microsoft YaHei", monospace',
            lineHeight: '1.7'
          },
          '.cm-content': {
            padding: '16px'
          },
          '.cm-gutters': {
            backgroundColor: '#fafafa',
            borderRight: '1px solid #f5dfe8',
            color: '#a38d97'
          },
          '.cm-activeLine': {
            backgroundColor: 'rgba(244,113,156,0.06)'
          },
          '.cm-selectionBackground': {
            backgroundColor: 'rgba(244,113,156,0.2) !important'
          },
          '.cm-cursor': {
            borderLeftColor: '#f4719c'
          },
          '.cm-placeholder': {
            color: '#a38d97'
          }
        })
      ]
    })

    const view = new EditorView({
      state,
      parent: editorRef.current
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, []) // 仅在挂载时初始化

  // 当外部 value 变化时同步（如切换笔记）
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const currentValue = view.state.doc.toString()
    if (currentValue !== value) {
      view.dispatch({
        changes: { from: 0, to: currentValue.length, insert: value }
      })
    }
  }, [value])

  // 暴露选中文本获取能力（供注释功能使用）
  useImperativeHandle(ref, () => ({
    getSelectionText: (): string => {
      const view = viewRef.current
      if (!view) return ''
      const { from, to } = view.state.selection.main
      return view.state.sliceDoc(from, to)
    }
  }))

  return <div ref={editorRef} className="h-full w-full" />
})

export default CodeMirrorEditor
