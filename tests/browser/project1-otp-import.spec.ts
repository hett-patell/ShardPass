import type { BrowserContext, Page, Worker } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  expect,
  expectNoSeriousAxeViolations,
  setChromiumZoom,
  stabilizePage,
  test,
} from "./fixtures";

const run = promisify(execFile);
const vaultPassword = "correct horse battery";
const marker = "SYNTHETICMARKEROTPIMPORT";
const secretA = "JBSWY3DPEHPK3PXP";
const secretB = "KRSXG5DSNFXGOIDB";
const migrationUri =
  "otpauth-migration://offline?data=CiwKFDEyMzQ1Njc4OTAxMjM0NTY3ODkwEgVhbGljZRoHRXhhbXBsZSABKAEwAhABGAEoBw%3D%3D";

type SafeRuntimeEvent = Readonly<{
  kind: string;
  keys: readonly string[];
  candidateCount: number;
  forbiddenKey: boolean;
}>;
type SafeInstrumentation = Readonly<{
  events: readonly SafeRuntimeEvent[];
  rootRevision: number;
}>;
type SafeWorkerEvent = Readonly<{ pathname: string; type: string }>;

test.use({ screenshot: "off", trace: "off", screenLockStabilized: true });
test.describe.configure({ mode: "serial" });

