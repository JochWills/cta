/**
 * Smooth open/close for the FAQ accordion. Native <details>/<summary> has no
 * transition of its own — it just snaps open or shut — so this intercepts
 * the summary's click, drives `open` itself, and animates the height in
 * between via the Web Animations API (broadly supported, no library).
 *
 * That interception has a side effect worth knowing about: exclusivity
 * (index.html gives every <details> the same name="faq", so the browser's
 * own "opening one closes any other open one" behaviour applies) is part
 * of the *default* click action — the one this file calls
 * preventDefault() on. So that behaviour has to be reimplemented here
 * manually instead of relying on the browser: opening one now explicitly
 * shrinks whichever sibling in its group was open, rather than trusting
 * `name` to do it.
 */

const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
const DURATION = REDUCED_MOTION ? 1 : 260;
const EASING = "ease-out";

class FaqItem {
  constructor(details, group) {
    this.el = details;
    this.summary = details.querySelector("summary");
    this.group = group; // shared array — every FaqItem in the same name group, filled in by initFaqAccordions
    this.animation = null;
    this.isExpanding = false;
    this.summary.addEventListener("click", (e) => this.onClick(e));
  }

  onClick(e) {
    e.preventDefault(); // we're driving `open` ourselves, on our own schedule — see file comment
    if (this.el.open || this.isExpanding) {
      this.shrink();
    } else {
      this.group.forEach((item) => item !== this && (item.el.open || item.isExpanding) && item.shrink());
      this.expand();
    }
  }

  /** Animate this.el's height between two pixel values, then run onFinish. */
  runAnimation(fromHeight, toHeight, onFinish) {
    if (this.animation) this.animation.cancel();
    this.el.style.overflow = "hidden"; // clips the content while its box is mid-resize
    this.animation = this.el.animate(
      { height: [`${fromHeight}px`, `${toHeight}px`] },
      { duration: DURATION, easing: EASING }
    );
    this.animation.onfinish = () => {
      this.animation = null;
      this.el.style.overflow = "";
      onFinish();
    };
  }

  /**
   * this.el's own true height once closed — not just the summary's height.
   * .faq's padding and border-bottom sit on the <details> element itself and
   * apply whether it's open or not, so leaving them out here (an earlier
   * version of this used summary.offsetHeight alone) made the collapse
   * animation's target a bit short of the real thing: it looked right until
   * the animation finished and `open` actually flipped to false, at which
   * point the browser's own layout for the (real, padding-and-border-
   * inclusive) closed height kicked in and the box visibly snapped open by
   * that missing amount.
   */
  closedHeight() {
    const cs = getComputedStyle(this.el);
    return (
      this.summary.offsetHeight +
      parseFloat(cs.paddingTop) +
      parseFloat(cs.paddingBottom) +
      parseFloat(cs.borderTopWidth) +
      parseFloat(cs.borderBottomWidth)
    );
  }

  shrink() {
    const fromHeight = this.el.offsetHeight;
    this.runAnimation(fromHeight, this.closedHeight(), () => {
      this.el.open = false;
    });
  }

  expand() {
    this.el.style.overflow = "hidden";
    const fromHeight = this.el.offsetHeight;
    this.el.open = true; // reveals the answer so its real height can be measured below
    this.isExpanding = true;
    // One frame so the browser's laid out the now-open content before offsetHeight is read —
    // reading it in the same tick as `open = true` works in practice, but this is the
    // documented-safe order (see MDN's guidance on animating <details>).
    requestAnimationFrame(() => {
      this.runAnimation(fromHeight, this.el.offsetHeight, () => {
        this.isExpanding = false;
      });
    });
  }
}

/** Wire up every <details class="faq">, grouped by their name="..." attribute. */
export function initFaqAccordions() {
  const groups = new Map();
  document.querySelectorAll("details.faq").forEach((details) => {
    const name = details.getAttribute("name") || details; // ungrouped ones just get their own group of one
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(details);
  });

  groups.forEach((detailsList) => {
    const group = [];
    detailsList.forEach((details) => group.push(new FaqItem(details, group)));
  });
}
