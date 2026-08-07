// 文档文本提取器 — 支持 pdf / pptx / docx / xlsx / xlsm / doc / xls / ppt(COM 转换)
// 用法：node read_pdf.js，参数 JSON 从 stdin 传入，结果 JSON 输出到 stdout
// 参数：{ path: 文件绝对路径, format?: 'auto'|'pdf'|'pptx'|'docx'|'xlsx'|'doc'|'xls'|'ppt', max_chars?: 截断长度 }
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync, spawnSync } = require('child_process')

let input = ''
process.stdin.on('data', (d) => (input += d.toString()))
process.stdin.on('end', async () => {
  try {
    const args = JSON.parse(input || '{}')
    const filePath = args.path
    if (!filePath) {
      console.error('缺少 path 参数（文件绝对路径）')
      process.exit(1)
    }
    const maxChars = Number(args.max_chars) || 80000
    const format = String(args.format || 'auto')

    if (!fs.existsSync(filePath)) {
      console.error(`文件不存在: ${filePath}`)
      process.exit(1)
    }

    const ext = path.extname(filePath).toLowerCase()
    const fmt = format === 'auto' ? ext.replace('.', '') : format
    const buf = fs.readFileSync(filePath)

    let text = ''
    if (fmt === 'pdf') text = await extractPdf(buf)
    else if (['pptx', 'docx', 'xlsx', 'xlsm'].includes(fmt)) text = await extractZipText(buf, fmt)
    else if (fmt === 'doc') text = await extractDoc(buf)
    else if (fmt === 'xls') text = await extractXls(buf)
    else if (fmt === 'ppt') text = await extractPpt(filePath)
    else throw new Error(`不支持的格式: ${fmt}`)

    const truncated = text.length > maxChars
    console.log(JSON.stringify({
      path: filePath,
      format: fmt,
      chars: text.length,
      truncated,
      text: truncated ? text.slice(0, maxChars) : text
    }))
  } catch (e) {
    console.error(`提取失败: ${e && e.message ? e.message : String(e)}`)
    process.exit(1)
  }
})

// 从 node_modules 加载模块（dev：项目根；打包：app.asar 回退）
function loadModule(name) {
  try {
    return require(name)
  } catch {
    const asarPath = path.join(process.resourcesPath, 'app.asar', 'node_modules', name)
    return require(asarPath)
  }
}

// === PDF（pdf-parse，require 方式） ===
async function extractPdf(buf) {
  const pdfParseMod = loadModule('pdf-parse')
  const parseFn = pdfParseMod.default || pdfParseMod
  const data = await parseFn(buf)
  return String(data.text || '').trim()
}

