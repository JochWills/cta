import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173, open: true },
  build: {
    outDir: "dist",
    sourcemap: true,
    // Four pages: the shop, the admin dashboard, and the terms/privacy
    // pages. Vite's default build only picks up index.html, so every other
    // page needs to be listed explicitly or it never makes it into dist/.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        admin: fileURLToPath(new URL("./admin.html", import.meta.url)),
        terms: fileURLToPath(new URL("./terms.html", import.meta.url)),
        privacy: fileURLToPath(new URL("./privacy.html", import.meta.url)),
      },
    },
  },
});
