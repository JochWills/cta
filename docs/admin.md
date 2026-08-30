# Admin page

`admin.html` (built alongside `index.html` — see `vite.config.js`) is a
second, unlinked page at `/admin.html` on the same Render site. It lets
Courts:

- **See every order** — reference, buyer, items, total, status — read-only.
- **Add, edit and delete notes** — code, title, description, module, price,
  active flag, sort order — and upload the PDF for each one straight into
  the private `notes` storage bucket.

It exists because the anon key the shop ships to browsers deliberately
cannot do any of that (see `supabase/schema.sql` and the RLS section of
`CLAUDE.md`), so the admin page talks to four small Supabase Edge Functions
that use the `service_role` key on the server instead. `admin.html` itself
never sees that key.

## How the login works

There's one shared password, not a per-user account — this is a one-person
shop. `admin-login` checks it against the `ADMIN_PASSWORD` secret and, on a
match, issues a signed token good for 12 hours. The admin page sends that
token back as `X-Admin-Token` on every call to `admin-orders`,
`admin-products` and `admin-upload`, which each verify it before touching
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

`SITE_URL` should already be set from the PayFast setup (`docs/payfast.md`)
— the admin functions reuse it to restrict CORS to your real site. If it
isn't set yet:

```bash
supabase secrets set SITE_URL=https://ctanotes.co.za
```

**2. Deploy the four functions:**

```bash
supabase functions deploy admin-login
supabase functions deploy admin-orders
supabase functions deploy admin-products
supabase functions deploy admin-upload
```

(`_shared/admin.ts` isn't deployed on its own — the CLI bundles it into
each function that imports it.)

**3. Build and deploy the site as usual.** `admin.html` comes out in `dist/`
next to `index.html` automatically; no separate Render service is needed.

## Using it

Visit `/admin.html`, enter the password. **Orders** shows every order,
newest first — expand a row to see which sections were bought. **Notes**
lists every product, including inactive ones; **Add note** or a row's
**Edit** opens the same form. Attaching a PDF there uploads it to the
`notes` bucket under `<module_slug>/<code>.pdf` and sets `file_path`
automatically — that's the one field customers never see but the eventual
delivery email will need (`docs/payfast.md`, "not done" item 2 in
`CLAUDE.md`).

Deleting a note asks for confirmation first and can't be undone — it removes
the database row, not the underlying PDF in storage.

## Not done here

- **No audit log.** Anyone with the password can do anything; there's no
  record of who changed what. Fine for one person, worth revisiting if that
  changes.
- **No rate limiting on `admin-login`.** A determined attacker could brute
  force the password over the network. Pick a long, random one.
- **Order status is still only changed by the PayFast webhook** (or by hand
  in the Supabase table editor) — the admin page is read-only for orders on
  purpose, per the working decision when this was built.
