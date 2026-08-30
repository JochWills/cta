/**
 * paystack-webhook — Paystack's server-to-server payment notification.
 *
 * Set this as the Webhook URL in the Paystack dashboard
 * (Settings → API Keys & Webhooks):
 *   https://<project-ref>.supabase.co/functions/v1/paystack-webhook
 *
 * Two checks before the database is touched: the signature (proves the
 * request really came from Paystack — it's an HMAC-SHA512 of the raw body
 * keyed with the secret key, so it can't be forged without that key), then
 * the amount and currency against what the order actually cost. Only a
 * charge.success event flips an order to paid.
 *
 * Always respond 200, even when rejecting — a non-200 makes Paystack retry.
 *
 * Deploy:  supabase functions deploy paystack-webhook --no-verify-jwt
 *          (--no-verify-jwt because Paystack doesn't send a Supabase auth header)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function isValidSignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PAYSTACK_SECRET_KEY),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === signature;
}

Deno.serve(async (req) => {
  const ok = () => new Response("", { status: 200 });

  try {
    const raw = await req.text();

    // 1. Signature
    if (!(await isValidSignature(raw, req.headers.get("x-paystack-signature")))) {
      console.warn("Paystack webhook rejected: bad signature");
      return ok();
    }

    const event = JSON.parse(raw);
    if (event.event !== "charge.success") return ok();

    const data = event.data;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: order } = await supabase
      .from("orders")
      .select("id,reference,total_cents,status")
      .eq("reference", data.reference)
      .single();

    if (!order) {
      console.warn("Paystack webhook rejected: unknown order", data.reference);
      return ok();
    }

    // 2. Amount and currency — never trust a webhook payload for money
    // without checking it against what we actually charged for.
    if (data.currency !== "ZAR" || data.amount !== order.total_cents) {
      console.warn(
        "Paystack webhook rejected: amount/currency mismatch",
        order.reference,
        data.amount,
        data.currency
      );
      return ok();
    }
    if (data.status !== "success") return ok();

    // Idempotent: a retried webhook updates nothing the second time round.
    const { data: updated } = await supabase
      .from("orders")
      .update({ status: "paid", payment_ref: String(data.id), paid_at: new Date().toISOString() })
      .eq("reference", order.reference)
      .eq("status", "pending")
      .select("id");

    if (!updated?.length) return ok(); // already handled

    // TODO: create signed URLs for each item's file_path and email them.
    //   const { data: items } = await supabase.from("orders").select("items").eq("id", order.id).single();
    //   const links = await Promise.all(items.map(async (item) => {
    //     const { data: p } = await supabase.from("products")
    //       .select("file_path,title").eq("id", item.product_id).single();
    //     const { data: signed } = await supabase.storage.from("notes")
    //       .createSignedUrl(p.file_path, 60 * 60 * 24);
    //     return { title: p.title, url: signed.signedUrl };
    //   }));
    //   await sendDownloadEmail(order.email, order.reference, links);

    return ok();
  } catch (err) {
    console.error("Paystack webhook handler error:", err);
    return ok();
  }
});
