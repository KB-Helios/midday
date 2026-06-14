import { afterEach, describe, expect, test } from "bun:test";
import { Database as BunDatabase } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { migrateLocalDb } from "./migrations";
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
