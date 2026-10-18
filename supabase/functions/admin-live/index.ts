/**
 * admin-live — who's on the site right now, for the pop-up behind the admin
 * header's "online" count. One anonymous row per open tab: when it
 * arrived, where it came from, device, what it's doing, cart size and the
 * furthest shop step reached (live_visitors() in supabase/schema.sql,
 * section 12). That function is service_role-only, so the list is only
 * reachable through here, behind the admin token.
 *
 * Deploy:  supabase functions deploy admin-live
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyToken, handlePreflight, json } from "../_shared/admin.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (!(await verifyToken(req))) return json({ error: "Unauthorized" }, 401);

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data, error } = await supabase.rpc("live_visitors");
    if (error) throw error;
    return json(data ?? []);
  } catch (err) {
    console.error(err);
    return json({ error: "Server error" }, 500);
  }
});
