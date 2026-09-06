/**
 * Office 生成工具族：markdown_to_docx / write_xlsx / write_pptx。
 * 模式一致：模型产出结构化内容（Markdown / JSON），本模块做确定性序列化。
 * markdown_to_docx 双引擎：检测到 pandoc 优先（样式/公式更成熟），否则内置纯 JS DocxBuilder 链。
 * @module dsh-winagent/office-tools
 */
import { promises as fs } from 'fs'
import { spawnSync } from 'child_process'
import os from 'os'
import path from 'path'
import * as XLSX from 'xlsx'
import PptxGenJS from 'pptxgenjs'
import type { Tool } from './types'
import { str, num, bool } from './types'
import { buildDocx, ensureMathEngines, type DocBlock, type BuildOptions } from '../docx/DocxBuilder'
import { getCapabilities } from '../util/capabilities'
import { runPowerShell, psQuote } from '../util/powershell'
import { Logger } from '../util/Logger'

// ── 通用辅助 ──────────────────────────────────────

/** 保存路径解析：相对路径基于 cwd，补齐扩展名 */
function resolveSavePath(savePath: string, ext: string): string {
  const out = path.isAbsolute(savePath) ? savePath : path.resolve(savePath)
  return out.toLowerCase().endsWith(ext) ? out : out + ext
}

async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

/** 解析数组参数（接受 JSON 字符串或已解析数组） */
function parseArrayArg(v: unknown, label: string): any[] {
  let arr: any = v
  if (typeof v === 'string') {
    try {
      arr = JSON.parse(v)
    } catch (e: any) {
      throw new Error(`${label} JSON 解析失败: ${e.message}（前100字符: ${v.slice(0, 100)}）`)
    }
  }
  if (!Array.isArray(arr)) throw new Error(`${label} 必须是数组`)
  return arr
}

// ── Markdown → 文档块（内置 JS 引擎） ─────────────

/** 把 Markdown 风格文本转为文档块 */
function markdownToBlocks(md: string): DocBlock[] {
  const blocks: DocBlock[] = []
  const lines = md.split(/\r?\n/)
  let listBuf: string[] = []
  let listOrdered = false
  let tableBuf: string[][] = []

  const flushList = (): void => {
    if (listBuf.length) {
      blocks.push({ type: 'list', items: listBuf, ordered: listOrdered })
      listBuf = []
    }
  }
  const flushTable = (): void => {
    if (tableBuf.length) {
      blocks.push({ type: 'table', rows: tableBuf, header: true })
      tableBuf = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()

    // 块级公式 $$...$$（可跨行）
    if (t.startsWith('$$')) {
      flushList()
      flushTable()
      const single = t.slice(2).replace(/\$\$$/, '').trim()
      if (t.endsWith('$$') && t.length > 4 && single) {
        blocks.push({ type: 'formula', latex: single })
      } else {
        const buf: string[] = [t.slice(2)]
        while (++i < lines.length && !lines[i].trim().endsWith('$$')) buf.push(lines[i])
        if (i < lines.length) buf.push(lines[i].trim().replace(/\$\$$/, ''))
        blocks.push({ type: 'formula', latex: buf.join('\n').trim() })
      }
      continue
    }

    // 表格行 | a | b |
    if (/^\|.*\|$/.test(t)) {
      flushList()
      const cells = t.slice(1, -1).split('|').map((c) => c.trim())
      // 跳过 |---|---| 分隔行
      if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) tableBuf.push(cells)
      continue
    }
    flushTable()

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(t)
    if (h) {
      flushList()
      blocks.push({ type: 'heading', text: h[2], level: h[1].length })
      continue
    }

    // 列表
    const ul = /^[-*+]\s+(.*)$/.exec(t)
    const ol = /^\d+[.)]\s+(.*)$/.exec(t)
    if (ul || ol) {
      const ordered = !!ol
      if (listBuf.length && ordered !== listOrdered) flushList()
      listOrdered = ordered
      listBuf.push((ul ? ul[1] : ol![1]))
      continue
    }
    flushList()

    if (!t) continue
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      blocks.push({ type: 'pagebreak' })
      continue
    }
    blocks.push({ type: 'paragraph', text: t })
  }
  flushList()
  flushTable()
  return blocks
}

