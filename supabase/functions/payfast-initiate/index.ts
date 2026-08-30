/**
 * payfast-initiate — STUB, not yet deployed.
 *
 * Takes { reference }, loads the pending order, and returns the form fields
 * plus signature the browser should POST to PayFast.
 *
 * The signature needs the passphrase, which is why this runs server-side.
 * See docs/payfast.md for the exact signing rules.
 *
 * Deploy:  supabase functions deploy payfast-initiate
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";

const MERCHANT_ID = Deno.env.get("PAYFAST_MERCHANT_ID")!;
const MERCHANT_KEY = Deno.env.get("PAYFAST_MERCHANT_KEY")!;
const PASSPHRASE = Deno.env.get("PAYFAST_PASSPHRASE")!;
const MODE = Deno.env.get("PAYFAST_MODE") ?? "sandbox";
const SITE_URL = Deno.env.get("SITE_URL")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PROCESS_URL =
  MODE === "live"
    ? "https://www.payfast.co.za/eng/process"
    : "https://sandbox.payfast.co.za/eng/process";

/** PayFast wants uppercase percent-encoding and + for spaces. */
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

/** Signature is built in insertion order — do NOT sort the keys. */
async function sign(fields: Record<string, string>): Promise<string> {
  const query = Object.entries(fields)
    .filter(([, v]) => v !== "" && v !== undefined)
    .map(([k, v]) => `${k}=${pfEncode(v)}`)
    .join("&");
  return md5(`${query}&passphrase=${pfEncode(PASSPHRASE)}`);
}

Deno.serve(async (req) => {
  try {
    const { reference } = await req.json();
    if (!reference) return new Response("Missing reference", { status: 400 });

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: order, error } = await supabase
      .from("orders")
      .select("reference,email,full_name,total_cents,items,status")
      .eq("reference", reference)
      .eq("status", "pending")
      .single();

    if (error || !order) return new Response("Order not found", { status: 404 });

    const count = Array.isArray(order.items) ? order.items.length : 0;

    // Order matters: this is the order PayFast signs and verifies in.
    const fields: Record<string, string> = {
      merchant_id: MERCHANT_ID,
      merchant_key: MERCHANT_KEY,
      return_url: `${SITE_URL}/?paid=1&ref=${order.reference}`,
      cancel_url: `${SITE_URL}/?cancelled=1`,
      notify_url: `${SUPABASE_URL}/functions/v1/payfast-notify`,
      name_first: order.full_name ?? "",
      email_address: order.email,
      m_payment_id: order.reference,
      amount: (order.total_cents / 100).toFixed(2),
      item_name: `CTA Notes — ${count} section${count === 1 ? "" : "s"}`,
    };

    fields.signature = await sign(fields);

    return Response.json({ action: PROCESS_URL, fields });
  } catch (err) {
    console.error(err);
    return new Response("Server error", { status: 500 });
  }
});
