# Local First SQLite Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tested embedded SQLite database foundation for the desktop runtime without replacing the existing Postgres query layer yet.

**Architecture:** Keep the current `@midday/db/client` Postgres export untouched and add a parallel `@midday/db/local-client` export. The local client owns SQLite file resolution, Bun SQLite connection setup, PRAGMA configuration, versioned bootstrap migrations, and local identity/session seed data that later Supabase replacement work can consume.

**Tech Stack:** Bun `bun:sqlite`, Drizzle `drizzle-orm/bun-sqlite`, Drizzle SQLite schema helpers, Bun test.

---

## File Structure

- Create `packages/db/src/local/path.ts`
  - Resolves the local SQLite file path from `MIDDAY_SQLITE_PATH`, `MIDDAY_DESKTOP_DATA_DIR`, or a workspace-local `.midday/midday.sqlite` fallback.
  - Creates the parent directory by default so callers can open the file immediately.
- Create `packages/db/src/local/schema.ts`
  - Defines small SQLite bootstrap tables for local metadata, migrations, users, teams, team membership, and sessions.
  - This is intentionally not a full port of `packages/db/src/schema.ts`; that file is Postgres-specific and is too large for a safe first SQLite pass.
- Create `packages/db/src/local/migrations.ts`
  - Applies versioned raw SQL migrations using Bun SQLite transactions.
  - Records applied versions in `local_migrations`.
- Create `packages/db/src/local/client.ts`
  - Opens the Bun SQLite file, configures PRAGMAs, creates the Drizzle client, runs migrations, exposes close helpers, and seeds a local workspace.
- Create `packages/db/src/local/client.test.ts`
  - Verifies path resolution, migration idempotence, Drizzle queries, and local workspace seeding against temporary SQLite files.
- Modify `packages/db/package.json`
  - Add `./local-client` export and `test:local` script.

---

### Task 1: Local SQLite Path Resolution

**Files:**
- Create: `packages/db/src/local/path.ts`
- Test: `packages/db/src/local/client.test.ts`

- [ ] **Step 1: Write failing path tests**

Add this initial test file:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { resolveLocalDbPath } from "./path";

