import { describe, expect, test } from "bun:test";
import {
  isLocalDesktopRuntime,
  LOCAL_DESKTOP_SESSION_TOKEN,
  LOCAL_DESKTOP_TEAM_ID,
  LOCAL_DESKTOP_USER_ID,
} from "./envs";

describe("isLocalDesktopRuntime", () => {
  test("detects server-side local desktop runtime", () => {
    expect(isLocalDesktopRuntime({ MIDDAY_DESKTOP_RUNTIME: "local" })).toBe(
      true,
    );
    expect(isLocalDesktopRuntime({ MIDDAY_LOCAL_FIRST: "true" })).toBe(true);
  });

  test("detects client-exposed local desktop runtime", () => {
    expect(
      isLocalDesktopRuntime({ NEXT_PUBLIC_MIDDAY_DESKTOP_RUNTIME: "local" }),
    ).toBe(true);
    expect(isLocalDesktopRuntime({ NEXT_PUBLIC_MIDDAY_LOCAL_FIRST: "1" })).toBe(
      true,
    );
  });

  test("does not treat remote desktop runtime as local", () => {
    expect(isLocalDesktopRuntime({ MIDDAY_DESKTOP_RUNTIME: "remote" })).toBe(
      false,
    );
    expect(isLocalDesktopRuntime({})).toBe(false);
  });

  test("exports stable local identity constants", () => {
    expect(LOCAL_DESKTOP_USER_ID).toBe("local_user");
    expect(LOCAL_DESKTOP_TEAM_ID).toBe("local_team");
    expect(LOCAL_DESKTOP_SESSION_TOKEN).toBe("local_session");
  });
});
