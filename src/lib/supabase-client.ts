import { createClient } from "@supabase/supabase-js";

function create(url: string, key: string) {
  return createClient(url, key, {
    db: { schema: "api" },
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

let client: ReturnType<typeof create> | null = null;

/**
 * Browser-only Supabase client. Only the publishable key is used here; the
 * service role key must never reach the bundle. All data goes through the
 * exposed "api" schema (RPC only).
 */
export function getSupabase() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY wajib diisi.");
  }
  client = create(url, key);
  return client;
}
