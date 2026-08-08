import { useMemo } from 'react'
import { renderMarkdown } from '../../lib/markdown'

interface Props {
  content: string
  notePath?: string
  onLinkClick?: (target: string) => void
}

export default function MarkdownPreview({ content, notePath, onLinkClick }: Props): JSX.Element {
  const html = useMemo(() => renderMarkdown(content), [content])

  const handleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!onLinkClick) return
    const target = e.target as HTMLElement
    if (target.tagName === 'A' && target.getAttribute('data-wiki-link')) {
      e.preventDefault()
      const linkTarget = target.getAttribute('data-wiki-link') || target.textContent || ''
      onLinkClick(linkTarget.replace(/\.md$/, ''))
    }
  }

  if (!content.trim()) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        暂无内容 — 在编辑器中输入 Markdown 内容
      </div>
    )
  }

  return (
    <div
      className="md-body min-h-0 flex-1 overflow-auto px-5 py-4"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
