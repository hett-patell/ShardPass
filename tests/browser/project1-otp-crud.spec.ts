import type { BrowserContext, Locator, Page, Worker } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  expect,
  expectNoSeriousAxeViolations,
  expectVaultUnlocked,
  lockVault,
  stabilizePage,
  test,
} from "./fixtures";

const vaultPassword = "correct horse battery";

const syntheticSecret = (() => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
})();

const itemNames = {
  totp: { issuer: "Northwind Lab", label: "synthetic-primary", tag: "regression" },
  hotp: { issuer: "Contoso Device", label: "synthetic-counter" },
  steam: { issuer: "Steam", label: "synthetic-game" },
} as const;

test.use({ screenshot: "off", trace: "off", screenLockStabilized: true });
test.describe.configure({ mode: "serial" });

test("covers packaged OTP CRUD, popup, session redaction, and encrypted persistence", async ({
  context,
  extensionId,
  extensionWorker,
}) => {
  test.setTimeout(420_000);
  const vault = await openVault(context, extensionId);
  await setupVault(vault);

  await createOtp(vault, {
    issuer: itemNames.totp.issuer,
    label: itemNames.totp.label,
    type: "TOTP",
    period: 45,
    tags: itemNames.totp.tag,
  });
  await assertSecretControl(vault);
  await createOtp(vault, {
    issuer: itemNames.hotp.issuer,
    label: itemNames.hotp.label,
    type: "HOTP",
    counter: 7,
  });
  await createOtp(vault, {
    issuer: itemNames.steam.issuer,
    label: itemNames.steam.label,
    type: "Steam",
  });

  const search = vault.getByRole("searchbox", { name: "Search OTP items" });
  await search.fill("ＮＯＲＴＨＷＩＮＤ");
  await expect(
    vault.getByRole("option", { name: new RegExp(itemNames.totp.issuer, "u") }),
  ).toBeVisible();
  await search.fill(itemNames.totp.tag);
  await expect(vault.getByText(itemNames.totp.label, { exact: true })).toBeVisible();
  await search.fill("");

  const listbox = vault.getByRole("listbox", { name: "OTP items" });
  await listbox.focus();
  await listbox.press("End");
  await expect(vault.getByRole("heading", { name: "Edit one-time code" })).toBeVisible();

  await selectItem(vault, itemNames.totp.issuer);
  const staleRevision = await revisionText(vault);
  const secondVault = await openVault(context, extensionId);
  await expectVaultUnlocked(secondVault);
  await selectItem(secondVault, itemNames.totp.issuer);
  await secondVault.getByLabel("Label").fill("synthetic-second-page");
  await secondVault.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => revisionText(secondVault)).not.toBe(staleRevision);

  const attemptedLabel = "synthetic-conflicted-attempt";
  await vault.getByLabel("Label").fill(attemptedLabel);
  await vault.getByRole("button", { name: "Save", exact: true }).click();
  await expect(vault.getByRole("alert")).toContainText("attempted values are retained");
  await expect(vault.getByLabel("Label")).toHaveValue(attemptedLabel);
  await expect.poll(() => revisionText(vault)).not.toBe(staleRevision);
  await vault.getByRole("button", { name: "Save", exact: true }).click();
  await expect(vault.getByLabel("Label")).toHaveValue(attemptedLabel);
  await secondVault.close();

  const beforePopup = await readHotpCounter(vault, itemNames.hotp.issuer);
  const popup = await context.newPage();
  await popup.addInitScript(() => {
    const clipboard = navigator.clipboard;
    let writes = 0;
    let validPayloads = 0;
    Object.defineProperty(window, "__safeClipboardWrites", {
      get: () => ({ writes, validPayloads }),
      configurable: false,
    });
    Object.defineProperty(clipboard, "write", {
      value: async (items: unknown) => {
        writes += 1;
        if (!Array.isArray(items) || items.length !== 1) return;
        const candidate: unknown = items[0];
        if (
          typeof candidate !== "object" ||
          candidate === null ||
          !("types" in candidate) ||
          !("getType" in candidate)
        )
          return;
        const item = candidate as {
          types: readonly string[];
          getType(type: string): Promise<Blob>;
        };
        if (item.types.length !== 1 || item.types[0] !== "text/plain") return;
        const blob = await item.getType("text/plain");
        if (blob.type === "text/plain" && blob.size >= 5 && blob.size <= 10) validPayloads += 1;
      },
      configurable: false,
    });
  });
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await expect(popup.getByText(attemptedLabel, { exact: true })).toBeVisible();
  await expect(popup.getByText(itemNames.hotp.label, { exact: true })).toBeVisible();
  await expect(popup.getByText("Available in full vault", { exact: true })).toBeVisible();
  await expect(popup.getByText(itemNames.steam.label, { exact: true })).toBeVisible();
  await expect(
    popup.getByRole("button", { name: new RegExp(`Copy code for ${itemNames.totp.issuer}`, "u") }),
  ).toBeEnabled();
  await popup
    .getByRole("button", { name: new RegExp(`Copy code for ${itemNames.totp.issuer}`, "u") })
    .click();
  await expect(
    popup.getByRole("region", { name: "One-time codes" }).getByRole("status"),
  ).toHaveText("Code copied");
  expect(
    await popup.evaluate<{ writes: number; validPayloads: number }>(() => {
      const candidate: unknown = Reflect.get(window, "__safeClipboardWrites");
      if (typeof candidate !== "object" || candidate === null)
        return { writes: -1, validPayloads: -1 };
      const record = candidate as { writes?: unknown; validPayloads?: unknown };
      return {
        writes: typeof record.writes === "number" ? record.writes : -1,
        validPayloads: typeof record.validPayloads === "number" ? record.validPayloads : -1,
      };
    }),
  ).toEqual({ writes: 1, validPayloads: 1 });
  const totpRow = popup.getByRole("listitem", {
    name: new RegExp(itemNames.totp.issuer, "u"),
  });
  const countdown = totpRow.locator('[data-testid="otp-countdown"]');
  const initialCountdown = await safeCountdownState(countdown);
  await expect
    .poll(async () => (await safeCountdownState(countdown)).remaining)
    .toBeLessThan(initialCountdown.remaining);
  await expect
    .poll(async () => (await safeCountdownState(countdown)).remaining, { timeout: 50_000 })
    .toBeLessThanOrEqual(6);
  await expect(countdown).toHaveAttribute("data-urgent", "true");
  const expiryState = await waitForCountdownExpiry(countdown);
  expect(expiryState.before).toBeLessThanOrEqual(1);
  expect(expiryState.after).toBeGreaterThan(expiryState.before);
  await popup.setViewportSize({ width: 360, height: 640 });
  await stabilizePage(popup);
  await expect(popup).toHaveScreenshot("popup-otp.png", {
    mask: [popup.locator('[class*="code"]')],
  });
  expect(await readHotpCounter(vault, itemNames.hotp.issuer)).toBe(beforePopup);

  await assertLowLevelHotpContentDenial(context, extensionId, vault);

  await vault.setViewportSize({ width: 1280, height: 900 });
  await stabilizePage(vault);
  await selectItem(vault, itemNames.totp.issuer);
  await expect(vault).toHaveScreenshot("vault-otp-desktop.png");
  await vault.setViewportSize({ width: 360, height: 780 });
  await expect(vault).toHaveScreenshot("vault-otp-compact.png");
  await vault.setViewportSize({ width: 1280, height: 900 });

  // Revision-bound clipboard copy: bump the item revision from the vault page
  // (document-bound evaluate, no focus change) while the popup still shows the
  // stale displayed revision. The popup sends the displayed revision as
  // expectedRevision; the service must reject with OTP_CONFLICT and the popup
  // must complete zero additional clipboard writes without retaining the code.
  await popup.bringToFront();
  await expect(
    popup.getByRole("button", { name: new RegExp(`Copy code for ${itemNames.totp.issuer}`, "u") }),
  ).toBeEnabled();
  await stabilizePage(popup);
  const beforeConflict = await popup.evaluate<{ writes: number; validPayloads: number }>(() => {
    const candidate: unknown = Reflect.get(window, "__safeClipboardWrites");
    if (typeof candidate !== "object" || candidate === null)
      return { writes: -1, validPayloads: -1 };
    const record = candidate as { writes?: unknown; validPayloads?: unknown };
    return {
      writes: typeof record.writes === "number" ? record.writes : -1,
      validPayloads: typeof record.validPayloads === "number" ? record.validPayloads : -1,
    };
  });
  expect(beforeConflict.validPayloads).toBe(1);
  const bump = await vault.evaluate(async (issuer: string) => {
    const listed: {
      items?: Array<{ id: string; issuer: string; revision: number }>;
    } = await chrome.runtime.sendMessage({ version: 1, kind: "otp.list", query: issuer });
    const item = listed.items?.find((candidate) => candidate.issuer === issuer);
    if (item === undefined) throw new Error("totp item not found for conflict bump");
    const editor: { item?: Record<string, unknown> } = await chrome.runtime.sendMessage({
      version: 1,
      kind: "otp.getEditor",
      itemId: item.id,
    });
    const editorItem = editor.item;
    if (editorItem === undefined) throw new Error("totp editor not found for conflict bump");
    const input: Record<string, unknown> = { ...editorItem };
    delete input.id;
    delete input.revision;
    const updated: { item?: { revision: number } } = await chrome.runtime.sendMessage({
      version: 1,
      kind: "otp.update",
      itemId: item.id,
      expectedRevision: item.revision,
      input,
    });
    return { oldRevision: item.revision, newRevision: updated.item?.revision ?? -1 };
  }, itemNames.totp.issuer);
  expect(bump.newRevision).toBe(bump.oldRevision + 1);
  await popup
    .getByRole("button", { name: new RegExp(`Copy code for ${itemNames.totp.issuer}`, "u") })
    .click();
  await expect(
    popup.getByRole("region", { name: "One-time codes" }).getByRole("status"),
  ).toHaveText(/Try again\.$/u);
  const afterConflict = await popup.evaluate<{ writes: number; validPayloads: number }>(() => {
    const candidate: unknown = Reflect.get(window, "__safeClipboardWrites");
    if (typeof candidate !== "object" || candidate === null)
      return { writes: -1, validPayloads: -1 };
    const record = candidate as { writes?: unknown; validPayloads?: unknown };
    return {
      writes: typeof record.writes === "number" ? record.writes : -1,
      validPayloads: typeof record.validPayloads === "number" ? record.validPayloads : -1,
    };
  });
  expect(afterConflict.validPayloads).toBe(beforeConflict.validPayloads);

  await seedSyntheticLegacySource(extensionWorker);
  await vault.reload();
  await expectVaultUnlocked(vault);
  await expect(vault.getByRole("heading", { name: "Migrate legacy vault" })).toBeVisible();
  await vault.getByRole("heading", { name: "Migrate legacy vault" }).scrollIntoViewIfNeeded();
  await expect(vault).toHaveScreenshot("vault-otp-migration-coexistence.png", { fullPage: true });
  await selectItem(vault, itemNames.totp.issuer);

  const deleteButton = vault.getByRole("button", { name: "Delete OTP" });
  await deleteButton.click();
  const dialog = vault.getByRole("dialog", { name: "Delete OTP item" });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.press("Escape");
  await expect(deleteButton).toBeFocused();
  await deleteButton.click();
  await dialog.getByRole("button", { name: "Confirm delete" }).click();
  await expect(vault.getByText(attemptedLabel, { exact: true })).toHaveCount(0);

  await lockVault(vault);
  await expect(vault.getByRole("heading", { name: "Unlock ShardPass" })).toBeVisible();
  await expect(vault.getByText(itemNames.hotp.issuer, { exact: true })).toHaveCount(0);
  await expect(vault.getByText(itemNames.steam.label, { exact: true })).toHaveCount(0);
  await expect(vault.locator("#otp-secret")).toHaveCount(0);
  await expect(popup.getByText(itemNames.hotp.issuer, { exact: true })).toHaveCount(0);
  await expect(popup.locator('[class*="code"]')).toHaveCount(0);

  const storageEvidence = await extensionWorker.evaluate(async (needle) => {
    const local = JSON.stringify(await chrome.storage.local.get(null));
    const session = JSON.stringify(await chrome.storage.session.get(null));
    return {
      localContainsSecret: local.includes(needle),
      sessionContainsSecret: session.includes(needle),
    };
  }, syntheticSecret);
  expect(storageEvidence).toEqual({ localContainsSecret: false, sessionContainsSecret: false });

  await vault.reload();
  await unlockVault(vault);
  await expect(vault.getByText(itemNames.hotp.issuer, { exact: true })).toBeVisible();
  await expect(vault.getByText(itemNames.steam.label, { exact: true })).toBeVisible();
  await expect(vault.getByText(attemptedLabel, { exact: true })).toHaveCount(0);

  await assertSenderDenials(popup, vault);
  await expectNoSeriousAxeViolations(vault);
  await expectNoSeriousAxeViolations(popup);
});

