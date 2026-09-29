/**
 * The /review page (review.html) — a link Courts sends to buyers. Anyone
 * with the link can submit; every review lands unpublished and only reaches
 * the homepage once it's published from the admin page's Reviews tab (see
 * supabase/schema.sql section 9 for the rules that enforce that).
 */
import { $, esc } from "./state.js";
import { hasDB, sbInsert } from "./supabase.js";

$("#yr").textContent = new Date().getFullYear();

function showError(message) {
  $("#reviewError").innerHTML = message ? `<div class="err">${esc(message)}</div>` : "";
}

function showThanks() {
  $("#reviewCard").innerHTML = `
    <div class="ok-panel">
      <div class="ring"><svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg></div>
      <h3>Thank you</h3>
      <p>Your review's been sent. It'll show on the site once I've had a look at it.</p>
      <a href="/" class="btn" style="margin-top:22px;">Back to the shop</a>
    </div>`;
}

$("#reviewForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");

  const rating = Number(document.querySelector('input[name="rating"]:checked')?.value);
  const body = $("#reviewBody").value.trim().replace(/\r\n?/g, "\n");
  const name = $("#reviewName").value.trim();

  if (!rating) return showError("Pick a star rating first.");
  if (body.length < 10) return showError("Write at least a sentence or two.");

  // A bot filled the hidden field — act as if it worked and send nothing.
  if ($("#reviewWebsite").value) return showThanks();

  const btn = $("#reviewSubmit");
  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    if (hasDB) await sbInsert("reviews", { name: name || null, body, rating });
    showThanks();
  } catch {
    showError("Your review couldn't be sent. Please try again in a moment.");
    btn.disabled = false;
    btn.textContent = "Send review";
  }
});
