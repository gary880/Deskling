use serde_json::{Map, Value};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const MAX_FILE_BYTES: u64 = 16 * 1024;
const MAX_CUSTOM_CHARS: usize = 2_000;
const MAX_STYLE_CHARS: usize = 500;

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

fn settings_path(app: &AppHandle, pet_id: &str) -> Result<PathBuf, String> {
    if !valid_id(pet_id) {
        return Err("Invalid pet id".into());
    }
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("pet-settings")
        .join(format!("{pet_id}.json")))
}

fn clean_text(value: Option<&Value>, limit: usize) -> Option<Value> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| Value::String(s.chars().take(limit).collect()))
}

pub fn sanitize(value: &Value) -> Value {
    let Some(input) = value.as_object() else {
        return Value::Object(Map::new());
    };
    let mut output = Map::new();
    if let Some(v) = clean_text(input.get("nickname"), 80) {
        output.insert("nickname".into(), v);
    }
    if let Some(v) = clean_text(input.get("speakingStyle"), MAX_STYLE_CHARS) {
        output.insert("speakingStyle".into(), v);
    }
    if let Some(v) = clean_text(input.get("customInstructions"), MAX_CUSTOM_CHARS) {
        output.insert("customInstructions".into(), v);
    }
    if let Some(language) = input
        .get("preferredLanguage")
        .and_then(Value::as_str)
        .filter(|v| matches!(*v, "auto" | "zh-TW" | "en" | "ja"))
    {
        output.insert("preferredLanguage".into(), Value::String(language.into()));
    }
    if let Some(traits) = input.get("traits").and_then(Value::as_object) {
        let mut clean = Map::new();
        for key in ["warmth", "energy", "humor", "directness", "verbosity"] {
            if let Some(number) = traits.get(key).and_then(Value::as_f64) {
                clean.insert(
                    key.into(),
                    Value::from(number.clamp(0.0, 100.0).round() as u64),
                );
            }
        }
        if !clean.is_empty() {
            output.insert("traits".into(), Value::Object(clean));
        }
    }
    Value::Object(output)
}

pub fn load(app: &AppHandle, pet_id: &str) -> Result<Value, String> {
    let path = settings_path(app, pet_id)?;
    if !path.exists() {
        return Ok(Value::Object(Map::new()));
    }
    let metadata = fs::metadata(&path).map_err(|e| format!("Cannot read pet settings: {e}"))?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err("Pet settings file is too large".into());
    }
    let value = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Invalid pet settings JSON: {e}"))?;
    Ok(sanitize(&value))
}

pub fn save(app: &AppHandle, pet_id: &str, settings: Value) -> Result<Value, String> {
    let path = settings_path(app, pet_id)?;
    let value = sanitize(&settings);
    let parent = path.parent().ok_or("Invalid settings path")?;
    fs::create_dir_all(parent).map_err(|e| format!("Cannot create pet settings directory: {e}"))?;
    let temp = path.with_extension("json.tmp");
    fs::write(
        &temp,
        serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Cannot save pet settings: {e}"))?;
    fs::rename(temp, path).map_err(|e| format!("Cannot replace pet settings: {e}"))?;
    Ok(value)
}

pub fn reset(app: &AppHandle, pet_id: &str) -> Result<(), String> {
    let path = settings_path(app, pet_id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("Cannot reset pet settings: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::sanitize;
    use serde_json::json;

    #[test]
    fn sanitizes_untrusted_settings() {
        let value = sanitize(
            &json!({"traits":{"warmth":400,"bad":20},"preferredLanguage":"xx","customInstructions":" ok "}),
        );
        assert_eq!(value["traits"]["warmth"], 100);
        assert!(value.get("preferredLanguage").is_none());
        assert_eq!(value["customInstructions"], "ok");
    }
}
