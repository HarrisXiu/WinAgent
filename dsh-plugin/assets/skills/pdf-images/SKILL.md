---
name: extract_pdf_images
description: 从 PDF 中抽取嵌入的原始图片对象（图表/插图/照片），转为视觉输入。适合"只看某张图"的精准场景；要理解整页排版用 render_pdf_page，读全文文本用 read_pdf。
entry: extract_pdf_images.js
runtime: node
parameters:
  type: object
  properties:
    path:
      type: string
      description: PDF 文件的绝对路径
    pages:
      type: string
      description: 要扫描的页码（1 起）：单页 "3"、多页 "1,3,5"、范围 "2-4"，默认全部页
    max_images:
      type: integer
      description: 最多提取的图片数，默认 10（硬上限 20）
    min_size:
      type: integer
      description: 跳过小于该边长（像素）的装饰性小图，默认 32
  required:
    - path
---

# PDF 嵌入图片抽取器

扫描 PDF 的页面操作符，把嵌入的位图对象（照片、图表截图等）导出为 PNG，以 `[[IMG:...]]` 标记返回，宿主自动转为视觉输入。

## 何时使用

- 用户问"PDF 里的图表/插图/照片是什么内容"，且只需要图片本身（不必看整页）→ 用本工具，比整页渲染省 token
- 需要把 PDF 内图片内容与正文对照分析 → read_pdf（文本）+ 本工具（图片）组合
- 要看整页版式/多栏排版/扫描件 → 用 render_pdf_page

## 使用方式

调用工具 `extract_pdf_images`，传 `path`（可选 `pages` 限定扫描范围）。返回的 JSON 列出每张图的页码与尺寸，图片自动作为视觉输入附带，下一轮可直接查看分析。

## 限制与提示

- 矢量图形（PDF 原生绘制的图表，非嵌入位图）抽不出来——这类内容请用 render_pdf_page 整页渲染
- 带透明通道（SMask）的图片转 PNG 后背景可能异常；对颜色敏感时建议整页渲染
- 每图约消耗 700-1500 token；控制 max_images
- 可选依赖 pdfjs-dist / @napi-rs/canvas 未安装时报错并给出安装指引
