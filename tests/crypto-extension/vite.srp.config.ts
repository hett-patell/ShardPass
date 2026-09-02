import { crx } from "@crxjs/vite-plugin";
import path from "node:path";
import { defineConfig } from "vite";

import { enteSrpVitePlugin } from "../../tools/ente-srp-vite-plugin";
import manifest from "./manifest";

const root = path.resolve(import.meta.dirname, "../..");
const srpPlugin = () =>
  enteSrpVitePlugin({
    workspaceRoot: root,
    productionEntry: path.resolve(root, "tests/crypto-extension/ente-srp-worker.ts"),
    requireProductionEntry: false,
    requireGraph: false,
  });

export default defineConfig({
  root: "tests/crypto-extension",
  plugins: [srpPlugin(), crx({ manifest })],
  worker: { format: "es", plugins: () => [srpPlugin()] },
  build: {
    target: "chrome110",
    modulePreload: { polyfill: false },
    emptyOutDir: true,
    outDir: "../../.test-dist/ente-srp-extension",
    rollupOptions: {
      input: { enteSrpTest: "tests/crypto-extension/srp-index.html" },
    },
  },
});
