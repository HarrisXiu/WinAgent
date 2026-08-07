import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import path from 'path'
import matter from 'gray-matter'
import type { Tool } from './types'
import type { VaultManager } from '../wiki/VaultManager'
import type { SearchIndex } from '../wiki/SearchIndex'
import type { ConfigStore } from '../config/ConfigStore'
import { str, num } from './types'

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
          '对知识库执行健康检查（LLM Wiki LINT），运行 9 项检查：frontmatter 合法性、broken wikilinks、索引一致性、stub 页面、近重复概念、SHA-256 完整性、stale 页面、跨语言重复、wikilink 格式。报告写入 wiki/outputs/lint-日期.md。',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      async run(_a) {
        return runLint(vaultManager)
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
        return runMerge(vaultManager, str(a.keep), str(a.remove), str(a.area, 'concepts'))
      }
    },
    {
      schema: {
        name: 'reflect_knowledge_base',
        description:
          '对知识库执行综合分析（LLM Wiki REFLECT）：反向检验 → 模式扫描 → 深度合成 → Gap Analysis。识别跨来源模式、矛盾对、内容空白、孤立概念，生成 synthesis 报告并更新 overview.md 健康仪表盘。',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      async run(_a) {
        return runReflect(vaultManager, store)
      }
    }
  ]
}

// ==================== LINT（9 项健康检查） ====================