// === Office zip 格式（jszip） ===
async function extractZipText(buf, fmt) {
  const JSZipMod = loadModule('jszip')
  const JSZip = JSZipMod.default || JSZipMod
  const zip = await JSZip.loadAsync(buf)

  if (fmt === 'pptx') {
    const slides = Object.keys(zip.files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => parseInt(a.match(/slide(\d+)/)[1], 10) - parseInt(b.match(/slide(\d+)/)[1], 10))
    const parts = []
    for (const f of slides) {
      const xml = await zip.files[f].async('string')
      const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).filter(Boolean)
      if (texts.length) parts.push(texts.join(' '))
    }
    return parts.join('\n\n')
  }

  if (fmt === 'docx') {
    const entry = zip.files['word/document.xml']
    if (!entry) return ''
    const xml = await entry.async('string')
    const paras = []
    const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g
    let m
    while ((m = pRe.exec(xml)) !== null) {
      const inner = m[1].replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n')
      const texts = [...inner.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1])
      const line = texts.join('').trim()
      if (line) paras.push(line)
    }
    return paras.join('\n')
  }

  if (['xlsx', 'xlsm'].includes(fmt)) {
    let shared = []
    const ss = zip.files['xl/sharedStrings.xml']
    if (ss) {
      const xml = await ss.async('string')
      shared = [...xml.matchAll(/<t\b[^>]*>([^<]*)<\/t>/g)].map((m) => m[1])
    }
    const sheets = Object.keys(zip.files)
      .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
      .sort((a, b) => parseInt(a.match(/sheet(\d+)/)[1], 10) - parseInt(b.match(/sheet(\d+)/)[1], 10))
    const parts = []
    for (const f of sheets) {
      const xml = await zip.files[f].async('string')
      const rows = []
      const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g
      let rm
      while ((rm = rowRe.exec(xml)) !== null) {
        const cells = []
        const cellRe = /<c\b[^>]*r="([A-Z]+\d+)"[^>]*>([\s\S]*?)<\/c>/g
        let cm
        while ((cm = cellRe.exec(rm[1])) !== null) {
          const inline = cm[2].match(/<t\b[^>]*>([^<]*)<\/t>/)
          const v = cm[2].match(/<v>([\s\S]*?)<\/v>/)
          let value = ''
          if (inline) value = inline[1]
          else if (v) {
            if (/t="s"/.test(cm[0])) {
              const idx = parseInt(v[1], 10)
              value = shared[idx] ?? v[1]
            } else value = v[1]
          }
          if (value) cells.push(value)
        }
        if (cells.length) rows.push(cells.join(' | '))
      }
      if (rows.length) parts.push(`【工作表 ${sheets.indexOf(f) + 1}】\n${rows.join('\n')}`)
    }
    return parts.join('\n\n')
  }
  return ''
}

// === .doc（word-extractor，OLE Word 文档） ===
async function extractDoc(buf) {
  const WordExtractor = loadModule('word-extractor')
  const extractor = new (WordExtractor.default || WordExtractor)()
  const doc = await extractor.extract(buf)
  return doc.getBody().trim()
}

// === .xls（SheetJS xlsx 包，兼容二进制 xls） ===
async function extractXls(buf) {
  const XLSX = loadModule('xlsx')
  const wb = XLSX.read(buf, { type: 'buffer' })
  const parts = []
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
    const textRows = rows
      .map((row) => (Array.isArray(row) ? row.filter((c) => String(c).trim() !== '').join(' | ') : ''))
      .filter(Boolean)
    if (textRows.length) parts.push(`【工作表 ${sheetName}】\n${textRows.join('\n')}`)
  }
  return parts.join('\n\n')
}

// === .ppt（PowerPoint COM 自动化转换 → pptx → 提取；失败返回明确错误） ===
async function extractPpt(filePath) {
  const tmpOut = path.join(os.tmpdir(), `wa-ppt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.pptx`)
  const ps = [
    '$ErrorActionPreference = "Stop"',
    'try {',
    '  $app = New-Object -ComObject PowerPoint.Application',
    '  $pres = $app.Presentations.Open(' + JSON.stringify(filePath) + ', $true, $false, $false)',
    '  $pres.SaveAs(' + JSON.stringify(tmpOut) + ', 24)',
    '  $pres.Close()',
    '  $app.Quit()',
    '  Write-Output "OK"',
    '} catch {',
    '  Write-Output ("FAIL: " + $_.Exception.Message)',
    '  try { $app.Quit() } catch {}',
    '}'
  ].join('\n')
  try {
    const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      timeout: 60000,
      encoding: 'utf8'
    })
    const out = (res.stdout || '') + (res.stderr || '')
    if (out.includes('FAIL')) throw new Error(out.match(/FAIL: (.*)/)?.[1] || 'PowerPoint COM 转换失败')
    if (!fs.existsSync(tmpOut)) throw new Error('PowerPoint 转换未生成文件（可能未安装 Office PowerPoint）')
    const pptxBuf = fs.readFileSync(tmpOut)
    const text = await extractZipText(pptxBuf, 'pptx')
    try { fs.unlinkSync(tmpOut) } catch { /* ignore */ }
    return text
  } catch (e) {
    try { fs.unlinkSync(tmpOut) } catch { /* ignore */ }
    throw new Error(`.ppt 转换失败: ${e.message}`)
  }
}
