# Local-First Midday Desktop Design

Date: 2026-06-14

## Decision

Build the local-first desktop app on the existing Tauri app instead of starting over with Electron. The original goal named Electron, but the user approved Tauri if it works and is more efficient/easy. In this repository, Tauri is already the efficient path because `apps/desktop` already handles the desktop shell: main window, search window, tray, global shortcut, deep links, updater, save dialogs, downloads, and external-link routing.

Electron remains a fallback only if a spike proves Tauri cannot package or supervise the required local services. The implementation should not rewrite the UI into a new Electron renderer while the Tauri path is viable.

## Current Repo Evidence

- `apps/desktop` is a Tauri 2 app that currently loads `http://localhost:3001`, `https://beta.midday.ai`, or `https://app.midday.ai`.
- `apps/dashboard` is a Next 16 app with `output: "standalone"`, server components, server actions, cookies, redirects, and tRPC clients. It should be hosted by a local dashboard server, not converted to a static-only web app.
- `apps/api` is a Hono/tRPC API that already contains most product behavior behind stable HTTP/tRPC contracts.
- `packages/db` uses Drizzle over PostgreSQL via `pg`, with Postgres-specific schema and query features such as `pgEnum`, `pgPolicy`, `jsonb`, `vector`, `tsvector`, `pg_trgm`, replica handling, and raw SQL fragments.
- `packages/supabase` is used for auth/session, storage, cached session queries, upload helpers, and middleware.
- `apps/worker`, `packages/job-client`, and some older `packages/jobs` flows depend on Redis/BullMQ or Trigger.dev for background processing and schedulers.

## Product Requirements

The desktop app must preserve Midday's existing UI and workflows while changing the runtime model:

- App shell runs locally as a desktop app.
- Core user data is stored in an embedded local SQLite database.
- Supabase is removed from the desktop runtime path.
- Vault, inbox, transaction, invoice, report, customer, team, tag, category, tracker, notification, API key, OAuth app, and settings data live locally.
- Files are stored in a local application data directory, not Supabase Storage.
- The AI assistant can remain online.
- External integrations may call provider APIs online, but Midday remains local-first: the source of truth is the local database and local file store.
- Public sharing features remain in scope through explicit publish/export flows that copy only the artifact needed for the public link.
- UI routes and visual behavior should remain the same unless a cloud-only feature has to become an explicit local-first equivalent.

## Architecture

The desktop product should run as three coordinated local pieces:

1. `apps/desktop`: Tauri host and supervisor.
2. `apps/dashboard`: local Next standalone dashboard server.
3. `apps/api`: local Bun/Hono/tRPC API sidecar.

Tauri launches and supervises the local dashboard and API sidecars, waits for health checks, then opens the main webview against the local dashboard URL. The dashboard talks to the local API through `NEXT_PUBLIC_API_URL` and `API_INTERNAL_URL`, matching the current architecture.

For development, Tauri can continue using local dev servers. For production, the build should package:

- a Tauri binary,
- the Next standalone dashboard output,
- a compiled Bun API executable or bundled Bun runtime entrypoint,
- SQLite migrations and seed data,
- desktop assets and local storage directories.

The dashboard and API should bind to loopback only. Ports should be allocated by Tauri at startup and passed to sidecars through environment variables to avoid collisions.

## Local Data Layer

Add a SQLite path beside the current Postgres path before removing Postgres:

- Create a SQLite schema module using `drizzle-orm/sqlite-core`.
- Add a local client module using either `bun:sqlite` plus `drizzle-orm/bun-sqlite` for the Bun sidecar, or `better-sqlite3` if packaging requires a Node-compatible fallback.
- Store the database under the OS app data directory, for example `Midday/data/midday.sqlite`.
- Run migrations on local API startup before serving requests.
- Enable SQLite pragmas for local app behavior: foreign keys, WAL, busy timeout, and sensible synchronous mode.

Postgres-specific features need direct replacements:

- `pgEnum`: text columns with TypeScript/zod validation and check constraints where useful.
- `jsonb`: SQLite text JSON with helper functions and query wrappers.
- `uuid`: string IDs generated in application code.
- `numeric`: integer minor units for money where feasible, or text decimal helpers where precision is required.
- `pgPolicy`: remove from DB schema and enforce authorization in API procedures because the local database has one trusted local user/session boundary.
- `vector` and embedding tables: keep data as JSON blobs initially, then add a local vector extension only if needed.
- `pg_trgm`, `similarity`, `word_similarity`: replace with local fuzzy matching helpers and SQLite FTS5 where search quality matters.
- Replicas and `executeOnReplica`: no-op on desktop and always use the local primary database.

The first implementation should preserve existing query function names where possible, so API routers and UI code do not need broad rewrites.

## Local Auth And Session

Replace Supabase Auth with a desktop-local identity provider:

- On first launch, create a local user and default team.
- Keep the current team/user/session shapes used by tRPC context.
- Issue a local signed session token or secure random bearer token scoped to loopback requests.
- Store session state in the local database plus secure OS storage when needed.
- Keep login/onboarding UI visually close to the current flow, but adapt copy and behavior for local account setup.
- MFA and OTP UI should be hidden or replaced by local device lock/security settings, because Supabase MFA/OTP does not apply locally.

The API should still use `protectedProcedure`, `session`, `teamId`, and `userId` internally so feature routers stay familiar.

## Local File Storage

Replace Supabase Storage with a local file service:

