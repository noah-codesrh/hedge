import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverSecrets } from "./secrets";

let client: SupabaseClient | null = null;

/**
 * Service-role Supabase client. Server only: this key bypasses row level
 * security.
 *
 * Returns null when Supabase is not configured so that analytics stay optional
 * — a missing key must never take trading down with it.
 */
export function supabaseAdmin() {
  const { supabaseUrl, supabaseServiceRoleKey } = serverSecrets();
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;
  if (!client) {
    client = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
