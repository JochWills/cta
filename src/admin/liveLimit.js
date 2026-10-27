/**
 * The "online" pop-up's viewing allowance: 10 minutes per clock hour
 * (13:00–14:00, 14:00–15:00…), counted only while the pop-up is open and
 * the tab is in view. Per device on purpose — it lives in this browser's
 * localStorage, so another device has its own 10 minutes. A fresh hour
 * starts a fresh allowance.
 */
export const LIVE_LIMIT_MS = 10 * 60 * 1000;
const KEY = "cta_live_usage";

/** "2026-10-27T13" — the local clock hour usage is counted against. */
function hourKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}`;
}

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    return v && v.hour === hourKey() ? v : { hour: hourKey(), ms: 0 };
  } catch {
    return { hour: hourKey(), ms: 0 };
  }
}

export const remainingMs = () => Math.max(0, LIVE_LIMIT_MS - read().ms);

/** Adds viewing time to this hour's total (a new hour starts from zero). */
export function addUsage(ms) {
  const v = read();
  v.ms = Math.min(LIVE_LIMIT_MS, v.ms + ms);
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // storage blocked — the limit just can't be remembered on this device
  }
}

/** When the allowance resets: the top of the next hour. */
export function nextHour() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

/** "7:42" for a countdown. */
export function mmss(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
