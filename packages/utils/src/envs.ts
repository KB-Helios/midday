export function getAppUrl() {
  // Allow explicit override via DASHBOARD_URL env var
  if (process.env.DASHBOARD_URL) {
    return process.env.DASHBOARD_URL;
  }

  // When running in Railway, use RAILWAY_ENVIRONMENT as the source of truth
  // (NODE_ENV is always "production" in Docker builds, even for staging)
  if (process.env.RAILWAY_ENVIRONMENT) {
    if (process.env.RAILWAY_ENVIRONMENT === "production") {
      return "https://app.midday.ai";
    }

    // Non-production Railway environment (staging, etc.)
    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
      return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    }
  }

  // Non-Railway production (e.g. other hosting platforms)
  if (process.env.NODE_ENV === "production") {
    return "https://app.midday.ai";
  }

  return "http://localhost:3001";
}

export function getEmailUrl() {
  if (process.env.NODE_ENV === "development") {
    return "http://localhost:3000";
  }

  return "https://midday.ai";
}

export function getCdnUrl() {
  return "https://cdn.midday.ai";
}

export function getApiUrl() {
  // Allow explicit override via API_URL env var
  if (process.env.API_URL) {
    return process.env.API_URL;
  }

  // When running in Railway, use RAILWAY_ENVIRONMENT as the source of truth
  // (NODE_ENV is always "production" in Docker builds, even for staging)
  if (process.env.RAILWAY_ENVIRONMENT) {
    if (process.env.RAILWAY_ENVIRONMENT === "production") {
      return "https://api.midday.ai";
    }

    // Non-production Railway environment (staging, etc.)
    // Fall through to localhost — override with API_URL env var in staging
    return "http://localhost:3002";
  }

  // Non-Railway production (e.g. other hosting platforms)
  if (process.env.NODE_ENV === "production") {
    return "https://api.midday.ai";
  }

  return "http://localhost:3002";
}

type LocalRuntimeEnv = Record<string, string | undefined>;

export const LOCAL_DESKTOP_USER_ID = "local_user";
export const LOCAL_DESKTOP_TEAM_ID = "local_team";
export const LOCAL_DESKTOP_SESSION_TOKEN = "local_session";

function isEnabled(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}

export function isLocalDesktopRuntime(env: LocalRuntimeEnv = process.env) {
  const runtime =
    env.MIDDAY_DESKTOP_RUNTIME ?? env.NEXT_PUBLIC_MIDDAY_DESKTOP_RUNTIME;

  return (
    runtime?.toLowerCase() === "local" ||
    isEnabled(env.MIDDAY_LOCAL_FIRST) ||
    isEnabled(env.NEXT_PUBLIC_MIDDAY_LOCAL_FIRST)
  );
}