async function runLint(vm: VaultManager): Promise<string> {
  const today = new Date().toISOString().slice(0, 10)
  const vault = vm.getVaultPath()
  const report: string[] = [`# Lint 报告 ${today}`, '']
  const issues: string[] = []

  // 收集 wiki/ 下所有页面文件（排除系统文件、templates、outputs）
  const allFiles: string[] = []
  const collect = async (dir: string, rel: string): Promise<void> => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        if (e.isDirectory()) {
          await collect(path.join(dir, e.name), `${rel}/${e.name}`)
        } else if (e.name.endsWith('.md')) {
          allFiles.push(`${rel}/${e.name}`.replace(/\\/g, '/').replace(/^\//, ''))
        }
      }
    } catch { /* ignore */ }
  }
  await collect(path.join(vault, 'wiki'), 'wiki')
  const pages = allFiles.filter(
    (f) => !vm.isSystemFile(f) && !f.startsWith('wiki/templates/') && !f.startsWith('wiki/outputs/')
  )
  const systemPages = allFiles.filter((f) => vm.isSystemFile(f))

  // 所有页面名集合（用于 wikilink 解析，含 .md 和后缀剥离两种形式）
  const pageIds = new Set<string>()
  for (const f of allFiles) {
    pageIds.add(f.replace(/\.md$/, ''))
    pageIds.add(f)
  }

  // 检查 1: frontmatter 合法性
  const fmBad: string[] = []
  for (const f of pages) {
    try {
      const raw = await fs.readFile(path.join(vault, f), 'utf-8')
      const parsed = matter(raw)
      if (!parsed.data || typeof parsed.data.type !== 'string' || !parsed.data.date) {
        fmBad.push(f)
      }
    } catch {
      fmBad.push(f)
    }
  }
  issues.push(...fmBad.map((f) => `⚠ 检查1 frontmatter: ${f} 缺少 type/date`))

  // 检查 2: Broken Wikilinks
  const brokenLinks: string[] = []
  for (const f of pages) {
    const raw = await fs.readFile(path.join(vault, f), 'utf-8')
    const re = /\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(raw)) !== null) {
      const target = m[1].trim().replace(/\\/g, '/')
      const targetId = target.endsWith('.md') ? target : `${target}.md`
      const exists = Array.from(pageIds).some((id) => {
        const base = id.replace(/\.md$/, '')
        return base === target || id === targetId || id === target
      })
      if (!exists) brokenLinks.push(`${f} → [[${target}]]`)
    }
  }
  issues.push(...brokenLinks.map((b) => `⚠ 检查2 broken-wikilink: ${b}`))

  // 检查 3: Index 一致性
  const indexRaw = await fs.readFile(path.join(vault, 'wiki/index.md'), 'utf-8').catch(() => '')
  const indexLinks = [...indexRaw.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1])
  const indexMissing = indexLinks.filter((l) => !pageIds.has(`${l}.md`) && !pageIds.has(l))
  issues.push(...indexMissing.map((l) => `⚠ 检查3 index: index.md 引用了不存在的页面 [[${l}]]`))

  // 检查 4: Stub 页面（正文 < 100 字）
  for (const f of pages) {
    try {
      const raw = await fs.readFile(path.join(vault, f), 'utf-8')
      const parsed = matter(raw)
      const bodyLen = parsed.content.trim().length
      if (bodyLen > 0 && bodyLen < 100) issues.push(`⚠ 检查4 stub: ${f} 正文仅 ${bodyLen} 字`)
    } catch { /* skip */ }
  }

  // 检查 5: 近重复概念（slug Jaccard > 0.7）
  const conceptDir = path.join(vault, 'wiki/concepts')
  const conceptSlugs = await fs.readdir(conceptDir).catch(() => [])
  const mdSlugs = conceptSlugs.filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
  for (let i = 0; i < mdSlugs.length; i++) {
    for (let j = i + 1; j < mdSlugs.length; j++) {
      const sim = jaccard(mdSlugs[i], mdSlugs[j])
      if (sim > 0.7) issues.push(`⚠ 检查5 近重复: "${mdSlugs[i]}" 与 "${mdSlugs[j]}" Jaccard=${sim.toFixed(2)}`)
    }
  }

  // 检查 6: SHA-256 完整性（source 页 raw_sha256 vs raw 文件）
  const sourceDir = path.join(vault, 'wiki/sources')
  const sourceFiles = await fs.readdir(sourceDir).catch(() => [])
  for (const f of sourceFiles.filter((f) => f.endsWith('.md'))) {
    try {
      const raw = await fs.readFile(path.join(sourceDir, f), 'utf-8')
      const parsed = matter(raw)
      const fm = parsed.data as Record<string, any>
      const rawFile = fm.raw_file
      const expected = fm.raw_sha256
      if (typeof rawFile === 'string' && typeof expected === 'string') {
        const buf = await fs.readFile(path.join(vault, rawFile)).catch(() => null)
        if (buf) {
          const actual = createHash('sha256').update(buf).digest('hex')
          if (actual !== expected) {
            issues.push(`⚠ 检查6 SOURCE MODIFIED: ${f} 的 raw 文件哈希已变化（${rawFile}）`)
          }
        } else {
          issues.push(`⚠ 检查6: ${f} 的 raw 文件不存在（${rawFile}）`)
        }
      }
    } catch { /* skip */ }
  }

  // 检查 7: Stale 页面（domain_volatility 阈值 high=90/medium=180/low=365 天）
  const staleThreshold: Record<string, number> = { high: 90, medium: 180, low: 365 }
  for (const f of pages.filter((f) => f.startsWith('wiki/concepts/'))) {
    try {
      const raw = await fs.readFile(path.join(vault, f), 'utf-8')
      const parsed = matter(raw)
      const fm = parsed.data as Record<string, any>
      const vol = fm.domain_volatility || 'medium'
      const lastReviewed = fm.last_reviewed || fm.date || ''
      if (lastReviewed) {
        const days = (Date.now() - new Date(lastReviewed).getTime()) / 86400000
        if (days > (staleThreshold[vol] || 180)) {
          issues.push(`⚠ 检查7 stale: ${f} 已 ${Math.floor(days)} 天未更新（volatility=${vol}）`)
        }
      }
    } catch { /* skip */ }
  }

  // 检查 8: 跨语言重复（concept 页 aliases 重叠）
  const aliasMaps: Array<{ file: string; aliases: string[] }> = []
  for (const f of pages.filter((f) => f.startsWith('wiki/concepts/'))) {
    try {
      const raw = await fs.readFile(path.join(vault, f), 'utf-8')
      const parsed = matter(raw)
      const aliases: string[] = Array.isArray(parsed.data.aliases) ? parsed.data.aliases : []
      aliasMaps.push({ file: f, aliases: aliases.map((x) => String(x).toLowerCase()) })
    } catch { /* skip */ }
  }
  for (let i = 0; i < aliasMaps.length; i++) {
    for (let j = i + 1; j < aliasMaps.length; j++) {
      const overlap = aliasMaps[i].aliases.filter((a) => aliasMaps[j].aliases.includes(a))
      if (overlap.length > 0) {
        issues.push(`⚠ 检查8 别名重叠: ${aliasMaps[i].file} 与 ${aliasMaps[j].file} 共享别名 [${overlap.join(', ')}]`)
      }
    }
  }

  // 检查 9: Wikilink 格式（非英文小写连字符）
  for (const f of pages) {
    const raw = await fs.readFile(path.join(vault, f), 'utf-8')
    const re = /\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(raw)) !== null) {
      const target = m[1].trim()
      if (/[^\x00-\x7F]/.test(target)) {
        issues.push(`⚠ 检查9 wikilink 格式: ${f} 使用了非英文 slug [[${target}]]（应改为英文小写连字符 + aliases）`)
      } else if (!/^[a-z0-9\-]+$/.test(target.replace(/\.md$/, ''))) {
        issues.push(`⚠ 检查9 wikilink 格式: ${f} [[${target}]] 含非法字符`)
      }
    }
  }

  // 汇总 + 写入报告
  report.push(`共检查 ${pages.length} 个页面（${systemPages.length} 个系统文件排除）`)
  report.push(`发现问题 ${issues.length} 项：`, '')
  report.push(issues.length ? issues.map((i) => `- ${i}`).join('\n') : '✅ 全部通过，无问题。', '')
  const reportBody = report.join('\n')
  const reportPath = `wiki/outputs/lint-${today}.md`
  await fs.mkdir(path.join(vault, 'wiki/outputs'), { recursive: true })
  await fs.writeFile(
    path.join(vault, reportPath),
    matter.stringify(reportBody, { type: 'lint-report', date: today, 'graph-excluded': true }),
    'utf-8'
  )
  await vm.appendLog(`lint | 发现 ${issues.length} 项问题 → ${reportPath}`)

  const summary = issues.slice(0, 15).join('\n')
  return `LINT 完成：检查 ${pages.length} 页，发现 ${issues.length} 项问题（报告: ${reportPath}）\n${summary || '✅ 全部通过'}`
}

