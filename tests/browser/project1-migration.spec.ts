import { readFile } from "node:fs/promises";
import path from "node:path";

import type { BrowserContext, Page } from "@playwright/test";

import { expect, test } from "./fixtures";

const fixtureDirectory = path.resolve(import.meta.dirname, "../fixtures/legacy");
const vaultPassword = "correct horse battery";
const expectedItemCount = 8;

type LegacyFixture = Readonly<{
  testOnlyPassword: string;
  vault: Record<string, unknown>;
}>;
type SettingsFixture = Readonly<{ settings: Record<string, unknown> }>;
type SafeEvent = Readonly<{
  page: string;
  kind: "runtime" | "worker-created" | "worker-completed" | "worker-terminated";
  detail: string;
}>;

test.use({ screenLockStabilized: true });
test.describe.configure({ mode: "serial" });

test("migrates the byte-stable legacy source through the packaged trusted workflow", async ({
  context,
  expectedRuntimeIssues,
  extensionId,
  extensionWorker,
}) => {
  test.setTimeout(600_000);
  const legacy = await readJson<LegacyFixture>("vault-standard.json");
  const settings = await readJson<SettingsFixture>("settings.json");
  const events: SafeEvent[] = [];
  let serviceWorkerClosed = false;
  let serviceWorkerRecreated = false;
  extensionWorker.on("close", () => {
    serviceWorkerClosed = true;
  });
  context.on("serviceworker", (worker) => {
    if (worker !== extensionWorker) serviceWorkerRecreated = true;
  });

  await expectBackgroundReady(context, extensionId);
  await extensionWorker.evaluate(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
  });
  const setupPage = await openVault(context, extensionId, "setup");
  await configureVault(setupPage);
  await setupPage.close();
  const original = await extensionWorker.evaluate(
    async (source) => {
      await chrome.storage.local.set(source);
      const stored = await chrome.storage.local.get(["vault", "settings"]);
      return JSON.stringify({ vault: stored.vault, settings: stored.settings });
    },
    { vault: legacy.vault, settings: settings.settings },
  );

  await context.exposeFunction("recordSafeMigrationEvent", (event: SafeEvent) => {
    events.push(event);
  });
  await installSafeInstrumentation(context, extensionId);
  const abortedPage = await openVault(context, extensionId);
  let abortedLegacyWorkerClosed = false;
  abortedPage.on("worker", (worker) => {
    if (!isPackagedLegacyKdfWorker(worker.url(), extensionId)) return;
    worker.on("close", () => {
      abortedLegacyWorkerClosed = true;
    });
  });
  await expect(abortedPage.getByRole("heading", { name: "Migrate legacy vault" })).toBeVisible();
  await abortedPage.getByLabel("Legacy password").fill(legacy.testOnlyPassword);
  await abortedPage.getByRole("button", { name: "Begin migration" }).click();
  await expect
    .poll(() => countEvents(events, "worker-created", "abort"), { timeout: 120_000 })
    .toBe(1);
  await abortedPage.close();
  await expect.poll(() => abortedLegacyWorkerClosed).toBe(true);
  await expect
    .poll(() => runtimeKinds(events, "abort"))
    .not.toContain("migration.authorizeCredential");
  expect(runtimeKinds(events, "abort")).not.toContain("migration.start");
  await expectMigrationPhase(extensionWorker, "none");

  const startPage = await openVault(context, extensionId, "start");
  await ensureVaultUnlocked(startPage);
  await startPage.getByLabel("Legacy password").fill(legacy.testOnlyPassword);
  await startPage.getByRole("button", { name: "Begin migration" }).click();
  await expect.poll(() => runtimeKinds(events, "start")).toContain("migration.start");
  await expect.poll(() => countEvents(events, "worker-completed", "start")).toBe(1);
  await expectMigrationPhase(extensionWorker, "staged");
  await startPage.close();

  const verifyPage = await openVault(context, extensionId, "verify");
  await ensureVaultUnlocked(verifyPage);
  await expect.poll(() => runtimeKinds(events, "verify")).toContain("migration.verify");
  await expectMigrationPhase(extensionWorker, "verified");
  await verifyPage.close();
  expect({ serviceWorkerClosed, serviceWorkerRecreated }).toEqual({
    serviceWorkerClosed: false,
    serviceWorkerRecreated: false,
  });

  const activatePage = await openVault(context, extensionId, "activate");
  await ensureVaultUnlocked(activatePage);
  await expect.poll(() => runtimeKinds(events, "activate")).toContain("migration.activate");
  await expect
    .poll(() => runtimeKinds(events, "activate"))
    .toContain("migration.activate:completed");
  await expect(activatePage.getByRole("status").getByText("Migration complete")).toBeVisible({
    timeout: 120_000,
  });
  await expect(
    activatePage.getByText(`${expectedItemCount} OTP items migrated`, { exact: true }),
  ).toBeVisible();

  const state = await activatePage.evaluate(async () => {
    const response: { autoLockMinutes?: unknown; state?: unknown } =
      await chrome.runtime.sendMessage({
        version: 1,
        kind: "vault.getState",
      });
    return { autoLockMinutes: response.autoLockMinutes, state: response.state };
  });
  expect(state).toEqual({ autoLockMinutes: 7, state: "unlocked" });

  const beforeRetry = await safeStorageEvidence(activatePage, original);
  expect(beforeRetry.sourceBytes).toBe(original);
  expect(beforeRetry.sourceMatchesExpected).toBe(true);
  expect(beforeRetry.leakFree).toBe(true);
  expect(beforeRetry.generationKeyCount).toBeGreaterThan(0);

  const retry: unknown = await activatePage.evaluate(() =>
    chrome.runtime.sendMessage({ version: 1, kind: "migration.retry" }),
  );
  expect(retry).toMatchObject({ kind: "migration.status", phase: "completed", itemCount: 8 });
  const afterRetry = await safeStorageEvidence(activatePage, original);
  expect(afterRetry).toEqual(beforeRetry);

  await assertSafeRuntimeMessages(activatePage);
  await assertNoSensitiveRenderedText(activatePage);
  await assertPackagedWorkerBoundary(activatePage, extensionId, events, expectedRuntimeIssues);
  await assertPopupRejected(context, extensionId);
  await assertUntrustedContextRejected(context);
  await activatePage.close();

  const completedPage = await openVault(context, extensionId, "completed");
  await ensureVaultUnlocked(completedPage);
  await expect(completedPage.getByRole("status").getByText("Migration complete")).toBeVisible();
  expect(await safeStorageEvidence(completedPage, original)).toEqual(afterRetry);
});

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(fixtureDirectory, name), "utf8")) as T;
}

