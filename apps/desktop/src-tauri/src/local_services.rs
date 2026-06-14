use std::collections::HashMap;

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
}
