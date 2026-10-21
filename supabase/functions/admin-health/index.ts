/**
 * admin-health — the admin page's Health tab, in one call:
 *   - admin_health_stats() (schema.sql section 16): database and storage
 *     size, 30 days of visitors and preview opens, orders, notes with
 *     something missing, reviews waiting, wrong admin passwords
 *   - which secrets are set (email, auto-rebuild, Paystack) — never their values
 *   - the live site: is it up and how fast, and does the sitemap list a
 *     page for every active note (the build date is the last deploy)
 *   - Paystack: every checkout from the last 7 days still marked "pending"
 *     is checked with Paystack's verify API, so a payment that went
 *     through but never got marked paid (a missed webhook) shows up here
 *     instead of as a buyer who can't get their notes.
 *
 * Deploy:  supabase functions deploy admin-health
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyToken, handlePreflight, json } from "../_shared/admin.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const SITE = (Deno.env.get("SITE_URL") || "https://pgdanotes.co.za").replace(/\/$/, "");

const slugifyCode = (code: string) =>
  code.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function timed(url: string) {
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "pgdanotes-health-check" } });
    const body = await res.text();
    return { ok: res.ok, status: res.status, ms: Date.now() - start, body };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - start, body: "", error: String(err) };
  }
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (!(await verifyToken(req))) return json({ error: "Unauthorized" }, 401);

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const settled = new Date(Date.now() - 15 * 60000).toISOString(); // give a checkout in progress 15 minutes

    const [statsRes, pendingRes, home, sitemap] = await Promise.all([
      supabase.rpc("admin_health_stats"),
      supabase
        .from("orders")
        .select("reference,email,full_name,total_cents,created_at")
        .eq("status", "pending")
        .gte("created_at", since)
        .lte("created_at", settled)
        .order("created_at", { ascending: false })
        .limit(40),
      timed(`${SITE}/`),
      timed(`${SITE}/sitemap.xml`),
    ]);
    if (statsRes.error) throw statsRes.error;
    const stats = statsRes.data;

    // Note pages: which active notes the deployed sitemap doesn't list yet.
    const listed = new Set([...sitemap.body.matchAll(/\/notes\/([a-z0-9-]+)</g)].map((m) => m[1]));
    const lastmod = sitemap.body.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? null;
    const codes: { title: string; code: string }[] = stats.notes.codes ?? [];
    const missingPages = sitemap.ok ? codes.filter((c) => !listed.has(slugifyCode(c.code))).map((c) => c.title) : [];
    delete stats.notes.codes;

    // Paystack: was any "pending" checkout actually paid?
    const pending = pendingRes.data ?? [];
    let paidNotMarked: unknown[] = [];
    let checked = 0;
    if (PAYSTACK_SECRET_KEY && pending.length) {
      const results = await Promise.all(
        pending.map(async (o) => {
          try {
            const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(o.reference)}`, {
              headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
              signal: AbortSignal.timeout(8000),
            });
            const body = await res.json().catch(() => ({}));
            checked++;
            return body?.data?.status === "success" ? o : null;
          } catch {
            return null;
          }
        })
      );
      paidNotMarked = results.filter(Boolean);
    }

    return json({
      ...stats,
      checked_at: new Date().toISOString(),
      secrets: {
        email: Boolean(Deno.env.get("RESEND_API_KEY")),
        reply_to: Boolean(Deno.env.get("EMAIL_REPLY_TO")),
        auto_rebuild: Boolean(Deno.env.get("RENDER_DEPLOY_HOOK")),
        paystack: Boolean(PAYSTACK_SECRET_KEY),
      },
      site: {
        home: { ok: home.ok, status: home.status, ms: home.ms },
        sitemap: { ok: sitemap.ok, status: sitemap.status, note_pages: listed.size, built: lastmod },
        missing_note_pages: missingPages,
      },
      payments: { unfinished: pending.length, checked, paid_not_marked: paidNotMarked },
    });
  } catch (err) {
    console.error("admin-health error:", err);
    return json({ error: "Couldn't run the health check" }, 500);
  }
});
