import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
