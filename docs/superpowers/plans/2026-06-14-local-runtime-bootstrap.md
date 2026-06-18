# Local Runtime Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let desktop-managed API and dashboard services start in explicit local-first mode without requiring Supabase or external banking/storage provider secrets at import time.

**Architecture:** Add a shared local-runtime predicate and stable local identity constants, have Tauri set those env vars for managed services, and gate Supabase/banking auth bootstrap behind local-mode shims. This does not port the full Postgres query layer yet; it removes the next startup blockers and establishes the local session identity used by the SQLite foundation.

**Tech Stack:** Tauri Rust service manager, Next.js dashboard server/client modules, `@t3-oss/env-core` `skipValidation`, Bun tests.

---

## File Structure

- Modify `packages/utils/src/envs.ts`
  - Add `isLocalDesktopRuntime(env)` plus `LOCAL_DESKTOP_USER_ID`, `LOCAL_DESKTOP_TEAM_ID`, and `LOCAL_DESKTOP_SESSION_TOKEN`.
- Create `packages/utils/src/envs.test.ts`
  - Verify local runtime detection for server and `NEXT_PUBLIC_` env flags.
- Modify `packages/db/src/local/client.ts`
  - Reuse the shared local identity constants for SQLite seeding.
- Modify `apps/desktop/src-tauri/src/local_services.rs`
  - Add local runtime env vars to dashboard/API service commands.
- Modify `packages/banking/src/env.ts` and `packages/banking/package.json`
  - Skip provider env validation only in local desktop mode.
- Create `packages/supabase/src/client/local.ts`
  - Provide a small local Supabase-compatible auth stub.
- Modify `packages/supabase/src/client/server.ts`, `packages/supabase/src/client/client.ts`, `packages/supabase/src/client/middleware.ts`, and `packages/supabase/package.json`
  - Return local stub clients in desktop-local mode before reading Supabase env vars/cookies.
- Modify `apps/api/src/services/supabase.ts`
  - Return the local stub in desktop-local mode.
- Modify `apps/api/src/utils/auth.ts`
  - Return a local session for the stable local token and make remote JWKS lazy so missing Supabase URL does not crash imports.

---

### Task 1: Shared Local Runtime Helper

**Files:**
- Modify: `packages/utils/src/envs.ts`
- Create: `packages/utils/src/envs.test.ts`
- Modify: `packages/db/src/local/client.ts`

- [ ] **Step 1: Add failing helper tests**

Create `packages/utils/src/envs.test.ts` with:

```ts
import { describe, expect, test } from "bun:test";
import {
  isLocalDesktopRuntime,
  LOCAL_DESKTOP_SESSION_TOKEN,
  LOCAL_DESKTOP_TEAM_ID,
  LOCAL_DESKTOP_USER_ID,
} from "./envs";

describe("isLocalDesktopRuntime", () => {
  test("detects server-side local desktop runtime", () => {
    expect(isLocalDesktopRuntime({ MIDDAY_DESKTOP_RUNTIME: "local" })).toBe(
      true,
    );
    expect(isLocalDesktopRuntime({ MIDDAY_LOCAL_FIRST: "true" })).toBe(true);
  });

  test("detects client-exposed local desktop runtime", () => {
    expect(
      isLocalDesktopRuntime({ NEXT_PUBLIC_MIDDAY_DESKTOP_RUNTIME: "local" }),
    ).toBe(true);
    expect(isLocalDesktopRuntime({ NEXT_PUBLIC_MIDDAY_LOCAL_FIRST: "1" })).toBe(
      true,
    );
  });

  test("does not treat remote desktop runtime as local", () => {
    expect(isLocalDesktopRuntime({ MIDDAY_DESKTOP_RUNTIME: "remote" })).toBe(
      false,
    );
    expect(isLocalDesktopRuntime({})).toBe(false);
  });

  test("exports stable local identity constants", () => {
    expect(LOCAL_DESKTOP_USER_ID).toBe("local_user");
    expect(LOCAL_DESKTOP_TEAM_ID).toBe("local_team");
    expect(LOCAL_DESKTOP_SESSION_TOKEN).toBe("local_session");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk cmd /c bun test packages/utils/src/envs.test.ts`

Expected: FAIL because the helper and constants do not exist.

- [ ] **Step 3: Implement helper and constants**

Append to `packages/utils/src/envs.ts`:

