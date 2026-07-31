import { promises as fs } from 'fs'
import path from 'path'
import type { Tool } from './types'
import { str, num, bool } from './types'
import { buildDocx, latexToOmml, type DocBlock, type BuildOptions } from '../docx/DocxBuilder'

/** 解析 blocks 参数（接受 JSON 字符串或已解析数组） */
function parseBlocks(v: unknown): DocBlock[] {
  let arr: any = v
  if (typeof v === 'string') {
    try {
      arr = JSON.parse(v)
    } catch (e: any) {
      throw new Error(`blocks JSON 解析失败: ${e.message}（前100字符: ${v.slice(0, 100)}）`)
    }
  }
  if (!Array.isArray(arr)) throw new Error('blocks 必须是数组')
  return arr as DocBlock[]
}

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

async function writeDocx(savePath: string, buf: Buffer): Promise<string> {
  const out = path.isAbsolute(savePath) ? savePath : path.resolve(savePath)
  const final = out.toLowerCase().endsWith('.docx') ? out : out + '.docx'
  await fs.mkdir(path.dirname(final), { recursive: true })
  await fs.writeFile(final, buf)
  return final
}

export const docxTools: Tool[] = [
  {
    schema: {
      name: 'create_word_document',
      description:
        '创建 Word (.docx) 文档，支持标题/段落/列表/表格/分页，以及 Word 原生可编辑数学公式（LaTeX 语法）。' +
        'blocks 为 JSON 数组，每项 type 可为：' +
        'heading{text,level:1-6}、paragraph{text,bold,italic,size,align:left|center|right|both}、' +
        'formula{latex,inline}（独立公式，默认居中）、list{items:[],ordered}、table{rows:[[]],header}、pagebreak。' +
        '段落与单元格文本中可用 $...$ 内嵌行内公式、**不支持** markdown 语法。',
      parameters: {
        type: 'object',
        properties: {
          save_path: { type: 'string', description: '保存路径，如 C:\\Users\\me\\Desktop\\报告.docx' },
          blocks: { type: 'array', description: '文档块数组，每项为 {type, ...} 对象', items: { type: 'object' } },
          title: { type: 'string', description: '文档标题属性（可选）' },
          author: { type: 'string', description: '作者（可选）' },
          font_name: { type: 'string', description: '正文字体，默认 等线' },
          font_size: { type: 'number', description: '正文字号（磅），默认 11' },
          landscape: { type: 'boolean', description: '是否横向页面，默认 false' }
        },
        required: ['save_path', 'blocks']
      }
    },
    async run(a) {
      const blocks = parseBlocks(a.blocks)
      if (blocks.length === 0) throw new Error('blocks 为空')
      const buf = await buildDocx(blocks, buildOpts(a))
      const final = await writeDocx(str(a.save_path), buf)
      return `已生成 Word 文档: ${final}\n块数: ${blocks.length}，大小: ${buf.length} 字节`
    }
  },
  {
    schema: {
      name: 'markdown_to_word',
      description:
        '把 Markdown 文本直接转换为 Word (.docx)。支持 # 标题、- / 1. 列表、| 表格 |、$$块级公式$$、$行内公式$、--- 分页符。' +
        '公式以 Word 原生可编辑公式插入（非图片）。适合快速把一段 Markdown 内容输出为 Word。',
      parameters: {
        type: 'object',
        properties: {
          save_path: { type: 'string', description: '保存路径，如 C:\\Users\\me\\Desktop\\文档.docx' },
          markdown: { type: 'string', description: 'Markdown 文本内容' },
          title: { type: 'string', description: '文档标题属性（可选）' },
          author: { type: 'string', description: '作者（可选）' },
          font_name: { type: 'string', description: '正文字体，默认 等线' },
          font_size: { type: 'number', description: '正文字号（磅），默认 11' },
          landscape: { type: 'boolean', description: '是否横向页面，默认 false' }
        },
        required: ['save_path', 'markdown']
      }
    },
    async run(a) {
      const md = str(a.markdown)
      if (!md.trim()) throw new Error('markdown 内容为空')
      const blocks = markdownToBlocks(md)
      const buf = await buildDocx(blocks, buildOpts(a))
      const final = await writeDocx(str(a.save_path), buf)
      return `已由 Markdown 生成 Word 文档: ${final}\n块数: ${blocks.length}，大小: ${buf.length} 字节`
    }
  },
  {
    schema: {
      name: 'latex_formula_to_omml',
      description:
        '数学公式编辑器：把 LaTeX 公式转换为 Word 原生公式 OMML XML 并校验语法。' +
        '用于在写入文档前预检公式是否正确，或获取 OMML 供其他用途。不写文件。',
      parameters: {
        type: 'object',
        properties: {
          latex: { type: 'string', description: 'LaTeX 公式，如 \\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}' },
          inline: { type: 'boolean', description: '是否行内样式，默认 false（块级）' }
        },
        required: ['latex']
      }
    },
    async run(a) {
      const latex = str(a.latex)
      if (!latex.trim()) throw new Error('latex 为空')
      const omml = latexToOmml(latex, !bool(a.inline, false))
      return `公式语法校验通过。\nLaTeX: ${latex}\nOMML 长度: ${omml.length} 字符\n${omml.slice(0, 1200)}${omml.length > 1200 ? '\n…（已截断）' : ''}`
    }
  }
]
