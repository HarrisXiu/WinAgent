import { promises as fs } from 'fs'
import path from 'path'
import matter from 'gray-matter'
import type { Tool } from './types'
import type { VaultManager } from '../wiki/VaultManager'
import type { SearchIndex } from '../wiki/SearchIndex'
import type { ConfigStore } from '../config/ConfigStore'
import { str, num } from './types'
import { runLint, runMerge, runReflect } from '../wiki/WorkflowService'

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
          '在个人知识库中全文搜索笔记。支持中英文搜索，返回匹配的笔记路径、标题、摘录和相关性评分。当用户询问某主题是否在知识库中有相关资料时优先使用此工具。',
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
        if (results.length === 0) return '未找到匹配的笔记。'
        return results
          .map(
            (r, i) =>
              `${i + 1}. **${r.title}** (路径: \`${r.path}\`, 相关度: ${r.score.toFixed(2)})\n   > ${r.snippet}`
          )
          .join('\n\n')
      }
    },
    {
      schema: {
        name: 'read_note',
        description:
          '读取知识库中某篇笔记的完整内容（含元数据：标签、创建时间、AI 摘要等）。建议先用 search_knowledge_base 找到相关笔记路径，再用此工具获取全文。',
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
        const slug = title.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/-+/g, '-').slice(0, 40)
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
          '对知识库执行健康检查（LLM Wiki LINT），运行 10 项检查：frontmatter 合法性、broken wikilinks、索引一致性、stub 页面、近重复概念、SHA-256 完整性、stale 页面、跨语言重复、wikilink 格式、系统文件被 wikilink。报告写入 wiki/outputs/lint-日期.md。',
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
      async run(a) {
        const r = await runMerge(vaultManager, str(a.keep), str(a.remove), str(a.area, 'concepts'))
        return r.ok ? r.summary : r.error || '合并失败'
      }
    },
    {
      schema: {
        name: 'reflect_knowledge_base',
        description:
          '对知识库执行综合分析（LLM Wiki REFLECT）：Stage 0 反向检验（完整性核验 + 回音室检查）→ 模式扫描 → 深度合成 → Gap Analysis。识别跨来源模式、矛盾对、内容空白、孤立概念，生成 synthesis 报告并更新 overview.md 健康仪表盘。',
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
