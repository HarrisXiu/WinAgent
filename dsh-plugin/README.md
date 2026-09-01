# dsh-winagent

WinAgent 的 **DSH Web 插件**：把桌面版 WinAgent 的完整 Agent 能力（OpenAI 兼容 API / 本地 Ollama + 53+ 个 Windows 工具 + skills + MCP + LLM Wiki 个人知识库）装进 DSH，在 DSH Web 界面里直接使用。

- 聊天界面：流式输出、思维链折叠、工具调用卡片、危险操作确认弹窗、附件（图片/文本）
- 设置：Provider 管理、请求行为、视觉辅助、人设提示词、skills / mcp / vault 路径
- 知识库：文件树、全文搜索、编辑、URL 导入、上传文件自动编译入库（LLM Wiki）、LINT / REFLECT 工作流
- 数据目录：`$DSH_HOME/winagent/`（config.json、wiki/、skills/、mcp.json、Logs/）

> 说明：个性化桌宠主题（安洁莉娜立绘等）不在本插件范围内；人设提示词仍可在设置里自由修改。

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

## 卸载

```powershell
dsh plugin --profile web remove dsh-winagent
```

## 安全说明

- 插件运行在 dsh web 进程里，以当前 Windows 用户权限执行工具
- 删除 / 写注册表 / 结束进程 / 执行命令 / 模拟输入等危险操作默认需要弹窗确认（可在设置里关闭，请谨慎）
- API Key 以明文存于 `$DSH_HOME/winagent/config.json`（用户私有目录），请勿分享该目录
