import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanBuild, verifyLegacyArtifact } from "../../scripts/scan-build.mjs";
import {
  compareBuildDirectories,
  snapshotBuildDirectory,
} from "../../scripts/verify-reproducible-build.mjs";

const temporaryDirectories: string[] = [];

async function temporaryProject(
  files: Readonly<Record<string, string | Uint8Array>>,
): Promise<{ dist: string; project: string }> {
  const project = await mkdtemp(path.join(tmpdir(), "shardpass-build-output-"));
  temporaryDirectories.push(project);
  const dist = path.join(project, "dist");
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(project, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return { dist, project };
}

const safeManifest = JSON.stringify({
  manifest_version: 3,
  name: "ShardPass",
  short_name: "ShardPass",
  version: "2.5.2",
  minimum_chrome_version: "111",
  description: "Local-first password manager foundation.",
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
  action: { default_popup: "popup/index.html", default_title: "ShardPass" },
  options_page: "vault/index.html",
  background: { service_worker: "service-worker-loader.js", type: "module" },
  content_scripts: [
    {
      js: ["assets/content.js"],
      matches: ["<all_urls>"],
      run_at: "document_idle",
      all_frames: true,
    },
  ],
  content_security_policy: {
    extension_pages:
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.ente.io https://api.pwnedpasswords.com https://quack.duckduckgo.com; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'",
  },
  web_accessible_resources: [
    {
      matches: ["<all_urls>"],
      resources: ["assets/content-entry.js", "assets/content-dependency.js"],
      use_dynamic_url: false,
    },
  ],
});

const safeContentEntry = {
  js: ["assets/content.js"],
  matches: ["<all_urls>"],
  run_at: "document_idle",
  all_frames: true,
} as const;

const safeArtifact = {
  "dist/manifest.json": safeManifest,
  "dist/service-worker-loader.js": 'import "./assets/worker.js";',
  "dist/assets/worker.js": "export const ready = true;",
  "dist/assets/content.js":
    'import(chrome.runtime.getURL("assets/content-entry.js")).then(({ ready }) => ready);',
  "dist/assets/content-entry.js":
    'import { ready } from "./content-dependency.js"; export { ready };',
  "dist/assets/content-dependency.js": "export const ready = true;",
  "dist/assets/app.js": "document.body.dataset.ready = String(true);",
  "dist/assets/app.css": "body { color: #fff; }",
  "dist/popup/index.html":
    '<!doctype html><script type="module" src="../assets/app.js"></script><link rel="stylesheet" href="../assets/app.css">',
  "dist/vault/index.html": '<!doctype html><script type="module" src="../assets/app.js"></script>',
} as const;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("production build output scanner", () => {
  it("rejects a symlink supplied as the dist root", async () => {
    const target = await temporaryProject(safeArtifact);
    const holder = await mkdtemp(path.join(tmpdir(), "shardpass-root-link-"));
    temporaryDirectories.push(holder);
    const linkedDist = path.join(holder, "dist-link");
    await symlink(target.dist, linkedDist, "dir");

    await expect(scanBuild(linkedDist, { projectRoot: target.project })).rejects.toThrow(
      /build root.*non-symlink directory/iu,
    );
  });

  it.each([
    ["crypto smoke path", "dist/crypto-smoke/index.html", "<!doctype html>"],
    ["crypto benchmark symbol", "dist/assets/app.js", "__shardpassRunDefaultArgon2idBenchmark"],
    ["crypto benchmark password", "dist/assets/app.js", "ShardPass browser benchmark"],
    ["crypto benchmark source", "dist/assets/app.js", "runDefaultArgon2idBenchmark"],
    ["removed test helper", "dist/assets/app.js", "createVaultKeyMaterialForTesting"],
    ["crypto test path", "dist/assets/app.js", "packages/crypto/test/compatibility-fixture"],
    ["backup test password", "dist/assets/app.js", "synthetic separate backup password"],
    ["backup test seed", "dist/assets/app.js", "JBSWY3DPEHPK3PXP"],
    ["legacy fixture password", "dist/assets/app.js", "TEST-ONLY ShardPass fixture password"],
    ["SRP transcript", "dist/assets/app.js", "srp-current-pin-transcript"],
    ["SRP private vector", "dist/assets/app.js", "clientPrivateHex"],
    ["sodium wire vector", "dist/assets/app.js", "sodium-wire-vectors"],
  ])("rejects leaked test-only crypto material: %s", async (_label, name, content) => {
    const artifact = { ...safeArtifact, [name]: content };
    const { dist, project } = await temporaryProject(artifact);

    const violations = await scanBuild(dist, { projectRoot: project });
    expect(violations).toContainEqual(expect.objectContaining({ rule: "crypto-test-artifact" }));
  });

  it("accepts a local, self-contained all-frame OTP artifact", async () => {
    const { dist, project } = await temporaryProject(safeArtifact);

    await expect(scanBuild(dist, { projectRoot: project })).resolves.toEqual([]);
  });

  it.each([
    [
      "remote executable URL",
      "dist/popup/index.html",
      '<script src="https://example.test/x.js"></script>',
    ],
    [
      "protocol-relative executable URL",
      "dist/popup/index.html",
      '<link rel="stylesheet" href="//example.test/x.css">',
    ],
    ["source map reference", "dist/assets/app.js", "export {};\n//# sourceMappingURL=app.js.map"],
    ["source map file", "dist/assets/app.js.map", "{}"],
    ["production console call", "dist/assets/app.js", 'console.info("ready")'],
    [
      "raw console transport",
      "dist/assets/app.js",
      "const transport = console; export { transport }",
    ],
    [
      "inline executable script",
      "dist/popup/index.html",
      "<script>globalThis.ready = true</script>",
    ],
    ["legacy minified filename", "dist/assets/index.ts-BbWVF1-a.js", "export {}"],
    ["legacy minified import", "dist/assets/app.js", 'import "./log-B-C8fiGH.js"'],
    ["test fixture filename", "dist/tests/fixtures/picker-harness.js", "export {}"],
    ["test harness string", "dist/assets/app.js", 'const label = "picker-harness"'],
    ["environment filename", "dist/assets/app.js", 'const filename = ".env.production"'],
    ["dynamic code", "dist/assets/app.js", 'Function("return true")()'],
  ])("rejects a controlled %s", async (_label, name, content) => {
    const { dist, project } = await temporaryProject({ ...safeArtifact, [name]: content });

    await expect(scanBuild(dist, { projectRoot: project })).resolves.not.toEqual([]);
  });

  it("rejects a value sourced from a project .env file", async () => {
    const marker = "task12-controlled-env-marker-7f6f";
    const { dist, project } = await temporaryProject({
      ...safeArtifact,
      ".env.production": `PRIVATE_MARKER=${marker}\n`,
      "dist/assets/app.js": `const marker = ${JSON.stringify(marker)}; export { marker };`,
    });

    await expect(scanBuild(dist, { projectRoot: project })).resolves.toContainEqual(
      expect.objectContaining({ rule: "environment-value" }),
    );
  });

  it("allows harmless HTTPS manifest metadata while rejecting executable remote fields", async () => {
    const harmless = JSON.parse(safeManifest) as Record<string, unknown>;
    harmless.homepage_url = "https://example.test/shardpass";
    const { dist, project } = await temporaryProject({
      ...safeArtifact,
      "dist/manifest.json": JSON.stringify(harmless),
    });

    await expect(scanBuild(dist, { projectRoot: project })).resolves.toEqual([]);
  });

  it("parses uppercase JavaScript and HTML executable files", async () => {
    const { dist, project } = await temporaryProject({
      ...safeArtifact,
      "dist/assets/BAD.JS": 'Function("return true")()',
      "dist/BAD.HTML": '<script src="https://bad.test/x"></script>',
    });

    const violations = await scanBuild(dist, { projectRoot: project });
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "assets/BAD.JS", rule: "function-reference" }),
        expect.objectContaining({ file: "BAD.HTML", rule: "remote-script-url" }),
      ]),
    );
  });

  it("parses extensionless manifest executable references and their worker references", async () => {
    const manifest = JSON.parse(safeManifest) as {
      background: { service_worker: string; type: string };
    };
    manifest.background.service_worker = "worker-entry";
    const { dist, project } = await temporaryProject({
      ...safeArtifact,
      "dist/manifest.json": JSON.stringify(manifest),
      "dist/worker-entry": 'new Worker("./nested-worker")',
      "dist/nested-worker": 'Function("return true")()',
    });

    await expect(scanBuild(dist, { projectRoot: project })).resolves.toContainEqual({
      file: "nested-worker",
      rule: "function-reference",
    });
  });

  it.each([
    ["options_ui", { options_ui: { page: "hidden-options", open_in_tab: true } }, "hidden-options"],
    ["devtools_page", { devtools_page: "hidden-devtools" }, "hidden-devtools"],
    ["side_panel", { side_panel: { default_path: "hidden-side-panel" } }, "hidden-side-panel"],
    [
      "chrome_url_overrides",
      { chrome_url_overrides: { newtab: "hidden-override" } },
      "hidden-override",
    ],
    ["sandbox", { sandbox: { pages: ["hidden-sandbox"] } }, "hidden-sandbox"],
  ])(
    "rejects unapproved extensionless manifest executable field %s",
    async (_field, extra, executable) => {
      const manifest = { ...(JSON.parse(safeManifest) as Record<string, unknown>), ...extra };
      const { dist, project } = await temporaryProject({
        ...safeArtifact,
        "dist/manifest.json": JSON.stringify(manifest),
        [`dist/${executable}`]: '<script type="module" src="./payload"></script>',
        "dist/payload": 'Function("return true")()',
      });

      await expect(scanBuild(dist, { projectRoot: project })).resolves.toContainEqual({
        file: "manifest.json",
        rule: "unapproved-manifest-executable-field",
      });
    },
  );

  it("rejects unexpected nested manifest keys that could hide executable roots", async () => {
    const manifest = JSON.parse(safeManifest) as {
      action: Record<string, unknown>;
      background: Record<string, unknown>;
      content_scripts: Array<Record<string, unknown>>;
    };
    manifest.action.side_page = "hidden";
    manifest.background.hidden_worker = "hidden-worker";
    manifest.content_scripts[0]!.hidden_scripts = ["hidden-content"];
    const { dist, project } = await temporaryProject({
      ...safeArtifact,
      "dist/manifest.json": JSON.stringify(manifest),
    });

    await expect(scanBuild(dist, { projectRoot: project })).resolves.toContainEqual({
      file: "manifest.json",
      rule: "unapproved-manifest-key",
    });
  });

  it("parses an extensionless HTML manifest page and extensionless script reference", async () => {
    const manifest = JSON.parse(safeManifest) as {
      action: { default_popup: string; default_title: string };
    };
    manifest.action.default_popup = "popup-entry";
    const { dist, project } = await temporaryProject({
      ...safeArtifact,
      "dist/manifest.json": JSON.stringify(manifest),
      "dist/popup-entry": '<script type="module" src="./extensionless-script"></script>',
      "dist/extensionless-script": 'Function("return true")()',
    });

    await expect(scanBuild(dist, { projectRoot: project })).resolves.toContainEqual({
      file: "extensionless-script",
      rule: "function-reference",
    });
  });

  it("reports console.error in ShardPass's own chunks and allows it in the vendored bundles", async () => {
    const ours = await temporaryProject({
      ...safeArtifact,
      "dist/assets/app.js":
        'export const report = (error) => console.error("vault failed", error);',
    });
    await expect(scanBuild(ours.dist, { projectRoot: ours.project })).resolves.toContainEqual({
      file: "assets/app.js",
      rule: "console-transport",
    });

    // React DOM and libsodium log on their own account and are not ShardPass's to edit.
    const vendored = await temporaryProject({
      ...safeArtifact,
      "dist/assets/client-Cc4URx2i.js": 'export const warn = () => console.error("react");',
    });
    await expect(scanBuild(vendored.dist, { projectRoot: vendored.project })).resolves.toEqual([]);
  });

  it("reports a network destination in the background chunk that the CSP does not allow", async () => {
    const { dist, project } = await temporaryProject({
      ...safeArtifact,
      "dist/assets/main.ts-CEK8Ya7J.js":
        'export const sync = () => fetch(`https://api.ente.io/x`); export const leak = () => fetch("https://telemetry.example.com/collect");',
    });

    await expect(scanBuild(dist, { projectRoot: project })).resolves.toContainEqual({
      file: "assets/main.ts-CEK8Ya7J.js",
      rule: "network-destination-host:telemetry.example.com",
    });
  });

  it("accepts the background chunk when every absolute URL is one the CSP allows", async () => {
    const { dist, project } = await temporaryProject({
      ...safeArtifact,
      "dist/assets/main.ts-CEK8Ya7J.js":
        'export const hosts = ["https://api.ente.io", "https://api.pwnedpasswords.com/range/", "https://quack.duckduckgo.com/api/email/addresses"];',
    });

    await expect(scanBuild(dist, { projectRoot: project })).resolves.toEqual([]);
  });

  it("accepts local extensionless packaged worker and script references when files exist", async () => {
    const manifest = JSON.parse(safeManifest) as {
      background: { service_worker: string; type: string };
    };
    manifest.background.service_worker = "worker-entry";
    const { dist, project } = await temporaryProject({
      ...safeArtifact,
      "dist/manifest.json": JSON.stringify(manifest),
      "dist/worker-entry":
        'importScripts("./nested-worker"); const script = document.createElement("script"); script.src = "./chunk"; document.head.append(script)',
      "dist/nested-worker": "self.ready = true;",
      "dist/chunk": "globalThis.ready = true;",
    });

    await expect(scanBuild(dist, { projectRoot: project })).resolves.toEqual([]);
  });

  it.each([
    [
      "file symlink",
      async (dist: string, outside: string) =>
        symlink(outside, path.join(dist, "assets", "linked.js")),
      "nonregular-build-entry",
    ],
    [
      "directory symlink",
      async (dist: string, outside: string) =>
        symlink(path.dirname(outside), path.join(dist, "linked-directory"), "dir"),
      "nonregular-build-entry",
    ],
  ])("rejects a controlled output %s without following it", async (_label, createLink, rule) => {
    const { dist, project } = await temporaryProject(safeArtifact);
    const outside = path.join(project, "outside.js");
    await writeFile(outside, 'Function("return true")()');
    await createLink(dist, outside);

    await expect(scanBuild(dist, { projectRoot: project })).resolves.toContainEqual(
      expect.objectContaining({ rule }),
    );
  });

  it.each([
    ["wrong content matches", [{ ...safeContentEntry, matches: ["https://example.test/*"] }]],
    [
      "missing content matches",
      [{ js: ["assets/content.js"], run_at: "document_idle", all_frames: true }],
    ],
    ["wrong content run_at", [{ ...safeContentEntry, run_at: "document_start" }]],
    [
      "missing content run_at",
      [{ js: ["assets/content.js"], matches: ["<all_urls>"], all_frames: true }],
    ],
    ["false content all_frames", [{ ...safeContentEntry, all_frames: false }]],
    [
      "missing content all_frames",
      [{ js: ["assets/content.js"], matches: ["<all_urls>"], run_at: "document_idle" }],
    ],
    [
      "missing content js",
      [{ matches: ["<all_urls>"], run_at: "document_idle", all_frames: true }],
    ],
    [
      "duplicate content js",
      [{ ...safeContentEntry, js: ["assets/content.js", "assets/content.js"] }],
    ],
    ["multiple content js", [{ ...safeContentEntry, js: ["assets/content.js", "assets/app.js"] }]],
    ["empty content js path", [{ ...safeContentEntry, js: [""] }]],
    ["remote content js path", [{ ...safeContentEntry, js: ["https://example.test/content.js"] }]],
    ["extra content entry", [safeContentEntry, safeContentEntry]],
    ["extra content entry key", [{ ...safeContentEntry, world: "ISOLATED" }]],
    ["content css key", [{ ...safeContentEntry, css: ["assets/app.css"] }]],
  ])("rejects %s with the exact generated content diagnostic", async (_label, content_scripts) => {
    const manifest = { ...(JSON.parse(safeManifest) as Record<string, unknown>), content_scripts };
    const { dist, project } = await temporaryProject({
      ...safeArtifact,
      "dist/manifest.json": JSON.stringify(manifest),
    });

    await expect(scanBuild(dist, { projectRoot: project })).resolves.toContainEqual({
      file: "manifest.json",
      rule: "generated-content-contract",
    });
  });

  it.each([
    ["wrong WAR type", { web_accessible_resources: {} }],
    [
      "extra WAR entry",
      {
        web_accessible_resources: [
          { matches: ["<all_urls>"], resources: ["assets/content.js"], use_dynamic_url: false },
          { matches: ["<all_urls>"], resources: ["assets/content.js"], use_dynamic_url: false },
        ],
      },
    ],
    [
      "extra WAR resource",
      {
        web_accessible_resources: [
          {
            matches: ["<all_urls>"],
            resources: ["assets/content.js", "assets/app.js"],
            use_dynamic_url: false,
          },
        ],
      },
    ],
    [
      "duplicate WAR resource",
      {
        web_accessible_resources: [
          {
            matches: ["<all_urls>"],
            resources: ["assets/content.js", "assets/content.js"],
            use_dynamic_url: false,
          },
        ],
      },
    ],
    [
      "content loader exposed as WAR",
      {
        web_accessible_resources: [
          {
            matches: ["<all_urls>"],
            resources: ["assets/content.js", "assets/content-dependency.js"],
            use_dynamic_url: false,
          },
        ],
      },
    ],
    [
      "unrelated local JavaScript substituted for generated dependency",
      {
        web_accessible_resources: [
          {
            matches: ["<all_urls>"],
            resources: ["assets/content-entry.js", "assets/app.js"],
            use_dynamic_url: false,
          },
        ],
      },
    ],
    [
      "generated dependency omitted",
      {
        web_accessible_resources: [
          {
            matches: ["<all_urls>"],
            resources: ["assets/content-entry.js"],
            use_dynamic_url: false,
          },
        ],
      },
    ],
    [
      "wrong WAR matches",
      {
        web_accessible_resources: [
          {
            matches: ["https://example.test/*"],
            resources: ["assets/content.js"],
            use_dynamic_url: false,
          },
        ],
      },
    ],
    [
      "true WAR dynamic flag",
      {
        web_accessible_resources: [
          { matches: ["<all_urls>"], resources: ["assets/content.js"], use_dynamic_url: true },
        ],
      },
    ],
    [
      "missing WAR dynamic flag",
      {
        web_accessible_resources: [{ matches: ["<all_urls>"], resources: ["assets/content.js"] }],
      },
    ],
  ])("rejects %s", async (_label, replacement) => {
    const manifest = { ...(JSON.parse(safeManifest) as Record<string, unknown>), ...replacement };
    const { dist, project } = await temporaryProject({
      ...safeArtifact,
      "dist/manifest.json": JSON.stringify(manifest),
    });

    await expect(scanBuild(dist, { projectRoot: project })).resolves.toContainEqual({
      file: "manifest.json",
      rule: "generated-war-contract",
    });
  });

  it("rejects missing local references and unexpected picker exposure", async () => {
    const manifest = JSON.parse(safeManifest) as {
      web_accessible_resources: Array<{ matches: string[]; resources: string[] }>;
    };
    manifest.web_accessible_resources[0]?.resources.push("assets/picker-harness.js");
    const { dist, project } = await temporaryProject({
      ...safeArtifact,
      "dist/manifest.json": JSON.stringify(manifest),
    });

    const violations = await scanBuild(dist, { projectRoot: project });
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "missing-local-reference" }),
        expect.objectContaining({ rule: "unexpected-web-accessible-resource" }),
      ]),
    );
  });
});

