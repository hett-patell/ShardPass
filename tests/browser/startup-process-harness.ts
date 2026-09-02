import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

import { classifyChromiumStartupStderr } from "./startup-diagnostics";

export interface StartupProcessEvidence {
  extensionTargetObserved: boolean;
  localKeyCount: number;
  sessionKeyCount: number;
  stderrFindings: string[];
  targetExceptions: string[];
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function bounded<T>(label: string, operation: Promise<T>, milliseconds = 15_000): Promise<T> {
  return Promise.race([
    operation,
    wait(milliseconds).then(() => Promise.reject(new Error(`${label} timed out.`))),
  ]);
}

async function debuggingPort(userDataDir: string): Promise<number> {
  const file = path.join(userDataDir, "DevToolsActivePort");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const [port] = (await readFile(file, "utf8")).split(/\r?\n/u);
      const parsed = Number(port);
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    } catch {
      // Chromium writes DevToolsActivePort after its process and stderr streams already exist.
    }
    await wait(25);
  }
  throw new Error("Chromium debugging endpoint unavailable.");
}

export async function collectStartupProcessEvidence(
  userDataDir: string,
  extensionPath: string,
): Promise<StartupProcessEvidence> {
  let stderr = "";
  const child = spawn(
    chromium.executablePath(),
    [
      `--user-data-dir=${userDataDir}`,
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--remote-debugging-port=0",
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-features=OptimizationHints,MediaRouter",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--enable-logging=stderr",
      "--v=1",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < 2_000_000) stderr += chunk.slice(0, 2_000_000 - stderr.length);
  });

  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
  const targetExceptions: string[] = [];
  try {
    const port = await debuggingPort(userDataDir);
    browser = await bounded("CDP connection", chromium.connectOverCDP(`http://127.0.0.1:${port}`));
    const browserSession = await bounded("browser CDP session", browser.newBrowserCDPSession());
    const targets = await bounded("target discovery", browserSession.send("Target.getTargets"));
    let extensionTargetObserved = targets.targetInfos.some(
      (target) =>
        target.type === "service_worker" && target.url.endsWith("/service-worker-loader.js"),
    );

    const context = browser.contexts()[0];
    if (context === undefined) throw new Error("Chromium startup context unavailable.");
    let worker = context
      .serviceWorkers()
      .find((candidate) => candidate.url().endsWith("/service-worker-loader.js"));
    const workerDeadline = Date.now() + 5_000;
    while (worker === undefined && Date.now() < workerDeadline) {
      await wait(25);
      worker = context
        .serviceWorkers()
        .find((candidate) => candidate.url().endsWith("/service-worker-loader.js"));
    }
    if (worker === undefined) throw new Error("ShardPass startup worker unavailable.");
    extensionTargetObserved = true;
    worker.on("console", (message) => {
      if (message.type() === "error") targetExceptions.push("service-worker-console-error");
    });
    const startupPage = await context.newPage();
    const extensionId = new URL(worker.url()).host;
    await bounded(
      "startup extension page",
      startupPage.goto(`chrome-extension://${extensionId}/vault/index.html`),
    );
    const startup = await bounded(
      "startup storage query",
      startupPage.evaluate(async () => ({
        localKeyCount: Object.keys(await chrome.storage.local.get(null)).length,
        sessionKeyCount: Object.keys(await chrome.storage.session.get(null)).length,
      })),
    );
    await startupPage.close();
    await wait(250);
    return {
      extensionTargetObserved,
      ...startup,
      stderrFindings: classifyChromiumStartupStderr(stderr),
      targetExceptions,
    };
  } finally {
    await browser?.close({ reason: "startup diagnostic complete" }).catch(() => undefined);
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        once(child, "exit"),
        wait(2_000).then(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
        }),
      ]);
    }
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
