# Paystack integration

The payment processor for checkout. `paystack-initiate` and `paystack-webhook`
in `supabase/functions/` are deployed; this is how they work and what's left
to configure.

## Why it can't be done in the browser

Starting a transaction and confirming one both need the Paystack **secret**
key. Anything in `src/` ships to the public, so the secret key would be
readable by anyone who opens DevTools — and with it, anyone could look up or
refund transactions on your account. Both steps run server-side, in Supabase
Edge Functions.

## The flow

```
Browser                   paystack-initiate         Paystack        paystack-webhook
   │                       (Edge Function)                          (Edge Function)
   ├─ save order (pending) ───────────────────────────────────────────────────►  Supabase
   ├─ POST { reference } ────►│
   │                          ├─ look up the pending order
   │                          ├─ POST /transaction/initialize ───────►│
   │                          │◄──────── { authorization_url } ───────┤
   │◄── { authorization_url } ┤
   ├─ redirect the browser there ───────────────────►│
   │                                                  ├── buyer pays ──┤
   │                                                  ├── charge.success webhook ──►│
   │                                                  │                              ├─ verify signature
   │                                                  │                              ├─ check amount/currency
   │                                                  │                              └─ status = paid
   │◄──────── redirect to callback_url ───────────────┤
```

The browser is never trusted. The order only becomes `paid` when the webhook
fires and its signature checks out — **not** when the browser lands back on
`callback_url`. Paystack sends the buyer back there whether the payment
succeeded, failed, or was abandoned, so that redirect is just "the buyer is
back," never proof of payment. That's why `main.js`'s message for `?paid=1`
says "we'll email your download links once the payment is confirmed" rather
than "thanks for your purchase."

## 1. Account setup

1. Register at [paystack.com](https://paystack.com) and complete verification
   for a South African business (or use test mode until then).
2. **Settings → API Keys & Webhooks** has your test and live secret keys.
3. In the same screen, set the **Webhook URL** to:
   ```
   https://<project-ref>.supabase.co/functions/v1/paystack-webhook
   ```
4. Confirm your account has **ZAR** enabled as a settlement/processing
   currency — `paystack-initiate` always sends `currency: "ZAR"`.

## 2. Secrets

Set this on the Supabase project, never in `.env`:

```bash
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_...
```

`SITE_URL` is also required (used to build the `callback_url`, and to
restrict CORS on `paystack-initiate`) — it's the same secret the admin page
uses, see `docs/admin.md`:

```bash
supabase secrets set SITE_URL=https://ctanotes.co.za
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge
Functions automatically — you don't set those.

## 3. paystack-initiate

Called from `checkout.js` with `{ reference }` once the order is saved.
Looks the order up with the service_role key (so the amount and email come
from the database, never from the browser), then calls Paystack's
[Initialize Transaction](https://paystack.com/docs/api/transaction/#initialize)
endpoint:

| Field | Value |
|---|---|
| `email` | the order's email |
| `amount` | `total_cents` as-is — Paystack wants the smallest currency unit, which for ZAR is cents |
| `currency` | `"ZAR"` |
| `reference` | the order's `reference` (so the webhook can look the order back up directly) |
| `callback_url` | `${SITE_URL}/?paid=1&ref=<reference>` |

Returns `{ authorization_url }`; `checkout.js` sends the browser there with
`window.location.href = authorization_url`.

## 4. paystack-webhook

Paystack POSTs JSON here on every event; only `charge.success` matters. Two
checks before the database is touched:

1. **Signature** — Paystack signs the raw request body with HMAC-SHA512 using
   your secret key, sent in the `x-paystack-signature` header. Recompute it
   and compare; if it doesn't match, reject.
2. **Amount and currency** — compare `data.amount`/`data.currency` against
   the order's own `total_cents` (ZAR only). Never trust a webhook payload for
   money without checking it against what you actually charged for, even
   though the signature already proves Paystack sent it.

Only then:

```sql
update orders
set status = 'paid', payment_ref = $paystack_transaction_id, paid_at = now()
where reference = $reference and status = 'pending';
```

Guard against duplicates — Paystack retries on anything but a fast 200. The
`and status = 'pending'` clause makes the update idempotent, so a repeated
webhook won't re-send the email once delivery is wired up.

Always respond `200 OK`, even on rejection — a non-200 makes Paystack keep
retrying.

## 5. Delivering the notes

Not built yet — the same gap the PayFast plan had (see `paystack-webhook`'s
`TODO`). After an order flips to `paid`:

```ts
const { data } = await supabase.storage
  .from("notes")
  .createSignedUrl(product.file_path, 60 * 60 * 24); // 24 hours
```

Email the links (Resend, Postmark, or Supabase's SMTP). Keep the `notes`
bucket private — a public bucket means one shared link ends up circulating
forever.

## 6. Testing

Test-mode card: `4084 0840 8408 4081`, any future expiry, CVV `408`, OTP
`123456`. Full list at
[Paystack's test cards](https://paystack.com/docs/payments/test-payments).

The webhook can't reach `localhost`. Either deploy the function and test
against the live URL, or tunnel with `ngrok http 54321` and set that tunnel
URL as the Webhook URL in the Paystack dashboard temporarily.

Before going live: confirm an abandoned/declined payment leaves the order
`pending`; a duplicate webhook doesn't send two emails once delivery exists;
an amount mismatch is rejected and logged; switch `PAYSTACK_SECRET_KEY` from
`sk_test_...` to `sk_live_...` and re-set the webhook URL if you registered a
separate live-mode webhook.
