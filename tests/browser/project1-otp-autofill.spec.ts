import type { BrowserContext, CDPSession, Locator, Page } from "@playwright/test";

import axe from "axe-core";

import { expect, stabilizePage, test } from "./fixtures";

const vaultPassword = "synthetic local passphrase";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const syntheticSecret = Array.from(
  crypto.getRandomValues(new Uint8Array(32)),
  (value) => alphabet[value % alphabet.length],
).join("");

const accounts = {
  favorite: { issuer: "Favorite account", label: "primary", type: "TOTP" },
  counter: { issuer: "Counter account", label: "device", type: "HOTP" },
  game: { issuer: "Game account", label: "desktop", type: "Steam" },
} as const;

test.use({ screenshot: "off", trace: "off", screenLockStabilized: true });
test.describe.configure({ mode: "serial" });

test("packaged safe OTP fill matrix", async ({ context, extensionId }) => {
  test.setTimeout(420_000);
  const vault = await openVault(context, extensionId);
  await setupVault(vault);
  await createOtp(vault, { ...accounts.counter, counter: 4 });
  await createOtp(vault, accounts.game);
  await createOtp(vault, { ...accounts.favorite, favorite: true, tags: "local-only" });

  const page = await context.newPage();
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.goto("/tests/fixtures/sites/otp.html");

  await assertEligibilityMatrix(page);
  await assertTriggerAndSuggestions(context, page);
  await fillAndAssert(context, page, "#explicit-otp", accounts.favorite.issuer);
  await fillAndAssert(
    context,
    page,
    "#frame-otp",
    accounts.game.issuer,
    page.frameLocator("#same-origin-frame").locator("body"),
  );
  const crossOrigin = page.frameLocator("#cross-origin-frame");
  await crossOrigin.locator("#frame-otp").focus();
  await expect(crossOrigin.locator("shardpass-picker-host")).toHaveCount(1);

  const beforeCounter = await readCounter(vault, accounts.counter.issuer);
  await fillAndAssert(context, page, "#heuristic-otp", accounts.counter.issuer);
  await expect.poll(() => readCounter(vault, accounts.counter.issuer)).toBe(beforeCounter + 1);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __otpFixture: { submissions: number } }).__otpFixture.submissions,
    ),
  ).toBe(0);
  await expect(page.locator("#heuristic-otp")).toBeFocused();

  await assertReplacementCancellation(context, page);
  await assertLockCancellation(context, page, vault);
  await unlockVault(vault);
  await assertNavigationCancellation(context, page);
  await assertCompactSafeVisual(context, page);
  await assertPickerA11y(context, page);
  await assertEncryptedPersistence(context, vault, accounts.counter.issuer, beforeCounter + 1);
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
  await expect(page.getByRole("heading", { name: "Vault unlocked" })).toBeVisible({
    timeout: 120_000,
  });
}

async function unlockVault(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Unlock ShardPass" })).toBeVisible();
  await page.getByLabel("Master password", { exact: true }).fill(vaultPassword);
  await page.getByRole("button", { name: "Unlock vault" }).click();
  await expect(page.getByRole("heading", { name: "Vault unlocked" })).toBeVisible({
    timeout: 120_000,
  });
}

async function createOtp(
  page: Page,
  input: Readonly<{
    issuer: string;
    label: string;
    type: "TOTP" | "HOTP" | "Steam";
    counter?: number;
    favorite?: boolean;
    tags?: string;
  }>,
): Promise<void> {
  await page.getByRole("button", { name: "Create OTP" }).click();
  await page.getByLabel("Issuer").fill(input.issuer);
  await page.getByLabel("Label").fill(input.label);
  await page.getByLabel("OTP type").selectOption({ label: input.type });
  if (input.counter !== undefined) await page.getByLabel("Counter").fill(String(input.counter));
  if (input.favorite === true) await page.getByLabel("Favorite").check();
  if (input.tags !== undefined) await page.getByLabel("Tags").fill(input.tags);
  await page.getByRole("button", { name: "Reveal secret" }).click();
  try {
    await page.locator("#otp-secret").fill(syntheticSecret);
  } finally {
    await page.getByRole("button", { name: "Conceal secret" }).click();
  }
  await page.getByRole("button", { name: "Save OTP" }).click();
  await expect(page.getByRole("heading", { name: "Edit OTP" })).toBeVisible();
}

