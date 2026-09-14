/**
 * Tells the admin page roughly how many people are on the site right now.
 * A random, meaningless id per tab — not a cookie, not tied to a person,
 * nothing else sent or stored — gets a heartbeat written to a Supabase
 * table every ~20s (see the "LIVE VISITOR COUNT" section of
 * supabase/schema.sql for the table/functions and why it's shaped this
 * way). admin/render.js polls active_visitor_count() to show the total.
 *
 * Silently does nothing if there's no database configured (hasDB false) —
 * same as the rest of the shop in that case.
 */
import { hasDB, sbRpc } from "./supabase.js";

const HEARTBEAT_MS = 20_000;

export function startPresence() {
  if (!hasDB) return;

  let sessionId;
  try {
    sessionId = sessionStorage.getItem("cta_session_id");
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem("cta_session_id", sessionId);
    }
  } catch {
    sessionId = crypto.randomUUID(); // sessionStorage unavailable — still works, just re-counts on refresh
  }

  const beat = () => sbRpc("heartbeat", { p_session_id: sessionId }).catch(() => {}); // best-effort, never worth surfacing to a visitor
  beat();
  setInterval(beat, HEARTBEAT_MS);
}
