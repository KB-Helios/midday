import {
  isLocalDesktopRuntime,
  LOCAL_DESKTOP_SESSION_TOKEN,
  LOCAL_DESKTOP_TEAM_ID,
  LOCAL_DESKTOP_USER_ID,
} from "@midday/utils/envs";
import type { SupabaseClient } from "@supabase/supabase-js";

const localUser = {
  id: LOCAL_DESKTOP_USER_ID,
  email: "local@midday.local",
  user_metadata: {
    full_name: "Local User",
    team_id: LOCAL_DESKTOP_TEAM_ID,
  },
  app_metadata: {},
  aud: "authenticated",
  created_at: "2020-01-01T00:00:00.000Z",
};

const localSession = {
  access_token: LOCAL_DESKTOP_SESSION_TOKEN,
  refresh_token: LOCAL_DESKTOP_SESSION_TOKEN,
  token_type: "bearer",
  expires_in: 31_536_000,
  expires_at: Math.floor(Date.now() / 1000) + 31_536_000,
  user: localUser,
};

function createLocalChannel() {
  return {
    on() {
      return this;
    },
    subscribe(callback?: (status: string) => void) {
      callback?.("SUBSCRIBED");
      return this;
    },
    unsubscribe: async () => "ok",
  };
}

export function createLocalSupabaseClient() {
  return {
    auth: {
      exchangeCodeForSession: async () => ({
        data: { session: localSession, user: localUser },
        error: null,
      }),
      getClaims: async () => ({
        data: { claims: { sub: LOCAL_DESKTOP_USER_ID } },
        error: null,
      }),
      getSession: async () => ({
        data: { session: localSession },
        error: null,
      }),
      getUser: async () => ({
        data: { user: localUser },
        error: null,
      }),
      signInWithOAuth: async () => ({
        data: { provider: "local", url: null },
        error: null,
      }),
      signInWithOtp: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      verifyOtp: async () => ({
        data: { session: localSession, user: localUser },
        error: null,
      }),
      mfa: {
        challenge: async () => ({
          data: { id: "local_mfa_challenge" },
          error: null,
        }),
        enroll: async () => ({
          data: { id: "local_mfa_factor" },
          error: null,
        }),
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: "aal1", nextLevel: "aal1" },
          error: null,
        }),
        listFactors: async () => ({
          data: { all: [], totp: [] },
          error: null,
        }),
        unenroll: async () => ({ data: {}, error: null }),
        verify: async () => ({ data: {}, error: null }),
      },
    },
    channel: () => createLocalChannel(),
    removeChannel: async () => ({ error: null }),
  } as unknown as SupabaseClient;
}

export { isLocalDesktopRuntime };
