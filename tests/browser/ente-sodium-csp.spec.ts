import { chromium, expect, test } from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const builtExtension = path.resolve(import.meta.dirname, "../../.test-dist/crypto-extension");

async function sodiumStatus(
  extensionPath: string,
  timeout = 120_000,
): Promise<Readonly<{ status: string; wasm: string; imports: string; exports: string }>> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "shardpass-ente-sodium-profile-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--disable-background-networking",
      "--disable-component-update",
      "--no-first-run",
    ],
  });
  try {
    const serviceWorker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(serviceWorker.url()).host}/index.html`);
    await expect(page.locator("body")).toHaveAttribute("data-sodium-status", "passed", { timeout });
    return {
      status: (await page.locator("body").getAttribute("data-sodium-status")) ?? "missing",
      wasm: (await page.locator("body").getAttribute("data-sodium-wasm-sha256")) ?? "missing",
      imports: (await page.locator("body").getAttribute("data-sodium-imports-sha256")) ?? "missing",
      exports: (await page.locator("body").getAttribute("data-sodium-exports-sha256")) ?? "missing",
    };
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
}

test("initializes only approved packaged libsodium WASM under owner-approved CSP", async () => {
  test.setTimeout(150_000);
  await expect(sodiumStatus(builtExtension)).resolves.toEqual({
    status: "passed",
    wasm: "b15a381270ba8869e3a6b91d45e5a6439370c769e25ceef78aee9439f791d18f",
    imports: "a5b5390f62925cc37c84edcd2117ddea27bc88b41c3f1cd143473be2744fe64d",
    exports: "65af216ac8a046ac32237abc6c7eaa56af9be1ce03918b449e622515d573a0a6",
  });
});

test("controlled negative CSP blocks packaged libsodium", async () => {
  test.setTimeout(150_000);
  const extensionPath = await mkdtemp(path.join(tmpdir(), "shardpass-ente-sodium-negative-"));
  try {
    await cp(builtExtension, extensionPath, { recursive: true });
    const manifestPath = path.join(extensionPath, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      content_security_policy: { extension_pages: string };
    };
    manifest.content_security_policy.extension_pages =
      "script-src 'none'; object-src 'none'; connect-src 'none'";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await expect(sodiumStatus(extensionPath, 5_000)).rejects.toThrow();
  } finally {
    await rm(extensionPath, { recursive: true, force: true });
  }
});
