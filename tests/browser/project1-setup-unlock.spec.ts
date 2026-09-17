import { expect, expectVaultUnlocked, lockVault, test } from "./fixtures";

test.use({ screenLockStabilized: true });

test("sets up, locks, and unlocks a local vault through trusted extension pages", async ({
  context,
  extensionId,
}) => {
  test.setTimeout(180_000);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/vault/index.html`);
  await expect(page.getByRole("heading", { name: "Create your vault" })).toBeVisible();
  const password = "correct horse battery";
  await page.getByLabel("Master password", { exact: true }).fill(password);
  await page.getByLabel("Confirm master password").fill(password);
  await page.getByRole("button", { name: "Create vault" }).click();
  await expectVaultUnlocked(page);
  await lockVault(page);
  await expect(page.getByRole("heading", { name: "Unlock ShardPass" })).toBeVisible();
  await page.getByLabel("Master password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Unlock vault" }).click();
  await expectVaultUnlocked(page);
});