function buildOpts(a: Record<string, any>): BuildOptions {
  return {
    title: a.title ? str(a.title) : undefined,
    author: a.author ? str(a.author) : undefined,
    fontName: a.font_name ? str(a.font_name) : undefined,
    fontSize: a.font_size ? num(a.font_size, 11) : undefined,
    landscape: bool(a.landscape, false)
  }
}

/** pandoc 引擎：gfm + $...$ LaTeX 公式 → Word 原生 OMML */
async function pandocToDocx(md: string, outPath: string, meta: { title?: string; author?: string }): Promise<void> {
  const tmp = path.join(os.tmpdir(), `wa-md-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.md`)
  await fs.writeFile(tmp, md, 'utf-8')
  try {
    const args = ['-f', 'gfm+tex_math_dollars', '-t', 'docx', '-o', outPath]
    if (meta.title) args.push('--metadata', `title=${meta.title}`)
    if (meta.author) args.push('--metadata', `author=${meta.author}`)
    const r = spawnSync('pandoc', [...args, tmp], { timeout: 60000, encoding: 'utf8', windowsHide: true })
    if (r.status !== 0) {
      throw new Error(((r.stderr || r.stdout) || `pandoc 退出码 ${r.status}`).trim())
    }
  } finally {
    await fs.unlink(tmp).catch(() => { /* ignore */ })
  }
}

// ── Excel：markdown 表格 / sheets JSON → xlsx ────

/** 单元格值收敛：纯数字字符串转数字，其余转字符串 */
function coerceCell(v: unknown): string | number {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const s = String(v)
  if (s.trim() !== '') {
    const n = Number(s)
    if (Number.isFinite(n)) return n
  }
  return s
}

interface SheetSpec {
  name: string
  rows: (string | number)[][]
}

function parseSheetsArg(v: unknown): SheetSpec[] {
  const arr = parseArrayArg(v, 'sheets')
  return arr.map((s: any, i: number) => {
    if (!s || typeof s !== 'object' || !Array.isArray(s.rows)) {
      throw new Error(`sheets[${i}] 缺少 rows 数组（每项 {name?, rows:[][]}）`)
    }
    return {
      name: s.name ? String(s.name).slice(0, 31) : `Sheet${i + 1}`,
      rows: s.rows.map((r: any) => (Array.isArray(r) ? r.map(coerceCell) : [coerceCell(r)]))
    }
  })
}

/** markdown 表格文本 → sheets（每个连续表格块一张工作表） */
function markdownToSheets(md: string): SheetSpec[] {
  const sheets: SheetSpec[] = []
  let current: (string | number)[][] = []
  const flush = (): void => {
    if (current.length) {
      sheets.push({ name: `Sheet${sheets.length + 1}`, rows: current })
      current = []
    }
  }
  for (const line of md.split(/\r?\n/)) {
    const t = line.trim()
    if (/^\|.*\|$/.test(t)) {
      const cells = t.slice(1, -1).split('|').map((c) => c.trim())
      if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) current.push(cells.map(coerceCell))
    } else {
      flush()
    }
  }
  flush()
  if (!sheets.length) throw new Error('markdown 中未找到表格（需 | 列 | 列 | 格式）')
  return sheets
}

// ── PPT：slides JSON → pptx ──────────────────────

interface SlideSpec {
  title?: string
  subtitle?: string
  bullets?: string[]
  text?: string
  layout?: 'title' | 'titleContent' | 'twoContent'
  notes?: string
}

function parseSlidesArg(v: unknown): SlideSpec[] {
  const arr = parseArrayArg(v, 'slides')
  return arr.map((s: any) => ({
    title: s?.title != null ? String(s.title) : undefined,
    subtitle: s?.subtitle != null ? String(s.subtitle) : undefined,
    bullets: Array.isArray(s?.bullets) ? s.bullets.map((b: unknown) => String(b)) : undefined,
    text: s?.text != null ? String(s.text) : undefined,
    layout: s?.layout,
    notes: s?.notes != null ? String(s.notes) : undefined
  }))
}

// ── office_convert：格式互转引擎链 ──────────────

/** 规范化格式名 */
function normFmt(f: string): string {
  const t = f.toLowerCase().trim().replace(/^\./, '')
  if (t === 'markdown') return 'md'
  if (t === 'htm') return 'html'
  return t
}

/** 默认输出路径：同目录同名换扩展名 */
function defaultOutPath(inputPath: string, target: string): string {
  const dir = path.dirname(inputPath)
  const base = path.basename(inputPath, path.extname(inputPath))
  return path.join(dir, `${base}.${target}`)
}

