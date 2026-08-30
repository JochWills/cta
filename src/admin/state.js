/**
 * Admin-only state — deliberately separate from src/state.js so the shop
 * bundle and the admin bundle never share mutable state, even though they
 * share small helpers (esc, $, rands).
 */
export const adminState = {
  /** Signed session token from admin-login, or "" when logged out. */
  token: "",
  /** ISO timestamp the token expires at. */
  expiresAt: "",
  /** Orders, newest first, once loaded. */
  orders: [],
  /** All products, including inactive ones, once loaded. */
  products: [],
  /** Which dashboard tab is showing: "orders" | "notes". */
  tab: "orders",
  /** Product row being edited in the modal, or null when adding a new one. */
  editing: null,
};

const TOKEN_KEY = "cta_admin_token";
const EXPIRES_KEY = "cta_admin_expires";

/**
 * The token lives in sessionStorage, not localStorage — a deliberate
 * exception to the "no localStorage anywhere" rule in CLAUDE.md, which is
 * about the customer cart. An admin auth token shouldn't linger forever on
 * a shared machine, so it's cleared the moment the tab closes rather than
 * persisted indefinitely.
 */
export function loadSession() {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY) || "";
    const expiresAt = sessionStorage.getItem(EXPIRES_KEY) || "";
    if (token && expiresAt && Date.now() < Date.parse(expiresAt)) {
      adminState.token = token;
      adminState.expiresAt = expiresAt;
    }
  } catch {
    // sessionStorage unavailable (e.g. private browsing) — just stay logged out.
  }
}

export function saveSession(token, expiresAt) {
  adminState.token = token;
  adminState.expiresAt = expiresAt;
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(EXPIRES_KEY, expiresAt);
  } catch {
    // ignore — worst case the admin has to log in again after a reload
  }
}

export function clearSession() {
  adminState.token = "";
  adminState.expiresAt = "";
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EXPIRES_KEY);
  } catch {
    // ignore
  }
}
