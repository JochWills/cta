/**
 * daily-report — a morning email to Courts summing up yesterday (SAST) plus
 * the running totals, in the spirit of the admin page's Dashboard tab.
 *
 * Called at 06:00 UTC (08:00 SAST) every day by pg_cron (schema.sql section
 * 18), never by a browser. Deployed with verify_jwt off; instead the caller
 * must send an X-Report-Secret header matching the `daily_report_secret`
 * Vault secret. The recipients (comma-separated) are the
 * `daily_report_to` Vault secret, so the address isn't in the repo. Both
 * are read through daily_report_config(), service_role only.
 *
 * Also needs RESEND_API_KEY (and optionally EMAIL_FROM), as elsewhere.
 * Add ?dry=1 to get the email's HTML back instead of sending it.
 *
 * Numbers follow dashboard.js: revenue is total_cents of `paid` orders
 * (before Paystack fees), dated by paid_at; freebies (`free`) count only as
 * downloads; visitors are daily_visits rows (one per browser session per day).
 *
 * Deploy:  supabase functions deploy daily-report --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "PGDA Notes by Courts <notes@pgdanotes.co.za>";
const SITE = (Deno.env.get("SITE_URL") || "https://pgdanotes.co.za").replace(/\/$/, "");

const SAST_MS = 2 * 60 * 60 * 1000; // UTC+2, no daylight saving
const DAY_MS = 24 * 60 * 60 * 1000;

// Short labels + colours, mirroring MODULES in src/catalogue.js and the
// --*-ink tokens in styles.css. Change them together.
const MODULES: Record<string, { label: string; ink: string }> = {
  "financial-reporting": { label: "Financial Reporting", ink: "#B4655E" },
  "management-accounting-finance": { label: "MA & Finance", ink: "#B77C42" },
  taxation: { label: "Taxation", ink: "#6A8F62" },
  "corporate-governance-auditing": { label: "CG & Auditing", ink: "#7169AE" },
  "bridging-financial-reporting": { label: "Bridging · Financial Reporting", ink: "#9E5F80" },
  "bridging-management-accounting-finance": { label: "Bridging · MA & Finance", ink: "#97803E" },
  "bridging-taxation": { label: "Bridging · Taxation", ink: "#4E8A7D" },
  "bridging-corporate-governance-auditing": { label: "Bridging · CG & Auditing", ink: "#8A6C57" },
};

const C = {
  bg: "#FCFAF8",
  card: "#FFFFFF",
  rule: "#EDE4DF",
  ink: "#2B2523",
  soft: "#6E6360",
  faint: "#9A8F8B",
  accent: "#B4756D",
  accentDeep: "#9C5F58",
  blush: "#F7DFDB",
  up: "#6A8F62",
  down: "#B4655E",
};
const SANS = "Inter,Segoe UI,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

const escHtml = (v: string) =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const rands = (cents: number) =>
  "R" + (cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Midnight SAST at the start of the SAST day containing `ms`, as a UTC ms timestamp. */
function sastMidnight(ms: number) {
  return Math.floor((ms + SAST_MS) / DAY_MS) * DAY_MS - SAST_MS;
}
/** "2026-11-15" for the SAST day starting at `startMs`. */
function sastDate(startMs: number) {
  return new Date(startMs + SAST_MS).toISOString().slice(0, 10);
}
function sastLabel(startMs: number, opts: Intl.DateTimeFormatOptions) {
  return new Date(startMs + SAST_MS).toLocaleDateString("en-ZA", { ...opts, timeZone: "UTC" });
}

type Item = { product_id?: string; code?: string; title?: string; price_cents?: number };
type Order = {
  status: string;
  total_cents: number;
  full_name: string | null;
  email: string | null;
  items: Item[] | null;
  discount_percent: number | null;
  paid_at: string | null;
  created_at: string;
};

function orderMs(o: Order) {
  return Date.parse(o.paid_at || o.created_at);
}

function totals(paid: Order[]) {
  const revenue = paid.reduce((s, o) => s + o.total_cents, 0);
  const notes = paid.reduce((s, o) => s + (Array.isArray(o.items) ? o.items.length : 0), 0);
  const customers = new Set(paid.map((o) => String(o.email || "").trim().toLowerCase()).filter(Boolean)).size;
  return { revenue, orders: paid.length, notes, customers, avg: paid.length ? Math.round(revenue / paid.length) : 0 };
}

