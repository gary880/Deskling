use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::PathBuf,
    process::{Command, Stdio},
};

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentProvider {
    Codex,
    ClaudeCode,
}

impl Default for AgentProvider {
    fn default() -> Self {
        Self::Codex
    }
}

impl AgentProvider {
    pub fn label(self) -> &'static str {
        match self {
            Self::Codex => "Codex",
            Self::ClaudeCode => "Claude Code",
        }
    }

    fn binary(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::ClaudeCode => "claude",
        }
    }

    fn login_command(self) -> &'static str {
        match self {
            Self::Codex => "codex login",
            Self::ClaudeCode => "claude auth login",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderStatus {
    pub provider: AgentProvider,
    pub label: &'static str,
    pub installed: bool,
    pub authenticated: bool,
    pub version: Option<String>,
    pub login_command: &'static str,
    pub billing_note: &'static str,
}

#[derive(Debug, Default, PartialEq)]
pub struct ParsedProviderEvent {
    pub session_id: Option<String>,
    pub text_delta: Option<String>,
    pub final_text: Option<String>,
    pub error: Option<String>,
}

fn executable(provider: AgentProvider) -> PathBuf {
    let binary = provider.binary();
    std::env::var_os("PATH")
        .and_then(|paths| {
            std::env::split_paths(&paths)
                .map(|path| path.join(binary))
                .find(|path| path.is_file())
        })
        .or_else(|| {
            [
                format!("/opt/homebrew/bin/{binary}"),
                format!("/usr/local/bin/{binary}"),
            ]
            .into_iter()
            .map(PathBuf::from)
            .find(|path| path.is_file())
        })
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|path| path.join(".local/bin").join(binary))
                .filter(|path| path.is_file())
        })
        .unwrap_or_else(|| PathBuf::from(binary))
}

pub fn command(provider: AgentProvider) -> Command {
    let mut command = Command::new(executable(provider));
    match provider {
        AgentProvider::Codex => {
            command.env_remove("OPENAI_API_KEY");
        }
        AgentProvider::ClaudeCode => {
            for key in [
                "ANTHROPIC_API_KEY",
                "ANTHROPIC_AUTH_TOKEN",
                "ANTHROPIC_BASE_URL",
                "CLAUDE_CODE_OAUTH_TOKEN",
                "CLAUDE_CODE_USE_BEDROCK",
                "CLAUDE_CODE_USE_VERTEX",
                "CLAUDE_CODE_USE_FOUNDRY",
            ] {
                command.env_remove(key);
            }
        }
    }
    command
}

fn version(provider: AgentProvider) -> Option<String> {
    let output = command(provider).arg("--version").output().ok()?;
    output.status.success().then(|| {
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .chars()
            .take(120)
            .collect()
    })
}

