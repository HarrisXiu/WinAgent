---
name: read_xlsx
description: 读取 Excel 电子表格（.xlsx / .xlsm / .xls）的文本内容，按工作表返回单元格数据（行内单元格以 | 分隔）。当用户需要读取、分析或引用 Excel（数据表、台账、报表）时使用。纯 JS 提取，无需安装 Office/LibreOffice。
entry: read_xlsx.js
runtime: node
parameters:
  type: object
  properties:
    path:
      type: string
      description: 电子表格的绝对路径
    max_chars:
      type: integer
      description: 返回文本的最大字符数，默认 80000
  required:
    - path
---

# Excel 电子表格读取器

读取 .xlsx / .xlsm（OOXML）与 .xls（旧版二进制）电子表格的内容，供知识库摄入与问答引用。

## 能力

- .xlsx / .xlsm：逐工作表提取，行内单元格以 ` | ` 分隔（含共享字符串解析）
- .xls：通过 SheetJS（xlsx 包）读取所有工作表
- 每个工作表前标注「【工作表 N】」便于定位
- 返回字符数与截断标记（max_chars）

## 使用方式

调用工具 `read_xlsx`，传入 `path`（电子表格绝对路径）。脚本通过 Node.js + jszip / xlsx 提取，无需额外安装依赖。

## 限制与提示

- 只提取单元格文本，不提取公式计算结果以外的格式信息；公式单元格取缓存值
- 合并单元格、批注不在提取范围内
- 空单元格跳过（行内只保留非空单元格）
- 提取的长文本会截断到 max_chars（默认 80000 字符），超出部分可再次调用并用 max_chars 分页获取

## 参考

官方 anthropics/skills 的 xlsx skill（含建表/公式/格式化，依赖 LibreOffice）：
https://github.com/anthropics/skills/tree/main/skills/xlsx
本项目采用轻量纯 JS 提取方案（零系统依赖），聚焦读取场景。
