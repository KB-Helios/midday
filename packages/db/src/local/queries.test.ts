import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeLocalDb,
  connectLocalDb,
  seedLocalWorkspace,
} from "./client";
import {
  getSeededLocalDb,
  getLocalOverviewSummary,
  getLocalTeamById,
  getLocalTeamMembersByTeamId,
  getLocalTeamsByUserId,
  getLocalUserById,
  hasLocalTeamAccess,
  switchLocalUserTeam,
  updateLocalTeamById,
  updateLocalUser,
} from "./queries";

const tempDirs: string[] = [];

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "midday-local-queries-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  closeLocalDb();
  Bun.gc(true);

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("local identity queries", () => {
  test("reads the seeded local user, team, and membership", () => {
    const local = connectLocalDb({
      path: join(createTempDir(), "midday.sqlite"),
    });

    try {
      seedLocalWorkspace(local, {
        baseCurrency: "SEK",
        email: "owner@example.com",
        name: "Local Owner",
        teamName: "Local Team",
      });

      const user = getLocalUserById(local, "local_user");
      const team = getLocalTeamById(local, "local_team");
      const teams = getLocalTeamsByUserId(local, "local_user");
      const members = getLocalTeamMembersByTeamId(local, "local_team");

      expect(user).toMatchObject({
        id: "local_user",
        fullName: "Local Owner",
        email: "owner@example.com",
        teamId: "local_team",
        team: { id: "local_team", name: "Local Team", baseCurrency: "SEK" },
      });
      expect(team).toMatchObject({
        id: "local_team",
        name: "Local Team",
        baseCurrency: "SEK",
        plan: "pro",
      });
      expect(teams).toHaveLength(1);
      expect(teams[0]).toMatchObject({
        id: "local_team",
        name: "Local Team",
        role: "owner",
      });
      expect(members).toEqual([
        {
          id: "local_user:local_team",
          role: "owner",
          teamId: "local_team",
          user: {
            id: "local_user",
            fullName: "Local Owner",
            avatarUrl: null,
            email: "owner@example.com",
          },
        },
      ]);
      expect(hasLocalTeamAccess(local, "local_team", "local_user")).toBe(true);
    } finally {
      local.close();
    }
  });

  test("updates local user and team profile fields", () => {
    const local = connectLocalDb({
      path: join(createTempDir(), "midday.sqlite"),
    });

    try {
      seedLocalWorkspace(local);

      expect(
        updateLocalUser(local, {
          id: "local_user",
          fullName: "Renamed Owner",
        }),
      ).toMatchObject({ fullName: "Renamed Owner" });

      expect(
        updateLocalTeamById(local, {
          id: "local_team",
          data: { baseCurrency: "EUR", name: "Renamed Team" },
        }),
      ).toMatchObject({ baseCurrency: "EUR", name: "Renamed Team" });

      expect(getLocalUserById(local, "local_user")).toMatchObject({
        fullName: "Renamed Owner",
        team: { baseCurrency: "EUR", name: "Renamed Team" },
      });
    } finally {
      local.close();
    }
  });

  test("seeds the default local workspace only once per database", () => {
    const previousPath = process.env.MIDDAY_SQLITE_PATH;
    process.env.MIDDAY_SQLITE_PATH = join(createTempDir(), "midday.sqlite");

    try {
      const local = getSeededLocalDb();

      expect(getLocalUserById(local, "local_user")).toMatchObject({
        fullName: "Local User",
      });

      updateLocalUser(local, {
        id: "local_user",
        fullName: "Renamed Owner",
      });

      expect(getSeededLocalDb()).toBe(local);
      expect(getLocalUserById(local, "local_user")).toMatchObject({
        fullName: "Renamed Owner",
      });
    } finally {
      if (previousPath === undefined) {
        delete process.env.MIDDAY_SQLITE_PATH;
      } else {
        process.env.MIDDAY_SQLITE_PATH = previousPath;
      }
    }
  });

  test("returns empty overview summary with team currency", () => {
    const local = connectLocalDb({
      path: join(createTempDir(), "midday.sqlite"),
    });

    try {
      seedLocalWorkspace(local, { baseCurrency: "GBP" });

      expect(
        getLocalOverviewSummary(local, { teamId: "local_team" }),
      ).toMatchObject({
        cashBalance: { accountCount: 0, currency: "GBP", totalBalance: 0 },
        inboxPending: { count: 0 },
        openInvoices: { count: 0, currency: "GBP", totalAmount: 0 },
        runway: 0,
        transactionsToReview: { count: 0 },
        unbilledTime: {
          currency: "GBP",
          projectCount: 0,
          totalAmount: 0,
          totalDuration: 0,
        },
      });
    } finally {
      local.close();
    }
  });

  test("switches the active team through the local session", () => {
    const local = connectLocalDb({
      path: join(createTempDir(), "midday.sqlite"),
    });

    try {
      seedLocalWorkspace(local);
      seedLocalWorkspace(local, {
        sessionToken: null,
        teamId: "second_team",
        teamName: "Second Team",
      });

      const result = switchLocalUserTeam(local, {
        userId: "local_user",
        teamId: "second_team",
      });

      expect(result).toEqual({
        id: "local_user",
        previousTeamId: "local_team",
        teamId: "second_team",
      });
      expect(getLocalUserById(local, "local_user")).toMatchObject({
        teamId: "second_team",
        team: { name: "Second Team" },
      });
    } finally {
      local.close();
    }
  });
});