describe("legacy artifact exact-set verification", () => {
  async function legacyFixture(): Promise<{
    expected: ReadonlyMap<string, string>;
    root: string;
  }> {
    const root = await mkdtemp(path.join(tmpdir(), "shardpass-legacy-fixture-"));
    temporaryDirectories.push(root);
    const contents = new Map([
      ["manifest.json", "manifest"],
      ["service-worker-loader.js", "loader"],
      ["src/popup/index.html", "popup"],
      ["assets/a.js", "asset"],
      ["icons/a.png", "icon"],
    ]);
    for (const [name, content] of contents) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), content);
    }
    return {
      root,
      expected: new Map(
        [...contents].map(([name, content]) => [
          name,
          createHash("sha256").update(content).digest("hex"),
        ]),
      ),
    };
  }

  it("rejects an assets ancestor symlink even when its external copy is exact", async () => {
    const { expected, root } = await legacyFixture();
    const external = await mkdtemp(path.join(tmpdir(), "shardpass-legacy-assets-"));
    temporaryDirectories.push(external);
    await writeFile(path.join(external, "a.js"), "asset");
    await rm(path.join(root, "assets"), { recursive: true });
    await symlink(external, path.join(root, "assets"), "dir");

    await expect(verifyLegacyArtifact(root, expected)).resolves.toContainEqual({
      file: "assets",
      rule: "legacy-artifact-ancestor-symlink",
    });
  });

  it("rejects a popup ancestor symlink", async () => {
    const { expected, root } = await legacyFixture();
    const external = await mkdtemp(path.join(tmpdir(), "shardpass-legacy-popup-"));
    temporaryDirectories.push(external);
    await writeFile(path.join(external, "index.html"), "popup");
    await rm(path.join(root, "src", "popup"), { recursive: true });
    await symlink(external, path.join(root, "src", "popup"), "dir");

    await expect(verifyLegacyArtifact(root, expected)).resolves.toContainEqual({
      file: "src/popup",
      rule: "legacy-artifact-ancestor-symlink",
    });
  });

  it("accepts exactly the expected regular legacy files", async () => {
    const { expected, root } = await legacyFixture();

    await expect(verifyLegacyArtifact(root, expected)).resolves.toEqual([]);
  });

  it.each([
    [
      "unexpected file",
      "legacy-artifact-unexpected",
      async (root: string) => writeFile(path.join(root, "assets/extra.js"), "extra"),
    ],
    [
      "missing file",
      "legacy-artifact-missing",
      async (root: string) => rm(path.join(root, "icons/a.png")),
    ],
    [
      "replaced bytes",
      "legacy-artifact-checksum",
      async (root: string) => writeFile(path.join(root, "assets/a.js"), "replaced"),
    ],
    [
      "symlink",
      "legacy-artifact-symlink",
      async (root: string) => {
        await rm(path.join(root, "assets/a.js"));
        await symlink("../manifest.json", path.join(root, "assets/a.js"));
      },
    ],
    [
      "directory replacement",
      "legacy-artifact-not-regular",
      async (root: string) => {
        await rm(path.join(root, "assets/a.js"));
        await mkdir(path.join(root, "assets/a.js"));
      },
    ],
  ])("rejects an exact-set %s with the exact diagnostic", async (_label, rule, mutate) => {
    const { expected, root } = await legacyFixture();
    await mutate(root);

    const violations = await verifyLegacyArtifact(root, expected);
    expect(violations).toContainEqual(expect.objectContaining({ rule }));
  });
});