/** Jaccard 相似度（字符集合） */
function jaccard(a: string, b: string): number {
  const sa = new Set(a.toLowerCase().split(''))
  const sb = new Set(b.toLowerCase().split(''))
  let inter = 0
  for (const c of sa) if (sb.has(c)) inter++
  const union = sa.size + sb.size - inter
  return union === 0 ? 0 : inter / union
}

// ==================== MERGE（去重合并） ====================

async function runMerge(vm: VaultManager, keep: string, remove: string, area: string): Promise<string> {
  if (!keep || !remove || keep === remove) return '参数错误：keep/remove slug 不能为空且不能相同'
  const vault = vm.getVaultPath()
  const keepPath = `wiki/${area}/${keep}.md`
  const removePath = `wiki/${area}/${remove}.md`

  const keepAbs = path.join(vault, keepPath)
  const removeAbs = path.join(vault, removePath)
  try {
    await fs.access(removeAbs)
  } catch {
    return `被合并页面不存在: ${removePath}`
  }
  let keepRaw = ''
  try {
    keepRaw = await fs.readFile(keepAbs, 'utf-8')
  } catch {
    return `保留页面不存在: ${keepPath}`
  }

  const keepParsed = matter(keepRaw)
  const removeParsed = matter(await fs.readFile(removeAbs, 'utf-8'))
  const keepFm = keepParsed.data as Record<string, any>
  const removeFm = removeParsed.data as Record<string, any>

  // 1. aliases 并集
  const aliases = new Set<string>([
    ...(Array.isArray(keepFm.aliases) ? keepFm.aliases : []),
    ...(Array.isArray(removeFm.aliases) ? removeFm.aliases : []),
    keepFm.title,
    removeFm.title
  ].filter(Boolean))
  keepFm.aliases = Array.from(aliases)

  // 2. 合并正文：Sources 段并集去重 + Evolution Log 合并 + 追加内容
  const keepBody = keepParsed.content
  const removeBody = removeParsed.content
  const mergeSection = (body: string, section: string): string[] => {
    const re = new RegExp(`## ${section}[\\s\\S]*?(?=\\n## |$)`)
    const m = body.match(re)
    if (!m) return []
    return m[0].split('\n').filter((l) => l.trim() && !l.trim().startsWith('##')).map((l) => l.trim())
  }
  const mergeSources = (body: string): string[] => {
    const re = /## Sources[\s\S]*?(?=\n## |$)/
    const m = body.match(re)
    if (!m) return []
    return m[0].split('\n').filter((l) => l.trim().startsWith('- [[')).map((l) => l.trim())
  }

  const sources = new Set([...mergeSources(keepBody), ...mergeSources(removeBody)])
  const evolution = new Set([...mergeSection(keepBody, 'Evolution Log'), ...mergeSection(removeBody, 'Evolution Log')])
  const newBody = keepBody
    .replace(/## Evolution Log[\s\S]*?(\n## |$)/, (match) => {
      const rest = match.split('\n').filter((l) => l.trim().startsWith('## ')).join('\n')
      const merged = Array.from(evolution).map((l) => `- ${l.replace(/^-\s*/, '')}`).join('\n')
      return `## Evolution Log\n\n${merged}\n\n${rest}`
    })
    .replace(/## Sources[\s\S]*?(\n## |$)/, (match) => {
      const rest = match.split('\n').filter((l) => l.trim().startsWith('## ')).join('\n')
      const merged = Array.from(sources).join('\n')
      return `## Sources\n\n${merged}\n\n${rest}`
    })
    .trimEnd()

  // 3. 更新所有 wiki 页面中的 wikilinks
  const collectAll = async (): Promise<string[]> => {
    const files: string[] = []
    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        if (e.isDirectory()) {
          await walk(path.join(dir, e.name))
        } else if (e.name.endsWith('.md')) {
          files.push(path.join(dir, e.name))
        }
      }
    }
    await walk(path.join(vault, 'wiki'))
    return files
  }
  const wikiFiles = await collectAll()
  for (const f of wikiFiles) {
    if (f === removeAbs) continue
    const raw = await fs.readFile(f, 'utf-8')
    if (raw.includes(`[[${remove}]]`)) {
      const updated = raw.split(`[[${remove}]]`).join(`[[${keep}]]`)
      await fs.writeFile(f, updated, 'utf-8')
    }
  }

  // 4. 写回保留页 + 被合并页替换为 redirect
  await fs.writeFile(keepAbs, matter.stringify(newBody, keepFm), 'utf-8')
  await fs.writeFile(
    removeAbs,
    matter.stringify(`> 此页面已被合并到 [[${keep}]]。`, { redirect: `wiki/${area}/${keep}` }),
    'utf-8'
  )
  await vm.appendLog(`merge | ${area}/${remove} → ${area}/${keep}`)

  return `合并完成：${removePath} → ${keepPath}\n- aliases 已合并（${Array.from(aliases).length} 个别名）\n- Sources/Evolution Log 已并集去重\n- 所有引用 [[${remove}]] 的 wikilink 已更新为 [[${keep}]]\n- 被合并文件已替换为 redirect 页`
}

