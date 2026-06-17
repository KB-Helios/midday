import { Database as BunDatabase } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import {
  LOCAL_DESKTOP_SESSION_TOKEN,
  LOCAL_DESKTOP_TEAM_ID,
  LOCAL_DESKTOP_USER_ID,
} from "@midday/utils/envs";
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
    return resolveLocalDbPath({
      cwd: options.cwd,
      env: { MIDDAY_SQLITE_PATH: options.path },
    });
  }

  return resolveLocalDbPath({ cwd: options.cwd, env: options.env });
}

export function connectLocalDb(
  options: ConnectLocalDbOptions = {},
): LocalDatabase {
  const path = getLocalDbFilePath(options);
  const sqlite = new BunDatabase(path, { create: true, readwrite: true });
  let closed = false;
  let local: LocalDatabase;

  try {
    configureSqlite(sqlite);

    local = {
      db: createDrizzleClient(sqlite),
      migrate: () => migrateLocalDb(sqlite),
      path,
      sqlite,
      close: () => {
        if (closed) {
          return;
        }

        sqlite.close();
        closed = true;

        if (localDb === local) {
          localDb = undefined;
        }
      },
    };

    local.migrate();
    return local;
  } catch (error) {
    sqlite.close();
    throw error;
  }
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
  const userId = input.userId ?? LOCAL_DESKTOP_USER_ID;
  const teamId = input.teamId ?? LOCAL_DESKTOP_TEAM_ID;
  const sessionToken =
    input.sessionToken === undefined
      ? LOCAL_DESKTOP_SESSION_TOKEN
      : input.sessionToken;
  const now = toIsoString(input.now) ?? new Date().toISOString();
  const expiresAt = toIsoString(input.expiresAt);
  const email = input.email ?? "local@midday.local";
  const name = input.name ?? "Local User";
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
      .run(userId, email, name, now, now);

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