async function safeCountdownState(locator: Locator): Promise<{
  remaining: number;
  urgent: boolean;
}> {
  return locator.evaluate((element) => ({
    remaining: Number(element.querySelector("span")?.textContent ?? "-1"),
    urgent: element.getAttribute("data-urgent") === "true",
  }));
}

async function waitForCountdownExpiry(locator: Locator): Promise<{
  before: number;
  after: number;
}> {
  const deadline = Date.now() + 10_000;
  let previous = (await safeCountdownState(locator)).remaining;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const current = (await safeCountdownState(locator)).remaining;
    if (current > previous) return { before: previous, after: current };
    previous = current;
  }
  return { before: previous, after: previous };
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
  await expectVaultUnlocked(page);
}

async function unlockVault(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Unlock ShardPass" })).toBeVisible();
  await page.getByLabel("Master password", { exact: true }).fill(vaultPassword);
  await page.getByRole("button", { name: "Unlock vault" }).click();
  await expectVaultUnlocked(page);
}

async function createOtp(
  page: Page,
  input: Readonly<{
    issuer: string;
    label: string;
    type: "TOTP" | "HOTP" | "Steam";
    period?: number;
    counter?: number;
    tags?: string;
  }>,
): Promise<void> {
  await page.getByRole("button", { name: /^New item/ }).click();
  await page.getByRole("menuitem", { name: "One-time code" }).click();
  await page.getByLabel("Issuer").fill(input.issuer);
  await page.getByLabel("Label").fill(input.label);
  await page.getByLabel("OTP type").selectOption({ label: input.type });
  if (input.period !== undefined)
    await page.getByLabel("Period (seconds)").fill(String(input.period));
  if (input.counter !== undefined) await page.getByLabel("Counter").fill(String(input.counter));
  if (input.tags !== undefined) await page.getByLabel("Tags").fill(input.tags);
  // Creating a code shows the secret field outright; only editing starts concealed.
  await page.locator("#otp-secret").fill(syntheticSecret);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // Saving selects the new code and shows its detail, titled by the issuer.
  await expect(page.getByRole("heading", { name: input.issuer, level: 2 })).toBeVisible();
}

