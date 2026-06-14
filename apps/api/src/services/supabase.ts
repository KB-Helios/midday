import type { Database } from "@midday/supabase/types";
import {
  createLocalSupabaseClient,
  isLocalDesktopRuntime,
} from "@midday/supabase/local-client";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export async function createClient(accessToken?: string) {
  if (isLocalDesktopRuntime()) {
    return createLocalSupabaseClient();
  }

  return createSupabaseClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      accessToken() {
        return Promise.resolve(accessToken || "");
      },
    },
  );
}

export async function createAdminClient() {
  if (isLocalDesktopRuntime()) {
    return createLocalSupabaseClient();
  }

  return createSupabaseClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
  );
}
