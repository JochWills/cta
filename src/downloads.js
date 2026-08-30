import { $, esc, isEmail } from "./state.js";
import { hasDB, sbFunction } from "./supabase.js";

/**
 * The "get your notes" modal — this is the actual delivery mechanism right
 * now, not just a nicety: there's no domain to send delivery email from yet
 * (see CLAUDE.md), so a buyer gets their download links either right after
 * paying (opened automatically, see main.js's ?paid=1 handling) or any time
 * later from the footer link, by giving back their order reference and the
 * email they checked out with.
 */

let pollTimer = null;

export function openDownloadModal({ reference = "", email = "", auto = false } = {}) {
  clearTimeout(pollTimer);
  $("#downloadModal").hidden = false;
  document.body.style.overflow = "hidden";
  $("#dlReference").value = reference;
  $("#dlEmail").value = email;
  $("#dlResult").innerHTML = "";
  if (auto && reference && email) submitDownloadRequest({ silent: true });
}

export function closeDownloadModal() {
  clearTimeout(pollTimer);
  $("#downloadModal").hidden = true;
  document.body.style.overflow = "";
}

/**
 * Look up an order and render whatever comes back. `silent` skips the
 * "enter both fields" validation errors (used for the automatic check right
 * after checkout, where the reference/email came from the redirect and
 * localStorage rather than a form the buyer filled in) and, if the order is
 * still "pending", quietly retries a few times — the webhook that flips an
 * order to paid can lag a few seconds behind the redirect back from
 * Paystack.
 */
export async function submitDownloadRequest(opts = {}) {
  clearTimeout(pollTimer);

  const reference = $("#dlReference").value.trim().toUpperCase();
  const email = $("#dlEmail").value.trim();
  const resultBox = $("#dlResult");
  const button = $("#dlSubmit");

  if (!reference || !isEmail(email)) {
    if (!opts.silent) {
      resultBox.innerHTML = `<div class="err">Enter your order reference and the email you paid with.</div>`;
    }
    return;
  }

  if (!hasDB) {
    resultBox.innerHTML = `<div class="err">Demo mode — no live orders to look up here.</div>`;
    return;
  }

  button.disabled = true;
  resultBox.innerHTML = `<p class="note" style="margin-top:14px;">Checking your order…</p>`;

  try {
    const res = await sbFunction("order-download", { reference, email });
    renderDownloadResult(res, opts);
  } catch (err) {
    console.error(err);
    resultBox.innerHTML = `<div class="err">Couldn't reach the server just now. Check your connection and try again.</div>`;
  } finally {
    button.disabled = false;
  }
}

const PENDING_MESSAGES = {
  pending: "Payment hasn't been confirmed yet — this can take a minute or two after checkout. This page will keep checking automatically.",
  failed: "This order shows as failed, so there's nothing to download yet. If you were charged, get in touch and we'll sort it out.",
  refunded: "This order was refunded, so there's nothing to download.",
  not_found: "No paid order matches that reference and email. Double-check both — the reference is on your confirmation screen.",
  server_error: "Something went wrong on our end. Try again in a moment.",
};

function renderDownloadResult(res, opts) {
  const resultBox = $("#dlResult");
  clearTimeout(pollTimer);

  if (res.ok) {
    resultBox.innerHTML = `
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
      <p class="note">Links expire after 24 hours — come back here any time with your reference and email for fresh ones.</p>`;
    return;
  }

  resultBox.innerHTML = `
    <div class="err">${esc(PENDING_MESSAGES[res.reason] || PENDING_MESSAGES.server_error)}</div>
    ${res.reference ? `<p class="note">Order <span class="ref">${esc(res.reference)}</span></p>` : ""}`;

  // Auto-retry a handful of times right after checkout, quietly, before
  // asking the buyer to do anything themselves.
  if (res.reason === "pending" && opts.silent && (opts.attempt ?? 0) < 5) {
    pollTimer = setTimeout(
      () => submitDownloadRequest({ silent: true, attempt: (opts.attempt ?? 0) + 1 }),
      3000
    );
  }
}
