import { afterEach, describe, expect, test } from "bun:test";
import { Database as BunDatabase } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  closeLocalDb,
  connectLocalDb,
  getLocalDbFilePath,
  getLocalDb,
  seedLocalWorkspace,
} from "./client";
import { migrateLocalDb } from "./migrations";
import { resolveLocalDbPath } from "./path";
import { localSessions, localTeams, localUsers } from "./schema";

const tempDirs: string[] = [];

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "midday-local-db-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  closeLocalDb();
  // Drizzle-held SQLite statements can keep WAL files locked until GC on Windows.
  Bun.gc(true);

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
    }
  });

  test("opens a new singleton after the previous singleton was closed directly", () => {
    const cwd = createTempDir();
    const path = join(cwd, "state", "midday.sqlite");
    const first = getLocalDb({ path });

    first.close();

    const second = getLocalDb({ path });

    try {
      expect(second).not.toBe(first);
      expect(second.db.select().from(localUsers).all()).toEqual([]);
    } finally {
      second.close();
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

  test("is idempotent with default local workspace values", () => {
    const cwd = createTempDir();
    const local = connectLocalDb({ path: join(cwd, "midday.sqlite") });

    try {
      const first = seedLocalWorkspace(local);
      const second = seedLocalWorkspace(local);
      const users = local.db.select().from(localUsers).all();
      const teams = local.db.select().from(localTeams).all();
      const sessions = local.db.select().from(localSessions).all();

      expect(second).toEqual(first);
      expect(users).toHaveLength(1);
      expect(teams).toHaveLength(1);
      expect(sessions).toHaveLength(1);
    } finally {
      local.close();
    }
  });
});

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
