import { state, $, isEmail } from "./state.js";
import {
  renderModules,
  renderFilters,
  renderDrawer,
  openCart,
  closeCart,
  setFilter,
  toast,
  openPreview,
  closePreview,
} from "./render.js";
import { loadProducts, addToCart, removeFromCart } from "./cart.js";
import { placeOrder } from "./checkout.js";

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

  // Contact form. TODO: point this at a real inbox (Formspree, or an Edge Function + Resend).
  if (e.target.closest("#contactSend")) {
    const email = $("#cEmail").value.trim();
    if (!isEmail(email)) {
      toast("Add a valid email so Courts can reply");
      $("#cEmail").focus();
      return;
    }
    toast("Message sent — Courts will reply shortly");
    $("#cName").value = "";
    $("#cEmail").value = "";
    $("#cMsg").value = "";
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("#previewModal").hidden) return closePreview();
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
["shop", "about", "how", "faqs", "contact"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) observer.observe(el);
});

/* ------------------------------------------------------------------
   Returning from Paystack's payment page. paid=1 only means the buyer came
   back through the flow — not that the payment actually succeeded (Paystack
   sends everyone here, declined or cancelled included). The real answer
   comes from paystack-webhook, which the browser can't see, so the message
   stays deliberately non-committal rather than promising a purchase that
   might not have gone through.
------------------------------------------------------------------ */
if (new URLSearchParams(location.search).get("paid") === "1") {
  toast("Thanks — we'll email your download links once the payment is confirmed.");
  history.replaceState({}, "", location.pathname + location.hash);
}

/* ------------------------------------------------------------------
   Init
------------------------------------------------------------------ */
$("#yr").textContent = new Date().getFullYear();
renderModules();
renderFilters();
renderDrawer();
loadProducts();
