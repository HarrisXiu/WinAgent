use super::{tool, str_arg, prop};
use std::process::Command;

pub fn create() -> Vec<super::ToolEntry> {
    vec![
        tool(
            "get_system_info",
            "获取 Windows 系统信息（OS、CPU、内存、磁盘）",
            serde_json::Map::new(),
            vec![],
            false,
            |_args| {
                let output = Command::new("powershell")
                    .args(["-NoProfile", "-Command",
                        "Write-Output \"OS: $((Get-CimInstance Win32_OperatingSystem).Caption)\"; \
                         Write-Output \"CPU: $((Get-CimInstance Win32_Processor).Name)\"; \
                         Write-Output \"RAM: $([math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1)) GB\"; \
                         Write-Output \"Disk Free: $([math]::Round((Get-PSDrive C).Free/1GB,1)) GB\""])
                    .output();
                match output {
                    Ok(o) => (true, String::from_utf8_lossy(&o.stdout).to_string()),
                    Err(e) => (false, format!("获取系统信息失败: {}", e)),
                }
            },
        ),
        tool(
            "list_processes",
            "列出正在运行的进程",
            serde_json::Map::new(),
            vec![],
            false,
            |_args| {
                let output = Command::new("powershell")
                    .args(["-NoProfile", "-Command",
                        "Get-Process | Sort-Object CPU -Descending | Select-Object -First 30 Name,Id,CPU,@{N='Mem(MB)';E={[math]::Round($_.WorkingSet/1MB)}} | Format-Table -AutoSize"])
                    .output();
                match output {
                    Ok(o) => (true, String::from_utf8_lossy(&o.stdout).to_string()),
                    Err(e) => (false, format!("获取进程列表失败: {}", e)),
                }
            },
        ),
        tool(
            "kill_process",
            "结束指定进程（按 PID 或名称）",
            {
                let mut props = serde_json::Map::new();
                props.insert("pid".to_string(), prop("进程 ID（与 name 二选一）", "number"));
                props.insert("name".to_string(), prop("进程名称（与 pid 二选一）", "string"));
                props
            },
            vec![],
            true,
            |args| {
                let pid = args.get("pid").and_then(|v| v.as_u64());
                let name = str_arg(args, "name", "");
                let cmd = if let Some(p) = pid {
                    format!("Stop-Process -Id {} -Force", p)
                } else if !name.is_empty() {
                    format!("Stop-Process -Name {} -Force", name)
                } else {
                    return (false, "需要提供 pid 或 name".to_string());
                };
                let output = Command::new("powershell")
                    .args(["-NoProfile", "-Command", &cmd])
                    .output();
                match output {
                    Ok(o) if o.status.success() => (true, "进程已结束".to_string()),
                    Ok(o) => (false, String::from_utf8_lossy(&o.stderr).to_string()),
                    Err(e) => (false, format!("执行失败: {}", e)),
                }
            },
        ),
        tool(
            "run_command",
            "执行系统命令（PowerShell）",
            {
                let mut props = serde_json::Map::new();
                props.insert("command".to_string(), prop("要执行的命令", "string"));
                props
            },
            vec!["command".to_string()],
            true,
            |args| {
                let command = str_arg(args, "command", "");
                let output = Command::new("powershell")
                    .args(["-NoProfile", "-Command", &command])
                    .output();
                match output {
                    Ok(o) => {
                        let stdout = String::from_utf8_lossy(&o.stdout).to_string();
                        let stderr = String::from_utf8_lossy(&o.stderr).to_string();
                        let result = if stderr.is_empty() { stdout } else { format!("{}\nSTDERR: {}", stdout, stderr) };
                        (o.status.success(), result)
                    }
                    Err(e) => (false, format!("执行命令失败: {}", e)),
                }
            },
        ),
        tool(
            "take_screenshot",
            "截取屏幕截图并保存到文件",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("截图保存路径（.png）", "string"));
                props
            },
            vec!["path".to_string()],
            false,
            |args| {
                let path = str_arg(args, "path", "");
                let cmd = format!(
                    "Add-Type -AssemblyName System.Windows.Forms; \
                     $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; \
                     $bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height); \
                     $graphics = [System.Drawing.Graphics]::FromImage($bitmap); \
                     $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size); \
                     $bitmap.Save('{}'); \
                     $graphics.Dispose(); \
                     $bitmap.Dispose()",
                    path.replace('\'', "''")
                );
                let output = Command::new("powershell")
                    .args(["-NoProfile", "-Command", &cmd])
                    .output();
                match output {
                    Ok(o) if o.status.success() => (true, format!("截图已保存: {}", path)),
                    Ok(o) => (false, String::from_utf8_lossy(&o.stderr).to_string()),
                    Err(e) => (false, format!("截图失败: {}", e)),
                }
            },
        ),
        tool(
            "list_startup_items",
            "列出 Windows 开机启动项",
            serde_json::Map::new(),
            vec![],
            false,
            |_args| {
                let output = Command::new("powershell")
                    .args(["-NoProfile", "-Command",
                        "Get-CimInstance Win32_StartupCommand | Select-Object Name, Command, Location | Format-Table -AutoSize"])
                    .output();
                match output {
                    Ok(o) => (true, String::from_utf8_lossy(&o.stdout).to_string()),
                    Err(e) => (false, format!("获取启动项失败: {}", e)),
                }
            },
        ),
        tool(
            "add_startup_item",
            "添加开机启动项（注册表 HKCU）",
            {
                let mut props = serde_json::Map::new();
                props.insert("name".to_string(), prop("启动项名称", "string"));
                props.insert("command".to_string(), prop("启动命令", "string"));
                props
            },
            vec!["name".to_string(), "command".to_string()],
            true,
            |args| {
                let name = str_arg(args, "name", "");
                let command = str_arg(args, "command", "");
                let cmd = format!(
                    "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name '{}' -Value '{}'",
                    name.replace('\'', "''"),
                    command.replace('\'', "''")
                );
                let output = Command::new("powershell")
                    .args(["-NoProfile", "-Command", &cmd])
                    .output();
                match output {
                    Ok(o) if o.status.success() => (true, format!("已添加启动项: {}", name)),
                    Ok(o) => (false, String::from_utf8_lossy(&o.stderr).to_string()),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
        tool(
            "remove_startup_item",
            "移除开机启动项",
            {
                let mut props = serde_json::Map::new();
                props.insert("name".to_string(), prop("启动项名称", "string"));
                props
            },
            vec!["name".to_string()],
            true,
            |args| {
                let name = str_arg(args, "name", "");
                let cmd = format!(
                    "Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name '{}' -ErrorAction SilentlyContinue",
                    name.replace('\'', "''")
                );
                let output = Command::new("powershell")
                    .args(["-NoProfile", "-Command", &cmd])
                    .output();
                match output {
                    Ok(o) if o.status.success() => (true, format!("已移除启动项: {}", name)),
                    Ok(o) => (false, String::from_utf8_lossy(&o.stderr).to_string()),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
        // Registry tools
        tool(
            "registry_list",
            "列出注册表键下的所有值",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("注册表路径（如 HKLM:\\Software\\Microsoft）", "string"));
                props
            },
            vec!["path".to_string()],
            false,
            |args| {
                let path = str_arg(args, "path", "");
                let cmd = format!("Get-ItemProperty -Path '{}' | Format-List", path.replace('\'', "''"));
                let output = Command::new("powershell").args(["-NoProfile", "-Command", &cmd]).output();
                match output {
                    Ok(o) => (true, String::from_utf8_lossy(&o.stdout).to_string()),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
        tool(
            "registry_read",
            "读取注册表值",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("注册表路径", "string"));
                props.insert("name".to_string(), prop("值名称", "string"));
                props
            },
            vec!["path".to_string(), "name".to_string()],
            false,
            |args| {
                let path = str_arg(args, "path", "");
                let name = str_arg(args, "name", "");
                let cmd = format!("(Get-ItemProperty -Path '{}' -Name '{}' -ErrorAction SilentlyContinue).'{}'",
                    path.replace('\'', "''"), name.replace('\'', "''"), name.replace('\'', "''"));
                let output = Command::new("powershell").args(["-NoProfile", "-Command", &cmd]).output();
                match output {
                    Ok(o) => (true, String::from_utf8_lossy(&o.stdout).trim().to_string()),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
        tool(
            "registry_write",
            "写入注册表值",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("注册表路径", "string"));
                props.insert("name".to_string(), prop("值名称", "string"));
                props.insert("value".to_string(), prop("值", "string"));
                props.insert("type".to_string(), prop("值类型（String/DWord/QWord/ExpandString/Binary）", "string"));
                props
            },
            vec!["path".to_string(), "name".to_string(), "value".to_string()],
            true,
            |args| {
                let path = str_arg(args, "path", "");
                let name = str_arg(args, "name", "");
                let value = str_arg(args, "value", "");
                let vtype = str_arg(args, "type", "String");
                let cmd = format!("Set-ItemProperty -Path '{}' -Name '{}' -Value '{}' -Type '{}'",
                    path.replace('\'', "''"), name.replace('\'', "''"), value.replace('\'', "''"), vtype);
                let output = Command::new("powershell").args(["-NoProfile", "-Command", &cmd]).output();
                match output {
                    Ok(o) if o.status.success() => (true, "注册表值已写入".to_string()),
                    Ok(o) => (false, String::from_utf8_lossy(&o.stderr).to_string()),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
        tool(
            "registry_delete_value",
            "删除注册表值",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("注册表路径", "string"));
                props.insert("name".to_string(), prop("值名称", "string"));
                props
            },
            vec!["path".to_string(), "name".to_string()],
            true,
            |args| {
                let path = str_arg(args, "path", "");
                let name = str_arg(args, "name", "");
                let cmd = format!("Remove-ItemProperty -Path '{}' -Name '{}' -ErrorAction SilentlyContinue",
                    path.replace('\'', "''"), name.replace('\'', "''"));
                let output = Command::new("powershell").args(["-NoProfile", "-Command", &cmd]).output();
                match output {
                    Ok(o) if o.status.success() => (true, "注册表值已删除".to_string()),
                    Ok(o) => (false, String::from_utf8_lossy(&o.stderr).to_string()),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
        tool(
            "registry_delete_key",
            "删除注册表键",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("注册表路径", "string"));
                props
            },
            vec!["path".to_string()],
            true,
            |args| {
                let path = str_arg(args, "path", "");
                let cmd = format!("Remove-Item -Path '{}' -Recurse -ErrorAction SilentlyContinue", path.replace('\'', "''"));
                let output = Command::new("powershell").args(["-NoProfile", "-Command", &cmd]).output();
                match output {
                    Ok(o) if o.status.success() => (true, "注册表键已删除".to_string()),
                    Ok(o) => (false, String::from_utf8_lossy(&o.stderr).to_string()),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
    ]
}
