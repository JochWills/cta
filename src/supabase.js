/**
 * Thin Supabase REST client.
 *
 * We hit the PostgREST endpoint with fetch instead of pulling in
 * @supabase/supabase-js — the shop only reads products and inserts orders,
 * so the SDK would be ~40kb for two requests.
 *
 * Credentials come from .env (see .env.example). The anon key is meant to be
 * public; Row Level Security in supabase/schema.sql is what protects the data.
 */

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

/** False until .env is filled in — the shop then falls back to the local catalogue. */
export const hasDB = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const headers = () => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
});

/** GET against PostgREST. `path` is e.g. "products?select=*&is_active=eq.true" */
export async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`Supabase read failed (${res.status}): ${await res.text()}`);
  return res.json();
}

/**
 * INSERT one row. Uses "return=minimal" on purpose: the orders table has no
 * SELECT policy for the public key (customers' emails shouldn't be readable
 * by anyone holding the public key), so asking Supabase to hand the row back
 * fails Row Level Security even though the insert itself is allowed. The
 * caller already knows what it needs (the reference it generated), so it
 * doesn't need anything back.
 */
export async function sbInsert(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...headers(), Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase write failed (${res.status}): ${await res.text()}`);
  return true;
}

/** Call a Supabase Edge Function (used for PayFast — see supabase/functions/). */
export async function sbFunction(name, payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Function ${name} failed (${res.status}): ${await res.text()}`);
  return res.json();
}
