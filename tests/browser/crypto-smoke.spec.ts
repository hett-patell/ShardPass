import { chromium, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const extensionPath = path.resolve(import.meta.dirname, "../../.test-dist/crypto-extension");

test("runs Argon2 in a dedicated local worker while the extension page remains responsive", async () => {
  test.setTimeout(150_000);
  const userDataDir = await mkdtemp(path.join(tmpdir(), "shardpass-crypto-playwright-"));
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
    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(page.locator("body")).toHaveAttribute("data-crypto-status", "passed", {
      timeout: 120_000,
    });
    expect(
      Number(await page.locator("body").getAttribute("data-responsive-ticks")),
    ).toBeGreaterThanOrEqual(2);
    expect(Number(await page.locator("body").getAttribute("data-argon2-ms"))).toBeGreaterThan(0);
    expect(
      await serviceWorker.evaluate(() =>
        Reflect.has(globalThis, "__shardpassRunDefaultArgon2idBenchmark"),
      ),
    ).toBe(false);
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
