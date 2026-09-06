// PDF 嵌入图片抽取器 — pdfjs-dist 操作符扫描 + @napi-rs/canvas 转 PNG（可选依赖）
// 用法：node extract_pdf_images.js，参数 JSON 从 stdin 传入
// 输出：首行 JSON 元信息，随后每图一行 [[IMG:data:image/png;base64,...]]（宿主剥离转为视觉输入）
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
  if (spec === undefined || spec === null || spec === '') return null
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

    const canvasMod = loadCanvas()
    const { createCanvas, ImageData } = canvasMod
    const { mod: pdfjs, dir: pkgDir } = await loadPdfjs()
    const ImageKind = pdfjs.ImageKind || { GRAYSCALE_1BPP: 1, RGB_24BPP: 2, RGBA_32BPP: 3 }
    const OPS = pdfjs.OPS

    const maxImages = Math.min(20, Math.max(1, Number(args.max_images) || 10))
    const minSize = Math.max(1, Number(args.min_size) || 32)

    doc = await pdfjs.getDocument({
      data: new Uint8Array(fs.readFileSync(filePath)),
      useSystemFonts: true,
      isEvalSupported: false,
      cMapUrl: pathToFileURL(path.join(pkgDir, 'cmaps')).href + '/',
      cMapPacked: true,
      standardFontDataUrl: pathToFileURL(path.join(pkgDir, 'standard_fonts')).href + '/'
    }).promise

    const all = parsePages(args.pages, doc.numPages) ||
      Array.from({ length: doc.numPages }, (_, i) => i + 1)

    // 涉及位图绘制的操作符
    const IMAGE_FNS = new Set()
    for (const n of ['paintImageXObject', 'paintImageXObjectRepeat', 'paintJpegXObject', 'paintInlineImageXObject']) {
      if (OPS && OPS[n] !== undefined) IMAGE_FNS.add(OPS[n])
    }
    const INLINE_FN = OPS && OPS.paintInlineImageXObject !== undefined ? OPS.paintInlineImageXObject : -1

    /** 取已解码图片对象：先同步 get，失败走回调式 get（5s 超时） */
    function resolveObj(objs, id) {
      if (!objs) return Promise.resolve(null)
      return new Promise((resolve) => {
        let done = false
        const finish = (v) => {
          if (!done) { done = true; clearTimeout(timer); resolve(v || null) }
        }
        const timer = setTimeout(() => finish(null), 5000)
        try {
          const direct = objs.get(id)
          if (direct && typeof direct !== 'function') { finish(direct); return }
        } catch { /* 未解析，走回调 */ }
        try { objs.get(id, finish) } catch { finish(null) }
      })
    }

    /** 位图数据 → PNG base64；返回 'small' / 'oversize' / 'unsupported-kind' 或 null 表示跳过 */
    function toPng(img) {
      const w = img.width | 0
      const h = img.height | 0
      if (!w || !h || !img.data || !img.data.length) return null
      if (w / h > 20 || h / w > 20) return 'decoration'
      if (w < minSize || h < minSize) return 'small'
      if (w * h > 4096 * 4096) return 'oversize'
      let rgba = null
      if (img.kind === ImageKind.RGBA_32BPP) {
        const d = img.data
        if (d instanceof Uint8ClampedArray && d.length === w * h * 4) rgba = d
        else if (d.buffer && d.byteLength === w * h * 4) rgba = new Uint8ClampedArray(d.buffer, d.byteOffset, w * h * 4)
      } else if (img.kind === ImageKind.RGB_24BPP) {
        const d = img.data
        if (!d.buffer || d.byteLength < w * h * 3) return null
        rgba = new Uint8ClampedArray(w * h * 4)
        for (let i = 0; i < w * h; i++) {
          rgba[i * 4] = d[i * 3]
          rgba[i * 4 + 1] = d[i * 3 + 1]
          rgba[i * 4 + 2] = d[i * 3 + 2]
          rgba[i * 4 + 3] = 255
        }
      } else return 'unsupported-kind'
      const canvas = createCanvas(w, h)
      const ctx = canvas.getContext('2d')
      ctx.putImageData(new ImageData(rgba, w, h), 0, 0)
      return canvas.toBuffer('image/png').toString('base64')
    }

    const images = []
    const notes = []
    const seen = new Set()
    outer:
    for (const n of all) {
      const page = await doc.getPage(n)
      let opList
      try {
        opList = await page.getOperatorList()
      } catch (e) {
        notes.push(`第 ${n} 页操作符解析失败: ${e && e.message ? e.message : String(e)}`)
        page.cleanup()
        continue
      }
      for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i]
        if (!IMAGE_FNS.has(fn)) continue
        let img = null
        if (fn === INLINE_FN) {
          img = opList.argsArray[i][0]
        } else {
          const id = String(opList.argsArray[i][0])
          if (seen.has(id)) continue
          seen.add(id)
          img = (await resolveObj(page.objs, id)) || (await resolveObj(page.commonObjs, id))
          if (!img) {
            notes.push(`第 ${n} 页图片对象 ${id} 无法解析（已跳过）`)
            continue
          }
        }
        if (images.length >= maxImages) {
          notes.push(`已达 max_images=${maxImages}，其余图片跳过`)
          break outer
        }
        const png = toPng(img)
        if (png === 'small' || png === 'decoration') continue
        if (png === 'oversize') { notes.push(`第 ${n} 页一张超大图（>4096×4096）已跳过`); continue }
        if (png === 'unsupported-kind' || !png) { notes.push(`第 ${n} 页一张图片为不支持的像素格式（如 1bit 灰度），已跳过`); continue }
        images.push({ page: n, width: img.width | 0, height: img.height | 0, b64: png })
      }
      page.cleanup()
    }

    const meta = {
      path: filePath,
      total_pages: doc.numPages,
      scanned_pages: all.length,
      images: images.map(({ page, width, height, b64 }) => ({
        page, width, height, bytes: Math.round((b64.length * 3) / 4)
      })),
      ...(notes.length ? { notes } : {}),
      note: images.length
        ? `${images.length} 张嵌入图片已提取为视觉输入（见附带图片）`
        : '未提取到图片（可能无嵌入位图或均为矢量图形/小装饰图；理解整页请用 render_pdf_page）'
    }
    console.log(JSON.stringify(meta))
    for (const im of images) console.log(`[[IMG:data:image/png;base64,${im.b64}]]`)
  } catch (e) {
    console.error(`提取失败: ${e && e.message ? e.message : String(e)}`)
    process.exit(1)
  } finally {
    if (doc) { try { await doc.destroy() } catch { /* ignore */ } }
  }
})
