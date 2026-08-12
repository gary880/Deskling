use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_CONTENT_CHARS: usize = 8_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationEntry {
    id: String,
    role: String,
    content: String,
    source: String,
    created_at: u64,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

fn history_path(app: &AppHandle, pet_id: &str) -> Result<PathBuf, String> {
    if !valid_id(pet_id) {
        return Err("Invalid pet id".into());
    }
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("conversation-history")
        .join(format!("{pet_id}.json")))
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn sanitize(entry: ConversationEntry) -> Result<ConversationEntry, String> {
    if entry.id.is_empty() || entry.id.len() > 120 {
        return Err("Invalid history entry id".into());
    }
    if !matches!(entry.role.as_str(), "user" | "pet") {
        return Err("Invalid history role".into());
    }
    if !matches!(entry.source.as_str(), "direct" | "proactive") {
        return Err("Invalid history source".into());
    }
    let content = entry
        .content
        .trim()
        .chars()
        .take(MAX_CONTENT_CHARS)
        .collect::<String>();
    if content.is_empty() {
        return Err("History content is empty".into());
    }
    Ok(ConversationEntry {
        content,
        created_at: entry.created_at.min(now_millis().saturating_add(60_000)),
        ..entry
    })
}

fn read(path: &PathBuf) -> Result<Vec<ConversationEntry>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_FILE_BYTES {
        return Err("Conversation history file is too large".into());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Invalid conversation history: {e}"))
}

fn prune(
    mut entries: Vec<ConversationEntry>,
    retention_days: u32,
    max_entries: usize,
) -> Vec<ConversationEntry> {
    let cutoff = now_millis().saturating_sub(u64::from(retention_days.clamp(1, 365)) * 86_400_000);
    entries.retain(|entry| entry.created_at >= cutoff);
    let keep = max_entries.clamp(20, 1_000);
    if entries.len() > keep {
        entries.drain(..entries.len() - keep);
    }
    entries
}

fn write(path: &PathBuf, entries: &[ConversationEntry]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid history path")?;
    fs::create_dir_all(parent).map_err(|e| format!("Cannot create history directory: {e}"))?;
    let temp = path.with_extension("json.tmp");
    fs::write(
        &temp,
        serde_json::to_vec_pretty(entries).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Cannot save history: {e}"))?;
    fs::rename(temp, path).map_err(|e| format!("Cannot replace history: {e}"))
}

pub fn load(
    app: &AppHandle,
    pet_id: &str,
    retention_days: u32,
    max_entries: usize,
) -> Result<Vec<ConversationEntry>, String> {
    let path = history_path(app, pet_id)?;
    let entries = prune(
        read(&path)?
            .into_iter()
            .filter_map(|entry| sanitize(entry).ok())
            .collect(),
        retention_days,
        max_entries,
    );
    if path.exists() {
        write(&path, &entries)?;
    }
    Ok(entries)
}

pub fn append(
    app: &AppHandle,
    pet_id: &str,
    entry: ConversationEntry,
    retention_days: u32,
    max_entries: usize,
) -> Result<Vec<ConversationEntry>, String> {
    let path = history_path(app, pet_id)?;
    let mut entries = read(&path)?;
    let entry = sanitize(entry)?;
    if !entries.iter().any(|item| item.id == entry.id) {
        entries.push(entry);
    }
    let entries = prune(entries, retention_days, max_entries);
    write(&path, &entries)?;
    Ok(entries)
}

pub fn clear(app: &AppHandle, pet_id: &str) -> Result<(), String> {
    let path = history_path(app, pet_id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("Cannot clear history: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{prune, sanitize, ConversationEntry};
    #[test]
    fn rejects_invalid_roles_and_limits_content() {
        let entry = ConversationEntry {
            id: "1".into(),
            role: "system".into(),
            content: "x".into(),
            source: "direct".into(),
            created_at: 1,
        };
        assert!(sanitize(entry).is_err());
    }
    #[test]
    fn keeps_only_the_newest_configured_entries() {
        let now = super::now_millis();
        let entries = (0..30)
            .map(|i| ConversationEntry {
                id: i.to_string(),
                role: "user".into(),
                content: "x".into(),
                source: "direct".into(),
                created_at: now,
            })
            .collect();
        assert_eq!(prune(entries, 30, 20).len(), 20);
    }
}
