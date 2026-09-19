# Admin page

`admin.html` (built alongside `index.html` — see `vite.config.js`) is a
second, unlinked page at `/admin.html` on the same Render site. It lets
Courts:

- **See every order** — reference, buyer, items, total, status — and delete
  one if it needs to go (status itself still isn't editable here).
- **Add, edit and delete notes** — code, title, description, module, price,
  active flag, sort order — and upload the PDF for each one straight into
  the private `notes` storage bucket.
- **Create and delete discount codes** — a code plus a % off (1-99) that
  buyers can enter at checkout.

It exists because the anon key the shop ships to browsers deliberately
cannot do any of that (see `supabase/schema.sql` and the RLS section of
`CLAUDE.md`), so the admin page talks to five small Supabase Edge Functions
that use the `service_role` key on the server instead. `admin.html` itself
never sees that key.

## How the login works

There's one shared password, not a per-user account — this is a one-person
shop. `admin-login` checks it against the `ADMIN_PASSWORD` secret and, on a
match, issues a signed token good for 12 hours. The admin page sends that
token back as `X-Admin-Token` on every call to `admin-orders`,
`admin-products`, `admin-upload` and `admin-discounts`, which each verify it before touching
the database. The token lives in `sessionStorage` in the browser — cleared
when the tab closes, never `localStorage` — so it doesn't linger on a shared
computer.

## One-time setup

**1. Set the two Edge Function secrets** (never commit these, and they're
separate from `ADMIN_SESSION_SECRET` being anything like the password
itself):

```bash
supabase secrets set ADMIN_PASSWORD=<pick-something-strong>
supabase secrets set ADMIN_SESSION_SECRET=$(openssl rand -hex 32)
```

`SITE_URL` should already be set from the Paystack setup (`docs/paystack.md`)
— the admin functions reuse it to restrict CORS to your real site. If it
isn't set yet:

```bash
supabase secrets set SITE_URL=https://pgdanotes.co.za
```

**2. Deploy the five functions:**

```bash
supabase functions deploy admin-login
supabase functions deploy admin-orders
supabase functions deploy admin-products
supabase functions deploy admin-upload
supabase functions deploy admin-discounts
```

(`_shared/admin.ts` isn't deployed on its own — the CLI bundles it into
each function that imports it.)

**3. Build and deploy the site as usual.** `admin.html` comes out in `dist/`
next to `index.html` automatically; no separate Render service is needed.

## Using it

Visit `/admin.html`, enter the password. The refresh button beside the date
range re-pulls orders and notes on demand — nothing on this page polls for
new sales on its own, so this is how Courts checks whether one has come in
without switching tabs or reloading the page. It opens on **Dashboard** — revenue,
paid/pending order counts and average order value for a chosen range (today,
7/30/90 days or all time), each compared against the equal-length period
right before it — today's own comparison is against yesterday, and the
revenue chart buckets by hour instead of by day when "Today" is picked
("All time" skips the comparison entirely — there's no "before all time");
a bar chart of revenue over that range; a breakdown of revenue by module (an
order's own item snapshot only knows a product's id, so this looks each one
up in the Notes list currently loaded — a since-deleted note's sales land in
"Other" rather than vanishing); a Recent Orders glance (customer names
trimmed to initials — the full name is one click away on Orders, this is
just a lighter-weight summary, not a real access restriction); and the
best-selling notes in the chosen range. All of it is computed in the browser
from the same order and product data the Orders/Notes tabs already load
(`src/admin/dashboard.js`) — no separate endpoint or query, so it's never
out of sync and adds no load on Supabase beyond what already happens today.

**Orders** shows every order, newest first — expand a row to see which
sections were bought. **Notes** lists every product, including inactive
ones; **Add note** or a row's
**Edit** opens the same form. Attaching a PDF there uploads it to the
`notes` bucket under `<module_slug>/<code>.pdf` and sets `file_path`
automatically. Editing a note that already has one shows a **View current
PDF** link — since the `notes` bucket is private, this asks `admin-products`
for a short-lived signed URL (same mechanism `order-download` uses for
buyers) rather than linking to it directly.

**Discounts** lists every code with its % off. Add one with the form at the
top — codes are stored upper-case, 3-32 letters/numbers/`-`/`_`, and a buyer
can type them in any case. There's no edit: delete a code and add it again.
Deleting one stops new orders using it; orders that already did keep their
own copy of the code and % (the Orders tab shows it under the total).

Bundle discounts need no code and apply automatically — 5+ notes in a
cart is 10% off, 10+ is 15%. They don't stack with a code: the buyer gets
whichever % is higher. An order that got the bundle shows "Bundle · 10% off"
under its total on the Orders tab. The tiers live in `price_order()` in
`supabase/schema.sql` (what's charged) and `BUNDLE_TIERS` in `src/render.js`
(what the cart shows) — change both together.

A
100% code isn't allowed — a R0 order has nothing for Paystack to charge, so
it could never be marked paid. The % itself is only ever applied by the
database when the order is saved (see section 8 of `supabase/schema.sql`),
never trusted from the browser.

Deleting a note asks for confirmation first and can't be undone — it removes
the database row, not the underlying PDF in storage.

Orders can be deleted the same way, from a **Delete** button on each row —
also confirmed first, also permanent. Deleting a paid order doesn't refund
the buyer or touch Paystack; the confirm text says so, since it's a real
financial record disappearing, not just tidying up a stray row.

The header shows a live count of browser tabs with the site open right now
(polled every 15s) — see the "LIVE VISITOR COUNT" section of
`supabase/schema.sql` and `src/presence.js` for how it's tracked.

## Not done here

- **No audit log.** Anyone with the password can do anything; there's no
  record of who changed what. Fine for one person, worth revisiting if that
  changes.
- **No rate limiting on `admin-login`.** A determined attacker could brute
  force the password over the network. Pick a long, random one.
- **Order status is still only changed by the Paystack webhook** (or by hand
  in the Supabase table editor) — the admin page can delete an order but has
  no way to edit one, on purpose, per the working decision when this was
  built.