/** SheetJS：xlsx/xls/xlsm → csv（首个工作表，BOM 防 Excel 乱码）/ json（全部工作表） */
async function sheetToCsvJson(inputPath: string, outPath: string, target: string): Promise<string> {
  const wb = XLSX.readFile(inputPath)
  if (target === 'csv') {
    const name = wb.SheetNames[0]
    if (!name) throw new Error('工作簿为空')
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name])
    await fs.writeFile(outPath, '\ufeff' + csv, 'utf-8')
    return wb.SheetNames.length > 1
      ? `已导出 CSV（首个工作表「${name}」，共 ${wb.SheetNames.length} 表，全部数据可用 json 目标）: ${outPath}`
      : `已导出 CSV: ${outPath}`
  }
  const data: Record<string, unknown[][]> = {}
  for (const n of wb.SheetNames) {
    data[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' })
  }
  await fs.writeFile(outPath, JSON.stringify(data, null, 2), 'utf-8')
  return `已导出 JSON（${wb.SheetNames.length} 个工作表）: ${outPath}`
}

/** SheetJS：csv / json → xlsx */
async function csvJsonToXlsx(inputPath: string, outPath: string, src: string): Promise<void> {
  if (src === 'csv') {
    const content = (await fs.readFile(inputPath, 'utf-8')).replace(/^\ufeff/, '')
    const wb = XLSX.read(content, { type: 'string' })
    XLSX.writeFile(wb, outPath)
    return
  }
  const data = JSON.parse(await fs.readFile(inputPath, 'utf-8'))
  const wb = XLSX.utils.book_new()
  if (Array.isArray(data)) {
    const rows = data.map((r: any) => (Array.isArray(r) ? r.map(coerceCell) : [coerceCell(r)]))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  } else if (data && typeof data === 'object') {
    let i = 0
    for (const [name, rows] of Object.entries(data)) {
      if (!Array.isArray(rows)) continue
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows.map((r: any) => (Array.isArray(r) ? r.map(coerceCell) : [coerceCell(r)]))), String(name).slice(0, 31) || `Sheet${++i}`)
      i++
    }
  } else {
    throw new Error('json 结构不支持：需为二维数组或 {表名: 二维数组}')
  }
  XLSX.writeFile(wb, outPath)
}

