# Lares 工程清单

方向（2026-11-03 确定）：新建 `Lares` 项目，走自有内核路线，定位为个人 harness。Windows、Office、语音都是可开关的能力包；Wiki 先剔除，以后按能力包重做。WinAgent 发最后一版后冻结，只修严重 bug，完整的 Wiki 留在旧仓库。

- 文件夹：`C:\Users\53031\Desktop\Lares`，与 `WinAgent` 同级
- 仓库：`HarrisXiu/Lares`，公开，MIT 许可，开放 issue；应用能启动、测试通过后才推送
- 包名：`lares`，不发布到 npm（npm 上的主名已被占）

依据：[近期 Agent 创新与 WinAgent 借鉴](近期%20Agent%20创新与%20WinAgent%20借鉴.md)，`#` 编号与报告一致。状态：待你审阅，尚未开工。

工作量是按一人估算的，不是测量值。不含 Wiki 重做，全部约 38–58 人日，其中收尾、建仓和底座（阶段 0–4）约 12–17 人日。界面预览和恢复界面的工作量另算。

## 总览

| 阶段 | 目标 | 包含 | 工作量 | 进入条件 |
|---|---|---|---|---|
| 0 | WinAgent 收尾 | 新增 | 0.5–1 天 | 无 |
| 1 | 建立 Lares 仓库，剔除 Wiki | 新增 | 3–4 天 | 阶段 0 完成 |
| 2 | 修小缺陷、加观测 | #1、#2 | 1.5–3 天 | 阶段 1 完成 |
| 3 | 堵住安全缺口 | #3、#5 | 4–5 天 | 阶段 1 完成 |
| 4 | 主循环可靠 | #4、#6 | 3–4 天 | 阶段 1 完成 |
| 5 | 能力包边界 | 新增 | 2–3 天 | 阶段 3、4 完成 |
| 6 | 无界面入口 | 新增 | 2–3 天 | 阶段 5 完成 |
| 7 | 多任务并行 | 新增 | 3–5 天 | 阶段 5 完成 |
| 8 | 感知与回滚 | #7、#8、#9 | 6.5–10 天 | 阶段 3 完成 |
| 9 | 定时与触发 | #14 | 3–5 天 | 阶段 3、7 完成 |
| 10 | 记忆与 Goal | #15、#13 | 5–8 天 | 阶段 4、5 完成 |
| 11 | 按数据决定的优化 | #11、#12、#16 | 4.5–6.5 天 | 见各项条件 |
| 以后 | Wiki 重做 | 未排期 | 未估算 | 能力包接口稳定后 |

报告里的 #10（规范移出 system prompt）不再需要，任务规范会随 Wiki 一起移除。

## 阶段 0：WinAgent 收尾（0.5–1 天，在旧仓库）

| 任务 | 完成标准 |
|---|---|
| 手测工具循环（**需要你来做**）：选 DeepSeek，思考设为自动，发“列出桌面文件” | 确认是否报 400；同时确认切模型后对话是否保留 |
| 分批提交现有改动 | 工作区干净，分组经你确认 |
| README 加迁移声明 | 指向 `HarrisXiu/Lares` |
| 如手测报 400，修复 `reasoning_content` 回传 | 工具循环能跑通 |
| 打最终标签 | 标签对应 Lares 的代码来源 |

声明要等 Lares 公开后再推送，否则链接是 404。

## 阶段 1：建立 Lares 仓库（3–4 天）

| 任务 | 位置 | 完成标准 |
|---|---|---|
| 建文件夹，从 WinAgent 最终标签复制代码，全新首次提交 | `Desktop\Lares` | 提交说明注明来源 commit，不带旧历史 |
| 调整结构 | `dsh-plugin/src` → `core/` | 编译产物不进 Git（旧仓库 `dsh-plugin/lib` 被跟踪了 103 个文件） |
| 剔除 Wiki：`wiki/`、`tools/wikiTools.ts`、`components/wiki/`、`useWiki.ts`、知识检索和引用、任务规范 | `core/`、renderer、`src/main`、`preload` | `core/agent/` 不再 import Wiki；只有 Wiki 用的依赖一并移除，移除前逐个核对 |
| 剔除 DSH 形态：`server.ts`、插件入口、`cordis.patch.yml`、`dsh-one`、相关脚本和测试 | 全仓库 | 不再依赖 DSH |
| 专题任务改成普通多任务会话（**先出预览**） | renderer | 不再依赖 Wiki 标签 |
| 改名 | `package.json`、`electron-builder.yml`、`winagent-skin://`、`WINAGENT_DATA_DIR`、`WinAgentCore` 等 | 代码里不再有 `winagent`；数据目录是 `%APPDATA%\com.lares.app`，不读写旧目录 |
| 整理系统提示词 | `core/agent/AgentService.ts` | 去掉 Wiki 规则；人设默认中性 |
| 仓库文件 | `README.md`、`LICENSE`、issue 模板 | MIT 保留原版权行，README 写清与 WinAgent 的关系 |
| 启动和测试 | `tests/`、`npm run dev`、打包 | 应用能启动、无白屏，剩余测试通过 |
| 建 GitHub 公开仓库并推送 | `HarrisXiu/Lares` | MIT，issue 已开放；全部通过后才推送 |

