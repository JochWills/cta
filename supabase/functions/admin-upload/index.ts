/**
 * admin-upload — uploads a file into one of two storage buckets on the
 * admin page's behalf, since neither is writable by the anon key (see
 * supabase/schema.sql, section 5):
 *
 *   "notes"          private — the real PDF a customer pays for.
 *   "note-previews"  public  — a PNG of just its first page, rendered
 *                     client-side in the admin page (src/admin/pdfPreview.js)
 *                     and shown as a blurred preview in the shop. Public on
 *                     purpose: it's the free teaser, so no signed URL needed.
 *
 * multipart/form-data body: file, path (storage path to write to, e.g.
 * "financial-reporting/fr1-a1b2.pdf"), bucket ("notes" or "note-previews").
 * The admin page sets the product's file_path/preview_path to the returned
 * path via admin-products' "update".
 *
 * Deploy:  supabase functions deploy admin-upload
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyToken, handlePreflight, json } from "../_shared/admin.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_BYTES = 25 * 1024 * 1024; // 25MB — comfortably more than a set of study notes or a page image

const BUCKETS: Record<string, string> = {
  notes: "application/pdf",
  "note-previews": "image/png",
};

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (!(await verifyToken(req))) return json({ error: "Unauthorized" }, 401);

  try {
    const form = await req.formData();
    const file = form.get("file");
    const path = form.get("path");
    const bucket = (form.get("bucket") as string) || "notes";

    if (!(file instanceof File) || typeof path !== "string" || !path) {
      return json({ error: "file and path are required" }, 400);
    }
    const expectedType = BUCKETS[bucket];
    if (!expectedType) return json({ error: "Unknown bucket" }, 400);
    if (file.type !== expectedType) {
      return json({ error: `Expected ${expectedType} for the ${bucket} bucket` }, 400);
    }
    if (file.size > MAX_BYTES) return json({ error: "File is larger than 25MB" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      contentType: expectedType,
      upsert: true,
    });
    if (error) throw error;

    return json({ path });
  } catch (err) {
    console.error(err);
    return json({ error: "Server error" }, 500);
  }
});
