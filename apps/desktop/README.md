# Midday Desktop App

A Tauri-based local-first desktop application for Midday with a native transparent titlebar on macOS.

## Features

- **Local-First Runtime**: Loads the local dashboard and API by default
- **Remote Diagnostics**: Hosted app modes remain available for diagnostics
- **Transparent Titlebar**: Native macOS transparent titlebar with traffic light buttons
- **Responsive Design**: Minimum window size of 1450x900 for optimal experience

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

## Building the App

### Development Build

```bash
bun run --filter @midday/desktop tauri:build:dev
```

### Staging Build

```bash
bun run --filter @midday/desktop tauri:build:staging
```

### Production Build

```bash
bun run --filter @midday/desktop tauri:build:prod
```
