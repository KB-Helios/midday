import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const localMeta = sqliteTable("local_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const localMigrations = sqliteTable("local_migrations", {
  version: integer("version").primaryKey(),
  name: text("name").notNull(),
  appliedAt: text("applied_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const localUsers = sqliteTable(
  "local_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("local_users_email_idx").on(table.email)],
);

export const localTeams = sqliteTable("local_teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseCurrency: text("base_currency").notNull().default("USD"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const localUsersOnTeams = sqliteTable(
  "local_users_on_teams",
  {
    userId: text("user_id")
      .notNull()
      .references(() => localUsers.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => localTeams.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.teamId] }),
    index("local_users_on_teams_team_id_idx").on(table.teamId),
  ],
);

export const localSessions = sqliteTable(
  "local_sessions",
  {
    token: text("token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => localUsers.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => localTeams.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("local_sessions_user_id_idx").on(table.userId),
    index("local_sessions_team_id_idx").on(table.teamId),
  ],
);
