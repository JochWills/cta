import { state, $ } from "./state.js";
import {
  renderModules,
  renderFilters,
  renderDrawer,
  updateCartCount,
  openCart,
  closeCart,
  setFilter,
  openPreview,
  closePreview,
} from "./render.js";
import { loadProducts, loadCart, addToCart, removeFromCart } from "./cart.js";
import { placeOrder } from "./checkout.js";
import { openDownloadModal, closeDownloadModal, submitDownloadRequest } from "./downloads.js";

/* ------------------------------------------------------------------
   Delegated click handling — the grid and drawer are re-rendered often,
   so listeners live on the document rather than on individual elements.
------------------------------------------------------------------ */
document.addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]");
  if (add) {
    addToCart(add.dataset.add);
    if (add.closest("#previewModal")) closePreview();
    return;
  }

  const remove = e.target.closest("[data-rm]");
  if (remove) return removeFromCart(remove.dataset.rm);

  const preview = e.target.closest("[data-preview]");
  if (preview) return openPreview(preview.dataset.preview);
  if (e.target.closest("#closePreview") || e.target.closest("#previewScrim")) return closePreview();

  if (e.target.closest("#openDownload")) {
    e.preventDefault();
    return openDownloadModal();
  }
  if (e.target.closest("#closeDownload") || e.target.closest("#downloadScrim")) return closeDownloadModal();

  const jump = e.target.closest("[data-jump]");
  if (jump) {
    e.preventDefault();
    return setFilter(jump.dataset.jump);
  }

  const filter = e.target.closest("[data-filter]");
  if (filter) return setFilter(filter.dataset.filter);

  if (e.target.closest("#cartBtn")) return openCart();
  if (e.target.closest("#closeCart") || e.target.closest("#scrim")) return closeCart();

  if (e.target.closest("#keepShopping")) {
    state.checkoutStep = "cart";
    renderDrawer();
    return closeCart();
  }
  if (e.target.closest("#toDetails")) {
    state.checkoutStep = "details";
    renderDrawer();
    setTimeout(() => $("#buyerEmail")?.focus(), 60);
    return;
  }
  if (e.target.closest("#backToCart")) {
    state.checkoutStep = "cart";
    return renderDrawer();
  }
  if (e.target.closest("#placeOrder")) return placeOrder();

  if (e.target.closest("#menuBtn")) {
    const nav = $("#nav");
    const open = nav.classList.toggle("is-open");
    $("#menuBtn").setAttribute("aria-expanded", String(open));
    return;
  }
  if (e.target.closest("#nav a")) return $("#nav").classList.remove("is-open");
});

// Any [data-download-form] — the modal's and the Contact section's are the
// same markup shape, both handled by src/downloads.js.
document.addEventListener("submit", (e) => {
  const form = e.target.closest("[data-download-form]");
  if (!form) return;
  e.preventDefault();
  submitDownloadRequest(form);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("#previewModal").hidden) return closePreview();
  if (!$("#downloadModal").hidden) return closeDownloadModal();
  closeCart();
});

/* ------------------------------------------------------------------
   Nav underline follows the section in view
------------------------------------------------------------------ */
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      document.querySelectorAll(".nav a").forEach((a) => {
        a.classList.toggle("is-active", a.getAttribute("href") === `#${entry.target.id}`);
      });
    });
  },
  { rootMargin: "-45% 0px -50% 0px" }
);
["shop", "about", "faqs", "contact"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) observer.observe(el);
});

/* ------------------------------------------------------------------
   Returning from Paystack's payment page. paid=1 only means the buyer came
   back through the flow — not that the payment actually succeeded (Paystack
   sends everyone here, declined or cancelled included). The real answer
   comes from paystack-webhook, which the browser can't see, so this opens
   the download modal and lets it check (and quietly retry) rather than
   promising a purchase that might not have gone through. The email comes
   from localStorage (saved by checkout.js right before the Paystack
   redirect) so this works with no typing — a buyer using a different
   device or browser just uses the footer's "Get your notes" link instead.
------------------------------------------------------------------ */
const returnParams = new URLSearchParams(location.search);
if (returnParams.get("paid") === "1") {
  const reference = returnParams.get("ref") || "";
  let email = "";
  try {
    email = localStorage.getItem("cta_last_email") || "";
  } catch {
    // localStorage unavailable — the download modal still opens, just without a prefilled email
  }
  history.replaceState({}, "", location.pathname + location.hash);
  openDownloadModal({ reference, email, auto: Boolean(reference && email) });
}

/* ------------------------------------------------------------------
   Init
------------------------------------------------------------------ */
$("#yr").textContent = new Date().getFullYear();
loadCart(); // before the first render, so a restored cart shows immediately rather than popping in
updateCartCount();
renderModules();
renderFilters();
renderDrawer();
loadProducts();
