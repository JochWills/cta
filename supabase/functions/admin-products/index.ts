/**
 * admin-products — full CRUD on the products table for the admin page.
 * Uses service_role: the anon key's only policy on this table is
 * "select where is_active = true" (see supabase/schema.sql), so listing
 * inactive rows and every insert/update/delete has to go through here.
 *
 * Body: { action: "list" | "create" | "update" | "delete", ...fields }
 * "update"/"delete" also need { id }. Auth is the X-Admin-Token header
 * (see verifyToken in _shared/admin.ts), not anything in the body.
 *
 * Deploy:  supabase functions deploy admin-products
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyToken, handlePreflight, json } from "../_shared/admin.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EDITABLE_FIELDS = [
  "code",
  "title",
  "description",
  "module_slug",
  "price_cents",
  "file_path",
  "is_active",
  "sort_order",
] as const;

function pickEditable(input: Record<string, unknown>) {
  const row: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) if (key in input) row[key] = input[key];
  return row;
}

/**
 * `code` (FR1, MA3, ...) used to be something the admin typed in, but the
 * admin page no longer asks for one — the title is enough to identify a
 * note there. The column is still `not null unique` in the database though,
 * and slugPath (src/admin/main.js) still uses it to build a stable storage
 * path for the PDF, so a value still has to exist. Derived once from the
 * title at creation time and never touched again, so editing the title
 * later doesn't move the file out from under an already-uploaded PDF.
 */
function generateCode(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "note";
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => (b % 36).toString(36)).join("");
  return `${slug}-${suffix}`;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (!(await verifyToken(req))) return json({ error: "Unauthorized" }, 401);

  try {
    const body = await req.json();
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    switch (body.action) {
      case "list": {
        // Unlike the public policy, this includes inactive rows — the
        // admin needs to see everything to manage it.
        const { data, error } = await supabase
          .from("products")
          .select("*")
          .order("module_slug")
          .order("sort_order");
        if (error) throw error;
        return json(data);
      }

      case "create": {
        const row = pickEditable(body);
        if (!row.title || !row.module_slug) {
          return json({ error: "Title and module are required" }, 400);
        }
        if (!row.code) row.code = generateCode(String(row.title));
        const { data, error } = await supabase.from("products").insert(row).select().single();
        if (error) throw error;
        return json(data);
      }

      case "update": {
        if (!body.id) return json({ error: "id is required" }, 400);
        const { data, error } = await supabase
          .from("products")
          .update(pickEditable(body))
          .eq("id", body.id)
          .select()
          .single();
        if (error) throw error;
        return json(data);
      }

      case "delete": {
        if (!body.id) return json({ error: "id is required" }, 400);
        const { error } = await supabase.from("products").delete().eq("id", body.id);
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
