use super::{tool, str_arg, prop};
use std::process::Command;

pub fn create() -> Vec<super::ToolEntry> {
    vec![
        tool(
            "find_windows",
            "列出所有可见窗口",
            serde_json::Map::new(),
            vec![],
            false,
            |_args| {
                let cmd = "Add-Type -AssemblyName UIAutomationClient; Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object ProcessName, Id, MainWindowTitle | Format-Table -AutoSize";
                let output = Command::new("powershell").args(["-NoProfile", "-Command", cmd]).output();
                match output {
                    Ok(o) => (true, String::from_utf8_lossy(&o.stdout).to_string()),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
        tool(
            "set_window_state",
            "设置窗口状态（minimize/maximize/restore）",
            {
                let mut props = serde_json::Map::new();
                props.insert("title".to_string(), prop("窗口标题（部分匹配）", "string"));
                props.insert("action".to_string(), prop("操作（minimize/maximize/restore）", "string"));
                props
            },
            vec!["title".to_string(), "action".to_string()],
            false,
            |args| {
                let title = str_arg(args, "title", "");
                let action = str_arg(args, "action", "restore");
                let state = match action.as_str() {
                    "minimize" => "Minimize",
                    "maximize" => "Maximize",
                    _ => "Restore",
                };
                let cmd = format!(
                    "$p = Get-Process | Where-Object {{ $_.MainWindowTitle -like '*{}*' }} | Select-Object -First 1; \
                     if ($p) {{ $sig = '[DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);'; \
                     $sw = Add-Type -MemberDefinition $sig -Name 'Win32' -Namespace 'Show' -PassThru; \
                     $sw::ShowWindow($p.MainWindowHandle, {}) }}",
                    title.replace('\'', "''"),
                    match state { "Minimize" => 6, "Maximize" => 3, _ => 9 }
                );
                let output = Command::new("powershell").args(["-NoProfile", "-Command", &cmd]).output();
                match output {
                    Ok(o) if o.status.success() => (true, format!("窗口已{}: {}", action, title)),
                    Ok(o) => (false, format!("未找到窗口或操作失败: {}", title)),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
        tool(
            "bring_window_to_front",
            "将窗口置于最前",
            {
                let mut props = serde_json::Map::new();
                props.insert("title".to_string(), prop("窗口标题（部分匹配）", "string"));
                props
            },
            vec!["title".to_string()],
            false,
            |args| {
                let title = str_arg(args, "title", "");
                let cmd = format!(
                    "$p = Get-Process | Where-Object {{ $_.MainWindowTitle -like '*{}*' }} | Select-Object -First 1; \
                     if ($p) {{ $sig = '[DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);'; \
                     $fg = Add-Type -MemberDefinition $sig -Name 'Win32' -Namespace 'FG' -PassThru; \
                     $fg::SetForegroundWindow($p.MainWindowHandle) }}",
                    title.replace('\'', "''")
                );
                let output = Command::new("powershell").args(["-NoProfile", "-Command", &cmd]).output();
                match output {
                    Ok(o) if o.status.success() => (true, format!("窗口已置于最前: {}", title)),
                    Ok(o) => (false, format!("未找到窗口: {}", title)),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
        tool(
            "close_window",
            "关闭窗口",
            {
                let mut props = serde_json::Map::new();
                props.insert("title".to_string(), prop("窗口标题（部分匹配）", "string"));
                props
            },
            vec!["title".to_string()],
            false,
            |args| {
                let title = str_arg(args, "title", "");
                let cmd = format!(
                    "Get-Process | Where-Object {{ $_.MainWindowTitle -like '*{}*' }} | ForEach-Object {{ $_.CloseMainWindow() }}",
                    title.replace('\'', "''")
                );
                let output = Command::new("powershell").args(["-NoProfile", "-Command", &cmd]).output();
                match output {
                    Ok(o) if o.status.success() => (true, format!("已关闭窗口: {}", title)),
                    Ok(o) => (false, format!("未找到窗口: {}", title)),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
    ]
}