/** pandoc 通用转换（txt 源用 markdown reader，txt 目标用 plain writer） */
function pandocConvert(inputPath: string, from: string, to: string, outPath: string): void {
  const fromFmt = from === 'md' || from === 'txt' ? 'gfm' : from
  const toFmt = to === 'md' ? 'gfm' : to
  const r = spawnSync('pandoc', ['-f', fromFmt, '-t', toFmt, '-o', outPath, inputPath], { timeout: 60000, encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) {
    throw new Error(`pandoc 转换失败: ${((r.stderr || r.stdout) || `退出码 ${r.status}`).trim()}`)
  }
}

/** LibreOffice headless：转换到指定格式，产物重命名到 outPath */
async function sofficeConvert(inputPath: string, outPath: string, sofficeCmd: string, targetFmt: string): Promise<void> {
  const outDir = path.dirname(outPath)
  const r = spawnSync(sofficeCmd, ['--headless', '--convert-to', targetFmt, '--outdir', outDir, inputPath], { timeout: 120000, encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) {
    throw new Error(`LibreOffice 转换失败: ${((r.stderr || r.stdout) || `退出码 ${r.status}`).trim()}`)
  }
  const auto = path.join(outDir, path.basename(inputPath, path.extname(inputPath)) + '.' + targetFmt)
  if (path.resolve(auto) !== path.resolve(outPath)) {
    await fs.rename(auto, outPath).catch(async () => {
      await fs.copyFile(auto, outPath)
      await fs.unlink(auto).catch(() => { /* ignore */ })
    })
  }
  await fs.access(outPath)
}

/** MS Office COM：导出 pdf（Word 17 / Excel ExportAsFixedFormat 0 / PowerPoint 32） */
async function comExportToPdf(inputPath: string, outPath: string): Promise<void> {
  const ext = path.extname(inputPath).toLowerCase()
  const open = psQuote(inputPath)
  const out = psQuote(outPath)
  let script: string
  if (ext === '.docx' || ext === '.doc') {
    script = [
      "$ErrorActionPreference = 'Stop'",
      'try {',
      '  $app = New-Object -ComObject Word.Application',
      '  $app.Visible = $false',
      '  $app.DisplayAlerts = 0',
      `  $doc = $app.Documents.Open(${open}, $false, $true)`,
      `  $doc.SaveAs2(${out}, 17)`,
      '  $doc.Close($false)',
      '  $app.Quit()',
      "  Write-Output 'OK'",
      '} catch {',
      "  Write-Output ('FAIL: ' + $_.Exception.Message)",
      '  try { $app.Quit() } catch {}',
      '}'
    ].join('\n')
  } else if (ext === '.xlsx' || ext === '.xls' || ext === '.xlsm') {
    script = [
      "$ErrorActionPreference = 'Stop'",
      'try {',
      '  $app = New-Object -ComObject Excel.Application',
      '  $app.Visible = $false',
      '  $app.DisplayAlerts = 0',
      `  $wb = $app.Workbooks.Open(${open}, 0, $true)`,
      `  $wb.ExportAsFixedFormat(0, ${out})`,
      '  $wb.Close($false)',
      '  $app.Quit()',
      "  Write-Output 'OK'",
      '} catch {',
      "  Write-Output ('FAIL: ' + $_.Exception.Message)",
      '  try { $app.Quit() } catch {}',
      '}'
    ].join('\n')
  } else if (ext === '.pptx' || ext === '.ppt') {
    script = [
      "$ErrorActionPreference = 'Stop'",
      'try {',
      '  $app = New-Object -ComObject PowerPoint.Application',
      `  $pres = $app.Presentations.Open(${open}, $true, $false, $false)`,
      `  $pres.SaveAs(${out}, 32)`,
      '  $pres.Close()',
      '  $app.Quit()',
      "  Write-Output 'OK'",
      '} catch {',
      "  Write-Output ('FAIL: ' + $_.Exception.Message)",
      '  try { $app.Quit() } catch {}',
      '}'
    ].join('\n')
  } else {
    throw new Error(`Office COM 不支持该源格式转 pdf: ${ext}`)
  }
  const r = await runPowerShell(script, 120000)
  const text = (r.stdout + r.stderr).trim()
  if (r.code !== 0 || text.includes('FAIL')) {
    throw new Error(`Office COM 转换失败: ${text.match(/FAIL: (.*)/)?.[1] || text.slice(0, 300)}`)
  }
  await fs.access(outPath)
}

/** Word COM：.doc → .docx（wdFormatXMLDocument=16） */
async function comDocToDocx(inputPath: string, outPath: string): Promise<void> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    '  $app = New-Object -ComObject Word.Application',
    '  $app.Visible = $false',
    '  $app.DisplayAlerts = 0',
    `  $doc = $app.Documents.Open(${psQuote(inputPath)}, $false, $true)`,
    `  $doc.SaveAs2(${psQuote(outPath)}, 16)`,
    '  $doc.Close($false)',
    '  $app.Quit()',
    "  Write-Output 'OK'",
    '} catch {',
    "  Write-Output ('FAIL: ' + $_.Exception.Message)",
    '  try { $app.Quit() } catch {}',
    '}'
  ].join('\n')
  const r = await runPowerShell(script, 120000)
  const text = (r.stdout + r.stderr).trim()
  if (r.code !== 0 || text.includes('FAIL')) {
    throw new Error(`Word COM 转换失败: ${text.match(/FAIL: (.*)/)?.[1] || text.slice(0, 300)}`)
  }
  await fs.access(outPath)
}

// ── 工具定义 ──────────────────────────────────────

