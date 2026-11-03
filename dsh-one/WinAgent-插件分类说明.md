# WinAgent → DSH 分类插件

共 12 个独立插件，68 个静态工具（包含原有 7 个 skills）；外部 Skills/MCP 的工具按配置动态增加。每个子文件夹都可直接添加到 DSH Plugins。

| 文件夹 | 分类 | 工具数 |
| --- | --- | ---: |
| [dsh-winagent-office](./dsh-winagent-office/README.md) | Office 文档 | 7 |
| [dsh-winagent-pdf](./dsh-winagent-pdf/README.md) | PDF 阅读与视觉 | 3 |
| [dsh-winagent-files](./dsh-winagent-files/README.md) | 文件与目录 | 13 |
| [dsh-winagent-system](./dsh-winagent-system/README.md) | Windows 系统 | 8 |
| [dsh-winagent-registry](./dsh-winagent-registry/README.md) | Windows 注册表 | 5 |
| [dsh-winagent-input](./dsh-winagent-input/README.md) | 键盘与鼠标 | 8 |
| [dsh-winagent-windows](./dsh-winagent-windows/README.md) | 窗口管理 | 4 |
| [dsh-winagent-network](./dsh-winagent-network/README.md) | HTTP 网络 | 2 |
| [dsh-winagent-wiki](./dsh-winagent-wiki/README.md) | Wiki 知识库 | 12 |
| [dsh-winagent-voice](./dsh-winagent-voice/README.md) | 语音与克隆音色 | 3 |
| [dsh-winagent-extensions](./dsh-winagent-extensions/README.md) | Skills 与 MCP 扩展 | 1 |
| [dsh-winagent-office2pdf](./dsh-winagent-office2pdf/README.md) | office2PDF 批量处理 | 2 |

工具和 skill 完整映射见 [plugins.json](./plugins.json)。本次迁移覆盖当前 ToolRegistry 注册的全部七组静态工具、Wiki 工具、语音工具和 assets/skills；根 skills/ 中的五个 skill 是较早版本副本，采用 assets/skills 中的新实现，不重复注册。office2PDF 另立专用插件。

## 安装

按需在 DSH Plugins 页面添加分类文件夹绝对路径，或 `dsh plugin --profile desktop add "file:<插件绝对路径>"`。每个包有 package.json、cordis.patch.yml、入口、已编译 lib、来源清单与说明。不会复制原项目 node_modules、私有配置或构建缓存。工具使用统一 winagent_ 前缀，避免与 DSH 原生 read_file/grep 冲突。

采用 file: 目录地址安装，DSH 的 pnpm 会安装包清单里的 npm 依赖；使用 link: 时先在插件目录执行 npm install --omit=dev。office2PDF 额外需要配置 Python，详见其 README。插件只提供 DSH 原生 Agent 工具，不复制 Electron 聊天窗口、桌宠或主题 UI。

## 更新与验证

WinAgent 仓库中运行 `node scripts/build-dsh-one.cjs` 重新生成分类插件；`node --test tests/dsh-one.test.cjs` 进行注册、清单覆盖、审批、文件/Office/PDF 与 office2PDF 验证。构建中间结果放在 WinAgent/dsh-one，交付副本放在桌面 dsh-one；现有 dsh-plugin-finder 保留。
