import JSZip from 'jszip'
import temml from 'temml'
import { mml2omml } from 'mathml2omml'

/** 文档块类型（由工具参数解析而来） */
export type DocBlock =
  | { type: 'heading'; text: string; level?: number }
  | { type: 'paragraph'; text: string; bold?: boolean; italic?: boolean; size?: number; align?: Align }
  | { type: 'formula'; latex: string; inline?: boolean; align?: Align }
  | { type: 'list'; items: string[]; ordered?: boolean }
  | { type: 'table'; rows: string[][]; header?: boolean }
  | { type: 'pagebreak' }

export type Align = 'left' | 'center' | 'right' | 'both'

/** XML 文本转义 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** LaTeX → OMML（Word 原生可编辑公式） */
export function latexToOmml(latex: string, display = true): string {
  const mathml = temml.renderToString(latex, { displayMode: display, xml: true })
  let omml = mml2omml(mathml)
  // mml2omml bug: 部分 XML 结构标签被双重转义为 &lt;...&gt;，导致 XML 解析失败
  // Step 1: 全局反转义 &lt; → <, &gt; → >，恢复正确的 XML 结构
  omml = omml.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  // Step 2: 对 m:t 文本节点内的 < > & 重新转义（这些是数学文本中的字面字符）
  // 注意：用 (?=[\s>]) 避免 <m:t 误匹配 <m:type
  omml = omml.replace(/<m:t(?=[\s>])([^>]*)>(.*?)<\/m:t>/g, (_match, attrs: string, text: string) => {
    text = text.replace(/&amp;/g, '&')
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // 去掉 xml:space="preserve" 并 trim 空白，避免空位置出现多余空格
    const trimmed = text.trim()
    if (!trimmed) return ''
    attrs = attrs.replace(/\s+xml:space="preserve"/g, '')
    return `<m:t${attrs}>${trimmed}</m:t>`
  })
  // Step 3: 清理空的 <m:r></m:r> 残留
  omml = omml.replace(/<m:r>\s*<\/m:r>/g, '')
  return omml
}

/** 行内文本 run，支持 **粗体** 与 $公式$ 混排 */
function inlineRuns(text: string, opts: { bold?: boolean; italic?: boolean; size?: number } = {}): string {
  const half = opts.size ? Math.round(opts.size * 2) : undefined // Word 用半磅
  const rPr = () => {
    const p: string[] = []
    if (opts.bold) p.push('<w:b/>')
    if (opts.italic) p.push('<w:i/>')
    if (half) p.push(`<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`)
    return p.length ? `<w:rPr>${p.join('')}</w:rPr>` : ''
  }

  const out: string[] = []
  // 按 $...$ 切分，奇数段为行内公式
  const parts = text.split(/\$([^$]+)\$/g)
  parts.forEach((seg, i) => {
    if (!seg) return
    if (i % 2 === 1) {
      try {
        out.push(latexToOmml(seg, false))
        return
      } catch {
        /* 公式解析失败则按普通文本输出 */
      }
    }
    for (const line of seg.split('\n')) {
      const idx = seg.split('\n').indexOf(line)
      if (idx > 0) out.push('<w:r><w:br/></w:r>')
      out.push(`<w:r>${rPr()}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`)
    }
  })
  return out.join('')
}

function pPr(align?: Align, style?: string, extra = ''): string {
  const parts: string[] = []
  if (style) parts.push(`<w:pStyle w:val="${style}"/>`)
  if (extra) parts.push(extra)
  if (align) parts.push(`<w:jc w:val="${align}"/>`)
  return parts.length ? `<w:pPr>${parts.join('')}</w:pPr>` : ''
}

