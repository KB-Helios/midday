import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const DEFAULT_LOCAL_DB_RELATIVE_PATH = join(".midday", "midday.sqlite");

type LocalDbPathEnv = Partial<
  Pick<
  NodeJS.ProcessEnv,
  "MIDDAY_DESKTOP_DATA_DIR" | "MIDDAY_SQLITE_PATH"
  >
>;

export type ResolveLocalDbPathOptions = {
  cwd?: string;
  ensureDir?: boolean;
  env?: LocalDbPathEnv;
};

export function resolveLocalDbPath(options: ResolveLocalDbPathOptions = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const explicitPath = env.MIDDAY_SQLITE_PATH?.trim();
  const desktopDataDir = env.MIDDAY_DESKTOP_DATA_DIR?.trim();
  const dbPath =
    explicitPath ||
    (desktopDataDir
      ? join(desktopDataDir, "midday.sqlite")
      : DEFAULT_LOCAL_DB_RELATIVE_PATH);
  const resolvedPath = isAbsolute(dbPath) ? dbPath : resolve(cwd, dbPath);

  if (options.ensureDir !== false) {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  return resolvedPath;
}
