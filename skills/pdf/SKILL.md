---
name: read_pdf
description: 读取 PDF 文件的文本内容与基本信息（页数、字符数、全文文本）。当用户需要读取、分析或引用 PDF 文档（如论文、报告、书籍章节）时使用。适配自 Anthropic 官方 anthropics/skills 的 pdf skill（Apache 2.0 / source-available）。
entry: read_pdf.js
runtime: node
parameters:
  type: object
  properties:
    path:
      type: string
      description: PDF 文件的绝对路径
    max_chars:
      type: integer
      description: 返回文本的最大字符数，默认 50000
  required:
    - path
---

# PDF 读取器（适配自 anthropics/skills 官方 pdf skill）

读取 PDF 文档的文本内容，供知识库摄入与问答引用。

## 能力

- 提取 PDF 全文文本（保留段落结构）
- 返回页数、字符数等元信息
- 支持分页截断（max_chars）

## 使用方式

调用工具 `read_pdf`，传入 `path`（PDF 绝对路径）。脚本通过 Node.js + pdf-parse 提取，无需额外安装依赖。

## 限制与提示

- 扫描版 PDF（纯图片）提取不到文本——这是 pdf-parse 的固有限制。若遇到空文本，可提示用户该 PDF 为扫描件，需要 OCR（如 pytesseract）。
- 复杂排版（多栏、表格）的文本顺序可能不完全符合视觉顺序。
- 提取的长文本会截断到 max_chars（默认 50000 字符），超出部分可再次调用并用 max_chars 分页获取。

## 参考

官方原版（含表单处理、OCR、图片转换等更多脚本）：
https://github.com/anthropics/skills/tree/main/skills/pdf