test("packages token-bound text preview, changed confirmation, encrypted persistence, and sender denial", async ({
  context,
  extensionId,
  extensionWorker,
}) => {
  test.setTimeout(420_000);
  const vault = await openVault(context, extensionId);
  await setupVault(vault);

  await installRuntimeInstrumentation(vault);
  const before = await safeStorageState(extensionWorker);
  await vault.getByRole("button", { name: "Import", exact: true }).click();
  const input = vault.getByLabel("Sensitive import input");
  const valid = otpUri(marker, "primary", secretA);
  await input.fill([valid, "otpauth://totp/rejected?issuer=Rejected", valid].join("\n"));
  const rootBeforePreview = await activeGenerationId(extensionWorker);
  await vault.getByRole("button", { name: "Preview import" }).click();
  await expect(input).toHaveValue("");
  expect(await activeGenerationId(extensionWorker)).toBe(rootBeforePreview);
  await expect(vault.getByRole("list", { name: "Safe import preview rows" })).toBeVisible();
  await expect(vault.getByText("Ready to import", { exact: true })).toHaveCount(1);
  await expect(vault.getByText("Malformed entry", { exact: true })).toHaveCount(1);
  await expect(vault.getByText("Repeated in this import", { exact: true })).toHaveCount(1);
  await expect(vault.getByLabel("Import summary", { exact: true })).toContainText("ACCEPTED1");
  await expect(vault.getByLabel("Import summary", { exact: true })).toContainText("DUPLICATE1");
  await expect(vault.getByLabel("Import summary", { exact: true })).toContainText("REJECTED1");
  expect((await runtimeInstrumentation(vault)).rootRevision).toBe(0);
  await vault.getByRole("button", { name: "Cancel import" }).click();
  expect(await activeGenerationId(extensionWorker)).toBe(rootBeforePreview);
  expect((await runtimeInstrumentation(vault)).rootRevision).toBe(0);

  await openImport(vault);
  await previewText(vault, valid);
  await assertNoSensitiveRendering(vault, [secretA, valid]);
  expect(await safeStorageState(extensionWorker)).toEqual(before);

  const confirm = vault.getByRole("button", { name: "Confirm import" });
  await expect(confirm).toBeDisabled();
  await vault.getByRole("checkbox", { name: "I reviewed the import summary" }).check();
  const rootBeforeFirstConfirm = await activeGenerationId(extensionWorker);
  await confirm.click();
  await expect(
    vault.getByRole("option", { name: new RegExp(`${marker} primary`, "u") }),
  ).toBeVisible();
  expect(await activeGenerationId(extensionWorker)).not.toBe(rootBeforeFirstConfirm);
  expect((await runtimeInstrumentation(vault)).rootRevision).toBe(1);

  await vault.getByRole("button", { name: "Import", exact: true }).click();
  await vault
    .getByLabel("Sensitive import input")
    .fill(
      [otpUri(marker, "changed", secretB), otpUri(marker, "changed-accepted", "MZXW6YTBOI")].join(
        "\n",
      ),
    );
  await vault.getByRole("button", { name: "Preview import" }).click();
  await vault.getByRole("checkbox", { name: "I reviewed the import summary" }).check();
  const secondVault = await openVault(context, extensionId);
  await createOtp(secondVault, marker, "changed", secretB);
  const changedRoot = await safeStorageState(extensionWorker);
  await expect
    .poll(() =>
      vault.evaluate(async (expectedIssuer) => {
        const response: { items?: readonly unknown[] } = await chrome.runtime.sendMessage({
          version: 1,
          kind: "otp.list",
          query: expectedIssuer,
        });
        return response.items?.length ?? 0;
      }, marker),
    )
    .toBe(2);
  await vault.getByRole("button", { name: "Confirm import" }).click();
  await expect(vault.getByRole("alert")).toContainText("summary changed");
  await expect(vault.getByText("Already in vault", { exact: true })).toHaveCount(1);
  await expect(vault.getByRole("button", { name: "Confirm import" })).toBeDisabled();
  expect(await safeStorageState(extensionWorker)).toEqual(changedRoot);
  expect((await runtimeInstrumentation(vault)).rootRevision).toBe(2);
  await vault.getByRole("checkbox", { name: "I reviewed the import summary" }).check();
  await vault.getByRole("button", { name: "Confirm import" }).click();
  await expect(
    vault.getByRole("option", { name: new RegExp(`${marker} changed-accepted`, "u") }),
  ).toBeVisible();
  expect((await runtimeInstrumentation(vault)).rootRevision).toBe(3);
  const staleTokenResult = await vault.evaluate<Record<string, unknown>>(async () => {
    const token = (
      window as typeof window & { __safeImportRuntimeEvents?: readonly SafeRuntimeEvent[] }
    ).__safeImportRuntimeEvents;
    void token;
    const response: unknown = await chrome.runtime.sendMessage({
      version: 1,
      kind: "otp.importConfirm",
      previewToken: "00000000-0000-4000-8000-000000000000",
    });
    return typeof response === "object" && response !== null
      ? (response as Record<string, unknown>)
      : {};
  });
  expect(staleTokenResult).toMatchObject({ kind: "error" });
  expect((await runtimeInstrumentation(vault)).rootRevision).toBe(3);

  await vault.getByRole("button", { name: "Import", exact: true }).click();
  await vault
    .getByLabel("Sensitive import input")
    .fill(otpUri(marker, "secondary", "MFRGGZDFMZTWQ2LK"));
  await vault.getByRole("button", { name: "Preview import" }).click();
  await vault.getByRole("checkbox", { name: "I reviewed the import summary" }).check();
  const rootBeforeConfirm = await activeGenerationId(extensionWorker);
  await vault.getByRole("button", { name: "Confirm import" }).click();
  await expect(
    vault.getByRole("option", { name: new RegExp(`${marker} secondary`, "u") }),
  ).toBeVisible();
  const rootAfterConfirm = await activeGenerationId(extensionWorker);
  expect(rootAfterConfirm).not.toBe(rootBeforeConfirm);
  const instrumented = await runtimeInstrumentation(vault);
  expect(instrumented.rootRevision).toBe(4);
  expect(instrumented.events.every((event) => !event.forbiddenKey)).toBe(true);
  expect(
    instrumented.events.map(({ kind, keys, candidateCount }) => ({ kind, keys, candidateCount })),
  ).toEqual([
    {
      kind: "otp.importPreview",
      keys: ["candidates", "format", "kind", "version"],
      candidateCount: 2,
    },
    {
      kind: "otp.importCancel",
      keys: ["kind", "previewToken", "version"],
      candidateCount: 0,
    },
    {
      kind: "otp.importPreview",
      keys: ["candidates", "format", "kind", "version"],
      candidateCount: 1,
    },
    {
      kind: "otp.importConfirm",
      keys: ["kind", "previewToken", "version"],
      candidateCount: 0,
    },
    {
      kind: "otp.importPreview",
      keys: ["candidates", "format", "kind", "version"],
      candidateCount: 2,
    },
    {
      kind: "otp.importConfirm",
      keys: ["kind", "previewToken", "version"],
      candidateCount: 0,
    },
    {
      kind: "otp.importConfirm",
      keys: ["kind", "previewToken", "version"],
      candidateCount: 0,
    },
    {
      kind: "otp.importConfirm",
      keys: ["kind", "previewToken", "version"],
      candidateCount: 0,
    },
    {
      kind: "otp.importPreview",
      keys: ["candidates", "format", "kind", "version"],
      candidateCount: 1,
    },
    {
      kind: "otp.importConfirm",
      keys: ["kind", "previewToken", "version"],
      candidateCount: 0,
    },
  ]);
  await expect(vault.getByRole("option", { name: new RegExp(marker, "u") })).toHaveCount(4);
  const persisted = await safeStorageState(extensionWorker);
  expect(persisted.containsMarker).toBe(false);
  expect(persisted.containsSecret).toBe(false);

  await restartExtensionWorker(context, extensionId);
  await vault.reload();
  await expect(vault.getByRole("heading", { name: "Unlock ShardPass" })).toBeVisible();
  await unlockVault(vault);
  await expect(vault.getByRole("option", { name: new RegExp(marker, "u") })).toHaveCount(4);
  await vault.getByRole("option", { name: new RegExp(`${marker} secondary`, "u") }).click();
  await vault.getByLabel("Label").fill("secondary-edited");
  await vault.getByRole("button", { name: "Save changes" }).click();
  await vault.reload();
  const edited = vault.getByRole("option", {
    name: new RegExp(`${marker} secondary-edited`, "u"),
  });
  await expect(edited).toBeVisible();
  await edited.click();
  await vault.getByRole("button", { name: "Delete OTP" }).click();
  await vault
    .getByRole("dialog", { name: "Delete OTP item" })
    .getByRole("button", { name: "Confirm delete" })
    .click();
  await expect(
    vault.getByRole("option", { name: new RegExp(`${marker} secondary-edited`, "u") }),
  ).toHaveCount(0);

  await assertPopupAndContentDenied(context, extensionId);
  await expect(vault.getByRole("heading", { name: "Vault controls" })).toBeVisible();
  await secondVault.close();
});

