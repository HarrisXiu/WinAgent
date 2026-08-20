use super::{tool, str_arg, prop};
use std::path::Path;

pub fn create() -> Vec<super::ToolEntry> {
    vec![
        tool(
            "list_directory",
            "列出指定目录中的文件和文件夹",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("目录绝对路径", "string"));
                props
            },
            vec!["path".to_string()],
            false,
            |args| {
                let path = str_arg(args, "path", "");
                match std::fs::read_dir(&path) {
                    Ok(entries) => {
                        let mut result = vec![];
                        for entry in entries.flatten() {
                            let name = entry.file_name().to_string_lossy().to_string();
                            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                            result.push(format!("{}{}  {} bytes", name, if is_dir { "/" } else { "" }, size));
                        }
                        (true, result.join("\n"))
                    }
                    Err(e) => (false, format!("读取目录失败: {}", e)),
                }
            },
        ),
        tool(
            "read_file",
            "读取文本文件内容（支持 txt/md/json/js/ts/py 等文本格式）",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("文件绝对路径", "string"));
                props.insert("encoding".to_string(), prop("编码，默认 utf-8", "string"));
                props
            },
            vec!["path".to_string()],
            false,
            |args| {
                let path = str_arg(args, "path", "");
                match std::fs::read_to_string(&path) {
                    Ok(content) => {
                        let truncated: String = content.chars().take(50000).collect();
                        (true, truncated)
                    }
                    Err(e) => (false, format!("读取文件失败: {}", e)),
                }
            },
        ),
        tool(
            "write_file",
            "写入文本文件（覆盖已存在的文件）",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("文件绝对路径", "string"));
                props.insert("content".to_string(), prop("文件内容", "string"));
                props
            },
            vec!["path".to_string(), "content".to_string()],
            false,
            |args| {
                let path = str_arg(args, "path", "");
                let content = str_arg(args, "content", "");
                if let Some(parent) = Path::new(&path).parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                match std::fs::write(&path, &content) {
                    Ok(_) => (true, format!("文件已写入: {}", path)),
                    Err(e) => (false, format!("写入文件失败: {}", e)),
                }
            },
        ),
        tool(
            "edit_file",
            "精确字符串替换编辑文件（找到 old_string 替换为 new_string）",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("文件绝对路径", "string"));
                props.insert("old_string".to_string(), prop("要替换的原始字符串", "string"));
                props.insert("new_string".to_string(), prop("替换后的新字符串", "string"));
                props
            },
            vec!["path".to_string(), "old_string".to_string(), "new_string".to_string()],
            false,
            |args| {
                let path = str_arg(args, "path", "");
                let old_str = str_arg(args, "old_string", "");
                let new_str = str_arg(args, "new_string", "");
                match std::fs::read_to_string(&path) {
                    Ok(content) => {
                        let count = content.matches(&old_str).count();
                        if count == 0 {
                            return (false, "未找到要替换的字符串".to_string());
                        }
                        if count > 1 {
                            return (false, format!("找到 {} 处匹配，请提供更长的上下文以唯一匹配", count));
                        }
                        let new_content = content.replacen(&old_str, &new_str, 1);
                        match std::fs::write(&path, &new_content) {
                            Ok(_) => (true, "替换成功".to_string()),
                            Err(e) => (false, format!("写入失败: {}", e)),
                        }
                    }
                    Err(e) => (false, format!("读取文件失败: {}", e)),
                }
            },
        ),
        tool(
            "multi_edit_file",
            "对同一文件执行多处字符串替换",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("文件绝对路径", "string"));
                props.insert("edits".to_string(), prop("替换数组 [{old_string, new_string}]", "array"));
                props
            },
            vec!["path".to_string(), "edits".to_string()],
            false,
            |args| {
                let path = str_arg(args, "path", "");
                match std::fs::read_to_string(&path) {
                    Ok(mut content) => {
                        let edits = args.get("edits").and_then(|v| v.as_array());
                        if edits.is_none() {
                            return (false, "edits 参数必须是数组".to_string());
                        }
                        let mut count = 0;
                        for edit in edits.unwrap() {
                            let old_str = edit.get("old_string").and_then(|v| v.as_str()).unwrap_or("");
                            let new_str = edit.get("new_string").and_then(|v| v.as_str()).unwrap_or("");
                            if old_str.is_empty() { continue; }
                            content = content.replacen(old_str, new_str, 1);
                            count += 1;
                        }
                        match std::fs::write(&path, &content) {
                            Ok(_) => (true, format!("完成 {} 处替换", count)),
                            Err(e) => (false, format!("写入失败: {}", e)),
                        }
                    }
                    Err(e) => (false, format!("读取文件失败: {}", e)),
                }
            },
        ),
        tool(
            "delete_file",
            "删除文件或空目录",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("文件或目录绝对路径", "string"));
                props
            },
            vec!["path".to_string()],
            true,
            |args| {
                let path = str_arg(args, "path", "");
                let p = Path::new(&path);
                if p.is_dir() {
                    match std::fs::remove_dir(p) {
                        Ok(_) => (true, format!("目录已删除: {}", path)),
                        Err(e) => (false, format!("删除目录失败: {}", e)),
                    }
                } else {
                    match std::fs::remove_file(p) {
                        Ok(_) => (true, format!("文件已删除: {}", path)),
                        Err(e) => (false, format!("删除文件失败: {}", e)),
                    }
                }
            },
        ),
        tool(
            "copy_file",
            "复制文件",
            {
                let mut props = serde_json::Map::new();
                props.insert("source".to_string(), prop("源文件路径", "string"));
                props.insert("destination".to_string(), prop("目标路径", "string"));
                props
            },
            vec!["source".to_string(), "destination".to_string()],
            false,
            |args| {
                let src = str_arg(args, "source", "");
                let dst = str_arg(args, "destination", "");
                if let Some(parent) = Path::new(&dst).parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                match std::fs::copy(&src, &dst) {
                    Ok(_) => (true, format!("已复制: {} → {}", src, dst)),
                    Err(e) => (false, format!("复制失败: {}", e)),
                }
            },
        ),
        tool(
            "move_file",
            "移动或重命名文件",
            {
                let mut props = serde_json::Map::new();
                props.insert("source".to_string(), prop("源文件路径", "string"));
                props.insert("destination".to_string(), prop("目标路径", "string"));
                props
            },
            vec!["source".to_string(), "destination".to_string()],
            false,
            |args| {
                let src = str_arg(args, "source", "");
                let dst = str_arg(args, "destination", "");
                if let Some(parent) = Path::new(&dst).parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                match std::fs::rename(&src, &dst) {
                    Ok(_) => (true, format!("已移动: {} → {}", src, dst)),
                    Err(e) => (false, format!("移动失败: {}", e)),
                }
            },
        ),
        tool(
            "search_files",
            "在目录中搜索文件名（支持通配符）",
            {
                let mut props = serde_json::Map::new();
                props.insert("directory".to_string(), prop("搜索目录", "string"));
                props.insert("pattern".to_string(), prop("文件名通配符（如 *.txt）", "string"));
                props
            },
            vec!["directory".to_string(), "pattern".to_string()],
            false,
            |args| {
                let dir = str_arg(args, "directory", "");
                let pattern = str_arg(args, "pattern", "");
                let glob_pattern = format!("{}/{}", dir.trim_end_matches('/'), pattern);
                match glob::glob(&glob_pattern) {
                    Ok(paths) => {
                        let results: Vec<String> = paths
                            .filter_map(|p| p.ok())
                            .map(|p| p.to_string_lossy().to_string())
                            .collect();
                        if results.is_empty() {
                            (true, "未找到匹配文件".to_string())
                        } else {
                            (true, results.join("\n"))
                        }
                    }
                    Err(e) => (false, format!("搜索失败: {}", e)),
                }
            },
        ),
        tool(
            "find_files",
            "在目录树中查找文件（递归）",
            {
                let mut props = serde_json::Map::new();
                props.insert("directory".to_string(), prop("搜索根目录", "string"));
                props.insert("filename".to_string(), prop("文件名（部分匹配）", "string"));
                props
            },
            vec!["directory".to_string(), "filename".to_string()],
            false,
            |args| {
                let dir = str_arg(args, "directory", "");
                let filename = str_arg(args, "filename", "").to_lowercase();
                let mut results = vec![];
                for entry in walkdir::WalkDir::new(&dir).max_depth(10).into_iter().filter_map(|e| e.ok()) {
                    if entry.file_type().is_file() {
                        let name = entry.file_name().to_string_lossy().to_lowercase();
                        if name.contains(&filename) {
                            results.push(entry.path().to_string_lossy().to_string());
                            if results.len() >= 100 { break; }
                        }
                    }
                }
                if results.is_empty() {
                    (true, "未找到匹配文件".to_string())
                } else {
                    (true, results.join("\n"))
                }
            },
        ),
        tool(
            "get_file_info",
            "获取文件或目录信息（大小、修改时间等）",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("文件或目录路径", "string"));
                props
            },
            vec!["path".to_string()],
            false,
            |args| {
                let path = str_arg(args, "path", "");
                match std::fs::metadata(&path) {
                    Ok(meta) => {
                        let is_dir = meta.is_dir();
                        let size = meta.len();
                        let modified = meta.modified().ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        (true, format!("类型: {}\n大小: {} bytes\n修改时间戳: {}", if is_dir { "目录" } else { "文件" }, size, modified))
                    }
                    Err(e) => (false, format!("获取信息失败: {}", e)),
                }
            },
        ),
        tool(
            "create_directory",
            "创建目录（含父目录）",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("目录绝对路径", "string"));
                props
            },
            vec!["path".to_string()],
            false,
            |args| {
                let path = str_arg(args, "path", "");
                match std::fs::create_dir_all(&path) {
                    Ok(_) => (true, format!("目录已创建: {}", path)),
                    Err(e) => (false, format!("创建目录失败: {}", e)),
                }
            },
        ),
        tool(
            "grep",
            "在文件中搜索文本（递归目录）",
            {
                let mut props = serde_json::Map::new();
                props.insert("directory".to_string(), prop("搜索目录", "string"));
                props.insert("pattern".to_string(), prop("搜索文本（正则表达式）", "string"));
                props.insert("include".to_string(), prop("文件扩展名过滤（如 *.ts）", "string"));
                props
            },
            vec!["directory".to_string(), "pattern".to_string()],
            false,
            |args| {
                let dir = str_arg(args, "directory", "");
                let pattern = str_arg(args, "pattern", "");
                let include = str_arg(args, "include", "");
                let re = match regex::Regex::new(&pattern) {
                    Ok(r) => r,
                    Err(e) => return (false, format!("正则编译失败: {}", e)),
                };
                let mut results = vec![];
                for entry in walkdir::WalkDir::new(&dir).max_depth(10).into_iter().filter_map(|e| e.ok()) {
                    if !entry.file_type().is_file() { continue; }
                    let path = entry.path();
                    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                    if !include.is_empty() {
                        let inc_pattern = include.replace("*", "");
                        if !name.ends_with(&inc_pattern) { continue; }
                    }
                    if let Ok(content) = std::fs::read_to_string(path) {
                        for (i, line) in content.lines().enumerate() {
                            if re.is_match(line) {
                                results.push(format!("{}:{}: {}", path.display(), i + 1, line.trim()));
                                if results.len() >= 200 { break; }
                            }
                        }
                    }
                    if results.len() >= 200 { break; }
                }
                if results.is_empty() {
                    (true, "未找到匹配".to_string())
                } else {
                    (true, results.join("\n"))
                }
            },
        ),
    ]
}
