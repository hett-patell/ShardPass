import path from "node:path";
import { defineConfig } from "vite";

const root = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  root,
  appType: "mpa",
  optimizeDeps: {
    entries: ["tests/fixtures/sites/foundation.html"],
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    fs: { allow: [root] },
  },
});
