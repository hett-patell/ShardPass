import { crx } from "@crxjs/vite-plugin";
import path from "node:path";
import { defineConfig } from "vite";

import manifest from "./apps/extension/src/manifest";
import { ENTE_SRP_PRODUCTION_ENTRY, enteSrpVitePlugin } from "./tools/ente-srp-vite-plugin";

const workspaceRoot = import.meta.dirname;

const outDir = process.env.SHARDPASS_OUT_DIR ?? "../../dist";

export default defineConfig({
  root: "apps/extension",
  plugins: [
    enteSrpVitePlugin({
      workspaceRoot,
      productionEntry: path.resolve(
        workspaceRoot,
        "apps/extension/src/background/ente/ente-srp-worker-entry.ts",
      ),
    }),
    crx({ manifest }),
  ],
  build: {
    target: "chrome110",
    modulePreload: { polyfill: false },
    emptyOutDir: true,
    outDir,
    rollupOptions: {
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "enteAuthWorkerEntry"
            ? "assets/ente-auth-worker-entry.js"
            : "assets/[name]-[hash].js",
      },
      input: {
        popup: "apps/extension/popup/index.html",
        vault: "apps/extension/vault/index.html",
        otpImportWorker: "apps/extension/src/vault/otp/import/otp-import-worker.ts",
        [ENTE_SRP_PRODUCTION_ENTRY]: "apps/extension/src/background/ente/ente-srp-worker-entry.ts",
        enteSodiumWorkerEntry: "apps/extension/src/background/ente/ente-sodium-worker-entry.ts",
        enteAuthWorkerEntry: "apps/extension/src/vault/ente/ente-auth-worker-entry.ts",
      },
    },
  },
});
