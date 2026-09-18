/**
 * admin-orders — list + delete for the admin page's Orders tab. Uses
 * service_role because RLS deliberately blocks the anon key from touching
 * orders at all (see supabase/schema.sql — "nobody with the anon key can
 * read, update or delete orders"). This function is the one sanctioned
 * exception, gated by the admin token instead.
 *
 * Body (optional): { action?: "list" | "delete", id? }. No body at all (the
 * page's original call, still used for the plain list) behaves the same as
 * { action: "list" }. "delete" needs { id } and is permanent — there's no
 * undo, and no separate refund: deleting a paid order only removes the
 * record, it doesn't touch Paystack or the buyer's money. The admin page
 * confirms before ever sending this (src/admin/main.js).
 *
 * Order status itself still isn't editable here on purpose — it only ever
 * changes via the Paystack webhook (or by hand in the Supabase table
 * editor) — this function adds delete, not a general write API.
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
    // The page's original list call sends no body at all — req.json() on an
    // empty body rejects, so that falls through to {} here and takes the
    // same "list" path as before rather than throwing.
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    if (body.action === "delete") {
      if (!body.id) return json({ error: "id is required" }, 400);
      const { error } = await supabase.from("orders").delete().eq("id", body.id);
      if (error) throw error;
      return json({ ok: true });
    }

    const { data, error } = await supabase
      .from("orders")
      .select("id,reference,email,full_name,items,total_cents,discount_code,discount_percent,status,payment_ref,paid_at,created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return json(data);
  } catch (err) {
    console.error(err);
    return json({ error: "Server error" }, 500);
  }
});
