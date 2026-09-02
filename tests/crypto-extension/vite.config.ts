import { crx } from "@crxjs/vite-plugin";
import path from "node:path";
import { defineConfig } from "vite";

import manifest from "./manifest";

export default defineConfig({
  root: "tests/crypto-extension",
  plugins: [crx({ manifest })],
  resolve: {
    alias: [
      {
        find: /^@shardpass\/crypto$/,
        replacement: path.resolve(import.meta.dirname, "../../packages/crypto/src/index.ts"),
      },
    ],
  },
  worker: { format: "es" },
  build: {
    target: "chrome110",
    modulePreload: { polyfill: false },
    emptyOutDir: true,
    outDir: "../../.test-dist/crypto-extension",
    rollupOptions: {
      input: { cryptoTest: "tests/crypto-extension/index.html" },
    },
  },
});
