/**
 * admin-customers — the admin page's Customers tab. The customer list
 * itself is worked out in the browser from the orders admin-orders already
 * returns; this function only does the two things that need the server:
 *
 * Body: { action: "list_requests" | "request_review", ... }
 *   list_requests:  -> { email, sent_at }[] — when each customer was last
 *                      asked for a review (review_requests, schema.sql
 *                      section 15).
 *   request_review: { email } — emails that customer the /review link
 *                      through Resend, from notes@pgdanotes.co.za, and logs
 *                      it. Only to an address with a paid order, so this
 *                      can't be used to email anyone else.
 *
 * Deploy:  supabase functions deploy admin-customers
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyToken, handlePreflight, json } from "../_shared/admin.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "PGDA Notes by Courts <notes@pgdanotes.co.za>";
const EMAIL_REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") ?? "";
const SITE = (Deno.env.get("SITE_URL") || "https://pgdanotes.co.za").replace(/\/$/, "");

const escHtml = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (!(await verifyToken(req))) return json({ error: "Unauthorized" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    switch (body.action) {
      case "list_requests": {
        const { data, error } = await supabase
          .from("review_requests")
          .select("email,sent_at")
          .order("sent_at", { ascending: false });
        if (error) throw error;
        return json(data);
      }

      case "request_review": {
        const email = String(body.email || "").trim().toLowerCase();
        if (!email) return json({ error: "email is required" }, 400);
        if (!RESEND_API_KEY) return json({ error: "Email isn't set up (RESEND_API_KEY is missing)" }, 500);

        // Their latest paid order — proves they're a customer, and gives the name.
        const { data: orders, error } = await supabase
          .from("orders")
          .select("full_name,email")
          .ilike("email", email)
          .eq("status", "paid")
          .order("created_at", { ascending: false })
          .limit(1);
        if (error) throw error;
        if (!orders?.length) return json({ error: "No paid order for that email" }, 400);

        const to = orders[0].email;
        const firstName = String(orders[0].full_name || "").trim().split(/\s+/)[0] || "there";
        const link = `${SITE}/review`;
        const subject = "Would you leave a quick review of my notes?";
        const text = [
          `Hi ${firstName},`,
          "",
          "Thanks again for buying my notes. I hope they've been helping with your studies.",
          "",
          "If you have a minute, would you leave a short review? It really helps other students decide whether the notes are right for them.",
          "",
          `Leave a review: ${link}`,
          "",
          "Thanks so much, and good luck,",
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
          <h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:24px;line-height:1.25;">Hi ${escHtml(firstName)}</h1>
          <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#6E6360;">Thanks again for buying my notes. I hope they've been helping with your studies.</p>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.65;color:#6E6360;">If you have a minute, would you leave a short review? It really helps other students decide whether the notes are right for them.</p>
          <p style="margin:0 0 22px;font-size:22px;letter-spacing:4px;color:#C9963B;">&#9733;&#9733;&#9733;&#9733;&#9733;</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 26px;"><tr><td style="background:#B4756D;border-radius:8px;">
            <a href="${escHtml(link)}" style="display:inline-block;padding:14px 26px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#ffffff;text-decoration:none;font-weight:600;">Leave a review</a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding:18px 32px 28px;border-top:1px solid #EDE4DF;font-size:13px;line-height:1.7;color:#6E6360;">
          Thanks so much, and good luck,<br>Courts
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
            to: [to],
            subject,
            html,
            text,
            ...(EMAIL_REPLY_TO ? { reply_to: EMAIL_REPLY_TO } : {}),
          }),
        });
        if (!res.ok) {
          console.error("Resend failed:", res.status, await res.text());
          return json({ error: "The email didn't send. Try again in a minute." }, 502);
        }

        const sent_at = new Date().toISOString();
        const { error: logError } = await supabase.from("review_requests").insert({ email, sent_at });
        if (logError) console.error("review_requests insert failed:", logError);
        return json({ email, sent_at });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error("admin-customers error:", err);
    return json({ error: "Something went wrong" }, 500);
  }
});
