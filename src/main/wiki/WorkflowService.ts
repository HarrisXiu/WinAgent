import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import path from 'path'
import matter from 'gray-matter'
import type { VaultManager } from './VaultManager'
import type { SearchIndex } from './SearchIndex'
import type { ConfigStore } from '../config/ConfigStore'
import type { WorkflowResult } from '../../shared/types'
import { chatStream } from '../llm/OpenAIClient'

/** LINT 结果（UI 需要结构化 issues 与重新摄入列表） */
export interface LintWorkflowResult extends WorkflowResult {
  /** 全部问题行（含检查编号） */
  issues: string[]
  /** 检查 6 SHA-256 变化的 raw 文件路径（UI 提供「重新摄入」按钮） */
  modifiedRawFiles: string[]
}

// ==================== LINT（10 项健康检查） ====================

export async function runLint(vm: VaultManager): Promise<LintWorkflowResult> {
  const today = new Date().toISOString().slice(0, 10)
  const vault = vm.getVaultPath()
  const report: string[] = [`# Lint 报告 ${today}`, '']
  const issues: string[] = []
  const modifiedRawFiles: string[] = []

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
  // 系统文件 id 集合（wikilink 禁止清单：完整路径 + 裸 slug 两种写法都覆盖）
  const systemIds = new Set<string>()
  for (const f of systemPages) {
    systemIds.add(f.replace(/\.md$/, ''))
    systemIds.add(f)
    systemIds.add(path.basename(f).replace(/\.md$/, ''))
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
            modifiedRawFiles.push(rawFile)
          }
        } else {
          issues.push(`⚠ 检查6: ${f} 的 raw 文件不存在（${rawFile}）`)
          modifiedRawFiles.push(rawFile)
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

  // 检查 10: Wikilink 禁止清单（系统文件不得被 wikilink）
  for (const f of pages) {
    const raw = await fs.readFile(path.join(vault, f), 'utf-8')
    const re = /\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(raw)) !== null) {
      const target = m[1].trim().replace(/\\/g, '/')
      if (systemIds.has(target) || systemIds.has(`${target}.md`)) {
        issues.push(`⚠ 检查10 wikilink 禁止: ${f} 链接了系统文件 [[${target}]]（index/log/overview/QUESTIONS/CLAUDE.md 不得被 wikilink）`)
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
  return {
    ok: true,
    reportPath,
    issues,
    modifiedRawFiles,
    summary: `LINT 完成：检查 ${pages.length} 页，发现 ${issues.length} 项问题（报告: ${reportPath}）\n${summary || '✅ 全部通过'}`
  }
}

/** Jaccard 相似度（字符集合） */
export function jaccard(a: string, b: string): number {
  const sa = new Set(a.toLowerCase().split(''))
  const sb = new Set(b.toLowerCase().split(''))
  let inter = 0
  for (const c of sa) if (sb.has(c)) inter++
  const union = sa.size + sb.size - inter
  return union === 0 ? 0 : inter / union
}

// ==================== MERGE（去重合并） ====================

export async function runMerge(vm: VaultManager, keep: string, remove: string, area: string): Promise<WorkflowResult> {
  if (!keep || !remove || keep === remove) {
    return { ok: false, reportPath: '', summary: '', error: '参数错误：keep/remove slug 不能为空且不能相同' }
  }
  const vault = vm.getVaultPath()
  const keepPath = `wiki/${area}/${keep}.md`
  const removePath = `wiki/${area}/${remove}.md`

  const keepAbs = path.join(vault, keepPath)
  const removeAbs = path.join(vault, removePath)
  try {
    await fs.access(removeAbs)
  } catch {
    return { ok: false, reportPath: '', summary: '', error: `被合并页面不存在: ${removePath}` }
  }
  let keepRaw = ''
  try {
    keepRaw = await fs.readFile(keepAbs, 'utf-8')
  } catch {
    return { ok: false, reportPath: '', summary: '', error: `保留页面不存在: ${keepPath}` }
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

  return {
    ok: true,
    reportPath: keepPath,
    summary: `合并完成：${removePath} → ${keepPath}\n- aliases 已合并（${Array.from(aliases).length} 个别名）\n- Sources/Evolution Log 已并集去重\n- 所有引用 [[${remove}]] 的 wikilink 已更新为 [[${keep}]]\n- 被合并文件已替换为 redirect 页`
  }
}

// ==================== REFLECT（综合分析，含 Stage 0 反向检验） ====================

export async function runReflect(vm: VaultManager, store: ConfigStore): Promise<WorkflowResult> {
  const vault = vm.getVaultPath()
  const today = new Date().toISOString().slice(0, 10)

  // === Stage 0 反向检验：核验每个来源的完整性（回音室风险预防） ===
  const stage0 = await runStage0Check(vm)
  const stage0Lines = stage0.map(
    (s) => `- ${s.path}: ${s.status === 'ok' ? '✅ 通过' : `⚠ ${s.reason}`}`
  )
  const stage0Issues = stage0.filter((s) => s.status !== 'ok')
  const degradeHint = stage0Issues.length
    ? `\n以下来源未通过完整性校验，综合时降低其权重：\n${stage0Issues.map((s) => `- ${s.path}（${s.reason}）`).join('\n')}`
    : ''
  const echoChamberHint = '\n若知识库中没有与候选结论相矛盾的来源，必须在 Limitations 中标注「⚠ 回音室风险：未找到反驳来源，结论可能存在确认偏差」'

  // 收集所有概念/实体/来源页面（标题 + 摘要级内容）
  const concepts = await collectPageBriefs(vault, 'concepts', 400)
  const entities = await collectPageBriefs(vault, 'entities', 300)
  const sources = await collectPageBriefs(vault, 'sources', 500)

  const provider = store.activeProvider()
  if (!provider) {
    return { ok: false, reportPath: '', summary: '', error: '没有可用的 AI 模型，请先在设置中配置' }
  }

  const messages = [
    {
      role: 'system',
      content: `你是知识库综合分析引擎。基于知识库内容执行 REFLECT（Stage 0 反向检验 → 模式扫描 → 矛盾检测 → Gap Analysis）。
输出严格 JSON：
{
  "patterns": ["跨来源的 1-3 个模式/隐性关联"],
  "contradictions": ["发现的矛盾对（来源间冲突，若无则空数组）"],
  "gaps": ["内容空白/盲区（多处提及但无独立页面、覆盖稀薄的主题，若无则空数组）"],
  "orphans": ["孤立概念：source_count=1 或长期无更新的页面 slug"],
  "synthesis": "一段综合洞察（200 字内）"
}
反向检验要求：在生成结论前主动寻找与候选结论相矛盾的证据；若找不到反对声音，在 synthesis 中明确标注确认偏差风险。${echoChamberHint}${degradeHint}`
    },
    {
      role: 'user',
      content: `知识库概念（${concepts.length}）:\n${concepts.join('\n---\n')}\n\n实体（${entities.length}）:\n${entities.join('\n')}\n\n来源（${sources.length}）:\n${sources.join('\n')}`
    }
  ]
  const result = await chatStream(provider, messages as any, { temperature: 0.3, maxTokens: 1500, stream: false })
  const parsed = parseReflectJson(result.content)
  if (!parsed) {
    return { ok: false, reportPath: '', summary: '', error: `REFLECT 分析失败：LLM 输出无法解析（${result.content.slice(0, 200)}）` }
  }

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
    `## Stage 0 反向检验`,
    ``,
    stage0Lines.join('\n') || '（无）',
    ``,
    `## Sources`,
    ``,
    `（参见 wiki/index.md 索引）`,
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
      `# Gap Report ${today}\n\n## 孤立概念\n\n${(parsed.orphans || []).map((o: string) => `- ${o}`).join('\n') || '（无）'}\n\n## 内容空白\n\n${(parsed.gaps || []).map((g: string) => `- ${g}`).join('\n') || '（无）'}\n\n## Stage 0 反向检验\n\n${stage0Lines.join('\n') || '（无）'}\n`,
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

  return {
    ok: true,
    reportPath: synthesisPath,
    summary: `REFLECT 完成 → ${synthesisPath}\n\n🔍 模式:\n${(parsed.patterns || []).map((p: string) => `- ${p}`).join('\n') || '（无）'}\n\n⚠ 矛盾:\n${(parsed.contradictions || []).map((c: string) => `- ${c}`).join('\n') || '（无）'}\n\n📭 空白:\n${(parsed.gaps || []).map((g: string) => `- ${g}`).join('\n') || '（无）'}\n\n🕳 孤立概念:\n${(parsed.orphans || []).map((o: string) => `- ${o}`).join('\n') || '（无）'}\n\n🔎 Stage 0 反向检验: ${stage0Issues.length ? stage0Issues.length + ' 个来源未通过完整性校验' : '全部通过'}`
  }
}

/** Stage 0 反向检验：核验每个 source 页的 raw_file 存在性 + SHA-256 一致 + possibly_outdated */
export async function runStage0Check(vm: VaultManager): Promise<Array<{ path: string; status: 'ok' | 'raw-missing' | 'sha-mismatch' | 'outdated'; reason: string }>> {
  const vault = vm.getVaultPath()
  const sourceDir = path.join(vault, 'wiki/sources')
  const files = await fs.readdir(sourceDir).catch(() => [])
  const results: Array<{ path: string; status: 'ok' | 'raw-missing' | 'sha-mismatch' | 'outdated'; reason: string }> = []
  for (const f of files.filter((f) => f.endsWith('.md'))) {
    try {
      const raw = await fs.readFile(path.join(sourceDir, f), 'utf-8')
      const parsed = matter(raw)
      const fm = parsed.data as Record<string, any>
      const rawFile = typeof fm.raw_file === 'string' ? fm.raw_file : ''
      const expected = typeof fm.raw_sha256 === 'string' ? fm.raw_sha256 : ''
      const outdated = fm.possibly_outdated === true || fm.possibly_outdated === 'true'
      let status: 'ok' | 'raw-missing' | 'sha-mismatch' | 'outdated' = 'ok'
      let reason = ''
      if (!rawFile) {
        status = 'raw-missing'
        reason = '缺少 raw_file 字段'
      } else {
        const buf = await fs.readFile(path.join(vault, rawFile)).catch(() => null)
        if (!buf) {
          status = 'raw-missing'
          reason = `raw 文件不存在（${rawFile}）`
        } else if (expected) {
          const actual = createHash('sha256').update(buf).digest('hex')
          if (actual !== expected) {
            status = 'sha-mismatch'
            reason = `SHA-256 不匹配（${rawFile} 已被修改）`
          }
        }
      }
      if (status === 'ok' && outdated) {
        status = 'outdated'
        reason = 'possibly_outdated：来源已超过 2 年'
      }
      results.push({ path: `sources/${f.replace(/\.md$/, '')}`, status, reason: reason || '通过完整性校验' })
    } catch { /* skip */ }
  }
  return results
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

// ==================== QUERY（检索问答，溯源 + Confidence Notes） ====================

export async function runQuery(
  vm: VaultManager,
  searchIndex: SearchIndex,
  store: ConfigStore,
  query: string
): Promise<WorkflowResult> {
  const q = (query || '').trim()
  if (!q) return { ok: false, reportPath: '', summary: '', error: '问题不能为空' }
  const vault = vm.getVaultPath()
  const today = new Date().toISOString().slice(0, 10)

  // 1. 检索最相关的 5 篇（优先 sources/concepts 编译层）
  const results = searchIndex.search(q, 5)
  if (results.length === 0) {
    return { ok: false, reportPath: '', summary: '', error: '知识库中没有找到与问题相关的内容，请先摄入相关资料或换一种问法' }
  }

  // 2. 读取候选笔记全文（含溯源路径）
  const contextBlocks: string[] = []
  const readCount = Math.min(results.length, 3)
  for (let i = 0; i < readCount; i++) {
    try {
      const note = await vm.readNote(results[i].path)
      contextBlocks.push(
        `【候选 ${i + 1}】路径: ${note.path}（标题: ${note.title}）\n${note.rawBody.slice(0, 2500)}`
      )
    } catch { /* skip */ }
  }
  if (contextBlocks.length === 0) {
    return { ok: false, reportPath: '', summary: '', error: '检索结果无法读取' }
  }

  // 3. LLM 综合：强制溯源 + Confidence Notes + 证据不足明说
  const provider = store.activeProvider()
  if (!provider) {
    return { ok: false, reportPath: '', summary: '', error: '没有可用的 AI 模型，请先在设置中配置' }
  }
  let contract = ''
  try {
    contract = (await fs.readFile(path.join(vault, 'CLAUDE.md'), 'utf-8')).slice(0, 1500)
  } catch { /* 无契约 */ }
  const contractRule = contract ? `\n\n=== 知识库行为契约（CLAUDE.md，必须遵守）===\n${contract}` : ''

  const messages = [
    {
      role: 'system',
      content: `你是个人知识库的问答引擎。基于下方提供的候选笔记回答用户问题。
强制要求：
1. 每条核心主张必须标注来源路径（如 [[source-slug]]），不允许只引用概念页而不溯源到 sources。
2. 按 confidence 分层表述：high=用户背书或 ≥5 源一致；medium=≥3 源；low=单源或不确定。
3. 证据不足时明确说明「知识库中证据不足」，绝不编造。
4. 输出 Markdown，结尾必须包含「## ⚠ Confidence Notes」节，列出所有 low/medium 置信度的引用及其原因，以及「## Limitations」节（含回音室风险提示：若未找到反驳来源需标注）。${contractRule}`
    },
    {
      role: 'user',
      content: `问题：${q}\n\n=== 候选笔记 ===\n${contextBlocks.join('\n\n---\n\n')}`
    }
  ]
  const result = await chatStream(provider, messages as any, { temperature: 0.3, maxTokens: 2000, stream: false })
  const answer = result.content.trim()

  // 4. 落盘 wiki/outputs/（type: query-output, graph-excluded）
  const slug = q
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
  const outPath = `wiki/outputs/${today}-query-${slug || 'answer'}.md`
  await fs.mkdir(path.join(vault, 'wiki/outputs'), { recursive: true })
  const body = `# ${q}\n\n> 检索自 ${readCount} 篇笔记，生成于 ${today}\n\n${answer}\n`
  await fs.writeFile(
    path.join(vault, outPath),
    matter.stringify(body, { type: 'query-output', title: q, date: today, 'graph-excluded': true }),
    'utf-8'
  )
  await vm.appendLog(`query | ${q.slice(0, 40)} → ${outPath}`)

  return {
    ok: true,
    reportPath: outPath,
    summary: `AI 问答完成 → ${outPath}\n\n${answer.slice(0, 500)}${answer.length > 500 ? '…' : ''}`
  }
}
