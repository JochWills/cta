/**
 * Shared helpers for the admin-* Edge Functions: token issuing/verification
 * and CORS.
 *
 * Unlike payfast-notify (server-to-server) or payfast-initiate (called from
 * the browser but same-origin-ish and never needed it), every admin-*
 * function is called directly from admin.html running on the Render site's
 * origin, so each one needs OPTIONS + CORS handling — that lives here once
 * instead of four times.
 *
 * Auth is a single shared password (ADMIN_PASSWORD, checked in
 * admin-login), not per-user accounts — this is a one-person shop. A
 * successful login gets a short-lived, stateless, HMAC-signed token
 * (ADMIN_SESSION_SECRET) that the other three functions verify. No session
 * table: the signature and the embedded expiry are the whole check.
 */

const SESSION_SECRET = Deno.env.get("ADMIN_SESSION_SECRET")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "*";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

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

/** Issue a token good for 12 hours: base64url(payload) + "." + base64url(signature). */
export async function signToken(): Promise<{ token: string; expires_at: string }> {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = new TextEncoder().encode(JSON.stringify({ exp }));
  const key = await hmacKey();
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, payload));
  return { token: `${toBase64Url(payload)}.${toBase64Url(sig)}`, expires_at: new Date(exp).toISOString() };
}

/** Verify the X-Admin-Token header — signature must check out and not be expired. */
export async function verifyToken(req: Request): Promise<boolean> {
  const token = req.headers.get("X-Admin-Token") ?? "";
  const [payloadPart, sigPart] = token.split(".");
  if (!payloadPart || !sigPart) return false;

  try {
    const payload = fromBase64Url(payloadPart);
    const sig = fromBase64Url(sigPart);
    const key = await hmacKey();
    if (!(await crypto.subtle.verify("HMAC", key, sig, payload))) return false;
    const { exp } = JSON.parse(new TextDecoder().decode(payload));
    return typeof exp === "number" && Date.now() < exp;
  } catch {
    return false;
  }
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
