import "@testing-library/jest-dom/vitest";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { FakeExtensionPlatform } from "@shardpass/testing";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BackupUiExtensionPlatform,
  EnteUiPlatform,
  ExtensionPlatform,
  OtpImportUiExtensionPlatform,
} from "../../src/platform/extension-platform";
import { VaultApp } from "../../src/vault/VaultApp";

const foundationStatus = {
  version: 1,
  kind: "foundation.status",
  phase: "foundation",
  vaultAvailable: false,
} as const;

async function expectNoSeriousAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    resultTypes: ["violations"],
    rules: { "color-contrast": { enabled: false } },
  });
  const seriousViolations = results.violations.filter(({ impact }) =>
    ["serious", "critical"].includes(impact ?? ""),
  );

  expect(seriousViolations).toEqual([]);
}

function readyPlatform(): FakeExtensionPlatform {
  const platform = new FakeExtensionPlatform("vault-test-id");
  platform.queueSendResponse(foundationStatus);
  platform.queueSendResponse({
    version: 1,
    kind: "vault.state",
    state: "unconfigured",
    autoLockMinutes: 15,
    lockOnScreenLock: true,
    retryAfterMs: 0,
    streamId: "00000000000000000000000000000001",
    sequence: 1,
  });
  return platform;
}

afterEach(cleanup);

