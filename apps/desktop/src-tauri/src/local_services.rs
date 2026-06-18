use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
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
        .unwrap_or(cfg!(debug_assertions));

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

pub fn repo_root_from_manifest() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .and_then(|path| path.parent())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
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
    match ureq::get(url).timeout(Duration::from_secs(2)).call() {
        Ok(response) => Ok((200..400).contains(&response.status())),
        Err(ureq::Error::Status(status, _)) => Ok((200..400).contains(&status)),
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceCommand {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

fn port_from_url(url: &str, fallback: &str) -> String {
    url.rsplit(':')
        .next()
        .and_then(|part| part.split('/').next())
        .filter(|part| part.chars().all(|ch| ch.is_ascii_digit()))
        .unwrap_or(fallback)
        .to_string()
}

fn local_runtime_env() -> Vec<(String, String)> {
    let mut env = vec![
        ("MIDDAY_DESKTOP_RUNTIME".to_string(), "local".to_string()),
        ("MIDDAY_LOCAL_FIRST".to_string(), "true".to_string()),
    ];

    if let Ok(file_key_secret) = std::env::var("FILE_KEY_SECRET") {
        env.push(("FILE_KEY_SECRET".to_string(), file_key_secret));
    }

    env
}

pub fn dashboard_dev_command(config: &LocalServiceConfig) -> ServiceCommand {
    let mut env = local_runtime_env();
    env.extend([
        (
            "NEXT_PUBLIC_MIDDAY_DESKTOP_RUNTIME".to_string(),
            "local".to_string(),
        ),
        (
            "NEXT_PUBLIC_MIDDAY_LOCAL_FIRST".to_string(),
            "true".to_string(),
        ),
        ("NEXT_PUBLIC_API_URL".to_string(), config.api_url.clone()),
        ("API_INTERNAL_URL".to_string(), config.api_url.clone()),
    ]);

    ServiceCommand {
        program: "bun".to_string(),
        args: vec!["run".to_string(), "dev:dashboard".to_string()],
        env,
    }
}

pub fn api_dev_command(config: &LocalServiceConfig) -> ServiceCommand {
    let mut env = local_runtime_env();
    env.extend([
        ("PORT".to_string(), port_from_url(&config.api_url, "3003")),
        (
            "ALLOWED_API_ORIGINS".to_string(),
            config.dashboard_url.clone(),
        ),
    ]);

    ServiceCommand {
        program: "bun".to_string(),
        args: vec!["run".to_string(), "dev:api".to_string()],
        env,
    }
}

pub struct LocalServiceManager {
    config: LocalServiceConfig,
    children: Vec<Child>,
}

impl LocalServiceManager {
    pub fn new(config: LocalServiceConfig) -> Self {
        Self {
            config,
            children: Vec::new(),
        }
    }

    pub fn dashboard_url(&self) -> &str {
        &self.config.dashboard_url
    }

    pub fn config(&self) -> &LocalServiceConfig {
        &self.config
    }

    pub fn start_dev_services(&mut self, repo_root: PathBuf) -> Result<(), String> {
        if self.config.mode == DesktopRuntimeMode::Remote || !self.config.manage_processes {
            return Ok(());
        }

        let api_child = spawn_service(
            repo_root.clone(),
            api_dev_command(&self.config),
        )?;

        let dashboard_child = match spawn_service(
            repo_root,
            dashboard_dev_command(&self.config),
        ) {
            Ok(child) => child,
            Err(e) => {
                let _ = api_child.kill();
                return Err(e);
            }
        };

        self.children.push(api_child);
        self.children.push(dashboard_child);

        Ok(())
    }

    pub async fn wait_until_ready(&self) -> Result<(), String> {
        if let Some(url) = api_health_url(&self.config) {
            wait_for_url("api", url, Duration::from_secs(45))
                .await
                .map_err(|error| error.to_string())?;
        }

        if let Some(url) = dashboard_health_url(&self.config) {
            wait_for_url("dashboard", url, Duration::from_secs(90))
                .await
                .map_err(|error| error.to_string())?;
        }

        Ok(())
    }

    pub fn shutdown(&mut self) {
        for child in &mut self.children {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.children.clear();
    }
}

impl Drop for LocalServiceManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn spawn_service(repo_root: PathBuf, command: ServiceCommand) -> Result<Child, String> {
    let mut process = Command::new(&command.program);
    process
        .args(&command.args)
        .current_dir(repo_root)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    for (key, value) in command.env {
        process.env(key, value);
    }

    process
        .spawn()
        .map_err(|error| format!("failed to spawn {}: {}", command.program, error))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    fn one_shot_http_status(status: u16, reason: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());

        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request_buffer = [0; 1024];
            let _ = stream.read(&mut request_buffer);
            write!(
                stream,
                "HTTP/1.1 {status} {reason}\r\nContent-Length: 0\r\n\r\n"
            )
            .unwrap();
        });

        url
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

    #[test]
    fn readiness_rejects_client_error_statuses() {
        let url = one_shot_http_status(404, "Not Found");

        assert_eq!(is_ready(&url), Ok(false));
    }

    #[test]
    fn builds_dashboard_dev_command() {
        let command = dashboard_dev_command(&resolve_config_from_env(&env(&[])));

        assert_eq!(command.program, "bun");
        assert_eq!(command.args, vec!["run", "dev:dashboard"]);
        assert!(
            command
                .env
                .iter()
                .any(|(key, value)| key == "MIDDAY_DESKTOP_RUNTIME" && value == "local")
        );
        assert!(
            command
                .env
                .iter()
                .any(|(key, value)| key == "MIDDAY_LOCAL_FIRST" && value == "true")
        );
        assert!(command.env.iter().any(|(key, value)| {
            key == "NEXT_PUBLIC_MIDDAY_DESKTOP_RUNTIME" && value == "local"
        }));
        assert!(command.env.iter().any(|(key, value)| {
            key == "NEXT_PUBLIC_MIDDAY_LOCAL_FIRST" && value == "true"
        }));
        assert!(command.env.iter().any(|(key, value)| {
            key == "NEXT_PUBLIC_API_URL" && value == "http://localhost:3003"
        }));
        assert!(
            command.env.iter().any(|(key, value)| {
                key == "API_INTERNAL_URL" && value == "http://localhost:3003"
            })
        );
    }

    #[test]
    fn builds_api_dev_command() {
        let command = api_dev_command(&resolve_config_from_env(&env(&[])));

        assert_eq!(command.program, "bun");
        assert_eq!(command.args, vec!["run", "dev:api"]);
        assert!(
            command
                .env
                .iter()
                .any(|(key, value)| key == "MIDDAY_DESKTOP_RUNTIME" && value == "local")
        );
        assert!(
            command
                .env
                .iter()
                .any(|(key, value)| key == "MIDDAY_LOCAL_FIRST" && value == "true")
        );
        assert!(
            command
                .env
                .iter()
                .any(|(key, value)| key == "PORT" && value == "3003")
        );
        assert!(command.env.iter().any(|(key, value)| {
            key == "ALLOWED_API_ORIGINS" && value == "http://localhost:3001"
        }));
    }

    #[test]
    fn repo_root_from_manifest_points_to_workspace_root() {
        let root = repo_root_from_manifest();

        assert!(root.join("apps").join("desktop").exists());
        assert!(root.join("packages").exists());
    }
}