test("uses the packaged Google and ImageDecoder workers and rejects unsafe local image inputs", async ({
  context,
  extensionId,
}) => {
  test.setTimeout(360_000);
  const vault = await openVault(context, extensionId);
  await setupVault(vault);
  await installRuntimeInstrumentation(vault);
  const workerEvents: SafeWorkerEvent[] = [];
  vault.on("worker", (worker) => {
    const url = new URL(worker.url());
    workerEvents.push({ pathname: url.pathname, type: "module" });
  });

  await openImport(vault);
  await previewText(vault, migrationUri);
  await expect(vault.getByText("GOOGLE MIGRATION", { exact: true })).toBeVisible();
  await expect(vault.getByText("Example", { exact: true })).toBeVisible();
  await confirmImport(vault, 1);
  expect(workerEvents.some(({ pathname }) => pathname.includes("google-migration-worker"))).toBe(
    true,
  );
  expect(await vault.evaluate(() => document.documentElement.innerHTML.includes("protobuf"))).toBe(
    false,
  );

  const directory = await mkdtemp(path.join(tmpdir(), "shardpass-import-"));
  try {
    const png = path.join(directory, "local-image.png");
    await makeQrPng(png, otpUri("Image Lab", "static", secretB));
    await openImport(vault);
    await vault.getByLabel("Choose a local PNG image").setInputFiles(png);
    await expect(vault.getByText("LOCAL QR IMAGE", { exact: true })).toBeVisible();
    await expect(vault.getByText("Image Lab", { exact: true })).toBeVisible();
    await expect(vault.locator("body")).not.toContainText("local-image.png");
    expect(workerEvents.some(({ pathname }) => pathname.includes("otp-import-worker"))).toBe(true);
    const rootBeforeQrConfirm = await activeGenerationId(
      context
        .serviceWorkers()
        .find((worker) => worker.url().startsWith(`chrome-extension://${extensionId}/`))!,
    );
    await vault.getByRole("checkbox", { name: "I reviewed the import summary" }).check();
    await vault.getByRole("button", { name: "Confirm import" }).click();
    await expect(vault.getByRole("option", { name: /Image Lab static TOTP/u })).toBeVisible();
    const liveWorker = context
      .serviceWorkers()
      .find((worker) => worker.url().startsWith(`chrome-extension://${extensionId}/`));
    expect(liveWorker).toBeDefined();
    expect(await activeGenerationId(liveWorker!)).not.toBe(rootBeforeQrConfirm);

    const jpeg = path.join(directory, "invalid-image.jpg");
    await writeFile(jpeg, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const workersBefore = workerEvents.length;
    await openImport(vault);
    await vault.getByLabel("Choose a local PNG image").setInputFiles(jpeg);
    await expect(vault.getByRole("alert")).toHaveText("Choose a PNG image.");
    expect(workerEvents).toHaveLength(workersBefore);

    const oversized = path.join(directory, "oversized-image.png");
    await writeFile(oversized, Buffer.alloc(8_388_609));
    await openImport(vault);
    await vault.getByLabel("Choose a local PNG image").setInputFiles(oversized);
    await expect(vault.getByRole("alert")).toHaveText("Image is too large.");
    expect(workerEvents).toHaveLength(workersBefore);

    const oversizedAxis = path.join(directory, "axis-image.png");
    await writeFile(oversizedAxis, pngHeader(4_097, 1));
    await vault.getByLabel("Choose a local PNG image").setInputFiles(oversizedAxis);
    await expect(vault.getByRole("alert")).toBeVisible();

    const oversizedPixels = path.join(directory, "pixels-image.png");
    await writeFile(oversizedPixels, pngHeader(4_096, 4_096));
    await vault.getByLabel("Choose a local PNG image").setInputFiles(oversizedPixels);
    await expect(vault.getByRole("alert")).toBeVisible();

    const animated = path.join(directory, "animated-image.png");
    await makeAnimatedPng(animated);
    await vault.getByLabel("Choose a local PNG image").setInputFiles(animated);
    await expect(vault.getByRole("alert")).toBeVisible();
    expect(workerEvents.length).toBeGreaterThanOrEqual(workersBefore + 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  const manifest = await vault.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.permissions).toEqual(["storage", "alarms", "idle"]);
});

test("captures reviewed safe import previews without clipping at compact and 200 percent zoom", async ({
  context,
  extensionId,
}) => {
  test.setTimeout(300_000);
  const vault = await openVault(context, extensionId);
  await setupVault(vault);
  await openImport(vault);
  await previewText(vault, otpUri("Visual Lab", "safe-preview", secretA));
  await expect(vault.getByLabel("Sensitive import input")).toHaveCount(0);
  await vault.getByRole("checkbox", { name: "I reviewed the import summary" }).check();
  await vault.getByRole("button", { name: "Confirm import" }).focus();
  await stabilizePage(vault);
  await expect(vault).toHaveScreenshot("vault-otp-import-preview.png");

  await vault.setViewportSize({ width: 780, height: 1_688 });
  await setChromiumZoom(vault, 200);
  await expect(vault.getByRole("button", { name: "Import", exact: true })).toBeVisible();
  await expect(vault.getByRole("button", { name: "Create OTP" })).toBeVisible();
  await vault.getByRole("button", { name: "Confirm import" }).scrollIntoViewIfNeeded();
  await expect(vault.getByRole("button", { name: "Confirm import" })).toBeInViewport();
  await expectNoSeriousAxeViolations(vault);
  await openImport(vault);
  await previewText(vault, otpUri("Visual Lab", "safe-preview", secretA));
  await vault.getByRole("checkbox", { name: "I reviewed the import summary" }).check();
  await vault.getByRole("button", { name: "Confirm import" }).focus();
  await vault.getByRole("heading", { name: "Import OTP items" }).scrollIntoViewIfNeeded();
  await stabilizePage(vault);
  await expect(vault).toHaveScreenshot("vault-otp-import-compact.png", { scale: "css" });
});

test("recognizes canonical Aegis and fixed unsupported Ente wrappers and synchronously redacts on lock", async ({
  context,
  extensionId,
}) => {
  test.setTimeout(300_000);
  const vault = await openVault(context, extensionId);
  await setupVault(vault);

  await openImport(vault);
  await previewText(vault, JSON.stringify(aegisExport()));
  await expect(vault.getByText("AEGIS EXPORT", { exact: true })).toBeVisible();
  await expect(vault.getByText("Aegis Lab", { exact: true })).toBeVisible();
  await confirmImport(vault, 1);
  await vault.getByRole("option", { name: /Aegis Lab counter HOTP/u }).click();
  await expect(vault.getByLabel("OTP type")).toHaveValue("hotp");
  await expect(vault.getByLabel("Algorithm")).toHaveValue("SHA256");
  await expect(vault.getByLabel("Digits")).toHaveValue("8");
  await expect(vault.getByLabel("Counter")).toHaveValue("0");
  await expect(vault.getByLabel("Note")).toHaveValue("documented local note");
  await expect(vault.getByLabel("Tags")).toHaveValue("local-tag");
  await expect(vault.getByLabel("Favorite")).toBeChecked();
  await expect(vault.locator("#otp-secret")).toHaveCount(0);

  await restartExtensionWorker(context, extensionId);
  await vault.reload();
  await expect(vault.getByRole("heading", { name: "Unlock ShardPass" })).toBeVisible();
  await unlockVault(vault);
  await vault.getByRole("option", { name: /Aegis Lab counter HOTP/u }).click();
  await expect(vault.getByLabel("OTP type")).toHaveValue("hotp");
  await expect(vault.getByLabel("Algorithm")).toHaveValue("SHA256");
  await expect(vault.getByLabel("Digits")).toHaveValue("8");
  await expect(vault.getByLabel("Counter")).toHaveValue("0");
  await expect(vault.getByLabel("Note")).toHaveValue("documented local note");
  await expect(vault.getByLabel("Tags")).toHaveValue("local-tag");
  await expect(vault.getByLabel("Favorite")).toBeChecked();
  await expect(vault.locator("#otp-secret")).toHaveCount(0);

  const olderAegis = aegisExport();
  delete (olderAegis.db as Record<string, unknown>).icons_optimized;
  await openImport(vault);
  await previewText(vault, JSON.stringify(olderAegis));
  await expect(vault.getByText("AEGIS EXPORT", { exact: true })).toBeVisible();
  await expect(vault.getByText("Already in vault", { exact: true })).toBeVisible();
  await vault.getByRole("button", { name: "Cancel import" }).click();

  await openImport(vault);
  await vault.getByLabel("Sensitive import input").fill(
    JSON.stringify({
      version: 1,
      kdfParams: { memLimit: 4096, opsLimit: 3, salt: "fixed" },
      encryptedData: "fixed",
      encryptionNonce: "fixed",
    }),
  );
  await vault.getByRole("button", { name: "Preview import" }).click();
  await expect(vault.getByRole("alert")).toHaveText("Import could not be read safely.");
  await expect(vault.getByRole("button", { name: "Confirm import" })).toHaveCount(0);

  const decryptedEnteLines = [
    otpUri("Ente Decrypted", "first", "MZXW6YTBOI======".replaceAll("=", "")),
    otpUri("Ente Decrypted", "second", "ONSWG4TFOQ======".replaceAll("=", "")),
  ].join("\n");
  await vault.getByLabel("Sensitive import input").fill(decryptedEnteLines);
  await vault.getByRole("button", { name: "Preview import" }).click();
  await expect(vault.getByText("OTP AUTH URI", { exact: true })).toBeVisible();
  await vault.getByRole("checkbox", { name: "I reviewed the import summary" }).check();
  await vault.getByRole("button", { name: "Confirm import" }).click();
  await expect(vault.getByRole("option", { name: /Ente Decrypted first TOTP/u })).toBeVisible();
  await expect(vault.getByRole("option", { name: /Ente Decrypted second TOTP/u })).toBeVisible();

  await openImport(vault);
  await vault.getByLabel("Sensitive import input").fill(otpUri(marker, "lock", secretA));
  await vault.getByRole("button", { name: "Preview import" }).click();
  await expect(vault.getByRole("list", { name: "Safe import preview rows" })).toBeVisible();
  await vault.getByRole("button", { name: "Lock vault" }).click();
  await expect(vault.getByRole("heading", { name: "Unlock ShardPass" })).toBeVisible();
  expect(await vault.locator("body").textContent()).not.toContain(marker);
  expect(await vault.locator("body").textContent()).not.toContain(secretA);

  await unlockVault(vault);
  await openImport(vault);
  const rejectedInput = vault.getByLabel("Sensitive import input");
  await rejectedInput.fill("otpauth://totp/rejected?issuer=Rejected");
  await vault.getByRole("button", { name: "Preview import" }).click();
  await expect(vault.getByText("Malformed entry", { exact: true })).toBeVisible();
  await expect(vault.getByRole("button", { name: "Confirm import" })).toBeDisabled();
  await expectNoSeriousAxeViolations(vault);
  await expect(vault.getByRole("heading", { name: "Vault unlocked" })).toBeVisible();
  await openImport(vault);
  await stabilizePage(vault);
  await vault.setViewportSize({ width: 390, height: 844 });
  await expect(vault.getByRole("heading", { name: "Import OTP items" })).toBeVisible();
});

function otpUri(issuer: string, label: string, secret: string): string {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function aegisExport(): Record<string, unknown> {
  return {
    version: 1,
    header: { slots: null, params: null },
    db: {
      version: 3,
      entries: [
        {
          type: "hotp",
          uuid: "123e4567-e89b-42d3-a456-426614174001",
          name: "counter",
          issuer: "Aegis Lab",
          note: "documented local note",
          icon: null,
          favorite: true,
          info: { secret: secretB, algo: "SHA256", digits: 8, counter: 0 },
          groups: ["123e4567-e89b-42d3-a456-426614174101"],
        },
      ],
      groups: [
        {
          uuid: "123e4567-e89b-42d3-a456-426614174101",
          name: "local-tag",
        },
      ],
      icons_optimized: true,
    },
  };
}

function pngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]).copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

async function makeAnimatedPng(filename: string): Promise<void> {
  await run("python3", [
    "-c",
    "from PIL import Image; import sys; a=Image.new('RGBA',(16,16),'white'); b=Image.new('RGBA',(16,16),'black'); a.save(sys.argv[1],save_all=True,append_images=[b],duration=100,loop=0)",
    filename,
  ]);
}

async function makeQrPng(filename: string, payload: string): Promise<void> {
  await run("python3", [
    "-c",
    "import qrcode,sys; qrcode.make(sys.argv[2]).save(sys.argv[1])",
    filename,
    payload,
  ]);
  expect((await readFile(filename)).subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
}

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
  await expect(page.getByRole("heading", { name: "Vault unlocked" })).toBeVisible({
    timeout: 120_000,
  });
}

async function unlockVault(page: Page): Promise<void> {
  await page.getByLabel("Master password", { exact: true }).fill(vaultPassword);
  await page.getByRole("button", { name: "Unlock vault" }).click();
  await expect(page.getByRole("heading", { name: "Vault unlocked" })).toBeVisible({
    timeout: 120_000,
  });
}

async function openImport(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import OTP items" })).toBeVisible();
}

async function previewText(page: Page, text: string): Promise<void> {
  const input = page.getByLabel("Sensitive import input");
  await input.fill(text);
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(input).toHaveValue("");
}

async function confirmImport(page: Page, count: number): Promise<void> {
  await page.getByRole("checkbox", { name: "I reviewed the import summary" }).check();
  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByRole("listbox", { name: "OTP items" }).getByRole("option")).toHaveCount(
    count,
  );
}

