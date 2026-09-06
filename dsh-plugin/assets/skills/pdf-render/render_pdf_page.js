// PDF 页面渲染器 — pdfjs-dist + @napi-rs/canvas 把整页渲染为 PNG（可选依赖）
// 用法：node render_pdf_page.js，参数 JSON 从 stdin 传入
// 输出：首行 JSON 元信息，随后每页一行 [[IMG:data:image/png;base64,...]]（宿主剥离转为视觉输入）
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const MISSING_DEPS =
  '未安装可选依赖 pdfjs-dist / @napi-rs/canvas（视觉渲染链不可用）。' +
  '请在 dsh-winagent 插件目录执行: npm install pdfjs-dist @napi-rs/canvas 后重试；' +
  '未安装期间可用 read_pdf 提取文本。'

// NODE_PATH 只作用于 CJS require；ESM 包按 file URL 直载，需先定位包目录
function candidateNodeModules() {
  const roots = []
  for (const r of (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)) roots.push(r)
  let d = __dirname
  while (d !== path.dirname(d)) {
    roots.push(path.join(d, 'node_modules'))
    d = path.dirname(d)
  }
  return roots
}

function findPackageDir(name) {
  for (const r of candidateNodeModules()) {
    const dir = path.join(r, name)
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
  }
  return null
}

async function loadPdfjs() {
  const dir = findPackageDir('pdfjs-dist')
  if (!dir) throw new Error(MISSING_DEPS)
  const mjs = path.join(dir, 'legacy', 'build', 'pdf.mjs')
  if (!fs.existsSync(mjs)) throw new Error('pdfjs-dist 安装不完整（缺少 legacy/build/pdf.mjs）。' + MISSING_DEPS)
  const mod = await import(pathToFileURL(mjs).href)
  return { mod, dir }
}

function loadCanvas() {
  try {
    return require('@napi-rs/canvas')
  } catch { /* 按目录回退 */ }
  const dir = findPackageDir('@napi-rs/canvas')
  if (dir) {
    try { return require(dir) } catch { /* ignore */ }
  }
  throw new Error(MISSING_DEPS)
}

/** 解析页码参数："3" / "1,3,5" / "2-4" / 数字 / 数组 → 1-based 升序页码数组 */
function parsePages(spec, total) {
  if (spec === undefined || spec === null || spec === '') return [1]
  const out = new Set()
  const add = (n) => {
    if (Number.isInteger(n) && n >= 1 && n <= total) out.add(n)
  }
  if (typeof spec === 'number') add(spec)
  else if (Array.isArray(spec)) for (const s of spec) add(Number(s))
  else if (typeof spec === 'string') {
    for (const part of spec.split(/[,，\s]+/).filter(Boolean)) {
      const m = /^(\d+)[-~至到](\d+)$/.exec(part)
      if (m) {
        const a = Number(m[1])
        const b = Number(m[2])
        for (let n = Math.min(a, b); n <= Math.max(a, b); n++) add(n)
      } else add(Number(part))
    }
  }
  if (out.size === 0) throw new Error(`pages 参数无有效页码（总页数 ${total}）`)
  return [...out].sort((a, b) => a - b)
}

let input = ''
process.stdin.on('data', (d) => (input += d.toString()))
process.stdin.on('end', async () => {
  let doc = null
  try {
    const args = JSON.parse(input || '{}')
    const filePath = args.path
    if (!filePath) {
      console.error('缺少 path 参数（PDF 绝对路径）')
      process.exit(1)
    }
    if (!fs.existsSync(filePath)) {
      console.error(`文件不存在: ${filePath}`)
      process.exit(1)
    }

    const { createCanvas } = loadCanvas()
    const { mod: pdfjs, dir: pkgDir } = await loadPdfjs()

    const scale = Math.min(3, Math.max(0.5, Number(args.scale) || 1.5))
    const maxPages = Math.min(10, Math.max(1, Number(args.max_pages) || 6))

    doc = await pdfjs.getDocument({
      data: new Uint8Array(fs.readFileSync(filePath)),
      useSystemFonts: true,
      isEvalSupported: false,
      cMapUrl: pathToFileURL(path.join(pkgDir, 'cmaps')).href + '/',
      cMapPacked: true,
      standardFontDataUrl: pathToFileURL(path.join(pkgDir, 'standard_fonts')).href + '/'
    }).promise

    const all = parsePages(args.pages, doc.numPages)
    const pages = all.slice(0, maxPages)
    const skippedPages = all.slice(maxPages)

    const rendered = []
    for (const n of pages) {
      const page = await doc.getPage(n)
      const viewport = page.getViewport({ scale })
      const w = Math.max(1, Math.ceil(viewport.width))
      const h = Math.max(1, Math.ceil(viewport.height))
      if (w * h > 4096 * 4096) {
        skippedPages.push(n)
        page.cleanup()
        continue
      }
      const canvas = createCanvas(w, h)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, w, h)
      await page.render({ canvasContext: ctx, viewport }).promise
      rendered.push({ page: n, width: w, height: h, b64: canvas.toBuffer('image/png').toString('base64') })
      page.cleanup()
    }

    const meta = {
      path: filePath,
      total_pages: doc.numPages,
      scale,
      rendered: rendered.map(({ page, width, height, b64 }) => ({
        page, width, height, bytes: Math.round((b64.length * 3) / 4)
      })),
      ...(skippedPages.length ? { skipped_pages: skippedPages } : {}),
      note: rendered.length
        ? `${rendered.length} 页已渲染为视觉输入（见附带图片）`
        : '没有页面被渲染'
    }
    console.log(JSON.stringify(meta))
    for (const r of rendered) console.log(`[[IMG:data:image/png;base64,${r.b64}]]`)
  } catch (e) {
    console.error(`渲染失败: ${e && e.message ? e.message : String(e)}`)
    process.exit(1)
  } finally {
    if (doc) { try { await doc.destroy() } catch { /* ignore */ } }
  }
})