export const officeTools: Tool[] = [
  {
    schema: {
      name: 'markdown_to_docx',
      description:
        '把 Markdown 文本转换为 Word (.docx)。支持 # 标题、- / 1. 列表、| 表格 |、--- 分页，' +
        '以及 $$块级$$ / $行内$ LaTeX 数学公式（自动插入为 Word 原生可编辑公式）。' +
        '检测到 pandoc 时优先用 pandoc 引擎（表格样式更成熟），否则用内置纯 JS 引擎（零依赖）；' +
        'font_name / font_size / landscape 参数仅内置引擎生效。',
      parameters: {
        type: 'object',
        properties: {
          save_path: { type: 'string', description: '保存路径，如 C:\\Users\\me\\Desktop\\报告.docx' },
          markdown: { type: 'string', description: 'Markdown 文本内容' },
          title: { type: 'string', description: '文档标题属性（可选）' },
          author: { type: 'string', description: '作者（可选）' },
          font_name: { type: 'string', description: '正文字体（仅内置引擎），默认 等线' },
          font_size: { type: 'number', description: '正文字号/磅（仅内置引擎），默认 11' },
          landscape: { type: 'boolean', description: '是否横向页面（仅内置引擎），默认 false' }
        },
        required: ['save_path', 'markdown']
      }
    },
    async run(a) {
      const md = str(a.markdown)
      if (!md.trim()) throw new Error('markdown 内容为空')
      const final = resolveSavePath(str(a.save_path), '.docx')
      await ensureParentDir(final)

      const caps = getCapabilities()
      if (caps.pandoc) {
        try {
          await pandocToDocx(md, final, { title: a.title ? str(a.title) : undefined, author: a.author ? str(a.author) : undefined })
          return `已由 Markdown 生成 Word 文档（pandoc 引擎）: ${final}`
        } catch (e) {
          Logger.warn(`[markdown_to_docx] pandoc 转换失败，回退内置引擎: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      await ensureMathEngines()
      const blocks = markdownToBlocks(md)
      if (!blocks.length) throw new Error('未解析到任何内容块')
      const buf = await buildDocx(blocks, buildOpts(a))
      await fs.writeFile(final, buf)
      return `已由 Markdown 生成 Word 文档（内置 JS 引擎）: ${final}\n块数: ${blocks.length}，大小: ${buf.length} 字节`
    }
  },
  {
    schema: {
      name: 'write_xlsx',
      description:
        '创建 Excel (.xlsx)。两种输入二选一：sheets = [{name?, rows: [[..], [..]]}] JSON 数组（精确控制），' +
        '或 markdown = Markdown 表格文本（每个连续表格块生成一张工作表）。数字字符串自动转数字。',
      parameters: {
        type: 'object',
        properties: {
          save_path: { type: 'string', description: '保存路径，如 C:\\Users\\me\\Desktop\\数据.xlsx' },
          sheets: { type: 'array', description: '工作表数组，每项 {name?, rows: 二维数组}', items: { type: 'object' } },
          markdown: { type: 'string', description: 'Markdown 表格文本（与 sheets 二选一）' }
        },
        required: ['save_path']
      }
    },
    async run(a) {
      const sheets = a.sheets !== undefined && a.sheets !== null && a.sheets !== ''
        ? parseSheetsArg(a.sheets)
        : a.markdown !== undefined && a.markdown !== null && str(a.markdown).trim() !== ''
          ? markdownToSheets(str(a.markdown))
          : null
      if (!sheets || !sheets.length) throw new Error('需提供 sheets（JSON 数组）或 markdown（表格文本）之一')

      const wb = XLSX.utils.book_new()
      for (const s of sheets) {
        const ws = XLSX.utils.aoa_to_sheet(s.rows)
        XLSX.utils.book_append_sheet(wb, ws, s.name)
      }
      const final = resolveSavePath(str(a.save_path), '.xlsx')
      await ensureParentDir(final)
      XLSX.writeFile(wb, final)
      const totalRows = sheets.reduce((n, s) => n + s.rows.length, 0)
      return `已生成 Excel: ${final}\n工作表 ${sheets.length} 个（${sheets.map((s) => s.name).join(', ')}），共 ${totalRows} 行`
    }
  },
  {
    schema: {
      name: 'write_pptx',
      description:
        '创建 PowerPoint (.pptx) 演示文稿（16:9）。slides 为 JSON 数组，每项：' +
        '{title, subtitle?, bullets?: string[], text?, layout?, notes?}；' +
        'layout 可为 title（封面页：大标题+副标题）/ titleContent（默认：标题+要点列表）/ twoContent（标题+双栏要点）；' +
        'notes 为演讲者备注。',
      parameters: {
        type: 'object',
        properties: {
          save_path: { type: 'string', description: '保存路径，如 C:\\Users\\me\\Desktop\\演示.pptx' },
          slides: { type: 'array', description: '幻灯片数组，每项 {title, subtitle?, bullets?, text?, layout?, notes?}', items: { type: 'object' } },
          title: { type: 'string', description: '演示文稿标题属性（可选）' },
          author: { type: 'string', description: '作者（可选）' }
        },
        required: ['save_path', 'slides']
      }
    },
    async run(a) {
      const slides = parseSlidesArg(a.slides)
      if (!slides.length) throw new Error('slides 为空')

      const pptx = new PptxGenJS()
      pptx.layout = 'LAYOUT_16x9'
      if (a.title) pptx.title = str(a.title)
      if (a.author) pptx.author = str(a.author)

      for (const s of slides) {
        const slide = pptx.addSlide()
        if (s.notes) slide.addNotes(s.notes)
        const layout = s.layout || (s.bullets || s.text ? 'titleContent' : 'title')

        if (layout === 'title') {
          slide.addText(s.title || '', { x: 0.5, y: 1.9, w: 9, h: 1.2, fontSize: 40, bold: true, align: 'center', color: '1F3864' })
          if (s.subtitle) {
            slide.addText(s.subtitle, { x: 0.5, y: 3.3, w: 9, h: 0.8, fontSize: 20, align: 'center', color: '595959' })
          }
        } else if (layout === 'twoContent') {
          slide.addText(s.title || '', { x: 0.5, y: 0.35, w: 9, h: 0.8, fontSize: 28, bold: true, color: '1F3864' })
          const items = s.bullets || []
          const half = Math.ceil(items.length / 2)
          const mk = (arr: string[]): Array<{ text: string; options: { bullet: boolean } }> =>
            arr.map((t) => ({ text: t, options: { bullet: true } }))
          if (half > 0) slide.addText(mk(items.slice(0, half)), { x: 0.5, y: 1.35, w: 4.4, h: 3.9, fontSize: 16, valign: 'top' })
          if (items.length - half > 0) slide.addText(mk(items.slice(half)), { x: 5.1, y: 1.35, w: 4.4, h: 3.9, fontSize: 16, valign: 'top' })
        } else {
          slide.addText(s.title || '', { x: 0.5, y: 0.35, w: 9, h: 0.8, fontSize: 28, bold: true, color: '1F3864' })
          if (s.bullets && s.bullets.length) {
            slide.addText(
              s.bullets.map((t) => ({ text: t, options: { bullet: true } })),
              { x: 0.5, y: 1.35, w: 9, h: 3.9, fontSize: 16, valign: 'top' }
            )
          } else if (s.text) {
            slide.addText(s.text, { x: 0.5, y: 1.35, w: 9, h: 3.9, fontSize: 16, valign: 'top' })
          }
        }
      }

      const final = resolveSavePath(str(a.save_path), '.pptx')
      await ensureParentDir(final)
      const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
      await fs.writeFile(final, buf)
      return `已生成 PowerPoint: ${final}\n页数: ${slides.length}，大小: ${buf.length} 字节`
    }
  },
  {
    schema: {
      name: 'office_convert',
      description:
        '本地文档格式互转。支持：xlsx/xls/xlsm → csv/json、csv/json → xlsx、xls/xlsm → xlsx（纯 JS 恒可用）；' +
        'md ↔ docx ↔ html ↔ txt 互转（需 pandoc）；Office 文档 → pdf（docx/doc/xlsx/xls/pptx/ppt/md/html/txt，需 LibreOffice 或 MS Office，按能力探测自动选择；md/html/txt 走先转 docx 再转 pdf 组合链）；.doc → .docx。' +
        '引擎降级链：纯 JS → pandoc → LibreOffice → Office COM；不可达时报错并给出安装指引。',
      parameters: {
        type: 'object',
        properties: {
          input_path: { type: 'string', description: '输入文件绝对路径' },
          target_format: { type: 'string', description: '目标格式：pdf / docx / md / html / txt / xlsx / csv / json' },
          output_path: { type: 'string', description: '输出路径（可选，默认同目录同名换扩展名）' }
        },
        required: ['input_path', 'target_format']
      }
    },
    async run(a) {
      const inputPath = path.resolve(str(a.input_path))
      const target = normFmt(str(a.target_format))
      if (!inputPath || !target) throw new Error('需提供 input_path 与 target_format')
      await fs.access(inputPath)
      const srcExt = path.extname(inputPath).toLowerCase().slice(1)
      if (!srcExt) throw new Error('输入文件缺少扩展名')
      const src = normFmt(srcExt)
      if (src === target) throw new Error(`源格式与目标格式相同（${src}）`)
      const outPath = a.output_path ? resolveSavePath(str(a.output_path), '.' + target) : defaultOutPath(inputPath, target)
      await ensureParentDir(outPath)
      const caps = getCapabilities()

      // 1) 纯 JS：表格互转（SheetJS，零依赖恒可用）
      if ((src === 'xlsx' || src === 'xls' || src === 'xlsm') && (target === 'csv' || target === 'json')) {
        return await sheetToCsvJson(inputPath, outPath, target)
      }
      if ((src === 'csv' || src === 'json') && target === 'xlsx') {
        await csvJsonToXlsx(inputPath, outPath, src)
        return `已转换（SheetJS）: ${outPath}`
      }
      if ((src === 'xls' || src === 'xlsm') && target === 'xlsx') {
        XLSX.writeFile(XLSX.readFile(inputPath), outPath)
        return `已转换（SheetJS）: ${outPath}`
      }

      // 2) md → docx：pandoc 优先，内置 JS 引擎兜底
      if (src === 'md' && target === 'docx') {
        if (caps.pandoc) {
          pandocConvert(inputPath, 'md', 'docx', outPath)
          return `已转换（pandoc）: ${outPath}`
        }
        const md = await fs.readFile(inputPath, 'utf-8')
        await ensureMathEngines()
        await fs.writeFile(outPath, await buildDocx(markdownToBlocks(md), {}))
        return `已转换（内置 JS 引擎）: ${outPath}`
      }

      // 3) pandoc 文档互转：md/docx/html/txt
      const PANDOC_FMTS = ['md', 'docx', 'html', 'txt']
      if (PANDOC_FMTS.includes(src) && PANDOC_FMTS.includes(target)) {
        if (!caps.pandoc) {
          throw new Error(`当前转换（${src} → ${target}）需要 pandoc，未检测到。安装后重试：https://pandoc.org/installing.html`)
        }
        pandocConvert(inputPath, src, target, outPath)
        return `已转换（pandoc）: ${outPath}`
      }

      // 4) .doc → .docx：LibreOffice 优先，Word COM 兑底
      if (src === 'doc' && target === 'docx') {
        if (caps.sofficeCmd) {
          await sofficeConvert(inputPath, outPath, caps.sofficeCmd, 'docx')
          return `已转换（LibreOffice）: ${outPath}`
        }
        if (caps.officeCom) {
          await comDocToDocx(inputPath, outPath)
          return `已转换（Word COM）: ${outPath}`
        }
        throw new Error('.doc → .docx 需要 LibreOffice 或 MS Office，本机均未检测到')
      }

      // 5) pdf 输出：md/html/txt 先转 docx 再转 pdf（组合链）
      if (target === 'pdf') {
        let actualInput = inputPath
        const tmpDocx = path.join(os.tmpdir(), `wa-conv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.docx`)
        try {
          if (src === 'md' || src === 'html' || src === 'txt') {
            if (src === 'md' && !caps.pandoc) {
              const md = await fs.readFile(inputPath, 'utf-8')
              await ensureMathEngines()
              await fs.writeFile(tmpDocx, await buildDocx(markdownToBlocks(md), {}))
            } else {
              if (!caps.pandoc) throw new Error(`${src} → pdf 需先转 docx，该步需要 pandoc（未检测到）。安装：https://pandoc.org/installing.html`)
              pandocConvert(inputPath, src, 'docx', tmpDocx)
            }
            actualInput = tmpDocx
          }
          if (caps.sofficeCmd) {
            await sofficeConvert(actualInput, outPath, caps.sofficeCmd, 'pdf')
            return `已转换为 PDF（LibreOffice 引擎${actualInput !== inputPath ? '，源文件先转 docx 组合链' : ''}）: ${outPath}`
          }
          if (caps.officeCom) {
            await comExportToPdf(actualInput, outPath)
            return `已转换为 PDF（MS Office COM 引擎${actualInput !== inputPath ? '，源文件先转 docx 组合链' : ''}）: ${outPath}`
          }
          throw new Error('PDF 输出需要 LibreOffice（soffice）或 MS Office，本机均未检测到。安装其一后重试。')
        } finally {
          if (actualInput === tmpDocx) await fs.unlink(tmpDocx).catch(() => { /* ignore */ })
        }
      }

      throw new Error(
        `不支持的转换对: ${src} → ${target}。支持：xlsx/xls/xlsm ↔ csv/json、xls/xlsm → xlsx、md ↔ docx ↔ html ↔ txt（需 pandoc）、→ pdf（需 LibreOffice/Office）、doc → docx。` +
        '生成新文档请用 markdown_to_docx / write_xlsx / write_pptx。'
      )
    }
  }
]
