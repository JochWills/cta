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
  /** Discount codes, newest first, once loaded. */
  discounts: [],
  /** Which dashboard tab is showing: "dashboard" | "orders" | "notes" | "discounts". */
  tab: "dashboard",
  /** Product row being edited in the modal, or null when adding a new one. */
  editing: null,
  /** Date range the Dashboard tab's stats/chart/top-notes are scoped to. */
  dashboardRange: "30",
};

const TOKEN_KEY = "cta_admin_token";
const EXPIRES_KEY = "cta_admin_expires";

/**
 * By default the token lives in sessionStorage, not localStorage — unlike
 * the shop cart (src/cart.js), which persists to localStorage on purpose so
 * a refresh doesn't lose it. An admin auth token is a different kind of
 * thing: it shouldn't linger on a shared machine, so it's cleared the
 * moment the tab closes.
 *
 * The one exception is the login form's "Keep me signed in on this device"
 * box: ticked, the token (issued for 30 days instead of 12 hours — see
 * admin-login) goes in localStorage so it survives closing the tab or the
 * iPhone home-screen app. It's opt-in, per device, and Log out clears both.
 */
export function loadSession() {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const token = store.getItem(TOKEN_KEY) || "";
      const expiresAt = store.getItem(EXPIRES_KEY) || "";
      if (token && expiresAt && Date.now() < Date.parse(expiresAt)) {
        adminState.token = token;
        adminState.expiresAt = expiresAt;
        return;
      }
    } catch {
      // storage unavailable (e.g. private browsing) — try the other, else stay logged out.
    }
  }
}

export function saveSession(token, expiresAt, remember = false) {
  adminState.token = token;
  adminState.expiresAt = expiresAt;
  try {
    const store = remember ? localStorage : sessionStorage;
    store.setItem(TOKEN_KEY, token);
    store.setItem(EXPIRES_KEY, expiresAt);
  } catch {
    // ignore — worst case the admin has to log in again after a reload
  }
}

export function clearSession() {
  adminState.token = "";
  adminState.expiresAt = "";
  for (const store of [sessionStorage, localStorage]) {
    try {
      store.removeItem(TOKEN_KEY);
      store.removeItem(EXPIRES_KEY);
    } catch {
      // ignore
    }
  }
}
