import type { BrowserContext, Download, Page, Worker } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  expect,
  expectNoSeriousAxeViolations,
  expectVaultUnlocked,
  lockVault,
  setChromiumZoom,
  stabilizePage,
  test,
} from "./fixtures";

const vaultPassword = "correct horse battery";
const backupPassword = "synthetic separate backup password";
const legacyPassword = "TEST-ONLY ShardPass fixture password; never use for real data";
const syntheticSecret = "JBSWY3DPEHPK3PXP";
const safeIssuer = "Backup Evidence";
let temporaryDirectory = "";
let generatedBackup = "";

test.use({ screenshot: "off", trace: "off", screenLockStabilized: true });
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "shardpass-backup-evidence-"));
  generatedBackup = path.join(temporaryDirectory, "generated.shardpass");
});

test.afterAll(async () => {
  if (temporaryDirectory !== "") await rm(temporaryDirectory, { recursive: true, force: true });
});

test("exports a separately protected generated backup with no secret rendering or plaintext persistence", async ({
  context,
  extensionId,
  extensionWorker,
}) => {
  test.setTimeout(420_000);
  const vault = await openVault(context, extensionId);
  await setupVault(vault);
  await createOtp(vault, {
    issuer: safeIssuer,
    label: "portable fields",
    type: "HOTP",
    algorithm: "SHA256",
    digits: "8",
    counter: "7",
    tags: "reviewed-tag",
    note: "synthetic local note",
    favorite: true,
  });

  const before = await safeStorageState(extensionWorker);
  await vault.getByLabel("Current vault password").fill(vaultPassword);
  await vault.getByLabel("Backup password", { exact: true }).fill(backupPassword);
  await vault.getByLabel("Confirm backup password").fill(backupPassword);
  await vault.getByRole("button", { name: "Prepare encrypted backup" }).click();
  await expect(vault.getByLabel("Current vault password")).toHaveValue("");
  await expect(vault.getByLabel("Backup password", { exact: true })).toHaveValue("");
  await expect(vault.getByLabel("Confirm backup password")).toHaveValue("");
  const download = await downloadVerifiedBackup(vault);
  await download.saveAs(generatedBackup);
  expect((await readFile(generatedBackup)).byteLength).toBeGreaterThan(128);
  await expect(vault.getByText("Backup download started.", { exact: true })).toBeVisible();
  await assertNoSensitiveRendering(vault);
  expect(await safeStorageState(extensionWorker)).toEqual(before);
});

test("round-trips all portable Project 1 item fields, settings, and bounded history in one root transition", async ({
  context,
  extensionId,
  extensionWorker,
}) => {
  test.setTimeout(420_000);
  const vault = await openVault(context, extensionId);
  await setupVault(vault);
  const rootBeforePreview = await activeGenerationId(extensionWorker);
  const storageBeforePreview = await safeStorageState(extensionWorker);

  await selectBackup(vault, generatedBackup, backupPassword);
  await expect(vault.getByRole("heading", { name: "Review backup import" })).toBeVisible();
  await expect(vault.getByLabel("Backup import summary")).toContainText("1 ready");
  await expect(vault.getByText(/Settings: unchanged/u)).toBeVisible();
  await expect(vault.getByText(/History additions: [1-9][0-9]* journal/u)).toBeVisible();
  expect(await activeGenerationId(extensionWorker)).toBe(rootBeforePreview);
  expect(await safeStorageState(extensionWorker)).toEqual(storageBeforePreview);
  await assertNoSensitiveRendering(vault);

  await vault.getByRole("checkbox", { name: "I reviewed this backup summary" }).check();
  await vault.getByRole("button", { name: "Import backup" }).click();
  await expect(vault.getByText("Backup import complete", { exact: true })).toBeVisible();
  const rootAfter = await activeGenerationId(extensionWorker);
  expect(rootAfter).not.toBe(rootBeforePreview);
  await vault
    .getByRole("option", { name: new RegExp(`${safeIssuer} portable fields`, "u") })
    .click();
  await expect(vault.getByLabel("OTP type")).toHaveValue("hotp");
  await expect(vault.getByLabel("Algorithm")).toHaveValue("SHA256");
  await expect(vault.getByLabel("Digits")).toHaveValue("8");
  await expect(vault.getByLabel("Counter")).toHaveValue("7");
  await expect(vault.getByLabel("Tags")).toHaveValue("reviewed-tag");
  await expect(vault.getByLabel("Note")).toHaveValue("synthetic local note");
  await expect(vault.getByLabel("Favorite")).toBeChecked();
  await expect(vault.locator("#otp-secret")).toHaveCount(0);
  const persisted = await safeStorageState(extensionWorker);
  expect(persisted.containsIssuer).toBe(false);
  expect(persisted.containsSecret).toBe(false);
});

