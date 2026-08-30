/**
 * paystack-initiate — looks up a pending order and asks Paystack to start a
 * transaction for it, returning the hosted payment page URL to send the
 * browser to.
 *
 * The secret key can only be used server-side — it can look up and refund
 * transactions, so if it shipped to the browser anyone with DevTools open
 * could use it. That's why this runs here instead of in checkout.js.
 *
 * Deploy:  supabase functions deploy paystack-initiate
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Falls back to "*" so a missing SITE_URL secret doesn't turn into a
// confusing "Access-Control-Allow-Origin: undefined" that every browser
// silently blocks — same fallback _shared/admin.ts uses for the admin-*
// functions. SITE_URL is still required below, for callback_url: unlike
// CORS, there's no safe default for where Paystack should send the buyer
// back to.
const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") || "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { reference } = await req.json();
    if (!reference) return json({ error: "Missing reference" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: order, error } = await supabase
      .from("orders")
      .select("reference,email,total_cents,status")
      .eq("reference", reference)
      .eq("status", "pending")
      .single();

    if (error || !order) return json({ error: "Order not found" }, 404);

    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: order.email,
        amount: order.total_cents, // Paystack wants the amount in the smallest unit — cents, for ZAR
        currency: "ZAR",
        reference: order.reference,
        callback_url: `${SITE_URL}/?paid=1&ref=${order.reference}`,
      }),
    });

    const body = await res.json();
    if (!res.ok || !body.status) {
      console.error("Paystack initialize failed:", body);
      return json({ error: body.message || "Could not start payment" }, 502);
    }

    return json({ authorization_url: body.data.authorization_url });
  } catch (err) {
    console.error(err);
    return json({ error: "Server error" }, 500);
  }
});
