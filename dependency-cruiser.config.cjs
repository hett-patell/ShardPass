/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "packages-cannot-import-apps",
      severity: "error",
      comment: "Reusable packages must not depend on application entry points.",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "crypto-direct-kdf-boundary",
      severity: "error",
      comment: "Only the dedicated crypto worker entry may import the blocking Argon2 primitive.",
      from: { pathNot: "^packages/crypto/(?:src/kdf-worker-entry\\.ts|test/)" },
      to: { path: "^packages/crypto/src/kdf-direct\\.ts$" },
    },
    {
      name: "ente-production-cannot-import-full-zod",
      severity: "error",
      comment: "Task12 production Ente parsers must use the CSP-safe zod/mini boundary.",
      from: { path: "^apps/extension/src/(?:background|vault)/ente/" },
      to: { path: "^zod$" },
    },
    {
      name: "production-cannot-import-tests",
      severity: "error",
      comment: "Production applications and packages must not import test-only modules.",
      from: {
        path: "^(?:apps|packages)/",
        pathNot: "^(?:packages/[^/]+/test/|apps/extension/test/)",
      },
      to: { path: "(?:^|/)test(?:s)?/" },
    },
    {
      name: "pure-packages-cannot-import-react",
      severity: "error",
      comment: "Framework-independent packages must not depend on React.",
      from: { path: "^packages/(?!ui(?:/|$))" },
      to: { path: "(^|/)node_modules/(react|react-dom)(/|$)" },
    },
    {
      name: "pure-packages-cannot-use-browser-globals",
      severity: "error",
      comment: "Framework-independent packages must not import browser API implementations.",
      from: { path: "^packages/(?!ui(?:/|$))" },
      to: { path: "(^|/)node_modules/webextension-polyfill(/|$)" },
    },
    {
      name: "apps-use-platform-webextension-boundary",
      severity: "error",
      comment: "Only the extension platform boundary may import webextension-polyfill.",
      from: {
        path: "^apps/extension/src/",
        pathNot: "^apps/extension/src/platform/",
      },
      to: { path: "(^|/)node_modules/webextension-polyfill(/|$)" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: "(^|/)(dist|assets|icons)(/|$)|^service-worker-loader\\.js$|^src/popup/index\\.html$",
    },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
    },
    reporterOptions: {
      dot: { collapsePattern: "node_modules/[^/]+" },
    },
  },
};
