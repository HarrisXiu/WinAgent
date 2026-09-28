# Wiki 导入真实测试节点（2026-09-28）

- 已直接启动 `release/WinAgent-0.5.0-win64-networkfix.exe`，在 Wiki「处理记录」对 `APA文献引用书写格式.doc` 执行「重试 / 继续」。
- 首次通过受限测试进程运行时，写入用户数据目录报 `EPERM`；同一路径在正常权限下写入、重命名成功。正常权限启动后，导入进入实际模型请求，最终报 `part-1 的模型输出过短`，不再是 `fetch failed`。
- 对用户当前配置的 `deepseek-flash` 实际 API 做了不输出密钥和正文的短请求诊断：默认请求有思考内容；传入 `thinking: { type: 'disabled' }` 后思考长度为零且正文正常返回。关闭思考参数的完整组合也已获 API 接受。
- 据此将 Wiki 详细分析请求设置为 `thinking: 'off'`，并添加请求参数测试。`npm run plugin:build` 和相关 22 项测试通过；已生成 `release/WinAgent-0.5.0-win64-wiki-livefix.exe`。
- **尚未验证新 EXE 对整份 DOC 的最终分析结果。** 用户要求暂时保存节点，待额度恢复后，从启动该新 EXE、正常权限重试该文档开始，确认每个片段及最终知识页。若仍失败，记录响应的 `finish_reason`、正文长度、思考长度和 token 用量，勿记录密钥或文档正文。

## 验证结果（2026-09-28，续）

- **根因确认**：`deepseek-flash` 默认开启深度思考，思考 token 计入 `max_tokens=6500`，2400 字片段在写出正文前预算即被耗尽 → `finish_reason=length`。旧报错「模型输出过短」是误导，实为「输出被截断」。
- **真实 API 验证**（当前源码，`thinking: 'off'`）：对 `raw/imports/APA文献引用书写格式.doc` 全部 4 个片段各请求 1 次，共 4 次，无拆分。每段 `finish_reason=stop`、思考 0 字、输出 1123–2077 tokens（远低于 6500），JSON 解析与原文证据校验全部通过。
- **额度消耗隐患已修复**：截断后二分重试原深度 6（每片段最多 127 次请求）。若截断由思考引起，二分无效，只会烧光额度。现改为：思考长度大于正文时立即失败并提示换非思考模型；其余截断最多拆分 3 层。报错附 `finish_reason`、`max_tokens`、输出 tokens、正文/思考字数（不含正文与密钥）。
- `WorkspaceStore.write` 在 Windows 上 rename 遇 `EPERM/EBUSY/EACCES` 时退避重试，最终失败会清理 `*.tmp`。`.winagent/jobs`、`sources` 下历史残留的 `.tmp` 文件未删除，可手动清理（`list()` 已忽略，不影响功能）。
- `node --test tests/*.test.cjs`：33 项全部通过（新增 2 项截断回归测试）。
- **仍待用户确认**：在应用内正常权限对该文档点「重试」，检查最终知识页的内容质量（上述验证只到分析结果，未写入知识库）。

## v0.5.1 收尾（2026-09-28）

- 同类隐患集中处理：新增 `dsh-plugin/src/llm/TaskChat.ts` 作为所有后台模型调用的统一出口，另外 8 处调用已迁移。详见 README「故障排查」与 v0.5.1 更新日志。
- 以后遇到同类报错：先运行 `npm run diagnose:model -- --source <资料id>`，按 README 故障排查表处理。
- 已生成 `release/WinAgent-0.5.1-win64.exe`，启动验证通过（版本号 0.5.1、无渲染错误）。仍需在应用内对该文档点「重试」确认最终知识页。
