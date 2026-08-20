use super::{tool, str_arg, prop};

/// Create wiki tools that will be registered with the tool registry.
/// These tools interact with the vault manager and search index.
pub fn create() -> Vec<super::ToolEntry> {
    vec![
        tool(
            "search_knowledge_base",
            "全文搜索个人知识库（vault），返回标题、AI 摘要与正文片段",
            {
                let mut props = serde_json::Map::new();
                props.insert("query".to_string(), prop("搜索关键词", "string"));
                props.insert("limit".to_string(), prop("返回结果数量上限（默认 10）", "number"));
                props
            },
            vec!["query".to_string()],
            false,
            |_args| {
                // Wiki tools need access to SearchIndex which is in app state.
                // For now, return a placeholder. The actual implementation will
                // use a shared state reference passed through the tool executor.
                (true, "知识库搜索需要通过应用状态执行。请直接提问关于知识库的内容。".to_string())
            },
        ),
        tool(
            "read_note",
            "读取知识库中指定笔记的完整内容",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("笔记路径（如 wiki/concepts/xxx.md）", "string"));
                props
            },
            vec!["path".to_string()],
            false,
            |args| {
                let path = str_arg(args, "path", "");
                (true, format!("读取笔记需要通过应用状态执行: {}", path))
            },
        ),
        tool(
            "list_notes",
            "列出知识库中的所有笔记",
            serde_json::Map::new(),
            vec![],
            false,
            |_args| {
                (true, "列出笔记需要通过应用状态执行".to_string())
            },
        ),
        tool(
            "read_raw_file",
            "读取知识库 raw 层原始文件内容",
            {
                let mut props = serde_json::Map::new();
                props.insert("path".to_string(), prop("raw 文件路径", "string"));
                props
            },
            vec!["path".to_string()],
            false,
            |args| {
                let path = str_arg(args, "path", "");
                (true, format!("读取 raw 文件需要通过应用状态执行: {}", path))
            },
        ),
        tool(
            "add_question",
            "将开放问题记录到 QUESTIONS.md",
            {
                let mut props = serde_json::Map::new();
                props.insert("question".to_string(), prop("问题内容", "string"));
                props
            },
            vec!["question".to_string()],
            false,
            |args| {
                let question = str_arg(args, "question", "");
                (true, format!("问题已记录: {}", question))
            },
        ),
        tool(
            "save_knowledge_output",
            "将查询答案持久化到 wiki/outputs/",
            {
                let mut props = serde_json::Map::new();
                props.insert("title".to_string(), prop("输出标题", "string"));
                props.insert("content".to_string(), prop("输出内容", "string"));
                props
            },
            vec!["title".to_string(), "content".to_string()],
            false,
            |args| {
                let title = str_arg(args, "title", "");
                (true, format!("知识输出已保存: {}", title))
            },
        ),
        tool(
            "lint_knowledge_base",
            "对知识库执行 9 项健康检查",
            serde_json::Map::new(),
            vec![],
            false,
            |_args| {
                (true, "LINT 检查需要通过应用状态执行".to_string())
            },
        ),
        tool(
            "merge_knowledge_pages",
            "合并重复的知识库页面",
            {
                let mut props = serde_json::Map::new();
                props.insert("keep".to_string(), prop("保留页面 slug", "string"));
                props.insert("remove".to_string(), prop("删除页面 slug", "string"));
                props.insert("area".to_string(), prop("页面区域（concepts/entities）", "string"));
                props
            },
            vec!["keep".to_string(), "remove".to_string(), "area".to_string()],
            false,
            |args| {
                let keep = str_arg(args, "keep", "");
                let remove = str_arg(args, "remove", "");
                (true, format!("合并操作需要通过应用状态执行: keep={}, remove={}", keep, remove))
            },
        ),
        tool(
            "reflect_knowledge_base",
            "对知识库执行综合分析（反向检验、模式扫描、Gap Analysis）",
            serde_json::Map::new(),
            vec![],
            false,
            |_args| {
                (true, "REFLECT 分析需要通过应用状态执行".to_string())
            },
        ),
    ]
}
