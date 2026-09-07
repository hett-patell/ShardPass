import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "ShardPass",
  short_name: "ShardPass",
  version: "2.0.0.0",
  // 111: content scripts may run in the page's main world, which passkey support needs.
  minimum_chrome_version: "111",
  description: "Local-first password manager foundation.",
  // storage persists the encrypted vault and non-secret lock settings. alarms enforces
  // inactivity locking, and idle receives the operating-system locked state. No offscreen
  // permission is needed: trusted popup/vault pages run Argon2 in a dedicated local Worker.
  // unlimitedStorage: the vault format writes a complete new generation on every commit and
  // retains earlier ones for rollback, so a vault of a few hundred items crosses the default
  // 10 MB storage.local quota quickly. Once it does, every write fails while reads keep
  // working, which is how a quota error presents. Password managers universally hold this.
  // activeTab: the popup reads the open tab's URL to suggest logins for it and asks that
  // tab's content script to fill. Granted only while the person is using the popup.
  permissions: ["storage", "unlimitedStorage", "alarms", "idle", "activeTab"],
  host_permissions: ["https://api.ente.io/*"],
  action: {
    default_popup: "popup/index.html",
    default_title: "ShardPass",
  },
  options_page: "vault/index.html",
  background: {
    service_worker: "src/background/main.ts",
    type: "module",
  },
  // OTP discovery runs independently in every matched frame. <all_urls> is the existing content
  // match scope and does not grant extension pages runtime network access.
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/main.tsx"],
      run_at: "document_idle",
      all_frames: true,
    },
  ],
  content_security_policy: {
    extension_pages:
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.ente.io; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'",
  },
});
