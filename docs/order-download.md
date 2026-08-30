# Delivering the notes (no domain yet)

There's no domain with email hosting yet, so instead of emailing download
links once an order is `paid`, the shop generates and shows them itself. This
is `order-download` in `supabase/functions/`, driven from `src/downloads.js`.

## The flow

```
paystack-initiate                                    Browser
   ├─ callback_url: ${SITE_URL}/?paid=1&ref=<reference> ──────────►│
                                                                     ├─ opens the download modal
                                                                     ├─ POST { reference, email } ──► order-download
                                                                     │                                    ├─ look up the order
                                                                     │                                    ├─ check email matches
                                                                     │                                    ├─ if paid: sign a URL per item
                                                                     │◄────── { ok, items } ───────────────┤
                                                                     └─ show Download buttons
```

`checkout.js` saves the buyer's email to `localStorage` (`cta_last_email`)
right before redirecting to Paystack, purely so the return trip can prefill
and auto-submit the lookup without asking them to retype it — the reference
itself comes back on the URL (`?ref=...`). Neither is treated as a secret on
its own; `order-download` requires both together, and doesn't reveal which
one (if either) was wrong.

The footer's "Already paid? Get your notes" link opens the same modal empty,
for anyone coming back later, on a different device, or from a lost tab.

## Why this over email

- Works today, with nothing to sign up for or verify.
- No spam-folder risk — a shared/unverified sending domain (the only option
  without owning a domain) lands in spam noticeably more than it should for
  something already paid for.
- The self-serve lookup is also the disaster-recovery path for someone who
  loses their file down the line — email delivery alone doesn't cover that
  without also building a "resend" flow, so building the lookup first covers
  both cases in one function.

Once a real domain exists, sending the same links by email too (Resend or
Postmark) is a small addition on top of this, not a replacement for it — see
`order-download`'s deploy comment for where that would slot in.

## order-download

Called with `{ reference, email }`. No admin token — a buyer isn't logged in.
Always responds `200 { ok, ... }` rather than using HTTP status codes for
"not found" or "wrong email," so the two cases look identical to the caller
and a bare reference can't be used to enumerate or confirm orders:

| `ok` | `reason` | Meaning |
|---|---|---|
| `false` | `not_found` | No order matches that reference *and* email together |
| `false` | `pending` | Order exists, matches, payment not confirmed yet |
| `false` | `failed` / `refunded` | Order exists, matches, nothing to deliver |
| `false` | `server_error` | Unexpected error (the one case that's a real 500) |
| `true` | — | `{ reference, items: [{ title, url }] }` — `url` is `null` for any item whose `file_path` isn't set yet |

Signed URLs come from `supabase.storage.from("notes").createSignedUrl(...)`
with the service_role key (the only thing allowed to read the private `notes`
bucket), valid for 24 hours — long enough to actually download, short enough
that a leaked link doesn't stay useful for long.

`src/downloads.js` also handles the "pending" case by quietly retrying every
few seconds (up to 5 times) right after checkout, since `paystack-webhook`
can take a few seconds to fire after the browser is already back on the
site — the buyer doesn't need to notice or do anything for this to resolve
itself.

## Secrets

None beyond what `paystack-initiate` already needs — `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are injected automatically, and `SITE_URL` (see
`docs/paystack.md`) is reused for CORS the same way.
