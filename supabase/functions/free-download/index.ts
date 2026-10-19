/**
 * free-download — a freebie's file (a PDF or an Excel sheet) for a name
 * and email, no payment.
 *
 * Records the download as an order with status "free" and total 0, so it
 * shows on the admin page's Orders list next to sales (the dashboard's
 * stats only ever count "paid", so these never inflate them — see
 * supabase/schema.sql section 10), then returns a short-lived signed link
 * to the PDF. Only ever signs a note that's active and in a freebies (PGDA or bridging)
 * module, so it can't be used to pull a paid note.
 *
 * Asking again for the same freebie with the same email reuses the first
 * row rather than adding another, so the list stays one row per person per
 * freebie.
 *
 * { action: "preview", product_id } skips the name/email and the order row
 * and just returns a signed link for viewing (no download filename) plus
 * the file's kind, for the shop's preview modal — Excel files open in
 * Microsoft's online viewer there, PDFs in the browser's own. Courts chose
 * the exact Excel look knowing that viewer has its own download button.
 *
 * Always responds 200 with { ok, reason } on a bad request, same as
 * order-download, so src/freebies.js has one shape to handle.
 *
 * Deploy:  supabase functions deploy free-download
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SIGNED_URL_TTL = 60 * 60; // an hour — the browser starts the download straight away

// Same fallback as paystack-initiate and order-download.
const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") || "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 320;

/** FREE-XXXXXX — a different prefix from paid orders' CTA-, so the two read apart on the Orders list. */
function makeReference() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return "FREE-" + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => chars[b % chars.length]).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const productId = typeof body.product_id === "string" ? body.product_id : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const preview = body.action === "preview";

    if (!preview && (!name || name.length > 80 || !isEmail(email))) return json({ ok: false, reason: "invalid" });
    if (!/^[0-9a-f-]{36}$/i.test(productId)) return json({ ok: false, reason: "not_found" });

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: product } = await supabase
      .from("products")
      .select("id,title,file_path")
      .eq("id", productId)
      .in("module_slug", ["freebies", "bridging-freebies"])
      .eq("is_active", true)
      .maybeSingle();
    if (!product?.file_path) return json({ ok: false, reason: "not_found" });
    const ext = product.file_path.split(".").pop()!.toLowerCase();

    if (preview) {
      const { data: signed, error } = await supabase.storage.from("notes").createSignedUrl(product.file_path, SIGNED_URL_TTL);
      if (error) throw error;
      return json({ ok: true, url: signed.signedUrl, kind: ext === "pdf" ? "pdf" : "excel" });
    }

    const { data: existing } = await supabase
      .from("orders")
      .select("id")
      .eq("status", "free")
      .eq("email", email)
      .contains("items", [{ product_id: product.id }])
      .limit(1);

    if (!existing?.length) {
      // price_order() rebuilds items and the total (0) from the products
      // row, and rejects anything that isn't a freebie on a "free" row.
      const { error } = await supabase.from("orders").insert({
        reference: makeReference(),
        email,
        full_name: name,
        items: [{ product_id: product.id }],
        total_cents: 0,
        status: "free",
        terms_accepted_at: new Date().toISOString(), // the form says downloading means accepting the terms
      });
      if (error) throw error;
    }

    const filename = `${product.title.replace(/[^\w\s&.-]+/g, "").trim() || "Notes"}.${ext}`;
    const { data: signed, error: signError } = await supabase.storage
      .from("notes")
      .createSignedUrl(product.file_path, SIGNED_URL_TTL, { download: filename });
    if (signError) throw signError;

    return json({ ok: true, title: product.title, url: signed.signedUrl });
  } catch (err) {
    console.error(err);
    return json({ ok: false, reason: "server_error" }, 500);
  }
});
