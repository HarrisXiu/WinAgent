# dsh-winagent

WinAgent 的 **DSH Web 插件**：把桌面版 WinAgent 的完整 Agent 能力（OpenAI 兼容 API / 本地 Ollama + 53+ 个 Windows 工具 + skills + MCP + LLM Wiki 个人知识库）装进 DSH，在 DSH Web 界面里直接使用。

- 聊天界面：流式输出、思维链折叠、工具调用卡片、危险操作确认弹窗、附件（图片/文本/PDF）
- 设置：Provider 管理、请求行为、视觉辅助、人设提示词、skills / mcp / vault 路径
- 知识库：文件树、全文搜索、编辑、URL 导入、上传文件自动编译入库（LLM Wiki）、LINT / REFLECT 工作流
- 文档处理：模型优先三层管线（见下节）
- 数据目录：`$DSH_HOME/winagent/`（config.json、wiki/、skills/、mcp.json、Logs/）

> 说明：个性化桌宠主题（安洁莉娜立绘等）不在本插件范围内；人设提示词仍可在设置里自由修改。

## 文档处理管线（模型优先）

模型承担理解/结构化/内容生成，工具只做确定性 I/O 与序列化：

**读取（混合回退链）**：① PDF 附件直传（provider 支持文件输入时；拒收自动降级）→ ② `render_pdf_page` 整页渲染 PNG 视觉阅读（扫描件/复杂排版）→ ③ `read_pdf` / `read_docx` 等哑提取 + 模型结构化（skills，纯 JS 零系统依赖）→ ④ 大文件纯提取直出省 token。

**图片视觉**：`read_docx(with_images)` 解包 `word/media/`、`extract_pdf_images` 抽 PDF 嵌入图——skill 在 stdout 输出 `[[IMG:data:...;base64,...]]` 标记，Agent 自动剥离并转为视觉输入（非 vision 模型走视觉辅助描述）。

**生成**：`markdown_to_docx`（pandoc 检测到则优先，否则内置 temml+mathml2omml 纯 JS 链，LaTeX → Word 原生公式）、`write_xlsx`（SheetJS，sheets JSON 或 Markdown 表格）、`write_pptx`（pptxgenjs，三版式）。

**转换**：`office_convert` 四级降级链——纯 JS（SheetJS 表格互转）→ pandoc（md/docx/html/txt）→ LibreOffice headless → MS Office COM（docx→pdf 等，本机装有 Office 即可用）；不可达时报错附安装指引。

**能力探测**：`GET /winagent/api/capabilities` 返回 pandoc / soffice / Office COM / pdfjs 渲染链 / PyMuPDF 可用性；系统提示词自动注入能力摘要，Agent 按可用路径选择。

可选依赖（未装时对应能力降级，其余功能不受影响）：`npm install pdfjs-dist @napi-rs/canvas`（PDF 视觉渲染）。

## 安装

方式 A —— 从本地仓库链接安装（开发）：

```powershell
# 在 dsh 仓库根目录执行（本机没有全局 dsh 时用 pnpm dsh）
pnpm dsh plugin --profile web add link:C:\Users\<你>\Desktop\WinAgent\dsh-plugin
```

方式 B —— 发布 npm 后：

```powershell
dsh plugin --profile web add dsh-winagent
```

方式 C —— 从 GitHub 安装（发布后）：

```powershell
dsh plugin --profile web add github:<你的仓库>
```

## 构建

插件自带编译好的 `lib/`。改了 `src/` 后重新编译：

```powershell
cd dsh-plugin
npx tsc -p tsconfig.json
```

## 使用

1. 安装后重启 dsh web（`dsh web`），浏览器 F5 刷新
2. 页面右下角出现 **WinAgent** 悬浮按钮 → 点击打开插件界面
3. 先在「设置」里配置 Provider（OpenAI 兼容端填含 `/v1` 的 Base URL + API Key + 模型；或 Ollama 本地服务）
4. 直接在输入框下指令即可；危险操作默认弹窗确认

验证接口：

- `dsh --profile web --dump-config` 应能看到 `dsh-winagent` 在 bundles 里
- `http://127.0.0.1:3080/winagent/ui` 返回插件界面
- `http://127.0.0.1:3080/winagent/api/tools` 返回 JSON 工具列表
- `http://127.0.0.1:3080/winagent/api/capabilities` 返回本地能力探测结果（pandoc/LibreOffice/Office COM/pdfjs/PyMuPDF）

## 卸载

```powershell
dsh plugin --profile web remove dsh-winagent
```

## 安全说明

- 插件运行在 dsh web 进程里，以当前 Windows 用户权限执行工具
- 删除 / 写注册表 / 结束进程 / 执行命令 / 模拟输入等危险操作默认需要弹窗确认（可在设置里关闭，请谨慎）
- API Key 以明文存于 `$DSH_HOME/winagent/config.json`（用户私有目录），请勿分享该目录
