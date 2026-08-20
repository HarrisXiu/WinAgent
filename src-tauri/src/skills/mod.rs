use crate::types::ToolSchema;
use std::path::Path;

/// A loaded skill
pub struct Skill {
    pub schema: ToolSchema,
    pub script_path: String,
    pub dangerous: bool,
}

/// Load skills from a directory.
/// Skills are JS scripts with a manifest.json or SKILL.md header.
pub fn load_skills(skills_dir: &str) -> Vec<Skill> {
    let dir = Path::new(skills_dir);
    if !dir.exists() || !dir.is_dir() {
        return vec![];
    }

    let mut skills = vec![];
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return vec![],
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() { continue; }

        let manifest_path = path.join("manifest.json");
        let skill_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();

        if manifest_path.exists() {
            if let Ok(manifest) = std::fs::read_to_string(&manifest_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&manifest) {
                    let name = json.get("name").and_then(|v| v.as_str()).unwrap_or(&skill_name).to_string();
                    let description = json.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let script = json.get("script").and_then(|v| v.as_str()).unwrap_or("index.js").to_string();
                    let dangerous = json.get("dangerous").and_then(|v| v.as_bool()).unwrap_or(false);
                    let script_path = path.join(&script).to_string_lossy().to_string();

                    // Build parameters from manifest
                    let properties = json.get("parameters")
                        .and_then(|v| v.as_object())
                        .cloned()
                        .unwrap_or_default();
                    let required = json.get("required")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(|s| s.as_str().map(|s| s.to_string())).collect())
                        .unwrap_or_default();

                    skills.push(Skill {
                        schema: ToolSchema {
                            name,
                            description,
                            parameters: crate::types::ToolSchemaParams {
                                params_type: "object".to_string(),
                                properties,
                                required: Some(required),
                            },
                        },
                        script_path,
                        dangerous,
                    });
                }
            }
        }
    }

    log::info!("[Skills] Loaded {} skills from {}", skills.len(), skills_dir);
    skills
}

/// Execute a skill by running its JS script with node
pub fn execute_skill(script_path: &str, args: &serde_json::Value) -> (bool, String) {
    let args_str = serde_json::to_string(args).unwrap_or_else(|_| "{}".to_string());

    let output = std::process::Command::new("node")
        .arg(script_path)
        .arg(&args_str)
        .output();

    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).to_string();
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            if o.status.success() {
                (true, stdout)
            } else {
                (false, format!("{}\n{}", stdout, stderr))
            }
        }
        Err(e) => (false, format!("Failed to execute skill: {}", e)),
    }
}
