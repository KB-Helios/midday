import { afterEach, beforeEach, describe, expect, test } from "bun:test";

const originalEnv = {
  MIDDAY_DESKTOP_RUNTIME: process.env.MIDDAY_DESKTOP_RUNTIME,
  MIDDAY_LOCAL_FIRST: process.env.MIDDAY_LOCAL_FIRST,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  SENDBLUE_API_KEY: process.env.SENDBLUE_API_KEY,
  SENDBLUE_API_SECRET: process.env.SENDBLUE_API_SECRET,
};

beforeEach(() => {
  process.env.MIDDAY_DESKTOP_RUNTIME = "local";
  process.env.MIDDAY_LOCAL_FIRST = "true";
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.SENDBLUE_API_KEY;
  delete process.env.SENDBLUE_API_SECRET;
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

describe("bot local runtime", () => {
  test("imports a no-op bot without external adapter secrets", async () => {
    const { bot } = await import("./instance");

    await expect(bot.initialize()).resolves.toBeUndefined();
    expect(bot.getAdapter("slack")).toBeNull();
  });
});
