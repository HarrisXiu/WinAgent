---
name: render_pdf_page
description: 把 PDF 页面渲染成高清 PNG 图片供视觉理解（多模态模型直接查看）。适用于扫描版 PDF、图表密集、多栏复杂排版等 read_pdf 文本提取效果不佳的场景；也用于查看指定页的版式与插图。
entry: render_pdf_page.js
runtime: node
parameters:
  type: object
  properties:
    path:
      type: string
      description: PDF 文件的绝对路径
    pages:
      type: string
      description: 要渲染的页码（1 起）：单页 "3"、多页 "1,3,5"、范围 "2-4"，默认第 1 页
    scale:
      type: number
      description: 渲染缩放倍率 0.5-3，默认 1.5（越大越清晰，token 消耗也越高）
    max_pages:
      type: integer
      description: 单次最多渲染页数，默认 6（硬上限 10）
  required:
    - path
---

# PDF 页面渲染器（视觉理解路径）

把 PDF 整页渲染为 PNG，以 `[[IMG:...]]` 标记返回，宿主自动转为视觉输入——下一轮消息中可直接"看到"页面内容（文字、图表、排版、插图全部可见）。

## 何时使用

- `read_pdf` 提取不到文本或文本顺序混乱（扫描件、多栏排版、图文混排）→ 改用本工具整页视觉阅读
- 用户问"这页讲的什么""图里画了什么""表格内容是什么" → 渲染该页后直接看图回答
- 数学公式密集的论文/讲义 → 视觉读取比文本提取更可靠

## 使用方式

调用工具 `render_pdf_page`，传 `path` 与 `pages`。先渲染第 1 页判断文档类型，再按需渲染目标页。图片会自动作为视觉输入附带，无需再调用其他工具传递图片。

## 限制与提示

- 需要多模态（vision）模型或已配置视觉辅助，否则图片不可见
- 每页约消耗 700-1500 token（随分辨率升高）；控制单次页数与 scale
- 可选依赖 pdfjs-dist / @napi-rs/canvas 未安装时会报错并给出安装指引；期间可用 read_pdf 提取文本