describe("reproducible build comparison", () => {
  it("rejects a symlink supplied as the snapshot root", async () => {
    const target = await temporaryProject({ "dist/app.js": "safe" });
    const holder = await mkdtemp(path.join(tmpdir(), "shardpass-repro-root-link-"));
    temporaryDirectories.push(holder);
    const linkedDist = path.join(holder, "dist-link");
    await symlink(target.dist, linkedDist, "dir");

    await expect(snapshotBuildDirectory(linkedDist)).rejects.toThrow(
      /build root.*non-symlink directory/iu,
    );
  });

  it("compares sorted relative paths and SHA-256 content", async () => {
    const first = await temporaryProject({ "dist/b.txt": "same", "dist/a.txt": "same" });
    const second = await temporaryProject({ "dist/a.txt": "same", "dist/b.txt": "same" });

    await expect(compareBuildDirectories(first.dist, second.dist)).resolves.toEqual([]);
    const snapshot = await snapshotBuildDirectory(first.dist);
    expect(snapshot.map((entry) => entry.path)).toEqual(["a.txt", "b.txt"]);
    expect(snapshot.every((entry) => /^[a-f\d]{64}$/u.test(entry.sha256))).toBe(true);
  });

  it.each([
    [
      "file symlink",
      async (dist: string, outside: string) => symlink(outside, path.join(dist, "linked.js")),
    ],
    [
      "directory symlink",
      async (dist: string, outside: string) =>
        symlink(path.dirname(outside), path.join(dist, "linked-directory"), "dir"),
    ],
  ])("rejects a reproducibility %s", async (_label, createLink) => {
    const { dist, project } = await temporaryProject({ "dist/app.js": "safe" });
    const outside = path.join(project, "outside.js");
    await writeFile(outside, "outside");
    await createLink(dist, outside);

    await expect(snapshotBuildDirectory(dist)).rejects.toThrow(/nonregular build entry/iu);
  });

  it("reports controlled file-set and byte mismatches without normalization", async () => {
    const first = await temporaryProject({ "dist/app.js": "first", "dist/only-first.js": "x" });
    const second = await temporaryProject({ "dist/app.js": "second", "dist/only-second.js": "x" });

    await expect(compareBuildDirectories(first.dist, second.dist)).resolves.toEqual(
      expect.arrayContaining([
        expect.stringContaining("app.js"),
        expect.stringContaining("only-first.js"),
        expect.stringContaining("only-second.js"),
      ]),
    );
  });
});
