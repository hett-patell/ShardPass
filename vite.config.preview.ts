import { defineConfig } from "vite";

// Visual preview of the popup and vault page against a scripted platform (test/preview).
export default defineConfig({
  root: "apps/extension/test/preview",
  base: "./",
  build: {
    target: "chrome110",
    outDir: "/tmp/shardpass-preview",
    emptyOutDir: true,
    rollupOptions: { input: { popup: "apps/extension/test/preview/popup.html", vault: "apps/extension/test/preview/vault.html" } },
  },
});
