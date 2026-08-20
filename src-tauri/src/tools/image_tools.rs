use super::{tool, str_arg, prop};

pub fn create() -> Vec<super::ToolEntry> {
    vec![
        tool(
            "generate_image_prompt",
            "生成可复用的图片绘图提示词（供 Midjourney / Stable Diffusion 等工具使用）",
            {
                let mut props = serde_json::Map::new();
                props.insert("description".to_string(), prop("用户想要的图片描述", "string"));
                props.insert("style".to_string(), prop("风格偏好（如 photorealistic / anime / oil painting）", "string"));
                props
            },
            vec!["description".to_string()],
            false,
            |args| {
                let desc = str_arg(args, "description", "");
                let style = str_arg(args, "style", "photorealistic");
                let prompt = format!(
                    "【绘图提示词】\n\n\
                     主体: {}\n\
                     风格: {}\n\
                     光照: 自然光，柔和阴影\n\
                     构图: 居中，三分法\n\
                     色调: 鲜明，高对比度\n\
                     细节: 高清，4K，细节丰富\n\n\
                     English Prompt:\n\
                     {}, {}, natural lighting, soft shadows, centered composition, vibrant colors, high detail, 4K, masterpiece\n\n\
                     可用 Midjourney / Stable Diffusion / 即梦AI 等工具生成。",
                    desc, style, desc, style
                );
                (true, prompt)
            },
        ),
        tool(
            "take_screenshot",
            "截取屏幕截图并返回 base64 编码",
            serde_json::Map::new(),
            vec![],
            false,
            |_args| {
                use std::process::Command;
                let cmd = "Add-Type -AssemblyName System.Windows.Forms; \
                    Add-Type -AssemblyName System.Drawing; \
                    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; \
                    $bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height); \
                    $graphics = [System.Drawing.Graphics]::FromImage($bitmap); \
                    $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size); \
                    $ms = New-Object System.IO.MemoryStream; \
                    $bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); \
                    $bytes = $ms.ToArray(); \
                    $base64 = [Convert]::ToBase64String($bytes); \
                    Write-Output $base64; \
                    $graphics.Dispose(); \
                    $bitmap.Dispose()";
                let output = Command::new("powershell").args(["-NoProfile", "-Command", cmd]).output();
                match output {
                    Ok(o) if o.status.success() => {
                        let b64 = String::from_utf8_lossy(&o.stdout).trim().to_string();
                        (true, format!("data:image/png;base64,{}", b64))
                    }
                    Ok(o) => (false, String::from_utf8_lossy(&o.stderr).to_string()),
                    Err(e) => (false, format!("截图失败: {}", e)),
                }
            },
        ),
    ]
}
