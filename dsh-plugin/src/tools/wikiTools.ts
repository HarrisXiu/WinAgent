import { promises as fs } from 'fs'
import path from 'path'
import matter from 'gray-matter'
import type { Tool } from './types'
import type { VaultManager } from '../wiki/VaultManager'
import type { SearchIndex } from '../wiki/SearchIndex'
import type { ConfigStore } from '../config/ConfigStore'
import { str, num } from './types'
import { runLint, runMerge, runReflect } from '../wiki/WorkflowService'
import { slugifyKebab } from '../wiki/slug'

export function createWikiTools(
  vaultManager: VaultManager,
  searchIndex: SearchIndex,
  store: ConfigStore
): Tool[] {
  return [
    {
      schema: {
        name: 'search_knowledge_base',
        description:
          '在个人知识库中全文搜索笔记（中英文）。返回标题、路径、confidence、AI 摘要与正文片段，通常可直接据此回答。对话中系统已自动注入过检索结果时，本工具用于补充检索或换关键词重试；信息不足时用 retrieve_knowledge 一次取多篇全文。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词或短语' },
            limit: { type: 'integer', description: '返回结果上限，默认 10' }
          },
          required: ['query']
        }
      },
      async run(a) {
        const results = searchIndex.search(str(a.query), num(a.limit, 10))
        if (results.length === 0) return '未找到匹配的笔记。可尝试换关键词（同义词/英文/缩写）重试。'
        return results
          .map(
            (r, i) =>
              `${i + 1}. **${r.title}** (路径: \`${r.path}\`, 相关度: ${r.score.toFixed(2)}${r.confidence ? `, confidence: ${r.confidence}` : ''})${r.summary ? `\n   AI 摘要: ${r.summary}` : ''}\n   > ${r.snippet}`
          )
          .join('\n\n')
      }
    },
    {
      schema: {
        name: 'retrieve_knowledge',
        description:
          '深度检索个人知识库：搜索相关笔记并自动读取其全文，一次性返回组装好的资料上下文（含路径、confidence、正文）。当自动注入的检索结果不够详细、或需要多篇笔记交叉比对时使用。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词或问题主题' },
            limit: { type: 'integer', description: '候选检索数，默认 5' },
            readCount: { type: 'integer', description: '读取全文的篇数（0-3），默认 2' }
          },
          required: ['query']
        }
      },
      async run(a) {
        const query = str(a.query)
        const limit = Math.min(Math.max(num(a.limit, 5), 1), 10)
        const readCount = Math.min(Math.max(num(a.readCount, 2), 0), 3)
        const results = searchIndex.search(query, limit)
        if (results.length === 0) return '未找到匹配的笔记。可尝试换关键词（同义词/英文/缩写）重试。'

        const parts: string[] = []
        const toRead = results.slice(0, readCount)
        for (const r of toRead) {
          try {
            const note = await vaultManager.readNote(r.path)
            const body = note.rawBody.slice(0, 2500)
            parts.push(
              `【${parts.length + 1}】《${r.title}》 ${r.path}${r.confidence ? `  confidence: ${r.confidence}` : ''}${r.sourceCount !== undefined ? `（source_count: ${r.sourceCount}）` : ''}\n${body}${note.rawBody.length > 2500 ? '\n…（正文已截断，可用 read_note 读全文）' : ''}`
            )
          } catch { /* 单篇读取失败跳过 */ }
        }
        const rest = results.slice(readCount)
        const lines = []
        if (parts.length > 0) lines.push(parts.join('\n\n---\n\n'))
        if (rest.length > 0) {
          lines.push(
            '其他相关笔记:\n' +
            rest.map((r) => `- **${r.title}** (\`${r.path}\`${r.confidence ? `, confidence: ${r.confidence}` : ''})${r.summary ? ` ${r.summary.slice(0, 120)}` : ''}`).join('\n')
          )
        }
        return lines.join('\n\n') || '检索到候选但读取失败，可换关键词重试。'
      }
    },
    {
      schema: {
        name: 'read_note',
        description:
          '读取知识库中某篇笔记的完整内容（含元数据：标签、创建时间、AI 摘要等）。建议先用 search_knowledge_base 找到相关笔记路径，需要细节时再用此工具获取全文。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '笔记在 vault 中的相对路径，如 wiki/concepts/attention-mechanism.md' }
          },
          required: ['path']
        }
      },
      async run(a) {
        const note = await vaultManager.readNote(str(a.path))
        return [
          `# ${note.title}`,
          `标签: ${note.tags.join(', ') || '无'}`,
          `创建: ${note.created}  更新: ${note.updated}`,
          note.aiSummary ? `AI 摘要: ${note.aiSummary}` : '',
          `---`,
          note.rawBody,
          note.links.length > 0 ? `\n---\n关联笔记: ${note.links.join(', ')}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      }
    },
    {
      schema: {
        name: 'list_notes',
        description:
          '列出知识库的结构（LLM Wiki 分层：raw 原始文件区 + wiki 编译知识区）。用于浏览知识库的组织，了解有哪些可用的知识。',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      async run(_a) {
        const notes = await vaultManager.listNotes()
        if (notes.length === 0) return '知识库为空，还没有任何笔记。'
        const lines: string[] = ['知识库（LLM Wiki 模式）:', '']
        const render = (items: typeof notes, prefix: string): void => {
          for (const n of items) {
            if (n.kind === 'folder') {
              lines.push(`${prefix}📁 ${n.title}/`)
              if (n.children) render(n.children, prefix + '  ')
            } else {
              const tagStr = n.tags.length ? ` [${n.tags.join(', ')}]` : ''
              lines.push(`${prefix}📄 ${n.title} (\`${n.path}\`)${tagStr}`)
            }
          }
        }
        const rawItems = notes.find((n) => n.kind === 'folder' && n.path === 'raw')
        const wikiItems = notes.find((n) => n.kind === 'folder' && n.path === 'wiki')
        lines.push('📥 raw/ — 原始文件（只读，人类所有）:')
        if (rawItems?.children) render(rawItems.children, '  ')
        lines.push('', '📚 wiki/ — 编译知识（LLM 维护，检索此区域）:')
        if (wikiItems?.children) render(wikiItems.children, '  ')
        for (const n of notes) {
          if (n.kind === 'file') {
            lines.push(`📄 ${n.title} (\`${n.path}\`)`)
          }
        }
        return lines.join('\n')
      }
    },
    {
      schema: {
        name: 'read_raw_file',
        description:
          '读取知识库 raw 层（原始剪藏文件）的完整内容，用于查看来源原文。知识库索引建立在 wiki 编译层上，需要溯源原文时用此工具。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'raw/ 下的相对路径，如 raw/articles/my-article.md' }
          },
          required: ['path']
        }
      },
      async run(a) {
        const rel = str(a.path)
        if (!rel.startsWith('raw/')) return '只允许读取 raw/ 目录下的文件'
        const note = await vaultManager.readNote(rel)
        return `# ${note.title}\n\n${note.rawBody}`
      }
    },
    {
      schema: {
        name: 'add_question',
        description:
          '记录一个开放问题到知识库的 QUESTIONS.md（问题队列）。当用户想搞清楚某个问题、希望在后续摄入中自动匹配答案时使用。',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: '要记录的问题（规范化后的核心疑问）' }
          },
          required: ['question']
        }
      },
      async run(a) {
        const q = str(a.question)
        if (!q) return '问题不能为空'
        await vaultManager.addQuestion(q)
        await vaultManager.appendLog(`add-question | ${q}`)
        return `已将问题加入开放问题队列：${q}\n（后续 INGEST 新来源时若发现能回答该问题，会自动提示）`
      }
    },
    {
      schema: {
        name: 'save_knowledge_output',
        description:
          '将高价值的查询答案/分析结果持久化到 wiki/outputs/（知识库输出层）。当回答用户基于知识库的问题且答案有复用价值时使用，答案不会被对话冲走。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '输出标题（中文）' },
            content: { type: 'string', description: '答案内容（Markdown），结尾应包含 Confidence Notes' }
          },
          required: ['title', 'content']
        }
      },
      async run(a) {
        const title = str(a.title)
        const content = str(a.content)
        if (!title || !content) return '标题和内容不能为空'
        // slug 统一纯英文 kebab（契约 §0），中文标题回退时间戳
        const slug = slugifyKebab(title, 'output')
        const date = new Date().toISOString().slice(0, 10)
        const outPath = `wiki/outputs/${date}-${slug}.md`
        const fm = {
          type: 'query-output',
          title,
          date,
          'graph-excluded': true
        }
        const body = `# ${title}\n\n${content}\n`
        await fs.writeFile(
          path.join(vaultManager.getVaultPath(), outPath),
          matter.stringify(body, fm),
          'utf-8'
        )
        await vaultManager.appendLog(`query-output | ${title} → ${outPath}`)
        return `已持久化到知识库输出层：${outPath}`
      }
    },
    {
      schema: {
        name: 'lint_knowledge_base',
        description:
          '对知识库执行 10 项健康检查（frontmatter/wikilink/索引一致性/stub/重复/哈希完整性/stale/别名重叠/格式/系统文件保护），报告写入 wiki/outputs/。',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      async run(_a) {
        const r = await runLint(vaultManager)
        return r.ok ? r.summary : r.error || 'LINT 失败'
      }
    },
    {
      schema: {
        name: 'merge_knowledge_pages',
        description:
          '合并两个重复的知识库页面（同语言或跨语言）。主 slug 保留，被合并页面的 wikilinks 全部更新，被合并文件替换为重定向文件。执行前必须先与用户确认合并方案（绝不自动合并）。',
        parameters: {
          type: 'object',
          properties: {
            keep: { type: 'string', description: '保留的主 slug（如 first-principles-thinking）' },
            remove: { type: 'string', description: '被合并的 slug（如 first-principle）' },
            area: { type: 'string', description: '页面区域：concepts 或 entities' }
          },
          required: ['keep', 'remove', 'area']
        }
      },
      dangerous: true,
      async run(a) {
        const r = await runMerge(vaultManager, str(a.keep), str(a.remove), str(a.area, 'concepts'))
        return r.ok ? r.summary : r.error || '合并失败'
      }
    },
    {
      schema: {
        name: 'reflect_knowledge_base',
        description:
          '对知识库执行综合分析（Stage 0 完整性核验 → 模式/矛盾/空白/孤立概念识别），生成 synthesis 报告并更新 overview 健康仪表盘。',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      async run(_a) {
        const r = await runReflect(vaultManager, store)
        return r.ok ? r.summary : r.error || 'REFLECT 失败'
      }
    }
  ]
}
