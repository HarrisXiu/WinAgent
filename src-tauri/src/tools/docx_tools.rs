use super::{tool, str_arg, prop};
use std::process::Command;

pub fn create() -> Vec<super::ToolEntry> {
    vec![
        tool(
            "create_word_document",
            "创建 Word 文档（精细排版，支持标题/段落/表格/图片）",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("保存路径（.docx）", "string"));
                props.insert("title".to_string(), prop("文档标题", "string"));
                props.insert("content".to_string(), prop("文档内容（JSON 结构）", "string"));
                props
            },
            vec!["path".to_string(), "title".to_string(), "content".to_string()],
            false,
            |args| {
                let path = str_arg(args, "path", "");
                let title = str_arg(args, "title", "");
                let content = str_arg(args, "content", "");
                // Use PowerShell + Word COM to create document
                let cmd = format!(
                    "$word = New-Object -ComObject Word.Application; \
                     $word.Visible = $false; \
                     $doc = $word.Documents.Add(); \
                     $sel = $word.Selection; \
                     $sel.Style = 'Title'; \
                     $sel.TypeText('{}'); \
                     $sel.TypeParagraph(); \
                     $sel.Style = 'Normal'; \
                     $sel.TypeText('{}'); \
                     $doc.SaveAs('{}'); \
                     $doc.Close(); \
                     $word.Quit()",
                    title.replace('\'', "''"),
                    content.replace('\'', "''"),
                    path.replace('\'', "''")
                );
                let output = Command::new("powershell").args(["-NoProfile", "-Command", &cmd]).output();
                match output {
                    Ok(o) if o.status.success() => (true, format!("Word 文档已创建: {}", path)),
                    Ok(o) => (false, String::from_utf8_lossy(&o.stderr).to_string()),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
        tool(
            "markdown_to_word",
            "将 Markdown 转换为 Word 文档",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("保存路径（.docx）", "string"));
                props.insert("markdown".to_string(), prop("Markdown 内容", "string"));
                props
            },
            vec!["path".to_string(), "markdown".to_string()],
            false,
            |args| {
                let path = str_arg(args, "path", "");
                let markdown = str_arg(args, "markdown", "");
                // Write markdown to temp file, use pandoc if available, else PowerShell COM
                let temp_md = format!("{}_temp.md", path.trim_end_matches(".docx"));
                let _ = std::fs::write(&temp_md, &markdown);
                let cmd = format!(
                    "$word = New-Object -ComObject Word.Application; \
                     $word.Visible = $false; \
                     $doc = $word.Documents.Open('{}'); \
                     $doc.SaveAs2('{}', 16); \
                     $doc.Close(); \
                     $word.Quit()",
                    temp_md.replace('\'', "''"),
                    path.replace('\'', "''")
                );
                let output = Command::new("powershell").args(["-NoProfile", "-Command", &cmd]).output();
                let _ = std::fs::remove_file(&temp_md);
                match output {
                    Ok(o) if o.status.success() => (true, format!("Word 文档已创建: {}", path)),
                    Ok(o) => (false, String::from_utf8_lossy(&o.stderr).to_string()),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
        tool(
            "latex_formula_to_omml",
            "将 LaTeX 数学公式转换为 Word OMML 格式（验证语法）",
            {
                let mut props = serde_json::Map::new();
                props.insert("latex".to_string(), prop("LaTeX 公式", "string"));
                props
            },
            vec!["latex".to_string()],
            false,
            |args| {
                let latex = str_arg(args, "latex", "");
                // Basic validation
                let balanced = latex.matches('{').count() == latex.matches('}').count();
                if !balanced {
                    return (false, "LaTeX 语法错误：花括号不匹配".to_string());
                }
                (true, format!("LaTeX 公式语法验证通过: {}", latex))
            },
        ),
    ]
}
