import { state } from "./state.js";
import { SEED } from "./catalogue.js";
import { hasDB, sbGet } from "./supabase.js";
import { syncCart, toast, openCart } from "./render.js";

const PRODUCT_COLUMNS = "id,code,title,description,module_slug,price_cents,sort_order,preview_pages";

const CART_KEY = "cta_cart";

/**
 * Restore the cart saved by a previous visit, if there is one. Called once
 * at startup, before the first render, so a refresh doesn't lose it —
 * that's the whole point. Each cart line is a full snapshot (id, code,
 * title, module_slug, price_cents) rather than just an id, so this works
 * even before loadProducts() below has resolved.
 */
export function loadCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (raw) state.cart = JSON.parse(raw);
  } catch {
    // localStorage unavailable (e.g. private browsing) — cart just starts empty, as it always did before this.
  }
}

export function saveCart() {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
  } catch {
    // ignore — worst case the cart doesn't survive a reload, same as before this existed
  }
}

/**
 * Load the catalogue.
 * With Supabase configured: only rows where is_active = true, ordered by sort_order.
 * Without it (or if the request fails): the local SEED list, so the site still works.
 */
export async function loadProducts() {
  if (hasDB) {
    try {
      state.products = await sbGet(
        `products?select=${PRODUCT_COLUMNS}&is_active=eq.true&order=sort_order.asc`
      );
    } catch (err) {
      console.warn("Supabase unavailable, using local catalogue:", err.message);
      state.products = SEED;
    }
  } else {
    state.products = SEED;
  }
  syncCart();
}

/** Add a section. One of each — buying the same PDF twice makes no sense. */
export function addToCart(id) {
  const product = state.products.find((p) => p.id === id);
  if (!product) return;

  if (state.cart.some((c) => c.id === id)) {
    toast("Already in your cart");
    openCart();
    return;
  }

  state.cart.push({
    id: product.id,
    code: product.code,
    title: product.title,
    module_slug: product.module_slug,
    price_cents: product.price_cents,
  });
  state.checkoutStep = "cart";
  saveCart();
  syncCart();
  toast(`${product.title} added to cart`);
}

export function removeFromCart(id) {
  state.cart = state.cart.filter((c) => c.id !== id);
  if (!state.cart.length) state.checkoutStep = "cart";
  saveCart();
  syncCart();
}
