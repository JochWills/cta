import { state, $, isEmail } from "./state.js";
import { hasDB, sbInsert, sbFunction } from "./supabase.js";
import { cartTotal, syncCart } from "./render.js";
import { saveCart } from "./cart.js";

/** Human-readable order reference, e.g. CTA-M4K2P9. Also used as the Paystack transaction reference. */
function makeReference() {
  return "CTA-" + Date.now().toString(36).toUpperCase().slice(-6);
}

/**
 * Save the order, then hand off to Paystack.
 *
 * The order is written with status "pending" first, then paystack-initiate
 * looks it up and starts a Paystack transaction, and the browser is sent to
 * Paystack's hosted payment page. Nothing here marks the order paid — that
 * only happens when Paystack calls the paystack-webhook Edge Function,
 * which is the only thing allowed to flip the status (see its comment for
 * why: the browser is never trusted with that).
 */
export async function placeOrder() {
  const nameInput = $("#buyerName");
  const emailInput = $("#buyerEmail");
  const termsInput = $("#acceptTerms");
  const errorBox = $("#checkoutError");
  const button = $("#placeOrder");

  const full_name = (nameInput?.value || "").trim();
  const email = (emailInput?.value || "").trim();
  errorBox.innerHTML = "";

  if (!isEmail(email)) {
    errorBox.innerHTML = `<div class="err">Enter a valid email address so your notes can reach you.</div>`;
    emailInput?.focus();
    return;
  }

  if (!termsInput?.checked) {
    errorBox.innerHTML = `<div class="err">Confirm you understand the purchase is final before placing your order.</div>`;
    termsInput?.focus();
    return;
  }

  button.textContent = "Saving order…";
  button.disabled = true;

  const reference = makeReference();
  const order = {
    reference,
    email,
    full_name: full_name || null,
    // Snapshot of the cart, so the order stays correct if a product is later edited.
    items: state.cart.map((i) => ({
      product_id: i.id,
      code: i.code,
      title: i.title,
      price_cents: i.price_cents,
    })),
    total_cents: cartTotal(),
    status: "pending",
    // Record-keeping, not just a UI gate — see the terms_accepted_at column
    // comment in supabase/schema.sql. Only reachable once termsInput.checked
    // is confirmed true above.
    terms_accepted_at: new Date().toISOString(),
  };

  try {
    if (hasDB) {
      await sbInsert("orders", order);

      // The order is placed at this point regardless of what happens next —
      // clear the cart (and its saved copy) now rather than leaving stale
      // items sitting there if the buyer comes back after Paystack.
      state.cart = [];
      saveCart();

      // So the download modal can prefill and auto-check on return from
      // Paystack (see main.js's ?paid=1 handling) without asking the buyer
      // to retype the email they just gave us. Stays on their device only —
      // same as the cart (see privacy.html).
      try {
        localStorage.setItem("cta_last_email", email);
      } catch {
        // ignore — worst case the download modal just isn't prefilled
      }

      button.textContent = "Redirecting to payment…";
      const { authorization_url } = await sbFunction("paystack-initiate", { reference });
      window.location.href = authorization_url; // leaving the page — Paystack takes it from here
      return;
    }

    // No Supabase configured — nothing to charge, just fake the confirmation
    // so the shop stays clickable for design work (see CLAUDE.md).
    state.lastOrderRef = `Order ${reference} (demo — Supabase not connected)`;
    state.cart = [];
    saveCart();
    state.checkoutStep = "done";
    syncCart();
  } catch (err) {
    console.error(err);
    errorBox.innerHTML = `<div class="err">Couldn't start payment just now. Check your connection and try again.</div>`;
    button.textContent = "Place order";
    button.disabled = false;
  }
}
