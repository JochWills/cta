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
// Optional — without RESEND_API_KEY the thank-you email is just skipped.
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "PGDA Notes by Courts <notes@pgdanotes.co.za>";
const EMAIL_REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") || "";
const SITE = (Deno.env.get("SITE_URL") || "https://pgdanotes.co.za").replace(/\/$/, "");

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

    // Delivery itself is still self-serve: order-download hands out signed
    // links, called by the shop when the buyer lands back from Paystack (and
    // any time from the "get your notes" link). The email below is a thank-you
    // with a link straight back to that, so they can find it again later or
    // on another device. Sent only on this first paid flip, so a retried
    // webhook can't send it twice; a failure is logged, never retried, and
    // never affects the 200.
    await sendThankYou(supabase, order.reference);

    return ok();
  } catch (err) {
    console.error("Paystack webhook handler error:", err);
    return ok();
  }
});

/* ------------------------------------------------------------------
   Thank-you email via Resend (https://resend.com/docs/api-reference/emails/send-email)
------------------------------------------------------------------ */

const escHtml = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const rands = (cents: number) => `R${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

// deno-lint-ignore no-explicit-any
async function sendThankYou(supabase: any, reference: string) {
  if (!RESEND_API_KEY) return;
  try {
    const { data: o } = await supabase
      .from("orders")
      .select("reference,email,full_name,items,total_cents")
      .eq("reference", reference)
      .single();
    if (!o?.email) return;

    // Opens the shop's download window already filled in (main.js's ?paid=1
    // handling), which looks the order up and shows fresh download links.
    const link = `${SITE}/?paid=1&ref=${encodeURIComponent(o.reference)}&email=${encodeURIComponent(o.email)}`;
    const firstName = String(o.full_name || "").trim().split(/\s+/)[0] || "there";
    const items: { title: string }[] = Array.isArray(o.items) ? o.items : [];
    const titles = items.map((i) => i.title).filter(Boolean);

    const subject = `Your notes are ready to download (${o.reference})`;
    const text = [
      `Hi ${firstName},`,
      "",
      "Thanks so much for buying my notes. Your payment went through and your notes are ready to download.",
      "",
      ...titles.map((t) => `- ${t}`),
      "",
      `Get your notes: ${link}`,
      "",
      "That link always gives you fresh download links, so keep this email and come back to it whenever you need them again.",
      "",
      `Order reference: ${o.reference}`,
      `Total paid: ${rands(o.total_cents)}`,
      "",
      "Good luck with your studies,",
      "Courts",
    ].join("\n");

    const html = `<!doctype html>
<html><body style="margin:0;background:#FCFAF8;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#2B2523;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FCFAF8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #EDE4DF;border-radius:14px;">
        <tr><td style="padding:32px 32px 8px;">
          <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:26px;color:#9C5F58;letter-spacing:.02em;">PGDA <span style="font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.3em;color:#2B2523;">NOTES</span></p>
        </td></tr>
        <tr><td style="padding:16px 32px 0;">
          <h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:24px;line-height:1.25;">Thank you, ${escHtml(firstName)}</h1>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#6E6360;">Your payment went through and your notes are ready to download.</p>
          ${
            titles.length
              ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border-top:1px solid #EDE4DF;">${titles
                  .map((t) => `<tr><td style="padding:11px 0;border-bottom:1px solid #EDE4DF;font-size:14.5px;">${escHtml(t)}</td></tr>`)
                  .join("")}</table>`
              : ""
          }
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr><td style="background:#B4756D;border-radius:8px;">
            <a href="${escHtml(link)}" style="display:inline-block;padding:14px 26px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#ffffff;text-decoration:none;font-weight:600;">Get your notes</a>
          </td></tr></table>
          <p style="margin:0 0 22px;font-size:13.5px;line-height:1.65;color:#6E6360;">That button always gives you fresh download links, so keep this email and come back to it whenever you need them again.</p>
        </td></tr>
        <tr><td style="padding:18px 32px 28px;border-top:1px solid #EDE4DF;font-size:12.5px;line-height:1.7;color:#9A8F8B;">
          Order reference: <strong style="color:#2B2523;">${escHtml(o.reference)}</strong><br>
          Total paid: ${rands(o.total_cents)}<br><br>
          Good luck with your studies,<br>Courts
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:11.5px;color:#9A8F8B;"><a href="${SITE}" style="color:#9A8F8B;">pgdanotes.co.za</a></p>
    </td></tr>
  </table>
</body></html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [o.email],
        subject,
        html,
        text,
        ...(EMAIL_REPLY_TO ? { reply_to: EMAIL_REPLY_TO } : {}),
      }),
    });
    if (!res.ok) console.error("Thank-you email failed:", o.reference, res.status, await res.text());
  } catch (err) {
    console.error("Thank-you email error:", reference, err);
  }
}
