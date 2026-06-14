import { LOCAL_DESKTOP_SESSION_TOKEN } from "@midday/utils/envs";
import { getLocalDb, seedLocalWorkspace, type LocalDatabase } from "./client";

export type LocalUserProfile = {
  id: string;
  fullName: string | null;
  email: string;
  avatarUrl: string | null;
  locale: string | null;
  timeFormat: number | null;
  dateFormat: string | null;
  weekStartsOnMonday: boolean | null;
  timezone: string | null;
  timezoneAutoSync: boolean | null;
  teamId: string | null;
  team: LocalTeamProfile | null;
};

export type LocalTeamProfile = {
  id: string;
  name: string;
  logoUrl: string | null;
  email: string | null;
  inboxId: string | null;
  plan: "trial" | "starter" | "pro";
  subscriptionStatus: string | null;
  canceledAt: string | null;
  baseCurrency: string;
  countryCode: string | null;
  fiscalYearStartMonth: number | null;
  exportSettings: null;
  stripeAccountId: string | null;
  stripeConnectStatus: string | null;
  createdAt?: string;
};

export type LocalTeamMember = {
  id: string;
  role: LocalTeamRole;
  teamId: string;
  user: {
    id: string;
    fullName: string | null;
    avatarUrl: string | null;
    email: string;
  } | null;
};

type LocalUserRow = {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
};

type LocalTeamRow = {
  id: string;
  name: string;
  base_currency: string;
  created_at: string | null;
};

type LocalMembershipRow = {
  role: string;
  team_id: string;
};

type LocalTeamRole = "owner" | "member";

export type LocalOverviewSummary = {
  openInvoices: {
    count: number;
    totalAmount: number;
    currency: string;
  };
  unbilledTime: {
    totalDuration: number;
    totalAmount: number;
    projectCount: number;
    currency: string;
  };
  inboxPending: {
    count: number;
  };
  transactionsToReview: {
    count: number;
  };
  cashBalance: {
    totalBalance: number;
    currency: string;
    accountCount: number;
  };
  runway: number;
};

function toLocalTeam(row: LocalTeamRow): LocalTeamProfile {
  return {
    id: row.id,
    name: row.name,
    logoUrl: null,
    email: null,
    inboxId: null,
    plan: "pro",
    subscriptionStatus: null,
    canceledAt: null,
    baseCurrency: row.base_currency,
    countryCode: null,
    fiscalYearStartMonth: null,
    exportSettings: null,
    stripeAccountId: null,
    stripeConnectStatus: null,
    createdAt: row.created_at ?? undefined,
  };
}

function toLocalTeamRole(role: string | null | undefined): LocalTeamRole {
  return role === "member" ? "member" : "owner";
}

function getLocalTeamRow(local: LocalDatabase, teamId: string) {
  return local.sqlite
    .query("SELECT id, name, base_currency, created_at FROM local_teams WHERE id = ?")
    .get(teamId) as LocalTeamRow | null;
}

function getActiveTeamRowForUser(local: LocalDatabase, userId: string) {
  const sessionTeam = local.sqlite
    .query(
      `SELECT t.id, t.name, t.base_currency, t.created_at
      FROM local_sessions s
      INNER JOIN local_teams t ON t.id = s.team_id
      WHERE s.user_id = ? AND s.token = ?
      LIMIT 1`,
    )
    .get(userId, LOCAL_DESKTOP_SESSION_TOKEN) as LocalTeamRow | null;

  if (sessionTeam) {
    return sessionTeam;
  }

  return local.sqlite
    .query(
      `SELECT t.id, t.name, t.base_currency, t.created_at
      FROM local_users_on_teams m
      INNER JOIN local_teams t ON t.id = m.team_id
      WHERE m.user_id = ?
      ORDER BY m.created_at
      LIMIT 1`,
    )
    .get(userId) as LocalTeamRow | null;
}

export function getSeededLocalDb() {
  const local = getLocalDb();
  seedLocalWorkspace(local);
  return local;
}

export function getLocalUserById(local: LocalDatabase, userId: string) {
  const user = local.sqlite
    .query("SELECT id, email, name, avatar_url FROM local_users WHERE id = ?")
    .get(userId) as LocalUserRow | null;

  if (!user) {
    return undefined;
  }

  const teamRow = getActiveTeamRowForUser(local, user.id);
  const team = teamRow ? toLocalTeam(teamRow) : null;

  return {
    id: user.id,
    fullName: user.name,
    email: user.email,
    avatarUrl: user.avatar_url,
    locale: null,
    timeFormat: null,
    dateFormat: null,
    weekStartsOnMonday: null,
    timezone: null,
    timezoneAutoSync: true,
    teamId: team?.id ?? null,
    team,
  } satisfies LocalUserProfile;
}

