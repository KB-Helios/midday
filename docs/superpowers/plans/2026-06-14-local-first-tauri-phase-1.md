# Local-First Tauri Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Tauri desktop shell load a local Midday dashboard/API runtime instead of acting as a remote app launcher.

**Architecture:** This phase adds a Rust local-service supervisor to `apps/desktop/src-tauri` and routes all desktop windows through one resolved local dashboard URL. Development mode starts or reuses local `apps/dashboard` and `apps/api` dev servers; the supervisor keeps a small process interface so packaging work can swap dev commands for Tauri `bundle.externalBin` sidecars without rewriting window logic.

**Tech Stack:** Tauri 2, Rust 2024, Bun, Next standalone/dev server, Hono/tRPC API, existing `@midday/desktop` package.

---

## Scope Check

The approved spec covers multiple independent subsystems: desktop service supervision, SQLite, local auth, local storage, job runner, query portability, integrations, and packaging. This plan intentionally implements only the first independently testable subsystem: desktop local service supervision and URL routing. Follow-on plans should cover SQLite, auth/session, storage, jobs, query portability, and packaging as separate work packets.

## File Structure

- Modify `apps/desktop/src-tauri/Cargo.toml`
  - Add the small dependencies needed for robust localhost polling and error handling.
- Create `apps/desktop/src-tauri/src/local_services.rs`
  - Own all local desktop runtime configuration, dev process spawning, health polling, app URL resolution, and child shutdown.
- Modify `apps/desktop/src-tauri/src/lib.rs`
  - Replace direct environment URL switching with `local_services`.
  - Keep existing window, tray, search, updater, and deep-link behavior.
- Modify `apps/desktop/src-tauri/capabilities/default.json`
  - Keep the local dashboard origin authorized for desktop windows.
  - Keep hosted origins authorized only for explicitly named remote diagnostic scripts.
  - Apply the capability to Windows as well as macOS.
- Modify `apps/desktop/README.md`
  - Document the local-first desktop startup modes and required sibling dev services.
- Modify `apps/desktop/package.json`
  - Add explicit scripts for local-first desktop development and remote fallback diagnostics.

## Task 1: Local Service Config Resolver

**Files:**
- Create: `apps/desktop/src-tauri/src/local_services.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`

- [ ] **Step 1: Add Rust dependencies**

Modify `apps/desktop/src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri = { version = "2", features = ["macos-private-api", "tray-icon", "webview-data-url"] }
tauri-plugin-opener = "2"
tauri-plugin-deep-link = "2"
tauri-plugin-global-shortcut = "2"

serde = { version = "1", features = ["derive"] }
serde_json = "1"
image = "0.24"
tokio = { version = "1", features = ["time", "process", "io-util"] }
tauri-plugin-updater = "2"
tauri-plugin-dialog = "2.2.2"
tauri-plugin-process = "2.2.1"
tauri-plugin-upload = "2"
tauri-plugin-fs = "2"
ureq = "2"
```

- [ ] **Step 2: Write failing config tests**

Create `apps/desktop/src-tauri/src/local_services.rs` with the config types, function signatures, and tests first:

```rust
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
    let _ = env;
    panic!("resolve_config_from_env is not implemented yet");
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
```

- [ ] **Step 3: Run the tests and verify they fail**

Run:

```powershell
rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml local_services --lib
```

Expected: the test binary runs and fails with `resolve_config_from_env is not implemented yet`.

- [ ] **Step 4: Implement the config resolver**

Replace `resolve_config_from_env` in `apps/desktop/src-tauri/src/local_services.rs`:

```rust
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
```

- [ ] **Step 5: Add a process environment helper**

Append this helper above the tests in `apps/desktop/src-tauri/src/local_services.rs`:

```rust
pub fn current_env() -> HashMap<String, String> {
    std::env::vars().collect()
}
```

- [ ] **Step 6: Run tests and verify they pass**

Run:

```powershell
rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml local_services --lib
```

Expected: all `local_services` tests pass.

- [ ] **Step 7: Commit**

Run:

```powershell
rtk git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/src/local_services.rs
rtk git commit -m "feat(desktop): resolve local runtime config"
```

## Task 2: Local Health Polling

**Files:**
- Modify: `apps/desktop/src-tauri/src/local_services.rs`

- [ ] **Step 1: Write failing health URL tests**

Append these tests inside the existing `#[cfg(test)] mod tests` block:

```rust
#[test]
fn builds_health_urls_for_local_services() {
    let config = resolve_config_from_env(&env(&[]));

    assert_eq!(api_health_url(&config), Some("http://localhost:3003/health".to_string()));
    assert_eq!(dashboard_health_url(&config), Some("http://localhost:3001".to_string()));
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
```