```ts
type LocalRuntimeEnv = Partial<
  Pick<
    NodeJS.ProcessEnv,
    | "MIDDAY_DESKTOP_RUNTIME"
    | "MIDDAY_LOCAL_FIRST"
    | "NEXT_PUBLIC_MIDDAY_DESKTOP_RUNTIME"
    | "NEXT_PUBLIC_MIDDAY_LOCAL_FIRST"
  >
>;

export const LOCAL_DESKTOP_USER_ID = "local_user";
export const LOCAL_DESKTOP_TEAM_ID = "local_team";
export const LOCAL_DESKTOP_SESSION_TOKEN = "local_session";

function isEnabled(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}

export function isLocalDesktopRuntime(env: LocalRuntimeEnv = process.env) {
  const runtime =
    env.MIDDAY_DESKTOP_RUNTIME ?? env.NEXT_PUBLIC_MIDDAY_DESKTOP_RUNTIME;

  return (
    runtime?.toLowerCase() === "local" ||
    isEnabled(env.MIDDAY_LOCAL_FIRST) ||
    isEnabled(env.NEXT_PUBLIC_MIDDAY_LOCAL_FIRST)
  );
}
```

- [ ] **Step 4: Reuse constants in SQLite seed**

In `packages/db/src/local/client.ts`, replace local default constants with imports:

```ts
import {
  LOCAL_DESKTOP_SESSION_TOKEN,
  LOCAL_DESKTOP_TEAM_ID,
  LOCAL_DESKTOP_USER_ID,
} from "@midday/utils/envs";
```

- [ ] **Step 5: Verify**

Run:

```bash
rtk cmd /c bun test packages/utils/src/envs.test.ts
rtk cmd /c bun run --filter @midday/db test:local
rtk cmd /c bun run --filter @midday/db typecheck
```

Expected: PASS.

---

### Task 2: Tauri Local Runtime Env Injection

**Files:**
- Modify: `apps/desktop/src-tauri/src/local_services.rs`

- [ ] **Step 1: Add failing Rust assertions**

Extend `builds_dashboard_dev_command` and `builds_api_dev_command` to assert:

```rust
assert!(command
    .env
    .iter()
    .any(|(key, value)| key == "MIDDAY_DESKTOP_RUNTIME" && value == "local"));
assert!(command
    .env
    .iter()
    .any(|(key, value)| key == "MIDDAY_LOCAL_FIRST" && value == "true"));
```

For dashboard only, also assert:

```rust
assert!(command.env.iter().any(|(key, value)| {
    key == "NEXT_PUBLIC_MIDDAY_DESKTOP_RUNTIME" && value == "local"
}));
assert!(command.env.iter().any(|(key, value)| {
    key == "NEXT_PUBLIC_MIDDAY_LOCAL_FIRST" && value == "true"
}));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`

Expected: FAIL because the env vars are not present.

- [ ] **Step 3: Add command env vars**

Add a helper in `local_services.rs`:

```rust
fn local_runtime_env() -> Vec<(String, String)> {
    vec![
        ("MIDDAY_DESKTOP_RUNTIME".to_string(), "local".to_string()),
        ("MIDDAY_LOCAL_FIRST".to_string(), "true".to_string()),
    ]
}
```

Extend API command env with `local_runtime_env()`.

Extend dashboard command env with `local_runtime_env()` and:

```rust
("NEXT_PUBLIC_MIDDAY_DESKTOP_RUNTIME".to_string(), "local".to_string()),
("NEXT_PUBLIC_MIDDAY_LOCAL_FIRST".to_string(), "true".to_string()),
```

- [ ] **Step 4: Verify**

Run: `rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`

Expected: PASS.

---

### Task 3: Local Banking Env Gate

**Files:**
- Modify: `packages/banking/src/env.ts`
- Modify: `packages/banking/package.json`

- [ ] **Step 1: Add dependency and local skip**

Add `@midday/utils` to `packages/banking/package.json` dependencies.

Modify `packages/banking/src/env.ts`:

```ts
import { isLocalDesktopRuntime } from "@midday/utils/envs";
```

Add to `createEnv` options:

```ts
skipValidation: isLocalDesktopRuntime(),
```

- [ ] **Step 2: Verify local import without provider secrets**

Run:

```bash
rtk cmd /c "set MIDDAY_DESKTOP_RUNTIME=local&& bun -e \"await import('./packages/banking/src/env.ts'); console.log('banking local env ok')\""
```

Expected: prints `banking local env ok`.

---

### Task 4: Local Supabase Auth Stub

**Files:**
- Create: `packages/supabase/src/client/local.ts`
- Modify: `packages/supabase/src/client/server.ts`
- Modify: `packages/supabase/src/client/client.ts`
- Modify: `packages/supabase/src/client/middleware.ts`
- Modify: `packages/supabase/package.json`

- [ ] **Step 1: Implement local stub**

Create `packages/supabase/src/client/local.ts`:

