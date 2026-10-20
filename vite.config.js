import { fileURLToPath, URL } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { defineConfig, loadEnv } from "vite";

const SITE = "https://pgdanotes.co.za";

/**
 * One page per note, at /notes/<slug> — so Google can list each note on its
 * own, and a shared link shows that note's title, description and cover in
 * WhatsApp etc. After the build, this fetches the active notes (anon key,
 * same as the shop) and writes dist/notes/<slug>/index.html for each: a copy
 * of the built index.html with that note's <title>, description, canonical,
 * Open Graph tags and Product structured data swapped in. The page itself is
 * the normal shop — src/note-page.js sees the /notes/ path and shows the
 * note at the top. Also writes dist/sitemap.xml with every note in it.
 *
 * <slug> is slugifyCode(code) from src/state.js (code never changes, even
 * when the title is edited, so a note's address doesn't either). A note
 * added after the last deploy has no page until the next one — admin-products
 * triggers a Render deploy for that (RENDER_DEPLOY_HOOK). Never fails the
 * build: if the database can't be reached, the site just ships without them.
 */
const slugifyCode = (code) =>
  code.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const escAttr = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const MODULE_NAMES = {
  "financial-reporting": "Financial Reporting",
  "management-accounting-finance": "Management Accounting & Finance",
  taxation: "Taxation",
  "corporate-governance-auditing": "Corporate Governance & Auditing",
  freebies: "Free",
};
const moduleName = (slug) =>
  slug.startsWith("bridging-")
    ? `Bridging ${MODULE_NAMES[slug.slice(9)] || ""}`.trim()
    : MODULE_NAMES[slug] || "PGDA";

function notePages() {
  let env = {};
  return {
    name: "note-pages",
    apply: "build",
    configResolved(config) {
      env = loadEnv(config.mode, process.cwd(), "VITE_");
    },
    async closeBundle() {
      const url = env.VITE_SUPABASE_URL;
      const key = env.VITE_SUPABASE_ANON_KEY;
      if (!url || !key) return console.warn("[note-pages] no Supabase env — skipping note pages");

      let products;
      try {
        const res = await fetch(
          `${url}/rest/v1/products?select=code,title,description,module_slug,price_cents,preview_pages,page_count&is_active=eq.true&order=sort_order.asc`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        products = await res.json();
      } catch (err) {
        return console.warn(`[note-pages] couldn't load notes (${err.message}) — skipping note pages`);
      }

      const dist = fileURLToPath(new URL("./dist/", import.meta.url));
      const shell = await readFile(`${dist}index.html`, "utf8");
      const urls = [];

      for (const p of products) {
        const slug = slugifyCode(p.code);
        const pageUrl = `${SITE}/notes/${slug}`;
        const free = p.module_slug.endsWith("freebies");
        const mod = moduleName(p.module_slug);
        const title = `${p.title} — ${free ? "free" : mod} notes | PGDA Notes by Courts`;
        const desc =
          (p.description || `${p.title}: ${mod} notes for PGDA/CTA students.`).slice(0, 155) +
          (p.description?.length > 155 ? "…" : "");
        const image =
          p.preview_pages > 0
            ? `${url}/storage/v1/object/public/note-previews/${p.module_slug}/${slug}-p1.png`
            : `${SITE}/og-image.jpg`;
        const product = {
          "@context": "https://schema.org",
          "@type": "Product",
          name: p.title,
          description: p.description || undefined,
          image,
          category: mod,
          brand: { "@type": "Brand", name: "PGDA Notes by Courts" },
          url: pageUrl,
          offers: {
            "@type": "Offer",
            price: (p.price_cents / 100).toFixed(2),
            priceCurrency: "ZAR",
            availability: "https://schema.org/InStock",
            url: pageUrl,
          },
        };

        let html = shell
          .replace(/<title>[\s\S]*?<\/title>/, `<title>${escAttr(title)}</title>`)
          .replace(/(<meta name="description" content=")[^"]*/, `$1${escAttr(desc)}`)
          .replace(/(<link rel="canonical" href=")[^"]*/, `$1${pageUrl}`)
          .replace(/(<meta property="og:type" content=")[^"]*/, "$1product")
          .replace(/(<meta property="og:url" content=")[^"]*/, `$1${pageUrl}`)
          .replace(/(<meta (?:property="og|name="twitter):title" content=")[^"]*/g, `$1${escAttr(title)}`)
          .replace(/(<meta (?:property="og|name="twitter):description" content=")[^"]*/g, `$1${escAttr(desc)}`)
          .replace(/(<meta (?:property="og|name="twitter):image" content=")[^"]*/g, `$1${escAttr(image)}`)
          .replace(/(<meta (?:property="og|name="twitter):image:alt" content=")[^"]*/g, `$1${escAttr(p.title)}`)
          .replace(
            "</head>",
            `<script type="application/ld+json">${JSON.stringify(product).replace(/</g, "\\u003c")}</script>\n</head>`
          );
        // The cover isn't 1200x630, so drop the fixed size the homepage image declares.
        if (p.preview_pages > 0) html = html.replace(/<meta property="og:image:(?:width|height|type)"[^>]*>\n?/g, "");

        await mkdir(`${dist}notes/${slug}`, { recursive: true });
        await writeFile(`${dist}notes/${slug}/index.html`, html);
        urls.push(pageUrl);
      }

      const today = new Date().toISOString().slice(0, 10);
      const entry = (loc, freq, priority) =>
        `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
      const sitemap = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        entry(`${SITE}/`, "weekly", "1.0"),
        ...urls.map((u) => entry(u, "weekly", "0.8")),
        entry(`${SITE}/terms`, "monthly", "0.3"),
        entry(`${SITE}/privacy`, "monthly", "0.3"),
        "</urlset>",
        "",
      ].join("\n");
      await writeFile(`${dist}sitemap.xml`, sitemap);
      console.log(`[note-pages] wrote ${urls.length} note pages and sitemap.xml`);
    },
  };
}

export default defineConfig({
  server: { port: 5173, open: true },
  plugins: [notePages()],
  build: {
    outDir: "dist",
    sourcemap: true,
    // Five pages: the shop, the admin dashboard, the terms/privacy
    // pages, and the /review form. Vite's default build only picks up index.html, so every other
    // page needs to be listed explicitly or it never makes it into dist/.
    // (Plus one generated page per note — see notePages above.)
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        admin: fileURLToPath(new URL("./admin.html", import.meta.url)),
        terms: fileURLToPath(new URL("./terms.html", import.meta.url)),
        privacy: fileURLToPath(new URL("./privacy.html", import.meta.url)),
        review: fileURLToPath(new URL("./review.html", import.meta.url)),
      },
    },
  },
});
