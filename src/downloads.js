import { esc, isEmail } from "./state.js";
import { hasDB, sbFunction } from "./supabase.js";

/**
 * The "get your notes" lookup — this is the actual delivery mechanism right
 * now, not just a nicety: there's no domain to send delivery email from yet
 * (see CLAUDE.md), so a buyer gets their download links either right after
 * paying (the modal opens automatically, see main.js's ?paid=1 handling),
 * from the always-on copy of the same form in the Contact section, or from
 * the footer link (which opens the modal) any time later.
 *
 * Both forms share this one implementation — any element matching
 * [data-download-form] works, found by main.js's delegated submit listener
 * and by openDownloadModal below. Fields inside it are found by
 * [data-field="reference|email|submit|result"] rather than ids, since a
 * page can have more than one of these forms at once.
 */

// Keyed by form element, so the modal and the Contact section form (if
// both were ever mid-request) don't cancel each other's retry timer.
const pollTimers = new WeakMap();

function fieldsOf(form) {
  return {
    form,
    reference: form.querySelector('[data-field="reference"]'),
    email: form.querySelector('[data-field="email"]'),
    submit: form.querySelector('[data-field="submit"]'),
    result: form.querySelector('[data-field="result"]'),
  };
}

export function openDownloadModal({ reference = "", email = "", auto = false } = {}) {
  const modal = document.getElementById("downloadModal");
  const form = modal.querySelector("[data-download-form]");
  clearTimeout(pollTimers.get(form));

  modal.hidden = false;
  document.body.style.overflow = "hidden";

  const f = fieldsOf(form);
  f.reference.value = reference;
  f.email.value = email;
  f.result.innerHTML = "";
  if (auto && reference && email) submitDownloadRequest(form, { silent: true });
}

export function closeDownloadModal() {
  const modal = document.getElementById("downloadModal");
  clearTimeout(pollTimers.get(modal.querySelector("[data-download-form]")));
  modal.hidden = true;
  document.body.style.overflow = "";
}

/**
 * Look up an order and render whatever comes back into `form`. `silent`
 * skips the "enter both fields" validation error (used for the automatic
 * check right after checkout, where the reference/email came from the
 * redirect and localStorage rather than a form the buyer filled in) and, if
 * the order is still "pending", quietly retries a few times — the webhook
 * that flips an order to paid can lag a few seconds behind the redirect
 * back from Paystack.
 */
export async function submitDownloadRequest(form, opts = {}) {
  clearTimeout(pollTimers.get(form));
  const f = fieldsOf(form);

  const reference = f.reference.value.trim().toUpperCase();
  const email = f.email.value.trim();

  if (!reference || !isEmail(email)) {
    if (!opts.silent) {
      f.result.innerHTML = `<div class="err">Enter your order reference and the email you paid with.</div>`;
    }
    return;
  }

  if (!hasDB) {
    f.result.innerHTML = `<div class="err">Demo mode — no live orders to look up here.</div>`;
    return;
  }

  f.submit.disabled = true;
  f.result.innerHTML = `<p class="note" style="margin-top:14px;">Checking your order…</p>`;

  try {
    const res = await sbFunction("order-download", { reference, email });
    renderDownloadResult(f, res, opts);
  } catch (err) {
    console.error(err);
    f.result.innerHTML = `<div class="err">Couldn't reach the server just now. Check your connection and try again.</div>`;
  } finally {
    f.submit.disabled = false;
  }
}

const PENDING_MESSAGES = {
  pending: "Payment hasn't been confirmed yet — this can take a minute or two after checkout. This will keep checking automatically.",
  failed: "This order shows as failed, so there's nothing to download yet. If you were charged, get in touch and we'll sort it out.",
  refunded: "This order was refunded, so there's nothing to download.",
  not_found: "No paid order matches that reference and email. Double-check both — the reference is on your confirmation screen.",
  server_error: "Something went wrong on our end. Try again in a moment.",
};

function renderDownloadResult(f, res, opts) {
  clearTimeout(pollTimers.get(f.form));

  if (res.ok) {
    f.result.innerHTML = `
      <p class="note" style="margin:14px 0 0;">Order <span class="ref">${esc(res.reference)}</span></p>
      ${res.items
        .map(
          (i) => `
        <div class="line">
          <div><h4>${esc(i.title)}</h4></div>
          ${
            i.url
              ? `<a class="btn" href="${esc(i.url)}" target="_blank" rel="noopener">Download</a>`
              : `<span class="note" style="margin:0;">Not uploaded yet — contact us</span>`
          }
        </div>`
        )
        .join("")}
      <p class="note">Links expire after 24 hours — come back any time with your reference and email for fresh ones.</p>`;
    return;
  }

  f.result.innerHTML = `
    <div class="err">${esc(PENDING_MESSAGES[res.reason] || PENDING_MESSAGES.server_error)}</div>
    ${res.reference ? `<p class="note">Order <span class="ref">${esc(res.reference)}</span></p>` : ""}`;

  // Auto-retry a handful of times right after checkout, quietly, before
  // asking the buyer to do anything themselves.
  if (res.reason === "pending" && opts.silent && (opts.attempt ?? 0) < 5) {
    pollTimers.set(
      f.form,
      setTimeout(() => submitDownloadRequest(f.form, { silent: true, attempt: (opts.attempt ?? 0) + 1 }), 3000)
    );
  }
}
