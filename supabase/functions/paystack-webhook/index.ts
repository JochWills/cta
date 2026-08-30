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

    // Nothing to do here for delivery — this webhook only flips the status.
    // The buyer gets their signed download links from order-download, which
    // the shop calls once it sees them back from Paystack (and again any
    // time from the "get your notes" footer link or Contact section form).
    // See that function's comment for why: no email hosting on the domain
    // yet, so self-serve download is the mechanism, not a TODO waiting on one.

    return ok();
  } catch (err) {
    console.error("Paystack webhook handler error:", err);
    return ok();
  }
});
