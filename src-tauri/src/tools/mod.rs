pub mod types;
pub mod file_tools;
pub mod system_tools;
pub mod input_tools;
pub mod window_tools;
pub mod http_tools;
pub mod docx_tools;
pub mod image_tools;
pub mod registry_tools;
pub mod wiki_tools;

use crate::types::{AppConfig, ToolInfo, ToolSchema};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub struct ToolRegistry {
    tools: Mutex<HashMap<String, ToolEntry>>,
    wiki_tools: Mutex<Vec<ToolEntry>>,
}

#[derive(Clone)]
struct ToolEntry {
    schema: ToolSchema,
    source: String, // "builtin" | "skill" | "mcp"
    dangerous: bool,
    executor: Arc<dyn Fn(&serde_json::Value) -> (bool, String) + Send + Sync>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: Mutex::new(HashMap::new()),
            wiki_tools: Mutex::new(vec![]),
        }
    }

    fn add_all(&self, entries: Vec<ToolEntry>, source: &str) {
        let mut tools = self.tools.lock().unwrap();
        for mut entry in entries {
            entry.source = source.to_string();
            tools.insert(entry.schema.name.clone(), entry);
        }
    }

    pub fn set_wiki_tools(&self, entries: Vec<ToolEntry>) {
        *self.wiki_tools.lock().unwrap() = entries;
    }

    pub fn initialize(&self, _cfg: &AppConfig) -> Result<(), String> {
        let mut tools = self.tools.lock().unwrap();
        tools.clear();

        let mut all: Vec<ToolEntry> = vec![];
        all.extend(file_tools::create());
        all.extend(system_tools::create());
        all.extend(registry_tools::create());
        all.extend(input_tools::create());
        all.extend(window_tools::create());
        all.extend(http_tools::create());
        all.extend(docx_tools::create());
        all.extend(image_tools::create());
        all.extend(wiki_tools::create());
        all.extend(self.wiki_tools.lock().unwrap().iter().cloned().collect::<Vec<_>>());

        for entry in all {
            tools.insert(entry.schema.name.clone(), entry);
        }

        log::info!("[Tools] Built-in tools: {}", tools.len());
        Ok(())
    }

    pub fn get_schemas(&self) -> Vec<ToolSchema> {
        self.tools.lock().unwrap().values().map(|e| e.schema.clone()).collect()
    }

    pub fn get_infos(&self) -> Vec<ToolInfo> {
        self.tools.lock().unwrap().values().map(|e| ToolInfo {
            name: e.schema.name.clone(),
            description: e.schema.description.clone(),
            source: e.source.clone(),
            dangerous: e.dangerous,
        }).collect()
    }

    pub fn get_source(&self, name: &str) -> String {
        self.tools.lock().unwrap().get(name).map(|e| e.source.clone()).unwrap_or_else(|| "builtin".to_string())
    }

    pub fn is_dangerous(&self, name: &str) -> bool {
        self.tools.lock().unwrap().get(name).map(|e| e.dangerous).unwrap_or(false)
    }

    pub fn execute(&self, name: &str, args: &serde_json::Value) -> (bool, String) {
        let tools = self.tools.lock().unwrap();
        match tools.get(name) {
            Some(entry) => (entry.executor)(args),
            None => (false, format!("未知工具: {}", name)),
        }
    }
}

/// Helper to create a tool entry
pub fn tool(
    name: &str,
    description: &str,
    properties: serde_json::Map<String, serde_json::Value>,
    required: Vec<String>,
    dangerous: bool,
    executor: impl Fn(&serde_json::Value) -> (bool, String) + Send + Sync + 'static,
) -> ToolEntry {
    ToolEntry {
        schema: ToolSchema {
            name: name.to_string(),
            description: description.to_string(),
            parameters: crate::types::ToolSchemaParams {
                params_type: "object".to_string(),
                properties,
                required: Some(required),
            },
        },
        source: String::new(), // set by add_all
        dangerous,
        executor: Arc::new(executor),
    }
}

/// Helper to get a string argument
pub fn str_arg(v: &serde_json::Value, key: &str, default: &str) -> String {
    v.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or(default)
        .to_string()
}

/// Helper to get a number argument
pub fn num_arg(v: &serde_json::Value, key: &str, default: f64) -> f64 {
    v.get(key).and_then(|v| v.as_f64()).unwrap_or(default)
}

/// Helper to get a bool argument
pub fn bool_arg(v: &serde_json::Value, key: &str, default: bool) -> bool {
    v.get(key).and_then(|v| v.as_bool()).unwrap_or(default)
}

/// Helper to build JSON object property
pub fn prop(description: &str, prop_type: &str) -> serde_json::Value {
    serde_json::json!({
        "type": prop_type,
        "description": description,
    })
}
