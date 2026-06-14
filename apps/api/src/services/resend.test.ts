import { afterEach, beforeEach, describe, expect, test } from "bun:test";

const originalEnv = {
  MIDDAY_DESKTOP_RUNTIME: process.env.MIDDAY_DESKTOP_RUNTIME,
  MIDDAY_LOCAL_FIRST: process.env.MIDDAY_LOCAL_FIRST,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
};

beforeEach(() => {
  process.env.MIDDAY_DESKTOP_RUNTIME = "local";
  process.env.MIDDAY_LOCAL_FIRST = "true";
  delete process.env.RESEND_API_KEY;
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

describe("local Resend service", () => {
  test("imports without an API key and no-ops email calls", async () => {
    const { resend } = await import("./resend");
    const result = (await resend.emails.send({} as never)) as unknown as {
      data: null;
      error: null;
    };

    expect(result).toEqual({
      data: null,
      error: null,
    });
  });
});
