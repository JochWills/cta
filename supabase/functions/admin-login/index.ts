/**
 * admin-login — checks the shared admin password and issues a short-lived
 * signed token for the other admin-* functions to accept. Wrong passwords
 * are counted and locked out after a few (see the limit below).
 *
 * Secrets (set once, never committed):
 *   supabase secrets set ADMIN_PASSWORD=... ADMIN_SESSION_SECRET=...
 *
 * Deploy:  supabase functions deploy admin-login
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { signToken, timingSafeEqual, handlePreflight, json } from "../_shared/admin.ts";

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SALT = Deno.env.get("ADMIN_SESSION_SECRET")!;

/* Brute-force limit (supabase/schema.sql section 14): after MAX_PER_CALLER
   wrong passwords from one connection, or MAX_OVERALL from everyone, within
   WINDOW_MIN minutes, every attempt is refused until the window passes —
   even a right one, so a guesser can't tell when they've hit it. */
const WINDOW_MIN = 15;
const MAX_PER_CALLER = 5;
const MAX_OVERALL = 30;

/** A salted hash of the caller's IP address — enough to count their tries, without keeping the address. */
async function callerKey(req: Request): Promise<string> {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${SALT}:${ip}`));
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const { password, remember } = await req.json();
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const who = await callerKey(req);
    const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();

    const [{ count: mine }, { count: overall }] = await Promise.all([
      supabase.from("admin_login_failures").select("id", { count: "exact", head: true }).eq("who", who).gte("at", since),
      supabase.from("admin_login_failures").select("id", { count: "exact", head: true }).gte("at", since),
    ]);
    if ((mine ?? 0) >= MAX_PER_CALLER || (overall ?? 0) >= MAX_OVERALL) {
      return json({ error: `Too many wrong passwords. Try again in ${WINDOW_MIN} minutes.` }, 429);
    }

    if (typeof password !== "string" || !timingSafeEqual(password, ADMIN_PASSWORD)) {
      await supabase.from("admin_login_failures").insert({ who });
      await supabase.from("admin_login_failures").delete().lt("at", new Date(Date.now() - 86_400_000).toISOString());
      await new Promise((r) => setTimeout(r, 400)); // slows scripted guessing a little more
      const left = MAX_PER_CALLER - (mine ?? 0) - 1;
      return json({ error: left > 0 ? `Wrong password. ${left} ${left === 1 ? "try" : "tries"} left before a ${WINDOW_MIN}-minute lockout.` : `Wrong password. Locked for ${WINDOW_MIN} minutes.` }, 401);
    }

    await supabase.from("admin_login_failures").delete().eq("who", who);
    const { token, expires_at } = await signToken(remember === true);
    return json({ token, expires_at });
  } catch (err) {
    console.error(err);
    return json({ error: "Server error" }, 500);
  }
});
