import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./fixtures";

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

test("loads popup and vault with ready foundation status", async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await expect(popup.getByText("Foundation ready", { exact: true })).toBeVisible();
  await expect(popup.getByRole("button", { name: "Open vault", exact: true })).toBeEnabled();

  const vault = await context.newPage();
  await vault.goto(`chrome-extension://${extensionId}/vault/index.html`);
  await expect(vault.getByText("Foundation ready", { exact: true }).first()).toBeVisible();
  await expect(vault.getByRole("main")).toBeVisible();
  await expect(vault.getByRole("region", { name: "Vault details" })).toBeVisible();
});

test("loads the local fixture without activating production picker behavior", async ({ page }) => {
  await page.goto("/tests/fixtures/sites/foundation.html?picker=off");
  await expect(page.getByRole("heading", { name: "Foundation test site" })).toBeVisible();
  await expect(page.locator("shardpass-picker-host")).toHaveCount(0);
});
