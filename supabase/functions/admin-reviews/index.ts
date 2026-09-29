/**
 * admin-reviews — list, publish/unpublish and delete reviews for the admin
 * page. Uses service_role: the anon key can only insert a review and read
 * published ones (see supabase/schema.sql section 9), so the full list —
 * including ones waiting to be approved — and the publish switch live here.
 *
 * Body: { action: "list" | "publish" | "delete", ... }
 *   publish: { id, is_published } — true shows it on the homepage, false hides it again.
 *   delete:  { id }
 *
 * Deploy:  supabase functions deploy admin-reviews
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyToken, handlePreflight, json } from "../_shared/admin.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const COLUMNS = "id,name,body,rating,is_published,created_at";

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
          .from("reviews")
          .select(COLUMNS)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return json(data);
      }

      case "publish": {
        if (!body.id || typeof body.is_published !== "boolean") {
          return json({ error: "id and is_published are required" }, 400);
        }
        const { data, error } = await supabase
          .from("reviews")
          .update({ is_published: body.is_published })
          .eq("id", body.id)
          .select(COLUMNS)
          .single();
        if (error) throw error;
        return json(data);
      }

      case "delete": {
        if (!body.id) return json({ error: "id is required" }, 400);
        const { error } = await supabase.from("reviews").delete().eq("id", body.id);
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