const tempDirs: string[] = [];

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "midday-local-db-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveLocalDbPath", () => {
  test("uses a workspace-local default path and creates the parent directory", () => {
    const cwd = createTempDir();

    const dbPath = resolveLocalDbPath({ cwd, env: {} });

    expect(dbPath).toBe(join(cwd, ".midday", "midday.sqlite"));
    expect(existsSync(dirname(dbPath))).toBe(true);
  });

  test("uses MIDDAY_SQLITE_PATH before the desktop data directory", () => {
    const cwd = createTempDir();
    const desktopDataDir = join(cwd, "desktop-data");

    const dbPath = resolveLocalDbPath({
      cwd,
      env: {
        MIDDAY_DESKTOP_DATA_DIR: desktopDataDir,
        MIDDAY_SQLITE_PATH: "custom/local.sqlite",
      },
    });

    expect(dbPath).toBe(join(cwd, "custom", "local.sqlite"));
    expect(existsSync(dirname(dbPath))).toBe(true);
  });

  test("uses MIDDAY_DESKTOP_DATA_DIR when no explicit SQLite path is set", () => {
    const cwd = createTempDir();
    const desktopDataDir = join(cwd, "desktop-data");

    const dbPath = resolveLocalDbPath({
      cwd,
      env: { MIDDAY_DESKTOP_DATA_DIR: desktopDataDir },
    });

    expect(dbPath).toBe(join(desktopDataDir, "midday.sqlite"));
    expect(existsSync(dirname(dbPath))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk cmd /c bun test packages/db/src/local/client.test.ts`

Expected: FAIL because `packages/db/src/local/path.ts` does not exist.

- [ ] **Step 3: Implement path resolution**

Create `packages/db/src/local/path.ts`:

```ts
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const DEFAULT_LOCAL_DB_RELATIVE_PATH = join(".midday", "midday.sqlite");

type LocalDbPathEnv = Pick<
  NodeJS.ProcessEnv,
  "MIDDAY_DESKTOP_DATA_DIR" | "MIDDAY_SQLITE_PATH"
>;

export type ResolveLocalDbPathOptions = {
  cwd?: string;
  ensureDir?: boolean;
  env?: LocalDbPathEnv;
};

export function resolveLocalDbPath(options: ResolveLocalDbPathOptions = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const explicitPath = env.MIDDAY_SQLITE_PATH?.trim();
  const desktopDataDir = env.MIDDAY_DESKTOP_DATA_DIR?.trim();
  const dbPath =
    explicitPath ||
    (desktopDataDir
      ? join(desktopDataDir, "midday.sqlite")
      : DEFAULT_LOCAL_DB_RELATIVE_PATH);
  const resolvedPath = isAbsolute(dbPath) ? dbPath : resolve(cwd, dbPath);

  if (options.ensureDir !== false) {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  return resolvedPath;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk cmd /c bun test packages/db/src/local/client.test.ts`

Expected: PASS for the path tests.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/db/src/local/path.ts packages/db/src/local/client.test.ts
rtk git commit -m "feat(db): resolve local sqlite path"
```

---

### Task 2: Local Schema and Migrations

**Files:**
- Create: `packages/db/src/local/schema.ts`
- Create: `packages/db/src/local/migrations.ts`
- Modify: `packages/db/src/local/client.test.ts`

- [ ] **Step 1: Add failing migration tests**

Append these imports:

```ts
import { Database as BunDatabase } from "bun:sqlite";
import { migrateLocalDb } from "./migrations";
```

Append these tests:

```ts
describe("migrateLocalDb", () => {
  test("creates the local bootstrap tables and records the migration", () => {
    const cwd = createTempDir();
    const sqlite = new BunDatabase(join(cwd, "midday.sqlite"), {
      create: true,
      readwrite: true,
    });

    try {
      const result = migrateLocalDb(sqlite);
      const tables = sqlite
        .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const versions = sqlite
        .query("SELECT version FROM local_migrations ORDER BY version")
        .all() as Array<{ version: number }>;

      expect(result.applied).toEqual([1]);
      expect(tables.map((table) => table.name)).toContain("local_meta");
      expect(tables.map((table) => table.name)).toContain("local_sessions");
      expect(versions).toEqual([{ version: 1 }]);
    } finally {
      sqlite.close();
    }
  });

  test("is idempotent after migrations have already run", () => {
    const cwd = createTempDir();
    const sqlite = new BunDatabase(join(cwd, "midday.sqlite"), {
      create: true,
      readwrite: true,
    });

    try {
      migrateLocalDb(sqlite);
      const result = migrateLocalDb(sqlite);
      const versions = sqlite
        .query("SELECT version FROM local_migrations ORDER BY version")
        .all() as Array<{ version: number }>;

      expect(result.applied).toEqual([]);
      expect(versions).toEqual([{ version: 1 }]);
    } finally {
      sqlite.close();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk cmd /c bun test packages/db/src/local/client.test.ts`

Expected: FAIL because `migrations.ts` and `schema.ts` do not exist.

- [ ] **Step 3: Implement SQLite schema**

Create `packages/db/src/local/schema.ts`:

```ts
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const localMeta = sqliteTable("local_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const localMigrations = sqliteTable("local_migrations", {
  version: integer("version").primaryKey(),
  name: text("name").notNull(),
  appliedAt: text("applied_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const localUsers = sqliteTable(
  "local_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("local_users_email_idx").on(table.email)],
);

export const localTeams = sqliteTable("local_teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseCurrency: text("base_currency").notNull().default("USD"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const localUsersOnTeams = sqliteTable(
  "local_users_on_teams",
  {
    userId: text("user_id")
      .notNull()
      .references(() => localUsers.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => localTeams.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.teamId] }),
    index("local_users_on_teams_team_id_idx").on(table.teamId),
  ],
);

export const localSessions = sqliteTable(
  "local_sessions",
  {
    token: text("token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => localUsers.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => localTeams.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("local_sessions_user_id_idx").on(table.userId),
    index("local_sessions_team_id_idx").on(table.teamId),
  ],
);
```

- [ ] **Step 4: Implement migration runner**

Create `packages/db/src/local/migrations.ts`:

```ts
import type { Database as BunDatabase } from "bun:sqlite";

export type LocalMigration = {
  name: string;
  statements: string[];
  version: number;
};

export type LocalMigrationResult = {
  applied: number[];
  version: number;
};

export const LOCAL_MIGRATIONS: LocalMigration[] = [
  {
    version: 1,
    name: "bootstrap_local_identity",
    statements: [
      `CREATE TABLE IF NOT EXISTS local_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS local_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT,
        avatar_url TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS local_teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_currency TEXT NOT NULL DEFAULT 'USD',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS local_users_on_teams (
        user_id TEXT NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
        team_id TEXT NOT NULL REFERENCES local_teams(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'owner',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, team_id)
      )`,
      `CREATE INDEX IF NOT EXISTS local_users_on_teams_team_id_idx
        ON local_users_on_teams(team_id)`,
      `CREATE TABLE IF NOT EXISTS local_sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
        team_id TEXT NOT NULL REFERENCES local_teams(id) ON DELETE CASCADE,
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS local_sessions_user_id_idx
        ON local_sessions(user_id)`,
      `CREATE INDEX IF NOT EXISTS local_sessions_team_id_idx
        ON local_sessions(team_id)`,
    ],
  },
];

function getCurrentVersion(sqlite: BunDatabase) {
  const row = sqlite
    .query("SELECT COALESCE(MAX(version), 0) AS version FROM local_migrations")
    .get() as { version: number } | null;

  return row?.version ?? 0;
}

export function migrateLocalDb(sqlite: BunDatabase): LocalMigrationResult {
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(`CREATE TABLE IF NOT EXISTS local_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const currentVersion = getCurrentVersion(sqlite);
  const applied: number[] = [];

  for (const migration of LOCAL_MIGRATIONS) {
    if (migration.version <= currentVersion) {
      continue;
    }

    const applyMigration = sqlite.transaction(() => {
      for (const statement of migration.statements) {
        sqlite.exec(statement);
      }

      sqlite
        .query("INSERT INTO local_migrations (version, name) VALUES (?, ?)")
        .run(migration.version, migration.name);
    });

    applyMigration();
    applied.push(migration.version);
  }

  return {
    applied,
    version: LOCAL_MIGRATIONS.at(-1)?.version ?? 0,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `rtk cmd /c bun test packages/db/src/local/client.test.ts`

Expected: PASS for path and migration tests.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/db/src/local/schema.ts packages/db/src/local/migrations.ts packages/db/src/local/client.test.ts
rtk git commit -m "feat(db): add local sqlite migrations"
```

---

### Task 3: Local Client and Workspace Seed

**Files:**
- Create: `packages/db/src/local/client.ts`
- Modify: `packages/db/src/local/client.test.ts`

- [ ] **Step 1: Add failing client tests**

Append these imports:

```ts
import {
  closeLocalDb,
  connectLocalDb,
  getLocalDbFilePath,
  seedLocalWorkspace,
} from "./client";
import { localSessions, localTeams, localUsers } from "./schema";
```

Append these tests:

```ts
describe("connectLocalDb", () => {
  test("opens a migrated SQLite file and exposes a Drizzle client", () => {
    const cwd = createTempDir();
    const path = join(cwd, "state", "midday.sqlite");

    const local = connectLocalDb({ path });

    try {
      const rows = local.db.select().from(localUsers).all();
      const migrations = local.sqlite
        .query("SELECT version FROM local_migrations ORDER BY version")
        .all() as Array<{ version: number }>;

      expect(local.path).toBe(path);
      expect(rows).toEqual([]);
      expect(migrations).toEqual([{ version: 1 }]);
      expect(getLocalDbFilePath({ path })).toBe(path);
    } finally {
      local.close();
      closeLocalDb();
    }
  });
});

describe("seedLocalWorkspace", () => {
  test("creates and updates a local owner, team, membership, and session", () => {
    const cwd = createTempDir();
    const local = connectLocalDb({ path: join(cwd, "midday.sqlite") });

    try {
      const seeded = seedLocalWorkspace(local, {
        email: "local@example.com",
        name: "Local Owner",
        sessionToken: "session_token",
        teamId: "team_local",
        teamName: "Local Team",
        userId: "user_local",
      });
      seedLocalWorkspace(local, {
        email: "local@example.com",
        name: "Renamed Owner",
        sessionToken: "session_token",
        teamId: "team_local",
        teamName: "Renamed Team",
        userId: "user_local",
      });

      const users = local.db.select().from(localUsers).all();
      const teams = local.db.select().from(localTeams).all();
      const sessions = local.db.select().from(localSessions).all();

      expect(seeded).toEqual({
        sessionToken: "session_token",
        teamId: "team_local",
        userId: "user_local",
      });
      expect(users).toHaveLength(1);
      expect(users[0]?.name).toBe("Renamed Owner");
      expect(teams).toHaveLength(1);
      expect(teams[0]?.name).toBe("Renamed Team");
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.token).toBe("session_token");
    } finally {
      local.close();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk cmd /c bun test packages/db/src/local/client.test.ts`

Expected: FAIL because `client.ts` does not exist.

- [ ] **Step 3: Implement local client**

Create `packages/db/src/local/client.ts`:

```ts
import { Database as BunDatabase } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { nanoid } from "nanoid";
import { migrateLocalDb, type LocalMigrationResult } from "./migrations";
import { resolveLocalDbPath, type ResolveLocalDbPathOptions } from "./path";
import * as schema from "./schema";

type LocalDbEnv = ResolveLocalDbPathOptions["env"];

export type ConnectLocalDbOptions = {
  cwd?: string;
  env?: LocalDbEnv;
  path?: string;
};

export type SeedLocalWorkspaceInput = {
  baseCurrency?: string;
  email?: string;
  expiresAt?: Date | string | null;
  name?: string | null;
  now?: Date | string;
  sessionToken?: string | null;
  teamId?: string;
  teamName?: string;
  userId?: string;
};

export type SeedLocalWorkspaceResult = {
  sessionToken: string | null;
  teamId: string;
  userId: string;
};

function createDrizzleClient(sqlite: BunDatabase) {
  return drizzle(sqlite, { schema });
}

export type LocalDrizzleDatabase = ReturnType<typeof createDrizzleClient>;

export type LocalDatabase = {
  db: LocalDrizzleDatabase;
  migrate: () => LocalMigrationResult;
  path: string;
  sqlite: BunDatabase;
  close: () => void;
};

let localDb: LocalDatabase | undefined;

function toIsoString(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function configureSqlite(sqlite: BunDatabase) {
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA busy_timeout = 5000");
}

export function getLocalDbFilePath(options: ConnectLocalDbOptions = {}) {
  if (options.path) {
    return options.path;
  }

  return resolveLocalDbPath({ cwd: options.cwd, env: options.env });
}

export function connectLocalDb(
  options: ConnectLocalDbOptions = {},
): LocalDatabase {
  const path = getLocalDbFilePath(options);
  const sqlite = new BunDatabase(path, { create: true, readwrite: true });

  configureSqlite(sqlite);

  const local: LocalDatabase = {
    db: createDrizzleClient(sqlite),
    migrate: () => migrateLocalDb(sqlite),
    path,
    sqlite,
    close: () => sqlite.close(),
  };

  local.migrate();
  return local;
}

export function getLocalDb(options: ConnectLocalDbOptions = {}) {
  localDb ??= connectLocalDb(options);
  return localDb;
}

export function closeLocalDb() {
  localDb?.close();
  localDb = undefined;
}

export function seedLocalWorkspace(
  local: LocalDatabase,
  input: SeedLocalWorkspaceInput = {},
): SeedLocalWorkspaceResult {
  const userId = input.userId ?? `local_user_${nanoid(12)}`;
  const teamId = input.teamId ?? `local_team_${nanoid(12)}`;
  const sessionToken =
    input.sessionToken === undefined
      ? `local_session_${nanoid(32)}`
      : input.sessionToken;
  const now = toIsoString(input.now) ?? new Date().toISOString();
  const expiresAt = toIsoString(input.expiresAt);
  const email = input.email ?? "local@midday.local";
  const teamName = input.teamName ?? "Local Workspace";

  const seed = local.sqlite.transaction(() => {
    local.sqlite
      .query(
        `INSERT INTO local_users (id, email, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          email = excluded.email,
          name = excluded.name,
          updated_at = excluded.updated_at`,
      )
      .run(userId, email, input.name ?? null, now, now);

    local.sqlite
      .query(
        `INSERT INTO local_teams (id, name, base_currency, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          base_currency = excluded.base_currency,
          updated_at = excluded.updated_at`,
      )
      .run(teamId, teamName, input.baseCurrency ?? "USD", now, now);

    local.sqlite
      .query(
        `INSERT INTO local_users_on_teams (user_id, team_id, role, created_at)
        VALUES (?, ?, 'owner', ?)
        ON CONFLICT(user_id, team_id) DO UPDATE SET role = excluded.role`,
      )
      .run(userId, teamId, now);

    if (sessionToken) {
      local.sqlite
        .query(
          `INSERT INTO local_sessions (
            token,
            user_id,
            team_id,
            expires_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(token) DO UPDATE SET
            user_id = excluded.user_id,
            team_id = excluded.team_id,
            expires_at = excluded.expires_at,
            updated_at = excluded.updated_at`,
        )
        .run(sessionToken, userId, teamId, expiresAt, now, now);
    }
  });

  seed();

  return { sessionToken, teamId, userId };
}

export { migrateLocalDb, resolveLocalDbPath, schema };
export type { LocalMigrationResult, ResolveLocalDbPathOptions };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk cmd /c bun test packages/db/src/local/client.test.ts`

Expected: PASS for all local SQLite tests.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/db/src/local/client.ts packages/db/src/local/client.test.ts
rtk git commit -m "feat(db): add local sqlite client"
```

---

### Task 4: Package Export and Verification Script

**Files:**
- Modify: `packages/db/package.json`

- [ ] **Step 1: Add package export and script**

Modify `packages/db/package.json`:

```json
{
  "scripts": {
    "test:local": "bun test src/local/client.test.ts"
  },
  "exports": {
    "./local-client": "./src/local/client.ts"
  }
}
```

Keep the existing scripts and exports; only insert the new entries.

- [ ] **Step 2: Verify focused package script**

Run: `rtk cmd /c bun run --filter @midday/db test:local`

Expected: PASS for `packages/db/src/local/client.test.ts`.

- [ ] **Step 3: Verify package typecheck**

Run: `rtk cmd /c bun run --filter @midday/db typecheck`

Expected: PASS, or a documented pre-existing failure outside `packages/db/src/local`.

- [ ] **Step 4: Commit**

```bash
rtk git add packages/db/package.json
rtk git commit -m "chore(db): expose local sqlite client"
```

---

### Task 5: Phase Review

**Files:**
- Review: `packages/db/src/local/*`
- Review: `packages/db/package.json`

- [ ] **Step 1: Run complete focused verification**

Run:

```bash
rtk cmd /c bun run --filter @midday/db test:local
rtk cmd /c bun run --filter @midday/db typecheck
rtk git diff --check
rtk git status --short
```

Expected:
- Local SQLite tests pass.
- Typecheck passes or only reports pre-existing non-local failures.
- `git diff --check` reports no whitespace errors.
- `git status --short` is clean after commits.

- [ ] **Step 2: Self-review against the goal**

Confirm:
- The existing Postgres client is not changed.
- The new local client is available through `@midday/db/local-client`.
- SQLite file location can be controlled by desktop runtime env.
- Migrations are idempotent.
- Local workspace seed can create and update local identity/session rows.

- [ ] **Step 3: Record next phase blocker**

The next phase should switch API/dashboard local runtime code away from import-time Supabase and external banking env requirements. This phase only creates the embedded database foundation required for that work.