- Store files under the OS app data directory, for example `Midday/files/vault/...`.
- Keep existing logical path arrays in database rows.
- Provide local API endpoints for upload, download, proxy, thumbnail, and delete.
- Replace signed URLs with short-lived loopback URLs or authenticated file routes.
- Keep the existing upload components, but route uploads through local API endpoints instead of Supabase resumable upload endpoints.
- Preserve native save/open behavior through the existing Tauri file helpers.

## Jobs And Schedulers

Replace Redis/BullMQ/Trigger.dev in the desktop runtime with a local durable job runner:

- Add a SQLite `jobs` table with queue name, job name, payload JSON, status, attempts, scheduled time, result, error, and timestamps.
- Implement a local job client with the same surface as `triggerJob`, `triggerJobAndWait`, `getJobStatus`, and job cancellation where used.
- Run an in-process worker inside the local API sidecar for document processing, transaction import/export, recurring invoices, enrichment, inbox processing, notifications, and scheduled syncs.
- For recurring schedules, store schedules in SQLite and tick from the local process while the app is running.
- On startup, resume pending and scheduled jobs.

This preserves UI expectations around job status without requiring Redis.

## Online Integrations

External integrations remain online but local-first:

- Bank providers, Gmail, Outlook, Slack, Xero, QuickBooks, Fortnox, Stripe, Google APIs, and similar services authenticate through browser/deep-link or localhost callback flows.
- Tokens and connection metadata are stored locally and encrypted.
- Provider webhooks that cannot reach a local desktop app should be replaced with polling/manual sync for the first desktop version.
- Public customer portals, public invoice links, public report links, and share links require an online destination because external users cannot fetch content from an offline desktop. Preserve these features through a narrow publish bridge:
  - local export/download always works from the desktop file store,
  - publish actions upload only the selected invoice, report, portal, or shared artifact needed for the public URL,
  - the local SQLite database remains the source of truth,
  - unpublished edits stay local until the user republishes,
  - Supabase is not used for this bridge.
- The AI assistant remains online and may call the local API for context through explicit local app mediation.

## Dashboard Changes

Keep UI components and route structure intact. Most dashboard work should be integration rewiring:

- Point tRPC clients to the local API URL supplied by Tauri.
- Replace Supabase session reads in server actions, middleware, and components with the local session provider.
- Replace upload hooks with local upload endpoints.
- Replace realtime Supabase hooks with local invalidation, polling, or local event streams.
- Keep desktop-specific code in `@midday/desktop-client`, extending it for local service status and native file paths as needed.

Avoid broad UI redesign. Visual regressions are out of scope except where a cloud-only screen must become a local-first equivalent.

## API Changes

Keep the Hono/tRPC API as the main business logic layer:

- Add a desktop/local runtime mode.
- Switch DB client imports to a runtime-selected local SQLite client for desktop.
- Replace Supabase admin clients with local auth and storage services.
- Remove Redis, Sentry, CORS, and cloud health assumptions from desktop mode.
- Keep remote API behavior available if needed for the hosted product until the desktop migration is complete.

## Migration Phases

1. Desktop supervisor baseline:
   Tauri launches local dashboard and API, allocates ports, waits for health, and loads the local dashboard.

2. SQLite foundation:
   Add SQLite schema/client/migrations and a small seed that creates a local user/team.

3. Local auth/session:
   Replace Supabase session usage in dashboard and API context with local sessions.

4. Local storage:
   Replace Supabase Storage upload/download/signed URL usage with local file APIs.

5. Query portability:
   Port Drizzle schema and query modules from Postgres assumptions to SQLite-compatible logic.

6. Jobs:
   Replace BullMQ/Trigger paths with the local SQLite-backed job runner.

7. Feature passes:
   Verify transactions, invoices, vault/documents, inbox, tracker, reports, customers, apps/integrations, notifications, API keys, MCP, and AI assistant.

8. Packaging:
   Package the Tauri app with local sidecars, migrations, assets, and update behavior.

9. Parity verification:
   Run typechecks, focused tests, desktop startup smoke tests, and browser/Tauri visual checks for the preserved UI.

## Testing And Verification

Completion requires evidence across the real product surface:

- `bun` or `turbo` typecheck for touched packages.
- Unit tests for local DB schema helpers, auth/session, storage, and job runner.
- Query parity tests for high-value database modules.
- API smoke test against local SQLite.
- Dashboard smoke test against local API.
- Tauri startup test that confirms local services launch, health checks pass, and the main window loads.
- Upload/download test using local file storage.
- Import/export test for transactions and invoices.
- Job runner test for at least one scheduled and one immediate job.
- Visual checks for dashboard pages and search window.

## Risks

- Full Postgres-to-SQLite query parity is the largest effort because many queries use Postgres SQL features directly.
- Public sharing and inbound webhooks are not fully local concepts. The desktop app preserves them through explicit publish flows and provider polling/manual sync rather than hidden cloud database state.
- Next standalone packaging plus Bun API sidecar must be tested on Windows first because this is the user's primary environment.
- Some provider OAuth apps may reject localhost or custom scheme redirects without updated provider configuration.
- Maintaining the hosted app and desktop app in one codebase will require clear runtime boundaries to avoid regressions.

## Success Criteria

The goal is not complete until the current desktop build proves all of the following:

- Tauri app runs Midday locally without loading `app.midday.ai`.
- Supabase is not required for desktop auth, storage, or data.
- SQLite is the desktop source of truth.
- Existing dashboard UI and primary workflows remain available.
- Public links, customer portals, and invoice/report sharing work through explicit publish actions without using Supabase as the source of truth.
- AI assistant still works through its online provider path.
- Local files, jobs, and scheduled workflows survive app restart.
- The app can be packaged and launched on Windows from a clean install.