## 阶段 2：修小缺陷、加观测 #1、#2（1.5–3 天）

| 任务 | 位置 | 完成标准 |
|---|---|---|
| 修复 `reasoning_content` 回传（如阶段 0 确认） | `core/llm/OpenAIClient.ts` | 有带 `tools` 的回归测试 |
| 修 `key_combination` 把 `win` 当字符发送的问题 | `core/tools/inputTools.ts` | `win+d` 能正常触发 |
| 核对预设 `deepseek-chat` | `core/config/ConfigStore.ts` | 不可用就更新 |
| 诊断脚本覆盖工具路径 | `scripts/diagnose-model.cjs` | 能探测带工具的请求 |
| 解析缓存命中字段并显示 #2 | `core/llm/OpenAIClient.ts`、renderer | 能看到每轮和累计命中率 |
| 事件 JSONL 日志 #2 | `core/agent/` | 能看到每轮时间线，默认不记录正文和工具参数 |

这里的数据决定 #16 和压缩阈值要不要动。

## 阶段 3：安全 #3、#5（4–5 天）

| 任务 | 位置 | 完成标准 |
|---|---|---|
| 补危险标记 | `core/tools/` | `http_request`、`http_download`、`copy_file`、Office 写盘工具会触发确认 |
| 敏感路径硬拒绝 | `core/tools/` | `read_file`、`grep` 读不到数据目录和凭据目录 |
| 出站限制 | `core/tools/` | 只允许白名单域名和会话中出现过的 URL；白名单内无 body 的 GET 自动放行 |
| 工具结果加来源标记 | `core/agent/` | 工具输出带不可信标记（这只是弱防线） |
| 第三方 skill 收紧 | `core/skills/` | 默认危险、有超时、不继承完整环境变量 |
| 外链协议过滤 | `src/main` | 只放行安全协议 |
| API Key 加密 #5 | `core/config/`，由宿主注入 `safeStorage` | 配置文件里不再有明文，渲染进程拿不到 Key |
| 危险确认测试 | `tests/` | 确认分支有测试覆盖 |

“本会话允许”这类审批框改造不在此列，**要先出预览**。

## 阶段 4：主循环可靠性 #4、#6（3–4 天）

| 任务 | 位置 | 完成标准 |
|---|---|---|
| 处理输出截断 | `core/agent/AgentService.ts` | `finish_reason=length` 不再被当作正常完成 |
| 达到 25 轮时提示 | `core/agent/AgentService.ts` | 界面有明确提示 |
| 工具参数解析失败 | `core/agent/AgentService.ts` | 不再以空参数继续执行 |
| 重试和超时 | `core/llm/` | 429、5xx 退避重试，有首字节超时 |
| 点停止后不再执行 | `core/agent/AgentService.ts` | 同批剩余工具不再运行 |
| 工具可取消（先做 `run_command`） | `core/tools/` | `Tool.run` 支持 signal |
| 工具输出上限与落盘 #6 | `core/tools/`、`core/agent/` | 超大输出写入文件，只回传预览和路径 |

## 阶段 5：能力包边界（2–3 天）

| 任务 | 位置 | 完成标准 |
|---|---|---|
| 定义能力包接口：每个包提供工具和提示词片段 | `core/tools/`、`core/bootstrap.ts` | 接口有类型定义和测试 |
| 拆分工具组：内核带文件和 HTTP，其余拆成 Windows、Office、语音 | `core/tools/ToolRegistry.ts` | 注册表不再写死工具组 |
| 拆分系统提示词 | `core/agent/AgentService.ts` | 片段按固定顺序拼接，不破坏缓存前缀 |
| 按配置开关能力包 | `core/config/` | 关掉任一包后核心仍可运行 |

回归标准：**全部能力包开启时，工具列表和提示词与改造前完全一致**，用快照测试保证。Wiki 以后按这个接口重做。

## 阶段 6：无界面入口（2–3 天）

| 任务 | 位置 | 完成标准 |
|---|---|---|
| 新增 CLI 入口 `lares` | `bin`，调用内核装配函数 | 不启动 Electron 也能跑完工具循环，用模拟模型测试 |
| 去掉对 Electron 的隐含依赖 | `core/platform.ts` 的 `ELECTRON_RUN_AS_NODE`、数据目录、Logger | 纯 Node 下 skills 和日志正常 |
| 无交互确认策略 | `core/agent/` | 没有人确认时默认拒绝危险操作 |
| Key 存储方案 | `core/config/` | CLI 下有明确方案，不退回明文 |

