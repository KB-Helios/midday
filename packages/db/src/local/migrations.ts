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
        .query("INSERT OR IGNORE INTO local_migrations (version, name) VALUES (?, ?)")
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
