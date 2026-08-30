/**
 * admin-upload — uploads a note's PDF into the private `notes` storage
 * bucket on the admin page's behalf. The bucket has no storage policy at
 * all for the anon key (see supabase/schema.sql, section 5) — on purpose,
 * so nobody can hotlink a file — which means only service_role can write
 * to it, hence this function.
 *
 * multipart/form-data body: file (the PDF), path (storage path to write
 * to, e.g. "financial-reporting/fr1.pdf"). The admin page sets the
 * product's file_path to the returned path via admin-products' "update".
 *
 * Deploy:  supabase functions deploy admin-upload
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyToken, handlePreflight, json } from "../_shared/admin.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_BYTES = 25 * 1024 * 1024; // 25MB — comfortably more than a set of study notes

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (!(await verifyToken(req))) return json({ error: "Unauthorized" }, 401);

  try {
    const form = await req.formData();
    const file = form.get("file");
    const path = form.get("path");

    if (!(file instanceof File) || typeof path !== "string" || !path) {
      return json({ error: "file and path are required" }, 400);
    }
    if (file.type !== "application/pdf") return json({ error: "Only PDF files are accepted" }, 400);
    if (file.size > MAX_BYTES) return json({ error: "File is larger than 25MB" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { error } = await supabase.storage.from("notes").upload(path, file, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (error) throw error;

    return json({ path });
  } catch (err) {
    console.error(err);
    return json({ error: "Server error" }, 500);
  }
});
