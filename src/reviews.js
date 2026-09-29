/**
 * The homepage's Student feedback section.
 *
 * Published reviews come from the `reviews` table (submitted on /review,
 * published from the admin page — see supabase/schema.sql section 9). The
 * cards already in index.html are the fallback: they stay put when there's
 * no database configured or the fetch fails, and get replaced otherwise.
 *
 * "Read more": every .review-body is clamped to the same height in CSS; a
 * toggle is added only to the ones whose text actually overflows it, so a
 * short review never gets a pointless button. Overflow depends on the
 * card's width, so it's re-checked on resize.
 */
import { $, esc } from "./state.js";
import { hasDB, sbGet } from "./supabase.js";

/** Five stars, `rating` of them filled. Also used by the admin page's Reviews tab. */
export function starsHtml(rating, className = "") {
  const stars = [1, 2, 3, 4, 5].map((n) => `<span class="star${n <= rating ? " is-on" : ""}"></span>`).join("");
  return `<span class="${className}" role="img" aria-label="${rating} out of 5 stars">${stars}</span>`;
}

/** Blank lines (or single line breaks) in a review become separate paragraphs. */
const paragraphs = (body) =>
  body
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join("");

function reviewCard(r) {
  return `
    <figure class="review">
      ${r.rating ? starsHtml(r.rating, "review-stars") : ""}
      <blockquote class="review-body">${paragraphs(r.body)}</blockquote>
      <figcaption>${esc(r.name || "Anonymous student")}</figcaption>
    </figure>`;
}

function syncClamp(review) {
  if (review.classList.contains("is-open")) return; // expanded — leave it alone
  const body = review.querySelector(".review-body");
  const clamped = body.scrollHeight > body.clientHeight + 1;
  review.classList.toggle("is-clamped", clamped);
  review.querySelector(".review-more").hidden = !clamped;
}

const syncAll = () => document.querySelectorAll(".review").forEach(syncClamp);

/** Give every card that doesn't have one yet its Read more button. */
function wireReadMore() {
  document.querySelectorAll(".review").forEach((review) => {
    if (review.querySelector(".review-more")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "review-more";
    btn.textContent = "Read more";
    btn.setAttribute("aria-expanded", "false");
    review.querySelector(".review-body").after(btn);

    btn.addEventListener("click", () => {
      const open = review.classList.toggle("is-open");
      btn.textContent = open ? "Show less" : "Read more";
      btn.setAttribute("aria-expanded", String(open));
      if (!open) syncClamp(review);
    });
  });
  syncAll();
}

export async function initReviews() {
  wireReadMore();
  // Web fonts can land after this runs and change line wrapping.
  document.fonts?.ready.then(syncAll);
  addEventListener("resize", syncAll);

  if (!hasDB) return;
  let rows;
  try {
    rows = await sbGet("reviews?select=id,name,body,rating&is_published=eq.true&order=created_at.desc");
  } catch {
    return; // keep the cards already in the page
  }

  if (!rows.length) {
    // Nothing published — hide the section and every link pointing at it.
    $("#reviews").hidden = true;
    document.querySelectorAll('a[href="#reviews"]').forEach((a) => (a.closest("li") || a).remove());
    return;
  }
  $("#reviews .review-grid").innerHTML = rows.map(reviewCard).join("");
  wireReadMore();
}
