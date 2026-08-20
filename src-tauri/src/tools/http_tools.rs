use super::{tool, str_arg, prop};

pub fn create() -> Vec<super::ToolEntry> {
    vec![
        tool(
            "http_request",
            "发起 HTTP 请求",
            {
                let mut props = serde_json::Map::new();
                props.insert("url".to_string(), prop("请求 URL", "string"));
                props.insert("method".to_string(), prop("HTTP 方法（GET/POST/PUT/DELETE，默认 GET）", "string"));
                props.insert("headers".to_string(), prop("请求头（JSON 对象）", "object"));
                props.insert("body".to_string(), prop("请求体（字符串）", "string"));
                props
            },
            vec!["url".to_string()],
            false,
            |args| {
                let url = str_arg(args, "url", "");
                let method = str_arg(args, "method", "GET");
                let body = str_arg(args, "body", "");

                // Execute synchronously using a blocking thread
                let url_clone = url.clone();
                let method_clone = method.clone();
                let body_clone = body.clone();
                let headers_val = args.get("headers").cloned();

                let result = std::thread::spawn(move || {
                    let rt = match tokio::runtime::Runtime::new() {
                        Ok(r) => r,
                        Err(e) => return Err(e.to_string()),
                    };
                    rt.block_on(async move {
                        let client = reqwest::Client::new();
                        let mut req = match method_clone.to_uppercase().as_str() {
                            "POST" => client.post(&url_clone),
                            "PUT" => client.put(&url_clone),
                            "DELETE" => client.delete(&url_clone),
                            _ => client.get(&url_clone),
                        };

                        if let Some(headers) = headers_val {
                            if let Some(obj) = headers.as_object().cloned() {
                                let mut header_map = reqwest::header::HeaderMap::new();
                                for (k, v) in &obj {
                                    if let Some(s) = v.as_str() {
                                        if let Ok(name) = reqwest::header::HeaderName::from_bytes(k.as_bytes()) {
                                            if let Ok(hv) = reqwest::header::HeaderValue::from_str(s) {
                                                header_map.insert(name, hv);
                                            }
                                        }
                                    }
                                }
                                req = req.headers(header_map);
                            }
                        }

                        if !body_clone.is_empty() {
                            req = req.body(body_clone);
                        }

                        let res = match req.send().await {
                            Ok(r) => r,
                            Err(e) => return Err(e.to_string()),
                        };
                        let status = res.status();
                        let text = match res.text().await {
                            Ok(t) => t,
                            Err(e) => return Err(e.to_string()),
                        };
                        Ok(format!("Status: {}\n\n{}", status, text))
                    })
                })
                .join()
                .map_err(|_| "Thread panicked".to_string());

                match result {
                    Ok(Ok(s)) => (true, s),
                    Ok(Err(e)) => (false, e),
                    Err(e) => (false, e),
                }
            },
        ),
        tool(
            "http_download",
            "下载文件到指定路径",
            {
                let mut props = serde_json::Map::new();
                props.insert("url".to_string(), prop("下载 URL", "string"));
                props.insert("path".to_string(), prop("保存路径", "string"));
                props
            },
            vec!["url".to_string(), "path".to_string()],
            false,
            |args| {
                let url = str_arg(args, "url", "");
                let path = str_arg(args, "path", "");

                let result = std::thread::spawn(move || {
                    let rt = match tokio::runtime::Runtime::new() {
                        Ok(r) => r,
                        Err(e) => return Err(e.to_string()),
                    };
                    rt.block_on(async move {
                        let client = reqwest::Client::new();
                        let res = match client.get(&url).send().await {
                            Ok(r) => r,
                            Err(e) => return Err(e.to_string()),
                        };
                        let bytes = match res.bytes().await {
                            Ok(b) => b,
                            Err(e) => return Err(e.to_string()),
                        };
                        if let Err(e) = std::fs::write(&path, &bytes) {
                            return Err(e.to_string());
                        }
                        Ok(format!("已下载到: {}", path))
                    })
                })
                .join()
                .map_err(|_| "Thread panicked".to_string());

                match result {
                    Ok(Ok(s)) => (true, s),
                    Ok(Err(e)) => (false, e),
                    Err(e) => (false, e),
                }
            },
        ),
    ]
}
