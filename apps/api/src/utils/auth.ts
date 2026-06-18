import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";
import {
  isLocalDesktopRuntime,
  LOCAL_DESKTOP_SESSION_TOKEN,
  LOCAL_DESKTOP_TEAM_ID,
  LOCAL_DESKTOP_USER_ID,
} from "@midday/utils/envs";

export type Session = {
  user: {
    id: string;
    email?: string;
    full_name?: string;
  };
  teamId?: string;
};

type SupabaseJWTPayload = JWTPayload & {
  user_metadata?: {
    email?: string;
    full_name?: string;
    [key: string]: string | undefined;
  };
};

// Fallback: HS256 shared secret for tokens issued before key rotation.
// Remove this once the legacy JWT secret is revoked in Supabase.
const HS256_SECRET = process.env.SUPABASE_JWT_SECRET
  ? new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET)
  : null;

let remoteJwks: ReturnType<typeof createRemoteJWKSet> | null | undefined;

function getRemoteJwks() {
  if (remoteJwks !== undefined) {
    return remoteJwks;
  }

  if (!process.env.SUPABASE_URL) {
    remoteJwks = null;
    return remoteJwks;
  }

  remoteJwks = createRemoteJWKSet(
    new URL(`${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
  );
  return remoteJwks;
}

function extractSession(payload: JWTPayload): Session {
  const p = payload as SupabaseJWTPayload;
  return {
    user: {
      id: p.sub!,
      email: p.user_metadata?.email,
      full_name: p.user_metadata?.full_name,
    },
  };
}

export async function verifyAccessToken(
  accessToken?: string,
): Promise<Session | null> {
  if (!accessToken) return null;

  if (
    isLocalDesktopRuntime() &&
    accessToken === LOCAL_DESKTOP_SESSION_TOKEN
  ) {
    return {
      teamId: LOCAL_DESKTOP_TEAM_ID,
      user: {
        id: LOCAL_DESKTOP_USER_ID,
        email: "local@midday.local",
        full_name: "Local User",
      },
    };
  }

  const jwks = getRemoteJwks();
  if (jwks) {
    try {
      const { payload } = await jwtVerify(accessToken, jwks);
      return extractSession(payload);
    } catch {
      // JWKS verification failed -- try HS256 fallback if configured.
    }
  }

  if (HS256_SECRET) {
    try {
      const { payload } = await jwtVerify(accessToken, HS256_SECRET);
      return extractSession(payload);
    } catch {
      // Both methods failed.
    }
  }

  return null;
}
