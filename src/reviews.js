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
  setUpCarousel(); // the fallback cards in index.html, until the real ones load
  startAutoplay();
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
  showHeroRating(rows);
  $("#reviews .review-grid").innerHTML = rows.map(reviewCard).join("");
  wireReadMore();
  setUpCarousel();
}

/** The small average rating under the hero intro text, from the same published reviews. */
function showHeroRating(rows) {
  const rated = rows.filter((r) => r.rating);
  if (!rated.length) return;
  const avg = rated.reduce((sum, r) => sum + r.rating, 0) / rated.length;
  $("#heroRating").innerHTML = `${starsHtml(Math.round(avg), "hero-rating-stars")}
    <strong>${avg.toFixed(1)}</strong><span class="hero-rating-count">(${rated.length})</span>`;
  $("#heroRating").setAttribute("aria-label", `Rated ${avg.toFixed(1)} out of 5 from ${rated.length} reviews`);
  $("#heroRatingWrap").hidden = false;
}

/**
 * The reviews sit in one horizontally scrolling row (CSS scroll-snap does the
 * swiping and snapping); this adds the arrows and one dot per "page" of
 * cards. Run again whenever the cards change, and on resize, since how many
 * fit at once depends on the width.
 */
function setUpCarousel() {
  const track = $("#reviewTrack");
  const nav = $("#reviewNav");
  const dots = $("#reviewDots");
  const cards = [...track.querySelectorAll(".review")];
  if (!cards.length) return;

  const perView = () => Math.max(1, Math.round(track.clientWidth / cards[0].offsetWidth));
  const pages = () => Math.ceil(cards.length / perView());
  // The last page can be a partial one (3 reviews, 2 in view), so being
  // scrolled to the end always counts as the last page.
  const atEnd = () => track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
  const page = () => (atEnd() ? pages() - 1 : Math.round(track.scrollLeft / track.clientWidth));
  // Wraps around, so "next" on the last page goes back to the first.
  const goTo = (n) => {
    const total = pages();
    n = ((n % total) + total) % total;
    track.scrollTo({ left: n === total - 1 ? track.scrollWidth : n * track.clientWidth, behavior: "smooth" });
  };

  const sync = () => {
    const total = pages();
    nav.hidden = total < 2;
    if (dots.children.length !== total) {
      dots.innerHTML = Array.from(
        { length: total },
        (_, n) => `<button type="button" class="review-dot" data-page="${n}" aria-label="Show reviews page ${n + 1}"></button>`
      ).join("");
    }
    const current = Math.min(page(), total - 1);
    [...dots.children].forEach((d, n) => d.setAttribute("aria-current", String(n === current)));
  };

  // onclick/onscroll rather than addEventListener, so running this again
  // after the cards are replaced doesn't stack up duplicate handlers.
  nav.onclick = (e) => {
    const arrow = e.target.closest("[data-dir]");
    const dot = e.target.closest("[data-page]");
    if (arrow) goTo(page() + Number(arrow.dataset.dir));
    else if (dot) goTo(Number(dot.dataset.page));
    lastTouched = Date.now();
  };
  let ticking = false;
  track.onscroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      sync();
    });
  };
  sync();
  carouselSync = sync;
  carouselNext = () => goTo(page() + 1);
}
let carouselSync = () => {};
let carouselNext = () => {};
addEventListener("resize", () => carouselSync());

/* Auto-advance: the next page every AUTOPLAY_MS, looping back to the start.
   Holds still while the visitor is pointing at or reading the reviews, for a
   while after they last swiped or clicked, when the tab is in the
   background, and entirely for anyone who prefers reduced motion. */
const AUTOPLAY_MS = 6000;
const IDLE_AFTER_TOUCH_MS = 10000;
let lastTouched = 0;
let hovering = false;

function startAutoplay() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const section = $("#reviews");
  section.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && (hovering = true));
  section.addEventListener("pointerleave", () => (hovering = false));
  ["pointerdown", "wheel", "keydown"].forEach((type) =>
    $("#reviewTrack").addEventListener(type, () => (lastTouched = Date.now()), { passive: true })
  );
  setInterval(() => {
    const busy =
      hovering ||
      document.hidden ||
      Date.now() - lastTouched < IDLE_AFTER_TOUCH_MS ||
      section.contains(document.activeElement) ||
      section.querySelector(".review.is-open") ||
      $("#reviewNav").hidden;
    if (!busy) carouselNext();
  }, AUTOPLAY_MS);
}
