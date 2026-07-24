# Skills 插件目录

把每个 skill 放在本目录下的独立子文件夹中，每个 skill 需包含一个 `manifest.json`。
启动时 WinAgent 会自动扫描并把它们注册为可供模型调用的工具。

## manifest.json 字段

```json
{
  "name": "工具名（模型调用时使用，需唯一）",
  "description": "工具用途说明（会展示给模型）",
  "runtime": "node | python | command",
  "entry": "入口文件，如 index.js / main.py / run.bat",
  "dangerous": false,
  "parameters": {
    "type": "object",
    "properties": {
      "参数名": { "type": "string", "description": "参数说明" }
    },
    "required": ["参数名"]
  }
}
```

## 运行约定

- WinAgent 以对应 runtime 运行 `entry`，工作目录为该 skill 目录。
- **参数**通过 **stdin** 以 JSON 传入。
- **返回结果**：向 **stdout** 打印文本；退出码 0 表示成功，非 0 视为失败（stderr 作为错误信息）。
- `runtime` 说明：
  - `node`：用 WinAgent 内置的 Node 运行（无需系统安装 Node）。
  - `python`：调用系统 `python`（需自行安装）。
  - `command`：用 `cmd /c entry` 执行（可运行 .bat/.exe/命令）。
- `dangerous: true` 时，执行前会弹出确认框（除非在设置里开启“自动放行”）。

参见 `hello/` 示例。