async function assertSecretControl(page: Page): Promise<void> {
  await expect(page.locator("#otp-secret")).toHaveCount(0);
  await page.getByRole("button", { name: "Reveal secret" }).click();
  try {
    const attributes = await page.locator("#otp-secret").evaluate((element) => ({
      autocomplete: element.getAttribute("autocomplete"),
      name: element.getAttribute("name"),
      spellcheck: element.getAttribute("spellcheck"),
      type: element.getAttribute("type"),
    }));
    expect(attributes).toEqual({
      autocomplete: "off",
      name: "otp-secret-base32",
      spellcheck: "false",
      type: "text",
    });
  } finally {
    await page.getByRole("button", { name: "Conceal secret" }).click();
  }
  await expect(page.locator("#otp-secret")).toHaveCount(0);
}

async function selectItem(page: Page, issuer: string): Promise<void> {
  await page.getByRole("option", { name: new RegExp(issuer, "u") }).click();
  await expect(page.getByRole("heading", { name: "Edit one-time code" })).toBeVisible();
}

async function revisionText(page: Page): Promise<string> {
  return (await page.getByText(/OTP \/ REVISION [0-9]+/u).textContent()) ?? "";
}

async function readHotpCounter(page: Page, issuer: string): Promise<number> {
  return page.evaluate(async (expectedIssuer) => {
    const listed: { items?: Array<{ id: string; issuer: string; otpType: string }> } =
      await chrome.runtime.sendMessage({
        version: 1,
        kind: "otp.list",
        query: expectedIssuer,
      });
    const item = listed.items?.find(
      (candidate) => candidate.issuer === expectedIssuer && candidate.otpType === "hotp",
    );
    if (item === undefined) return -1;
    const editor: { item?: { counter?: number } } = await chrome.runtime.sendMessage({
      version: 1,
      kind: "otp.getEditor",
      itemId: item.id,
    });
    return editor.item?.counter ?? -1;
  }, issuer);
}

