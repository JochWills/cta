/**
 * admin-discounts — list, create and delete discount codes for the admin
 * page. Uses service_role: discount_codes has RLS on and no policies at all
 * (see supabase/schema.sql section 8), so the anon key can't list codes —
 * the shop only ever checks one code at a time via discount_percent().
 *
 * Body: { action: "list" | "create" | "set_expiry" | "delete", ... }
 *   create: { code, percent_off, expires_at? } — code is upper-cased; 3-32
 *           chars of A-Z, 0-9, "-" or "_"; percent_off a whole number 1-99;
 *           expires_at an ISO time in the future, or null/absent for never.
 *   set_expiry: { id, expires_at } — change it later (null = never).
 *   delete: { id }
 *
 * An expired code stays in the list (so the admin can see it ran out, or
 * extend it) but discount_percent() and price_order() stop accepting it
 * the moment expires_at passes — see schema.sql section 8.
 *
 * Deleting a code doesn't touch orders that already used it — each order
 * keeps its own discount_code/discount_percent snapshot.
 *
 * Deploy:  supabase functions deploy admin-discounts
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyToken, handlePreflight, json } from "../_shared/admin.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIELDS = "id,code,percent_off,expires_at,created_at";

/** null for "never", an ISO string for a valid future time, or an error message. */
function parseExpiry(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  const t = Date.parse(String(value));
  if (Number.isNaN(t)) return { ok: false, error: "That expiry date isn't valid" };
  if (t <= Date.now()) return { ok: false, error: "Pick an expiry time in the future" };
  return { ok: true, value: new Date(t).toISOString() };
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (!(await verifyToken(req))) return json({ error: "Unauthorized" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    switch (body.action) {
      case "list": {
        const { data, error } = await supabase
          .from("discount_codes")
          .select(FIELDS)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return json(data);
      }

      case "create": {
        const code = String(body.code ?? "").trim().toUpperCase();
        const percent = Number(body.percent_off);
        if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
          return json({ error: "Code must be 3-32 letters, numbers, - or _" }, 400);
        }
        if (!Number.isInteger(percent) || percent < 1 || percent > 99) {
          return json({ error: "Discount must be a whole number from 1 to 99" }, 400);
        }
        const expiry = parseExpiry(body.expires_at);
        if (!expiry.ok) return json({ error: expiry.error }, 400);
        const { data, error } = await supabase
          .from("discount_codes")
          .insert({ code, percent_off: percent, expires_at: expiry.value })
          .select(FIELDS)
          .single();
        if (error?.code === "23505") return json({ error: `${code} already exists` }, 409);
        if (error) throw error;
        return json(data);
      }

      case "set_expiry": {
        if (!body.id) return json({ error: "id is required" }, 400);
        const expiry = parseExpiry(body.expires_at);
        if (!expiry.ok) return json({ error: expiry.error }, 400);
        const { data, error } = await supabase
          .from("discount_codes")
          .update({ expires_at: expiry.value })
          .eq("id", body.id)
          .select(FIELDS)
          .single();
        if (error) throw error;
        return json(data);
      }

      case "delete": {
        if (!body.id) return json({ error: "id is required" }, 400);
        const { error } = await supabase.from("discount_codes").delete().eq("id", body.id);
        if (error) throw error;
        return json({ ok: true });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error(err);
    return json({ error: "Server error" }, 500);
  }
});
