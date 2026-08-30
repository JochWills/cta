# CLAUDE.md

Context for Claude Code working in this repo.

## What this is

**CTA Notes by Courts** — a small South African e-commerce site selling PGDA/CTA
study notes as individual PDF sections, priced per section (not a fixed price —
see each product's `price_cents`), grouped under four modules:

| Module | Slug | Sections |
|---|---|---|
| Financial Reporting | `financial-reporting` | FR1–FR8 |
| Management Accounting & Finance | `management-accounting-finance` | MA1–MA7 |
| Taxation | `taxation` | TAX1–TAX7 |
| Corporate Governance & Auditing | `corporate-governance-auditing` | CGA1–CGA6 |

Audience: SAICA PGDA/CTA students in South Africa. Single-seller shop run by one
person (Courts), not a marketplace.

## Commands

```bash
npm install     # first time only
npm run dev     # Vite dev server on http://localhost:5173
npm run build   # production build into dist/
npm run preview # serve the built output
```

There are no tests and no linter beyond Prettier. Verify changes by running
`npm run dev` and clicking through: filter a module, add two sections, open the
cart, remove one, go to checkout, submit a bad email, then a good one.

## Stack

Deliberately minimal — vanilla JS ES modules, plain CSS, Vite for the dev server
and bundling. **No framework, no CSS library, no state management library.**
Do not introduce React, Tailwind, TypeScript or a component library without
being asked; the whole point of this codebase is that one person can maintain it.

Supabase is the only backend. It is called over its PostgREST endpoint with
`fetch` rather than `@supabase/supabase-js`, because the shop only ever reads
products and inserts orders.

One real npm dependency: `pdfjs-dist`, used only from `src/admin/pdfPreview.js`
to render a PDF's first page to PNG at upload time. It is not imported by
anything the shop bundle touches — `npm run build`'s `main-*.js` output should
stay a few KB; if it balloons, something pulled pdfjs-dist into the wrong
entry point.

## Layout

```
index.html                  All markup, including the hero SVG illustration
admin.html                  Second page: password-gated order view + note CRUD
terms.html                  Terms and conditions — static content, no JS module
privacy.html                Privacy policy — same, linked from terms.html and the footer
src/
  main.js                   Entry point: delegated event handlers, init
  state.js                  Shared state object + rands/esc/$/isEmail helpers
  catalogue.js              MODULES (colours, icons, labels) + SEED fallback catalogue
  supabase.js               Env config, sbGet/sbInsert/sbFunction
  cart.js                   loadProducts, addToCart, removeFromCart
  checkout.js               placeOrder — writes the order, then hands off to Paystack
  downloads.js               openDownloadModal/submitDownloadRequest — the "get your
                             notes" self-serve lookup, see Data model/Current state
  render.js                 All DOM rendering + toast/drawer/filter helpers
  styles.css                Everything, token-first, one file
  admin/                    Admin page's own state/api/render/main split + admin.css
                             (pdfPreview.js renders page 1 of an upload to PNG)
supabase/
  schema.sql                Tables, RLS policies, both storage buckets, 28 seed rows
  functions/
    _shared/admin.ts        Token auth + CORS shared by the four admin-* functions
    admin-login/             ┐
    admin-orders/             } deployed — see docs/admin.md
    admin-products/           │
    admin-upload/            ┘
    paystack-initiate/        ┐ deployed — see docs/paystack.md
    paystack-webhook/         ┘
    order-download/          deployed — self-serve download links, see Data model below
render.yaml                 Render Blueprint — build settings, cache headers
public/                     favicon, and where hero.jpg goes
```

## Conventions that matter

- **Prices are integers in cents.** `price_cents: 2500` is R25. Never store rands
  as floats. Format with `rands()` from `state.js`.
- **`state` is mutated in place**, then a render function is called. There is no
  reactivity — if you change `state.cart`, call `syncCart()` (or, if you're
  bypassing that, at least `saveCart()` — see below).
- **Everything from the database goes through `esc()`** before hitting innerHTML.
- **The cart persists to `localStorage`** (`cart.js`'s `loadCart`/`saveCart`,
  key `cta_cart`) so a refresh doesn't lose it. This used to be deliberately
  in-memory-only; that changed. `loadCart()` runs once at startup in
  `main.js`, before the first render. The admin page's session token uses
  `sessionStorage` instead, on purpose — see its own comment in
  `src/admin/state.js` for why that one stays separate.
- CSS custom properties at the top of `styles.css` are the single source of
  colour and spacing truth. Module tints (`--fr-tint`, `--tax-ink`, …) are paired
  with the `MODULES` array in `catalogue.js` — change both together.
- Card and section styles are written mobile-last: base styles are desktop,
  overrides live in the `@media (max-width: …)` blocks at the bottom of the file.
- Copy style: sentence case, plain verbs, South African English, no exclamation
  marks, no marketing filler. The voice is Courts talking to a classmate.

## Data model

`products` — one row per section. `code` (server-generated, not shown or
editable in the admin UI — see `admin-products`), `title`, `description`,
`module_slug`, `price_cents`, `file_path` (path in the private `notes`
storage bucket), `preview_pages` (0-3 — how many page-preview images exist
in the public `note-previews` bucket, generated by the admin page from the
PDF's first pages and shown on the shop with the last one blurred; paths
are derived from `module_slug`/`code`/page number via `slugifyCode` in
`state.js`, never stored — see that function's comment), `is_active`,
`sort_order`.

`orders` — `reference` (CTA-XXXXXX, also used as the Paystack transaction
reference), `email`, `full_name`, `items` (jsonb snapshot of the cart at
purchase time — `product_id`/`code`/`title`/`price_cents`, no `file_path`;
`order-download` looks that up live from `products` by `product_id`),
`total_cents`, `status` (`pending` | `paid` | `failed` | `refunded`),
`payment_ref` (Paystack's transaction id), `paid_at`, `terms_accepted_at`
(not null — checkout won't submit without the "this purchase is final"
checkbox ticked, and the column backs that with an actual record, not just
a client-side gate).

**Delivery.** There's no email hosting set up on the domain yet, so `order-download`
(called from `src/downloads.js`) is delivery: given a `reference` + matching
`email`, it returns 24-hour signed URLs for each item's `file_path`. The
shop calls it automatically when a buyer lands back on `/?paid=1&ref=...`
from Paystack (email comes from `localStorage`'s `cta_last_email`, saved by
`checkout.js` right before the redirect), and it's reachable any other time
via the "Already paid? Get your notes" footer link. See that function's own
comment for why it always responds `200 { ok, reason }` rather than
404/403.

`modules` — the four module rows. Currently the frontend uses the hardcoded
`MODULES` array for presentation and only reads `products` from the database.

### RLS — read this before changing any query

- Anyone may `select` active products.
- Anyone may `insert` an order, but only with `status = 'pending'`.
- **Nobody with the anon key can read, update or delete orders.** That is
  deliberate. Order reads/updates happen server-side with the service_role key
  inside an Edge Function (`paystack-webhook` for marking paid, `admin-orders`
  for the admin page's read-only view, `order-download` for a buyer looking up
  their own order by reference + email — see Data model below). If a
  browser-side query to `orders` returns nothing, RLS is working as designed —
  do not "fix" it by loosening the policy.

## Running without a database

If `.env` has no Supabase values, `hasDB` is false and the shop renders the
`SEED` catalogue from `catalogue.js` and fakes the order confirmation. This keeps
the site clickable for design work. `SEED` mirrors the seed rows in
`supabase/schema.sql` — if you change one, change the other.

## Hosting

Deployed to Render as a Static Site (free tier), configured by `render.yaml`.
Supabase Edge Functions deploy separately to Supabase — Render serves static
files only and cannot run server code. See `docs/deploy-render.md`.

`VITE_` variables are read at build time, not runtime, so any change to them
needs a redeploy to take effect.

## Secrets

- `VITE_`-prefixed variables are **bundled into the public JavaScript**. Only the
  Supabase URL and anon key belong there.
- The `service_role` key, the Paystack secret key, `ADMIN_PASSWORD` and
  `ADMIN_SESSION_SECRET` must only ever exist as Supabase Edge Function
  secrets. If you find yourself writing one into `src/`, stop.

## Current state

Done: full front end, module filtering, cart drawer, two-step checkout, order +
email capture into Supabase, responsive down to 390px, keyboard focus states,
reduced-motion support, Paystack checkout (`docs/paystack.md`), self-serve PDF
delivery with no email required (`order-download`, see Data model above), and a
password-gated admin page at `/admin.html` for viewing orders and managing
notes including PDF upload (`docs/admin.md`).

Not done:
1. **Delivery email** — email hosting on `pgdanotes.co.za` (or a verified
   sending domain with Resend/Postmark) would let `order-download`'s links
   also go out by email as a backup copy; not required for delivery to work,
   since the download modal already handles that without one.
2. **Contact form** — currently shows a toast and clears; it sends nothing.
3. **Hero photo** — placeholder SVG illustration, see `public/README-hero.md`.

A PDF is now required to add a note in the admin page (it generates the
`note-previews` image at the same time), so the old "PDFs not uploaded yet"
gap only remains for whichever of the 28 seed rows haven't been given one
through the admin page yet.

## Working style

Small, reviewable changes. Explain what you changed and why in a sentence or two.
Ask before adding a dependency. When adding a section to the catalogue, add it to
`supabase/schema.sql` and to `SEED` in `catalogue.js` so both stay in sync.