fn subscription_authenticated(provider: AgentProvider) -> bool {
    match provider {
        AgentProvider::Codex => command(provider)
            .args(["login", "status"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .ok()
            .filter(|output| output.status.success())
            .is_some_and(|output| {
                let text = format!(
                    "{} {}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                )
                .to_ascii_lowercase();
                text.contains("chatgpt")
            }),
        AgentProvider::ClaudeCode => command(provider)
            .args(["auth", "status"])
            .stderr(Stdio::null())
            .output()
            .ok()
            .filter(|output| output.status.success())
            .and_then(|output| serde_json::from_slice::<Value>(&output.stdout).ok())
            .is_some_and(|value| {
                value.get("loggedIn").and_then(Value::as_bool) == Some(true)
                    && value
                        .get("subscriptionType")
                        .and_then(Value::as_str)
                        .is_some_and(|kind| !kind.trim().is_empty())
            }),
    }
}

pub fn status(provider: AgentProvider) -> AgentProviderStatus {
    let version = version(provider);
    let installed = version.is_some();
    AgentProviderStatus {
        provider,
        label: provider.label(),
        installed,
        authenticated: installed && subscription_authenticated(provider),
        version,
        login_command: provider.login_command(),
        billing_note: match provider {
            AgentProvider::Codex => "使用既有 ChatGPT 訂閱的 Codex 額度，不使用 API key。",
            AgentProvider::ClaudeCode => "claude -p 使用訂閱帳號附帶的 Agent SDK credit；額度用完且未啟用 usage credits 時會停止。",
        },
    }
}

pub fn statuses() -> Vec<AgentProviderStatus> {
    [AgentProvider::Codex, AgentProvider::ClaudeCode]
        .into_iter()
        .map(status)
        .collect()
}

pub fn invocation_arguments(provider: AgentProvider, session_id: Option<&str>) -> Vec<String> {
    match provider {
        AgentProvider::Codex => {
            let mut arguments = vec![
                "--ask-for-approval".into(),
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
                    session_id.into(),
                    "-".into(),
                ]);
            } else {
                arguments.extend(["--json".into(), "--skip-git-repo-check".into(), "-".into()]);
            }
            arguments
        }
        AgentProvider::ClaudeCode => {
            let mut arguments = vec![
                "--print".into(),
                "--input-format".into(),
                "text".into(),
                "--output-format".into(),
                "stream-json".into(),
                "--verbose".into(),
                "--include-partial-messages".into(),
                "--safe-mode".into(),
                "--tools".into(),
                "".into(),
                "--disallowedTools".into(),
                "mcp__*".into(),
                "--permission-mode".into(),
                "dontAsk".into(),
                "--no-chrome".into(),
            ];
            if let Some(session_id) = session_id {
                arguments.extend(["--resume".into(), session_id.into()]);
            }
            arguments
        }
    }
}

pub fn parse_event(provider: AgentProvider, value: &Value) -> ParsedProviderEvent {
    match provider {
        AgentProvider::Codex => ParsedProviderEvent {
            session_id: (value.get("type").and_then(Value::as_str) == Some("thread.started"))
                .then(|| {
                    value
                        .get("thread_id")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .flatten(),
            final_text: (value.get("type").and_then(Value::as_str) == Some("item.completed"))
                .then(|| value.get("item"))
                .flatten()
                .filter(|item| item.get("type").and_then(Value::as_str) == Some("agent_message"))
                .and_then(|item| item.get("text"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            ..ParsedProviderEvent::default()
        },
        AgentProvider::ClaudeCode => {
            let session_id = value
                .get("session_id")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if value.get("type").and_then(Value::as_str) == Some("stream_event") {
                let delta = value.get("event").and_then(|event| event.get("delta"));
                return ParsedProviderEvent {
                    session_id,
                    text_delta: delta
                        .filter(|delta| {
                            delta.get("type").and_then(Value::as_str) == Some("text_delta")
                        })
                        .and_then(|delta| delta.get("text"))
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    ..ParsedProviderEvent::default()
                };
            }
            if value.get("type").and_then(Value::as_str) == Some("result") {
                let is_error = value.get("is_error").and_then(Value::as_bool) == Some(true)
                    || value.get("subtype").and_then(Value::as_str) != Some("success");
                let result = value
                    .get("result")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                return ParsedProviderEvent {
                    session_id,
                    final_text: (!is_error).then_some(result.clone()).flatten(),
                    error: is_error.then_some(result).flatten(),
                    ..ParsedProviderEvent::default()
                };
            }
            ParsedProviderEvent {
                session_id,
                ..ParsedProviderEvent::default()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{command, invocation_arguments, parse_event, AgentProvider};
    use serde_json::json;

    fn removed_environment(provider: AgentProvider, key: &str) -> bool {
        command(provider)
            .get_envs()
            .any(|(name, value)| name == key && value.is_none())
    }

    #[test]
    fn removes_api_credentials_from_provider_processes() {
        assert!(removed_environment(AgentProvider::Codex, "OPENAI_API_KEY"));
        assert!(removed_environment(
            AgentProvider::ClaudeCode,
            "ANTHROPIC_API_KEY"
        ));
        assert!(removed_environment(
            AgentProvider::ClaudeCode,
            "ANTHROPIC_AUTH_TOKEN"
        ));
        assert!(removed_environment(
            AgentProvider::ClaudeCode,
            "ANTHROPIC_BASE_URL"
        ));
    }

    #[test]
    fn keeps_both_providers_non_interactive_and_tool_free() {
        let codex = invocation_arguments(AgentProvider::Codex, None);
        assert!(codex
            .windows(2)
            .any(|pair| pair == ["--sandbox", "read-only"]));
        assert!(codex
            .windows(2)
            .any(|pair| pair == ["--ask-for-approval", "never"]));

        let claude = invocation_arguments(AgentProvider::ClaudeCode, None);
        assert!(claude.contains(&"--print".into()));
        assert!(claude.windows(2).any(|pair| pair == ["--tools", ""]));
        assert!(claude
            .windows(2)
            .any(|pair| pair == ["--disallowedTools", "mcp__*"]));
        assert!(claude.contains(&"--safe-mode".into()));
    }

    #[test]
    fn resumes_provider_specific_sessions() {
        let codex = invocation_arguments(AgentProvider::Codex, Some("thread-1"));
        assert!(codex
            .windows(2)
            .any(|pair| pair == ["--skip-git-repo-check", "thread-1"]));
        let claude = invocation_arguments(AgentProvider::ClaudeCode, Some("session-1"));
        assert!(claude
            .windows(2)
            .any(|pair| pair == ["--resume", "session-1"]));
    }

    #[test]
    fn parses_codex_messages_and_thread_ids() {
        let started = parse_event(
            AgentProvider::Codex,
            &json!({"type":"thread.started","thread_id":"thread-1"}),
        );
        assert_eq!(started.session_id.as_deref(), Some("thread-1"));
        let message = parse_event(
            AgentProvider::Codex,
            &json!({"type":"item.completed","item":{"type":"agent_message","text":"hello"}}),
        );
        assert_eq!(message.final_text.as_deref(), Some("hello"));
    }

    #[test]
    fn parses_claude_stream_deltas_results_and_session_ids() {
        let delta = parse_event(
            AgentProvider::ClaudeCode,
            &json!({
                "type":"stream_event", "session_id":"session-1",
                "event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"你"}}
            }),
        );
        assert_eq!(delta.session_id.as_deref(), Some("session-1"));
        assert_eq!(delta.text_delta.as_deref(), Some("你"));
        let result = parse_event(
            AgentProvider::ClaudeCode,
            &json!({
                "type":"result", "subtype":"success", "is_error":false,
                "session_id":"session-1", "result":"你好"
            }),
        );
        assert_eq!(result.final_text.as_deref(), Some("你好"));
    }
}