describe("VaultApp foundation shell", () => {
  it("provides skip navigation and named desktop navigation, list, and detail landmarks", async () => {
    const platform = readyPlatform();
    const { container } = render(<VaultApp platform={platform} />);

    const skipLink = screen.getByRole("link", { name: "Skip to vault content" });
    const navigation = screen.getByRole("navigation", { name: "Vault navigation" });
    const main = screen.getByRole("main");
    const listRegion = screen.getByRole("region", { name: "Vault items" });
    const detailRegion = screen.getByRole("region", { name: "Vault details" });

    expect(skipLink).toHaveAttribute("href", "#vault-content");
    expect(main).toHaveAttribute("id", "vault-content");
    expect(navigation).toContainElement(screen.getByText("All items"));
    expect(listRegion).toBeVisible();
    expect(detailRegion).toBeVisible();
    expect(container.querySelector("aside")).toContainElement(navigation);
    expect(platform.sentMessages).toEqual([{ version: 1, kind: "foundation.getStatus" }]);

    await expectNoSeriousAxeViolations(container);
  });

  it("keeps keyboard focus order honest and exposes no enabled CRUD controls", () => {
    render(<VaultApp platform={readyPlatform()} />);

    const skipLink = screen.getByRole("link", { name: "Skip to vault content" });
    const search = screen.getByRole("searchbox", { name: "Search vault" });
    const create = screen.getByRole("button", { name: "Create item" });

    expect(search).toBeDisabled();
    expect(search).toHaveAccessibleDescription(/available after the vault is unlocked/i);
    expect(create).toBeDisabled();
    expect(create).toHaveAccessibleDescription(/available after the vault is unlocked/i);
    expect(screen.getAllByRole("button")).toEqual([create]);

    const searchExplanation = screen.getByText("Search is available after the vault is unlocked.");
    const createExplanation = screen.getByText(
      "Item creation is available after the vault is unlocked.",
    );
    expect(searchExplanation).toHaveAttribute("id", "search-availability");
    expect(createExplanation).toHaveAttribute("id", "create-availability");
    expect(search.closest("label")?.parentElement).toContainElement(searchExplanation);
    expect(create.parentElement).toContainElement(createExplanation);

    skipLink.focus();
    expect(skipLink).toHaveFocus();
    expect(
      skipLink.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(search.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(
      screen.queryByRole("button", { name: /edit|delete|import|migrate|unlock/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/demo|sample password|fake item/i)).not.toBeInTheDocument();
  });

  it("integrates migration only into the unlocked full-page detail workspace", async () => {
    const platform = new FakeExtensionPlatform("vault-test-id");
    platform.queueSendResponse(foundationStatus);
    platform.queueSendResponse({
      version: 1,
      kind: "vault.state",
      state: "unlocked",
      autoLockMinutes: 15,
      lockOnScreenLock: true,
      retryAfterMs: 0,
      streamId: "00000000000000000000000000000002",
      sequence: 1,
    });
    platform.queueSendResponse({
      version: 1,
      kind: "ente.state",
      state: "disconnected",
      connected: false,
      pendingCount: 0,
      conflictCount: 0,
      lastSuccessAt: null,
    });
    platform.queueSendResponse({
      version: 1,
      kind: "migration.status",
      available: false,
      phase: "none",
      itemCount: 0,
    });

    render(<VaultApp platform={platform} />);

    expect(await screen.findByRole("heading", { name: "Vault unlocked" })).toBeVisible();
    await waitFor(() =>
      expect(platform.sentMessages).toContainEqual({ version: 1, kind: "migration.inspect" }),
    );
    expect(screen.queryByRole("heading", { name: "Migrate legacy vault" })).not.toBeInTheDocument();
  });

  it("renders an honest empty state after validating foundation readiness", async () => {
    const { container } = render(<VaultApp platform={readyPlatform()} />);

    expect(await screen.findByRole("status")).toHaveTextContent("Foundation ready");
    expect(await screen.findByRole("heading", { name: "Create your vault" })).toBeVisible();
    expect(screen.getByText(/derives the unlock key in a dedicated worker/i)).toBeVisible();
    expect(screen.getByText("0 AVAILABLE ITEMS")).toBeVisible();
    expect(screen.getByText("NO ITEM SELECTED")).toBeVisible();

    await expectNoSeriousAxeViolations(container);
  });

  it.each([
    ["rejected request", new Error("secret backend stack and payload")],
    ["malformed response", { version: 1, kind: "foundation.status", phase: "secret" }],
  ])("shows a stable safe error for %s without reflecting details", async (_label, outcome) => {
    const fakePlatform = new FakeExtensionPlatform("vault-test-id");
    let platform: ExtensionPlatform &
      OtpImportUiExtensionPlatform &
      BackupUiExtensionPlatform &
      EnteUiPlatform = fakePlatform;
    if (outcome instanceof Error) {
      platform = {
        extensionId: "vault-test-id",
        onMessage: () => () => undefined,
        sendMessage: vi.fn(() => Promise.reject(outcome)),
        sendBackupMessage: () => Promise.reject(new Error("unused")),
        sendEnteMessage: () => Promise.reject(new Error("unused")),
        sendOtpMessage: () => Promise.reject(new Error("unused")),
        sendOtpImportMessage: () => Promise.reject(new Error("unused")),
        writeAuthoritativeClipboardText: () => Promise.resolve(),
        openVaultPage: vi.fn(() => Promise.resolve()),
      };
    } else {
      fakePlatform.queueSendResponse(outcome);
    }

    const { container } = render(<VaultApp platform={platform} />);
    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(
      "ShardPass couldn’t confirm its foundation status. Reload the vault to try again.",
    );
    expect(alert).not.toHaveTextContent(/secret backend stack|payload/i);
    expect(screen.getByRole("status")).toHaveTextContent("Foundation unavailable");
    expect(screen.getByRole("button", { name: "Create item" })).toBeDisabled();

    await expectNoSeriousAxeViolations(container);
  });
});

describe("vault source and responsive style contracts", () => {
  it("uses a full-viewport document and structurally collapses desktop list/detail at a compact breakpoint", async () => {
    const extensionRoot = path.resolve(process.cwd(), "apps/extension");
    const [html, css] = await Promise.all([
      readFile(path.join(extensionRoot, "vault/index.html"), "utf8"),
      readFile(path.join(extensionRoot, "src/vault/VaultApp.module.css"), "utf8"),
    ]);

    expect(html).toContain('class="vaultDocument"');
    expect(html).toContain('class="vaultBody"');
    expect(html).toContain('id="root" class="vaultRoot"');
    expect(html).toContain('src="../src/vault/main.tsx"');
    expect(html).not.toContain('src="../src/vault/main.ts"');

    expect(css).toMatch(/:global\(\.vaultDocument\)[\s\S]*min-height:\s*100%/);
    expect(css).toMatch(/:global\(\.vaultBody\)[\s\S]*min-height:\s*100vh/);
    expect(css).toMatch(
      /\.workspace\s*\{[\s\S]*grid-template-columns:\s*minmax\([^;]+\)\s+minmax\([^;]+\)/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*760px\)[\s\S]*\.shell\s*\{[\s\S]*grid-template-columns:\s*1fr/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*760px\)[\s\S]*\.workspace\s*\{[\s\S]*grid-template-columns:\s*1fr/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*760px\)[\s\S]*\.listRegion\s*\{[\s\S]*display:\s*none/,
    );
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(css).not.toMatch(/width:\s*360px/);
    expect(css).not.toMatch(/overflow-x:\s*hidden/);
    expect(css).not.toMatch(/(?:linear|radial|conic)-gradient/);
  });

  it("keeps styles external and avoids unsupported Chrome 110-only syntax", async () => {
    const extensionRoot = path.resolve(process.cwd(), "apps/extension");
    const [html, css, main] = await Promise.all([
      readFile(path.join(extensionRoot, "vault/index.html"), "utf8"),
      readFile(path.join(extensionRoot, "src/vault/VaultApp.module.css"), "utf8"),
      readFile(path.join(extensionRoot, "src/vault/main.tsx"), "utf8"),
    ]);

    expect(html).not.toMatch(/<style\b|style=/i);
    expect(main).toContain('import "@shardpass/ui/styles"');
    expect(main).not.toMatch(/\.style\b|setAttribute\(["']style/i);
    expect(css).not.toMatch(
      /color-mix\(|light-dark\(|oklch\(|@starting-style|transition-behavior|field-sizing/,
    );
  });
});