async function expectBackgroundReady(context: BrowserContext, extensionId: string): Promise<void> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/vault/index.html`);
  await expect(page.getByText("Foundation ready", { exact: true }).first()).toBeVisible();
  await page.close();
}

async function openVault(context: BrowserContext, extensionId: string, phase = "abort") {
  const page = await context.newPage();
  await page.evaluate((value) => {
    window.name = value;
  }, `migration-e2e:${phase}`);
  await page.goto(`chrome-extension://${extensionId}/vault/index.html`);
  return page;
}

async function configureVault(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Create your vault" })).toBeVisible();
  await page.getByLabel("Master password", { exact: true }).fill(vaultPassword);
  await page.getByLabel("Confirm master password").fill(vaultPassword);
  const create = page.getByRole("button", { name: "Create vault" });
  const unlocked = page.getByRole("heading", { name: "Vault unlocked" });
  const sanitizedFailure = page.getByRole("alert").getByText("The vault could not be unlocked.");
  await create.click();
  const observeOutcome = async (): Promise<"pending" | "timed-out" | "unlocked"> => {
    if (await unlocked.isVisible()) return "unlocked";
    if (await sanitizedFailure.isVisible()) return "timed-out";
    return "pending";
  };
  const firstOutcome: Awaited<ReturnType<typeof observeOutcome>> = await (async () => {
    try {
      await expect.poll(observeOutcome, { timeout: 125_000 }).not.toBe("pending");
      return await observeOutcome();
    } catch {
      return "timed-out";
    }
  })();
  if (firstOutcome === "timed-out") {
    // The packaged worker has a fixed 120 s fail-closed timeout. Under browser contention its
    // timer/message can be delayed, so reload and retry through the UI with a new document-bound
    // challenge rather than extending product TTL or reusing the ambiguous operation.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Create your vault" })).toBeVisible();
    await page.getByLabel("Master password", { exact: true }).fill(vaultPassword);
    await page.getByLabel("Confirm master password").fill(vaultPassword);
    await page.getByRole("button", { name: "Create vault" }).click();
    await expect(page.getByRole("heading", { name: "Vault unlocked" })).toBeVisible({
      timeout: 135_000,
    });
  }
}

