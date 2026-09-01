use crate::types::{AppConfig, ProviderConfig, VisionAssistConfig, ThemeConfig};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const ENC_PREFIX: &str = "enc:v1:";

/// Default system prompt (same as TS version)
pub const DEFAULT_SYSTEM_PROMPT: &str = r#"你是一个自主可控的 Windows 操作助手。你可以帮助用户：
1. 管理文件和目录（查找、创建、读取、修改、删除、复制、移动）
2. 操作 Windows 注册表（读取、写入、删除键和值）
3. 管理开机启动项、查看和结束进程
4. 模拟键盘和鼠标操作、操作窗口、截图
5. 执行系统命令、发起 HTTP 请求、获取系统信息
6. 制作 Word 文档（含 Word 原生可编辑数学公式）
7. 通过 skills 与 MCP 外部工具扩展能力
8. 生成图片绘图提示词（供 Midjourney / Stable Diffusion / 即梦AI 等外部工具使用）

执行规则：
- 用中文回复用户
- 查询类操作直接执行并展示结果；修改/删除类操作先说明再执行
- 操作失败时分析原因并给建议（如是否需要管理员权限）
- 多步骤任务逐步执行并报告每步结果
- 请求不清楚时先询问确认
- 只使用上面列出的工具名，不要发明不存在的工具名"#;

/// Default pet prompt (Angelina character)
pub const DEFAULT_PET_PROMPT: &str = r#"你正在扮演「安洁莉娜」——《明日方舟》中罗德岛的辅助干员、信使。以第一人称角色扮演，你就是她本人。

【人物档案】
- 本名：安心院安洁莉娜
- 外貌：赤狐沃尔珀族，橙发狐耳狐尾，162cm，生日5月14日
- 出身：叙拉古。母亲是东国人，父亲是叙拉古人
- 身份：罗德岛实习术师干员兼信使；感染者
- 源石技艺：反重力技艺，能让物品变重或变轻
- 性格：外表活泼可爱、元气满满；内心坚强温柔

【说话风格】
- 语气活泼俏皮、亲切自然，像邻家少女；称呼用户为「博士」
- 喜欢分享信使旅途的见闻、罗德岛的生活琐事
- 聊天时像朋友一样陪伴，会关心博士

【能力与工具】
- 作为信使，你乐于帮博士「跑腿」：查找文件、整理资料、制作文档等
- 涉及危险操作仍要请示博士确认

【扮演规则】
- 全程以安洁莉娜的口吻回复，保持人设不崩塌
- 回复亲切口语化、有温度，篇幅适中"#;

pub fn default_config() -> AppConfig {
    AppConfig {
        active_provider_id: "ollama".to_string(),
        providers: vec![
            ProviderConfig {
                id: "ollama".to_string(),
                label: "Ollama (本地)".to_string(),
                provider_type: "ollama".to_string(),
                base_url: "http://localhost:11434".to_string(),
                api_key: String::new(),
                model: "qwen2.5".to_string(),
                supports_vision: None,
            },
            ProviderConfig {
                id: "openai".to_string(),
                label: "OpenAI".to_string(),
                provider_type: "openai".to_string(),
                base_url: "https://api.openai.com/v1".to_string(),
                api_key: String::new(),
                model: "gpt-4o-mini".to_string(),
                supports_vision: None,
            },
            ProviderConfig {
                id: "deepseek".to_string(),
                label: "DeepSeek".to_string(),
                provider_type: "openai".to_string(),
                base_url: "https://api.deepseek.com/v1".to_string(),
                api_key: String::new(),
                model: "deepseek-chat".to_string(),
                supports_vision: None,
            },
        ],
        temperature: 0.3,
        max_tokens: 4096,
        system_prompt: DEFAULT_SYSTEM_PROMPT.to_string(),
        auto_approve_tools: false,
        compact_threshold_tokens: 24000,
        keep_recent_turns: 6,
        skills_dir: "skills".to_string(),
        mcp_config_path: "mcp.json".to_string(),
        vision_assist: VisionAssistConfig {
            enabled: false,
            provider_id: String::new(),
            model: String::new(),
            prompt: String::new(),
        },
        stream: true,
        thinking_mode: "auto".to_string(),
        chat_mode: "pet".to_string(),
        pet_prompt: DEFAULT_PET_PROMPT.to_string(),
        vault_path: String::new(),
        theme: ThemeConfig {
            mode: "light".to_string(),
            accent: "#f4719c".to_string(),
            accent2: "#6db7d9".to_string(),
        },
    }
}

