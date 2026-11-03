# WinAgent 分类插件验证记录

## 覆盖范围

- 12 个独立 DSH bundle，68 个静态工具，7 个内置 skills。
- 当前 WinAgent 的 62 个原有工具和 skills 全部覆盖。额外提供两个知识库导入工具、两个克隆音色管理工具和两个 office2PDF 工具。
- 原 `dsh-plugin`、WinAgent 桌面代码、office2PDF 原项目和已有 `dsh-plugin-finder` 保留；没有复制 API Key、私有配置、node_modules 或 Electron 构建文件。

## 已通过

- 11 项 Node 集成测试：工具注册与卸载、来源覆盖、DSH schema 子集、审批保留、失败回滚、文件实际读写、取消前检查、Office 生成与读取、Word 原生数学公式、PDF 页面渲染、DSH 图像持久化引用、外部 skill 和 MCP HTTP 挂载调用、office2PDF 处理链。
- 24 项 office2PDF 上游 Python 回归测试：Office/WPS 会话隔离与回退、用户进程保护、页码范围、合并、拆分、水印、加密、空白页识别与保留、不覆盖文件、队列与取消。
- 本机 DSH 0.2.0-rc.2 的真实 schema 校验器接受全部 68 个工具声明；真实 ToolRuntime 成功执行文件读取，无审批服务时危险操作被拒绝。
- 本机 Microsoft Office 的 Word、Excel、PowerPoint 三个实际转换全部成功，使用 office2PDF/test_artifacts 中的示例输入，输出至临时目录，未改写输入。
- 12 个包的 TypeScript/构建检查通过，npm pack dry-run 均包含插件入口、bundle patch 与对应资源。

## 测试环境

Node.js 24；office2PDF 原有 Python 3.12 环境，pywin32 312、pypdf 6.18.0、Pillow 12.3.0、reportlab 5.0.1、pypdfium2 5.13.0。测试中仅使用临时文件和本地 MCP 模拟服务器。

## 尚未实测的部分

MiMo 在线语音合成、依赖模型 API 的 Wiki 分析/反思，以及 WPS 的实际文档导出，尚未进行真实服务测试。其源实现与配置入口已迁移。Windows 输入模拟、注册表修改和进程结束工具经过接口与来源覆盖校验，没有为验证而实际修改系统或操作用户窗口。

## 复验

在 WinAgent 仓库运行：

```powershell
node scripts/build-dsh-one.cjs
$env:DSH_OFFICE2PDF_TEST_PYTHON='C:\Users\53031\Desktop\office2PDF\.venv\Scripts\python.exe'
node --test tests/dsh-one.test.cjs
& $env:DSH_OFFICE2PDF_TEST_PYTHON -m unittest discover -s dsh-one/dsh-winagent-office2pdf/python -p 'test_*.py' -v
```

Python 回归包含上游桌面 API 测试，使用原 office2PDF 开发环境；转换插件本身无需 pywebview 或 PyInstaller。接口已生成，可按分类安装到 DSH；没有自动安装或修改 DSH profile。