async function createOtp(page: Page, issuer: string, label: string, secret: string): Promise<void> {
  await page.getByRole("button", { name: "Create OTP" }).click();
  await page.getByLabel("Issuer").fill(issuer);
  await page.getByLabel("Label").fill(label);
  await page.getByRole("button", { name: "Reveal secret" }).click();
  await page.locator("#otp-secret").fill(secret);
  await page.getByRole("button", { name: "Conceal secret" }).click();
  await page.getByRole("button", { name: "Save OTP" }).click();
  await expect(page.getByRole("heading", { name: "Edit OTP" })).toBeVisible();
}

async function installRuntimeInstrumentation(page: Page): Promise<void> {
  await page.evaluate(() => {
    const events: SafeRuntimeEvent[] = [];
    let rootRevision = 0;
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    Object.defineProperty(window, "__safeImportRuntimeEvents", { value: events });
    Object.defineProperty(window, "__safeImportRootRevision", { get: () => rootRevision });
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && Object.hasOwn(changes, "shardpass:v1:root")) rootRevision += 1;
    });
    chrome.runtime.sendMessage = ((message: unknown, ...rest: unknown[]) => {
      if (typeof message === "object" && message !== null && "kind" in message) {
        const record = message as Record<string, unknown>;
        const kind = typeof record.kind === "string" ? record.kind : "invalid";
        if (kind.startsWith("otp.import")) {
          const candidates = Array.isArray(record.candidates) ? record.candidates : [];
          events.push({
            kind,
            keys: Object.keys(record).sort(),
            candidateCount: candidates.length,
            forbiddenKey: Object.keys(record).some((key) =>
              /raw|uri|file|filename|seed|root|document|extension/iu.test(key),
            ),
          });
        }
      }
      return original(...([message, ...rest] as Parameters<typeof chrome.runtime.sendMessage>));
    }) as typeof chrome.runtime.sendMessage;
  });
}

