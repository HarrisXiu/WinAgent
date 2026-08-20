use super::{tool, prop};

pub fn create() -> Vec<super::ToolEntry> {
    vec![
        // These are placeholder tools that return info about available tools.
        // The actual tool list and reload are handled by Tauri commands.
        tool(
            "list_tools",
            "列出所有可用工具",
            serde_json::Map::new(),
            vec![],
            false,
            |_args| {
                (true, "请使用工具管理界面查看完整工具列表".to_string())
            },
        ),
        tool(
            "reload_tools",
            "重新加载工具（skills 和 MCP）",
            serde_json::Map::new(),
            vec![],
            false,
            |_args| {
                (true, "请通过设置页面重新加载工具".to_string())
            },
        ),
    ]
}
