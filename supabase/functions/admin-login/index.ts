/**
 * admin-login — checks the shared admin password and issues a short-lived
 * signed token for the other admin-* functions to accept.
 *
 * Secrets (set once, never committed):
 *   supabase secrets set ADMIN_PASSWORD=... ADMIN_SESSION_SECRET=...
 *
 * Deploy:  supabase functions deploy admin-login
 */

import { signToken, timingSafeEqual, handlePreflight, json } from "../_shared/admin.ts";

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD")!;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const { password } = await req.json();
    if (typeof password !== "string" || !timingSafeEqual(password, ADMIN_PASSWORD)) {
      return json({ error: "Wrong password" }, 401);
    }

    const { token, expires_at } = await signToken();
    return json({ token, expires_at });
  } catch (err) {
    console.error(err);
    return json({ error: "Server error" }, 500);
  }
});
