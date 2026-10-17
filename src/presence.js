/**
 * Tells the admin page roughly how many people are on the site right now,
 * where they came from and how far they got. A random, meaningless id per
 * tab — not a cookie, not tied to a person — gets a heartbeat written to a
 * Supabase table every ~20s (see the "LIVE VISITOR COUNT" and "VISITOR
 * SOURCES" sections of supabase/schema.sql for the tables/functions and
 * why they're shaped this way). admin/render.js polls
 * active_visitor_count() to show the total; the dashboard reads
 * visitor_insights().
 *
 * The first heartbeat also sends a source label (see sourceLabel) and the
 * device type, and track() records the shop steps a session reaches.
 *
 * Silently does nothing if there's no database configured (hasDB false) —
 * same as the rest of the shop in that case.
 */
import { hasDB, sbRpc } from "./supabase.js";

const HEARTBEAT_MS = 20_000;

let sessionId = "";

/** Referring sites worth a proper name, matched against the hostname. Anything else shows as its own domain. */
const KNOWN_SOURCES = [
  [/(^|\.)google\./, "Google"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"],
  [/(^|\.)yahoo\./, "Yahoo"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "Facebook"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, "WhatsApp"],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "X"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "LinkedIn"],
  [/(^|\.)reddit\.com$/, "Reddit"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)(chatgpt\.com|openai\.com)$/, "ChatGPT"],
  [/(^|\.)perplexity\.ai$/, "Perplexity"],
];

const UTM_NAMES = { ig: "Instagram", instagram: "Instagram", fb: "Facebook", facebook: "Facebook", tiktok: "TikTok", whatsapp: "WhatsApp", google: "Google" };

function nameForHost(host) {
  host = host.replace(/^www\./, "");
  if (/^(mail\.google\.com|outlook\.)/.test(host)) return "Email";
  const known = KNOWN_SOURCES.find(([re]) => re.test(host));
  return known ? known[1] : host;
}

/**
 * Where this visit came from, best guess first:
 *  1. utm_source or a click id the platform added to the link itself
 *     (Instagram adds utm_source=ig to bio links, Facebook adds fbclid,
 *     TikTok ttclid, Google Ads gclid)
 *  2. the app's own in-app browser, which says so in its user agent —
 *     catches Instagram/Facebook/TikTok taps that arrive with no referrer
 *  3. the referring site
 *  4. "Direct" — typed in, a bookmark, or an app that hides the referrer
 *     (WhatsApp almost always does)
 */
function sourceLabel() {
  const params = new URLSearchParams(location.search);
  const utm = (params.get("utm_source") || "").toLowerCase().trim();
  if (utm) return UTM_NAMES[utm] || nameForHost(utm);
  if (params.has("fbclid")) return "Facebook";
  if (params.has("ttclid")) return "TikTok";
  if (params.has("gclid")) return "Google";

  const ua = navigator.userAgent;
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "Facebook";
  if (/musical_ly|BytedanceWebview|TikTok/i.test(ua)) return "TikTok";
  if (/LinkedInApp/i.test(ua)) return "LinkedIn";
  if (/Snapchat/i.test(ua)) return "Snapchat";

  if (document.referrer.startsWith("android-app://")) {
    const app = document.referrer.slice(14);
    if (app.startsWith("com.google.android.gm")) return "Email";
    if (app.includes("whatsapp")) return "WhatsApp";
    if (app.includes("googlequicksearchbox")) return "Google";
    return app.split("/")[0];
  }
  try {
    const ref = new URL(document.referrer);
    if (ref.hostname && ref.hostname !== location.hostname) return nameForHost(ref.hostname);
  } catch {
    // no referrer
  }
  return "Direct";
}

function deviceType() {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "tablet";
  if (/Mobi|Android|iPhone/i.test(ua)) return "mobile";
  return "desktop";
}

/** Read and write sessionStorage without ever throwing (private browsing can block it). */
function stored(key, make) {
  try {
    let value = sessionStorage.getItem(key);
    if (!value) {
      value = make();
      sessionStorage.setItem(key, value);
    }
    return value;
  } catch {
    return make(); // sessionStorage unavailable — still works, just re-counts on refresh
  }
}

export function startPresence() {
  if (!hasDB) return;

  sessionId = stored("cta_session_id", () => crypto.randomUUID());
  // Kept for the whole tab, so moving to /terms and back doesn't turn a
  // Google visit into one "from" this site.
  const source = stored("cta_source", sourceLabel);
  const device = deviceType();

  const beat = () =>
    sbRpc("heartbeat", { p_session_id: sessionId, p_source: source, p_device: device }).catch(() => {}); // best-effort, never worth surfacing to a visitor
  beat();
  setInterval(beat, HEARTBEAT_MS);
}

/** Note that this session reached a step: "preview", "cart" or "checkout". Once a day per step is all the database keeps. */
const tracked = new Set();
export function track(event) {
  if (!hasDB || !sessionId || tracked.has(event)) return;
  tracked.add(event);
  sbRpc("track_event", { p_session_id: sessionId, p_event: event }).catch(() => {});
}
