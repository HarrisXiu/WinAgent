// Word 文档读取器 — 提取 .docx / .doc 文本（核心逻辑见 ../pdf/extract.js）
// 用法：node read_docx.js，参数 JSON 从 stdin 传入，结果 JSON 输出到 stdout
// 参数：{ path: 文件绝对路径, max_chars?: 截断长度 }
const path = require('path')
const { extractByFormat } = require('../pdf/extract')

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

    const { promises: fs } = require('fs')
    if (!(await fs.access(filePath).then(() => true).catch(() => false))) {
      console.error(`文件不存在: ${filePath}`)
      process.exit(1)
    }

    const ext = path.extname(filePath).toLowerCase()
    const fmt = ext === '.doc' ? 'doc' : 'docx'
    const text = await extractByFormat(filePath, fmt)
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
