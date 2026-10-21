import { $, esc, rands } from "../state.js";

/**
 * The Health tab — renders what admin-health returns (see that function
 * for where each number comes from). Each check is "ok", "warn" or "bad";
 * the sidebar shows how many aren't ok.
 *
 * The two traffic figures are projections, not readings: neither Render nor
 * Supabase lets the site read its own usage, so they're worked out from the
 * last 7 days of visitors and preview opens × what one costs (measured).
 * Render emails at 70%/90% of its allowance either way.
 */

// Free-plan allowances (as of 2026 — Render Hobby, Supabase Free).
const GB = 1024 ** 3;
const LIMITS = { renderTraffic: 5 * GB, supabaseTraffic: 5 * GB, db: 500 * 1024 ** 2, storage: 1 * GB };
// What a visitor costs Render, calibrated against Render's own figure rather
// than page weight alone: on 21 Oct 2026 Render showed 3.5 GB for October
// from 1,400 visitor-days, about 2.5 MB each. That's more than the page
// itself (then ~1.35 MB with the old 1.2 MB PNG hero) because Render also
// counts bots, link-preview fetches and admin page loads, which never show
// up as visitors. The WebP hero (live 21 Oct) took ~1.15 MB off each visit.
// Recalibrate both from Render's number now and then.
const WEBP_HERO_FROM = "2026-10-21";
const RENDER_BYTES_PER_VISIT_OLD = 2.5 * 1024 ** 2;
const RENDER_BYTES_PER_VISIT = 1.35 * 1024 ** 2;
// What a preview costs Supabase: three page images, ~180 KB each, and most
// visitors who preview open about two notes.
const SUPABASE_BYTES_PER_PREVIEWER = 1.1 * 1024 ** 2;
// A paid note's PDF download (average size, measured).
const BYTES_PER_DOWNLOAD = 280 * 1024;

const RENDER_URL = "https://dashboard.render.com";
const SUPABASE_URL = "https://supabase.com/dashboard/project/btjkjkqddycyjbftchgm";

