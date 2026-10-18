/**
 * Shared helpers for the admin-* Edge Functions: token issuing/verification
 * and CORS.
 *
 * Unlike paystack-webhook (server-to-server, called by Paystack — no
 * browser involved, so no CORS needed), every admin-* function is called
 * directly from admin.html running on the Render site's origin, so each one
 * needs OPTIONS + CORS handling — that lives here once instead of in each.
 *
 * Auth is a single shared password (ADMIN_PASSWORD, checked in
 * admin-login), not per-user accounts — this is a one-person shop — then a
 * riddle. Every token is stateless and HMAC-signed (ADMIN_SESSION_SECRET),
 * with a `stage`:
 *   "pass"    — from admin-login. Only good for asking admin-riddle for a
 *               riddle; this is what "keep me signed in" keeps.
 *   "riddle"  — a signed record of which riddle was asked (10 minutes).
 *   "unlocked"— from admin-riddle for a right answer. The only stage the
 *               data functions accept (verifyToken). The admin page keeps it
 *               in memory only, so every page load asks a riddle again.
 * No session table: the signature, stage and embedded expiry are the whole check.
 */

const SESSION_SECRET = Deno.env.get("ADMIN_SESSION_SECRET")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "*";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
// "Keep me signed in on this device" on the login form. Tokens are stateless
// (no session table to revoke from), so the only ways to end one early are
// its expiry or rotating ADMIN_SESSION_SECRET, which signs out every device.
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(s.length + ((4 - (s.length % 4)) % 4), "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function hmacKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export type Stage = "pass" | "riddle" | "unlocked";
// deno-lint-ignore no-explicit-any
type Claims = { exp: number; stage: Stage; [k: string]: any };

/** Sign any claims: base64url(payload) + "." + base64url(signature). */
export async function signClaims(claims: Claims): Promise<{ token: string; expires_at: string }> {
  const payload = new TextEncoder().encode(JSON.stringify(claims));
  const key = await hmacKey();
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, payload));
  return { token: `${toBase64Url(payload)}.${toBase64Url(sig)}`, expires_at: new Date(claims.exp).toISOString() };
}

/** The claims in a token if its signature checks out, it hasn't expired and it's at `stage`; else null. */
export async function readToken(token: string, stage: Stage): Promise<Claims | null> {
  const [payloadPart, sigPart] = (token || "").split(".");
  if (!payloadPart || !sigPart) return null;
  try {
    const payload = fromBase64Url(payloadPart);
    const sig = fromBase64Url(sigPart);
    const key = await hmacKey();
    if (!(await crypto.subtle.verify("HMAC", key, sig, payload))) return null;
    const claims = JSON.parse(new TextDecoder().decode(payload));
    return typeof claims.exp === "number" && Date.now() < claims.exp && claims.stage === stage ? claims : null;
  } catch {
    return null;
  }
}

/** admin-login's token: good for 12 hours (30 days if `remember`), but only for getting a riddle. */
export function signToken(remember = false) {
  return signClaims({ exp: Date.now() + (remember ? REMEMBER_TTL_MS : TOKEN_TTL_MS), stage: "pass" });
}

/** For the data functions: the X-Admin-Token header must be an unlocked (riddle solved) token. */
export async function verifyToken(req: Request): Promise<boolean> {
  return (await readToken(req.headers.get("X-Admin-Token") ?? "", "unlocked")) !== null;
}

/** Constant-time string compare for the password check in admin-login. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": SITE_URL,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-admin-token",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

/** Handle a CORS preflight; returns a Response if this was one, else null. */
export function handlePreflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response(null, { headers: corsHeaders }) : null;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
