// 文档文本提取入口（stdin 协议）：兼容 read_pdf.js 的协议，
// 但把 format 参数真正透传（修复桌面版 read_pdf.js 硬编码 'pdf' 的问题）。
// 用法：node read_doc.js；stdin JSON: { path: 文件绝对路径, format: 'pdf'|'docx'|... }
const { extractByFormat } = require('./extract')

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
    const format = String(args.format || 'pdf')
    const maxChars = Number(args.max_chars) || 80000

    const { promises: fs } = require('fs')
    if (!(await fs.access(filePath).then(() => true).catch(() => false))) {
      console.error(`文件不存在: ${filePath}`)
      process.exit(1)
    }

    const text = await extractByFormat(filePath, format)
    const truncated = text.length > maxChars
    console.log(JSON.stringify({
      path: filePath,
      format,
      chars: text.length,
      truncated,
      text: truncated ? text.slice(0, maxChars) : text
    }))
  } catch (e) {
    console.error(`提取失败: ${e && e.message ? e.message : String(e)}`)
    process.exit(1)
  }
})
