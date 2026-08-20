use super::{tool, str_arg, num_arg, prop};
use std::process::Command;

pub fn create() -> Vec<super::ToolEntry> {
    vec![
        tool(
            "type_text",
            "模拟键盘输入文本",
            {
                let mut props = serde_json::Map::new();
                props.insert("text".to_string(), prop("要输入的文本", "string"));
                props
            },
            vec!["text".to_string()],
            true,
            |args| {
                let text = str_arg(args, "text", "");
                let cmd = format!(
                    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{}')",
                    text.replace('{', "{{").replace('}', "}}").replace('+', "{+}").replace('^', "{^}").replace('%', "{%}").replace('~', "{~}").replace('(', "{(}").replace(')', "{)}").replace('[', "{[}").replace(']', "{]}")
                );
                let output = Command::new("powershell").args(["-NoProfile", "-Command", &cmd]).output();
                match output {
                    Ok(o) if o.status.success() => (true, format!("已输入: {}", text)),
                    Ok(o) => (false, String::from_utf8_lossy(&o.stderr).to_string()),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
        tool(
            "key_press",
            "模拟按键",
            {
                let mut props = serde_json::Map::new();
                props.insert("key".to_string(), prop("按键名称（如 Enter, Tab, Escape）", "string"));
                props
            },
            vec!["key".to_string()],
            true,
            |args| {
                let key = str_arg(args, "key", "");
                let key_map = match key.to_lowercase().as_str() {
                    "enter" | "return" => "{ENTER}",
                    "tab" => "{TAB}",
                    "escape" | "esc" => "{ESC}",
                    "backspace" => "{BACKSPACE}",
                    "delete" => "{DELETE}",
                    "space" => " ",
                    "up" => "{UP}",
                    "down" => "{DOWN}",
                    "left" => "{LEFT}",
                    "right" => "{RIGHT}",
                    "home" => "{HOME}",
                    "end" => "{END}",
                    "pageup" => "{PGUP}",
                    "pagedown" => "{PGDN}",
                    _ => &key,
                };
                let cmd = format!(
                    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{}')",
                    key_map
                );
                let output = Command::new("powershell").args(["-NoProfile", "-Command", &cmd]).output();
                match output {
                    Ok(o) if o.status.success() => (true, format!("已按键: {}", key)),
                    Ok(o) => (false, String::from_utf8_lossy(&o.stderr).to_string()),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
        tool(
            "key_combination",
            "模拟组合键（如 Ctrl+C）",
            {
                let mut props = serde_json::Map::new();
                props.insert("keys".to_string(), prop("组合键（如 Ctrl+C, Alt+Tab, Win+D）", "string"));
                props
            },
            vec!["keys".to_string()],
            true,
            |args| {
                let keys = str_arg(args, "keys", "");
                let sendkeys = keys
                    .replace("Ctrl+", "^")
                    .replace("Alt+", "%")
                    .replace("Shift+", "+")
                    .replace("Win+", "^{ESC}");
                let cmd = format!(
                    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{}')",
                    sendkeys
                );
                let output = Command::new("powershell").args(["-NoProfile", "-Command", &cmd]).output();
                match output {
                    Ok(o) if o.status.success() => (true, format!("已按组合键: {}", keys)),
                    Ok(o) => (false, String::from_utf8_lossy(&o.stderr).to_string()),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
        tool(
            "mouse_click",
            "模拟鼠标点击",
            {
                let mut props = serde_json::Map::new();
                props.insert("x".to_string(), prop("X 坐标", "number"));
                props.insert("y".to_string(), prop("Y 坐标", "number"));
                props.insert("button".to_string(), prop("鼠标按钮（left/right/middle，默认 left）", "string"));
                props
            },
            vec!["x".to_string(), "y".to_string()],
            true,
            |args| {
                let x = num_arg(args, "x", 0.0) as i32;
                let y = num_arg(args, "y", 0.0) as i32;
                let button = str_arg(args, "button", "left");
                let cmd = format!(
                    "Add-Type -AssemblyName System.Windows.Forms; \
                     [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point({}, {}); \
                     Start-Sleep -Milliseconds 50; \
                     $sig = '[DllImport(\"user32.dll\")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);'; \
                     $mouse = Add-Type -MemberDefinition $sig -Name 'Mouse' -Namespace 'Win32' -PassThru; \
                     $down = if ('{}' -eq 'right') {{ 8 }} elseif ('{}' -eq 'middle') {{ 32 }} else {{ 2 }}; \
                     $up = if ('{}' -eq 'right') {{ 16 }} elseif ('{}' -eq 'middle') {{ 64 }} else {{ 4 }}; \
                     $mouse::mouse_event($down, 0, 0, 0, 0); \
                     $mouse::mouse_event($up, 0, 0, 0, 0)",
                    x, y, button, button, button, button
                );
                let output = Command::new("powershell").args(["-NoProfile", "-Command", &cmd]).output();
                match output {
                    Ok(o) if o.status.success() => (true, format!("已点击 ({}, {}) {}", x, y, button)),
                    Ok(o) => (false, String::from_utf8_lossy(&o.stderr).to_string()),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
        tool(
            "mouse_move",
            "移动鼠标到指定位置",
            {
                let mut props = serde_json::Map::new();
                props.insert("x".to_string(), prop("X 坐标", "number"));
                props.insert("y".to_string(), prop("Y 坐标", "number"));
                props
            },
            vec!["x".to_string(), "y".to_string()],
            true,
            |args| {
                let x = num_arg(args, "x", 0.0) as i32;
                let y = num_arg(args, "y", 0.0) as i32;
                let cmd = format!(
                    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point({}, {})",
                    x, y
                );
                let output = Command::new("powershell").args(["-NoProfile", "-Command", &cmd]).output();
                match output {
                    Ok(o) if o.status.success() => (true, format!("鼠标已移动到 ({}, {})", x, y)),
                    Ok(o) => (false, String::from_utf8_lossy(&o.stderr).to_string()),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
        tool(
            "mouse_scroll",
            "模拟鼠标滚轮滚动",
            {
                let mut props = serde_json::Map::new();
                props.insert("delta".to_string(), prop("滚动量（正数向上，负数向下）", "number"));
                props
            },
            vec!["delta".to_string()],
            true,
            |args| {
                let delta = num_arg(args, "delta", 0.0) as i32;
                let cmd = format!(
                    "Add-Type -AssemblyName System.Windows.Forms; \
                     $sig = '[DllImport(\"user32.dll\")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);'; \
                     $mouse = Add-Type -MemberDefinition $sig -Name 'Mouse' -Namespace 'Win32' -PassThru; \
                     $mouse::mouse_event(0x0800, 0, 0, {}, 0)",
                    delta * 120
                );
                let output = Command::new("powershell").args(["-NoProfile", "-Command", &cmd]).output();
                match output {
                    Ok(o) if o.status.success() => (true, format!("已滚动: {}", delta)),
                    Ok(o) => (false, String::from_utf8_lossy(&o.stderr).to_string()),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
        tool(
            "get_cursor_pos",
            "获取鼠标当前位置",
            serde_json::Map::new(),
            vec![],
            false,
            |_args| {
                let cmd = "Add-Type -AssemblyName System.Windows.Forms; Write-Output \"X: $([System.Windows.Forms.Cursor]::Position.X) Y: $([System.Windows.Forms.Cursor]::Position.Y)\"";
                let output = Command::new("powershell").args(["-NoProfile", "-Command", cmd]).output();
                match output {
                    Ok(o) => (true, String::from_utf8_lossy(&o.stdout).to_string()),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
        tool(
            "get_screen_size",
            "获取屏幕分辨率",
            serde_json::Map::new(),
            vec![],
            false,
            |_args| {
                let cmd = "Add-Type -AssemblyName System.Windows.Forms; $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; Write-Output \"Width: $($screen.Width) Height: $($screen.Height)\"";
                let output = Command::new("powershell").args(["-NoProfile", "-Command", cmd]).output();
                match output {
                    Ok(o) => (true, String::from_utf8_lossy(&o.stdout).to_string()),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
    ]
}
