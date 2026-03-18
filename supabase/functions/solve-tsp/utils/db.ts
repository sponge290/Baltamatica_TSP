import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function createSupabaseClient() {
  const sbUrl =
    Deno.env.get("EDGE_SUPABASE_URL") ??
    Deno.env.get("SUPABASE_URL"); // legacy fallback
  const sbServiceRoleKey =
    Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); // legacy fallback

  if (!sbUrl || !sbServiceRoleKey) {
    throw new Error(
      "Missing Edge Function secrets: EDGE_SUPABASE_URL and EDGE_SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient(
    sbUrl,
    sbServiceRoleKey
  );
}
