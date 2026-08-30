# CTA Notes by Courts

An online shop selling PGDA/CTA study notes as individual PDF sections — R25
each, across the four CTA modules.

Vanilla JS + Vite on the front, Supabase for the database, storage and (soon)
the PayFast webhook. No framework, no build complexity.

---

## Getting started

```bash
npm install
npm run dev
```

Opens on <http://localhost:5173>. It runs straight away using a local copy of the
catalogue, so you can work on the design before touching the database.

## Connect Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
   That creates the tables, RLS policies, the private `notes` storage bucket, and
   seeds all 28 sections at R25.
3. **Settings → API** → copy the Project URL and the `anon` public key.
4. Put them in `.env`:

   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbG...
   ```

5. Restart `npm run dev`.

Products now load from the database and checkout writes real rows to `orders`.

> The anon key is designed to be public. Row Level Security is what protects the
> data: anyone can read active products and create a pending order, and nothing
> else. Never put the `service_role` key in a `VITE_` variable.

## Upload the PDFs

- **Storage → notes** → upload each section's PDF.
- Suggested paths: `financial-reporting/FR1.pdf`, `taxation/TAX3.pdf`.
- **Table Editor → products** → set each row's `file_path` to that path.

Keep the bucket private. After payment you generate a short-lived signed URL and
email it, rather than handing out a permanent link.

## Day-to-day changes

Most things are database edits, not code:

| To do this | Go here |
|---|---|
| Add a section | Insert a row in `products` |
| Change a price | `price_cents` (2500 = R25) |
| Hide a section temporarily | `is_active = false` |
| Reorder the grid | `sort_order` |
| See who bought what | `orders` — email, items, total, status |

Module names, colours and icons live in the `MODULES` array in
`src/catalogue.js`, paired with the CSS variables at the top of `src/styles.css`.

## Project layout

```
index.html                 All markup, including the hero illustration
src/
  main.js                  Entry point, event wiring
  state.js                 Shared state + helpers
  catalogue.js             Modules and the fallback catalogue
  supabase.js              REST helpers
  cart.js                  Loading products, cart operations
  checkout.js              Order creation and email capture
  render.js                All DOM rendering
  styles.css               Design tokens and every style
supabase/
  schema.sql               Tables, RLS, storage bucket, seed data
  functions/               PayFast Edge Function stubs
docs/payfast.md            Full PayFast integration guide
docs/deploy-render.md      Deploying to Render, step by step
render.yaml                Render Blueprint (build settings, headers, env vars)
public/                    favicon, hero image
CLAUDE.md                  Context for the Claude Code extension
```

## Deploying

The build is plain static files, so any static host works.

```bash
npm run build      # outputs dist/
```

**Render** is the recommended option — free static hosting, CDN, automatic
HTTPS, no spin-down. `render.yaml` in this repo configures it, and
`docs/deploy-render.md` walks through the whole thing.

Short version: push to GitHub, then Render → New → Blueprint → connect the repo.
Build command `npm ci && npm run build`, publish directory `dist`.

**Netlify, Vercel or Cloudflare Pages** work the same way with those two
settings.

Whichever you use, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the
host's environment variables — `.env` is not committed. Vite bakes these in at
build time, so **redeploy after adding them** or the live site will silently run
on the demo catalogue.

## What's still to do

1. **PayFast** — order capture works; payment does not. `docs/payfast.md` has the
   full flow, and the two Edge Functions are stubbed out.
2. **Delivery emails** — signed download links after an order is marked paid.
3. **The PDFs** — bucket and columns exist, files not uploaded.
4. **Contact form** — currently shows a confirmation but sends nothing.
5. **Hero photo** — placeholder illustration, see `public/README-hero.md`.

## Using Claude Code

`CLAUDE.md` describes the stack, conventions, data model and the RLS rules Claude
should not "fix". Open the folder in VS Code, run `/init` if you want Claude to
re-scan, and it will pick that file up automatically.

Good first prompts:

- "Read docs/payfast.md and implement the payfast-initiate function properly."
- "Wire the contact form to a Supabase Edge Function using Resend."
- "Add a search box above the filter chips that filters sections by title."
