/**
 * The admin page's "Dashboard" tab — revenue and order stats computed
 * entirely client-side from `adminState.orders` (already loaded in full for
 * the Orders tab — see main.js's loadOrders). No new endpoint, no new
 * database query: this just looks at data the page already has.
 *
 * Revenue only ever counts orders currently `status === "paid"` — a
 * refunded order was paid once but isn't anymore, so it drops out on its
 * own once its status changes, with no separate subtraction needed.
 */
import { $, esc, rands } from "../state.js";
import { adminState } from "./state.js";

const RANGE_LABELS = { "7": "last 7 days", "30": "last 30 days", "90": "last 90 days", all: "all time" };

/** An order's date for both bucketing and range filtering — when it was
 * actually paid, falling back to when it was placed for orders that never
 * got that far (a pending order has no paid_at yet). */
function orderDate(o) {
  return new Date(o.paid_at || o.created_at);
}

/**
 * Builds the set of buckets a range is broken into, plus a function mapping
 * an order's date to the bucket key it falls in. Daily buckets up to 30
 * days, weekly beyond that (90 days), monthly for "all time" — so the bar
 * chart never has to render one bar per day over a year of history.
 */
function bucketConfig(rangeKey, orders) {
  const now = new Date();

  if (rangeKey === "all") {
    const dates = orders.map(orderDate).filter((d) => !Number.isNaN(d.getTime()));
    let start = dates.length ? new Date(Math.min(...dates)) : now;
    start = new Date(start.getFullYear(), start.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);

    const buckets = [];
    const cur = new Date(start);
    while (cur <= end) {
      buckets.push({
        key: `${cur.getFullYear()}-${cur.getMonth()}`,
        label: cur.toLocaleDateString("en-ZA", { month: "short", year: cur.getFullYear() === now.getFullYear() ? undefined : "2-digit" }),
      });
      cur.setMonth(cur.getMonth() + 1);
    }
    return { rangeStart: start, buckets, keyFor: (d) => `${d.getFullYear()}-${d.getMonth()}` };
  }

  const days = parseInt(rangeKey, 10);
  const rangeStart = new Date(now);
  rangeStart.setHours(0, 0, 0, 0);
  rangeStart.setDate(rangeStart.getDate() - (days - 1));

  if (days <= 30) {
    const buckets = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(rangeStart);
      d.setDate(d.getDate() + i);
      buckets.push({ key: d.toDateString(), label: d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) });
    }
    return { rangeStart, buckets, keyFor: (d) => d.toDateString() };
  }

  const weeks = Math.ceil(days / 7);
  const buckets = [];
  for (let i = 0; i < weeks; i++) {
    const d = new Date(rangeStart);
    d.setDate(d.getDate() + i * 7);
    buckets.push({ key: `w${i}`, label: d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) });
  }
  return {
    rangeStart,
    buckets,
    keyFor: (d) => buckets[Math.min(Math.max(Math.floor((d - rangeStart) / (7 * 86400000)), 0), buckets.length - 1)].key,
  };
}

function computeDashboard(rangeKey) {
  const orders = adminState.orders;
  const cfg = bucketConfig(rangeKey, orders);
  const inRange = (o) => orderDate(o) >= cfg.rangeStart;

  const paid = orders.filter((o) => o.status === "paid" && inRange(o));
  const pending = orders.filter((o) => o.status === "pending" && inRange(o));

  const revenueCents = paid.reduce((sum, o) => sum + o.total_cents, 0);
  const avgCents = paid.length ? Math.round(revenueCents / paid.length) : 0;

  const bucketMap = new Map(cfg.buckets.map((b) => [b.key, 0]));
  for (const o of paid) {
    const key = cfg.keyFor(orderDate(o));
    if (bucketMap.has(key)) bucketMap.set(key, bucketMap.get(key) + o.total_cents);
  }
  const series = cfg.buckets.map((b) => ({ label: b.label, cents: bucketMap.get(b.key) || 0 }));

  // Tallied from each order's own item snapshot (see CLAUDE.md's Data model —
  // orders.items is a jsonb copy taken at purchase time), so this still
  // reflects reality even for a note since renamed or deleted.
  const noteMap = new Map();
  for (const o of paid) {
    for (const item of Array.isArray(o.items) ? o.items : []) {
      const key = item.product_id || item.code || item.title;
      const cur = noteMap.get(key) || { title: item.title, count: 0, revenueCents: 0 };
      cur.count += 1;
      cur.revenueCents += item.price_cents || 0;
      noteMap.set(key, cur);
    }
  }
  const topNotes = [...noteMap.values()].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 5);

  return { revenueCents, paidCount: paid.length, avgCents, pendingCount: pending.length, series, topNotes };
}

function statTile(label, value, sub = "") {
  return `
    <div class="stat-tile">
      <span class="stat-label">${esc(label)}</span>
      <span class="stat-value">${esc(value)}</span>
      ${sub}
    </div>`;
}

/**
 * A plain SVG bar chart — no charting library (see CLAUDE.md's Stack
 * section on keeping this codebase dependency-free). Fixed pixel geometry
 * rather than a responsive viewBox: a bar is capped at 18px thick either
 * way, so letting it stretch to fill a wide card would just make it look
 * wrong on a big screen; a `.dash-chart-scroll` wrapper scrolls sideways
 * instead on any range with enough bars to need it (30 daily bars, say).
 */