// ==================== REFLECT（综合分析） ====================

async function runReflect(vm: VaultManager, store: ConfigStore): Promise<string> {
  const vault = vm.getVaultPath()
  const today = new Date().toISOString().slice(0, 10)

  // 收集所有概念/实体/来源页面（标题 + 摘要级内容）
  const concepts = await collectPageBriefs(vault, 'concepts', 400)
  const entities = await collectPageBriefs(vault, 'entities', 300)
  const sources = await collectPageBriefs(vault, 'sources', 500)

  const provider = store.activeProvider()
  if (!provider) return '没有可用的 AI 模型，请先在设置中配置'

  const { chatStream } = await import('../llm/OpenAIClient')
  const messages = [
    {
      role: 'system',
      content: `你是知识库综合分析引擎。基于知识库内容执行 REFLECT（反向检验 + 模式扫描 + Gap Analysis）。
输出严格 JSON：
{
  "patterns": ["跨来源的 1-3 个模式/隐性关联"],
  "contradictions": ["发现的矛盾对（来源间冲突，若无则空数组）"],
  "gaps": ["内容空白/盲区（多处提及但无独立页面、覆盖稀薄的主题，若无则空数组）"],
  "orphans": ["孤立概念：source_count=1 或长期无更新的页面 slug"],
  "synthesis": "一段综合洞察（200 字内）"
}`
    },
    {
      role: 'user',
      content: `知识库概念（${concepts.length}）:\n${concepts.join('\n---\n')}\n\n实体（${entities.length}）:\n${entities.join('\n')}\n\n来源（${sources.length}）:\n${sources.join('\n')}`
    }
  ]
  const result = await chatStream(provider, messages as any, { temperature: 0.3, maxTokens: 1500, stream: false })
  const parsed = parseReflectJson(result.content)
  if (!parsed) return `REFLECT 分析失败：LLM 输出无法解析（${result.content.slice(0, 200)}）`

  // 写入 synthesis 页
  const synthesisBody = [
    `# 综合分析 ${today}`,
    ``,
    `## Thesis`,
    ``,
    parsed.synthesis || '（无）',
    ``,
    `## Patterns`,
    ``,
    (parsed.patterns || []).map((p: string) => `- ${p}`).join('\n') || '（无）',
    ``,
    `## Contradictions`,
    ``,
    (parsed.contradictions || []).map((c: string) => `- ${c}`).join('\n') || '（无）',
    ``,
    `## Gap Analysis`,
    ``,
    (parsed.gaps || []).map((g: string) => `- ${g}`).join('\n') || '（无）',
    ``,
    `## Orphans`,
    ``,
    (parsed.orphans || []).map((o: string) => `- ${o}`).join('\n') || '（无）',
    ``,
    `## Sources`,
    ``,
    `- [[index]]`,
    ``
  ].join('\n')
  const synthesisPath = `wiki/synthesis/reflect-${today}-synthesis.md`
  await fs.mkdir(path.join(vault, 'wiki/synthesis'), { recursive: true })
  await fs.writeFile(
    path.join(vault, synthesisPath),
    matter.stringify(synthesisBody, { type: 'synthesis', title: `综合分析 ${today}`, date: today, source_count: sources.length, confidence: 'medium' }),
    'utf-8'
  )

  // 写入 gap 报告
  const gapPath = `wiki/outputs/gap-report-${today}.md`
  await fs.mkdir(path.join(vault, 'wiki/outputs'), { recursive: true })
  await fs.writeFile(
    path.join(vault, gapPath),
    matter.stringify(
      `# Gap Report ${today}\n\n## 孤立概念\n\n${(parsed.orphans || []).map((o: string) => `- ${o}`).join('\n') || '（无）'}\n\n## 内容空白\n\n${(parsed.gaps || []).map((g: string) => `- ${g}`).join('\n') || '（无）'}\n`,
      { type: 'gap-report', date: today, 'graph-excluded': true }
    ),
    'utf-8'
  )

  // 更新 overview
  await vm.updateOverview({
    '总来源数': sources.length,
    '概念数': concepts.length,
    '实体数': entities.length,
    '孤立概念数': (parsed.orphans || []).length,
    '开放问题数': (await vm.getOpenQuestions()).length,
    '最近综合分析': today
  })
  await vm.appendLog(`reflect | 综合分析完成，模式 ${(parsed.patterns || []).length} 个，空白 ${(parsed.gaps || []).length} 个 → ${synthesisPath}`)

  return `REFLECT 完成 → ${synthesisPath}\n\n🔍 模式:\n${(parsed.patterns || []).map((p: string) => `- ${p}`).join('\n') || '（无）'}\n\n⚠ 矛盾:\n${(parsed.contradictions || []).map((c: string) => `- ${c}`).join('\n') || '（无）'}\n\n📭 空白:\n${(parsed.gaps || []).map((g: string) => `- ${g}`).join('\n') || '（无）'}\n\n🕳 孤立概念:\n${(parsed.orphans || []).map((o: string) => `- ${o}`).join('\n') || '（无）'}`
}

async function collectPageBriefs(vault: string, area: string, maxLen: number): Promise<string[]> {
  const dir = path.join(vault, 'wiki', area)
  const files = await fs.readdir(dir).catch(() => [])
  const briefs: string[] = []
  for (const f of files.filter((f) => f.endsWith('.md'))) {
    try {
      const raw = await fs.readFile(path.join(dir, f), 'utf-8')
      const parsed = matter(raw)
      const fm = parsed.data as Record<string, any>
      const title = fm.title || f.replace(/\.md$/, '')
      const content = parsed.content.trim().slice(0, maxLen)
      briefs.push(`【${title}】${content}`)
    } catch { /* skip */ }
  }
  return briefs
}

function parseReflectJson(text: string): any | null {
  if (!text) return null
  try { return JSON.parse(text.trim()) } catch { /* continue */ }
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()) } catch { /* continue */ }
  }
  const objMatch = text.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try { return JSON.parse(objMatch[0]) } catch { /* fail */ }
  }
  return null
}
