import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, expectVaultReady, test } from "./fixtures";

const root = path.resolve(import.meta.dirname, "../..");

test("loads the built manifest and module service worker", async ({
  extensionId,
  extensionWorker,
}) => {
  const manifest = JSON.parse(await readFile(path.join(root, "dist/manifest.json"), "utf8")) as {
    manifest_version: number;
    background?: { service_worker?: string; type?: string };
  };

  expect(manifest.manifest_version).toBe(3);
  expect(manifest.background?.type).toBe("module");
  expect(manifest.background?.service_worker).toBeTruthy();
  expect(extensionWorker.url()).toBe(
    `chrome-extension://${extensionId}/${manifest.background?.service_worker ?? ""}`,
  );
});

test("loads popup and vault with a working background", async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
  // A fresh profile has no vault yet, so the popup offers to create one. That it knows this
  // is the signal: the background answered, and the popup carries no status badge of its own.
  await expect(popup.getByRole("heading", { name: "Create your vault" })).toBeVisible();
  await expect(popup.getByLabel("Master password", { exact: true })).toBeVisible();

  const vault = await context.newPage();
  await vault.goto(`chrome-extension://${extensionId}/vault/index.html`);
  await expectVaultReady(vault);
  await expect(vault.getByRole("main")).toBeVisible();
  // Same fresh profile, so the vault page offers to create one too. The panes of the vault
  // itself are covered by the specs that set one up.
  await expect(vault.getByRole("heading", { name: "Create your vault" })).toBeVisible();
});

test("loads the local fixture without activating production picker behavior", async ({ page }) => {
  await page.goto("/tests/fixtures/sites/foundation.html?picker=off");
  await expect(page.getByRole("heading", { name: "Foundation test site" })).toBeVisible();
  await expect(page.locator("shardpass-picker-host")).toHaveCount(0);
});
