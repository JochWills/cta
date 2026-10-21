/**
 * admin-payouts — the admin page's Payouts tab: Paystack's settlements
 * (the money Paystack pays into Courts' bank account), read live from
 * Paystack's API with the secret key, so it's never stored here.
 *
 * Body: { action: "list" | "transactions", ... }
 *   list:         -> { settlements, last_settled_paid_at }
 *                    The latest 100 settlements, newest first. Amounts are
 *                    in cents. last_settled_paid_at is when the newest
 *                    settled sale was paid — any paid order after that is
 *                    still waiting to be paid out (the tab works that out).
 *   transactions: { id } -> the sales one settlement paid out.
 *
 * Deploy:  supabase functions deploy admin-payouts
 */

import { verifyToken, handlePreflight, json } from "../_shared/admin.ts";

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";

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

        // The newest settled sale marks where "waiting for payout" starts.
        let lastSettledPaidAt: string | null = null;
        const newest = settlements.find((s) => s.status === "success");
        if (newest) {
          const txs = (await paystack(`/settlement/${newest.id}/transactions?perPage=100`)).map(transaction);
          lastSettledPaidAt = txs.map((t) => String(t.paid_at ?? "")).sort().pop() || null;
        }
        return json({ settlements, last_settled_paid_at: lastSettledPaidAt });
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