async function unlockVault(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Unlock ShardPass" })).toBeVisible();
  await page.getByLabel("Master password", { exact: true }).fill(vaultPassword);
  await page.getByRole("button", { name: "Unlock vault" }).click();
  await expect(page.getByRole("heading", { name: "Vault unlocked" })).toBeVisible({
    timeout: 120_000,
  });
}

async function ensureVaultUnlocked(page: Page): Promise<void> {
  const unlockHeading = page.getByRole("heading", { name: "Unlock ShardPass" });
  if (await unlockHeading.isVisible()) await unlockVault(page);
  else await expect(page.getByRole("heading", { name: "Vault unlocked" })).toBeVisible();
}

function isPackagedLegacyKdfWorker(url: string, extensionId: string): boolean {
  const parsed = new URL(url);
  return (
    parsed.protocol === "chrome-extension:" &&
    parsed.host === extensionId &&
    /^\/assets\/legacy-kdf-worker-[\w-]+\.js$/u.test(parsed.pathname)
  );
}

function countEvents(events: SafeEvent[], kind: SafeEvent["kind"], page: string): number {
  return events.filter((event) => event.kind === kind && event.page === page).length;
}

function runtimeKinds(events: SafeEvent[], page: string): string[] {
  return events
    .filter((event) => event.kind === "runtime" && event.page === page)
    .map((event) => event.detail);
}

async function installSafeInstrumentation(
  context: BrowserContext,
  extensionId: string,
): Promise<void> {
  await context.addInitScript(
    ({ expectedExtensionId }) => {
      if (location.protocol !== "chrome-extension:" || location.host !== expectedExtensionId)
        return;
      const page = window.name.startsWith("migration-e2e:")
        ? window.name.slice("migration-e2e:".length)
        : "other";
      const report = (kind: SafeEvent["kind"], detail: string) => {
        void (
          window as typeof window & {
            recordSafeMigrationEvent(event: SafeEvent): Promise<void>;
          }
        ).recordSafeMigrationEvent({ page, kind, detail });
      };
      const NativeWorker = window.Worker;
      window.Worker = new Proxy(NativeWorker, {
        construct(target, args: ConstructorParameters<typeof Worker>) {
          const [url] = args;
          const resolved = new URL(String(url), location.href);
          const worker = Reflect.construct(target, args);
          const legacyMigrationWorker =
            resolved.origin === location.origin &&
            /^\/assets\/legacy-kdf-worker-[\w-]+\.js$/u.test(resolved.pathname);
          if (!legacyMigrationWorker) return worker;
          report("worker-created", resolved.pathname);
          worker.addEventListener("message", () => report("worker-completed", "message"), {
            once: true,
          });
          const nativeTerminate = worker.terminate.bind(worker);
          worker.terminate = () => {
            report("worker-terminated", "terminated");
            nativeTerminate();
          };
          return worker;
        },
      });
      const nativeSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = ((...args: unknown[]) => {
        const payload = args[0];
        if (typeof payload === "object" && payload !== null && "kind" in payload) {
          const message = payload as Record<string, unknown>;
          const serialized = JSON.stringify(message);
          const forbiddenField = Object.keys(message).some((key) =>
            /password|secret|seed|root|fingerprint|record|ente|backup/iu.test(key),
          );
          if (forbiddenField) throw new Error("Unsafe migration message field");
          if (message.kind === "migration.authorizeCredential") {
            if (
              typeof message.derivedKey !== "string" ||
              !/^[A-Za-z0-9+/]{43}=$/u.test(message.derivedKey)
            )
              throw new Error("Non-canonical migration credential material");
          } else if (/migration\.(?:start|retry)/u.test(String(message.kind))) {
            const allowed = new Set(["version", "kind", "credentialToken"]);
            if (Object.keys(message).some((key) => !allowed.has(key)))
              throw new Error("Migration lifecycle message was not opaque");
          }
          if (/TEST-ONLY|correct horse|JBSWY|GEZD|synthetic-token-placeholder/iu.test(serialized))
            throw new Error("Sensitive migration message content");
          report("runtime", String(message.kind));
          const shouldHoldResponse =
            (page === "start" && message.kind === "migration.start") ||
            (page === "verify" && message.kind === "migration.verify");
          if (typeof args.at(-1) === "function") {
            const observedArgs = [...args];
            const callback = args.at(-1) as (response: unknown) => void;
            observedArgs[observedArgs.length - 1] = (response: unknown) => {
              if (typeof response === "object" && response !== null) {
                const safeResponse = response as {
                  kind?: unknown;
                  phase?: unknown;
                  error?: { code?: unknown };
                };
                const safeDetail = [
                  safeResponse.error?.code,
                  safeResponse.phase,
                  safeResponse.kind,
                ].find((value): value is string => typeof value === "string");
                report("runtime", `${String(message.kind)}:${safeDetail ?? "unknown"}`);
              }
              if (!shouldHoldResponse) callback(response);
            };
            return nativeSendMessage(
              ...(observedArgs as Parameters<typeof chrome.runtime.sendMessage>),
            );
          }
        }
        return nativeSendMessage(...(args as Parameters<typeof chrome.runtime.sendMessage>));
      }) as typeof chrome.runtime.sendMessage;
    },
    { expectedExtensionId: extensionId },
  );
}

