import "@testing-library/jest-dom/vitest";

import { FakeExtensionPlatform } from "@shardpass/testing";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const unconfiguredVaultState = {
  version: 1,
  kind: "vault.state",
  state: "unconfigured",
  autoLockMinutes: 15,
  lockOnScreenLock: true,
  retryAfterMs: 0,
  streamId: "00000000000000000000000000000001",
  sequence: 1,
} as const;

function unlockedVaultState(sequence: number) {
  return {
    version: 1,
    kind: "vault.state",
    state: "unlocked",
    autoLockMinutes: 15,
    lockOnScreenLock: true,
    retryAfterMs: 0,
    streamId: "00000000000000000000000000000002",
    sequence,
  } as const;
}

const loginItem = {
  id: "10000000-0000-4000-8000-000000000001",
  kind: "login",
  schemaVersion: 2,
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  favorite: false,
  tags: [],
  name: "Example Login",
  username: "alice",
  password: "correct-horse-battery-staple",
  urls: [],
  notes: "",
} as const;

const noteItem = {
  id: "10000000-0000-4000-8000-000000000002",
  kind: "note",
  schemaVersion: 2,
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  favorite: false,
  tags: [],
  name: "Example Note",
  content: "Hello world",
} as const;

const itemQueryResult = {
  version: 1,
  kind: "item.queryResult",
  items: [loginItem, noteItem],
} as const;

const noFolders = { version: 1, kind: "folder.listResult", folders: [] } as const;

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

function readyLockedPlatform(): FakeExtensionPlatform {
  const platform = new FakeExtensionPlatform("vault-test-id");
  platform.queueSendResponse(foundationStatus);
  platform.queueSendResponse(unconfiguredVaultState);
  return platform;
}

function readyUnlockedPlatform(): FakeExtensionPlatform {
  const platform = new FakeExtensionPlatform("vault-test-id");
  platform.queueSendResponse(foundationStatus);
  platform.queueSendResponse(unlockedVaultState(1));
  // Once unlocked the folder list is requested before the items (hook declaration order).
  platform.queueSendResponse(noFolders);
  platform.queueSendResponse(itemQueryResult);
  return platform;
}

afterEach(cleanup);

