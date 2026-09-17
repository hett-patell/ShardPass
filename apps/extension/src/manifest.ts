import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "ShardPass",
  short_name: "ShardPass",
  version: "2.8.1",
  // 111: content scripts may run in the page's main world, which passkey support needs.
  minimum_chrome_version: "111",
  // What the store listing and the extensions page show. Store descriptions are capped at 132
  // characters, and this is what someone reads before deciding to install.
  description:
    "Keeps your passwords, passkeys and one-time codes on this device, and fills them as you browse. No account, no server.",
  homepage_url: "https://github.com/hett-patell/ShardPass",
  // The toolbar, the extensions page and the store listing all draw from these. Rendered from
  // the same mark the interface uses, vermillion with the letterform cut out, so the shape
  // holds on a light or a dark toolbar.
  icons: {
    16: "icons/shardpass-16.png",
    32: "icons/shardpass-32.png",
    48: "icons/shardpass-48.png",
    128: "icons/shardpass-128.png",
  },
  // storage persists the encrypted vault and non-secret lock settings. alarms enforces
  // inactivity locking, and idle receives the operating-system locked state. No offscreen
  // permission is needed: trusted popup/vault pages run Argon2 in a dedicated local Worker.
  // unlimitedStorage: the vault format writes a complete new generation on every commit and
  // retains earlier ones for rollback, so a vault of a few hundred items crosses the default
  // 10 MB storage.local quota quickly. Once it does, every write fails while reads keep
  // working, which is how a quota error presents. Password managers universally hold this.
  // activeTab: the popup reads the open tab's URL to suggest logins for it and asks that
  // tab's content script to fill. Granted only while the person is using the popup.
  // contextMenus: a "Fill login with ShardPass" entry on editable fields; the click carries
  // the tab, and activeTab then covers reading its URL and messaging its content script.
  permissions: [
    "storage",
    "unlimitedStorage",
    "alarms",
    "idle",
    "activeTab",
    "contextMenus",
    "favicon",
  ],
  host_permissions: ["https://api.ente.io/*", "https://quack.duckduckgo.com/*"],
  // A shortcut to open the popup, as every password manager has; changeable at
  // chrome://extensions/shortcuts.
  commands: {
    _execute_action: {
      suggested_key: { default: "Ctrl+Shift+L", mac: "Command+Shift+L" },
      description: "Open ShardPass",
    },
    // No default key: a chord that locks everything is for the person to choose.
    "lock-vault": { description: "Lock ShardPass" },
    // Fills the one login saved for the page; with several, or none, the popup opens instead.
    "fill-login": { description: "Fill the login for this page" },
  },
  action: {
    default_popup: "popup/index.html",
    default_title: "ShardPass",
    default_icon: {
      16: "icons/shardpass-16.png",
      32: "icons/shardpass-32.png",
      48: "icons/shardpass-48.png",
      128: "icons/shardpass-128.png",
    },
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
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.ente.io https://api.pwnedpasswords.com https://quack.duckduckgo.com; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'",
  },
});