async function expectMigrationPhase(
  extensionWorker: { evaluate<R>(pageFunction: () => R | Promise<R>): Promise<R> },
  phase: string,
): Promise<void> {
  await expect
    .poll(async () => {
      const value = await extensionWorker.evaluate(() =>
        chrome.storage.local.get("shardpass:v1:migration-transaction"),
      );
      const transaction = value["shardpass:v1:migration-transaction"] as
        { ciphertext?: unknown } | undefined;
      if (transaction === undefined) return "none";
      // The transaction is deliberately encrypted. Public phase is observed from the trusted UI;
      // here only distinguish durable staging from absence without exposing its plaintext.
      return typeof transaction.ciphertext === "string" ? "present" : "invalid";
    })
    .toBe(phase === "none" ? "none" : "present");
}

async function safeStorageEvidence(page: Page, original: string) {
  return page.evaluate(
    async ({ expectedSource }) => {
      const local = await chrome.storage.local.get(null);
      const session = await chrome.storage.session.get(null);
      const sourceBytes = JSON.stringify({ vault: local.vault, settings: local.settings });
      const forbidden = [
        "TEST-ONLY ShardPass fixture password; never use for real data",
        "correct horse battery",
        "JBSWY3DPEHPK3PXP",
        "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        "synthetic-token-placeholder",
        "synthetic-key-placeholder",
      ];
      const newValues = JSON.stringify({
        local: Object.fromEntries(
          Object.entries(local).filter(([key]) => key !== "vault" && key !== "settings"),
        ),
        session,
      });
      return {
        sourceBytes,
        sourceMatchesExpected: sourceBytes === expectedSource,
        leakFree: forbidden.every((value) => !newValues.includes(value)),
        generationKeyCount: Object.keys(local).filter((key) => key.startsWith("shardpass:v1:g:"))
          .length,
      };
    },
    { expectedSource: original },
  );
}

async function assertSafeRuntimeMessages(page: Page): Promise<void> {
  const result = await page.evaluate(() => ({
    hasPasswordInputValue: [
      ...document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
    ].some((input) => input.value.length > 0),
  }));
  expect(result.hasPasswordInputValue).toBe(false);
}