/** 单个块 → OOXML 段落 */
function renderBlock(b: DocBlock): string {
  switch (b.type) {
    case 'heading': {
      const lvl = Math.min(Math.max(b.level ?? 1, 1), 6)
      return `<w:p>${pPr(undefined, `Heading${lvl}`)}${inlineRuns(b.text)}</w:p>`
    }
    case 'paragraph':
      return `<w:p>${pPr(b.align)}${inlineRuns(b.text, b)}</w:p>`
    case 'formula': {
      if (b.inline) {
        // 行内公式：单独成段但不居中
        return `<w:p>${pPr(b.align)}${latexToOmml(b.latex, false)}</w:p>`
      }
      // 独立公式：默认居中，用 oMathPara 包裹（Word 显示为块级公式）
      const omml = latexToOmml(b.latex, true)
      return `<w:p>${pPr(b.align ?? 'center')}<m:oMathPara>${omml}</m:oMathPara></w:p>`
    }
    case 'list':
      return b.items
        .map(
          (it) =>
            `<w:p>${pPr(undefined, undefined, `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${b.ordered ? 2 : 1}"/></w:numPr>`)}${inlineRuns(it)}</w:p>`
        )
        .join('')
    case 'table': {
      const cols = Math.max(...b.rows.map((r) => r.length), 1)
      const width = Math.floor(9360 / cols)
      const grid = `<w:tblGrid>${Array(cols).fill(`<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`
      const rows = b.rows
        .map((row, ri) => {
          const cells = Array.from({ length: cols }, (_, ci) => {
            const isHead = b.header && ri === 0
            const shd = isHead ? '<w:shd w:val="clear" w:fill="D9E2F3"/>' : ''
            return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shd}</w:tcPr><w:p>${pPr()}${inlineRuns(row[ci] ?? '', { bold: !!isHead })}</w:p></w:tc>`
          }).join('')
          return `<w:tr>${cells}</w:tr>`
        })
        .join('')
      const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
        .map((s) => `<w:${s} w:val="single" w:sz="4" w:color="808080"/>`)
        .join('')
      return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr>${grid}${rows}</w:tbl><w:p/>`
    }
    case 'pagebreak':
      return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
    default:
      return ''
  }
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`

function stylesXml(fontName: string, fontSize: number): string {
  const half = Math.round(fontSize * 2)
  const heading = (lvl: number, sz: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${lvl}"><w:name w:val="heading ${lvl}"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="${lvl - 1}"/><w:spacing w:before="${240 - lvl * 20}" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${esc(fontName)}" w:eastAsia="${esc(fontName)}" w:hAnsi="${esc(fontName)}" w:cs="Cambria Math"/><w:sz w:val="${half}"/><w:szCs w:val="${half}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${[44, 36, 30, 26, 24, 22].map((sz, i) => heading(i + 1, sz)).join('\n')}
</w:styles>`
}

const NUMBERING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`

function coreXml(title: string, author: string): string {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator><cp:lastModifiedBy>${esc(author)}</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`
}

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>WinAgent</Application></Properties>`

export interface BuildOptions {
  title?: string
  author?: string
  fontName?: string
  fontSize?: number
  landscape?: boolean
}

/** 构建 .docx 二进制内容 */
export async function buildDocx(blocks: DocBlock[], opts: BuildOptions = {}): Promise<Buffer> {
  const body = blocks.map(renderBlock).join('')
  const w = opts.landscape ? 16838 : 11906
  const h = opts.landscape ? 11906 : 16838
  const sect = `<w:sectPr><w:pgSz w:w="${w}" w:h="${h}"${opts.landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>`

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}${sect}</w:body></w:document>`

  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.folder('_rels')!.file('.rels', ROOT_RELS)
  const word = zip.folder('word')!
  word.file('document.xml', documentXml)
  word.file('styles.xml', stylesXml(opts.fontName || '等线', opts.fontSize || 11))
  word.file('numbering.xml', NUMBERING_XML)
  word.folder('_rels')!.file('document.xml.rels', DOC_RELS)
  const props = zip.folder('docProps')!
  props.file('core.xml', coreXml(opts.title || '文档', opts.author || 'WinAgent'))
  props.file('app.xml', APP_XML)

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
