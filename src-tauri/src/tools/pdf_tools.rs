use super::{tool, str_arg, prop};
use std::process::Command;

pub fn create() -> Vec<super::ToolEntry> {
    vec![
        tool(
            "pdf_to_markdown",
            "将 PDF 文件转换为 Markdown 格式，使用 PyMuPDF 提取文本、标题层级、列表、表格等结构",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("PDF 文件路径（.pdf）", "string"));
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

                let ext = std::path::Path::new(&path)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("");
                if !ext.eq_ignore_ascii_case("pdf") {
                    return (false, format!("文件不是 PDF: {}", path));
                }

                let py_script = r#######"
import sys, json, re
try:
    import pymupdf
except ImportError:
    try:
        import fitz as pymupdf
    except ImportError:
        print("ERROR: PyMuPDF not installed. Run: pip install pymupdf")
        sys.exit(1)

path = sys.argv[1]
doc = pymupdf.open(path)
lines = []
for page_num in range(len(doc)):
    page = doc[page_num]
    blocks = page.get_text("dict", flags=pymupdf.TEXTFLAGS_DICT)["blocks"]
    for block in blocks:
        if block["type"] != 0:
            continue
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            if not spans:
                continue
            text = "".join(s["text"] for s in spans).strip()
            if not text:
                continue
            font_size = max(s["size"] for s in spans)
            font_flags = spans[0].get("flags", 0)
            is_bold = bool(font_flags & 16)
            is_title = font_size >= 16 and (is_bold or len(text) < 80)
            if is_title and not text.endswith(('.', ',', ';', ':', '?', '!')):
                level = 1 if font_size >= 20 else 2 if font_size >= 16 else 3
                lines.append("#" * level + " " + text)
            elif text.startswith(('\u2022 ', '\u25cf ', '\u25cb ', '\u25aa ', '\u25ab ')):
                lines.append("- " + text[1:].strip())
            elif re.match(r'^\d+[.)]\s', text):
                lines.append("1. " + re.sub(r'^\d+[.)]\s*', '', text))
            else:
                lines.append(text)
        lines.append("")
    if page_num < len(doc) - 1:
        lines.append("---")
        lines.append("")
doc.close()
print("===PDF2MD_START===")
print("\n".join(lines))
print("===PDF2MD_END===")
"#######;

                let result = Command::new("python")
                    .args(["-c", py_script, &path])
                    .output();

                let py_exe = match result {
                    Ok(o) if o.status.success() => o,
                    Ok(o) => {
                        let py_path = r"C:\Users\53031\AppData\Local\Programs\Python\Python312\python.exe";
                        match Command::new(py_path).args(["-c", py_script, &path]).output() {
                            Ok(o2) if o2.status.success() => o2,
                            Ok(o2) => return (false, format!("Python 执行失败: {}", String::from_utf8_lossy(&o2.stderr))),
                            Err(e) => return (false, format!("Python 未找到: {}", e)),
                        }
                    }
                    Err(_) => {
                        let py_path = r"C:\Users\53031\AppData\Local\Programs\Python\Python312\python.exe";
                        match Command::new(py_path).args(["-c", py_script, &path]).output() {
                            Ok(o2) if o2.status.success() => o2,
                            Ok(o2) => return (false, format!("Python 执行失败: {}", String::from_utf8_lossy(&o2.stderr))),
                            Err(e) => return (false, format!("Python 未找到: {}", e)),
                        }
                    }
                };

                let full = String::from_utf8_lossy(&py_exe.stdout).to_string();

                if full.contains("ERROR:") {
                    return (false, full.lines().find(|l| l.starts_with("ERROR:")).unwrap_or("PDF 解析失败").to_string());
                }

                let md_content = if let Some(start) = full.find("===PDF2MD_START===") {
                    if let Some(end) = full.find("===PDF2MD_END===") {
                        full[start + "===PDF2MD_START===".len()..end].trim().to_string()
                    } else {
                        full[start + "===PDF2MD_START===".len()..].trim().to_string()
                    }
                } else {
                    full.trim().to_string()
                };

                if md_content.is_empty() {
                    return (false, "PDF 内容为空或无法提取（可能是扫描件/图片型 PDF）".to_string());
                }

                if !output.is_empty() {
                    match std::fs::write(&output, &md_content) {
                        Ok(_) => (true, format!("Markdown 已保存: {}\n\n{}", output, md_content)),
                        Err(e) => (false, format!("写入文件失败: {}", e)),
                    }
                } else {
                    (true, md_content)
                }
            },
        ),
    ]
}