async function assertEligibilityMatrix(page: Page): Promise<void> {
  for (const selector of ["#explicit-otp", "#heuristic-otp"]) {
    await page.locator(selector).focus();
    await expect(page.locator("shardpass-picker-host")).toHaveCount(1);
  }
  for (const selector of [
    "#postal-code",
    "#security-pin",
    "#coupon-code",
    "#phone-number",
    "#disabled-otp",
  ]) {
    await page.locator(selector).evaluate((element) => (element as HTMLElement).focus());
    await expect(page.locator("shardpass-picker-host")).toHaveCount(0);
  }
}

async function cdpFor(context: BrowserContext, page: Page): Promise<CDPSession> {
  const session = await context.newCDPSession(page);
  await session.send("DOM.enable");
  return session;
}

async function shadowNode(
  session: CDPSession,
  predicate: (node: CdpNode) => boolean,
): Promise<CdpNode> {
  const { root } = await session.send("DOM.getDocument", { depth: -1, pierce: true });
  for (const candidate of walk(root)) {
    if (predicate(candidate)) return candidate;
  }
  throw new Error("Expected isolated picker control was unavailable.");
}

type CdpNode = {
  nodeId: number;
  nodeName: string;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
  contentDocument?: CdpNode;
};

function* walk(node: CdpNode): Generator<CdpNode> {
  yield node;
  const descendants = [...(node.shadowRoots ?? []), ...(node.children ?? [])];
  if (node.contentDocument !== undefined) descendants.push(node.contentDocument);
  for (const child of descendants) yield* walk(child);
}

function attribute(node: CdpNode, name: string): string | undefined {
  const attributes = node.attributes ?? [];
  const index = attributes.indexOf(name);
  return index < 0 ? undefined : attributes[index + 1];
}

async function invokeNode(
  session: CDPSession,
  node: CdpNode,
  functionDeclaration: string,
  arguments_: Array<{ value: unknown }> = [],
): Promise<unknown> {
  const resolved = await session.send("DOM.resolveNode", { nodeId: node.nodeId });
  const objectId = resolved.object.objectId;
  if (objectId === undefined) throw new Error("Expected isolated picker object was unavailable.");
  const result = await session.send("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration,
    arguments: arguments_,
    awaitPromise: true,
    returnByValue: true,
  });
  return result.result.value;
}

async function openPicker(context: BrowserContext, page: Page): Promise<CDPSession> {
  const session = await cdpFor(context, page);
  const trigger = await shadowNode(
    session,
    (node) => attribute(node, "aria-label") === "Fill one-time code with ShardPass",
  );
  await invokeNode(session, trigger, "function () { this.click(); }");
  await expect
    .poll(async () => {
      try {
        await shadowNode(
          session,
          (node) => attribute(node, "aria-label") === "Search OTP accounts",
        );
        return true;
      } catch {
        return false;
      }
    })
    .toBe(true);
  return session;
}

async function selectAccount(session: CDPSession, issuer: string): Promise<void> {
  const row = await shadowNode(
    session,
    (node) =>
      node.nodeName === "BUTTON" && attribute(node, "aria-label")?.includes(issuer) === true,
  );
  await invokeNode(session, row, "function () { this.click(); }");
}

async function assertTriggerAndSuggestions(context: BrowserContext, page: Page): Promise<void> {
  await page.locator("#explicit-otp").focus();
  const session = await openPicker(context, page);
  const labels = Array.from(
    walk((await session.send("DOM.getDocument", { depth: -1, pierce: true })).root as CdpNode),
  )
    .filter((node) => node.nodeName === "BUTTON")
    .map((node) => attribute(node, "aria-label"))
    .filter((value): value is string => value?.startsWith("Use OTP account") === true);
  expect(labels).toHaveLength(3);
  expect(labels[0]).toContain(accounts.favorite.issuer);
  const search = await shadowNode(
    session,
    (node) => attribute(node, "aria-label") === "Search OTP accounts",
  );
  await invokeNode(
    session,
    search,
    "function (value) { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(this, value); this.dispatchEvent(new Event('input', { bubbles: true })); }",
    [{ value: "game" }],
  );
  await expect
    .poll(async () => {
      const document = (await session.send("DOM.getDocument", { depth: -1, pierce: true }))
        .root as CdpNode;
      return Array.from(walk(document)).filter(
        (node) =>
          node.nodeName === "BUTTON" &&
          attribute(node, "aria-label")?.startsWith("Use OTP account"),
      ).length;
    })
    .toBe(1);
  const close = await shadowNode(
    session,
    (node) => attribute(node, "aria-label") === "Close ShardPass picker",
  );
  await invokeNode(session, close, "function () { this.click(); }");
  await session.detach();
}

