# Deploying to Render

The shop builds to plain static files, so it runs on Render's **Static Site**
service. That tier is free, includes a CDN, automatic HTTPS and custom domains,
and only starts costing anything past 100 GB of bandwidth a month — which a
notes shop will not come close to.

Static sites don't spin down the way Render's free web services do. There's no
cold start.

---

## 1. Push the repo to GitHub

Render deploys from Git, so the code needs to be on GitHub or GitLab first.

```bash
cd cta-notes
git init
git add .
git commit -m "CTA Notes shop"
git branch -M main
git remote add origin https://github.com/<your-username>/cta-notes.git
git push -u origin main
```

`.env` is in `.gitignore`, so your Supabase keys don't go up with it. That's
intentional — they get set on Render instead, in step 3.

A private repo is fine; Render can read private repos once you authorise it.

## 2. Create the site

**Option A — Blueprint (uses the `render.yaml` in this repo)**

1. Render Dashboard → **New** → **Blueprint**
2. Connect the repo
3. Render reads `render.yaml` and prompts for the two Supabase values
4. **Apply**

Build settings, caching headers and the Node version all come from the file, so
there's nothing to fill in.

**Option B — by hand**

1. Render Dashboard → **New** → **Static Site**
2. Connect the repo, branch `main`
3. Fill in:

   | Field | Value |
   |---|---|
   | Build command | `npm ci && npm run build` |
   | Publish directory | `dist` |

4. **Create Static Site**

## 3. Add the environment variables

**Settings → Environment**, add:

```
VITE_SUPABASE_URL        https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY   eyJhbG...
```

> **This is the one that catches people.** Vite reads `VITE_` variables at
> *build* time and bakes the values into the JavaScript bundle. They are not
> read when a visitor loads the page. So if you deploy first and add the
> variables afterwards, the live site keeps running on the already-built bundle
> — which has no Supabase credentials and quietly falls back to the local
> catalogue. Every order would be a demo order that saves nothing.
>
> After adding or changing either variable, trigger **Manual Deploy → Deploy
> latest commit**. Then load the site and add something to the cart: if the
> confirmation panel says "demo — Supabase not connected", the variables didn't
> make it into the build.

If the build fails on a Node version error, add `NODE_VERSION` with a value like
`20.11.1` (the blueprint already does this).

## 4. Check it

Your site is live at `https://cta-notes.onrender.com` (or whatever name you
chose). Work through:

- [ ] All 28 sections load and the module filters work
- [ ] Adding to cart, removing, and the running total
- [ ] Checkout with a bad email is rejected
- [ ] Checkout with a real email shows a reference **without** "demo" in it
- [ ] The order appears in Supabase → Table Editor → `orders`

That last one is the real test — it proves the environment variables took.

## 5. Custom domain

This shop's live domain is `pgdanotes.co.za`, bought on GoDaddy — apex is
canonical, `www.pgdanotes.co.za` redirects to it.

1. Render → your site → **Settings → Custom Domains** → **Add Custom Domain**
2. Add both `pgdanotes.co.za` and `www.pgdanotes.co.za`; set the apex as the
   primary domain (Render redirects the other one to it).
3. Render shows the exact DNS records to add — copy those values rather than
   guessing, they can change. Typically an `A` record (or `ALIAS`/`ANAME`,
   which GoDaddy doesn't offer — use the `A` record Render gives instead) for
   the apex, and a `CNAME` for `www` pointing at the site's `onrender.com`
   hostname.
4. At GoDaddy: **My Products → DNS** for the domain → add those records,
   removing GoDaddy's default parking `A` record/forwarding for `@` first if
   one's there, since it'll conflict.
5. Wait for DNS to propagate (usually minutes, can take longer). Render
   issues a Let's Encrypt certificate automatically once it sees the records
   and redirects HTTP to HTTPS.
6. Once it's live, update `SITE_URL` (see below) and re-test a full checkout
   on the new domain — Paystack's CORS check and callback URL both depend on
   it matching exactly.

## Ongoing deploys

Every push to `main` rebuilds and redeploys automatically. Pull requests get
their own preview URL, which is useful for trying a design change before it goes
live.

Note that content changes — new sections, price changes, hiding a section — are
database edits in Supabase and appear immediately. They don't need a deploy.
Only code and styling changes do.

## Paystack and the admin page

Two things to remember, since both live partly on Supabase:

1. Set the `SITE_URL` Edge Function secret to your live URL, so Paystack's
   callback and the admin page's CORS check both point at the right place:

   ```bash
   supabase secrets set SITE_URL=https://pgdanotes.co.za
   ```

   No trailing slash — a trailing slash here caused a real CORS bug once
   (browsers never send one in the `Origin` header, so it stopped matching).

2. The Edge Functions (`paystack-initiate`, `paystack-webhook`, and the four
   `admin-*` ones) deploy to **Supabase**, not to Render. Render only ever
   serves static files here, so there's no server on this side for Paystack to
   call back to. That split is deliberate: it keeps the hosting free and keeps
   the secret key off the front end entirely.

See `docs/paystack.md` and `docs/admin.md` for the rest.
