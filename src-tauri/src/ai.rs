use crate::{storage::Store, Result};
use futures_util::StreamExt;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::{ipc::Channel, State};
use tokio::sync::watch;
#[derive(Default)]
pub struct Jobs(
    pub Mutex<HashMap<String, watch::Sender<bool>>>,
    pub Mutex<std::collections::HashSet<String>>,
);
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub base_url: String,
    pub model: String,
    pub vision: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            base_url: "https://api.deepseek.com".into(),
            model: "deepseek-flash".into(),
            vision: true,
        }
    }
}
fn settings(c: &rusqlite::Connection) -> Result<Settings> {
    let raw = c
        .query_row("SELECT data FROM settings WHERE id='ai'", [], |r| {
            r.get::<_, String>(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    match raw {
        Some(v) => serde_json::from_str(&v).map_err(|e| e.to_string()),
        None => Ok(Settings::default()),
    }
}
pub fn validate(mut s: Settings) -> Result<Settings> {
    s.base_url = s.base_url.trim().trim_end_matches('/').into();
    s.model = s.model.trim().into();
    let url = reqwest::Url::parse(&s.base_url).map_err(|_| "API 地址无效")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("API 必须使用 HTTPS，本机接口除外".into());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("API 地址不能包含凭据、查询或片段".into());
    }
    if s.model.is_empty() || s.model.len() > 120 {
        return Err("模型名称无效".into());
    }
    Ok(s)
}
pub fn supports_images(s: &Settings) -> bool {
    let host = reqwest::Url::parse(&s.base_url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .unwrap_or_default();
    if host == "api.deepseek.com" || s.model.starts_with("deepseek-") {
        s.model == "deepseek-flash"
    } else {
        s.vision
    }
}
fn credential(base_url: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(
        "org.aistudy.reader",
        &format!(
            "api-{:x}",
            Sha256::digest(base_url.trim().trim_end_matches('/').as_bytes())
        ),
    )
    .map_err(|e| format!("系统凭据存储不可用：{e}"))
}
#[tauri::command]
pub fn get_settings(s: State<Store>) -> Result<Value> {
    let config = settings(&*s.inner().0.lock().map_err(|e| e.to_string())?)?;
    let has_key = match credential(&config.base_url)?.get_password() {
        Ok(k) => !k.is_empty(),
        Err(keyring::Error::NoEntry) => false,
        Err(e) => return Err(format!("读取系统凭据失败：{e}")),
    };
    Ok(json!({"settings":config,"hasKey":has_key}))
}
#[tauri::command]
pub fn save_settings(settings: Settings, key: Option<String>, s: State<Store>) -> Result<()> {
    let config = validate(settings)?;
    if let Some(k) = key {
        let k = k.trim();
        if k.is_empty() || k.len() > 4096 {
            return Err("API Key 无效".into());
        }
        credential(&config.base_url)?
            .set_password(k)
            .map_err(|e| format!("保存系统凭据失败：{e}"))?;
    }
    s.inner()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .execute(
            "INSERT INTO settings VALUES('ai',?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            [serde_json::to_string(&config).map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn delete_key(base_url: String) -> Result<()> {
    match credential(&base_url)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("删除凭据失败：{e}")),
    }
}
#[tauri::command]
pub fn list_chats(book_id: String, page: u32, s: State<Store>) -> Result<Vec<Value>> {
    let c = s.inner().0.lock().map_err(|e| e.to_string())?;
    let mut q=c.prepare("SELECT data FROM chats WHERE book_id=?1 AND page=?2 ORDER BY json_extract(data,'$.created')").map_err(|e|e.to_string())?;
    let rows = q
        .query_map(params![book_id, page], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.map(|r| serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string()))
        .collect()
}
#[tauri::command]
pub fn save_chat(chat: Value, s: State<Store>) -> Result<()> {
    let id = chat["id"].as_str().ok_or("对话 ID 缺失")?;
    let book = chat["bookId"].as_str().ok_or("文档 ID 缺失")?;
    let page = chat["page"]
        .as_u64()
        .filter(|p| *p > 0)
        .ok_or("对话页码无效")?;
    let data = serde_json::to_string(&chat).map_err(|e| e.to_string())?;
    if data.len() > 16 * 1024 * 1024 {
        return Err("对话数据超过 16 MB".into());
    }
    s.inner().0.lock().map_err(|e|e.to_string())?.execute("INSERT INTO chats VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET data=excluded.data",params![id,book,page,data]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn cancel_chat(id: String, jobs: State<Jobs>) -> Result<()> {
    let map = jobs.inner().0.lock().map_err(|e| e.to_string())?;
    if let Some(sender) = map.get(&id) {
        let _ = sender.send(true);
    } else {
        let mut pending = jobs.inner().1.lock().map_err(|e| e.to_string())?;
        if pending.len() < 100 {
            pending.insert(id);
        }
    }
    Ok(())
}
pub fn validate_messages(config: &Settings, messages: &[Value]) -> Result<()> {
    if messages.is_empty() || messages.len() > 20 {
        return Err("消息数量无效".into());
    }
    let raw = serde_json::to_string(messages).map_err(|e| e.to_string())?;
    if raw.len() > 12 * 1024 * 1024 {
        return Err("请求超过 12 MB，请缩小截图".into());
    }
    for m in messages {
        if !matches!(m["role"].as_str(), Some("system" | "user" | "assistant")) {
            return Err("消息角色无效".into());
        }
        if let Some(parts) = m["content"].as_array() {
            for part in parts {
                if part["type"] == "image_url" {
                    if !supports_images(config) {
                        return Err("当前模型不支持视觉，未发送图片".into());
                    }
                    let url = part["image_url"]["url"].as_str().ok_or("图片格式无效")?;
                    if !url.starts_with("data:image/png;base64,") {
                        return Err("仅支持本地 PNG 截图".into());
                    }
                } else if part["type"] != "text" {
                    return Err("消息类型无效".into());
                }
            }
        } else if !m["content"].is_string() {
            return Err("消息内容无效".into());
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn ai_chat(
    id: String,
    messages: Vec<Value>,
    on_chunk: Channel<Vec<u8>>,
    s: State<'_, Store>,
    jobs: State<'_, Jobs>,
) -> Result<()> {
    let config = validate(settings(&*s.inner().0.lock().map_err(|e| e.to_string())?)?)?;
    validate_messages(&config, &messages)?;
    let key = credential(&config.base_url)?
        .get_password()
        .map_err(|_| "请在 AI 设置中为此接口保存 API Key")?;
    let (sender, mut cancellation) = watch::channel(false);
    {
        let mut map = jobs.inner().0.lock().map_err(|e| e.to_string())?;
        if jobs
            .inner()
            .1
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&id)
        {
            return Err("生成已停止".into());
        }
        if map.len() >= 3 {
            return Err("已有过多 AI 请求".into());
        }
        if map.contains_key(&id) {
            return Err("重复请求".into());
        }
        map.insert(id.clone(), sender);
    }
    let operation = async {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "创建 HTTP 客户端失败")?;
        let request = client
            .post(format!("{}/chat/completions", config.base_url))
            .bearer_auth(&key)
            .json(
                &json!({"model":config.model,"messages":messages,"stream":true,"max_tokens":4096}),
            )
            .send();
        let response = tokio::select! {r=request=>r.map_err(|_|"网络连接失败，请检查网络和 API 地址")?,_=cancellation.changed()=>return Err("生成已停止".into())};
        if !response.status().is_success() {
            return Err(match response.status().as_u16() {
                401 | 403 => "接口拒绝访问，请检查 API Key 与模型权限".into(),
                402 => "接口余额不足".into(),
                429 => "接口限流，请稍后重试".into(),
                status => format!("AI 接口 HTTP {status}，请检查模型和接口配置"),
            });
        }
        let mut stream = response.bytes_stream();
        let mut total = 0usize;
        loop {
            let next = tokio::select! {v=stream.next()=>v,_=cancellation.changed()=>return Err("生成已停止".into())};
            match next {
                Some(Ok(bytes)) => {
                    total += bytes.len();
                    if total > 8 * 1024 * 1024 {
                        return Err("回答流超过 8 MB 上限".into());
                    }
                    on_chunk
                        .send(bytes.to_vec())
                        .map_err(|_| "阅读窗口已关闭")?
                }
                Some(Err(_)) => return Err("流式连接中断，已保留部分回答".into()),
                None => break,
            }
        }
        Ok(())
    };
    let result = tokio::time::timeout(Duration::from_secs(180), operation)
        .await
        .unwrap_or_else(|_| Err("接口响应超时，已保留部分回答".into()));
    jobs.inner()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id);
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_insecure_endpoint() {
        assert!(validate(Settings {
            base_url: "http://example.com".into(),
            ..Default::default()
        })
        .is_err());
        assert!(validate(Settings {
            base_url: "http://127.0.0.1:8000/v1".into(),
            ..Default::default()
        })
        .is_ok());
    }
    #[test]
    fn blocks_unsupported_images_in_native_boundary() {
        let s = Settings {
            model: "deepseek-chat".into(),
            vision: true,
            ..Default::default()
        };
        let m = json!({"role":"user","content":[{"type":"image_url","image_url":{"url":"data:image/png;base64,AA=="}}]});
        assert!(validate_messages(&s, &[m.clone()]).is_err());
        assert!(validate_messages(&Settings::default(), &[m]).is_ok());
    }
    #[test]
    #[cfg(windows)]
    fn windows_credentials_roundtrip_without_database() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let entry = credential(&format!("https://test-{unique}.invalid")).unwrap();
        entry.set_password("TEST-ONLY-not-a-real-api-key").unwrap();
        let recovered = entry.get_password();
        let removed = entry.delete_credential();
        assert_eq!(recovered.unwrap(), "TEST-ONLY-not-a-real-api-key");
        removed.unwrap();
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }
}
