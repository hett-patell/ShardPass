import { crx } from "@crxjs/vite-plugin";
import path from "node:path";
import { defineConfig, type Plugin, type UserConfig } from "vite";

import manifest from "./apps/extension/src/manifest";
import { ENTE_SRP_PRODUCTION_ENTRY, enteSrpVitePlugin } from "./tools/ente-srp-vite-plugin";
import { passkeyPagePlugin } from "./tools/passkey-page-plugin";

const workspaceRoot = import.meta.dirname;

const outDir = process.env.SHARDPASS_OUT_DIR ?? "../../dist";

function stripCrossOrigin(): Plugin {
  return {
    name: "strip-crossorigin",
    enforce: "post",
    transformIndexHtml(html) {
      return html.replace(/ crossorigin/g, "");
    },
  };
}

export default defineConfig(({ command }) => {
  // The JSX transform follows Vite's idea of "production", which follows NODE_ENV as inherited
  // from the shell: a build spawned under vitest (NODE_ENV=test) emitted the development
  // runtime (jsxDEV) against a production React and every page died before its first
  // component. A build is a production build, whatever the shell says.
  if (command === "build") process.env.NODE_ENV = "production";
  return config(command);
});

function config(command: "build" | "serve"): UserConfig {
  return {
    root: "apps/extension",
    // A production build must not depend on the shell: with NODE_ENV inherited as anything
    // else, React resolves its development entry (389 KB of console.error) into the popup.
    define: command === "build" ? { "process.env.NODE_ENV": JSON.stringify("production") } : {},
    plugins: [
      enteSrpVitePlugin({
        workspaceRoot,
        productionEntry: path.resolve(
          workspaceRoot,
          "apps/extension/src/background/ente/ente-srp-worker-entry.ts",
        ),
      }),
      crx({ manifest }),
      stripCrossOrigin(),
      passkeyPagePlugin({
        source: path.resolve(workspaceRoot, "apps/extension/src/content/passkey/page-script.ts"),
      }),
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
              : chunk.name === "kdfWorkerEntry"
                ? "assets/kdf-worker-entry.js"
                : "assets/[name]-[hash].js",
        },
        input: {
          popup: "apps/extension/popup/index.html",
          vault: "apps/extension/vault/index.html",
          otpImportWorker: "apps/extension/src/vault/otp/import/otp-import-worker.ts",
          [ENTE_SRP_PRODUCTION_ENTRY]:
            "apps/extension/src/background/ente/ente-srp-worker-entry.ts",
          enteSodiumWorkerEntry: "apps/extension/src/background/ente/ente-sodium-worker-entry.ts",
          enteAuthWorkerEntry: "apps/extension/src/vault/ente/ente-auth-worker-entry.ts",
          // The vault KDF worker: built here, not as a nested worker bundle, so libsodium is
          // packaged once and the scanner's single-module identity check covers it too.
          kdfWorkerEntry: "packages/crypto/src/kdf-worker-entry.ts",
        },
      },
    },
  };
}
