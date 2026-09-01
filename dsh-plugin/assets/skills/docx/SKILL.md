---
name: read_docx
description: 读取 Word 文档（.docx / .doc）的文本内容。当用户需要读取、分析或引用 Word 文档（报告、简历、合同、论文等）时使用。纯 JS 提取，无需安装 Office/LibreOffice。
entry: read_docx.js
runtime: node
parameters:
  type: object
  properties:
    path:
      type: string
      description: Word 文档的绝对路径
    max_chars:
      type: integer
      description: 返回文本的最大字符数，默认 80000
  required:
    - path
---

# Word 文档读取器

读取 .docx（OOXML）与 .doc（OLE 旧版）Word 文档的文本内容，供知识库摄入与问答引用。

## 能力

- .docx：按段落提取全文（保留段落结构、表格单元格按行拼接）
- .doc：通过 word-extractor 提取正文
- 返回字符数与截断标记（max_chars）

## 使用方式

调用工具 `read_docx`，传入 `path`（文档绝对路径）。脚本通过 Node.js + jszip / word-extractor 提取，无需额外安装依赖。

## 限制与提示

- 不提取图片、页眉页脚中的文字（docx 正文只取 document.xml）
- 文本框内容不在 document.xml 内，可能丢失
- 提取的长文本会截断到 max_chars（默认 80000 字符），超出部分可再次调用并用 max_chars 分页获取
- .doc 需要 word-extractor 支持；若提取失败可提示用户另存为 .docx 后重试

## 参考

官方 anthropics/skills 的 docx skill（含创建/编辑/审阅，依赖 LibreOffice）：
https://github.com/anthropics/skills/tree/main/skills/docx
本项目采用轻量纯 JS 提取方案（零系统依赖），聚焦读取场景。
