use serde::Serialize;
use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager};

pub const EVENT_CONVERSATION: &str = "deskling-conversation-event";
static NEXT_REQUEST_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

#[derive(Default)]
pub struct AgentRuntimeState {
    active: Arc<Mutex<Option<ActiveAgent>>>,
    session_id: Arc<Mutex<Option<String>>>,
}

impl Drop for AgentRuntimeState {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            if let Some(active) = active.take() {
                if let Ok(mut child) = active.child.lock() {
                    let _ = child.kill();
                }
            }
        }
    }
}

struct ActiveAgent {
    request_id: String,
    child: Arc<Mutex<Child>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationEvent {
    pub request_id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

fn emit(app: &AppHandle, request_id: &str, kind: &str, text: Option<String>) {
    let event = ConversationEvent {
        request_id: request_id.into(),
        kind: kind.into(),
        text,
    };
    let _ = app.emit_to("pet", EVENT_CONVERSATION, event.clone());
    let _ = app.emit_to("control", EVENT_CONVERSATION, event);
}

fn codex_command() -> String {
    std::env::var_os("PATH")
        .and_then(|paths| {
            std::env::split_paths(&paths)
                .map(|path| path.join("codex"))
                .find(|path| path.is_file())
        })
        .or_else(|| {
            ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"]
                .into_iter()
                .map(std::path::PathBuf::from)
                .find(|path| path.is_file())
        })
        .or_else(|| {
            std::env::var_os("HOME")
                .map(std::path::PathBuf::from)
                .map(|path| path.join(".local/bin/codex"))
                .filter(|path| path.is_file())
        })
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "codex".into())
}

fn event_text(value: &Value) -> Option<String> {
    if value.get("type").and_then(Value::as_str) != Some("item.completed") {
        return None;
    }
    let item = value.get("item")?;
    if item.get("type").and_then(Value::as_str) != Some("agent_message") {
        return None;
    }
    item.get("text").and_then(Value::as_str).map(str::to_owned)
}

fn event_thread_id(value: &Value) -> Option<String> {
    (value.get("type").and_then(Value::as_str) == Some("thread.started"))
        .then(|| {
            value
                .get("thread_id")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .flatten()
}

pub fn start(
    app: AppHandle,
    state: &AgentRuntimeState,
    message: String,
    pet_name: String,
) -> Result<String, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("請先輸入想問 Pet 的內容".into());
    }
    if message.chars().count() > 8_000 {
        return Err("訊息超過 8,000 字元限制".into());
    }
    let mut active = state
        .active
        .lock()
        .map_err(|_| "Agent runtime lock failed")?;
    if active.is_some() {
        return Err("Pet 正在處理上一個請求，請先停止或等待完成".into());
    }

    let request_id = format!(
        "pet-{}",
        NEXT_REQUEST_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    );
    let workspace = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("agent-workspace");
    std::fs::create_dir_all(&workspace)
        .map_err(|error| format!("Cannot create private Agent workspace: {error}"))?;
    let prompt = format!(
        "You are {pet_name}, a friendly desktop pet. Answer directly and concisely in the user's language. This response belongs to a pet conversation, not a terminal or coding UI. Do not claim to have read files unless their contents were provided.\n\nUser: {message}"
    );
    let session_id = state
        .session_id
        .lock()
        .ok()
        .and_then(|session| session.clone());
    let mut arguments = vec![
        "--ask-for-approval".to_string(),
        "never".into(),
        "--sandbox".into(),
        "read-only".into(),
        "exec".into(),
    ];
    if let Some(session_id) = session_id {
        arguments.extend([
            "resume".into(),
            "--json".into(),
            "--skip-git-repo-check".into(),
            session_id,
            "-".into(),
        ]);
    } else {
        arguments.extend(["--json".into(), "--skip-git-repo-check".into(), "-".into()]);
    }
    let mut child = Command::new(codex_command())
        .args(arguments)
        .current_dir(workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("無法啟動 Codex。請確認已安裝並登入 Codex CLI：{error}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| "Cannot open Codex input".to_string())?
        .write_all(prompt.as_bytes())
        .map_err(|error| format!("Cannot send message to Codex: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Cannot read Codex output".to_string())?;
    let child = Arc::new(Mutex::new(child));
    *active = Some(ActiveAgent {
        request_id: request_id.clone(),
        child: child.clone(),
    });
    drop(active);

    emit(&app, &request_id, "started", None);
    let thread_request_id = request_id.clone();
    let active_state = state.active.clone();
    let session_state = state.session_id.clone();
    std::thread::spawn(move || {
        let mut response = String::new();
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if let Some(thread_id) = event_thread_id(&value) {
                if let Ok(mut session_id) = session_state.lock() {
                    *session_id = Some(thread_id);
                }
            }
            if let Some(text) = event_text(&value) {
                response = text;
                emit(&app, &thread_request_id, "text", Some(response.clone()));
            }
        }
        let status = child.lock().ok().and_then(|mut child| child.wait().ok());
        let was_active = active_state.lock().ok().is_some_and(|mut active| {
            if active
                .as_ref()
                .is_some_and(|item| item.request_id == thread_request_id)
            {
                *active = None;
                true
            } else {
                false
            }
        });
        if !was_active {
            return;
        }
        if status.is_some_and(|status| status.success()) && !response.is_empty() {
            emit(&app, &thread_request_id, "completed", None);
        } else {
            emit(
                &app,
                &thread_request_id,
                "error",
                Some("Codex 無法完成這次回應，請確認登入狀態或稍後重試。".into()),
            );
        }
    });
    Ok(request_id)
}

pub fn stop(state: &AgentRuntimeState) -> Result<(), String> {
    let active = state
        .active
        .lock()
        .map_err(|_| "Agent runtime lock failed")?
        .take();
    if let Some(active) = active {
        active
            .child
            .lock()
            .map_err(|_| "Agent process lock failed")?
            .kill()
            .map_err(|error| format!("Cannot stop Codex: {error}"))?;
    }
    Ok(())
}

pub fn reset(state: &AgentRuntimeState) -> Result<(), String> {
    stop(state)?;
    *state
        .session_id
        .lock()
        .map_err(|_| "Agent session lock failed")? = None;
    Ok(())
}

pub fn available() -> bool {
    let command = codex_command();
    Command::new(command)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

#[cfg(test)]
mod tests {
    use super::{event_text, event_thread_id};
    use serde_json::json;

    #[test]
    fn extracts_only_completed_agent_messages() {
        assert_eq!(
            event_text(
                &json!({"type":"item.completed","item":{"type":"agent_message","text":"hello"}})
            )
            .as_deref(),
            Some("hello")
        );
        assert_eq!(
            event_text(
                &json!({"type":"item.completed","item":{"type":"command_execution","text":"secret"}})
            ),
            None
        );
    }

    #[test]
    fn extracts_thread_ids_for_follow_up_turns() {
        assert_eq!(
            event_thread_id(&json!({"type":"thread.started","thread_id":"thread-1"})).as_deref(),
            Some("thread-1")
        );
        assert_eq!(event_thread_id(&json!({"type":"turn.started"})), None);
    }
}
