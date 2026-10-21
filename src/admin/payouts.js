import { $, esc, rands } from "../state.js";
import { adminState } from "./state.js";

/**
 * The Payouts tab — Paystack's settlements (what it actually paid into the
 * bank), read live from Paystack by admin-payouts. A row opens to show the
 * sales that payout covered, fetched when first opened. "Waiting to be paid
 * out" is the paid orders after the newest settled sale — gross, before
 * Paystack's fees, which it only works out at settlement.
 */

const STATUS = {
  success: ["ok", "Paid out"],
  processing: ["warn", "Processing"],
  pending: ["warn", "Pending"],
  failed: ["bad", "Failed"],
};

let data = null;
const open = new Set();
const sales = new Map(); // settlement id -> transactions, or "loading" / an Error

const day = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "—";
const time = (iso) =>
  iso ? new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export function setPayouts(d) {
  data = d;
  renderPayouts();
}

export function renderPayouts() {
  if (!data) return;
  const list = data.settlements || [];
  const done = list.filter((s) => s.status === "success");
  const sum = (rows, key) => rows.reduce((t, s) => t + s[key], 0);
  const now = new Date();
  const thisMonth = done.filter((s) => {
    const d = new Date(s.date);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  // Paid orders Paystack hasn't paid out yet.
  const cutoff = data.last_settled_paid_at ? new Date(data.last_settled_paid_at).getTime() : 0;
  const waiting = adminState.orders.filter(
    (o) => o.status === "paid" && new Date(o.paid_at || o.created_at).getTime() > cutoff
  );
  const inFlight = list.filter((s) => s.status !== "success" && s.status !== "failed");
  const waitingCents = waiting.reduce((t, o) => t + o.total_cents, 0);
  const last = done[0];

  const tile = (label, value, sub) => `
    <div class="customer-tile"><span class="stat-label">${label}</span><strong>${value}</strong>${sub ? `<span class="stat-sub">${sub}</span>` : ""}</div>`;
  $("#payoutSummary").innerHTML =
    tile("Waiting to be paid out", rands(waitingCents),
      [waiting.length ? `${waiting.length} sale${waiting.length === 1 ? "" : "s"}, before fees` : "Nothing waiting",
        inFlight.length ? `${inFlight.length} payout${inFlight.length === 1 ? "" : "s"} on the way` : ""].filter(Boolean).join(" · ")) +
    tile("Last payout", last ? rands(last.paid_out_cents) : "—", last ? day(last.date) : "None yet") +
    tile("Paid out this month", rands(sum(thisMonth, "paid_out_cents")), `${thisMonth.length} payout${thisMonth.length === 1 ? "" : "s"}`) +
    tile("Paid out all time", rands(sum(done, "paid_out_cents")), `${rands(sum(done, "fees_cents"))} in Paystack fees`);

  const box = $("#payoutsTable");
  if (!list.length) {
    box.innerHTML = `<div class="empty-state">No payouts yet. Paystack pays sales into your bank a day or two after they're made.</div>`;
    return;
  }
  box.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table customer-table payout-table">
        <thead><tr><th>Payout date</th><th>Status</th><th>Sales</th><th>Paystack fees</th><th>Paid to you</th></tr></thead>
        <tbody>${list.map(row).join("")}</tbody>
      </table>
    </div>`;
}

function row(s) {
  const isOpen = open.has(String(s.id));
  const [tone, label] = STATUS[s.status] || ["warn", s.status];
  return `
    <tr class="customer-row${isOpen ? " is-open" : ""}" data-payout-toggle="${esc(s.id)}">
      <td>
        <div class="customer-name">
          <svg class="customer-caret" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5l5 5 5-5"/></svg>
          <span>${esc(day(s.date))}</span>
        </div>
      </td>
      <td><span class="health-pill is-${tone}">${esc(label)}</span></td>
      <td>${rands(s.gross_cents)}</td>
      <td class="meta">${s.fees_cents ? `−${rands(s.fees_cents)}` : "—"}${s.deductions_cents ? `<div class="meta">−${rands(s.deductions_cents)} other</div>` : ""}</td>
      <td><strong>${rands(s.paid_out_cents)}</strong></td>
    </tr>
    <tr class="customer-detail" ${isOpen ? "" : "hidden"}>
      <td colspan="5">${isOpen ? detail(s) : ""}</td>
    </tr>`;
}

function detail(s) {
  const txs = sales.get(String(s.id));
  if (!txs || txs === "loading") return `<div class="customer-history"><p class="meta">Loading the sales in this payout…</p></div>`;
  if (txs instanceof Error) return `<div class="customer-history"><p class="meta">Couldn't load them. ${esc(txs.message)}</p></div>`;
  if (!txs.length) return `<div class="customer-history"><p class="meta">Paystack didn't list any sales for this payout.</p></div>`;
  const byRef = new Map(adminState.orders.map((o) => [o.reference, o]));
  return `
    <div class="customer-history">
      <p class="customer-history-head">${txs.length} sale${txs.length === 1 ? "" : "s"} in this payout</p>
      ${txs.map((t) => {
        const o = byRef.get(t.reference);
        const items = Array.isArray(o?.items) ? o.items.map((i) => i.title).join(", ") : "";
        return `
        <div class="history-order payout-sale">
          <div class="history-meta">
            <strong>${esc(o?.full_name || t.email || "—")}</strong>
            <span class="meta">${esc(t.reference)} · ${esc(time(t.paid_at))}</span>
            ${items ? `<span class="meta">${esc(items)}</span>` : ""}
          </div>
          <div class="payout-sale-amounts">
            <strong>${rands(t.amount_cents)}</strong>
            ${t.fees_cents ? `<span class="meta">−${rands(t.fees_cents)} fee</span>` : ""}
          </div>
        </div>`;
      }).join("")}
    </div>`;
}

/** Opens or closes a payout; the first open fetches its sales. */
export async function togglePayout(id, fetchSales) {
  id = String(id);
  if (open.has(id)) open.delete(id);
  else open.add(id);
  if (open.has(id) && (!sales.has(id) || sales.get(id) instanceof Error)) {
    sales.set(id, "loading");
    renderPayouts();
    try {
      sales.set(id, await fetchSales(id));
    } catch (err) {
      sales.set(id, err);
      throw err;
    } finally {
      renderPayouts();
    }
  }
  renderPayouts();
}
