import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "ShardPass Crypto Test",
  version: "0.0.0.0",
  minimum_chrome_version: "110",
  background: {
    service_worker: "worker.ts",
    type: "module",
  },
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self'",
  },
});