async function assertNoSensitiveRenderedText(page: Page): Promise<void> {
  const safe = await page.evaluate(() => {
    const rendered = document.body.innerText;
    return [
      "TEST-ONLY ShardPass fixture password; never use for real data",
      "correct horse battery",
      "JBSWY3DPEHPK3PXP",
      "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      "synthetic-token-placeholder",
      "synthetic-key-placeholder",
      "AUTHENTICATION_FAILED",
      "MIGRATION_FAILED",
      "sourceFingerprint",
    ].every((value) => !rendered.includes(value));
  });
  expect(safe).toBe(true);
}

async function assertPackagedWorkerBoundary(
  page: Page,
  extensionId: string,
  events: SafeEvent[],
  expectedRuntimeIssues: string[],
): Promise<void> {
  const workerAssets = events
    .filter((event) => event.kind === "worker-created")
    .map((event) => event.detail);
  expect(
    workerAssets.some((asset) => /^\/assets\/legacy-kdf-worker-[\w-]+\.js$/u.test(asset)),
  ).toBe(true);
  const workerIsWebAccessible = await page.evaluate(async () => {
    const response = await fetch(chrome.runtime.getURL("manifest.json"));
    const manifest = (await response.json()) as {
      web_accessible_resources?: { resources?: string[] }[];
    };
    return (
      manifest.web_accessible_resources?.some((entry) =>
        entry.resources?.some((resource) => resource.includes("legacy-kdf-worker")),
      ) ?? false
    );
  });
  expect(workerIsWebAccessible).toBe(false);
  const webPage = await page.context().newPage();
  await webPage.goto("http://127.0.0.1:4173/tests/fixtures/sites/foundation.html?picker=off");
  const exposed = await webPage.evaluate(async (url) => {
    try {
      return (await fetch(url)).ok;
    } catch {
      return false;
    }
  }, `chrome-extension://${extensionId}${workerAssets[0]}`);
  expect(exposed).toBe(false);
  expectedRuntimeIssues.push(
    `Denying load of chrome-extension://${extensionId}${workerAssets[0]}. Resources must be listed in the web_accessible_resources manifest key in order to be loaded by pages outside the extension.`,
    "Failed to load resource: net::ERR_FAILED",
  );
  await webPage.close();
}

async function assertPopupRejected(context: BrowserContext, extensionId: string): Promise<void> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
  const code = await popup.evaluate(async () => {
    const response: { error?: { code?: unknown } } = await chrome.runtime.sendMessage({
      version: 1,
      kind: "migration.inspect",
    });
    return response.error?.code;
  });
  expect(code).toBe("UNAUTHORIZED_SENDER");
  await popup.close();
}

async function assertUntrustedContextRejected(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Runtime.enable");
  const isolatedContexts: number[] = [];
  cdp.on("Runtime.executionContextCreated", ({ context: executionContext }) => {
    const auxiliary = executionContext.auxData as { type?: unknown } | undefined;
    if (auxiliary?.type === "isolated") isolatedContexts.push(executionContext.id);
  });
  await page.goto("http://127.0.0.1:4173/tests/fixtures/sites/foundation.html?picker=off");
  await expect.poll(() => isolatedContexts.length).toBeGreaterThan(0);
  let contextId: number | undefined;
  for (const candidate of isolatedContexts) {
    const probe = await cdp.send("Runtime.evaluate", {
      contextId: candidate,
      returnByValue: true,
      expression: "typeof chrome?.runtime?.sendMessage === 'function'",
    });
    if (probe.result.value === true) {
      contextId = candidate;
      break;
    }
  }
  if (contextId === undefined) throw new Error("Extension content context unavailable");
  const evaluated = await cdp.send("Runtime.evaluate", {
    contextId,
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      let localReadable = true;
      let sessionReadable = true;
      try { await chrome.storage.local.get(null); } catch { localReadable = false; }
      try { await chrome.storage.session.get(null); } catch { sessionReadable = false; }
      const response = await chrome.runtime.sendMessage({ version: 1, kind: "migration.inspect" });
      return { localReadable, sessionReadable, code: response?.error?.code };
    })()`,
  });
  expect(evaluated.exceptionDetails).toBeUndefined();
  expect(evaluated.result.value).toEqual({
    localReadable: false,
    sessionReadable: false,
    code: "UNAUTHORIZED_SENDER",
  });
  await cdp.detach();
  await page.close();
}
