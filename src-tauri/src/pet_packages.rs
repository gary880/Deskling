use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    fs::{self, File},
    io::Write,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use zip::ZipArchive;

const MAX_ZIP_SIZE: u64 = 25 * 1024 * 1024;
const MAX_UNPACKED_SIZE: u64 = 100 * 1024 * 1024;
const MAX_FILES: usize = 100;
const BUNDLED_IDS: [&str; 2] = ["mochi", "bella"];
pub const CATALOG_CHANGED_EVENT: &str = "deskling-pet-catalog-changed";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPet {
    pub id: String,
    pub base_dir: String,
    pub manifest: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestRef {
    schema_version: u64,
    id: String,
    name: String,
    author: String,
    renderer: RendererRef,
    animations: Value,
    anchors: Value,
    hitboxes: Value,
    #[serde(default)]
    sounds: Option<Value>,
    #[serde(default)]
    personality: Option<Value>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RendererRef {
    #[serde(rename = "type")]
    kind: String,
    asset: String,
    frame_width: u64,
    frame_height: u64,
}

fn pets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("pets"))
        .map_err(|e| format!("Cannot locate App Data: {e}"))
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && (id.as_bytes()[0].is_ascii_lowercase() || id.as_bytes()[0].is_ascii_digit())
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
fn safe_relative_path(value: &str) -> Option<PathBuf> {
    let path = Path::new(value);
    if value.is_empty()
        || value.contains('\\')
        || value.contains(':')
        || path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return None;
    }
    Some(path.to_path_buf())
}
fn extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|v| v.to_str())
        .map(str::to_ascii_lowercase)
}
fn allowed_file(path: &Path) -> bool {
    path == Path::new("deskling.json")
        || matches!(
            extension(path).as_deref(),
            Some("webp" | "wav" | "mp3" | "ogg")
        )
}
fn is_macos_metadata(path: &Path) -> bool {
    path.components()
        .next()
        .is_some_and(|component| component.as_os_str() == "__MACOSX")
        || path
            .file_name()
            .is_some_and(|name| name == ".DS_Store" || name.to_string_lossy().starts_with("._"))
}
fn number(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64)
}
fn positive_integer(value: Option<&Value>) -> Option<u64> {
    value.and_then(Value::as_u64).filter(|value| *value > 0)
}
fn validate_geometry(
    manifest: &ManifestRef,
    image_width: u64,
    image_height: u64,
) -> Result<(), String> {
    let frame_width = manifest.renderer.frame_width;
    let frame_height = manifest.renderer.frame_height;
    if image_width % frame_width != 0 || image_height % frame_height != 0 {
        return Err(
            "Invalid deskling.json: spritesheet dimensions must be divisible by frame dimensions"
                .into(),
        );
    }
    let columns = image_width / frame_width;
    let rows = image_height / frame_height;
    for (id, definition) in manifest.animations.as_object().expect("checked animations") {
        let definition = definition
            .as_object()
            .ok_or_else(|| format!("Invalid deskling.json: animation {id} must be an object"))?;
        let row = definition
            .get("row")
            .and_then(Value::as_u64)
            .ok_or_else(|| {
                format!("Invalid deskling.json: animation {id} row must be a non-negative integer")
            })?;
        let frames = positive_integer(definition.get("frames")).ok_or_else(|| {
            format!("Invalid deskling.json: animation {id} frames must be positive")
        })?;
        let fps = number(definition.get("fps"))
            .ok_or_else(|| format!("Invalid deskling.json: animation {id} fps must be a number"))?;
        if row >= rows || frames > columns {
            return Err(format!(
                "Invalid deskling.json: animation {id} is outside the spritesheet"
            ));
        }
        if !(fps > 0.0 && fps <= 60.0) {
            return Err(format!(
                "Invalid deskling.json: animation {id} fps must be between 0 and 60"
            ));
        }
        if !definition.get("loop").is_some_and(Value::is_boolean) {
            return Err(format!(
                "Invalid deskling.json: animation {id} loop must be boolean"
            ));
        }
    }
    for name in ["feet", "head", "speechBubble"] {
        let point = manifest
            .anchors
            .get(name)
            .and_then(Value::as_array)
            .ok_or_else(|| format!("Invalid deskling.json: anchor {name} must be a point"))?;
        let (Some(x), Some(y)) = (number(point.first()), number(point.get(1))) else {
            return Err(format!(
                "Invalid deskling.json: anchor {name} must contain two numbers"
            ));
        };
        if point.len() != 2
            || x < 0.0
            || y < 0.0
            || x > frame_width as f64
            || y > frame_height as f64
        {
            return Err(format!(
                "Invalid deskling.json: anchor {name} must be inside the frame"
            ));
        }
    }
    for name in ["body", "head"] {
        let rect = manifest
            .hitboxes
            .get(name)
            .and_then(Value::as_object)
            .ok_or_else(|| format!("Invalid deskling.json: hitbox {name} must be an object"))?;
        let (Some(x), Some(y), Some(width), Some(height)) = (
            number(rect.get("x")),
            number(rect.get("y")),
            number(rect.get("width")),
            number(rect.get("height")),
        ) else {
            return Err(format!(
                "Invalid deskling.json: hitbox {name} must contain numeric x, y, width, height"
            ));
        };
        if x < 0.0
            || y < 0.0
            || width <= 0.0
            || height <= 0.0
            || x + width > frame_width as f64
            || y + height > frame_height as f64
        {
            return Err(format!(
                "Invalid deskling.json: hitbox {name} must be inside the frame"
            ));
        }
    }
    Ok(())
}
fn validate_manifest(raw: &Value, root: &Path) -> Result<String, String> {
    let manifest: ManifestRef =
        serde_json::from_value(raw.clone()).map_err(|e| format!("Invalid deskling.json: {e}"))?;
    if manifest.schema_version != 1 {
        return Err("Invalid deskling.json: schemaVersion must be 1".into());
    }
    if !valid_id(&manifest.id) {
        return Err(
            "Invalid deskling.json: id must be 1-64 lowercase letters, numbers, or hyphens".into(),
        );
    }
    if manifest.name.trim().is_empty() || manifest.author.trim().is_empty() {
        return Err("Invalid deskling.json: name and author are required".into());
    }
    if manifest.renderer.kind != "sprite" {
        return Err("Invalid deskling.json: renderer.type must be sprite".into());
    }
    if manifest.renderer.frame_width == 0 || manifest.renderer.frame_height == 0 {
        return Err("Invalid deskling.json: frame dimensions must be positive".into());
    }
    if !matches!(manifest.animations.as_object(), Some(v) if !v.is_empty())
        || !manifest.anchors.is_object()
        || !manifest.hitboxes.is_object()
    {
        return Err(
            "Invalid deskling.json: animations, anchors, and hitboxes must be non-empty objects"
                .into(),
        );
    }
    if let Some(personality) = &manifest.personality {
        let object = personality
            .as_object()
            .ok_or_else(|| "Invalid deskling.json: personality must be an object".to_string())?;
        if let Some(traits) = object.get("traits") {
            let traits = traits.as_object().ok_or_else(|| {
                "Invalid deskling.json: personality.traits must be an object".to_string()
            })?;
            for key in ["warmth", "energy", "humor", "directness", "verbosity"] {
                if let Some(value) = traits.get(key) {
                    let number = value.as_f64().ok_or_else(|| {
                        format!("Invalid deskling.json: personality.traits.{key} must be a number")
                    })?;
                    if !(0.0..=100.0).contains(&number) {
                        return Err(format!("Invalid deskling.json: personality.traits.{key} must be between 0 and 100"));
                    }
                }
            }
        }
        if let Some(language) = object.get("preferredLanguage").and_then(Value::as_str) {
            if !matches!(language, "auto" | "zh-TW" | "en" | "ja") {
                return Err(
                    "Invalid deskling.json: personality.preferredLanguage is invalid".into(),
                );
            }
        }
        for (key, limit) in [("speakingStyle", 500), ("customInstructions", 2_000)] {
            if let Some(value) = object.get(key) {
                let text = value.as_str().ok_or_else(|| {
                    format!("Invalid deskling.json: personality.{key} must be a string")
                })?;
                if text.chars().count() > limit {
                    return Err(format!(
                        "Invalid deskling.json: personality.{key} is too long"
                    ));
                }
            }
        }
    }
    let asset = safe_relative_path(&manifest.renderer.asset).ok_or_else(|| {
        "Invalid deskling.json: renderer.asset must be a safe relative path".to_string()
    })?;
    if extension(&asset).as_deref() != Some("webp") {
        return Err("Invalid deskling.json: renderer.asset must be a WebP file".into());
    }
    if !root.join(&asset).is_file() {
        return Err(format!(
            "Invalid deskling.json: referenced asset does not exist: {}",
            manifest.renderer.asset
        ));
    }
    let (image_width, image_height) = image::image_dimensions(root.join(&asset))
        .map_err(|error| format!("Invalid WebP spritesheet: {error}"))?;
    validate_geometry(&manifest, u64::from(image_width), u64::from(image_height))?;
    if let Some(sounds) = manifest.sounds {
        for value in sounds
            .as_object()
            .ok_or_else(|| "Invalid deskling.json: sounds must be an object".to_string())?
            .values()
        {
            let reference = value.as_str().ok_or_else(|| {
                "Invalid deskling.json: sound references must be strings".to_string()
            })?;
            let path = safe_relative_path(reference)
                .ok_or_else(|| format!("Invalid deskling.json: unsafe sound path: {reference}"))?;
            if !matches!(extension(&path).as_deref(), Some("wav" | "mp3" | "ogg")) {
                return Err(format!(
                    "Invalid deskling.json: unsupported sound format: {reference}"
                ));
            }
            if !root.join(path).is_file() {
                return Err(format!(
                    "Invalid deskling.json: referenced sound does not exist: {reference}"
                ));
            }
        }
    }
    Ok(manifest.id)
}
fn read_manifest(root: &Path) -> Result<(String, Value), String> {
    let bytes = fs::read(root.join("deskling.json"))
        .map_err(|_| "deskling.json must exist at the ZIP root".to_string())?;
    let raw =
        serde_json::from_slice(&bytes).map_err(|e| format!("Invalid deskling.json JSON: {e}"))?;
    let id = validate_manifest(&raw, root)?;
    Ok((id, raw))
}
fn unique_path(pets: &Path, label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    pets.join(format!(".{label}-{}-{nonce}", std::process::id()))
}
fn extract_zip(zip_path: &Path, staging: &Path) -> Result<(), String> {
    let metadata = fs::metadata(zip_path).map_err(|e| format!("Cannot read ZIP: {e}"))?;
    if metadata.len() > MAX_ZIP_SIZE {
        return Err("ZIP exceeds the 25 MB limit".into());
    }
    let mut archive =
        ZipArchive::new(File::open(zip_path).map_err(|e| format!("Cannot open ZIP: {e}"))?)
            .map_err(|e| format!("Invalid ZIP: {e}"))?;
    if archive.len() > MAX_FILES {
        return Err(format!("ZIP contains more than {MAX_FILES} entries"));
    }
    let mut total = 0_u64;
    let mut paths = HashSet::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("Invalid ZIP entry: {e}"))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| format!("Unsafe ZIP path: {}", entry.name()))?
            .to_path_buf();
        if safe_relative_path(entry.name().trim_end_matches('/')).is_none()
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(format!("Unsafe or symlink ZIP path: {}", entry.name()));
        }
        if !paths.insert(enclosed.clone()) {
            return Err(format!("Duplicate ZIP path: {}", entry.name()));
        }
        if is_macos_metadata(&enclosed) {
            continue;
        }
        if entry.is_dir() {
            fs::create_dir_all(staging.join(enclosed)).map_err(|e| e.to_string())?;
            continue;
        }
        if enclosed
            .file_name()
            .is_some_and(|name| name == "deskling.json")
            && enclosed != Path::new("deskling.json")
        {
            return Err(format!(
                "Invalid package layout: deskling.json must be at the ZIP root, not {}. Zip the contents of the pet folder instead of the folder itself.",
                entry.name()
            ));
        }
        if !allowed_file(&enclosed) {
            return Err(format!("Unsupported file in package: {}", entry.name()));
        }
        total = total
            .checked_add(entry.size())
            .ok_or_else(|| "Unpacked size overflow".to_string())?;
        if total > MAX_UNPACKED_SIZE {
            return Err("Unpacked package exceeds the 100 MB limit".into());
        }
        let output = staging.join(enclosed);
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Cannot create staging directory: {e}"))?;
        }
        let mut target = File::create(output).map_err(|e| format!("Cannot extract ZIP: {e}"))?;
        let expected = entry.size();
        let copied = std::io::copy(&mut entry, &mut target)
            .map_err(|e| format!("Cannot extract ZIP: {e}"))?;
        if copied != expected {
            return Err("ZIP entry size did not match its metadata".into());
        }
        target
            .flush()
            .map_err(|e| format!("Cannot extract ZIP: {e}"))?;
    }
    Ok(())
}
pub fn import_pet_zip(
    app: &AppHandle,
    zip_path: &Path,
    replace: bool,
) -> Result<InstalledPet, String> {
    let pets = pets_dir(app)?;
    fs::create_dir_all(&pets).map_err(|e| format!("Cannot create pets directory: {e}"))?;
    let staging = unique_path(&pets, "install");
    fs::create_dir(&staging).map_err(|e| format!("Cannot create staging directory: {e}"))?;
    let result = (|| {
        extract_zip(zip_path, &staging)?;
        let (id, manifest) = read_manifest(&staging)?;
        if BUNDLED_IDS.contains(&id.as_str()) {
            return Err(format!(
                "{id} is bundled with Deskling and cannot be replaced"
            ));
        }
        let destination = pets.join(&id);
        if destination.exists() && !replace {
            return Err(format!("PET_ID_CONFLICT:{id}"));
        }
        let backup = unique_path(&pets, &format!("backup-{id}"));
        if destination.exists() {
            fs::rename(&destination, &backup)
                .map_err(|e| format!("Cannot prepare replacement: {e}"))?;
        }
        if let Err(error) = fs::rename(&staging, &destination) {
            if backup.exists() {
                let _ = fs::rename(&backup, &destination);
            }
            return Err(format!("Cannot install package atomically: {error}"));
        }
        if backup.exists() {
            fs::remove_dir_all(backup)
                .map_err(|e| format!("Installed, but old package cleanup failed: {e}"))?;
        }
        Ok(InstalledPet {
            id,
            base_dir: destination.to_string_lossy().into_owned(),
            manifest,
        })
    })();
    if staging.exists() {
        let _ = fs::remove_dir_all(staging);
    }
    if result.is_ok() {
        let _ = app.emit(CATALOG_CHANGED_EVENT, ());
    }
    result
}
pub fn list_installed_pets(app: &AppHandle) -> Result<Vec<InstalledPet>, String> {
    let pets = pets_dir(app)?;
    if !pets.exists() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for entry in fs::read_dir(pets).map_err(|e| format!("Cannot list installed pets: {e}"))? {
        let entry = entry.map_err(|e| format!("Cannot list installed pets: {e}"))?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir()
            || entry.file_name().to_string_lossy().starts_with('.')
        {
            continue;
        }
        if let Ok((id, manifest)) = read_manifest(&entry.path()) {
            if id == entry.file_name().to_string_lossy() && !BUNDLED_IDS.contains(&id.as_str()) {
                result.push(InstalledPet {
                    id,
                    base_dir: entry.path().to_string_lossy().into_owned(),
                    manifest,
                });
            }
        }
    }
    result.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(result)
}
pub fn remove_installed_pet(app: &AppHandle, id: &str) -> Result<(), String> {
    if !valid_id(id) || BUNDLED_IDS.contains(&id) {
        return Err("Bundled pets cannot be removed".into());
    }
    let path = pets_dir(app)?.join(id);
    if !path.is_dir() {
        return Err(format!("Installed pet not found: {id}"));
    }
    fs::remove_dir_all(path).map_err(|e| format!("Cannot remove installed pet: {e}"))?;
    let _ = app.emit(CATALOG_CHANGED_EVENT, ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal_absolute_and_windows_paths() {
        for path in [
            "../escape.webp",
            "/tmp/escape.webp",
            "C:/escape.webp",
            "sounds\\escape.mp3",
        ] {
            assert!(safe_relative_path(path).is_none(), "accepted {path}");
        }
        assert_eq!(
            safe_relative_path("sounds/hello.ogg"),
            Some(PathBuf::from("sounds/hello.ogg"))
        );
    }

    #[test]
    fn restricts_ids_and_asset_extensions() {
        assert!(valid_id("fox-2"));
        for id in ["Fox", "-fox", "fox_cat", "../fox", ""] {
            assert!(!valid_id(id), "accepted {id}");
        }
        assert!(allowed_file(Path::new("spritesheet.webp")));
        assert!(allowed_file(Path::new("sounds/hello.mp3")));
        assert!(!allowed_file(Path::new("script.js")));
        assert!(!allowed_file(Path::new("image.png")));
    }

    #[test]
    fn recognizes_only_known_macos_metadata() {
        for path in [
            "__MACOSX/._yuexinmiao",
            "__MACOSX/yuexinmiao/._pet.json",
            ".DS_Store",
            "sounds/._hello.mp3",
        ] {
            assert!(is_macos_metadata(Path::new(path)), "did not ignore {path}");
        }
        for path in ["deskling.json", "assets/.hidden.webp", "MACOSX/file.webp"] {
            assert!(!is_macos_metadata(Path::new(path)), "ignored {path}");
        }
    }

    #[test]
    fn only_root_manifest_is_an_allowed_package_file() {
        assert!(allowed_file(Path::new("deskling.json")));
        assert!(!allowed_file(Path::new("yuexinmiao/deskling.json")));
    }
}