/** Per-note and per-module takings, discounts applied — same as dashboard.js. */
function breakdown(paid: Order[], moduleOf: Map<string, string>) {
  const notes = new Map<string, { title: string; count: number; cents: number }>();
  const modules = new Map<string, number>();
  for (const o of paid) {
    const factor = 1 - (o.discount_percent || 0) / 100;
    for (const it of Array.isArray(o.items) ? o.items : []) {
      const cents = Math.round((it.price_cents || 0) * factor);
      const key = it.product_id || it.code || it.title || "?";
      const cur = notes.get(key) || { title: it.title || "Untitled", count: 0, cents: 0 };
      cur.count += 1;
      cur.cents += cents;
      notes.set(key, cur);
      const slug = moduleOf.get(it.product_id || "") || "other";
      modules.set(slug, (modules.get(slug) || 0) + cents);
    }
  }
  return {
    notes: [...notes.values()].sort((a, b) => b.cents - a.cents || b.count - a.count),
    modules: [...modules.entries()]
      .map(([slug, cents]) => ({ label: MODULES[slug]?.label || "Other", ink: MODULES[slug]?.ink || C.faint, cents }))
      .sort((a, b) => b.cents - a.cents),
  };
}

/** "▲ 25% vs the day before" style chip, or "" when there's nothing to compare. */
function delta(curr: number, prev: number) {
  if (prev === 0 && curr === 0) return `<span style="color:${C.faint};">Same as the day before</span>`;
  if (prev === 0) return `<span style="color:${C.up};">&#9650; New vs the day before</span>`;
  const pct = Math.round(((curr - prev) / prev) * 100);
  if (pct === 0) return `<span style="color:${C.faint};">Same as the day before</span>`;
  const up = pct > 0;
  return `<span style="color:${up ? C.up : C.down};">${up ? "&#9650;" : "&#9660;"} ${Math.abs(pct)}% vs the day before</span>`;
}

function statTile(label: string, value: string, sub: string) {
  return `<td width="50%" valign="top" style="padding:6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};border:1px solid ${C.rule};border-radius:10px;">
      <tr><td style="padding:14px 16px;">
        <p style="margin:0;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${C.faint};">${label}</p>
        <p style="margin:6px 0 4px;font-family:${SERIF};font-size:26px;line-height:1.1;color:${C.ink};">${value}</p>
        <p style="margin:0;font-size:12px;line-height:1.4;">${sub}</p>
      </td></tr>
    </table>
  </td>`;
}

function sectionTitle(title: string, sub = "") {
  return `<tr><td style="padding:26px 32px 10px;">
    <h2 style="margin:0;font-family:${SERIF};font-weight:400;font-size:20px;color:${C.ink};">${title}</h2>
    ${sub ? `<p style="margin:4px 0 0;font-size:12.5px;color:${C.faint};">${sub}</p>` : ""}
  </td></tr>`;
}

/** Horizontal bar rows: label, bar scaled to the largest value, figure. */
function barRows(rows: { label: string; value: number; display: string; color: string }[]) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return rows
    .map((r) => {
      const pct = Math.max(Math.round((r.value / max) * 100), 2);
      return `<tr>
        <td style="padding:6px 0;font-size:13px;color:${C.ink};" width="38%">${escHtml(r.label)}</td>
        <td style="padding:6px 10px;" width="44%">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="${pct}%" style="background:${r.color};height:10px;border-radius:5px;font-size:0;line-height:0;">&nbsp;</td>
            <td style="font-size:0;line-height:0;">&nbsp;</td>
          </tr></table>
        </td>
        <td align="right" style="padding:6px 0;font-size:13px;color:${C.soft};white-space:nowrap;" width="18%">${r.display}</td>
      </tr>`;
    })
    .join("");
}

