import { readdir, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { assertManifestPolicy } from "../manifest.test";

const root = new URL("../../../", import.meta.url);

async function readBuiltManifest(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL("dist/manifest.json", root), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("built Manifest V3 policy", () => {
  it("emits an installable manifest with exact runtime page paths", async () => {
    const builtManifest = await readBuiltManifest();

    expect(Object.keys(builtManifest).sort()).toEqual(
      [
        "action",
        "background",
        "commands",
        "content_scripts",
        "content_security_policy",
        "description",
        "host_permissions",
        "manifest_version",
        "minimum_chrome_version",
        "name",
        "options_page",
        "permissions",
        "short_name",
        "version",
        "web_accessible_resources",
      ].sort(),
    );
    const { web_accessible_resources: generatedResources, ...sourceShape } = builtManifest;
    assertManifestPolicy(sourceShape);
    expect(builtManifest.background).toEqual({
      service_worker: "service-worker-loader.js",
      type: "module",
    });

    const contentScripts = builtManifest.content_scripts as Array<Record<string, unknown>>;
    expect(contentScripts).toHaveLength(2);
    expect(contentScripts[1]).toEqual({
      matches: ["<all_urls>"],
      run_at: "document_start",
      all_frames: true,
      world: "MAIN",
      js: ["assets/passkey-page.js"],
    });
    expect(Object.keys(contentScripts[0] ?? {}).sort()).toEqual([
      "all_frames",
      "js",
      "matches",
      "run_at",
    ]);
    expect(contentScripts[0]).toMatchObject({
      matches: ["<all_urls>"],
      run_at: "document_idle",
      all_frames: true,
    });
    const builtContentEntries = contentScripts[0]?.js;
    expect(builtContentEntries).toEqual([expect.stringMatching(/^assets\/[\w.-]+\.js$/u)]);
    if (!Array.isArray(builtContentEntries) || typeof builtContentEntries[0] !== "string") {
      throw new TypeError("Built content entry is missing.");
    }
    expect(generatedResources).toHaveLength(1);
    const generatedEntries = generatedResources as Array<Record<string, unknown>>;
    expect(generatedEntries[0]).toMatchObject({
      matches: ["<all_urls>"],
      use_dynamic_url: false,
    });
    const candidateResources = generatedEntries[0]?.resources;
    expect(candidateResources).toEqual(expect.any(Array));
    if (!Array.isArray(candidateResources)) throw new TypeError("Built resources are missing.");
    expect(candidateResources.length).toBeGreaterThan(0);
    for (const resource of candidateResources) expect(resource).toMatch(/^assets\/[\w.-]+\.js$/u);
    const resources = (generatedResources as Array<{ resources: string[] }>)[0]?.resources ?? [];
    expect(resources.length).toBeGreaterThan(0);
    expect(new Set(resources).size).toBe(resources.length);
    expect(resources).not.toContain(builtContentEntries[0]);
    const builtContentSource = await readFile(
      new URL(`dist/${builtContentEntries[0]}`, root),
      "utf8",
    );
    expect(builtContentSource).toContain("chrome.runtime.getURL");
    expect(builtContentSource).not.toMatch(
      /fetch\s*\(|XMLHttpRequest|WebSocket|clipboard|mediaDevices/u,
    );
    await expect(readFile(new URL("dist/popup/index.html", root), "utf8")).resolves.toContain(
      'type="module"',
    );
    await expect(readFile(new URL("dist/vault/index.html", root), "utf8")).resolves.toContain(
      'type="module"',
    );
  });

  it("ships production React only: no development JSX runtime in any asset", async () => {
    const assets = await readdir(new URL("dist/assets/", root));
    for (const name of assets.filter((file) => file.endsWith(".js"))) {
      const source = await readFile(new URL(`dist/assets/${name}`, root), "utf8");
      expect(source, name).not.toContain("jsxDEV");
    }
  });
});