async function runtimeInstrumentation(page: Page): Promise<SafeInstrumentation> {
  return page.evaluate(() => {
    const instrumentation = window as typeof window & {
      __safeImportRuntimeEvents?: readonly SafeRuntimeEvent[];
      __safeImportRootRevision?: number;
    };
    return {
      events: structuredClone(instrumentation.__safeImportRuntimeEvents ?? []),
      rootRevision: instrumentation.__safeImportRootRevision ?? 0,
    };
  });
}

async function safeStorageState(worker: Worker): Promise<{
  rootChanges: number;
  containsMarker: boolean;
  containsSecret: boolean;
}> {
  return worker.evaluate(
    async ({ expectedMarker, expectedSecrets }) => {
      const storage = await chrome.storage.local.get(null);
      const serialized = JSON.stringify(storage);
      const root = storage["shardpass:v1:root"] as { rootRevision?: unknown } | undefined;
      return {
        rootChanges: typeof root?.rootRevision === "number" ? root.rootRevision : 0,
        containsMarker: serialized.includes(expectedMarker),
        containsSecret: expectedSecrets.some((value) => serialized.includes(value)),
      };
    },
    { expectedMarker: marker, expectedSecrets: [secretA, secretB] },
  );
}

async function activeGenerationId(worker: Worker): Promise<string> {
  return worker.evaluate(async () => {
    const storage = await chrome.storage.local.get("shardpass:v1:root");
    const root = storage["shardpass:v1:root"] as { activeGenerationId?: unknown } | undefined;
    return typeof root?.activeGenerationId === "string" ? root.activeGenerationId : "";
  });
}