describe("VaultApp foundation shell", () => {
  it("provides skip navigation and a named header, main, and category landmarks", async () => {
    const platform = readyLockedPlatform();
    const { container } = render(<VaultApp platform={platform} />);

    const skipLink = screen.getByRole("link", { name: "Skip to vault content" });
    const banner = screen.getByRole("banner", { name: "ShardPass" });
    const main = screen.getByRole("main");

    expect(skipLink).toHaveAttribute("href", "#vault-content");
    expect(main).toHaveAttribute("id", "vault-content");
    expect(banner).toBeVisible();
    expect(platform.sentMessages).toEqual([{ version: 1, kind: "foundation.getStatus" }]);

    await screen.findByRole("heading", { name: "Create your vault" });
    await expectNoSeriousAxeViolations(container);
  });

  it("renders an honest foundation-error state without reflecting details", async () => {
    const platform: ExtensionPlatform &
      OtpImportUiExtensionPlatform &
      BackupUiExtensionPlatform &
      EnteUiPlatform = {
      extensionId: "vault-test-id",
      onMessage: () => () => undefined,
      sendMessage: vi.fn(() => Promise.reject(new Error("secret backend stack and payload"))),
      sendBackupMessage: () => Promise.reject(new Error("unused")),
      sendEnteMessage: () => Promise.reject(new Error("unused")),
      sendOtpMessage: () => Promise.reject(new Error("unused")),
      sendOtpImportMessage: () => Promise.reject(new Error("unused")),
      writeAuthoritativeClipboardText: () => Promise.resolve(),
      activeTab: () => Promise.resolve(null),
      sendToTab: () => Promise.resolve(undefined),
      openVaultPage: vi.fn(() => Promise.resolve()),
    };

    const { container } = render(<VaultApp platform={platform} />);
    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(
      "ShardPass can’t reach its background service. Reload the extension and try again.",
    );
    expect(alert).not.toHaveTextContent(/secret backend stack|payload/i);
    expect(screen.getByRole("status")).toHaveTextContent("Background unavailable");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    await expectNoSeriousAxeViolations(container);
  });

  it("lists vault items with kind-appropriate subtitles and category counts once unlocked", async () => {
    const platform = readyUnlockedPlatform();
    const { container } = render(<VaultApp platform={platform} />);

    await screen.findByText("Example Login");
    expect(screen.getByText("Example Note")).toBeVisible();
    expect(screen.getByText("alice")).toBeVisible();

    const allCategory = screen.getByRole("button", { name: /All/ });
    expect(within(allCategory).getByText("2")).toBeVisible();

    await waitFor(() =>
      expect(platform.sentMessages).toContainEqual({ version: 1, kind: "item.query" }),
    );

    await expectNoSeriousAxeViolations(container);
  });

  it("shows an empty detail placeholder until an item is selected, then the item's own detail view", async () => {
    const platform = readyUnlockedPlatform();
    render(<VaultApp platform={platform} />);

    expect(await screen.findByText("Select an item to view its details.")).toBeVisible();
    const loginRow = await screen.findByRole("button", { name: /Example Login/ });
    fireEvent.click(loginRow);

    expect(await screen.findByRole("heading", { name: "Example Login" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy username" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete" })).toBeVisible();
  });

  it("filters the item list by category without changing the sidebar's total counts", async () => {
    const platform = readyUnlockedPlatform();
    render(<VaultApp platform={platform} />);

    await screen.findByText("Example Login");

    fireEvent.click(screen.getByRole("button", { name: /Notes/ }));

    expect(screen.queryByText("Example Login")).not.toBeInTheDocument();
    expect(screen.getByText("Example Note")).toBeVisible();
    expect(within(screen.getByRole("button", { name: /All/ })).getByText("2")).toBeVisible();
  });

  it("defers migration and Ente sync requests until the Settings destination is opened", async () => {
    const platform = readyUnlockedPlatform();
    render(<VaultApp platform={platform} />);

    await screen.findByText("Example Login");
    expect(platform.sentMessages).not.toContainEqual({ version: 1, kind: "migration.inspect" });

    // MigrationPanel's migration.inspect fires synchronously on mount; VaultAccess's
    // vault.getState only fires ~250ms later via its connectVaultState fallback timer.
    // FakeExtensionPlatform serves queued responses in strict FIFO order regardless of
    // which request consumes them, so the queue order here must match that send order.
    platform.queueSendResponse({
      version: 1,
      kind: "migration.status",
      available: false,
      phase: "none",
      itemCount: 0,
    });
    platform.queueSendResponse(unlockedVaultState(2));

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    await waitFor(() =>
      expect(platform.sentMessages).toContainEqual({ version: 1, kind: "migration.inspect" }),
    );
    expect(await screen.findByRole("heading", { name: "Vault unlocked" })).toBeVisible();
  });

  it("creates a folder inline from the sidebar and shows it in the tree", async () => {
    const platform = readyUnlockedPlatform();
    render(<VaultApp platform={platform} />);
    await screen.findByText("Example Login");

    const created = { id: "20000000-0000-4000-8000-000000000001", name: "Work" };
    platform.queueSendResponse({ version: 1, kind: "folder.listResult", folders: [created] });

    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    const input = screen.getByRole("textbox", { name: "New folder name" });
    fireEvent.change(input, { target: { value: "Work" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() =>
      expect(platform.sentMessages).toContainEqual({ version: 1, kind: "folder.create", name: "Work" }),
    );
    const tree = await screen.findByRole("tree", { name: "Folders" });
    expect(within(tree).getByText("Work")).toBeVisible();
  });

  it("opens the Archive as a separate query and offers no New button there", async () => {
    const platform = readyUnlockedPlatform();
    render(<VaultApp platform={platform} />);
    await screen.findByText("Example Login");

    platform.queueSendResponse({ version: 1, kind: "item.queryResult", items: [] });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() =>
      expect(platform.sentMessages).toContainEqual({ version: 1, kind: "item.query", archived: true }),
    );
    expect(await screen.findByText("Nothing archived")).toBeVisible();
    expect(screen.queryByRole("button", { name: /New item|Add your first item|Add one/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Archive" })).toHaveAttribute("aria-current", "true");
  });
});

describe("vault source and responsive style contracts", () => {
  it("keeps styles external and avoids unsupported Chrome 110-only syntax", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const extensionRoot = path.resolve(process.cwd(), "apps/extension");
    const [html, css, main] = await Promise.all([
      readFile(path.join(extensionRoot, "vault/index.html"), "utf8"),
      readFile(path.join(extensionRoot, "src/vault/VaultApp.module.css"), "utf8"),
      readFile(path.join(extensionRoot, "src/vault/main.tsx"), "utf8"),
    ]);

    expect(html).toContain('class="vaultDocument"');
    expect(html).toContain('class="vaultBody"');
    expect(html).toContain('id="root" class="vaultRoot"');
    expect(html).toContain('src="../src/vault/main.tsx"');
    expect(html).not.toContain('src="../src/vault/main.ts"');
    expect(html).not.toMatch(/<style\b|style=/i);
    expect(main).toContain('import "@shardpass/ui/styles"');
    expect(main).not.toMatch(/\.style\b|setAttribute\(["']style/i);
    expect(css).not.toMatch(
      /color-mix\(|light-dark\(|oklch\(|@starting-style|transition-behavior|field-sizing/,
    );
  });
});
