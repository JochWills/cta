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

One real npm dependency: `pdfjs-dist`, used only from `src/admin/` (see
`pdfPreview.js`) to render a PDF's first page to PNG at upload time. It is
not imported by anything the shop bundle touches — `npm run build`'s
`main-*.js` output should stay a few KB; if it balloons, something pulled
pdfjs-dist into the wrong entry point. `pdfPreview.js` runs pdf.js in its own
Web Worker via `pdfjsWorkerEntry.js` (built as a real worker chunk — see that
file's comment) rather than pointing straight at pdfjs-dist's own worker
bundle, so `mapUpsertPolyfill.js`'s fix for a Safari gap (Map/WeakMap lack
`getOrInsertComputed`, which pdfjs-dist 6.x calls with no fallback) can run
inside the worker's own global scope, not just the main thread.

`pdfPreview.js` also runs every PDF through `fixSymbolicFontEncoding.js`
before handing it to pdf.js — a real pdf.js bug silently swaps some letters
for the wrong glyph in a PDF from at least one real-world producer (a
Symbolic TrueType font with no `/Encoding`, e.g. LibreOffice's own
subsetting output), consistently and regardless of browser. See that
file's own comment for the full diagnosis; it's a no-op for any PDF that
isn't built that way.

## Layout

```
index.html                  All markup, including the hero SVG illustration
admin.html                  Second page: password-gated order view + note CRUD
terms.html                  Terms and conditions — static content, no JS module
                             (served at /terms — see render.yaml's rewrite routes)
privacy.html                Privacy policy — same, linked from terms.html and the footer
                             (served at /privacy, same rewrite)
review.html                 "Leave a review" form, a link Courts sends to buyers
                             (served at /review) — script in src/review-page.js
src/
  main.js                   Entry point: delegated event handlers, init
  state.js                  Shared state object + rands/esc/$/isEmail helpers
  catalogue.js              MODULES (colours, icons, labels) + SEED fallback catalogue
  supabase.js               Env config, sbGet/sbInsert/sbFunction/sbRpc
  cart.js                   loadProducts, addToCart, removeFromCart
  checkout.js               placeOrder — writes the order, then hands off to Paystack
  freebies.js               The free-download modal (name + email -> PDF) for
                             notes in the Freebies module, see Data model
  downloads.js               openDownloadModal/submitDownloadRequest — the "get your
                             notes" self-serve lookup, see Data model/Current state
  reviews.js                Homepage Student feedback section: loads published
                             reviews (the cards in index.html are only a fallback)
                             and adds "Read more" to long ones
  presence.js               startPresence — anonymous heartbeat behind the admin
                             page's live visitor count and visitor sources, plus
                             track() for the funnel steps, see Data model below
  render.js                 All DOM rendering + toast/drawer/filter helpers
  styles.css                Everything, token-first, one file
  admin/                    Admin page's own state/api/render/main split + admin.css
                             (pdfPreview.js renders page 1 of an upload to PNG;
                             dashboard.js computes and renders the Dashboard tab —
                             stat tiles with period-over-period % change, a
                             revenue chart, a sales-by-module donut, Recent
                             Orders and Top Selling Notes — entirely client-side
                             from the orders/products the Orders/Notes tabs
                             already load)
supabase/
  schema.sql                Tables, RLS policies, both storage buckets, 28 seed rows
  functions/
    _shared/admin.ts        Token auth + CORS shared by the seven admin-* functions
    admin-login/             ┐
    admin-orders/             } deployed — see docs/admin.md
    admin-products/           │
    admin-upload/            │
    admin-discounts/         │
    admin-reviews/           │
    admin-live/              ┘ who's online right now, see Data model's site_sessions
    paystack-initiate/        ┐ deployed — see docs/paystack.md
    paystack-webhook/         ┘
    order-download/          deployed — self-serve download links, see Data model below
    free-download/           freebie PDFs for a name + email, see Data model below
render.yaml                 Render Blueprint — build settings, cache headers, URL rewrites
public/                     favicon, hero.png (the hero photo)
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
  `sessionStorage` instead, on purpose, unless the login form's "Keep me
  signed in" box is ticked (then `localStorage`, 30-day token) — see its own
  comment in `src/admin/state.js`.
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
`state.js`, never stored — see that function's comment), `page_count`
(pages in the PDF, shown on the shop card and preview — read by the admin
page at upload; any still missing are filled in by `backfillPageCounts` in
`src/admin/main.js` whenever the admin page loads), `is_active`,
`sort_order`, `created_at` (also drives the shop's "New" badge — shown for
24 hours after a note is added, see `renderProducts` in `src/render.js`).

`orders` — `reference` (CTA-XXXXXX, also used as the Paystack transaction
reference), `email`, `full_name`, `items` (jsonb snapshot of the cart at
purchase time — `product_id`/`code`/`title`/`price_cents`, no `file_path`;
`order-download` looks that up live from `products` by `product_id`),
`total_cents`, `status` (`pending` | `paid` | `failed` | `refunded` | `free`),
`payment_ref` (Paystack's transaction id), `paid_at`, `terms_accepted_at`
(not null — checkout won't submit without the "this purchase is final"
checkbox ticked, and the column backs that with an actual record, not just
a client-side gate), `discount_code`/`discount_percent` (null unless a code
was used — a snapshot, so deleting the code later changes nothing here).

**Orders are priced by the database, not the browser.** A `before insert`
trigger, `price_order()` (`supabase/schema.sql` section 8), rebuilds
`items` from the live `products` rows (by `product_id`, active only) and
overwrites `total_cents` = subtotal minus one discount %: a bundle discount
(5+ notes 10%, 10+ notes 15% — the cart mirrors these in `render.js`'s
`BUNDLE_TIERS` for display) or a discount code's %, whichever is higher.
They never stack; `discount_code` is only kept when the code won, so
`discount_percent` set with `discount_code` null means a bundle. Whatever
the browser sent for prices or the total is ignored — before this existed,
anyone could insert an order for every note at R1 and pay R1. Don't move
pricing back into `checkout.js`; its `total_cents` is a placeholder.

**Freebies.** A fifth `modules` row, `freebies`, not a PGDA module: always
R0 (`products_free_price` check), no preview images, never in the cart
(`isFreebie` in `catalogue.js`), and the file can be a PDF or an Excel
sheet (`admin-upload` only takes Excel under `freebies/`). The shop's download button asks for a
name + email and calls `free-download`, which writes an order with status
`free` (total 0, reference `FREE-XXXXXX`) and returns a signed link. Those
rows show on the admin Orders list, but every dashboard stat and
`notes_sold()` count `paid` only, so they never inflate sales. Only the
service_role can write a `free` row, and `price_order()` won't let one
hold a paid note, or a paid order hold a freebie.

`discount_codes` — `code` (upper-case, 3-32 of A-Z/0-9/`-`/`_`, unique),
`percent_off` (1-99 — a 100% order would be R0, which Paystack can't
charge). RLS on, no policies: the shop checks one code at a time through
the `discount_percent(code)` security definer function (returns the % or
null, so the list itself isn't readable with the anon key), and the admin
page manages codes through `admin-discounts`.

**Delivery.** There's no email hosting set up on the domain yet, so `order-download`
(called from `src/downloads.js`) is delivery: given a `reference` + matching
`email`, it returns 24-hour signed URLs for each item's `file_path`. The
shop calls it automatically when a buyer lands back on `/?paid=1&ref=...`
from Paystack (email comes from `localStorage`'s `cta_last_email`, saved by
`checkout.js` right before the redirect), and it's reachable any other time
via the "Already paid? Get your notes" footer link. See that function's own
comment for why it always responds `200 { ok, reason }` rather than
404/403.

**Thank-you email.** `paystack-webhook` also sends one email through Resend
when it first flips an order to paid: thanks, the titles bought, and a "Get
your notes" button linking to `/?paid=1&ref=...&email=...` — the same
download-window handling as above, with the email in the link so it works on
any device. Skipped entirely while the `RESEND_API_KEY` secret is unset;
`EMAIL_FROM` and `EMAIL_REPLY_TO` secrets are optional. Sending from
`@pgdanotes.co.za` needs that domain verified in Resend (DNS at GoDaddy).

`modules` — the four module rows. Currently the frontend uses the hardcoded
`MODULES` array for presentation and only reads `products` from the database.

`site_sessions` — one row per open browser tab, keyed by a random id made up
client-side (`src/presence.js`), heartbeat-updated every ~20s. Backs the
admin page's live visitor count. No RLS policies at all on the table itself
— both reads and writes go through `security definer` functions (see below)
that anon can call directly, so the raw table (and its session ids/
timestamps) is never itself queryable. `heartbeat` also prunes rows older
than a day, so the table doesn't grow forever. Each heartbeat also carries what the tab
is doing (`activity`, e.g. "Shop" or "Previewing: VAT", read off the page
by `currentActivity` in `presence.js`) and its cart size; `live_visitors()`
(schema.sql section 12) turns that into the admin header's "online"
pop-up. That function is service_role-only, reached through `admin-live`,
so the anon key can count visitors but not browse them. "Online" means
looking at the site right now: a tab only heartbeats while visible, calls
`leave_site` the moment it's hidden or closed (a keepalive request, so it
survives the page closing), and bots/headless browsers never heartbeat at
all (`isBot` in `presence.js`), so they're out of every visitor stat too. Clicking a visitor in the pop-up
opens their `details` (browser/OS, screen, time-zone region, utm campaign,
cart contents and total, notes previewed, filter, idle, and a visit count
kept only in their own localStorage, `cta_visits`) and `trail` (this
visit's path) — schema.sql section 13.

`daily_visits` — one row per session id per calendar day (not per
heartbeat), written by the same `heartbeat` call as `site_sessions` above
but never pruned, since `site_sessions` only ever holds roughly the last
day. Backs the admin page's "Daily visitors" chart (`daily_visitor_counts()`
— see `supabase/schema.sql`'s "LIVE VISITOR COUNT + DAILY VISITORS"
section), which needs real history `site_sessions` can't provide. Its `source`
(a label like `Google`/`Instagram`/`Direct`, worked out by `sourceLabel`
in `presence.js` from utm_source/click ids, the in-app browser's user
agent, then the referrer) and `device` columns, plus `site_events`
(`preview`/`cart`/`checkout`, once per session per day, written by
`track()`, timestamped for the journey card's "last activity" badges), back the dashboard's "Where visitors come from" and
"Visitor journey" cards via `visitor_insights(p_days)` — section 11 of
`schema.sql`. Sessions from before that existed have a null source and
are left out.

`reviews` — `name` (null = "Anonymous student"), `body`, `rating` (1-5;
nullable, though every review has one now), `is_published`,
`created_at`. Anyone with the `/review` link can submit — not checked
against an order, by choice — but a submission always lands unpublished:
the anon key's column grant only covers `name`/`body`/`rating`, and it can
only read rows where `is_published` is true. Publishing, unpublishing and
deleting go through `admin-reviews` (the admin page's Reviews tab).

### RLS — read this before changing any query

- Anyone may `select` active products.
- Anyone may `insert` an order, but only with `status = 'pending'` — and
  `price_order()` re-prices it on the way in (see Data model above).
- Anyone may `insert` a review (name/body/rating only) and `select`
  published ones — nothing else.
- Nobody with the anon key can read `discount_codes` — only check one code
  via `discount_percent()`.
- **Nobody with the anon key can read, update or delete orders.** That is
  deliberate. Order reads/writes happen server-side with the service_role key
  inside an Edge Function (`paystack-webhook` for marking paid, `admin-orders`
  for the admin page's list + delete, `order-download` for a buyer looking up
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
notes including PDF upload (`docs/admin.md`), a live visitor count on
the admin page (`site_sessions`, see Data model above), and % discount codes
(entered at checkout, managed on the admin page's Discounts tab, applied by
the database — see Data model above), plus automatic bundle discounts
(5+ notes 10%, 10+ notes 15%, not stacked with a code), and reviews
(submitted at `/review`, published from the admin page's Reviews tab —
see Data model above).

Not done:
1. **Thank-you email live** — the code is deployed (see Data model above);
   it starts sending once Resend is set up and `RESEND_API_KEY` is set.
2. **The catalogue itself** — the live database has one real product in it
   (added through the admin page, PDF + preview working end-to-end). The
   other ~27 sections from `SEED`/`schema.sql` exist as local demo/seed data
   only — they still need to be added for real, through `/admin.html`, one
   at a time, before this reflects "all four PGDA modules" for a real buyer.

A PDF is now required to add a note in the admin page, and it generates the
`note-previews` image at the same time — so adding a section is one step,
not two.

## Working style

Small, reviewable changes. Explain what you changed and why in a sentence or two.
Ask before adding a dependency. When adding a section to the catalogue, add it to
`supabase/schema.sql` and to `SEED` in `catalogue.js` so both stay in sync.
