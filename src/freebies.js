import { state, esc, $, isEmail } from "./state.js";
import { hasDB, sbFunction } from "./supabase.js";

/**
 * Freebies — notes in the "freebies" module (see isFreebie in
 * catalogue.js). No cart, no Paystack: the card's download button opens
 * this modal, which asks for a name and email and calls free-download.
 * That records the download on the admin page's Orders list (as status
 * "free", left out of every stat) and returns a signed link that's set to
 * download rather than open, so pointing the page at it starts the
 * download without leaving the shop.
 */

let current = null; // the freebie the modal is open for

function remembered(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

export function openFreebie(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  current = p;

  $("#freebieTitle").textContent = p.title;
  $("#freebieName").value ||= remembered("cta_last_name");
  $("#freebieEmail").value ||= remembered("cta_last_email");
  $("#freebieResult").innerHTML = "";
  $("#freebieSubmit").disabled = false;
  $("#freebieSubmit").textContent = "Download";

  $("#freebieModal").hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => ($("#freebieName").value ? $("#freebieSubmit") : $("#freebieName")).focus(), 60);
}

export function closeFreebie() {
  $("#freebieModal").hidden = true;
  document.body.style.overflow = "";
}

const ERRORS = {
  invalid: "Enter your name and a valid email address.",
  not_found: "This freebie isn't available anymore.",
  server_error: "Something went wrong on our end. Try again in a moment.",
};

export async function submitFreebie() {
  if (!current) return;
  const result = $("#freebieResult");
  const button = $("#freebieSubmit");
  const name = $("#freebieName").value.trim();
  const email = $("#freebieEmail").value.trim();
  result.innerHTML = "";

  if (!name) {
    result.innerHTML = `<div class="err">${ERRORS.invalid}</div>`;
    return $("#freebieName").focus();
  }
  if (!isEmail(email)) {
    result.innerHTML = `<div class="err">${ERRORS.invalid}</div>`;
    return $("#freebieEmail").focus();
  }
  if (!hasDB) {
    result.innerHTML = `<div class="err">Demo mode — freebies only download on the live shop.</div>`;
    return;
  }

  button.disabled = true;
  button.textContent = "Getting your notes…";
  let res;
  try {
    res = await sbFunction("free-download", { product_id: current.id, name, email });
  } catch (err) {
    console.error(err);
    res = { ok: false, reason: "server_error" };
  }
  button.disabled = false;
  button.textContent = "Download";

  if (!res.ok) {
    result.innerHTML = `<div class="err">${esc(ERRORS[res.reason] || ERRORS.server_error)}</div>`;
    return;
  }

  try {
    localStorage.setItem("cta_last_name", name);
    localStorage.setItem("cta_last_email", email);
  } catch {
    // ignore — worst case the next freebie isn't prefilled
  }

  window.location.href = res.url; // a download link, so the page stays put
  result.innerHTML = `<p class="note" style="text-align:left;">Your download has started. If it didn't,
    <a href="${esc(res.url)}">download it here</a>.</p>`;
}
