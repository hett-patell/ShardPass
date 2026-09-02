import { chromium, expect, test } from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const builtExtension = path.resolve(import.meta.dirname, "../../.test-dist/ente-srp-extension");

async function runPackaged(
  extensionPath: string,
  resultTimeout = 120_000,
): Promise<"passed" | "failed"> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "shardpass-ente-srp-profile-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--disable-background-networking",
      "--disable-component-update",
      "--no-first-run",
    ],
  });
  try {
    const serviceWorker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(serviceWorker.url()).host}/srp-index.html`);
    await expect(page.locator("body")).toHaveAttribute("data-srp-status", /^(?:passed|failed)$/u, {
      timeout: resultTimeout,
    });
    const status = (await page.locator("body").getAttribute("data-srp-status")) as
      "passed" | "failed";
    if (status === "failed") {
      throw new Error((await page.locator("body").getAttribute("data-srp-reason")) ?? "failed");
    }
    return status;
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
}

test("executes the real SRP adapter graph under the planned packaged CSP", async () => {
  test.setTimeout(150_000);
  await expect(runPackaged(builtExtension)).resolves.toBe("passed");
});

test("controlled negative CSP blocks the isolated SRP worker", async () => {
  test.setTimeout(150_000);
  const extensionPath = await mkdtemp(path.join(tmpdir(), "shardpass-ente-srp-negative-"));
  try {
    await cp(builtExtension, extensionPath, { recursive: true });
    const manifestPath = path.join(extensionPath, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      content_security_policy: { extension_pages: string };
    };
    manifest.content_security_policy.extension_pages =
      "script-src 'none'; object-src 'none'; connect-src 'none'";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await expect(runPackaged(extensionPath, 5_000)).rejects.toThrow();
  } finally {
    await rm(extensionPath, { recursive: true, force: true });
  }
});
