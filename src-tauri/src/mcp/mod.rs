use crate::types::ToolSchema;
use std::path::Path;

/// MCP (Model Context Protocol) Manager
/// Loads MCP server configurations and communicates via JSON-RPC
pub struct McpManager {
    servers: Vec<McpServer>,
}

struct McpServer {
    name: String,
    command: String,
    args: Vec<String>,
    tools: Vec<ToolSchema>,
}

impl McpManager {
    pub fn new() -> Self {
        Self { servers: vec![] }
    }

    /// Load MCP configuration from a JSON file
    pub fn load(&mut self, config_path: &str) -> Result<Vec<ToolSchema>, String> {
        self.servers.clear();

        let path = Path::new(config_path);
        if !path.exists() {
            return Ok(vec![]);
        }

        let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let config: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

        if let Some(servers) = config.get("mcpServers").and_then(|v| v.as_object()) {
            for (name, server_config) in servers {
                let command = server_config.get("command").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let args: Vec<String> = server_config.get("args")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().filter_map(|a| a.as_str().map(|s| s.to_string())).collect())
                    .unwrap_or_default();

                // For now, we don't actually spawn the MCP server process.
                // Tool discovery would happen via JSON-RPC initialize -> tools/list
                // This is a placeholder; full MCP support requires spawning child process
                // and implementing the JSON-RPC protocol.
                self.servers.push(McpServer {
                    name: name.clone(),
                    command,
                    args,
                    tools: vec![],
                });
            }
        }

        log::info!("[MCP] Loaded {} server configs", self.servers.len());

        let all_tools: Vec<ToolSchema> = self.servers.iter().flat_map(|s| s.tools.clone()).collect();
        Ok(all_tools)
    }

    pub fn dispose(&mut self) {
        self.servers.clear();
    }
}
