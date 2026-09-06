---
name: read_docx
description: 读取 Word 文档（.docx / .doc）的文本内容；with_images=true 时同时提取嵌入图片（word/media/）供视觉理解。当用户需要读取、分析或引用 Word 文档（报告、简历、合同、论文等）时使用。纯 JS 提取，无需安装 Office/LibreOffice。
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
    with_images:
      type: boolean
      description: 是否同时提取嵌入图片（仅 .docx）。图片以 [[IMG:...]] 标记返回，宿主会自动转为视觉输入，届时可直接查看图片内容
    max_images:
      type: integer
      description: with_images 时最多提取的图片数，默认 8
  required:
    - path
---

# Word 文档读取器

读取 .docx（OOXML）与 .doc（OLE 旧版）Word 文档的文本内容，供知识库摄入与问答引用。

## 能力

- .docx：按段落提取全文（保留段落结构、表格单元格按行拼接）
- .doc：通过 word-extractor 提取正文
- 返回字符数与截断标记（max_chars）
- with_images=true：解包 `word/media/` 提取嵌入图片（png/jpg/gif/webp），以 `[[IMG:...]]` 标记返回，宿主自动转为视觉输入

## 使用方式

调用工具 `read_docx`，传入 `path`（文档绝对路径）。需要理解文档中的图表/截图/插图时传 `with_images: true`——图片会自动作为视觉输入附带，下一轮可直接结合图片内容分析（无需再调用其他工具）。

## 限制与提示

- 页眉页脚中的文字不提取（docx 正文只取 document.xml）；文本框内容可能丢失
- 图片提取仅支持 .docx；emf/wmf/svg/tiff 等格式会跳过并在 images_skipped 中说明
- 提取的长文本会截断到 max_chars（默认 80000 字符），超出部分可再次调用并用 max_chars 分页获取
- .doc 需要 word-extractor 支持；若提取失败可提示用户另存为 .docx 后重试

## 参考

官方 anthropics/skills 的 docx skill（含创建/编辑/审阅，依赖 LibreOffice）：
https://github.com/anthropics/skills/tree/main/skills/docx
本项目采用轻量纯 JS 提取方案（零系统依赖），聚焦读取场景。
