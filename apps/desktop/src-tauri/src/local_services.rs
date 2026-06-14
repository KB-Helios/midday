use std::collections::HashMap;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DesktopRuntimeMode {
    Local,
    Remote,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalServiceConfig {
    pub mode: DesktopRuntimeMode,
    pub dashboard_url: String,
    pub api_url: String,
    pub manage_processes: bool,
}

pub fn resolve_config_from_env(env: &HashMap<String, String>) -> LocalServiceConfig {
    let runtime = env
        .get("MIDDAY_DESKTOP_RUNTIME")
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| "local".to_string());

    if runtime == "remote" {
        return LocalServiceConfig {
            mode: DesktopRuntimeMode::Remote,
            dashboard_url: env
                .get("MIDDAY_REMOTE_APP_URL")
                .cloned()
                .unwrap_or_else(|| "https://app.midday.ai".to_string()),
            api_url: env
                .get("MIDDAY_REMOTE_API_URL")
                .cloned()
                .unwrap_or_else(|| "https://api.midday.ai".to_string()),
            manage_processes: false,
        };
    }

    let manage_processes = env
        .get("MIDDAY_DESKTOP_MANAGE_SERVICES")
        .map(|value| value != "false" && value != "0")
        .unwrap_or(true);

    LocalServiceConfig {
        mode: DesktopRuntimeMode::Local,
        dashboard_url: env
            .get("MIDDAY_DASHBOARD_URL")
            .cloned()
            .unwrap_or_else(|| "http://localhost:3001".to_string()),
        api_url: env
            .get("MIDDAY_API_URL")
            .cloned()
            .unwrap_or_else(|| "http://localhost:3003".to_string()),
        manage_processes,
    }
}

pub fn current_env() -> HashMap<String, String> {
    std::env::vars().collect()
}

pub fn api_health_url(config: &LocalServiceConfig) -> Option<String> {
    match config.mode {
        DesktopRuntimeMode::Local => {
            Some(format!("{}/health", config.api_url.trim_end_matches('/')))
        }
        DesktopRuntimeMode::Remote => None,
    }
}

pub fn dashboard_health_url(config: &LocalServiceConfig) -> Option<String> {
    match config.mode {
        DesktopRuntimeMode::Local => Some(config.dashboard_url.trim_end_matches('/').to_string()),
        DesktopRuntimeMode::Remote => None,
    }
}

#[derive(Debug)]
pub enum LocalServiceError {
    Timeout {
        service: &'static str,
        url: String,
    },
    Request {
        service: &'static str,
        url: String,
        message: String,
    },
}

impl std::fmt::Display for LocalServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LocalServiceError::Timeout { service, url } => {
                write!(f, "{service} did not become ready at {url}")
            }
            LocalServiceError::Request {
                service,
                url,
                message,
            } => write!(f, "{service} health request failed at {url}: {message}"),
        }
    }
}

impl std::error::Error for LocalServiceError {}

fn is_ready(url: &str) -> Result<bool, String> {
    match ureq::get(url).call() {
        Ok(response) => Ok((200..500).contains(&response.status())),
        Err(ureq::Error::Status(status, _)) => Ok((200..500).contains(&status)),
        Err(error) => Err(error.to_string()),
    }
}

pub async fn wait_for_url(
    service: &'static str,
    url: String,
    timeout: Duration,
) -> Result<(), LocalServiceError> {
    let start = Instant::now();
    let mut last_error: Option<String> = None;

    while start.elapsed() < timeout {
        match is_ready(&url) {
            Ok(true) => return Ok(()),
            Ok(false) => {}
            Err(message) => last_error = Some(message),
        }

        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    if let Some(message) = last_error {
        return Err(LocalServiceError::Request {
            service,
            url,
            message,
        });
    }

    Err(LocalServiceError::Timeout { service, url })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    #[test]
    fn defaults_to_local_runtime() {
        let config = resolve_config_from_env(&env(&[]));

        assert_eq!(config.mode, DesktopRuntimeMode::Local);
        assert_eq!(config.dashboard_url, "http://localhost:3001");
        assert_eq!(config.api_url, "http://localhost:3003");
        assert!(config.manage_processes);
    }

    #[test]
    fn allows_external_local_servers_without_process_management() {
        let config = resolve_config_from_env(&env(&[
            ("MIDDAY_DESKTOP_MANAGE_SERVICES", "false"),
            ("MIDDAY_DASHBOARD_URL", "http://localhost:4101"),
            ("MIDDAY_API_URL", "http://localhost:4103"),
        ]));

        assert_eq!(config.mode, DesktopRuntimeMode::Local);
        assert_eq!(config.dashboard_url, "http://localhost:4101");
        assert_eq!(config.api_url, "http://localhost:4103");
        assert!(!config.manage_processes);
    }

    #[test]
    fn keeps_remote_mode_available_for_diagnostics() {
        let config = resolve_config_from_env(&env(&[
            ("MIDDAY_DESKTOP_RUNTIME", "remote"),
            ("MIDDAY_REMOTE_APP_URL", "https://app.midday.ai"),
        ]));

        assert_eq!(config.mode, DesktopRuntimeMode::Remote);
        assert_eq!(config.dashboard_url, "https://app.midday.ai");
        assert_eq!(config.api_url, "https://api.midday.ai");
        assert!(!config.manage_processes);
    }

    #[test]
    fn builds_health_urls_for_local_services() {
        let config = resolve_config_from_env(&env(&[]));

        assert_eq!(
            api_health_url(&config),
            Some("http://localhost:3003/health".to_string())
        );
        assert_eq!(
            dashboard_health_url(&config),
            Some("http://localhost:3001".to_string())
        );
    }

    #[test]
    fn remote_runtime_has_no_local_health_urls() {
        let config = resolve_config_from_env(&env(&[
            ("MIDDAY_DESKTOP_RUNTIME", "remote"),
            ("MIDDAY_REMOTE_APP_URL", "https://app.midday.ai"),
        ]));

        assert_eq!(api_health_url(&config), None);
        assert_eq!(dashboard_health_url(&config), None);
    }
}
