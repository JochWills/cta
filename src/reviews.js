/**
 * "Read more" for the Reviews section. Every .review-body is clamped to the
 * same height in CSS; this adds a toggle only to the ones whose text actually
 * overflows that height, so a short review never gets a pointless button.
 * Overflow depends on the card's width, so it's re-checked on resize.
 */

function sync(review, body, btn) {
  if (review.classList.contains("is-open")) return; // expanded — leave it alone
  const clamped = body.scrollHeight > body.clientHeight + 1;
  review.classList.toggle("is-clamped", clamped);
  btn.hidden = !clamped;
}

export function initReviews() {
  const items = [...document.querySelectorAll(".review")].map((review) => {
    const body = review.querySelector(".review-body");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "review-more";
    btn.textContent = "Read more";
    btn.setAttribute("aria-expanded", "false");
    body.after(btn);

    btn.addEventListener("click", () => {
      const open = review.classList.toggle("is-open");
      btn.textContent = open ? "Show less" : "Read more";
      btn.setAttribute("aria-expanded", String(open));
      if (!open) sync(review, body, btn);
    });
    return [review, body, btn];
  });

  const syncAll = () => items.forEach((args) => sync(...args));
  syncAll();
  // Web fonts can land after this runs and change line wrapping.
  document.fonts?.ready.then(syncAll);
  addEventListener("resize", syncAll);
}
