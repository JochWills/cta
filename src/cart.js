import { state } from "./state.js";
import { SEED } from "./catalogue.js";
import { hasDB, sbGet } from "./supabase.js";
import { syncCart, toast, openCart } from "./render.js";

const PRODUCT_COLUMNS = "id,code,title,description,module_slug,price_cents,sort_order";

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
  syncCart();
  toast(`${product.title} added to cart`);
}

export function removeFromCart(id) {
  state.cart = state.cart.filter((c) => c.id !== id);
  if (!state.cart.length) state.checkoutStep = "cart";
  syncCart();
}
