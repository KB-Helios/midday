import { afterEach, beforeEach, describe, expect, test } from "bun:test";

const originalEnv = {
  COMPOSIO_API_KEY: process.env.COMPOSIO_API_KEY,
  MIDDAY_DESKTOP_RUNTIME: process.env.MIDDAY_DESKTOP_RUNTIME,
  MIDDAY_LOCAL_FIRST: process.env.MIDDAY_LOCAL_FIRST,
};

beforeEach(() => {
  process.env.MIDDAY_DESKTOP_RUNTIME = "local";
  process.env.MIDDAY_LOCAL_FIRST = "true";
  delete process.env.COMPOSIO_API_KEY;
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("local Composio client", () => {
  test("imports without an API key and returns empty local data", async () => {
    const { composio, getComposioTools } = await import("./client");
    const session = await composio.create("local_user");
    const toolkits = await session.toolkits({ limit: 50 });
    const tools = await getComposioTools("local_user");

    expect(toolkits.items).toEqual([]);
    expect(tools).toEqual({});
  });
});
