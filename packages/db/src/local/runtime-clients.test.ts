import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeLocalDb } from "./client";

const originalEnv = {
  DATABASE_PRIMARY_POOLER_URL: process.env.DATABASE_PRIMARY_POOLER_URL,
  DATABASE_PRIMARY_URL: process.env.DATABASE_PRIMARY_URL,
  MIDDAY_DESKTOP_RUNTIME: process.env.MIDDAY_DESKTOP_RUNTIME,
  MIDDAY_LOCAL_FIRST: process.env.MIDDAY_LOCAL_FIRST,
  MIDDAY_SQLITE_PATH: process.env.MIDDAY_SQLITE_PATH,
};

const tempDirs: string[] = [];

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "midday-local-runtime-db-"));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  process.env.MIDDAY_DESKTOP_RUNTIME = "local";
  process.env.MIDDAY_LOCAL_FIRST = "true";
  delete process.env.DATABASE_PRIMARY_POOLER_URL;
  delete process.env.DATABASE_PRIMARY_URL;
});

afterEach(() => {
  closeLocalDb();
  Bun.gc(true);

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("local runtime database clients", () => {
  test("worker client imports without Postgres connection strings", async () => {
    const { getWorkerPoolStats } = await import("@midday/db/worker-client");

    expect(getWorkerPoolStats()).toEqual({ total: 0, idle: 0, waiting: 0 });
  });

  test("job client uses local SQLite in local desktop mode", async () => {
    const cwd = createTempDir();
    process.env.MIDDAY_SQLITE_PATH = join(cwd, "midday.sqlite");

    const { createJobDb } = await import("@midday/db/job-client");
    const { disconnect } = createJobDb();

    await disconnect();

    expect(existsSync(process.env.MIDDAY_SQLITE_PATH)).toBe(true);
  });
});
