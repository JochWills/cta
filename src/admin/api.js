/**
 * Thin client for the admin-* Edge Functions — same fetch-over-PostgREST
 * spirit as src/supabase.js, just pointed at supabase/functions/admin-*
 * instead of the REST endpoint, since those are the only things allowed to
 * use the service_role key.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../supabase.js";
import { adminState, clearSession } from "./state.js";

/** Thrown on a 401 from anything but admin-login — the caller should drop back to the login screen. */
export class AuthError extends Error {}

async function call(name, { body, isForm = false } = {}) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };
  if (adminState.token) headers["X-Admin-Token"] = adminState.token;
  if (!isForm) headers["Content-Type"] = "application/json";

  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers,
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    const msg = await res.json().catch(() => ({}));
    if (name === "admin-login") throw new Error(msg.error || "Wrong password");
    clearSession();
    throw new AuthError(msg.error || "Session expired — log in again");
  }
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error(msg.error || `${name} failed (${res.status})`);
  }
  return res.json();
}

export const login = (password) => call("admin-login", { body: { password } });

export const fetchOrders = () => call("admin-orders");

export const listProducts = () => call("admin-products", { body: { action: "list" } });
export const createProduct = (fields) => call("admin-products", { body: { action: "create", ...fields } });
export const updateProduct = (id, fields) => call("admin-products", { body: { action: "update", id, ...fields } });
export const deleteProduct = (id) => call("admin-products", { body: { action: "delete", id } });

export function uploadPdf(file, path) {
  const form = new FormData();
  form.append("file", file);
  form.append("path", path);
  return call("admin-upload", { body: form, isForm: true });
}
