# PayFast integration

Everything needed to finish checkout. Nothing here is wired up yet — the two
Edge Function stubs in `supabase/functions/` are where the code goes.

## Why it can't be done in the browser

PayFast requires an MD5 signature over the payment parameters plus your
passphrase. Anything in `src/` ships to the public, so the passphrase would be
readable by anyone who opens DevTools — and with it, anyone could forge a
payment notification. Both the signature and the notification handling run
server-side, in Supabase Edge Functions.

## The flow

```
Browser                    payfast-initiate           PayFast            payfast-notify
   │                        (Edge Function)                              (Edge Function)
   ├─ save order (pending) ─────────────────────────────────────────────────────►  Supabase
   ├─ POST { reference } ─────►│
   │                           ├─ look up order, build + sign fields
   │◄── { action, fields } ────┤
   ├─ POST form to PayFast ─────────────────────────►│
   │                                                  ├── ITN callback ──────────►│
   │                                                  │                            ├─ verify signature
   │                                                  │                            ├─ confirm with PayFast
   │                                                  │                            ├─ check amount
   │                                                  │                            ├─ status = paid
   │                                                  │                            └─ email signed URLs
   │◄──────── redirect to return_url ─────────────────┤
```

The browser is never trusted. The order only becomes `paid` when PayFast tells
the server it was paid, and the server has verified that message.

## 1. Account setup

1. Register at [payfast.co.za](https://www.payfast.co.za) and complete FICA
   verification (ID and proof of bank account — allow a few days).
2. Note your **Merchant ID** and **Merchant Key** from Settings → Integration.
3. Set a **passphrase** in the same screen. Required for signature validation.
4. Use the sandbox at `sandbox.payfast.co.za` until everything works end to end.

## 2. Secrets

Set these on the Supabase project, never in `.env`:

```bash
supabase secrets set \
  PAYFAST_MERCHANT_ID=10000100 \
  PAYFAST_MERCHANT_KEY=46f0cd694581a \
  PAYFAST_PASSPHRASE=your-passphrase \
  PAYFAST_MODE=sandbox \
  SITE_URL=https://ctanotes.co.za \
  RESEND_API_KEY=re_...
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge Functions
automatically — you don't set those.

## 3. payfast-initiate

Takes `{ reference }`, looks up the order with the service_role key, and returns
the form fields plus a signature.

Fields to send:

| Field | Value |
|---|---|
| `merchant_id`, `merchant_key` | from secrets |
| `return_url` | `${SITE_URL}/?paid=1` |
| `cancel_url` | `${SITE_URL}/?cancelled=1` |
| `notify_url` | `${SUPABASE_URL}/functions/v1/payfast-notify` |
| `name_first`, `email_address` | from the order |
| `m_payment_id` | the order `reference` |
| `amount` | `(total_cents / 100).toFixed(2)` |
| `item_name` | e.g. `CTA Notes — 3 sections` |

**Signature rules — these trip everyone up:**

- Build the string in the exact order the fields are listed above, not
  alphabetically. Skip any field that is empty.
- URL-encode each value, then **uppercase the percent-encoding** (`%2f` → `%2F`).
- Encode spaces as `+`, not `%20`.
- Append `&passphrase=<urlencoded passphrase>` last.
- MD5 the result, lowercase hex.

Then post to `https://www.payfast.co.za/eng/process`
(or `https://sandbox.payfast.co.za/eng/process` in sandbox mode).

## 4. payfast-notify (ITN)

PayFast POSTs `application/x-www-form-urlencoded` here. Four checks, in order,
before touching the database:

1. **Signature** — recompute over the posted fields in the order received,
   with the passphrase, and compare.
2. **Source** — the request IP should resolve to a PayFast host
   (`www.payfast.co.za`, `sandbox.payfast.co.za`, `w1w.payfast.co.za`,
   `w2w.payfast.co.za`).
3. **Server confirmation** — POST the untouched payload back to
   `https://www.payfast.co.za/eng/query/validate`; it must reply `VALID`.
4. **Amount** — `amount_gross` must match the order's `total_cents / 100` to
   within a cent. Never trust the posted amount alone.

Only then:

```sql
update orders
set status = 'paid', payment_ref = $pf_payment_id, paid_at = now()
where reference = $m_payment_id and status = 'pending';
```

Guard against duplicates — PayFast retries. The `and status = 'pending'` clause
makes the update idempotent, so a repeated ITN won't re-send the email.

Always respond `200 OK` with an empty body, even on rejection. A non-200 makes
PayFast retry for hours.

## 5. Delivering the notes

After the order flips to `paid`:

```ts
const { data } = await supabase.storage
  .from("notes")
  .createSignedUrl(product.file_path, 60 * 60 * 24); // 24 hours
```

Email the links (Resend, Postmark, or Supabase's SMTP). Keep the `notes` bucket
private — a public bucket means one shared link ends up circulating forever.

If you want links to survive longer than the signed URL, add a
`download_tokens` table (token, order_id, product_id, expires_at, uses) and serve
files through a `download` Edge Function that checks the token.

## 6. Testing

Sandbox card: `4000000000000002`, any future expiry, CVV `123`.

The ITN can't reach `localhost`. Either deploy the function and test against the
live URL, or tunnel with `ngrok http 54321` and point `notify_url` at the tunnel.

Before going live, confirm: a cancelled payment leaves the order `pending`; a
duplicate ITN doesn't send two emails; an amount mismatch is rejected and logged.
