import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";
import axe from "axe-core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const extensionPath = path.join(projectRoot, "dist");

declare global {
  interface Window {
    axe: typeof axe;
  }
}

export interface RuntimeIssue {
  source: string;
  message: string;
}

interface ExtensionFixtures {
  context: BrowserContext;
  screenLockStabilized: boolean;
  expectedRuntimeIssues: string[];
  extensionId: string;
  extensionWorker: Worker;
  issues: RuntimeIssue[];
  runtimeIssueGate: void;
}

interface InstrumentedContext {
  issues: RuntimeIssue[];
  pages: Set<Page>;
  workers: Set<Worker>;
}

const instrumentedContexts = new WeakMap<BrowserContext, InstrumentedContext>();

function extensionIdFromUrl(url: string): string | null {
  const match = /^(?:chrome|moz)-extension:\/\/([^/]+)\//u.exec(url);
  return match?.[1] ?? null;
}

async function resolveExtensionRuntime(context: BrowserContext): Promise<{
  extensionId: string;
  worker: Worker;
}> {
  const existingWorker = context
    .serviceWorkers()
    .find((worker) => extensionIdFromUrl(worker.url()));
  const worker = existingWorker ?? (await context.waitForEvent("serviceworker"));
  const extensionId = extensionIdFromUrl(worker.url());

  if (extensionId !== null) {
    return { extensionId, worker };
  }

  const backgroundPage =
    context.backgroundPages().find((page) => extensionIdFromUrl(page.url())) ??
    (await context.waitForEvent("backgroundpage"));
  const backgroundId = extensionIdFromUrl(backgroundPage.url());
  if (backgroundId === null) {
    throw new Error(
      `Unable to derive extension ID from ${worker.url()} or ${backgroundPage.url()}`,
    );
  }
  return { extensionId: backgroundId, worker };
}

function trackPage(page: Page, state: InstrumentedContext): void {
  if (state.pages.has(page)) return;
  state.pages.add(page);
  page.on("console", (message) => {
    if (message.type() === "error") {
      state.issues.push({ source: `page console (${page.url()})`, message: message.text() });
    }
  });
  page.on("pageerror", (error) => {
    state.issues.push({ source: `page error (${page.url()})`, message: error.message });
  });
  page.on("worker", (worker) => trackWorker(worker, state, "page worker"));
  page.on("close", () => state.pages.delete(page));
}

function trackWorker(worker: Worker, state: InstrumentedContext, kind = "service worker"): void {
  if (state.workers.has(worker)) return;
  state.workers.add(worker);
  worker.on("console", (message) => {
    if (message.type() === "error") {
      state.issues.push({ source: `${kind} console (${worker.url()})`, message: message.text() });
    }
  });
  worker.on("close", () => state.workers.delete(worker));
}

function instrumentContext(context: BrowserContext): InstrumentedContext {
  const state: InstrumentedContext = { issues: [], pages: new Set(), workers: new Set() };
  instrumentedContexts.set(context, state);
  context.on("page", (page) => trackPage(page, state));
  context.on("serviceworker", (worker) => trackWorker(worker, state));
  context.on("weberror", (webError) => {
    state.issues.push({
      source: `context error (${webError.page()?.url() ?? "unknown"})`,
      message: webError.error().message,
    });
  });
  for (const page of context.pages()) trackPage(page, state);
  for (const worker of context.serviceWorkers()) trackWorker(worker, state);
  return state;
}

async function settleRuntime(context: BrowserContext): Promise<void> {
  for (const page of context.pages()) {
    if (page.isClosed()) continue;
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await page
      .evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
      .catch(() => undefined);
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

export const test = base.extend<ExtensionFixtures>({
  // Playwright fixture declarations require destructuring for dependency analysis.
  // eslint-disable-next-line no-empty-pattern
  screenLockStabilized: async ({}, use) => {
    await use(false);
  },

  context: async ({ screenLockStabilized }, use) => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), "shardpass-playwright-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      colorScheme: "dark",
      reducedMotion: "reduce",
      locale: "en-US",
      timezoneId: "UTC",
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-features=OptimizationHints,MediaRouter",
        "--disable-sync",
        "--metrics-recording-only",
        "--no-first-run",
      ],
    });
    instrumentContext(context);
    if (screenLockStabilized) {
      const runtime = await resolveExtensionRuntime(context);
      await runtime.worker.evaluate(async () => {
        await chrome.storage.local.set({
          "shardpass:v1:lock-settings": { autoLockMinutes: 15, lockOnScreenLock: false },
        });
      });
    }
    try {
      await use(context);
    } finally {
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
  },

  issues: async ({ context }, use) => {
    const state = instrumentedContexts.get(context);
    if (state === undefined) throw new Error("Browser context was not instrumented at creation.");
    await use(state.issues);
  },

  // Playwright fixture declarations require destructuring for dependency analysis.
  // eslint-disable-next-line no-empty-pattern
  expectedRuntimeIssues: async ({}, use) => {
    await use([]);
  },

  runtimeIssueGate: [
    async ({ context, expectedRuntimeIssues, issues }, use) => {
      await use();
      await settleRuntime(context);
      expect([...new Set(issues.map((issue) => issue.message))].sort()).toEqual(
        [...expectedRuntimeIssues].sort(),
      );
    },
    { auto: true },
  ],

  extensionWorker: async ({ context }, use) => {
    const runtime = await resolveExtensionRuntime(context);
    await use(runtime.worker);
  },

  extensionId: async ({ extensionWorker }, use) => {
    const extensionId = extensionIdFromUrl(extensionWorker.url());
    if (extensionId === null)
      throw new Error(`Invalid extension worker URL: ${extensionWorker.url()}`);
    await use(extensionId);
  },
});

export { expect };

export async function stabilizePage(page: Page): Promise<void> {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.evaluate(async () => document.fonts.ready);
}

export async function expectNoSeriousAxeViolations(page: Page): Promise<void> {
  await page.addInitScript({ content: axe.source });
  await page.reload();
  const violations = await page.evaluate(async () => {
    const results = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    });
    return results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
  });
  expect(violations).toEqual([]);
}

export function expectNoRuntimeIssues(issues: RuntimeIssue[]): void {
  expect(issues).toEqual([]);
}

export async function setChromiumZoom(page: Page, percent: 100 | 200): Promise<void> {
  await page.evaluate(async (zoomFactor) => {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id === undefined) throw new Error("Current extension tab is unavailable for zoom.");
    await chrome.tabs.setZoom(tab.id, zoomFactor);
  }, percent / 100);
  await expect
    .poll(() => page.evaluate(() => Math.round(window.devicePixelRatio * 100)))
    .toBe(percent);
}
