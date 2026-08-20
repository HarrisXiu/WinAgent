use base64::Engine;
use std::path::Path;
use tauri::AppHandle;

#[tauri::command]
pub async fn pick_directory(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("选择文件夹")
        .pick_folder(move |path| {
            let result = path.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string());
            let _ = tx.send(result);
        });

    let result = rx.await.map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub async fn read_file(file_path: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&file_path);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    let image_exts = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
    let text_exts = [
        "txt", "md", "json", "js", "ts", "tsx", "jsx", "py", "java",
        "c", "cpp", "h", "css", "html", "xml", "yml", "yaml", "csv", "log", "sh", "bat",
    ];

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    if image_exts.contains(&ext.as_str()) {
        let mime = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "bmp" => "image/bmp",
            _ => "application/octet-stream",
        };
        let buf = tokio::fs::read(&file_path).await.map_err(|e| e.to_string())?;
        let data_url = format!(
            "data:{};base64,{}",
            mime,
            base64::engine::general_purpose::STANDARD.encode(&buf)
        );
        return Ok(serde_json::json!({
            "name": name,
            "path": file_path,
            "mime": mime,
            "isImage": true,
            "dataUrl": data_url,
        }));
    }

    if text_exts.contains(&ext.as_str()) {
        let content = tokio::fs::read_to_string(&file_path)
            .await
            .map_err(|e| e.to_string())?;
        let truncated: String = content.chars().take(50000).collect();
        return Ok(serde_json::json!({
            "name": name,
            "path": file_path,
            "mime": "application/octet-stream",
            "isImage": false,
            "textContent": truncated,
        }));
    }

    Ok(serde_json::json!({
        "name": name,
        "path": file_path,
        "mime": "application/octet-stream",
        "isImage": false,
    }))
}