async function assertLowLevelHotpContentDenial(
  context: BrowserContext,
  extensionId: string,
  vault: Page,
): Promise<void> {
  const listed = await vault.evaluate<{ items: Array<{ id: string; otpType: string }> }>(async () =>
    chrome.runtime.sendMessage({ version: 1, kind: "otp.list", query: "" }),
  );
  const hotpId = listed.items.find((item) => item.otpType === "hotp")?.id;
  expect(typeof hotpId).toBe("string");

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Runtime.enable");
  const isolated: number[] = [];
  cdp.on("Runtime.executionContextCreated", ({ context: executionContext }) => {
    const auxiliary = executionContext.auxData as { type?: unknown } | undefined;
    if (auxiliary?.type === "isolated") isolated.push(executionContext.id);
  });
  await page.goto("http://127.0.0.1:4173/tests/fixtures/sites/foundation.html?picker=off");
  await expect.poll(() => isolated.length).toBeGreaterThan(0);
  let contentContext: number | undefined;
  for (const candidate of isolated) {
    const probe = await cdp.send("Runtime.evaluate", {
      contextId: candidate,
      returnByValue: true,
      expression: "typeof chrome?.runtime?.sendMessage === 'function'",
    });
    if (probe.result.value === true) contentContext = candidate;
  }
  if (contentContext === undefined || hotpId === undefined)
    throw new Error("Content runtime unavailable");
  const invoke = async (request: object) => {
    const result = await cdp.send("Runtime.evaluate", {
      contextId: contentContext,
      awaitPromise: true,
      returnByValue: true,
      expression: `chrome.runtime.sendMessage(${JSON.stringify(request)})`,
    });
    return result.result.value as Record<string, unknown>;
  };

  const before = await readHotpCounter(vault, itemNames.hotp.issuer);
  for (const request of [
    { version: 1, kind: "otp.reserveHotp", itemId: hotpId },
    { version: 1, kind: "otp.commitHotp", reservationId: crypto.randomUUID() },
    { version: 1, kind: "otp.cancelHotp", reservationId: crypto.randomUUID() },
  ]) {
    const denied = await invoke(request);
    expect(denied).toMatchObject({ kind: "error", error: { code: "UNAUTHORIZED_SENDER" } });
  }
  expect(await readHotpCounter(vault, itemNames.hotp.issuer)).toBe(before);

  const contentStorage = await cdp.send("Runtime.evaluate", {
    contextId: contentContext,
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      let localReadable = true;
      let sessionReadable = true;
      try { await chrome.storage.local.get(null); } catch { localReadable = false; }
      try { await chrome.storage.session.get(null); } catch { sessionReadable = false; }
      return { localReadable, sessionReadable };
    })()`,
  });
  expect(contentStorage.result.value).toEqual({ localReadable: false, sessionReadable: false });
  await cdp.detach();
  await page.close();
  expect(extensionId).toMatch(/^[a-p]{32}$/u);
}

async function seedSyntheticLegacySource(worker: Worker): Promise<void> {
  const fixturePath = path.resolve(import.meta.dirname, "../fixtures/legacy/vault-standard.json");
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as { vault: unknown };
  await worker.evaluate(async (vault) => chrome.storage.local.set({ vault }), fixture.vault);
}

async function assertSenderDenials(popup: Page, vault: Page): Promise<void> {
  const popupCreate = await popup.evaluate<Record<string, unknown>>(async () =>
    chrome.runtime.sendMessage({
      version: 1,
      kind: "otp.create",
      input: {
        issuer: "Denied",
        label: "Denied",
        secret: "AAAAAAAA",
        otpType: "totp",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        favorite: false,
        tags: [],
        note: "",
      },
    }),
  );
  expect(popupCreate).toMatchObject({ kind: "error", error: { code: "UNAUTHORIZED_SENDER" } });
  const mismatch = await vault.evaluate<Record<string, unknown>>(async () =>
    chrome.runtime.sendMessage({ version: 1, kind: "otp.getCode", itemId: crypto.randomUUID() }),
  );
  expect(mismatch).toMatchObject({ kind: "error" });
}