function renderBarChart(series) {
  const BAR_W = 18,
    GAP = 10,
    SLOT = BAR_W + GAP,
    CHART_H = 140;
  const max = Math.max(1, ...series.map((s) => s.cents));
  const width = series.length * SLOT;
  const step = Math.max(1, Math.ceil(series.length / 6)); // ~6 axis labels, never one per bar

  const bars = series
    .map((s, i) => {
      const x = i * SLOT;
      const h = s.cents ? Math.max(2, Math.round((s.cents / max) * CHART_H)) : 0;
      const showLabel = i % step === 0 || i === series.length - 1;
      // The fill rect runs 4px past the baseline so its rx=4 rounding shows
      // only at the top — the overflow:hidden on .dash-chart clips the rest
      // off flush with the baseline, squaring the bottom as the spec wants.
      const fill = h
        ? `<rect x="${x + GAP / 2}" y="${CHART_H - h - 4}" width="${BAR_W}" height="${h + 4}" rx="4" ry="4" class="bar-fill"></rect>`
        : "";
      return `
        <g>
          ${fill}
          <rect x="${x}" y="0" width="${SLOT}" height="${CHART_H}" class="bar-hit" tabindex="0"
                data-label="${esc(s.label)}" data-value="${esc(rands(s.cents))}"></rect>
          ${showLabel ? `<text x="${x + SLOT / 2}" y="${CHART_H + 16}" class="bar-axis-label" text-anchor="middle">${esc(s.label)}</text>` : ""}
        </g>`;
    })
    .join("");

  return `
    <div class="dash-chart-scroll">
      <svg class="dash-chart" viewBox="0 0 ${width} ${CHART_H + 24}" width="${width}" height="${CHART_H + 24}">
        <line x1="0" y1="${CHART_H}" x2="${width}" y2="${CHART_H}" class="bar-baseline"></line>
        ${bars}
      </svg>
    </div>
    <div class="dash-tooltip" id="dashTooltip" hidden></div>`;
}

export function renderDashboard() {
  const range = adminState.dashboardRange;
  document.querySelectorAll("#dashRange [data-range]").forEach((b) => b.classList.toggle("is-on", b.dataset.range === range));

  const { revenueCents, paidCount, avgCents, pendingCount, series, topNotes } = computeDashboard(range);
  const rangeLabel = RANGE_LABELS[range];

  $("#dashStats").innerHTML = [
    statTile("Revenue", rands(revenueCents), `<span class="stat-sub">${esc(rangeLabel)}</span>`),
    statTile("Orders paid", String(paidCount), `<span class="stat-sub">${esc(rangeLabel)}</span>`),
    statTile("Average order", rands(avgCents)),
    statTile("Pending orders", String(pendingCount), pendingCount ? `<span class="stat-sub stat-warn">Needs a look</span>` : `<span class="stat-sub">${esc(rangeLabel)}</span>`),
  ].join("");

  $("#dashChartInner").innerHTML = series.some((s) => s.cents)
    ? renderBarChart(series)
    : `<div class="empty-state">No paid orders in this range yet.</div>`;
  // Scrolled to the right by default so the most recent bars — the ones
  // someone opening this actually wants to see first — aren't hidden off
  // the edge of a range with more bars than the card is wide.
  const scroller = document.querySelector("#dashChartInner .dash-chart-scroll");
  if (scroller) scroller.scrollLeft = scroller.scrollWidth;

  $("#dashTopNotes").innerHTML = topNotes.length
    ? `<div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Note</th><th>Sold</th><th>Revenue</th></tr></thead>
          <tbody>${topNotes.map((n) => `<tr><td>${esc(n.title)}</td><td>${n.count}</td><td>${rands(n.revenueCents)}</td></tr>`).join("")}</tbody>
        </table>
      </div>`
    : `<div class="empty-state">No sales in this range yet.</div>`;
}

/* ------------------------------------------------------------------
   Chart tooltip — delegated from #dashChartInner itself (a stable element
   that's only ever re-filled, never replaced, so one set of listeners here
   keeps working across every re-render triggered by renderDashboard()).
------------------------------------------------------------------ */
function showTooltip(bar) {
  const tip = $("#dashTooltip");
  const host = $("#dashChartInner");
  if (!tip || !host || !bar) return;
  tip.innerHTML = `<strong>${esc(bar.dataset.value)}</strong><span>${esc(bar.dataset.label)}</span>`;
  tip.hidden = false;
  const hostBox = host.getBoundingClientRect();
  const barBox = bar.getBoundingClientRect(); // the full-height hit rect, for horizontal centring
  // .bar-fill, when a bar was tall enough to draw one, is always the element
  // right before its .bar-hit sibling (see renderBarChart) — point the
  // tooltip at its actual top rather than the hit rect's (which spans the
  // whole chart height regardless of value, so every bar would otherwise
  // anchor the tooltip at the same y). A zero-value bar has no fill to
  // measure, so fall back to the baseline instead of the chart's very top.
  const fill = bar.previousElementSibling;
  const top = fill?.classList.contains("bar-fill") ? fill.getBoundingClientRect().top : barBox.bottom;
  tip.style.left = `${barBox.left - hostBox.left + host.scrollLeft + barBox.width / 2}px`;
  tip.style.top = `${top - hostBox.top}px`;
}

function hideTooltip() {
  const tip = $("#dashTooltip");
  if (tip) tip.hidden = true;
}

const chartHost = document.getElementById("dashChartInner");
if (chartHost) {
  chartHost.addEventListener("pointerover", (e) => showTooltip(e.target.closest(".bar-hit")));
  chartHost.addEventListener("pointermove", (e) => showTooltip(e.target.closest(".bar-hit")));
  chartHost.addEventListener("pointerout", (e) => e.target.closest(".bar-hit") && hideTooltip());
  chartHost.addEventListener("focusin", (e) => showTooltip(e.target.closest(".bar-hit")));
  chartHost.addEventListener("focusout", hideTooltip);
}
