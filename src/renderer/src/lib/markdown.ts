import { marked } from 'marked'
import hljs from 'highlight.js'

marked.setOptions({
  gfm: true,
  breaks: true
})

// 代码高亮扩展
marked.use({
  renderer: {
    code(code: string, infostring: string | undefined, _escaped: boolean): string | false {
      const lang = infostring || ''
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
      let html: string
      try {
        html = hljs.highlight(code, { language }).value
      } catch {
        html = escapeHtml(code)
      }
      return `<pre data-lang="${language}"><code class="hljs language-${language}">${html}</code></pre>`
    }
  }
})

/** 预处理 [[wiki links]]，转为 data-wiki-link 属性链接 */
function preprocessWikiLinks(text: string): string {
  // [[target]] -> [target](...)  with data-wiki-link
  return text.replace(
    /\[\[([^\]|#]+)(?:[|#]([^\]]+))?\]\]/g,
    (_match, target: string, alias: string) => {
      const label = alias || target
      const encoded = target.trim().replace(/"/g, '&quot;')
      return `[${label.trim()}](#){"data-wiki-link":"${encoded}"}`
    }
  )
}

export function renderMarkdown(text: string): string {
  try {
    const processed = preprocessWikiLinks(text)
    let html = marked.parse(processed || '', { async: false }) as string
    // 还原 data-wiki-link 属性到 <a> 标签
    html = html.replace(/<a href="#">\{"data-wiki-link":"([^"]+)"\}<\/a>/g, (_m, target: string) => {
      return `<a href="#" data-wiki-link="${target}" class="wiki-link">${target}</a>`
    })
    // 处理包含文本的链接 [alias](#){"data-wiki-link":"target"}
    html = html.replace(/<a href="#">\{&quot;data-wiki-link&quot;:&quot;([^&]+)&quot;\}<\/a>/g, (_m, target: string) => {
      return `<a href="#" data-wiki-link="${target}" class="wiki-link">${target}</a>`
    })
    return html
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
