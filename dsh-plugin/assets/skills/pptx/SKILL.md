---
name: read_pptx
description: 读取 PowerPoint 演示文稿（.pptx / .ppt）的文本内容，按幻灯片顺序返回每页文字。当用户需要读取、分析或引用 PPT（汇报、课件、提案）时使用。纯 JS 提取，无需安装 Office/LibreOffice。
entry: read_pptx.js
runtime: node
parameters:
  type: object
  properties:
    path:
      type: string
      description: 演示文稿的绝对路径
    max_chars:
      type: integer
      description: 返回文本的最大字符数，默认 80000
  required:
    - path
---

# PowerPoint 演示文稿读取器

读取 .pptx（OOXML）与 .ppt（旧版，经 PowerPoint COM 转换）演示文稿的文本内容，供知识库摄入与问答引用。

## 能力

- .pptx：按幻灯片顺序提取每页全部文本框文字（幻灯片间以空行分隔）
- .ppt：经 PowerShell + PowerPoint COM 先转换为 .pptx 再提取（需本机安装 Office PowerPoint）
- 返回字符数与截断标记（max_chars）

## 使用方式

调用工具 `read_pptx`，传入 `path`（演示文稿绝对路径）。脚本通过 Node.js + jszip 提取，无需额外安装依赖。

## 限制与提示

- 只提取文本，不提取图片/图表中的文字
- 备注页（notes）不在提取范围内
- .ppt 走 COM 转换：若本机未安装 PowerPoint 会报错，提示用户另存为 .pptx 后重试
- 提取的长文本会截断到 max_chars（默认 80000 字符），超出部分可再次调用并用 max_chars 分页获取

## 参考

官方 anthropics/skills 的 pptx skill（含创建/编辑/分析，依赖 LibreOffice）：
https://github.com/anthropics/skills/tree/main/skills/pptx
本项目采用轻量纯 JS 提取方案（零系统依赖），聚焦读取场景。
