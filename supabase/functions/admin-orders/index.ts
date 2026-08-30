/**
 * admin-orders — view-only list of every order, newest first, for the
 * admin page. Uses service_role because RLS deliberately blocks the anon
 * key from reading orders at all (see supabase/schema.sql — "nobody with
 * the anon key can read, update or delete orders"). This function is the
 * one sanctioned exception, gated by the admin token instead.
 *
 * Deploy:  supabase functions deploy admin-orders
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
    const { data, error } = await supabase
      .from("orders")
      .select("id,reference,email,full_name,items,total_cents,status,payment_ref,paid_at,created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return json(data);
  } catch (err) {
    console.error(err);
    return json({ error: "Server error" }, 500);
  }
});