Add these function signatures above the tests:

```rust
pub fn api_health_url(config: &LocalServiceConfig) -> Option<String> {
    let _ = config;
    panic!("api_health_url is not implemented yet");
}

pub fn dashboard_health_url(config: &LocalServiceConfig) -> Option<String> {
    let _ = config;
    panic!("dashboard_health_url is not implemented yet");
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml local_services --lib
```

Expected: new health URL tests fail with an unimplemented panic.

- [ ] **Step 3: Implement health URL helpers**

Replace the two health URL functions:

```rust
pub fn api_health_url(config: &LocalServiceConfig) -> Option<String> {
    match config.mode {
        DesktopRuntimeMode::Local => Some(format!("{}/health", config.api_url.trim_end_matches('/'))),
        DesktopRuntimeMode::Remote => None,
    }
}

pub fn dashboard_health_url(config: &LocalServiceConfig) -> Option<String> {
    match config.mode {
        DesktopRuntimeMode::Local => Some(config.dashboard_url.trim_end_matches('/').to_string()),
        DesktopRuntimeMode::Remote => None,
    }
}
```

- [ ] **Step 4: Add wait helper used by the Tauri startup path**

Append this code above the tests:

```rust
use std::time::{Duration, Instant};

#[derive(Debug)]
pub enum LocalServiceError {
    Timeout { service: &'static str, url: String },
    Request { service: &'static str, url: String, message: String },
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
```

- [ ] **Step 5: Run tests and verify they pass**

Run:

```powershell
rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml local_services --lib
```

Expected: all `local_services` tests pass.

- [ ] **Step 6: Commit**

Run:

```powershell
rtk git add apps/desktop/src-tauri/src/local_services.rs
rtk git commit -m "feat(desktop): add local service health checks"
```

## Task 3: Development Process Supervisor

**Files:**
- Modify: `apps/desktop/src-tauri/src/local_services.rs`

- [ ] **Step 1: Write failing command-construction tests**

Append these tests inside the existing test module:

```rust
#[test]
fn builds_dashboard_dev_command() {
    let command = dashboard_dev_command(&resolve_config_from_env(&env(&[])));

    assert_eq!(command.program, "bun");
    assert_eq!(command.args, vec!["run", "dev:dashboard"]);
    assert!(command.env.iter().any(|(key, value)| {
        key == "NEXT_PUBLIC_API_URL" && value == "http://localhost:3003"
    }));
    assert!(command.env.iter().any(|(key, value)| {
        key == "API_INTERNAL_URL" && value == "http://localhost:3003"
    }));
}

#[test]
fn builds_api_dev_command() {
    let command = api_dev_command(&resolve_config_from_env(&env(&[])));

    assert_eq!(command.program, "bun");
    assert_eq!(command.args, vec!["run", "dev:api"]);
    assert!(command.env.iter().any(|(key, value)| key == "PORT" && value == "3003"));
    assert!(command.env.iter().any(|(key, value)| {
        key == "ALLOWED_API_ORIGINS" && value == "http://localhost:3001"
    }));
}
```

