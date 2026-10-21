/**
 * admin-payouts — the admin page's Payouts tab: Paystack's settlements
 * (the money Paystack pays into Courts' bank account), read live from
 * Paystack's API with the secret key, so it's never stored here.
 *
 * Body: { action: "list" | "transactions", ... }
 *   list:         -> { settlements, waiting }
 *                    The latest 100 settlements, newest first. Amounts are
 *                    in cents. waiting is every paid order from the last 14
 *                    days that isn't in any payout yet (checked against the
 *                    sales in the last 14 days' payouts), each with the fee
 *                    Paystack has already charged on it — Paystack sets a
 *                    sale's fee when it's paid, not at payout.
 *   transactions: { id } -> the sales one settlement paid out.
 *
 * Deploy:  supabase functions deploy admin-payouts
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyToken, handlePreflight, json } from "../_shared/admin.ts";

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function paystack(path: string) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.status === false) throw new Error(body.message || `Paystack ${res.status}`);
  return body.data ?? [];
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

// Paystack's field names, flattened to what the tab shows.
function settlement(s: Record<string, unknown>) {
  const fees = num(s.total_fees);
  const paidOut = num(s.effective_amount ?? s.total_amount);
  return {
    id: s.id,
    status: String(s.status || "pending"),
    date: s.settlement_date ?? s.settled_at ?? s.createdAt,
    created_at: s.createdAt,
    gross_cents: num(s.total_processed) || paidOut + fees,
    fees_cents: fees,
    deductions_cents: num(s.deductions),
    paid_out_cents: paidOut,
    currency: s.currency || "ZAR",
  };
}

function transaction(t: Record<string, unknown>) {
  const customer = (t.customer ?? {}) as Record<string, unknown>;
  return {
    reference: t.reference,
    amount_cents: num(t.amount),
    fees_cents: num(t.fees),
    paid_at: t.paid_at ?? t.paidAt ?? t.createdAt,
    email: customer.email ?? null,
    channel: t.channel ?? null,
  };
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (!(await verifyToken(req))) return json({ error: "Unauthorized" }, 401);
  if (!PAYSTACK_SECRET_KEY) return json({ error: "Paystack isn't connected (PAYSTACK_SECRET_KEY is missing)" }, 500);

  try {
    const body = await req.json().catch(() => ({}));

    switch (body.action) {
      case "list": {
        const settlements = (await paystack("/settlement?perPage=100&page=1")).map(settlement);
        settlements.sort((a, b) => String(b.date).localeCompare(String(a.date)));

        // Which recent sales are already in a payout (any status but failed):
        // the sales in every payout from the last 14 days.
        const windowFrom = new Date(Date.now() - 14 * 86400000).toISOString();
        const recent = settlements
          .filter((s) => s.status !== "failed" && String(s.date ?? s.created_at) >= windowFrom.slice(0, 10))
          .slice(0, 15);
        const lists = await Promise.all(
          recent.map((s) => paystack(`/settlement/${s.id}/transactions?perPage=100`).catch(() => []))
        );
        const settled = new Set(lists.flat().map((t) => String(t.reference ?? "")).filter(Boolean));

        // Paid orders in that window that no payout includes yet, with
        // Paystack's fee on each (from verifying the transaction).
        const { data: paid, error } = await createClient(SUPABASE_URL, SERVICE_ROLE)
          .from("orders")
          .select("reference,email,full_name,total_cents,paid_at,created_at,items")
          .eq("status", "paid")
          .gte("paid_at", windowFrom)
          .order("paid_at", { ascending: false });
        if (error) throw error;
        const waiting = await Promise.all(
          (paid ?? [])
            .filter((o) => !settled.has(o.reference))
            .slice(0, 50)
            .map(async (o) => {
              let fees: number | null = null;
              try {
                const t = await paystack(`/transaction/verify/${encodeURIComponent(o.reference)}`);
                fees = t?.fees == null ? null : num(t.fees);
              } catch { /* shown without a fee */ }
              return { ...o, fees_cents: fees };
            })
        );
        console.log(`payouts: ${settlements.length} settlements, ${recent.length} recent, ${settled.size} settled refs, ${waiting.length} waiting`);
        // settled_refs/window_from: what the tab used before `waiting` — kept
        // so an admin page still on the old build keeps working.
        return json({ settlements, waiting, settled_refs: [...settled], window_from: windowFrom });
      }

      case "transactions": {
        const id = String(body.id ?? "").replace(/[^0-9a-zA-Z_-]/g, "");
        if (!id) return json({ error: "id is required" }, 400);
        return json((await paystack(`/settlement/${id}/transactions?perPage=100`)).map(transaction));
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error("admin-payouts error:", err);
    return json({ error: `Couldn't reach Paystack: ${(err as Error).message}` }, 502);
  }
});