async function fillAndAssert(
  context: BrowserContext,
  page: Page,
  selector: string,
  issuer: string,
  frameBody?: Locator,
): Promise<void> {
  const target = frameBody === undefined ? page.locator(selector) : frameBody.locator(selector);
  await target.focus();
  const session = await openPicker(context, page);
  await selectAccount(session, issuer);
  await expect(target).not.toHaveValue("");
  await expect(target).toBeFocused();
  await session.detach();
}

async function assertReplacementCancellation(context: BrowserContext, page: Page): Promise<void> {
  await page.locator("#replacement-otp").focus();
  const session = await openPicker(context, page);
  await page.evaluate(() =>
    (window as unknown as { __replaceOtpField: () => void }).__replaceOtpField(),
  );
  await expect(page.locator("shardpass-picker-host")).toHaveCount(1);
  await expect(page.locator("#replacement-otp")).toHaveValue("");
  await session.detach();
}

async function assertLockCancellation(
  context: BrowserContext,
  page: Page,
  vault: Page,
): Promise<void> {
  await page.goto("/tests/fixtures/sites/otp.html");
  await page.locator("#explicit-otp").fill("");
  await page.locator("#explicit-otp").focus();
  const session = await openPicker(context, page);
  await vault.getByRole("button", { name: "Lock vault" }).click();
  await expect(vault.getByRole("heading", { name: "Unlock ShardPass" })).toBeVisible();
  await selectAccount(session, accounts.favorite.issuer);
  await expect(page.locator("#explicit-otp")).toHaveValue("");
  await session.detach();
}

async function assertNavigationCancellation(context: BrowserContext, page: Page): Promise<void> {
  await page.goto("/tests/fixtures/sites/otp.html");
  await page.locator("#explicit-otp").focus();
  const session = await openPicker(context, page);
  await page.goto("/tests/fixtures/sites/foundation.html?picker=off");
  await expect(page.locator("shardpass-picker-host")).toHaveCount(0);
  await session.detach();
}

async function assertCompactSafeVisual(context: BrowserContext, page: Page): Promise<void> {
  await page.setViewportSize({ width: 400, height: 640 });
  await page.goto("/tests/fixtures/sites/otp.html");
  await page.locator("#explicit-otp").focus();
  const session = await openPicker(context, page);
  await stabilizePage(page);
  const host = page.locator("shardpass-picker-host");
  const box = await host.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(400);
  await expect(host).toHaveScreenshot("otp-picker-compact-safe.png");
  await session.detach();
}

async function assertPickerA11y(context: BrowserContext, page: Page): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const session = await cdpFor(context, page);
  const result = await page.evaluate(async () => {
    const audit = await (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    });
    return audit.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
  });
  expect(result).toEqual([]);
  const region = await shadowNode(
    session,
    (node) => attribute(node, "aria-label") === "ShardPass OTP picker",
  );
  expect(region.nodeName).toBe("SECTION");
  await session.detach();
}

async function readCounter(page: Page, issuer: string): Promise<number> {
  await page.getByRole("searchbox", { name: "Search OTP items" }).fill(issuer);
  await page.getByRole("option", { name: new RegExp(issuer, "u") }).click();
  return Number(await page.getByLabel("Counter").inputValue());
}

async function assertEncryptedPersistence(
  context: BrowserContext,
  vault: Page,
  issuer: string,
  expectedCounter: number,
): Promise<void> {
  await vault.getByRole("button", { name: "Lock vault" }).click();
  const local = await context
    .serviceWorkers()[0]!
    .evaluate(async () => chrome.storage.local.get(null));
  const serialized = JSON.stringify(local);
  expect(serialized).not.toContain(issuer);
  expect(serialized).not.toContain(syntheticSecret);
  await unlockVault(vault);
  expect(await readCounter(vault, issuer)).toBe(expectedCounter);
}