/** 14-day revenue column chart as a table — works in every mail client, no images. */
function revenueChart(days: { label: string; cents: number; isYesterday: boolean }[]) {
  const max = Math.max(...days.map((d) => d.cents), 1);
  const H = 90;
  const cols = days
    .map((d) => {
      const h = d.cents ? Math.max(Math.round((d.cents / max) * H), 4) : 2;
      const color = d.isYesterday ? C.accent : d.cents ? "#E3C2BD" : C.rule;
      return `<td valign="bottom" align="center" style="padding:0 2px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td title="${escHtml(d.label)}: ${rands(d.cents)}" style="height:${h}px;background:${color};border-radius:3px 3px 0 0;font-size:0;line-height:0;">&nbsp;</td>
        </tr></table>
      </td>`;
    })
    .join("");
  const labels = days
    .map(
      (d, i) =>
        `<td align="center" style="padding:6px 0 0;font-size:10px;color:${d.isYesterday ? C.accentDeep : C.faint};">${
          (days.length - 1 - i) % 2 === 0 ? escHtml(d.label) : "&nbsp;"
        }</td>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;">
    <tr style="height:${H}px;">${cols}</tr>
    <tr>${labels}</tr>
  </table>`;
}

// deno-lint-ignore no-explicit-any
async function buildReport(supabase: any) {
  const now = Date.now();
  const todayStart = sastMidnight(now);
  const yStart = todayStart - DAY_MS;
  const prevStart = yStart - DAY_MS;
  const yDate = sastDate(yStart);
  const prevDate = sastDate(prevStart);

  const [ordersRes, productsRes, visitsRes] = await Promise.all([
    supabase.from("orders").select("status,total_cents,full_name,email,items,discount_percent,paid_at,created_at"),
    supabase.from("products").select("id,module_slug,is_active"),
    supabase.from("daily_visits").select("day,source").in("day", [yDate, prevDate]),
  ]);
  if (ordersRes.error) throw ordersRes.error;
  if (productsRes.error) throw productsRes.error;
  if (visitsRes.error) throw visitsRes.error;

  const orders = (ordersRes.data || []) as Order[];
  const moduleOf = new Map((productsRes.data || []).map((p) => [p.id as string, p.module_slug as string]));
  const activeNotes = (productsRes.data || []).filter((p) => p.is_active && !String(p.module_slug).endsWith("freebies")).length;

  const paid = orders.filter((o) => o.status === "paid");
  const inDay = (o: Order, start: number) => {
    const t = orderMs(o);
    return t >= start && t < start + DAY_MS;
  };
  const yPaid = paid.filter((o) => inDay(o, yStart)).sort((a, b) => orderMs(a) - orderMs(b));
  const prevPaid = paid.filter((o) => inDay(o, prevStart));
  const y = totals(yPaid);
  const prev = totals(prevPaid);
  const all = totals(paid);
  const freebiesY = orders.filter((o) => o.status === "free" && inDay(o, yStart)).length;

  const visits = visitsRes.data || [];
  const yVisits = visits.filter((v) => v.day === yDate);
  const visitorsY = yVisits.length;
  const visitorsPrev = visits.filter((v) => v.day === prevDate).length;
  const sources = new Map<string, number>();
  for (const v of yVisits) if (v.source) sources.set(v.source, (sources.get(v.source) || 0) + 1);
  const topSources = [...sources.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const monthStartMs = (() => {
    const d = new Date(yStart + SAST_MS);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - SAST_MS;
  })();
  const month = totals(paid.filter((o) => orderMs(o) >= monthStartMs && orderMs(o) < todayStart));
  const last30 = totals(paid.filter((o) => orderMs(o) >= todayStart - 30 * DAY_MS && orderMs(o) < todayStart));

  const yBreak = breakdown(yPaid, moduleOf);
  const allBreak = breakdown(paid, moduleOf);

  const chartDays = Array.from({ length: 14 }, (_, i) => {
    const start = todayStart - (14 - i) * DAY_MS;
    return {
      label: sastLabel(start, { day: "numeric", month: "short" }),
      cents: paid.filter((o) => inDay(o, start)).reduce((s, o) => s + o.total_cents, 0),
      isYesterday: start === yStart,
    };
  });
  const chart14 = chartDays.reduce((s, d) => s + d.cents, 0);

  const dayLong = sastLabel(yStart, { weekday: "long", day: "numeric", month: "long" });
  const dayShort = sastLabel(yStart, { weekday: "short", day: "numeric", month: "short" });
  const monthName = sastLabel(yStart, { month: "long" });
  const conversion = visitorsY ? `${Math.round((y.orders / visitorsY) * 1000) / 10}% of visitors bought` : "";

  const subject = y.orders
    ? `${dayShort}: ${rands(y.revenue)} from ${plural(y.orders, "order")}`
    : `${dayShort}: no sales, ${plural(visitorsY, "visitor")}`;

  const headline = y.orders
    ? `You made <strong style="color:${C.accentDeep};font-weight:600;">${rands(y.revenue)}</strong> from ${plural(y.orders, "order")} yesterday.`
    : visitorsY
      ? `No sales yesterday, but ${plural(visitorsY, "person")} had a look.`
      : `A quiet day yesterday: no sales or visitors.`;

  const ordersList = yPaid.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.rule};">${yPaid
        .slice(0, 10)
        .map((o) => {
          const time = new Date(orderMs(o) + SAST_MS).toISOString().slice(11, 16);
          const n = Array.isArray(o.items) ? o.items.length : 0;
          return `<tr>
            <td style="padding:10px 0;border-bottom:1px solid ${C.rule};font-size:12px;color:${C.faint};white-space:nowrap;" width="48">${time}</td>
            <td style="padding:10px 8px;border-bottom:1px solid ${C.rule};font-size:13.5px;color:${C.ink};">${escHtml(o.full_name || o.email || "Someone")}<br><span style="font-size:12px;color:${C.faint};">${plural(n, "note")}${o.discount_percent ? ` · ${o.discount_percent}% off` : ""}</span></td>
            <td align="right" style="padding:10px 0;border-bottom:1px solid ${C.rule};font-size:13.5px;color:${C.ink};white-space:nowrap;">${rands(o.total_cents)}</td>
          </tr>`;
        })
        .join("")}</table>${
        yPaid.length > 10 ? `<p style="margin:8px 0 0;font-size:12px;color:${C.faint};">And ${yPaid.length - 10} more on the admin page.</p>` : ""
      }`
    : "";

  const html = `<!doctype html>
<html><head><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;background:${C.bg};font-family:${SANS};color:${C.ink};">
  <div style="display:none;max-height:0;overflow:hidden;">${escHtml(subject)}. ${plural(visitorsY, "visitor")}, ${plural(y.notes, "note")} sold.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.card};border:1px solid ${C.rule};border-radius:14px;">
        <tr><td style="padding:28px 32px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td><p style="margin:0;font-family:${SERIF};font-size:24px;color:${C.accentDeep};letter-spacing:.02em;">PGDA <span style="font-family:${SANS};font-size:10.5px;letter-spacing:.3em;color:${C.ink};">NOTES</span></p></td>
            <td align="right" style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${C.faint};">Daily summary</td>
          </tr></table>
        </td></tr>

        <tr><td style="padding:22px 32px 6px;">
          <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${C.faint};">${escHtml(dayLong)}</p>
          <h1 style="margin:0;font-family:${SERIF};font-weight:400;font-size:24px;line-height:1.35;color:${C.ink};">${headline}</h1>
        </td></tr>

        <tr><td style="padding:12px 26px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              ${statTile("Revenue", rands(y.revenue), delta(y.revenue, prev.revenue))}
              ${statTile("Orders", String(y.orders), delta(y.orders, prev.orders))}
            </tr>
            <tr>
              ${statTile("Visitors", String(visitorsY), visitorsY || visitorsPrev ? delta(visitorsY, visitorsPrev) : `<span style="color:${C.faint};">&nbsp;</span>`)}
              ${statTile("Notes sold", String(y.notes), `<span style="color:${C.faint};">${y.orders ? `${rands(y.avg)} average order` : "&nbsp;"}</span>`)}
            </tr>
          </table>
          ${
            conversion || freebiesY
              ? `<p style="margin:8px 6px 0;font-size:12.5px;color:${C.soft};">${[conversion, freebiesY ? `${plural(freebiesY, "freebie")} downloaded` : ""].filter(Boolean).join(" · ")}</p>`
              : ""
          }
        </td></tr>

        ${
          yPaid.length
            ? `${sectionTitle("Yesterday's orders")}
        <tr><td style="padding:0 32px;">${ordersList}</td></tr>`
            : ""
        }

        ${
          yBreak.modules.length
            ? `${sectionTitle("Sales by module", "Yesterday, after discounts")}
        <tr><td style="padding:0 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${barRows(
          yBreak.modules.map((m) => ({ label: m.label, value: m.cents, display: rands(m.cents), color: m.ink }))
        )}</table></td></tr>`
            : ""
        }

        ${
          topSources.length
            ? `${sectionTitle("Where visitors came from", "Yesterday")}
        <tr><td style="padding:0 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${barRows(
          topSources.map(([label, n]) => ({ label, value: n, display: String(n), color: "#C9A9A3" }))
        )}</table></td></tr>`
            : ""
        }

        ${sectionTitle("Revenue, last 14 days", `${rands(chart14)} in total · yesterday highlighted`)}
        <tr><td style="padding:4px 32px 0;">${revenueChart(chartDays)}</td></tr>

        ${sectionTitle("Totals")}
        <tr><td style="padding:0 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.rule};">
            ${[
              [`${escHtml(monthName)} so far`, `${rands(month.revenue)} · ${plural(month.orders, "order")}`],
              ["Last 30 days", `${rands(last30.revenue)} · ${plural(last30.orders, "order")}`],
              ["All time revenue", rands(all.revenue)],
              ["All time orders", `${all.orders} · ${plural(all.notes, "note")} sold`],
              ["Customers", String(all.customers)],
              ["Average order", rands(all.avg)],
              ["Notes in the shop", String(activeNotes)],
            ]
              .map(
                ([k, v]) => `<tr>
              <td style="padding:10px 0;border-bottom:1px solid ${C.rule};font-size:13.5px;color:${C.soft};">${k}</td>
              <td align="right" style="padding:10px 0;border-bottom:1px solid ${C.rule};font-size:13.5px;color:${C.ink};font-weight:600;">${v}</td>
            </tr>`
              )
              .join("")}
          </table>
        </td></tr>

        ${
          allBreak.notes.length
            ? `${sectionTitle("Top selling notes", "All time")}
        <tr><td style="padding:0 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${barRows(
          allBreak.notes.slice(0, 5).map((n) => ({ label: n.title, value: n.cents, display: `${rands(n.cents)} · ${n.count}`, color: C.accent }))
        )}</table></td></tr>`
            : ""
        }

        <tr><td style="padding:28px 32px 30px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${C.accent};border-radius:8px;">
            <a href="${SITE}/admin.html" style="display:inline-block;padding:13px 24px;font-size:12.5px;letter-spacing:.12em;text-transform:uppercase;color:#ffffff;text-decoration:none;font-weight:600;">Open the dashboard</a>
          </td></tr></table>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:11.5px;line-height:1.6;color:${C.faint};">Sent every morning at 8am. Revenue is before Paystack fees; days run midnight to midnight SAST.<br><a href="${SITE}" style="color:${C.faint};">pgdanotes.co.za</a></p>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `PGDA Notes daily summary: ${dayLong}`,
    "",
    `Revenue: ${rands(y.revenue)} (day before: ${rands(prev.revenue)})`,
    `Orders: ${y.orders} (day before: ${prev.orders})`,
    `Visitors: ${visitorsY} (day before: ${visitorsPrev})`,
    `Notes sold: ${y.notes}`,
    freebiesY ? `Freebies downloaded: ${freebiesY}` : "",
    "",
    ...yPaid.map((o) => `- ${o.full_name || o.email}: ${rands(o.total_cents)}`),
    "",
    "Totals",
    `${monthName} so far: ${rands(month.revenue)} from ${plural(month.orders, "order")}`,
    `Last 30 days: ${rands(last30.revenue)} from ${plural(last30.orders, "order")}`,
    `All time: ${rands(all.revenue)} from ${plural(all.orders, "order")}, ${plural(all.customers, "customer")}`,
    "",
    `Dashboard: ${SITE}/admin.html`,
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");

  return { subject, html, text };
}

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: config, error: configError } = await supabase.rpc("daily_report_config").single();
  if (configError) console.error("daily-report: config", configError);
  const REPORT_SECRET: string = config?.secret ?? "";
  const REPORT_TO = String(config?.recipients ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const given = req.headers.get("X-Report-Secret") ?? "";
  if (!REPORT_SECRET || given.length !== REPORT_SECRET.length) return new Response("Unauthorized", { status: 401 });
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ REPORT_SECRET.charCodeAt(i);
  if (diff !== 0) return new Response("Unauthorized", { status: 401 });

  try {
    const { subject, html, text } = await buildReport(supabase);
    if (new URL(req.url).searchParams.get("dry") === "1") {
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "X-Subject": encodeURIComponent(subject) } });
    }
    if (!RESEND_API_KEY) return Response.json({ ok: false, reason: "RESEND_API_KEY is not set" }, { status: 500 });
    if (!REPORT_TO.length) return Response.json({ ok: false, reason: "daily_report_to is not set in Vault" }, { status: 500 });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: REPORT_TO, subject, html, text }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("daily-report: Resend failed", res.status, body);
      return Response.json({ ok: false, reason: `Resend ${res.status}` }, { status: 502 });
    }
    return Response.json({ ok: true, subject });
  } catch (err) {
    console.error("daily-report error:", err);
    return Response.json({ ok: false, reason: "Something went wrong" }, { status: 500 });
  }
});
