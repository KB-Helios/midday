import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "../types";
import { createLocalSupabaseClient, isLocalDesktopRuntime } from "./local";

export const createClient = () => {
  if (isLocalDesktopRuntime()) {
    return createLocalSupabaseClient();
  }

  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
};