Add these structs and signatures above the tests:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceCommand {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

pub fn dashboard_dev_command(config: &LocalServiceConfig) -> ServiceCommand {
    let _ = config;
    panic!("dashboard_dev_command is not implemented yet");
}

pub fn api_dev_command(config: &LocalServiceConfig) -> ServiceCommand {
    let _ = config;
    panic!("api_dev_command is not implemented yet");
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml local_services --lib
```

Expected: command-construction tests fail with unimplemented panics.

- [ ] **Step 3: Implement command construction**

Replace `dashboard_dev_command` and `api_dev_command`:

```rust
fn port_from_url(url: &str, fallback: &str) -> String {
    url.rsplit(':')
        .next()
        .and_then(|part| part.split('/').next())
        .filter(|part| part.chars().all(|ch| ch.is_ascii_digit()))
        .unwrap_or(fallback)
        .to_string()
}

pub fn dashboard_dev_command(config: &LocalServiceConfig) -> ServiceCommand {
    ServiceCommand {
        program: "bun".to_string(),
        args: vec!["run".to_string(), "dev:dashboard".to_string()],
        env: vec![
            ("NEXT_PUBLIC_API_URL".to_string(), config.api_url.clone()),
            ("API_INTERNAL_URL".to_string(), config.api_url.clone()),
        ],
    }
}

pub fn api_dev_command(config: &LocalServiceConfig) -> ServiceCommand {
    ServiceCommand {
        program: "bun".to_string(),
        args: vec!["run".to_string(), "dev:api".to_string()],
        env: vec![
            ("PORT".to_string(), port_from_url(&config.api_url, "3003")),
            (
                "ALLOWED_API_ORIGINS".to_string(),
                config.dashboard_url.clone(),
            ),
        ],
    }
}
```

- [ ] **Step 4: Add child process supervision**

Append this code above the tests:

```rust
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

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

        let api = spawn_service(repo_root.clone(), api_dev_command(&self.config))?;
        let dashboard = spawn_service(repo_root, dashboard_dev_command(&self.config))?;
        self.children.push(api);
        self.children.push(dashboard);

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
```

- [ ] **Step 5: Run tests and verify they pass**

Run:

```powershell
rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml local_services --lib
```

Expected: all `local_services` tests pass.

- [ ] **Step 6: Commit**

Run:

```powershell
rtk git add apps/desktop/src-tauri/src/local_services.rs
rtk git commit -m "feat(desktop): supervise local dev services"
```

## Task 4: Tauri Window Integration

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/local_services.rs`

- [ ] **Step 1: Add a repo-root helper**

Append this helper above the tests in `apps/desktop/src-tauri/src/local_services.rs`:

```rust
pub fn repo_root_from_manifest() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .and_then(|path| path.parent())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
```

- [ ] **Step 2: Register the module in lib.rs**

At the top of `apps/desktop/src-tauri/src/lib.rs`, add:

```rust
mod local_services;
```

- [ ] **Step 3: Replace the old environment URL function**

In `apps/desktop/src-tauri/src/lib.rs`, remove the body of `get_app_url` and replace it with:

```rust
fn get_app_url() -> String {
    let config = local_services::resolve_config_from_env(&local_services::current_env());
    println!("🌍 Desktop runtime: {:?}", config.mode);
    println!("🌍 Dashboard URL: {}", config.dashboard_url);
    config.dashboard_url
}
```

This preserves existing callers while the rest of the integration is added.

- [ ] **Step 4: Add service startup in Tauri setup**

In `apps/desktop/src-tauri/src/lib.rs`, inside `.setup(move |app| {` and before creating `search_state`, add:

```rust
            let local_config =
                local_services::resolve_config_from_env(&local_services::current_env());
            let mut local_manager = local_services::LocalServiceManager::new(local_config.clone());

            if local_config.manage_processes {
                local_manager
                    .start_dev_services(local_services::repo_root_from_manifest())
                    .map_err(|error| format!("Failed to start local services: {error}"))?;
            }

            if matches!(local_config.mode, local_services::DesktopRuntimeMode::Local) {
                tauri::async_runtime::block_on(local_manager.wait_until_ready())
                    .map_err(|error| format!("Local services were not ready: {error}"))?;
            }

            app.manage(Mutex::new(local_manager));
```

- [ ] **Step 5: Import the extra type used by managed state**

Confirm the existing import already includes `Mutex`:

```rust
use std::sync::{Arc, Mutex};
```

No change is needed if that import is already present.

- [ ] **Step 6: Run Rust tests**

Run:

```powershell
rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
```

Expected: Rust library tests pass.

- [ ] **Step 7: Run desktop type/build check**

Run:

```powershell
rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run
```

Expected: Cargo compiles all test targets without Rust type errors.

- [ ] **Step 8: Commit**

Run:

```powershell
rtk git add apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/local_services.rs
rtk git commit -m "feat(desktop): load local dashboard runtime"
```

## Task 5: Local-First Capabilities And Scripts

**Files:**
- Modify: `apps/desktop/src-tauri/capabilities/default.json`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/README.md`

- [ ] **Step 1: Make local dashboard the first authorized origin**

In `apps/desktop/src-tauri/capabilities/default.json`, replace the `remote.urls` array with:

```json
  "remote": {
    "urls": [
      "http://localhost:3001/**",
      "https://beta.midday.ai/**",
      "https://app.midday.ai/**"
    ]
  },
```

- [ ] **Step 2: Apply default capability on Windows**

In `apps/desktop/src-tauri/capabilities/default.json`, replace the `platforms` array with:

```json
  "platforms": ["macOS", "windows", "linux"]
```

- [ ] **Step 3: Add explicit package scripts**

In `apps/desktop/package.json`, replace the `scripts` block with:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "tauri:dev": "MIDDAY_DESKTOP_RUNTIME=local MIDDAY_DESKTOP_MANAGE_SERVICES=false MIDDAY_DASHBOARD_URL=http://localhost:3001 MIDDAY_API_URL=http://localhost:3003 tauri dev --config src-tauri/tauri.dev.conf.json",
    "tauri:dev:managed": "MIDDAY_DESKTOP_RUNTIME=local MIDDAY_DESKTOP_MANAGE_SERVICES=true MIDDAY_DASHBOARD_URL=http://localhost:3001 MIDDAY_API_URL=http://localhost:3003 tauri dev --config src-tauri/tauri.dev.conf.json",
    "tauri:remote:staging": "MIDDAY_DESKTOP_RUNTIME=remote MIDDAY_REMOTE_APP_URL=https://beta.midday.ai MIDDAY_REMOTE_API_URL=https://api.midday.ai tauri dev --config src-tauri/tauri.staging.conf.json",
    "tauri:remote:prod": "MIDDAY_DESKTOP_RUNTIME=remote MIDDAY_REMOTE_APP_URL=https://app.midday.ai MIDDAY_REMOTE_API_URL=https://api.midday.ai tauri dev",
    "tauri:build:dev": "tauri build --config src-tauri/tauri.dev.conf.json",
    "tauri:build:staging": "tauri build --config src-tauri/tauri.staging.conf.json",
    "tauri:build:prod": "tauri build"
  },
```

- [ ] **Step 4: Update README startup instructions**

Replace the "Environment Configuration" and "Running the App" sections in `apps/desktop/README.md` with:

```markdown
## Runtime Configuration

The desktop app is local-first by default. It opens the local dashboard at
`http://localhost:3001`, and the dashboard talks to the local API at
`http://localhost:3003`.

### Development With Existing Dev Servers

Run the dashboard and API in separate terminals from the repository root:

```bash
bun run dev:api
bun run dev:dashboard
```

Then run the desktop shell:

```bash
bun run --filter @midday/desktop tauri:dev
```

### Development With Desktop-Managed Services

The desktop shell can also start the dashboard and API dev servers:

```bash
bun run --filter @midday/desktop tauri:dev:managed
```

This mode is the Phase 1 bridge toward packaged sidecars. The packaged build
will replace dev commands with bundled sidecar binaries.

### Remote Diagnostics

Remote mode is kept only for diagnosing hosted app behavior:

```bash
bun run --filter @midday/desktop tauri:remote:staging
bun run --filter @midday/desktop tauri:remote:prod
```
```

- [ ] **Step 5: Run JSON/package validation**

Run:

```powershell
rtk cmd /c bun run --filter @midday/desktop build
```

Expected: TypeScript and Vite build for `@midday/desktop` pass.

- [ ] **Step 6: Run Rust compilation**

Run:

```powershell
rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run
```

Expected: Cargo compiles desktop Rust targets.

- [ ] **Step 7: Commit**

Run:

```powershell
rtk git add apps/desktop/src-tauri/capabilities/default.json apps/desktop/package.json apps/desktop/README.md
rtk git commit -m "docs(desktop): document local-first startup"
```

## Task 6: Manual Smoke Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Start API and dashboard externally**

Run from repository root in terminal 1:

```powershell
rtk cmd /c bun run dev:api
```

Expected: API starts on `http://localhost:3003`.

Run from repository root in terminal 2:

```powershell
rtk cmd /c bun run dev:dashboard
```

Expected: Dashboard starts on `http://localhost:3001`.

- [ ] **Step 2: Start desktop in external-server mode**

Run from repository root in terminal 3:

```powershell
rtk cmd /c bun run --filter @midday/desktop tauri:dev
```

Expected: Tauri opens a Midday window loading `http://localhost:3001`, not `https://app.midday.ai`.

- [ ] **Step 3: Verify search window still uses local dashboard**

Press the existing global shortcut:

```text
Shift+Alt+K
```

Expected: the search window opens against `http://localhost:3001/desktop/search`.

- [ ] **Step 4: Stop all services**

Close the Tauri app window and stop the dev server terminals with:

```text
Ctrl+C
```

Expected: no orphaned `bun` process remains for the dashboard or API after the terminals are stopped.

- [ ] **Step 5: Check final worktree**

Run:

```powershell
rtk git status --short
```

Expected: no uncommitted changes.

## Phase 1 Completion Criteria

- `apps/desktop` resolves local dashboard/API URLs through `local_services`.
- Tauri no longer uses `MIDDAY_ENV` to choose `https://app.midday.ai` as the normal production path.
- Local dashboard origin remains authorized in Tauri capabilities on Windows, macOS, and Linux.
- Remote hosted modes are renamed as diagnostics.
- Rust tests for config and command construction pass.
- Desktop build and Rust compile checks pass.
- Manual smoke confirms the desktop app loads localhost.

## Follow-On Plans

After this plan is implemented and verified, create separate implementation plans for:

1. SQLite schema/client foundation.
2. Local auth/session replacement for Supabase Auth.
3. Local file storage replacement for Supabase Storage.
4. SQLite-backed job runner replacement for Redis/BullMQ/Trigger paths.
5. Query portability and feature parity passes.
6. Packaged Tauri sidecars using `bundle.externalBin` and target-triple binaries.
