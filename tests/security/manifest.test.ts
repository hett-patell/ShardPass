import { describe, expect, it } from "vitest";

import { readFile } from "node:fs/promises";

import manifest from "../../apps/extension/src/manifest";

const allowedSourceManifestKeys = [
  "action",
  "background",
  "commands",
  "content_scripts",
  "host_permissions",
  "content_security_policy",
  "description",
  "manifest_version",
  "minimum_chrome_version",
  "name",
  "options_page",
  "permissions",
  "short_name",
  "version",
] as const;

function assertManifestPolicy(candidate: Record<string, unknown>): void {
  expect(Object.keys(candidate).sort()).toEqual([...allowedSourceManifestKeys].sort());
  expect(candidate.manifest_version).toBe(3);
  expect(candidate.minimum_chrome_version).toBe("111");
  // unlimitedStorage: every commit writes a full generation; without it a real vault hits the
  // 10 MB storage.local quota and every write fails while reads keep working.
  expect(candidate.permissions).toEqual([
    "storage",
    "unlimitedStorage",
    "alarms",
    "idle",
    "activeTab",
    "contextMenus",
  ]);
  expect(candidate.permissions).not.toContain("downloads");
  expect(candidate.permissions).not.toContain("clipboardRead");
  expect(candidate.permissions).not.toContain("clipboardWrite");
  expect(candidate.permissions).not.toContain("offscreen");
  expect(candidate.host_permissions).toEqual([
    "https://api.ente.io/*",
    "https://quack.duckduckgo.com/*",
  ]);
  expect(candidate).not.toHaveProperty("optional_host_permissions");
  expect(candidate).not.toHaveProperty("externally_connectable");
  expect(candidate).not.toHaveProperty("sandbox");
  expect(candidate).not.toHaveProperty("oauth2");
  expect(candidate.action).toEqual({
    default_popup: "popup/index.html",
    default_title: "ShardPass",
  });
  expect(candidate.options_page).toBe("vault/index.html");
  // Two commands: opening the popup, and locking the vault. Nothing else runs from a keystroke.
  expect(Object.keys(candidate.commands as object)).toEqual([
    "_execute_action",
    "lock-vault",
    "fill-login",
  ]);
  expect(candidate.commands).toMatchObject({ "lock-vault": { description: "Lock ShardPass" } });
  expect(Object.keys(candidate.action as object).sort()).toEqual([
    "default_popup",
    "default_title",
  ]);
  expect(Object.keys(candidate.background as object).sort()).toEqual(["service_worker", "type"]);
  expect(candidate.background).toMatchObject({ type: "module" });
  // The isolated-world content script comes first. The build appends exactly one more: the
  // passkey page script, the only code allowed in the page's own (MAIN) world, a single
  // fixed file that must never gain matches, frames, or timing beyond this.
  const [isolatedWorld, ...pageWorld] = candidate.content_scripts as Array<Record<string, unknown>>;
  expect(isolatedWorld).toEqual(
    expect.objectContaining({
      matches: ["<all_urls>"],
      run_at: "document_idle",
      all_frames: true,
    }),
  );
  expect(isolatedWorld).not.toHaveProperty("world");
  expect(pageWorld.length).toBeLessThanOrEqual(1);
  for (const script of pageWorld) {
    expect(script).toEqual({
      matches: ["<all_urls>"],
      run_at: "document_start",
      all_frames: true,
      world: "MAIN",
      js: ["assets/passkey-page.js"],
    });
  }
  const contentScripts = candidate.content_scripts as Array<Record<string, unknown>>;
  expect(Object.keys(contentScripts[0] ?? {}).sort()).toEqual([
    "all_frames",
    "js",
    "matches",
    "run_at",
  ]);
}

export { assertManifestPolicy };

describe("Manifest V3 source policy", () => {
  it("activates only the reviewed local OTP controller from the content entry", async () => {
    const source = await readFile(
      new URL("../../apps/extension/src/content/main.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("createOtpFillController");
    expect(source).toContain("createChromePlatform");
    expect(source).not.toMatch(
      /fetch\s*\(|XMLHttpRequest|WebSocket|clipboard|mediaDevices|console\./u,
    );
  });

  it("declares least privilege with all-frame content injection", () => {
    const sourceManifest = manifest as unknown as {
      background: { service_worker: string };
      content_scripts: Array<{ js: string[] }>;
    };

    assertManifestPolicy(sourceManifest);
    expect(sourceManifest.background.service_worker).toBe("src/background/main.ts");
    expect(sourceManifest.content_scripts[0]?.js).toEqual(["src/content/main.tsx"]);
  });
});
