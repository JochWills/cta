/**
 * payfast-notify — STUB, not yet deployed.
 *
 * PayFast's ITN (Instant Transaction Notification) webhook. This is the only
 * thing allowed to mark an order as paid.
 *
 * Four checks before the database is touched: signature, source, server
 * confirmation, amount. See docs/payfast.md.
 *
 * Always return 200, even when rejecting — a non-200 makes PayFast retry
 * for hours.
 *
 * Deploy:  supabase functions deploy payfast-notify --no-verify-jwt
 *          (--no-verify-jwt because PayFast doesn't send a Supabase auth header)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";

const PASSPHRASE = Deno.env.get("PAYFAST_PASSPHRASE")!;
const MODE = Deno.env.get("PAYFAST_MODE") ?? "sandbox";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const VALIDATE_URL =
  MODE === "live"
    ? "https://www.payfast.co.za/eng/query/validate"
    : "https://sandbox.payfast.co.za/eng/query/validate";

function pfEncode(value: string): string {
  return encodeURIComponent(value.trim())
    .replace(/%20/g, "+")
    .replace(/%[0-9a-f]{2}/g, (m) => m.toUpperCase());
}

async function md5(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest("MD5", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Recompute the signature over the posted fields, in the order received. */
async function signatureIsValid(pairs: [string, string][], claimed: string) {
  const query = pairs
    .filter(([k, v]) => k !== "signature" && v !== "")
    .map(([k, v]) => `${k}=${pfEncode(v)}`)
    .join("&");
  return (await md5(`${query}&passphrase=${pfEncode(PASSPHRASE)}`)) === claimed;
}

/** Ask PayFast whether it really sent this. */
async function payfastConfirms(raw: string) {
  const res = await fetch(VALIDATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: raw,
  });
  return (await res.text()).trim().startsWith("VALID");
}

Deno.serve(async (req) => {
  const ok = () => new Response("", { status: 200 });

  try {
    const raw = await req.text();
    const pairs = [...new URLSearchParams(raw).entries()] as [string, string][];
    const data = Object.fromEntries(pairs);

    // 1. Signature
    if (!(await signatureIsValid(pairs, data.signature))) {
      console.warn("ITN rejected: bad signature", data.m_payment_id);
      return ok();
    }

    // 2. Server confirmation
    if (!(await payfastConfirms(raw))) {
      console.warn("ITN rejected: PayFast did not confirm", data.m_payment_id);
      return ok();
    }

    // TODO: 3. Verify the source IP resolves to a PayFast host.

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: order } = await supabase
      .from("orders")
      .select("id,reference,email,items,total_cents,status")
      .eq("reference", data.m_payment_id)
      .single();

    if (!order) {
      console.warn("ITN rejected: unknown order", data.m_payment_id);
      return ok();
    }

    // 4. Amount
    const expected = order.total_cents / 100;
    if (Math.abs(parseFloat(data.amount_gross) - expected) > 0.01) {
      console.warn("ITN rejected: amount mismatch", order.reference, data.amount_gross, expected);
      return ok();
    }

    if (data.payment_status !== "COMPLETE") return ok();

    // Idempotent: a retried ITN updates nothing the second time round.
    const { data: updated } = await supabase
      .from("orders")
      .update({ status: "paid", payment_ref: data.pf_payment_id, paid_at: new Date().toISOString() })
      .eq("reference", order.reference)
      .eq("status", "pending")
      .select("id");

    if (!updated?.length) return ok(); // already handled

    // TODO: create signed URLs for each item's file_path and email them.
    //   const links = await Promise.all(order.items.map(async (item) => {
    //     const { data: p } = await supabase.from("products")
    //       .select("file_path,title").eq("id", item.product_id).single();
    //     const { data: signed } = await supabase.storage.from("notes")
    //       .createSignedUrl(p.file_path, 60 * 60 * 24);
    //     return { title: p.title, url: signed.signedUrl };
    //   }));
    //   await sendDownloadEmail(order.email, order.reference, links);

    return ok();
  } catch (err) {
    console.error("ITN handler error:", err);
    return ok();
  }
});
