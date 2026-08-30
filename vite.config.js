import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173, open: true },
  build: {
    outDir: "dist",
    sourcemap: true,
    // Two pages: the shop and the admin dashboard. Vite's default build
    // only picks up index.html, so admin.html needs to be listed explicitly
    // or it never makes it into dist/.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        admin: fileURLToPath(new URL("./admin.html", import.meta.url)),
      },
    },
  },
});