/// Encrypt API key using Windows DPAPI (CryptProtectData).
/// Returns "enc:v1:" + base64(ciphertext), or empty string if input is empty.
fn encrypt_key(plain: &str) -> String {
    if plain.is_empty() {
        return String::new();
    }
    match dpapi_encrypt(plain.as_bytes()) {
        Ok(cipher) => format!("{}{}", ENC_PREFIX, cipher),
        Err(e) => {
            log::error!("[Config] DPAPI encrypt failed: {}, storing plaintext as fallback", e);
            plain.to_string()
        }
    }
}

/// Decrypt API key. If the stored value does not start with ENC_PREFIX, return as-is (plaintext).
fn decrypt_key(stored: &str) -> String {
    use base64::Engine;
    if stored.is_empty() {
        return String::new();
    }
    if !stored.starts_with(ENC_PREFIX) {
        // Plaintext (old config or encrypt fallback) — return as-is
        return stored.to_string();
    }
    let b64 = &stored[ENC_PREFIX.len()..];
    match base64::engine::general_purpose::STANDARD.decode(b64) {
        Ok(cipher) => match dpapi_decrypt(&cipher) {
            Ok(plain_bytes) => String::from_utf8_lossy(&plain_bytes).into_owned(),
            Err(e) => {
                log::error!("[Config] DPAPI decrypt failed: {}, clearing key", e);
                String::new()
            }
        },
        Err(e) => {
            log::error!("[Config] base64 decode failed: {}, clearing key", e);
            String::new()
        }
    }
}

fn dpapi_encrypt(plain: &[u8]) -> Result<String, String> {
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};
    use windows::Win32::Foundation::LocalFree;
    use base64::Engine;

    let mut data = plain.to_vec();
    let blob = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_mut_ptr(),
    };

    unsafe {
        let mut out_blob = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        CryptProtectData(
            &blob,
            windows::core::PCWSTR::null(),
            None,
            None,
            None,
            0,
            &mut out_blob,
        )
        .map_err(|e| format!("CryptProtectData: {}", e))?;

        let cipher = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec();

        let _ = LocalFree(windows::Win32::Foundation::HLOCAL(out_blob.pbData as *mut core::ffi::c_void));

        Ok(base64::engine::general_purpose::STANDARD.encode(&cipher))
    }
}

fn dpapi_decrypt(cipher: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};
    use windows::Win32::Foundation::LocalFree;

    let mut data = cipher.to_vec();
    let blob = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_mut_ptr(),
    };

    unsafe {
        let mut out_blob = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        CryptUnprotectData(
            &blob,
            None,
            None,
            None,
            None,
            0,
            &mut out_blob,
        )
        .map_err(|e| format!("CryptUnprotectData: {}", e))?;

        let plain = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec();

        let _ = LocalFree(windows::Win32::Foundation::HLOCAL(out_blob.pbData as *mut core::ffi::c_void));

        Ok(plain)
    }
}

#[derive(Clone)]
pub struct ConfigStore {
    inner: Arc<Mutex<ConfigInner>>,
}

struct ConfigInner {
    config_path: PathBuf,
    data_dir: PathBuf,
    cfg: AppConfig,
}

impl ConfigStore {
    pub fn new(data_dir: &Path) -> Self {
        let config_path = data_dir.join("config.json");
        let store = Self {
            inner: Arc::new(Mutex::new(ConfigInner {
                config_path,
                data_dir: data_dir.to_path_buf(),
                cfg: default_config(),
            })),
        };
        store.load();
        store
    }

