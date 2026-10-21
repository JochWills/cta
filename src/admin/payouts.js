import { $, esc, rands } from "../state.js";
import { adminState } from "./state.js";

/**
 * The Payouts tab — Paystack's settlements (what it actually paid into the
 * bank), read live from Paystack by admin-payouts. A row opens to show the
 * sales that payout covered, fetched when first opened. The "Not paid out
 * yet" row at the top is every paid order from the last 14 days that isn't
 * in a payout yet, with the fee Paystack already charged on each (both
 * worked out by admin-payouts), so it shows what will actually land.
 */

const STATUS = {
  success: ["ok", "Paid out"],
  processing: ["warn", "Processing"],
  pending: ["warn", "Pending"],
  failed: ["bad", "Failed"],
};

let data = null;
const open = new Set(["waiting"]); // sales not paid out yet start open
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

  // Recent paid orders that aren't in any payout yet, and what they'll pay out after fees.
  const waiting = data.waiting || [];
  const inFlight = list.filter((s) => s.status !== "success" && s.status !== "failed");
  const waitingGross = waiting.reduce((t, o) => t + o.total_cents, 0);
  const waitingFees = waiting.reduce((t, o) => t + (o.fees_cents || 0), 0);
  const waitingCents = waitingGross - waitingFees;
  const last = done[0];

  const tile = (label, value, sub) => `
    <div class="customer-tile"><span class="stat-label">${label}</span><strong>${value}</strong>${sub ? `<span class="stat-sub">${sub}</span>` : ""}</div>`;
  $("#payoutSummary").innerHTML =
    // Both after Paystack's fees: sales not in a payout yet, plus payouts still processing.
    tile("Waiting to be paid out", rands(waitingCents + sum(inFlight, "paid_out_cents")),
      [waiting.length ? `${rands(waitingCents)} not paid out yet` : "",
        inFlight.length ? `${rands(sum(inFlight, "paid_out_cents"))} processing` : ""].filter(Boolean).join(" · ") || "Nothing waiting") +
    tile("Last payout", last ? rands(last.paid_out_cents) : "—", last ? day(last.date) : "None yet") +
    tile("Paid out this month", rands(sum(thisMonth, "paid_out_cents")), `${thisMonth.length} payout${thisMonth.length === 1 ? "" : "s"}`) +
    tile("Paid out all time", rands(sum(done, "paid_out_cents")), `${rands(sum(done, "fees_cents"))} in Paystack fees`);

  const box = $("#payoutsTable");
  if (!list.length && !waiting.length) {
    box.innerHTML = `<div class="empty-state">No payouts yet. Paystack pays sales into your bank a day or two after they're made.</div>`;
    return;
  }
  box.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table customer-table payout-table">
        <thead><tr><th>Payout date</th><th>Status</th><th>Sales</th><th>Paystack fees</th><th>Paid to you</th></tr></thead>
        <tbody>${waiting.length ? waitingRow(waiting, waitingGross, waitingFees) : ""}${list.map(row).join("")}</tbody>
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

function waitingRow(orders, gross, fees) {
  const isOpen = open.has("waiting");
  const newest = orders.slice().sort((a, b) => String(b.paid_at || b.created_at).localeCompare(String(a.paid_at || a.created_at)));
  return `
    <tr class="customer-row${isOpen ? " is-open" : ""}" data-payout-toggle="waiting">
      <td>
        <div class="customer-name">
          <svg class="customer-caret" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5l5 5 5-5"/></svg>
          <span>Not paid out yet</span>
        </div>
      </td>
      <td><span class="health-pill is-warn">Waiting</span></td>
      <td>${rands(gross)}</td>
      <td class="meta">${fees ? `−${rands(fees)}` : "—"}</td>
      <td><strong>${rands(gross - fees)}</strong><div class="meta">${orders.length} sale${orders.length === 1 ? "" : "s"}</div></td>
    </tr>
    <tr class="customer-detail" ${isOpen ? "" : "hidden"}>
      <td colspan="5">${isOpen ? `
        <div class="customer-history">
          <p class="customer-history-head">Paystack usually pays these out within one or two working days</p>
          ${newest.map((o) => saleCard({
            name: o.full_name || o.email,
            reference: o.reference,
            at: o.paid_at || o.created_at,
            items: Array.isArray(o.items) ? o.items.map((i) => i.title).join(", ") : "",
            amount: o.total_cents,
            fees: o.fees_cents,
          })).join("")}
        </div>` : ""}</td>
    </tr>`;
}

function saleCard({ name, reference, at, items, amount, fees }) {
  return `
        <div class="history-order payout-sale">
          <div class="history-meta">
            <strong>${esc(name || "—")}</strong>
            <span class="meta">${esc(reference)} · ${esc(time(at))}</span>
            ${items ? `<span class="meta">${esc(items)}</span>` : ""}
          </div>
          <div class="payout-sale-amounts">
            <strong>${rands(amount)}</strong>
            ${fees ? `<span class="meta">−${rands(fees)} fee</span><span class="payout-net">${rands(amount - fees)} to you</span>` : ""}
          </div>
        </div>`;
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
        return saleCard({
          name: o?.full_name || t.email,
          reference: t.reference,
          at: t.paid_at,
          items: Array.isArray(o?.items) ? o.items.map((i) => i.title).join(", ") : "",
          amount: t.amount_cents,
          fees: t.fees_cents,
        });
      }).join("")}
    </div>`;
}

/** Opens or closes a payout; the first open fetches its sales. */
export async function togglePayout(id, fetchSales) {
  id = String(id);
  if (open.has(id)) open.delete(id);
  else open.add(id);
  if (id !== "waiting" && open.has(id) && (!sales.has(id) || sales.get(id) instanceof Error)) {
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