```ts
import {
  isLocalDesktopRuntime,
  LOCAL_DESKTOP_SESSION_TOKEN,
  LOCAL_DESKTOP_TEAM_ID,
  LOCAL_DESKTOP_USER_ID,
} from "@midday/utils/envs";
import type { SupabaseClient } from "@supabase/supabase-js";

const localUser = {
  id: LOCAL_DESKTOP_USER_ID,
  email: "local@midday.local",
  user_metadata: {
    full_name: "Local User",
    team_id: LOCAL_DESKTOP_TEAM_ID,
  },
  app_metadata: {},
  aud: "authenticated",
  created_at: "2020-01-01T00:00:00.000Z",
};

const localSession = {
  access_token: LOCAL_DESKTOP_SESSION_TOKEN,
  refresh_token: LOCAL_DESKTOP_SESSION_TOKEN,
  token_type: "bearer",
  expires_in: 31_536_000,
  expires_at: Math.floor(Date.now() / 1000) + 31_536_000,
  user: localUser,
};

function createLocalChannel() {
  return {
    on() {
      return this;
    },
    subscribe(callback?: (status: string) => void) {
      callback?.("SUBSCRIBED");
      return this;
    },
    unsubscribe: async () => "ok",
  };
}

export function createLocalSupabaseClient() {
  return {
    auth: {
      getClaims: async () => ({
        data: { claims: { sub: LOCAL_DESKTOP_USER_ID } },
        error: null,
      }),
      getSession: async () => ({ data: { session: localSession }, error: null }),
      getUser: async () => ({ data: { user: localUser }, error: null }),
      signOut: async () => ({ error: null }),
      verifyOtp: async () => ({ data: { session: localSession, user: localUser }, error: null }),
      exchangeCodeForSession: async () => ({
        data: { session: localSession, user: localUser },
        error: null,
      }),
      mfa: {
        challenge: async () => ({ data: { id: "local_mfa_challenge" }, error: null }),
        enroll: async () => ({ data: { id: "local_mfa_factor" }, error: null }),
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: "aal1", nextLevel: "aal1" },
          error: null,
        }),
        listFactors: async () => ({ data: { all: [], totp: [] }, error: null }),
        unenroll: async () => ({ data: {}, error: null }),
        verify: async () => ({ data: {}, error: null }),
      },
    },
    channel: () => createLocalChannel(),
    removeChannel: async () => ({ error: null }),
  } as unknown as SupabaseClient;
}

export { isLocalDesktopRuntime };
```

- [ ] **Step 2: Wire server/client/middleware**

In server and browser Supabase client modules, return `createLocalSupabaseClient()` first when `isLocalDesktopRuntime()` is true.

In middleware, return:

```ts
return {
  response,
  isAuthenticated: true,
  supabase: createLocalSupabaseClient(),
};
```

- [ ] **Step 3: Add package dependency and export**

Add `@midday/utils` dependency and `./local-client`: `./src/client/local.ts` export to `packages/supabase/package.json`.

- [ ] **Step 4: Verify local import**

Run:

```bash
rtk cmd /c "set MIDDAY_DESKTOP_RUNTIME=local&& bun -e \"const { createClient } = await import('./packages/supabase/src/client/server.ts'); const supabase = await createClient(); const { data } = await supabase.auth.getSession(); console.log(data.session.access_token)\""
```

Expected: prints `local_session`.

---

### Task 5: Local API Auth and Supabase Service Stub

**Files:**
- Modify: `apps/api/src/services/supabase.ts`
- Modify: `apps/api/src/utils/auth.ts`

- [ ] **Step 1: Make API Supabase service local-aware**

In `apps/api/src/services/supabase.ts`, import the local stub and return it when `isLocalDesktopRuntime()` is true.

- [ ] **Step 2: Make token verification local-aware and JWKS lazy**

In `apps/api/src/utils/auth.ts`:
- Import `isLocalDesktopRuntime` and the local identity constants.
- Remove top-level `JWKS = createRemoteJWKSet(new URL(...))`.
- Add a lazy `getRemoteJwks()` function that returns `null` when `SUPABASE_URL` is missing.
- At the top of `verifyAccessToken`, return the local session when local runtime is enabled and the token equals `LOCAL_DESKTOP_SESSION_TOKEN`.

- [ ] **Step 3: Verify local API auth without Supabase URL**

Run:

```bash
rtk cmd /c "set MIDDAY_DESKTOP_RUNTIME=local&& set SUPABASE_URL=&& bun -e \"const { verifyAccessToken } = await import('./apps/api/src/utils/auth.ts'); console.log(JSON.stringify(await verifyAccessToken('local_session')))\""
```

Expected JSON includes `"id":"local_user"` and `"teamId":"local_team"`.

---

### Task 6: Final Verification

Run:

```bash
rtk cmd /c bun test packages/utils/src/envs.test.ts
rtk cmd /c bun run --filter @midday/db test:local
rtk cmd /c bun run --filter @midday/db typecheck
rtk cmd /c bun run --filter @midday/banking typecheck
rtk cmd /c bun run --filter @midday/supabase typecheck
rtk cmd /c bun run --filter @midday/api typecheck
rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
rtk git diff --check
rtk git status --short
```

Expected:
- All focused tests pass.
- Typecheck passes for touched packages, or any pre-existing non-touched failures are documented with file paths.
- Rust desktop tests pass.
- Worktree is clean after commits.
