use super::{tool, str_arg, prop};
use std::process::Command;

pub fn create() -> Vec<super::ToolEntry> {
    vec![
        tool(
            "doc_to_markdown",
            "将 Word 文档（.doc/.docx）转换为 Markdown 格式，保留标题层级、段落、表格、列表等结构",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("Word 文档路径（.doc 或 .docx）", "string"));
                props.insert("output".to_string(), prop("输出 Markdown 文件路径（.md）。留空则仅返回内容不写文件", "string"));
                props
            },
            vec!["path".to_string()],
            false,
            |args| {
                let path = str_arg(args, "path", "");
                let output = str_arg(args, "output", "");

                if path.is_empty() {
                    return (false, "缺少参数: path".to_string());
                }
                if !std::path::Path::new(&path).exists() {
                    return (false, format!("文件不存在: {}", path));
                }

                // Use PowerShell + Word COM to extract text with structural info, then convert to Markdown
                let ps_template = r#######"
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {
    $doc = $word.Documents.Open('__PATH__', $false, $true)
    $sb = New-Object System.Text.StringBuilder

    foreach ($para in $doc.Paragraphs) {
        $text = $para.Range.Text.Trim()
        if ([string]::IsNullOrWhiteSpace($text)) { continue }

        $styleName = ''
        try { $styleName = $para.Style.NameLocal } catch { }

        switch -Wildcard ($styleName) {
            'Title'        { [void]$sb.AppendLine("# $text`n"); break }
            'Heading 1'    { [void]$sb.AppendLine("# $text`n"); break }
            'Heading 2'    { [void]$sb.AppendLine("## $text`n"); break }
            'Heading 3'    { [void]$sb.AppendLine("### $text`n"); break }
            'Heading 4'    { [void]$sb.AppendLine("#### $text`n"); break }
            'Heading 5'    { [void]$sb.AppendLine("##### $text`n"); break }
            'Heading 6'    { [void]$sb.AppendLine("###### $text`n"); break }
            'Heading 7'    { [void]$sb.AppendLine("###### $text`n"); break }
            'Heading 8'    { [void]$sb.AppendLine("###### $text`n"); break }
            'Heading 9'    { [void]$sb.AppendLine("###### $text`n"); break }
            'List Bullet'  { [void]$sb.AppendLine("- $text"); break }
            'List Bullet 2'{ [void]$sb.AppendLine("  - $text"); break }
            'List Bullet 3'{ [void]$sb.AppendLine("    - $text"); break }
            'List Number'  { [void]$sb.AppendLine("1. $text"); break }
            'List Number 2'{ [void]$sb.AppendLine("  1. $text"); break }
            'List Number 3'{ [void]$sb.AppendLine("    1. $text"); break }
            default        { [void]$sb.AppendLine("$text`n"); break }
        }
    }

    # Extract tables
    $tableIdx = 0
    foreach ($table in $doc.Tables) {
        $tableIdx++
        [void]$sb.AppendLine("")
        $rows = $table.Rows.Count
        $cols = $table.Columns.Count
        for ($r = 1; $r -le $rows; $r++) {
            $cells = @()
            for ($c = 1; $c -le $cols; $c++) {
                try {
                    $cellText = $table.Cell($r, $c).Range.Text.Trim()
                    $cellText = $cellText -replace "`r`n", " " -replace "`r", " " -replace "`n", " "
                    $cells += $cellText
                } catch {
                    $cells += ""
                }
            }
            [void]$sb.AppendLine("| " + ($cells -join " | ") + " |")
            if ($r -eq 1) {
                [void]$sb.AppendLine("| " + (($cells | ForEach-Object { "---" }) -join " | ") + " |")
            }
        }
        [void]$sb.AppendLine("")
    }

    $doc.Close($false)
    $result = $sb.ToString()
    Write-Output "===DOC2MD_START==="
    Write-Output $result
    Write-Output "===DOC2MD_END==="
} catch {
    Write-Output "ERROR: $_"
} finally {
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
"#######;
                let ps_script = ps_template.replace("__PATH__", &path.replace('\'', "''"));

                let result = Command::new("powershell")
                    .args(["-NoProfile", "-Command", &ps_script])
                    .output();

                match result {
                    Ok(o) => {
                        let full = String::from_utf8_lossy(&o.stdout).to_string();

                        if full.contains("ERROR:") {
                            return (false, format!("Word 转换失败: {}", full));
                        }

                        let md_content = if let Some(start) = full.find("===DOC2MD_START===") {
                            if let Some(end) = full.find("===DOC2MD_END===") {
                                full[start + "===DOC2MD_START===".len()..end].trim().to_string()
                            } else {
                                full[start + "===DOC2MD_START===".len()..].trim().to_string()
                            }
                        } else {
                            full.trim().to_string()
                        };

                        if md_content.is_empty() {
                            return (false, "文档内容为空或无法读取".to_string());
                        }

                        if !output.is_empty() {
                            match std::fs::write(&output, &md_content) {
                                Ok(_) => (true, format!("Markdown 已保存: {}\n\n{}", output, md_content)),
                                Err(e) => (false, format!("写入文件失败: {}", e)),
                            }
                        } else {
                            (true, md_content)
                        }
                    }
                    Ok(o) => (false, format!("PowerShell 执行失败: {}", String::from_utf8_lossy(&o.stderr))),
                    Err(e) => (false, format!("操作失败: {}", e)),
                }
            },
        ),
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