## 阶段 7：多任务并行（3–5 天，**先出预览**）

| 任务 | 位置 | 完成标准 |
|---|---|---|
| 每个任务独立的 Agent 实例 | `core/agent/AgentService.ts`、`core/bootstrap.ts` | 两个任务能同时运行 |
| 事件带任务 ID | `core/shared/types.ts`、`src/main` | 界面能按任务区分输出 |
| 确认弹窗改为排队 | `useAgent.ts` | 确认能对应到正确的任务 |
| 停止只影响当前任务 | `core/agent/` | 停一个任务不影响另一个 |

## 阶段 8：感知与回滚 #7、#8、#9（6.5–10 天）

| 任务 | 工作量 | 位置 | 完成标准 |
|---|---|---|---|
| 截图回传 #7 | 0.5–1 天 | Windows 能力包，输出 `[[IMG:...]]` | 模型能看到屏幕；不支持 Vision 的模型走视觉辅助 |
| UIA 感知 #7 | 3–5 天 | Windows 能力包，只读 | 能读前台窗口树 |
| 文件检查点 #8 | 2–3 天 | `core/tools/` | 写入和删除可回滚，删除先改走回收站；注册表、进程、GUI 明确不在范围内 |
| 恢复界面 #8 | 另算 | renderer | **先出预览** |
| MXC 本机验证 #9 | 1 天 | 本机试验 | 查清是否支持 Home 版、有没有 Node SDK、是否要求 package identity |

不直接接 Windows-MCP：现有 MCP 客户端会把截图转成文本，MCP 工具还会每步弹窗。目标是“有确认的辅助操作”，不是自治。

## 阶段 9：定时与触发 #14（3–5 天，**先出预览**）

| 任务 | 位置 | 约束 |
|---|---|---|
| 定时和事件触发 | 内核负责调度，`src/main` 负责托盘 | 无人值守默认拒绝危险操作 |
| 忙碌时持久排队 | 内核 | 重启后任务不丢 |
| 主动行为默认只记录不执行 | 内核 | 用户开启后才真正执行 |
| 语义过滤 | 内核 | 后台调用走 taskChat |

## 阶段 10：记忆与 Goal #15、#13（5–8 天）

| 任务 | 工作量 | 位置 | 约束 |
|---|---|---|---|
| 文件式冻结记忆 #15 | 2–3 天 | 独立能力包 | Wiki 移除后它是唯一的跨会话记忆，所以先于 Goal；有字符上限，会话开始时冻结注入，只由用户明确指令写入；加管理面板要先出预览 |
| Goal、预算与计划视图 #13 | 3–5 天 | 内核，renderer | **先出预览**；完成判定走 taskChat，优先用确定性验收，无法判定就标 UNVERIFIED |

## 阶段 11：按数据决定的优化（4.5–6.5 天）

| 任务 | 工作量 | 位置 | 做的条件 |
|---|---|---|---|
| 工具按需加载 #11 | 2–3 天加分模型测试 | `core/tools/`、`core/agent/` | 对照测试显示能提升选工具的准确率；工具列表保持确定 |
| MCP 客户端升级 #12 | 2–3 天 | `core/mcp/` | 你用得上远程 MCP，否则放后 |
| 可选 `prompt_cache_key` #16 | 0.5 天 | `core/llm/` | 实际用 OpenAI 旧模型且数据显示有必要；网关拒收时自动回退 |
| 调压缩阈值 | 试验 | `core/config/` | 阶段 2 的数据显示压缩频繁破坏前缀 |

## 明确不做或后置

Router/Worker 和子代理、Code Mode、云端 Agent Loop、公开技能市场、自动记忆整合、完整 CaMeL、Cascade/Critique、手机远程控制、A2A 和 AG-UI。转型成 harness 不改变这个判断：个人桌面场景仍然没有支持子代理的证据。原因见报告。

## 全程约束

- 新增的后台模型调用一律走 taskChat。
- 界面或交互大改先出方案和预览，确认后再动手。
- 内核不能新增对 Electron 或具体能力包的依赖。
- WinAgent 和 Lares 不同时开发，WinAgent 只修严重 bug。

## 你审阅时要决定的事

1. **安洁莉娜主题：** 我建议先不带过来。素材本来就没进 Git，这些立绘来自《明日方舟》，我没查过版权。主题包机制保留。
2. **定位表述：** 我建议写“能操作你电脑的常驻个人 agent”。Wiki 重做后再加上“记得你的资料”。
3. **阶段 3 和阶段 4 的先后：** 我建议先安全后可靠性，两者互不依赖，可以对调。
4. **截图回传要不要提前：** 它只要 0.5–1 天，可以提到阶段 2 之后单独做。我建议提前，因为 Wiki 移除后桌面操作成了主要卖点。