async function restartExtensionWorker(
  context: BrowserContext,
  extensionId: string,
): Promise<Worker> {
  const controlPage = await context.newPage();
  const controlSession = await context.newCDPSession(controlPage);
  let targetId = "";
  controlSession.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
    for (const version of versions) {
      if (
        version.scriptURL.startsWith(`chrome-extension://${extensionId}/`) &&
        typeof version.targetId === "string"
      ) {
        targetId = version.targetId;
      }
    }
  });
  try {
    await controlSession.send("ServiceWorker.enable");
    await expect.poll(() => targetId).not.toBe("");
    await controlSession.send("Target.setDiscoverTargets", { discover: true });
    const closed = await controlSession.send("Target.closeTarget", { targetId });
    expect(closed.success).toBe(true);
    await controlSession.send("ServiceWorker.startWorker", {
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
    const worker = context
      .serviceWorkers()
      .find((candidate) => candidate.url().startsWith(`chrome-extension://${extensionId}/`));
    if (worker === undefined) throw new Error("Extension worker did not restart.");
    return worker;
  } finally {
    await controlSession.detach();
    await controlPage.close();
  }
}

async function assertNoSensitiveRendering(page: Page, values: readonly string[]): Promise<void> {
  const projection = await page.locator("body").evaluate((body) => ({
    text: body.textContent ?? "",
    html: body.outerHTML,
    accessibleAttributes: Array.from(
      body.querySelectorAll("[aria-label],[aria-description],[title],[alt]"),
      (element) =>
        ["aria-label", "aria-description", "title", "alt"]
          .map((name) => element.getAttribute(name) ?? "")
          .join(" "),
    ).join(" "),
  }));
  for (const value of values) {
    expect(projection.text).not.toContain(value);
    expect(projection.html).not.toContain(value);
    expect(projection.accessibleAttributes).not.toContain(value);
  }
}

async function assertPopupAndContentDenied(
  context: BrowserContext,
  extensionId: string,
): Promise<void> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
  const popupResult = await popup.evaluate<Record<string, unknown>>(async () => {
    const response: unknown = await chrome.runtime.sendMessage({
      version: 1,
      kind: "otp.importConfirm",
      previewToken: crypto.randomUUID(),
    });
    return typeof response === "object" && response !== null
      ? (response as Record<string, unknown>)
      : {};
  });
  expect(popupResult).toMatchObject({ kind: "error", error: { code: "UNAUTHORIZED_SENDER" } });
  await expect(popup.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
  await popup.close();

  const site = await context.newPage();
  const cdp = await context.newCDPSession(site);
  await cdp.send("Runtime.enable");
  const isolated: number[] = [];
  cdp.on("Runtime.executionContextCreated", ({ context }) => {
    const auxiliary = context.auxData as { type?: unknown } | undefined;
    if (auxiliary?.type === "isolated") isolated.push(context.id);
  });
  await site.goto("http://127.0.0.1:4173/tests/fixtures/sites/foundation.html?picker=off");
  await expect.poll(() => isolated.length).toBeGreaterThan(0);
  let result: unknown;
  for (const contextId of isolated) {
    const probe = await cdp.send("Runtime.evaluate", {
      contextId,
      returnByValue: true,
      expression: "typeof chrome?.runtime?.sendMessage === 'function'",
    });
    if (probe.result.value !== true) continue;
    result = (
      await cdp.send("Runtime.evaluate", {
        contextId,
        awaitPromise: true,
        returnByValue: true,
        expression: `(async () => {
          let localReadable = true;
          try { await chrome.storage.local.get(null); } catch { localReadable = false; }
          const response = await chrome.runtime.sendMessage({version:1,kind:"otp.importConfirm",previewToken:"00000000-0000-4000-8000-000000000000"});
          return {localReadable, code: response?.error?.code};
        })()`,
      })
    ).result.value;
    break;
  }
  expect(result).toEqual({ localReadable: false, code: "UNAUTHORIZED_SENDER" });
  await cdp.detach();
  await site.close();
}
