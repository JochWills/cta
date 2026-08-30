import { state, $, isEmail } from "./state.js";
import { hasDB, sbInsert } from "./supabase.js";
import { cartTotal, syncCart } from "./render.js";

/** Human-readable order reference, e.g. CTA-M4K2P9. Also used as PayFast m_payment_id. */
function makeReference() {
  return "CTA-" + Date.now().toString(36).toUpperCase().slice(-6);
}

/**
 * Save the order and capture the buyer's email.
 *
 * The order is written with status "pending". Nothing is delivered yet —
 * PayFast slots in at the marked point below, and the ITN webhook
 * (supabase/functions/payfast-notify) is what flips the order to "paid"
 * and emails the download links.
 */
export async function placeOrder() {
  const nameInput = $("#buyerName");
  const emailInput = $("#buyerEmail");
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
  };

  try {
    if (hasDB) {
      await sbInsert("orders", order);
      state.lastOrderRef = `Order ${reference}`;
    } else {
      state.lastOrderRef = `Order ${reference} (demo — Supabase not connected)`;
    }

    // ── PAYFAST GOES HERE ────────────────────────────────────────────
    // Call the payfast-initiate Edge Function with { reference }, then
    // post the signed fields it returns to https://www.payfast.co.za/eng/process.
    // The signature needs the passphrase, so it must be built server-side.
    //
    //   const { action, fields } = await sbFunction("payfast-initiate", { reference });
    //   postToPayfast(action, fields);   // builds and submits a hidden form
    //   return;
    // ─────────────────────────────────────────────────────────────────

    state.cart = [];
    state.checkoutStep = "done";
    syncCart();
  } catch (err) {
    console.error(err);
    errorBox.innerHTML = `<div class="err">Couldn't save the order just now. Check your connection and try again.</div>`;
    button.textContent = "Place order";
    button.disabled = false;
  }
}
