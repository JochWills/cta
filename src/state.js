/** Single source of truth for the shop. Mutated in place; render.js reads it. */
export const state = {
  /** Product rows, from Supabase or the local catalogue. */
  products: [],
  /** Cart lines: { id, code, title, module_slug, price_cents }. One of each — no quantities. */
  cart: [],
  /** Module slug currently filtering the grid, or "all". */
  activeFilter: "all",
  /** Drawer step: "cart" | "details" | "done". */
  checkoutStep: "cart",
  /** Reference shown on the confirmation panel after an order is saved. */
  lastOrderRef: "",
};

/** 2500 -> "R25". Prices are stored in cents so there is no float rounding. */
export const rands = (cents) =>
  "R" +
  (cents / 100).toLocaleString("en-ZA", {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  });

/** Escape anything from the database before it goes into innerHTML. */
export const esc = (s) =>
  String(s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

export const $ = (sel) => document.querySelector(sel);

/**
 * Filename-safe stem from a product's code, e.g. "TAX3" -> "tax3". Shared by
 * the admin upload's storage paths (src/admin/main.js) and the shop's
 * preview image URLs (src/render.js) — both sides must derive the exact
 * same path from the same code, or previews silently 404. Keep it here so
 * there's exactly one place that can drift.
 */
export const slugifyCode = (code) =>
  code.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
