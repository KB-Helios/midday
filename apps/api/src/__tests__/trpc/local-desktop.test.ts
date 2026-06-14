import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LOCAL_DESKTOP_SESSION_TOKEN,
  LOCAL_DESKTOP_TEAM_ID,
  LOCAL_DESKTOP_USER_ID,
} from "@midday/utils/envs";

const originalEnv = {
  FILE_KEY_SECRET: process.env.FILE_KEY_SECRET,
  MIDDAY_DESKTOP_RUNTIME: process.env.MIDDAY_DESKTOP_RUNTIME,
  MIDDAY_LOCAL_FIRST: process.env.MIDDAY_LOCAL_FIRST,
  MIDDAY_SQLITE_PATH: process.env.MIDDAY_SQLITE_PATH,
};

const tempDirs: string[] = [];

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "midday-api-local-desktop-"));
  tempDirs.push(dir);
  return dir;
}

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

beforeEach(() => {
  process.env.MIDDAY_DESKTOP_RUNTIME = "local";
  process.env.MIDDAY_LOCAL_FIRST = "true";
  process.env.FILE_KEY_SECRET = "test-local-desktop-file-key-secret";
  process.env.MIDDAY_SQLITE_PATH = join(createTempDir(), "midday.sqlite");
});

afterEach(async () => {
  const { closeLocalDb } = await import("@midday/db/local-client");
  closeLocalDb();
  Bun.gc(true);

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }

  restoreEnv();
});

async function createLocalCaller() {
  const [{ createCallerFactory }, { appRouter }] = await Promise.all([
    import("../../trpc/init"),
    import("../../trpc/routers/_app"),
  ]);
  const createCaller = createCallerFactory(appRouter);

  return createCaller({
    cfRay: undefined,
    db: {} as never,
    forcePrimary: false,
    geo: {
      city: null,
      continent: null,
      country: "US",
      ip: "127.0.0.1",
      locale: "en-US",
      region: null,
      timezone: "America/New_York",
    },
    isInternalRequest: false,
    requestId: "local-desktop-test",
    session: {
      teamId: LOCAL_DESKTOP_TEAM_ID,
      user: {
        email: "local@midday.local",
        full_name: "Local Owner",
        id: LOCAL_DESKTOP_USER_ID,
      },
    },
    supabase: {} as never,
  });
}

describe("local desktop tRPC bootstrap", () => {
  test("serves initial dashboard data from embedded SQLite", async () => {
    const caller = await createLocalCaller();

    const user = await caller.user.me();
    const team = await caller.team.current();
    const teams = await caller.team.list();
    const overview = await caller.overview.summary();
    const searchResults = await caller.search.global({});
    const notifications = await caller.notifications.list();
    const invoiceDefaults = await caller.invoice.defaultSettings();

    expect(user).toMatchObject({
      id: LOCAL_DESKTOP_USER_ID,
      email: "local@midday.local",
      teamId: LOCAL_DESKTOP_TEAM_ID,
      team: { id: LOCAL_DESKTOP_TEAM_ID, name: "Local Workspace" },
    });
    expect(user?.fileKey).toBeTruthy();
    expect(team).toMatchObject({
      id: LOCAL_DESKTOP_TEAM_ID,
      name: "Local Workspace",
      baseCurrency: "USD",
    });
    expect(teams).toHaveLength(1);
    expect(overview).toMatchObject({
      cashBalance: { totalBalance: 0, currency: "USD", accountCount: 0 },
      openInvoices: { count: 0, totalAmount: 0, currency: "USD" },
      transactionsToReview: { count: 0 },
    });
    expect(searchResults).toEqual([]);
    expect(notifications).toEqual({
      meta: {
        cursor: null,
        hasPreviousPage: false,
        hasNextPage: false,
      },
      data: [],
    });
    expect(invoiceDefaults).toMatchObject({
      currency: "USD",
      invoiceNumber: "INV-0001",
      status: "draft",
    });
  });

  test("accepts the desktop session token through context auth", async () => {
    const [{ createTRPCContext }, { Hono }] = await Promise.all([
      import("../../trpc/init"),
      import("hono"),
    ]);
    const app = new Hono();
    let context: Awaited<ReturnType<typeof createTRPCContext>> | undefined;

    app.get("/", async (c) => {
      context = await createTRPCContext(undefined, c);
      return c.text("ok");
    });

    await app.request("http://localhost/", {
      headers: {
        Authorization: `Bearer ${LOCAL_DESKTOP_SESSION_TOKEN}`,
        "x-request-id": "local-desktop-test",
      },
    });

    expect(context?.session?.user.id).toBe(LOCAL_DESKTOP_USER_ID);
    expect(context?.session?.teamId).toBe(LOCAL_DESKTOP_TEAM_ID);
  });
});
