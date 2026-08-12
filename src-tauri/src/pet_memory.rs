use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const MAX_FILE_BYTES: u64 = 512 * 1024;
const MAX_CONTENT_CHARS: usize = 300;
static MEMORY_IO_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetMemory {
    pub id: String,
    pub category: String,
    pub content: String,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_conversation_id: Option<String>,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 120
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

fn path(app: &AppHandle, pet_id: &str) -> Result<PathBuf, String> {
    if !valid_id(pet_id) {
        return Err("Invalid pet id".into());
    }
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("pet-memory")
        .join(format!("{pet_id}.json")))
}

pub(crate) fn sensitive(value: &str) -> bool {
    let lower = value.to_lowercase();
    let labeled_secret = [
        "password",
        "passwd",
        "pwd",
        "密碼",
        "密码",
        "api key",
        "api token",
        "access token",
        "private key",
        "私鑰",
        "私钥",
    ]
    .iter()
    .any(|label| lower.contains(label));
    let compact_digits = value.chars().filter(char::is_ascii_digit).count();
    let financial_or_identity = compact_digits >= 13
        || [
            "bank account",
            "銀行帳號",
            "身分證",
            "身份證",
            "social security",
            "passport",
        ]
        .iter()
        .any(|label| lower.contains(label));
    let medical = [
        "medical record:",
        "diagnosis:",
        "prescription:",
        "病歷：",
        "診斷：",
        "處方：",
    ]
    .iter()
    .any(|label| lower.contains(label));
    labeled_secret
        || lower.contains("-----begin private key-----")
        || financial_or_identity
        || medical
}

fn sanitize(mut item: PetMemory) -> Result<PetMemory, String> {
    if !valid_id(&item.id) {
        return Err("Invalid memory id".into());
    }
    if !matches!(item.category.as_str(), "preference" | "fact" | "ongoing") {
        return Err("Invalid memory category".into());
    }
    item.content = item
        .content
        .trim()
        .chars()
        .take(MAX_CONTENT_CHARS)
        .collect();
    if item.content.is_empty() {
        return Err("Memory content is empty".into());
    }
    if sensitive(&item.content) {
        return Err("這項內容疑似包含敏感資料，請不要保存。".into());
    }
    let now = now_millis();
    item.created_at = item.created_at.min(now.saturating_add(60_000));
    item.updated_at = item
        .updated_at
        .min(now.saturating_add(60_000))
        .max(item.created_at);
    item.source_conversation_id = item
        .source_conversation_id
        .map(|id| id.trim().chars().take(120).collect())
        .filter(|id: &String| valid_id(id));
    Ok(item)
}

fn read(path: &PathBuf) -> Result<Vec<PetMemory>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_FILE_BYTES {
        return Err("Pet memory file is too large".into());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Invalid pet memory: {e}"))
}

fn write(path: &PathBuf, items: &[PetMemory]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid memory path")?;
    fs::create_dir_all(parent).map_err(|e| format!("Cannot create memory directory: {e}"))?;
    let temp = path.with_extension("json.tmp");
    fs::write(
        &temp,
        serde_json::to_vec_pretty(items).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Cannot save pet memory: {e}"))?;
    fs::rename(temp, path).map_err(|e| format!("Cannot replace pet memory: {e}"))
}

pub fn load(app: &AppHandle, pet_id: &str, max_entries: usize) -> Result<Vec<PetMemory>, String> {
    let _guard = MEMORY_IO_LOCK
        .lock()
        .map_err(|_| "Pet memory storage lock failed")?;
    let path = path(app, pet_id)?;
    let mut items: Vec<_> = read(&path)?
        .into_iter()
        .filter_map(|item| sanitize(item).ok())
        .collect();
    items.sort_by_key(|item| item.updated_at);
    let keep = max_entries.clamp(1, 200);
    if items.len() > keep {
        items.drain(..items.len() - keep);
    }
    log::info!("pet_memory load pet_id={pet_id} entries={}", items.len());
    Ok(items)
}

pub fn save(
    app: &AppHandle,
    pet_id: &str,
    item: PetMemory,
    max_entries: usize,
) -> Result<Vec<PetMemory>, String> {
    let _guard = MEMORY_IO_LOCK
        .lock()
        .map_err(|_| "Pet memory storage lock failed")?;
    let path = path(app, pet_id)?;
    let memory_id = item.id.clone();
    let item = sanitize(item).map_err(|error| {
        log::warn!("pet_memory save rejected pet_id={pet_id} memory_id={memory_id}: {error}");
        error
    })?;
    let mut items = read(&path)?;
    if let Some(existing) = items.iter_mut().find(|existing| existing.id == item.id) {
        *existing = item;
    } else {
        items.push(item);
    }
    items.sort_by_key(|item| item.updated_at);
    let keep = max_entries.clamp(1, 200);
    if items.len() > keep {
        items.drain(..items.len() - keep);
    }
    write(&path, &items).map_err(|error| {
        log::error!("pet_memory save failed pet_id={pet_id} memory_id={memory_id}: {error}");
        error
    })?;
    log::info!(
        "pet_memory save succeeded pet_id={pet_id} memory_id={memory_id} entries={}",
        items.len()
    );
    Ok(items)
}

pub fn delete(app: &AppHandle, pet_id: &str, memory_id: &str) -> Result<Vec<PetMemory>, String> {
    let _guard = MEMORY_IO_LOCK
        .lock()
        .map_err(|_| "Pet memory storage lock failed")?;
    if !valid_id(memory_id) {
        return Err("Invalid memory id".into());
    }
    let path = path(app, pet_id)?;
    let mut items = read(&path)?;
    items.retain(|item| item.id != memory_id);
    write(&path, &items)?;
    Ok(items)
}

pub fn clear(app: &AppHandle, pet_id: &str) -> Result<(), String> {
    let _guard = MEMORY_IO_LOCK
        .lock()
        .map_err(|_| "Pet memory storage lock failed")?;
    let path = path(app, pet_id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("Cannot clear pet memory: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{sanitize, sensitive, PetMemory};
    #[test]
    fn rejects_sensitive_and_invalid_memory() {
        assert!(sensitive("password: hunter2"));
        assert!(sensitive("4242 4242 4242 4242"));
        assert!(!sensitive("喜歡烏龍茶"));
        assert!(sanitize(PetMemory {
            id: "ok".into(),
            category: "other".into(),
            content: "hello".into(),
            created_at: 1,
            updated_at: 1,
            source_conversation_id: None
        })
        .is_err());
    }
}