    pub fn load(&self) {
        let mut inner = self.inner.lock().unwrap();
        match std::fs::read_to_string(&inner.config_path) {
            Ok(raw) => {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) {
                    let mut cfg = default_config();

                    // Merge parsed fields over defaults
                    if let Some(obj) = parsed.as_object() {
                        merge_config(&mut cfg, obj);
                    }

                    // Decrypt api keys
                    for p in cfg.providers.iter_mut() {
                        p.api_key = decrypt_key(&p.api_key);
                    }

                    inner.cfg = cfg;
                }
            }
            Err(_) => {
                // Write default config
                let cfg = default_config();
                let disk_cfg = serde_json::to_string_pretty(&cfg).unwrap_or_default();
                let _ = std::fs::write(&inner.config_path, disk_cfg);
                inner.cfg = cfg;
            }
        }
    }

    pub fn get(&self) -> AppConfig {
        self.inner.lock().unwrap().cfg.clone()
    }

    pub fn save(&self, cfg: &AppConfig) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        inner.cfg = cfg.clone();

        // Encrypt api keys for disk
        let mut disk_cfg = cfg.clone();
        for p in disk_cfg.providers.iter_mut() {
            p.api_key = encrypt_key(&p.api_key);
        }

        let json = serde_json::to_string_pretty(&disk_cfg)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        if let Some(parent) = inner.config_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&inner.config_path, json).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn active_provider(&self) -> Option<ProviderConfig> {
        let inner = self.inner.lock().unwrap();
        inner.cfg.providers.iter()
            .find(|p| p.id == inner.cfg.active_provider_id)
            .or(inner.cfg.providers.first())
            .cloned()
    }

    pub fn resolve_path(&self, p: &str) -> PathBuf {
        let inner = self.inner.lock().unwrap();
        if p.is_empty() {
            return inner.data_dir.clone();
        }
        let path = PathBuf::from(p);
        if path.is_absolute() {
            path
        } else {
            inner.data_dir.join(path)
        }
    }

    pub fn resolve_vault_path(&self) -> PathBuf {
        let inner = self.inner.lock().unwrap();
        let p = if inner.cfg.vault_path.is_empty() {
            "wiki"
        } else {
            &inner.cfg.vault_path
        };
        let path = PathBuf::from(p);
        if path.is_absolute() {
            path
        } else {
            inner.data_dir.join(path)
        }
    }

    pub fn data_dir(&self) -> PathBuf {
        self.inner.lock().unwrap().data_dir.clone()
    }
}

fn merge_config(cfg: &mut AppConfig, obj: &serde_json::Map<String, serde_json::Value>) {
    if let Some(v) = obj.get("activeProviderId").and_then(|v| v.as_str()) {
        cfg.active_provider_id = v.to_string();
    }
    if let Some(arr) = obj.get("providers").and_then(|v| v.as_array()) {
        cfg.providers = arr.iter().filter_map(|p| serde_json::from_value(p.clone()).ok()).collect();
        if cfg.providers.is_empty() {
            cfg.providers = default_config().providers;
        }
    }
    if let Some(v) = obj.get("temperature").and_then(|v| v.as_f64()) {
        cfg.temperature = v;
    }
    if let Some(v) = obj.get("maxTokens").and_then(|v| v.as_u64()) {
        cfg.max_tokens = v as u32;
    }
    if let Some(v) = obj.get("systemPrompt").and_then(|v| v.as_str()) {
        cfg.system_prompt = v.to_string();
    }
    if let Some(v) = obj.get("autoApproveTools").and_then(|v| v.as_bool()) {
        cfg.auto_approve_tools = v;
    }
    if let Some(v) = obj.get("compactThresholdTokens").and_then(|v| v.as_u64()) {
        cfg.compact_threshold_tokens = v as u32;
    }
    if let Some(v) = obj.get("keepRecentTurns").and_then(|v| v.as_u64()) {
        cfg.keep_recent_turns = v as u32;
    }
    if let Some(v) = obj.get("skillsDir").and_then(|v| v.as_str()) {
        cfg.skills_dir = v.to_string();
    }
    if let Some(v) = obj.get("mcpConfigPath").and_then(|v| v.as_str()) {
        cfg.mcp_config_path = v.to_string();
    }
    if let Some(v) = obj.get("visionAssist") {
        if let Ok(va) = serde_json::from_value::<VisionAssistConfig>(v.clone()) {
            cfg.vision_assist = va;
        }
    }
    if let Some(v) = obj.get("stream").and_then(|v| v.as_bool()) {
        cfg.stream = v;
    }
    if let Some(v) = obj.get("thinkingMode").and_then(|v| v.as_str()) {
        cfg.thinking_mode = v.to_string();
    }
    if let Some(v) = obj.get("chatMode").and_then(|v| v.as_str()) {
        cfg.chat_mode = v.to_string();
    }
    if let Some(v) = obj.get("petPrompt").and_then(|v| v.as_str()) {
        cfg.pet_prompt = v.to_string();
    }
    if let Some(v) = obj.get("vaultPath").and_then(|v| v.as_str()) {
        cfg.vault_path = v.to_string();
    }
    if let Some(v) = obj.get("theme") {
        if let Ok(t) = serde_json::from_value::<ThemeConfig>(v.clone()) {
            cfg.theme = t;
        }
    }
}