export function updateLocalUser(
  local: LocalDatabase,
  data: {
    id: string;
    avatarUrl?: string | null;
    email?: string | null;
    fullName?: string | null;
  },
) {
  const current = getLocalUserById(local, data.id);

  if (!current) {
    return undefined;
  }

  local.sqlite
    .query(
      `UPDATE local_users
      SET email = ?, name = ?, avatar_url = ?, updated_at = ?
      WHERE id = ?`,
    )
    .run(
      data.email ?? current.email,
      data.fullName === undefined ? current.fullName : data.fullName,
      data.avatarUrl === undefined ? current.avatarUrl : data.avatarUrl,
      new Date().toISOString(),
      data.id,
    );

  return getLocalUserById(local, data.id);
}

export function switchLocalUserTeam(
  local: LocalDatabase,
  params: { userId: string; teamId: string },
) {
  const previousTeamId = getLocalUserById(local, params.userId)?.teamId ?? null;

  if (!hasLocalTeamAccess(local, params.teamId, params.userId)) {
    throw new Error("User is not a member of the target team");
  }

  local.sqlite
    .query(
      `UPDATE local_sessions
      SET team_id = ?, updated_at = ?
      WHERE token = ? AND user_id = ?`,
    )
    .run(
      params.teamId,
      new Date().toISOString(),
      LOCAL_DESKTOP_SESSION_TOKEN,
      params.userId,
    );

  return {
    id: params.userId,
    teamId: params.teamId,
    previousTeamId,
  };
}

export function hasLocalTeamAccess(
  local: LocalDatabase,
  teamId: string,
  userId: string,
) {
  const membership = local.sqlite
    .query(
      `SELECT team_id
      FROM local_users_on_teams
      WHERE team_id = ? AND user_id = ?
      LIMIT 1`,
    )
    .get(teamId, userId) as { team_id: string } | null;

  return !!membership;
}

export function getLocalTeamById(local: LocalDatabase, teamId: string) {
  const row = getLocalTeamRow(local, teamId);
  return row ? toLocalTeam(row) : undefined;
}

export function updateLocalTeamById(
  local: LocalDatabase,
  params: {
    id: string;
    data: {
      baseCurrency?: string | null;
      name?: string | null;
    };
  },
) {
  const current = getLocalTeamById(local, params.id);

  if (!current) {
    return undefined;
  }

  local.sqlite
    .query(
      `UPDATE local_teams
      SET name = ?, base_currency = ?, updated_at = ?
      WHERE id = ?`,
    )
    .run(
      params.data.name ?? current.name,
      params.data.baseCurrency ?? current.baseCurrency,
      new Date().toISOString(),
      params.id,
    );

  return getLocalTeamById(local, params.id);
}

export function getLocalTeamMembersByTeamId(
  local: LocalDatabase,
  teamId: string,
) {
  const rows = local.sqlite
    .query(
      `SELECT
        m.role,
        m.team_id,
        u.id AS user_id,
        u.name AS user_name,
        u.avatar_url AS avatar_url,
        u.email AS user_email
      FROM local_users_on_teams m
      LEFT JOIN local_users u ON u.id = m.user_id
      WHERE m.team_id = ?
      ORDER BY m.created_at`,
    )
    .all(teamId) as Array<{
    avatar_url: string | null;
    role: string;
    team_id: string;
    user_email: string | null;
    user_id: string | null;
    user_name: string | null;
  }>;

  return rows.map((row) => ({
    id: `${row.user_id ?? "unknown"}:${row.team_id}`,
    role: toLocalTeamRole(row.role),
    teamId: row.team_id,
    user: row.user_id
      ? {
          id: row.user_id,
          fullName: row.user_name,
          avatarUrl: row.avatar_url,
          email: row.user_email ?? "",
        }
      : null,
  })) satisfies LocalTeamMember[];
}

export function getLocalTeamsByUserId(local: LocalDatabase, userId: string) {
  const rows = local.sqlite
    .query(
      `SELECT
        m.role,
        t.id,
        t.name,
        t.base_currency,
        t.created_at
      FROM local_users_on_teams m
      INNER JOIN local_teams t ON t.id = m.team_id
      WHERE m.user_id = ?
      ORDER BY m.created_at`,
    )
    .all(userId) as Array<LocalTeamRow & { role: string }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    plan: "pro" as const,
    role: toLocalTeamRole(row.role),
    createdAt: row.created_at,
    canceledAt: null,
    updatedAt: row.created_at,
    logoUrl: null,
  }));
}

export function getLocalOverviewSummary(
  local: LocalDatabase,
  params: { currency?: string; teamId: string },
): LocalOverviewSummary {
  const team = getLocalTeamById(local, params.teamId);
  const currency = params.currency ?? team?.baseCurrency ?? "USD";

  return {
    openInvoices: {
      count: 0,
      totalAmount: 0,
      currency,
    },
    unbilledTime: {
      totalDuration: 0,
      totalAmount: 0,
      projectCount: 0,
      currency,
    },
    inboxPending: {
      count: 0,
    },
    transactionsToReview: {
      count: 0,
    },
    cashBalance: {
      totalBalance: 0,
      currency,
      accountCount: 0,
    },
    runway: 0,
  };
}
