# CLAUDE.md

Context for Claude Code working in this repo.

## What this is

**CTA Notes by Courts** — a small South African e-commerce site selling PGDA/CTA
study notes as individual PDF sections, R25 each, grouped under four modules:

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

## Layout

```
index.html                  All markup, including the hero SVG illustration
src/
  main.js                   Entry point: delegated event handlers, init
  state.js                  Shared state object + rands/esc/$/isEmail helpers
  catalogue.js              MODULES (colours, icons, labels) + SEED fallback catalogue
  supabase.js               Env config, sbGet/sbInsert/sbFunction
  cart.js                   loadProducts, addToCart, removeFromCart
  checkout.js               placeOrder — writes the order, captures the email
  render.js                 All DOM rendering + toast/drawer/filter helpers
  styles.css                Everything, token-first, one file
supabase/
  schema.sql                Tables, RLS policies, storage bucket, 28 seed rows
  functions/                Edge Function stubs for PayFast (not yet deployed)
render.yaml                 Render Blueprint — build settings, cache headers
public/                     favicon, and where hero.jpg goes
```

## Conventions that matter

- **Prices are integers in cents.** `price_cents: 2500` is R25. Never store rands
  as floats. Format with `rands()` from `state.js`.
- **`state` is mutated in place**, then a render function is called. There is no
  reactivity — if you change `state.cart`, call `syncCart()`.
- **Everything from the database goes through `esc()`** before hitting innerHTML.
- **No `localStorage`** anywhere. The cart is in memory and resets on reload;
  that is intentional for now.
- CSS custom properties at the top of `styles.css` are the single source of
  colour and spacing truth. Module tints (`--fr-tint`, `--tax-ink`, …) are paired
  with the `MODULES` array in `catalogue.js` — change both together.
- Card and section styles are written mobile-last: base styles are desktop,
  overrides live in the `@media (max-width: …)` blocks at the bottom of the file.
- Copy style: sentence case, plain verbs, South African English, no exclamation
  marks, no marketing filler. The voice is Courts talking to a classmate.

## Data model

`products` — one row per section. `code` (FR1), `title`, `description`,
`module_slug`, `price_cents`, `file_path` (path in the private `notes` storage
bucket), `is_active`, `sort_order`.

`orders` — `reference` (CTA-XXXXXX, also used as PayFast `m_payment_id`),
`email`, `full_name`, `items` (jsonb snapshot of the cart at purchase time),
`total_cents`, `status` (`pending` | `paid` | `failed` | `refunded`),
`payment_ref`, `paid_at`.

`modules` — the four module rows. Currently the frontend uses the hardcoded
`MODULES` array for presentation and only reads `products` from the database.

### RLS — read this before changing any query

- Anyone may `select` active products.
- Anyone may `insert` an order, but only with `status = 'pending'`.
- **Nobody with the anon key can read, update or delete orders.** That is
  deliberate. Order updates happen server-side with the service_role key inside
  an Edge Function. If a browser-side query to `orders` returns nothing, RLS is
  working as designed — do not "fix" it by loosening the policy.

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
- The `service_role` key, the PayFast merchant key and the PayFast passphrase
  must only ever exist as Supabase Edge Function secrets. If you find yourself
  writing one into `src/`, stop.

## Current state

Done: full front end, module filtering, cart drawer, two-step checkout, order +
email capture into Supabase, responsive down to 390px, keyboard focus states,
reduced-motion support.

Not done:
1. **PayFast** — stubs in `supabase/functions/payfast-initiate` and
   `payfast-notify`. See `docs/payfast.md` for the full flow.
2. **Delivery emails** — after an order is marked paid, generate signed URLs for
   each `file_path` and email them (Resend or Postmark).
3. **The PDFs themselves** — bucket exists, `file_path` is null on every row.
4. **Contact form** — currently shows a toast and clears; it sends nothing.
5. **Hero photo** — placeholder SVG illustration, see `public/README-hero.md`.

## Working style

Small, reviewable changes. Explain what you changed and why in a sentence or two.
Ask before adding a dependency. When adding a section to the catalogue, add it to
`supabase/schema.sql` and to `SEED` in `catalogue.js` so both stay in sync.
