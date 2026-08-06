import { marked, type Tokens } from 'marked'
import hljs from 'highlight.js'

marked.setOptions({
  gfm: true,
  breaks: true
})

// 代码高亮扩展（marked v12 token 签名）
marked.use({
  renderer: {
    code(token: Tokens.Code): string {
      const raw = token.text ?? ''
      const lang = token.lang || ''
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
      let html: string
      try {
        html = hljs.highlight(raw, { language }).value
      } catch {
        html = escapeHtml(raw)
      }
      return `<pre data-lang="${language}"><code class="hljs language-${language}">${html}</code></pre>`
    }
  }
})

export function renderMarkdown(text: string): string {
  try {
    return marked.parse(text || '', { async: false }) as string
  } catch {
    return escapeHtml(text)
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    return map[c]
  })
}
