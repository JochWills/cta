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

export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