const size = (bytes) =>
  bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${Math.round(bytes / 1024 ** 2)} MB` : `${Math.round(bytes / 1024)} KB`;
const level = (share) => (share < 0.6 ? "ok" : share < 0.85 ? "warn" : "bad");
const LABEL = { ok: "Good", warn: "Keep an eye on it", bad: "Needs attention" };

function ago(iso) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const pill = (state, text = LABEL[state]) => `<span class="health-pill is-${state}">${esc(text)}</span>`;

function meter({ title, used, limit, note, link, linkLabel, projected, soFar, alertAt }) {
  const share = used / limit;
  // alertAt: only flag it once actual use passes that share, and nothing in between.
  const state = alertAt ? (share > alertAt ? "bad" : "ok") : level(share);
  return {
    state,
    html: `
    <div class="health-meter">
      <div class="health-row-top">
        <strong>${esc(title)}</strong>
        ${pill(state)}
      </div>
      <div class="health-bar is-${state}"><span style="width:${Math.min(100, Math.max(1.5, share * 100)).toFixed(1)}%"></span></div>
      <div class="health-meter-figures">
        <span>${projected || soFar ? "About " : ""}<strong>${size(used)}</strong>${projected ? " a month" : soFar ? " so far this month" : ""} of ${size(limit)} free</span>
        <span>${Math.round(share * 100)}%</span>
      </div>
      <p class="health-note">${note}${link ? ` <a href="${link}" target="_blank" rel="noopener">${esc(linkLabel)} ↗</a>` : ""}</p>
    </div>`,
  };
}

function row(state, title, detail, extra = "") {
  return {
    state,
    html: `
    <div class="health-row">
      <span class="health-dot is-${state}" aria-hidden="true"></span>
      <div class="health-row-text">
        <strong>${esc(title)}</strong>
        <span>${detail}</span>
        ${extra}
      </div>
    </div>`,
  };
}

const list = (items) =>
  items.length ? `<ul class="health-list">${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "";

function card(title, rows, sub = "") {
  return `
    <section class="admin-card health-card">
      <div class="dash-card-head"><div><h3>${esc(title)}</h3>${sub ? `<p class="dash-card-sub">${sub}</p>` : ""}</div></div>
      ${rows.map((r) => r.html).join("")}
    </section>`;
}

/** Returns how many checks aren't "ok", for the sidebar badge. */
export function renderHealth(h) {
  const days = h.days || [];
  const last7 = days.slice(-8, -1); // the 7 full days before today
  const avg = (key) => (last7.length ? last7.reduce((s, d) => s + d[key], 0) / last7.length : 0);
  const visitorsPerDay = avg("visitors");
  const previewersPerDay = avg("previews");
  const storageBytes = (h.storage || []).reduce((s, b) => s + b.bytes, 0);

  // Render counts bandwidth per calendar month, so: this month so far, and
  // where it's heading at the last week's pace.
  const today = new Date();
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const renderSoFar = days
    .filter((d) => d.day >= monthStart)
    .reduce((s, d) => s + d.visitors * (d.day < WEBP_HERO_FROM ? RENDER_BYTES_PER_VISIT_OLD : RENDER_BYTES_PER_VISIT), 0);
  const daysLeft = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate();
  const renderHeading = renderSoFar + daysLeft * visitorsPerDay * RENDER_BYTES_PER_VISIT;

  const limits = [
    meter({
      title: "Render — website traffic",
      used: renderSoFar,
      alertAt: 0.9, // Courts' call: only flag Render traffic past 90% actually used
      limit: LIMITS.renderTraffic,
      soFar: true,
      note: `Heading for about ${size(renderHeading)} by the end of the month at ${Math.round(visitorsPerDay)} visitors a day. An estimate — Render's own figure is the real one, and it emails you at 70% and 90%.`,
      link: RENDER_URL,
      linkLabel: "Exact usage on Render",
    }),
    meter({
      title: "Supabase — file traffic",
      used: previewersPerDay * 30 * SUPABASE_BYTES_PER_PREVIEWER + (h.orders?.paid_items_30d || 0) * BYTES_PER_DOWNLOAD,
      limit: LIMITS.supabaseTraffic,
      projected: true,
      note: `Preview images and PDF downloads — from ${Math.round(previewersPerDay)} people previewing a day and ${h.orders?.paid_items_30d || 0} notes downloaded in 30 days.`,
      link: SUPABASE_URL,
      linkLabel: "Exact usage on Supabase",
    }),
    meter({
      title: "Supabase — database",
      used: h.db_bytes || 0,
      limit: LIMITS.db,
      note: "Orders, notes, reviews and visitor stats.",
    }),
    meter({
      title: "Supabase — file storage",
      used: storageBytes,
      limit: LIMITS.storage,
      note: (h.storage || []).map((b) => `${b.bucket === "notes" ? "PDFs" : "Preview images"}: ${b.files} files, ${size(b.bytes)}`).join(" · "),
    }),
  ];

  const s = h.site || {};
  const missing = s.missing_note_pages || [];
  const website = [
    s.home?.ok
      ? row(s.home.ms < 1500 ? "ok" : "warn", "Website is online", `pgdanotes.co.za answered in ${s.home.ms} ms`)
      : row("bad", "Website isn't answering", `The homepage returned ${s.home?.status || "no response"}. Check Render.`),
    !s.sitemap?.ok
      ? row("bad", "Note pages", "Couldn't read the sitemap, so the note pages can't be checked.")
      : missing.length
        ? row(h.secrets?.auto_rebuild ? "warn" : "bad", `${missing.length} note${missing.length === 1 ? " has" : "s have"} no page yet`,
            h.secrets?.auto_rebuild ? "A rebuild should add them within a few minutes of saving." : "They'll appear after the next push.", list(missing))
        : row("ok", "Every note has its own page", `${s.sitemap.note_pages} note pages live`),
    row(s.sitemap?.built ? "ok" : "warn", "Last site update", s.sitemap?.built ? `Built on ${esc(new Date(s.sitemap.built).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" }))}` : "Unknown"),
    row(h.secrets?.auto_rebuild ? "ok" : "warn", "Auto-rebuild", h.secrets?.auto_rebuild ? "On — saving a note in the admin page updates the site" : "Off — new notes only get a page after a push"),
    row(h.secrets?.email ? "ok" : "bad", "Emails", h.secrets?.email ? `On — thank-you and review emails send from notes@pgdanotes.co.za${h.secrets.reply_to ? ", replies go to your Gmail" : ""}` : "Off — no thank-you or review emails will send"),
  ];

  const o = h.orders || {};
  const p = h.payments || {};
  const notMarked = p.paid_not_marked || [];
  const payments = [
    row(h.secrets?.paystack ? "ok" : "bad", "Paystack connected", h.secrets?.paystack ? "Checkout can take payments" : "No Paystack key — checkout won't work"),
    notMarked.length
      ? row("bad", `${notMarked.length} paid order${notMarked.length === 1 ? "" : "s"} not marked as paid`,
          "Paystack took the money but the shop didn't record it, so the buyer can't get their notes. Ask Claude to fix these.",
          list(notMarked.map((x) => `${x.reference} · ${x.full_name || x.email} · ${rands(x.total_cents)}`)))
      : row("ok", "Every payment was recorded", p.checked ? `Checked ${p.checked} unfinished checkout${p.checked === 1 ? "" : "s"} with Paystack — none were paid` : "No unfinished checkouts to check"),
    row("ok", "Unfinished checkouts", `${p.unfinished || 0} in the last 7 days — people who started paying and left. Normal, but a high number can mean a checkout problem.`),
    row(o.failed_7d ? "warn" : "ok", "Failed payments", `${o.failed_7d || 0} in the last 7 days`),
    row("ok", "Sales", `${o.paid_7d || 0} paid orders in the last 7 days · last sale ${ago(o.last_paid_at)}`),
  ];

  const n = h.notes || {};
  const issue = (items, title, why) =>
    items?.length ? row("warn", `${items.length} ${title}`, why, list(items)) : null;
  const notes = [
    issue(n.no_pdf, `note${n.no_pdf?.length === 1 ? "" : "s"} without a PDF`, "Buyers would get nothing to download — upload one in Notes."),
    issue(n.no_preview, `note${n.no_preview?.length === 1 ? "" : "s"} without a preview`, "Previews help a note sell — re-upload the PDF to make them."),
    issue(n.no_pages, `note${n.no_pages?.length === 1 ? "" : "s"} without a page count`, "Fills itself in next time the admin page loads."),
    issue(n.no_description, `note${n.no_description?.length === 1 ? "" : "s"} without a description`, "The card and note page look empty — add one in Notes."),
  ].filter(Boolean);
  if (!notes.length) notes.push(row("ok", "Every note is complete", `${n.active || 0} notes for sale${n.hidden ? `, ${n.hidden} hidden` : ""} — each has a PDF, preview, page count and description`));

  const other = [
    row(h.reviews_waiting ? "warn" : "ok", "Reviews waiting", h.reviews_waiting ? `${h.reviews_waiting} waiting to be published — <a href="#" data-tab="reviews">open Reviews</a>` : "None waiting"),
    row(h.login_failures_24h >= 5 ? "bad" : h.login_failures_24h ? "warn" : "ok", "Wrong admin passwords", `${h.login_failures_24h || 0} in the last 24 hours${h.login_failures_24h >= 5 ? " — someone may be guessing. After 5 from one place they're locked out for 15 minutes." : ""}`),
  ];

  const all = [...limits, ...website, ...payments, ...notes, ...other];
  const bad = all.filter((r) => r.state === "bad").length;
  const warn = all.filter((r) => r.state === "warn").length;
  const summary = bad
    ? `<div class="health-summary is-bad">${bad} thing${bad === 1 ? " needs" : "s need"} attention${warn ? `, and ${warn} to keep an eye on` : ""}.</div>`
    : warn
      ? `<div class="health-summary is-warn">Everything's working. ${warn} thing${warn === 1 ? "" : "s"} to keep an eye on.</div>`
      : `<div class="health-summary is-ok">Everything's healthy.</div>`;

  $("#healthBody").innerHTML = `
    ${summary}
    <div class="health-grid">
      ${card("Free plan limits", limits, "Render hosts the website; Supabase holds the data, PDFs and preview images.")}
      ${card("Website", website)}
      ${card("Payments", payments)}
      ${card("Notes", notes)}
      ${card("Other", other)}
    </div>`;
  $("#healthChecked").textContent = `Last checked ${new Date(h.checked_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}.`;
  return bad + warn;
}