test("rejects wrong passwords and tampering, supports cancel, and imports the authorized legacy fixture", async ({
  context,
  extensionId,
  extensionWorker,
}) => {
  test.setTimeout(420_000);
  const vault = await openVault(context, extensionId);
  await setupVault(vault);
  const root = await activeGenerationId(extensionWorker);

  await selectBackup(vault, generatedBackup, "synthetic wrong password");
  await expect(vault.getByRole("alert")).toHaveText("Backup could not be processed safely.");
  expect(await activeGenerationId(extensionWorker)).toBe(root);

  const tampered = path.join(temporaryDirectory, "tampered.shardpass");
  const bytes = await readFile(generatedBackup);
  const tamperIndex = bytes.length - 16;
  bytes[tamperIndex] = (bytes[tamperIndex] ?? 0) ^ 1;
  await writeFile(tampered, bytes);
  await selectBackup(vault, tampered, backupPassword);
  await expect(vault.getByRole("alert")).toHaveText("Backup could not be processed safely.");
  expect(await activeGenerationId(extensionWorker)).toBe(root);

  await selectBackup(vault, generatedBackup, backupPassword);
  await vault.getByRole("button", { name: "Cancel import" }).click();
  await expect(vault.getByRole("heading", { name: "Review backup import" })).toHaveCount(0);
  expect(await activeGenerationId(extensionWorker)).toBe(root);

  const legacyFixture = JSON.parse(
    await readFile(
      path.resolve(import.meta.dirname, "../fixtures/legacy/backup-export.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const legacy = path.join(temporaryDirectory, "authorized-legacy-export.json");
  await writeFile(
    legacy,
    JSON.stringify(
      Object.fromEntries(
        Object.entries(legacyFixture).filter(
          ([key]) => key !== "synthetic" && key !== "testOnlyPassword",
        ),
      ),
    ),
  );
  await selectBackup(vault, legacy, legacyPassword);
  await expect(vault.getByRole("heading", { name: "Review backup import" })).toBeVisible();
  await expect(vault.getByLabel("Backup import summary")).toContainText(/[1-9][0-9]* ready/u);
  await vault.getByRole("button", { name: "Cancel import" }).click();
  expect(await activeGenerationId(extensionWorker)).toBe(root);
});

test("requires reconfirmation after a changed preview and redacts synchronously on lock", async ({
  context,
  extensionId,
  extensionWorker,
}) => {
  test.setTimeout(420_000);
  const vault = await openVault(context, extensionId);
  await setupVault(vault);
  await selectBackup(vault, generatedBackup, backupPassword);
  await vault.getByRole("checkbox", { name: "I reviewed this backup summary" }).check();

  const mutation = await vault.evaluate<Record<string, unknown>>(async () =>
    chrome.runtime.sendMessage({
      version: 1,
      kind: "otp.create",
      input: {
        issuer: "Backup Evidence",
        label: "portable fields",
        secret: "JBSWY3DPEHPK3PXP",
        otpType: "hotp",
        algorithm: "SHA256",
        digits: 8,
        period: 0,
        counter: 7,
        favorite: true,
        tags: ["reviewed-tag"],
        note: "synthetic local note",
      },
    }),
  );
  expect(mutation).toMatchObject({ kind: "otp.mutationResult" });
  const changedRoot = await activeGenerationId(extensionWorker);
  await vault.getByRole("button", { name: "Import backup" }).click();
  await expect(vault.getByRole("alert")).toContainText("summary changed");
  await expect(vault.getByRole("button", { name: "Import backup" })).toBeDisabled();
  expect(await activeGenerationId(extensionWorker)).toBe(changedRoot);

  await vault.getByRole("button", { name: "Cancel import" }).click();
  await vault.getByLabel("Backup file password").fill("synchronous redaction value");
  await lockVault(vault);
  await expect(vault.getByRole("heading", { name: "Unlock ShardPass" })).toBeVisible();
  await expect(vault.getByLabel("Backup file password")).toHaveCount(0);
  expect(await activeGenerationId(extensionWorker)).toBe(changedRoot);
});

test("invalidates preview capability on service restart without writing", async ({
  context,
  extensionId,
  extensionWorker,
}) => {
  test.setTimeout(420_000);
  const vault = await openVault(context, extensionId);
  await setupVault(vault);
  await selectBackup(vault, generatedBackup, backupPassword);
  await vault.getByRole("checkbox", { name: "I reviewed this backup summary" }).check();
  const root = await activeGenerationId(extensionWorker);
  await restartExtensionWorker(context, extensionId);
  await vault.reload();
  await expect(vault.getByRole("heading", { name: "Unlock ShardPass" })).toBeVisible();
  await expect(vault.getByRole("heading", { name: "Review backup import" })).toHaveCount(0);
  expect(await activeGenerationId(await currentWorker(context, extensionId))).toBe(root);
});

test("shows reviewed metadata-only backup UI accessibly at desktop and effective 200 percent compact layout", async ({
  context,
  extensionId,
}) => {
  test.setTimeout(420_000);
  const vault = await openVault(context, extensionId);
  await setupVault(vault);
  await selectBackup(vault, generatedBackup, backupPassword);
  await assertNoSensitiveRendering(vault);
  await vault.getByRole("heading", { name: "Encrypted backups" }).scrollIntoViewIfNeeded();
  await stabilizePage(vault);
  await expect(vault).toHaveScreenshot("vault-backup-preview.png", { fullPage: true });
  await expectNoSeriousAxeViolations(vault);

  await vault.setViewportSize({ width: 520, height: 1_688 });
  await setChromiumZoom(vault, 200);
  await selectBackup(vault, generatedBackup, backupPassword);
  await vault.getByRole("button", { name: "Import backup" }).scrollIntoViewIfNeeded();
  await expect(vault.getByRole("button", { name: "Import backup" })).toBeInViewport();
  await assertNoSensitiveRendering(vault);
  await stabilizePage(vault);
  await expect(vault).toHaveScreenshot("vault-backup-compact.png", {
    fullPage: true,
    scale: "css",
  });
  await expectNoSeriousAxeViolations(vault);
});

async function openVault(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/vault/index.html`);
  return page;
}

async function setupVault(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Create your vault" })).toBeVisible();
  await page.getByLabel("Master password", { exact: true }).fill(vaultPassword);
  await page.getByLabel("Confirm master password").fill(vaultPassword);
  await page.getByRole("button", { name: "Create vault" }).click();
  await expectVaultUnlocked(page);
  await expect(page.getByRole("heading", { name: "Encrypted backups" })).toBeVisible();
}

async function createOtp(
  page: Page,
  item: Readonly<{
    issuer: string;
    label: string;
    type: "HOTP";
    algorithm: string;
    digits: string;
    counter: string;
    tags: string;
    note: string;
    favorite: boolean;
  }>,
): Promise<void> {
  await page.getByRole("button", { name: /^New item/ }).click();
  await page.getByRole("menuitem", { name: "One-time code" }).click();
  await page.getByLabel("Issuer").fill(item.issuer);
  await page.getByLabel("Label").fill(item.label);
  await page.getByLabel("OTP type").selectOption({ label: item.type });
  await page.getByLabel("Algorithm").selectOption(item.algorithm);
  await page.getByLabel("Digits").fill(item.digits);
  await page.getByLabel("Counter").fill(item.counter);
  await page.getByLabel("Tags").fill(item.tags);
  await page.getByLabel("Note").fill(item.note);
  if (item.favorite) await page.getByLabel("Favorite").check();
  // Creating a code shows the secret field outright; only editing starts concealed.
  await page.locator("#otp-secret").fill(syntheticSecret);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // Saving selects the new code and shows its detail, titled by the issuer.
  await expect(page.getByRole("heading", { name: item.issuer, level: 2 })).toBeVisible();
}

async function downloadVerifiedBackup(page: Page): Promise<Download> {
  const link = page.getByRole("link", { name: "Download verified backup" });
  await expect(link).toBeVisible({ timeout: 180_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  return download;
}

async function selectBackup(page: Page, file: string, password: string): Promise<void> {
  // File first, then the password for it: the order a person expects.
  await page.getByLabel("Choose local backup file").setInputFiles(file);
  const passwordInput = page.getByLabel("Backup file password");
  await expect(passwordInput).toBeVisible();
  await passwordInput.fill(password);
  await page.getByRole("button", { name: "Unlock backup" }).click();
  await expect(passwordInput).toHaveValue("");
}

async function assertNoSensitiveRendering(page: Page): Promise<void> {
  const text = await page.locator("body").innerText();
  expect(text).not.toContain(syntheticSecret);
  expect(text).not.toContain(backupPassword);
  expect(text).not.toContain(vaultPassword);
  expect(text).not.toContain("synthetic local note");
  expect(text).not.toContain("reviewed-tag");
  expect(text).not.toContain("generated.shardpass");
}

async function safeStorageState(worker: Worker): Promise<{
  keys: readonly string[];
  rootRevision: number;
  containsIssuer: boolean;
  containsSecret: boolean;
}> {
  return worker.evaluate(
    async ({ issuer, secret }) => {
      const storage = await chrome.storage.local.get(null);
      const serialized = JSON.stringify(storage);
      const root = storage["shardpass:v1:root"] as { rootRevision?: unknown } | undefined;
      return {
        keys: Object.keys(storage).sort(),
        rootRevision: typeof root?.rootRevision === "number" ? root.rootRevision : 0,
        containsIssuer: serialized.includes(issuer),
        containsSecret: serialized.includes(secret),
      };
    },
    { issuer: safeIssuer, secret: syntheticSecret },
  );
}

async function activeGenerationId(worker: Worker): Promise<string> {
  return worker.evaluate(async () => {
    const storage = await chrome.storage.local.get("shardpass:v1:root");
    const root = storage["shardpass:v1:root"] as { activeGenerationId?: unknown } | undefined;
    return typeof root?.activeGenerationId === "string" ? root.activeGenerationId : "";
  });
}

async function currentWorker(context: BrowserContext, extensionId: string): Promise<Worker> {
  const existing = context
    .serviceWorkers()
    .find((worker) => worker.url().startsWith(`chrome-extension://${extensionId}/`));
  return existing ?? context.waitForEvent("serviceworker");
}

async function restartExtensionWorker(context: BrowserContext, extensionId: string): Promise<void> {
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  let targetId = "";
  session.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
    for (const version of versions) {
      if (
        version.scriptURL.startsWith(`chrome-extension://${extensionId}/`) &&
        typeof version.targetId === "string"
      )
        targetId = version.targetId;
    }
  });
  try {
    await session.send("ServiceWorker.enable");
    await expect.poll(() => targetId).not.toBe("");
    await session.send("Target.setDiscoverTargets", { discover: true });
    const result = await session.send("Target.closeTarget", { targetId });
    expect(result.success).toBe(true);
    await session.send("ServiceWorker.startWorker", {
      scopeURL: `chrome-extension://${extensionId}/`,
    });
    await expect
      .poll(() =>
        context
          .serviceWorkers()
          .find((worker) => worker.url().startsWith(`chrome-extension://${extensionId}/`))
          ?.evaluate(() => Promise.resolve(true))
          .catch(() => false),
      )
      .toBe(true);
  } finally {
    await session.detach();
    await page.close();
  }
}
