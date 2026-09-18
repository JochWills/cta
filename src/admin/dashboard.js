/**
 * The admin page's "Dashboard" tab — revenue, order and category stats
 * computed entirely client-side from `adminState.orders`/`adminState.products`
 * (already loaded in full for the Orders/Notes tabs — see main.js's
 * loadOrders/loadProducts). No new endpoint, no new database query: this
 * just looks at data the page already has.
 *
 * Revenue only ever counts orders currently `status === "paid"` — a
 * refunded order was paid once but isn't anymore, so it drops out on its
 * own once its status changes, with no separate subtraction needed.
 */
import { $, esc, rands } from "../state.js";
import { adminState } from "./state.js";
import { MODULES } from "../catalogue.js";
import { STATUS_LABEL } from "./render.js";

const RANGE_LABELS = { today: "today", "7": "last 7 days", "30": "last 30 days", "90": "last 90 days", all: "all time" };
const PERIOD_NOUN = { today: "day", "7": "7 days", "30": "30 days", "90": "90 days" };

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

  if (rangeKey === "today") {
    const rangeStart = new Date(now);
    rangeStart.setHours(0, 0, 0, 0);
    const buckets = [];
    for (let h = 0; h < 24; h++) {
      buckets.push({ key: String(h), label: h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm` });
    }
    return { rangeStart, buckets, keyFor: (d) => String(d.getHours()) };
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

/** Revenue/paid-count/average/pending-created totals for orders whose date
 * (orderDate — see above) falls in [start, end). Shared by the current
 * period and, for the % change shown on each stat tile, the immediately
 * preceding period of the same length. */
function periodTotals(orders, start, end) {
  const inRange = (o) => {
    const d = orderDate(o);
    return d >= start && (!end || d < end);
  };
  const paid = orders.filter((o) => o.status === "paid" && inRange(o));
  const pendingCount = orders.filter((o) => o.status === "pending" && inRange(o)).length;
  const revenueCents = paid.reduce((sum, o) => sum + o.total_cents, 0);
  const avgCents = paid.length ? Math.round(revenueCents / paid.length) : 0;
  return { revenueCents, paidCount: paid.length, avgCents, pendingCount };
}

/**
 * Percentage change vs. the prior period of the same length. `null` when
 * there's nothing to compare against (an "all time" range has no "before
 * all time"), `{ isNew: true }` when the previous period was genuinely zero
 * (a real percentage would be undefined — "New" says what actually happened
 * without inventing a number).
 */
function pctDelta(rangeKey, curr, prev) {
  if (rangeKey === "all") return null;
  if (prev === 0) return curr === 0 ? null : { isNew: true, up: true };
  return { isNew: false, pct: Math.round(((curr - prev) / prev) * 100) };
}

function computeDashboard(rangeKey) {
  const orders = adminState.orders;
  const cfg = bucketConfig(rangeKey, orders);
  const current = periodTotals(orders, cfg.rangeStart, null);

  let deltas = { revenueCents: null, paidCount: null, avgCents: null, pendingCount: null };
  if (rangeKey !== "all") {
    const days = rangeKey === "today" ? 1 : parseInt(rangeKey, 10);
    const prevStart = new Date(cfg.rangeStart);
    prevStart.setDate(prevStart.getDate() - days);
    const prev = periodTotals(orders, prevStart, cfg.rangeStart);
    deltas = {
      revenueCents: pctDelta(rangeKey, current.revenueCents, prev.revenueCents),
      paidCount: pctDelta(rangeKey, current.paidCount, prev.paidCount),
      avgCents: pctDelta(rangeKey, current.avgCents, prev.avgCents),
      pendingCount: pctDelta(rangeKey, current.pendingCount, prev.pendingCount),
    };
  }

  const paidInRange = orders.filter((o) => o.status === "paid" && orderDate(o) >= cfg.rangeStart);

  // Per-bucket series for the revenue chart and every stat tile's sparkline.
  const revenueByBucket = new Map(cfg.buckets.map((b) => [b.key, 0]));
  const countByBucket = new Map(cfg.buckets.map((b) => [b.key, 0]));
  for (const o of paidInRange) {
    const key = cfg.keyFor(orderDate(o));
    if (!revenueByBucket.has(key)) continue;
    revenueByBucket.set(key, revenueByBucket.get(key) + o.total_cents);
    countByBucket.set(key, countByBucket.get(key) + 1);
  }
  const pendingByBucket = new Map(cfg.buckets.map((b) => [b.key, 0]));
  for (const o of orders) {
    if (o.status !== "pending") continue;
    const key = cfg.keyFor(orderDate(o));
    if (pendingByBucket.has(key)) pendingByBucket.set(key, pendingByBucket.get(key) + 1);
  }

  const series = cfg.buckets.map((b) => ({ label: b.label, cents: revenueByBucket.get(b.key) || 0 }));
  const paidCountSeries = cfg.buckets.map((b) => countByBucket.get(b.key) || 0);
  const avgSeries = cfg.buckets.map((b) => {
    const c = countByBucket.get(b.key) || 0;
    return c ? Math.round((revenueByBucket.get(b.key) || 0) / c) : 0;
  });
  const pendingSeries = cfg.buckets.map((b) => pendingByBucket.get(b.key) || 0);

  // Tallied from each order's own item snapshot (see CLAUDE.md's Data model —
  // orders.items is a jsonb copy taken at purchase time), so this still
  // reflects reality even for a note since renamed or deleted.
  const noteMap = new Map();
  const byProductId = new Map(adminState.products.map((p) => [p.id, p]));
  const categoryCents = new Map(); // module_slug (or "other") -> cents
  for (const o of paidInRange) {
    // Items carry list prices; a discounted order's real takings per item
    // are scaled down by its own discount_percent, so these totals agree
    // with the Revenue tile (which reads total_cents).
    const factor = 1 - (o.discount_percent || 0) / 100;
    for (const item of Array.isArray(o.items) ? o.items : []) {
      const cents = Math.round((item.price_cents || 0) * factor);
      const key = item.product_id || item.code || item.title;
      const cur = noteMap.get(key) || { title: item.title, count: 0, revenueCents: 0 };
      cur.count += 1;
      cur.revenueCents += cents;
      noteMap.set(key, cur);

      const product = byProductId.get(item.product_id);
      const slug = product ? product.module_slug : "other";
      categoryCents.set(slug, (categoryCents.get(slug) || 0) + cents);
    }
  }
  const topNotes = [...noteMap.values()].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 5);

  const categoryTotal = [...categoryCents.values()].reduce((a, b) => a + b, 0);
  const categories = MODULES.map((m) => ({ label: m.short, tint: m.tint, ink: m.ink, cents: categoryCents.get(m.slug) || 0 }))
    .concat(categoryCents.has("other") ? [{ label: "Other", tint: "var(--rule)", ink: "var(--ink-faint)", cents: categoryCents.get("other") }] : [])
    .filter((c) => c.cents > 0)
    .map((c) => ({ ...c, pct: categoryTotal ? Math.round((c.cents / categoryTotal) * 100) : 0 }))
    .sort((a, b) => b.cents - a.cents);

  // Recent Orders isn't scoped to the picked range — it's a "what just
  // happened" glance, not a range aggregate, so it always shows the actual
  // most recent orders regardless of which stats range is selected.
  const recentOrders = orders.slice(0, 5);

  return { ...current, deltas, series, paidCountSeries, avgSeries, pendingSeries, topNotes, categories, categoryTotal, recentOrders };
}

/* ------------------------------------------------------------------
   Small building blocks
------------------------------------------------------------------ */

/** "Josh Williams" -> "J*** W." — Recent Orders is a glance/summary widget
 * shown alongside the full, unmasked detail already one click away on the
 * Orders tab, so trimming names here is purely a lighter-weight look for
 * this particular view, not a real access restriction. */
function maskName(fullName) {
  const words = (fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "—";
  return words.map((w, i) => (i === 0 ? `${w[0]}***` : `${w[0]}.`)).join(" ");
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning!";
  if (h < 18) return "Good afternoon!";
  return "Good evening!";
}

/** A small trailing sparkline — 12ish points is typical, but this just uses
 * whatever bucket count the current range already produced. Flat when every
 * value is 0 (e.g. no pending orders), which is exactly the right picture
 * for that case rather than a special-cased message. */
function renderSparkline(values, colorVar) {
  const w = 88,
    h = 30,
    pad = 3;
  if (!values.length) return "";
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const points = values.map((v, i) => [pad + i * step, h - pad - ((v - min) / range) * (h - pad * 2)]);
  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1];
  return `
    <svg class="stat-sparkline" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="color:${colorVar}">
      <path d="${d}"></path>
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.5"></circle>
    </svg>`;
}

function deltaHtml(delta, rangeKey, goodWhenUp = true) {
  if (!delta) return `<span class="stat-sub">${esc(RANGE_LABELS[rangeKey])}</span>`;
  const up = delta.isNew || delta.pct >= 0;
  const good = up === goodWhenUp;
  const text = delta.isNew ? "New" : `${up ? "↑" : "↓"} ${Math.abs(delta.pct)}%`;
  return `
    <span class="stat-delta ${good ? "is-good" : "is-bad"}">${text}</span>
    <span class="stat-delta-sub">vs previous ${esc(PERIOD_NOUN[rangeKey])}</span>`;
}

const ICONS = {
  revenue: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="3"/><path d="M6 9h.01M18 15h.01"/>',
  bag: '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.55L20.5 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/>',
  tag: '<path d="M12.3 3H5.5a2 2 0 0 0-2 2v6.8c0 .53.21 1.04.59 1.41l8.7 8.7a2 2 0 0 0 2.82 0l6.2-6.2a2 2 0 0 0 0-2.82l-8.7-8.7A2 2 0 0 0 12.3 3z"/><circle cx="8.3" cy="8.3" r="1.3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.3v5l3.3 1.9"/>',
};

function statTile({ label, value, icon, tint, ink, sub, spark }) {
  return `
    <div class="stat-tile">
      <div class="stat-tile-top">
        <div class="stat-icon" style="background:${tint};color:${ink}"><svg viewBox="0 0 24 24">${icon}</svg></div>
        <span class="stat-label">${esc(label)}</span>
      </div>
      <div class="stat-tile-bottom">
        <div>
          <div class="stat-value">${esc(value)}</div>
          <div class="stat-sub-row">${sub}</div>
        </div>
        ${spark}
      </div>
    </div>`;
}

/* ------------------------------------------------------------------
   Revenue bar chart — plain SVG, no charting library (see CLAUDE.md's
   Stack section on keeping this codebase dependency-free). A fixed-width
   axis column (never scrolls) sits beside a horizontally-scrollable bars
   SVG at fixed pixel geometry — a bar is capped at 18px thick either way,
   so stretching it to fill a wide card would just look wrong on a big
   screen; `.dash-chart-scroll` scrolls sideways instead once a range has
   more bars than the card is wide, while the axis labels stay put.
------------------------------------------------------------------ */
const CHART_H = 140;
const BAR_W = 18,
  GAP = 10,
  SLOT = BAR_W + GAP;

/** A "clean" gridline step for an axis maxing out around `maxRands` — 1/2/5
 * times a power of ten, same idea as any chart library's default ticks. */
function niceStepRands(maxRands) {
  if (maxRands <= 0) return 10;
  const rough = maxRands / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return step * mag;
}

function renderRevenueChart(series) {
  const rawMaxRands = Math.max(1, ...series.map((s) => s.cents)) / 100;
  const step = niceStepRands(rawMaxRands);
  const tickCount = Math.max(1, Math.ceil(rawMaxRands / step));
  const niceMaxCents = tickCount * step * 100;

  const axisRows = [];
  for (let i = 0; i <= tickCount; i++) {
    const y = CHART_H - (i / tickCount) * CHART_H;
    axisRows.push(`<text x="40" y="${(y + 4).toFixed(1)}" class="axis-tick-label" text-anchor="end">R${i * step}</text>`);
  }
  const axisSvg = `<svg class="dash-axis" width="44" height="${CHART_H + 24}">${axisRows.join("")}</svg>`;

  const gridlines = [];
  for (let i = 0; i <= tickCount; i++) {
    const y = (CHART_H - (i / tickCount) * CHART_H).toFixed(1);
    gridlines.push(`<line x1="0" y1="${y}" x2="${series.length * SLOT}" y2="${y}" class="bar-gridline"></line>`);
  }

  const step6 = Math.max(1, Math.ceil(series.length / 6)); // ~6 x-axis labels, never one per bar
  const bars = series
    .map((s, i) => {
      const x = i * SLOT;
      const h = s.cents ? Math.max(2, Math.round((s.cents / niceMaxCents) * CHART_H)) : 0;
      const showLabel = i % step6 === 0 || i === series.length - 1;
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

  const width = series.length * SLOT;
  return `
    <div class="dash-chart-row">
      ${axisSvg}
      <div class="dash-chart-scroll">
        <svg class="dash-chart" viewBox="0 0 ${width} ${CHART_H + 24}" width="${width}" height="${CHART_H + 24}">
          ${gridlines.join("")}
          ${bars}
        </svg>
      </div>
    </div>
    <div class="dash-tooltip" id="dashTooltip" hidden></div>`;
}

/* ------------------------------------------------------------------
   Sales-by-module donut
------------------------------------------------------------------ */
function renderCategoryChart(categories, totalCents) {
  if (!categories.length) return `<div class="empty-state">No sales in this range yet.</div>`;

  const size = 160,
    r = 58,
    sw = 22;
  const c = 2 * Math.PI * r;
  const gapPx = 3;
  let offset = 0;
  const arcs = categories
    .map((cat) => {
      const segLen = (cat.pct / 100) * c;
      const drawn = Math.max(0, segLen - (categories.length > 1 ? gapPx : 0));
      const arc = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${cat.tint}"
        stroke-width="${sw}" stroke-dasharray="${drawn.toFixed(1)} ${(c - drawn).toFixed(1)}"
        stroke-dashoffset="${(-offset).toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"></circle>`;
      offset += segLen;
      return arc;
    })
    .join("");

  const legend = categories
    .map(
      (cat) => `
      <div class="legend-row">
        <span class="legend-dot" style="background:${cat.tint}"></span>
        <span class="legend-label">${esc(cat.label)}</span>
        <span class="legend-pct">${cat.pct}%</span>
      </div>`
    )
    .join("");

  return `
    <div class="donut-wrap">
      <svg class="donut-chart" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
        ${arcs}
      </svg>
      <div class="donut-center">
        <span class="donut-total">${esc(rands(totalCents))}</span>
        <span class="donut-total-label">Total revenue</span>
      </div>
    </div>
    <div class="donut-legend">${legend}</div>`;
}

/* ------------------------------------------------------------------
   Recent Orders / Top Selling Notes
------------------------------------------------------------------ */
function renderRecentOrders(orders) {
  if (!orders.length) return `<div class="empty-state">No orders yet.</div>`;
  // No Reference column here — it's a "what just happened" glance, and the
  // full reference (CTA-XXXXXX, longer than this compact card has room for
  // next to Date/Customer/Notes/Amount/Status) is right there on the Orders
  // tab this card's "View all" leads to.
  const rows = orders
    .map((o) => {
      const items = Array.isArray(o.items) ? o.items : [];
      const itemsLabel = items.length ? (items.length === 1 ? items[0].title : `${items[0].title} +${items.length - 1} more`) : "—";
      return `
        <tr>
          <td>${esc(new Date(o.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" }))}</td>
          <td>${esc(maskName(o.full_name))}</td>
          <td>${esc(itemsLabel)}</td>
          <td>${rands(o.total_cents)}</td>
          <td><span class="status-badge status-${esc(o.status)}">${esc(STATUS_LABEL[o.status] || o.status)}</span></td>
        </tr>`;
    })
    .join("");
  return `
    <div class="admin-table-wrap">
      <table class="admin-table admin-table-compact">
        <thead><tr><th>Date</th><th>Customer</th><th>Notes</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderTopNotesList(topNotes) {
  if (!topNotes.length) return `<div class="empty-state">No sales in this range yet.</div>`;
  const rows = topNotes
    .map(
      (n, i) => `
      <div class="rank-row">
        <span class="rank-badge">${i + 1}</span>
        <span class="rank-title">${esc(n.title)}</span>
        <span class="rank-meta">${n.count} sale${n.count === 1 ? "" : "s"}</span>
        <span class="rank-value">${rands(n.revenueCents)}</span>
      </div>`
    )
    .join("");
  return `<div class="rank-list">${rows}</div>`;
}

/* ------------------------------------------------------------------
   Main render
------------------------------------------------------------------ */
export function renderDashboard() {
  const range = adminState.dashboardRange;
  const rangeSelect = $("#dashRange");
  if (rangeSelect && rangeSelect.value !== range) rangeSelect.value = range;

  const data = computeDashboard(range);
  const g = $("#dashGreeting");
  if (g) g.textContent = greeting();

  $("#dashStats").innerHTML = [
    statTile({
      label: "Revenue",
      value: rands(data.revenueCents),
      icon: ICONS.revenue,
      tint: "var(--blush)",
      ink: "var(--accent-deep)",
      sub: deltaHtml(data.deltas.revenueCents, range, true),
      spark: renderSparkline(data.series.map((s) => s.cents), "var(--accent-deep)"),
    }),
    statTile({
      label: "Orders paid",
      value: String(data.paidCount),
      icon: ICONS.bag,
      tint: "var(--tax-tint)",
      ink: "var(--tax-ink)",
      sub: deltaHtml(data.deltas.paidCount, range, true),
      spark: renderSparkline(data.paidCountSeries, "var(--tax-ink)"),
    }),
    statTile({
      label: "Average order",
      value: rands(data.avgCents),
      icon: ICONS.tag,
      tint: "var(--cga-tint)",
      ink: "var(--cga-ink)",
      sub: deltaHtml(data.deltas.avgCents, range, true),
      spark: renderSparkline(data.avgSeries, "var(--cga-ink)"),
    }),
    statTile({
      label: "Pending orders",
      value: String(data.pendingCount),
      icon: ICONS.clock,
      tint: "var(--ma-tint)",
      ink: "var(--ma-ink)",
      sub: data.pendingCount ? deltaHtml(data.deltas.pendingCount, range, false) : `<span class="stat-sub">No pending orders</span>`,
      spark: renderSparkline(data.pendingSeries, "var(--ma-ink)"),
    }),
  ].join("");

  $("#dashRevenueFigure").innerHTML = `
    <span class="dash-figure-value">${esc(rands(data.revenueCents))}</span>
    <span class="dash-figure-sub">${deltaHtml(data.deltas.revenueCents, range, true)}</span>`;

  $("#dashChartInner").innerHTML = data.series.some((s) => s.cents)
    ? renderRevenueChart(data.series)
    : `<div class="empty-state">No paid orders in this range yet.</div>`;
  // Scrolled to the right by default so the most recent bars — the ones
  // someone opening this actually wants to see first — aren't hidden off
  // the edge of a range with more bars than the card is wide.
  const scroller = document.querySelector("#dashChartInner .dash-chart-scroll");
  if (scroller) scroller.scrollLeft = scroller.scrollWidth;

  $("#dashCategoryChart").innerHTML = renderCategoryChart(data.categories, data.categoryTotal);
  $("#dashRecentOrders").innerHTML = renderRecentOrders(data.recentOrders);
  $("#dashTopNotes").innerHTML = renderTopNotesList(data.topNotes);
}

/* ------------------------------------------------------------------
   Chart tooltip — delegated from #dashChartInner itself (a stable element
   that's only ever re-filled, never replaced, so one set of listeners here
   keeps working across every re-render triggered by renderDashboard()).
------------------------------------------------------------------ */
function showTooltip(bar) {
  const tip = $("#dashTooltip");
  // #dashChartInner (.dash-chart-host) is the tooltip's actual position:
  // relative ancestor — NOT .dash-chart-scroll, which only wraps the bars
  // and starts partway in, after the fixed axis column. Positioning
  // against the scroll container's own edge (and separately re-adding its
  // scrollLeft, on top of getBoundingClientRect() already reflecting the
  // current scroll) both threw this off — compounding, so the further a
  // chart was scrolled, the further right the tooltip drifted, eventually
  // landing on the card next to it. getBoundingClientRect() already gives
  // each element's true on-screen position; no scroll math needed at all.
  const container = $("#dashChartInner");
  if (!tip || !container || !bar) return;
  tip.innerHTML = `<strong>${esc(bar.dataset.value)}</strong><span>${esc(bar.dataset.label)}</span>`;
  tip.hidden = false;
  const containerBox = container.getBoundingClientRect();
  const barBox = bar.getBoundingClientRect(); // the full-height hit rect, for horizontal centring
  // .bar-fill, when a bar was tall enough to draw one, is always the element
  // right before its .bar-hit sibling (see renderRevenueChart) — point the
  // tooltip at its actual top rather than the hit rect's (which spans the
  // whole chart height regardless of value, so every bar would otherwise
  // anchor the tooltip at the same y). A zero-value bar has no fill to
  // measure, so fall back to the baseline instead of the chart's very top.
  const fill = bar.previousElementSibling;
  const top = fill?.classList.contains("bar-fill") ? fill.getBoundingClientRect().top : barBox.bottom;
  // The tooltip is centred on `left` (translate(-50%, ...) in CSS) — clamp
  // that centre so its own width never pushes it past the card's edge,
  // which the very first/last bar would otherwise do by design (a bar
  // flush against the edge centres a wider tooltip half outside it).
  const rawLeft = barBox.left - containerBox.left + barBox.width / 2;
  const tipHalfWidth = tip.getBoundingClientRect().width / 2;
  const clampedLeft = Math.min(Math.max(rawLeft, tipHalfWidth), containerBox.width - tipHalfWidth);
  tip.style.left = `${clampedLeft}px`;
  tip.style.top = `${top - containerBox.top}px`;
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
