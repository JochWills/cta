/**
 * order-download — self-serve download links for a paid order.
 *
 * There's no email hosting on the domain yet (see CLAUDE.md's "Not done"
 * list), so this function *is* the delivery mechanism: the shop calls it
 * right after a buyer returns from Paystack (src/main.js's ?paid=1
 * handling), and again any time they come back to the "Get your notes"
 * footer link or the inline copy of the same form in the Contact section —
 * src/downloads.js drives all of it.
 *
 * Public (no admin token) since a buyer isn't logged in. Requiring the
 * email to match the order (not just the reference) is what stops someone
 * who's seen a bare reference from pulling another buyer's files —
 * reference alone isn't treated as a secret, since it's shown on-screen and
 * echoed back in the Paystack redirect URL.
 *
 * Always responds 200 with { ok, reason } rather than 404/403, so a wrong
 * reference and a wrong email look identical to the caller — this never
 * confirms whether a given reference exists on its own.
 *
 * Deploy:  supabase functions deploy order-download
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SIGNED_URL_TTL = 60 * 60 * 24; // 24 hours — long enough to actually download, short enough not to be a permanent link

// Same fallback as paystack-initiate: a missing SITE_URL secret should
// never turn into "Access-Control-Allow-Origin: undefined", which every
// browser silently blocks.
const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") || "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { reference, email } = await req.json();
    if (typeof reference !== "string" || typeof email !== "string" || !reference.trim() || !email.trim()) {
      return json({ ok: false, reason: "not_found" });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: order } = await supabase
      .from("orders")
      .select("reference,email,items,status")
      .eq("reference", reference.trim().toUpperCase())
      .maybeSingle();

    if (!order || order.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
      return json({ ok: false, reason: "not_found" });
    }

    if (order.status !== "paid") {
      // reason is "pending" | "failed" | "refunded" — the frontend has copy for each
      return json({ ok: false, reason: order.status, reference: order.reference });
    }

    const items = Array.isArray(order.items) ? order.items : [];
    const productIds = items.map((i: { product_id?: string }) => i.product_id).filter(Boolean);

    const { data: products } = productIds.length
      ? await supabase.from("products").select("id,title,file_path").in("id", productIds)
      : { data: [] as { id: string; title: string; file_path: string | null }[] };
    const byId = new Map((products ?? []).map((p) => [p.id, p]));

    const results = await Promise.all(
      items.map(async (item: { product_id?: string; title?: string }) => {
        const product = byId.get(item.product_id ?? "");
        const title = product?.title || item.title || "Section";
        if (!product?.file_path) return { title, url: null };

        const { data: signed, error } = await supabase.storage
          .from("notes")
          .createSignedUrl(product.file_path, SIGNED_URL_TTL);
        if (error) {
          console.error("Signing failed for", product.file_path, error);
          return { title, url: null };
        }
        return { title, url: signed.signedUrl };
      })
    );

    return json({ ok: true, reference: order.reference, items: results });
  } catch (err) {
    console.error(err);
    return json({ ok: false, reason: "server_error" }, 500);
  }
});
