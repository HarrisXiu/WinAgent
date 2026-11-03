# 分类插件配置示例

每个插件可通过 DSH Plugins 页面添加 `file:文件夹绝对路径`，例如 `file:C:\Users\53031\Desktop\dsh-one\dsh-winagent-office`。这种安装方式会安装包内声明的 npm 依赖。若使用 `link:` 开发方式，先在插件目录执行 `npm install --omit=dev`。这里只生成插件文件；尚未改动已安装插件列表或 DSH profile。

## office2PDF

本机验证使用已有解释器 `C:\Users\53031\Desktop\office2PDF\.venv\Scripts\python.exe`，其依赖满足插件要求，可直接复用。也可在其他 Python 环境中安装该插件 `python/requirements.txt`。

对应的 bundle 配置条目：

```yaml
- id: dsh-winagent-office2pdf
  name: dsh-winagent-office2pdf
  config:
    pythonPath: 'C:\Users\53031\Desktop\office2PDF\.venv\Scripts\python.exe'
    timeoutMs: 600000
```

对话中可要求调用 `winagent_office2pdf_inspect` 检查环境；批量转换工具参数示例：

```json
{
  "files": [
    { "path": "C:\\Documents\\report.docx", "range": "1-3" },
    { "path": "C:\\Documents\\data.xlsx", "range": "Sheet1,Sheet2" }
  ],
  "output_dir": "C:\\Documents\\PDF",
  "options": {
    "engine": "auto",
    "merge_all": true,
    "naming_tpl": "合并结果",
    "wm1_text": "内部资料",
    "wm1_pos": "diag",
    "pg_enabled": true,
    "blank_page_action": "remove"
  }
}
```

已有输出自动加序号；返回逐个输入状态、所有输出路径和日志。页面范围从 1 开始；Excel 的 range 使用工作表名称。取消或超时后已输出的文件保留，重试前先检查结果。

## 自定义 Skills 和 MCP

```yaml
- id: dsh-winagent-extensions
  name: dsh-winagent-extensions
  config:
    skillsDirs:
      - 'C:\Documents\my-skills'
    mcpConfigPath: 'C:\Documents\mcp.json'
```

同时支持 `manifest.json` 与 `SKILL.md`。内置 Office/PDF 的 skills 已由各分类插件提供，不要再将它们加入此处，以免重复。工具统一加 `winagent_` 前缀，如 `winagent_mcp__myserver__mytool`。

## 知识库和语音

Wiki 通过 `vaultPath` 指定知识库目录。Provider 与 MiMo 配置读取 `$DSH_HOME/winagent/config.json`；`WINAGENT_DATA_DIR` 可覆盖数据目录。迁移未复制原项目的 API Key 或私有配置。

语音使用 `winagent_speak_text` 生成音频路径，再通过 DSH 的 `present_files` 展示播放。通过 `winagent_add_voice_clone` 导入本地音色样本，再使用返回的 `clone:<id>`。

## PDF 视觉输出

页面渲染和 Office 嵌入图片通过 DSH 的 `attachments` 服务保存为持久化引用，模型可在后续请求中查看。需要 DSH 附件服务以及支持图像输入的模型；PDF 插件中 `pdfjs-dist`、`@napi-rs/canvas` 为可选依赖。
