// Word 文档读取器 — 提取 .docx / .doc 文本（核心逻辑见 ../pdf/extract.js）
// 用法：node read_docx.js，参数 JSON 从 stdin 传入，结果 JSON 输出到 stdout
// 参数：{ path: 文件绝对路径, max_chars?: 截断长度, with_images?: 是否同时提取嵌入图片 }
// 图片以 [[IMG:data:image/...;base64,...]] 标记附在 JSON 之后（宿主 Agent 剥离转为视觉输入）
const fs = require('fs')
const path = require('path')
const { extractByFormat, extractDocxImages } = require('../pdf/extract')

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
    const withImages = args.with_images === true || args.with_images === 'true'

    if (!fs.existsSync(filePath)) {
      console.error(`文件不存在: ${filePath}`)
      process.exit(1)
    }

    const ext = path.extname(filePath).toLowerCase()
    const fmt = ext === '.doc' ? 'doc' : 'docx'
    const text = await extractByFormat(filePath, fmt)
    const truncated = text.length > maxChars

    const result = {
      path: filePath,
      format: fmt,
      chars: text.length,
      truncated,
      text: truncated ? text.slice(0, maxChars) : text
    }

    if (withImages) {
      if (fmt === 'docx') {
        const buf = fs.readFileSync(filePath)
        const imgs = await extractDocxImages(buf, {
          max_images: args.max_images,
          max_bytes: args.max_bytes,
          max_total: args.max_total
        })
        result.images = imgs.images.map((im) => ({ file: im.file, mime: im.mime, bytes: im.bytes }))
        result.images_total = imgs.total
        result.images_skipped = imgs.skipped
        console.log(JSON.stringify(result))
        for (const im of imgs.images) console.log(`[[IMG:${im.mime};base64,${im.base64}]]`)
        return
      }
      result.images = []
      result.images_note = '仅 .docx 支持嵌入图片提取（.doc 旧格式不支持）'
    }

    console.log(JSON.stringify(result))
  } catch (e) {
    console.error(`提取失败: ${e && e.message ? e.message : String(e)}`)
    process.exit(1)
  }
})
