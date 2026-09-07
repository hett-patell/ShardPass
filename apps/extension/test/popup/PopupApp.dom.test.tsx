import "@testing-library/jest-dom/vitest";

import type { OtpRequest, OtpResponse } from "@shardpass/messaging";
import { FakeExtensionPlatform } from "@shardpass/testing";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PopupApp, useOpenVaultAction } from "../../src/popup/PopupApp";
import type { ExtensionPlatform } from "../../src/platform/extension-platform";

const rawFailureText = "secret backend stack and payload";
const LOGIN_ID = "10000000-0000-4000-8000-000000000010";
const OTP_ID = "10000000-0000-4000-8000-000000000020";
const NOTE_ID = "10000000-0000-4000-8000-000000000030";

function vaultState(state: "locked" | "unconfigured" | "unlocked", sequence: number): Record<string, unknown> {
  return {
    version: 1,
    kind: "vault.state",
    state,
    autoLockMinutes: 15,
    lockOnScreenLock: true,
    retryAfterMs: 0,
    streamId: "00000000000000000000000000000001",
    sequence,
  };
}

const loginProjection = {
  id: LOGIN_ID,
  kind: "login",
  revision: 1,
  name: "Example Portal",
  subtitle: "alice@example.test",
  favorite: true,
  tags: [],
  urls: ["https://example.test/login"],
};
const otpProjection = { id: OTP_ID, kind: "otp", revision: 1, name: "North Lab", subtitle: "Operator", favorite: false, tags: [] };
const noteProjection = { id: NOTE_ID, kind: "note", revision: 2, name: "Wifi", subtitle: "pass", favorite: false, tags: ["home"] };
const loginItem = {
  id: LOGIN_ID,
  kind: "login",
  schemaVersion: 2,
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  favorite: true,
  tags: [],
  name: "Example Portal",
  username: "alice@example.test",
  password: "hunter2",
  urls: ["https://example.test/login"],
  notes: "",
};

function createTestPlatform(options: { tab?: { id: number; url: string } | null; fill?: unknown } = {}) {
  let onState: (state: unknown) => void = () => undefined;
  const items = [loginProjection, otpProjection, noteProjection];
  const sendMessage = vi.fn((payload: unknown) => {
    const request = payload as { kind?: unknown; itemId?: unknown };
    if (request.kind === "item.list") return Promise.resolve({ version: 1, kind: "item.listResult", items });
    if (request.kind === "item.get" && request.itemId === LOGIN_ID)
      return Promise.resolve({ version: 1, kind: "item.getResult", item: loginItem });
    if (request.kind === "login.reveal")
      return Promise.resolve({ version: 1, kind: "login.fillRelease", username: "alice@example.test", password: "hunter2" });
    if (request.kind === "vault.lock")
      return Promise.resolve({ version: 1, kind: "vault.ok", state: "locked", committed: true });
    return Promise.resolve(undefined);
  });
  const sendOtpMessage = vi.fn<(request: OtpRequest) => Promise<OtpResponse>>((request) => {
    if (request.kind === "otp.getCode")
      return Promise.resolve({
        version: 1,
        kind: "otp.codeResult",
        itemId: request.itemId,
        revision: 1,
        code: "123456",
        period: 30,
        expiresAt: Date.now() + 20_000,
      } as OtpResponse);
    return Promise.reject(new Error("unused"));
  });
  const writeAuthoritativeClipboardText = vi.fn((value: Promise<string>) => value.then(() => undefined));
  const openVaultPage = vi.fn((): Promise<void> => Promise.resolve());
  const sendToTab = vi.fn(() => Promise.resolve(options.fill ?? { version: 1, kind: "login.fillFromPopupResult", status: "filled" }));
  const platform: ExtensionPlatform = {
    extensionId: "popup-test-id",
    onMessage: () => () => undefined,
    sendMessage,
    connectVaultState: (onStateCallback) => {
      onState = onStateCallback;
      return () => undefined;
    },
    sendOtpMessage,
    writeAuthoritativeClipboardText,
    openVaultPage,
    activeTab: () => Promise.resolve(options.tab === undefined ? null : options.tab),
    sendToTab,
  };
  return { platform, publishVaultState: (state: unknown) => onState(state), sendMessage, sendOtpMessage, writeAuthoritativeClipboardText, openVaultPage, sendToTab };
}

async function expectNoSeriousAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, { resultTypes: ["violations"], rules: { "color-contrast": { enabled: false } } });
  expect(results.violations.filter(({ impact }) => ["serious", "critical"].includes(impact ?? ""))).toEqual([]);
}

async function renderUnlocked(options: Parameters<typeof createTestPlatform>[0] = {}) {
  const fixture = createTestPlatform(options);
  const view = render(<PopupApp platform={fixture.platform} />);
  act(() => fixture.publishVaultState(vaultState("unlocked", 1)));
  await screen.findByRole("searchbox", { name: "Search ShardPass" });
  return { ...fixture, ...view };
}

afterEach(cleanup);

describe("PopupApp lock screen", () => {
  it("shows the lock screen and never queries items while locked", async () => {
    const { platform, publishVaultState, sendMessage } = createTestPlatform();
    const { container } = render(<PopupApp platform={platform} />);
    act(() => publishVaultState(vaultState("locked", 1)));
    expect(await screen.findByText("Unlock ShardPass")).toBeVisible();
    expect(screen.getByLabelText("Master password")).toBeVisible();
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "item.list" }));
    await expectNoSeriousAxeViolations(container);
  });

  it("shows vault setup guidance when the vault is unconfigured", async () => {
    const platform = new FakeExtensionPlatform("popup-test-id");
    platform.queueSendResponse(vaultState("unconfigured", 1));
    render(<PopupApp platform={platform} />);
    expect(await screen.findByText("Create your vault")).toBeVisible();
  });
});

describe("PopupApp home", () => {
  it("lists the categories with counts, loads the whole vault once, and passes axe", async () => {
    const { container, sendMessage } = await renderUnlocked();
    const categories = await screen.findByRole("button", { name: /Logins/ });
    expect(categories).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: /All items/ })).toHaveTextContent("3"));
    expect(screen.getByRole("button", { name: /Favorites/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /One-time codes/ })).toHaveTextContent("1");
    expect(sendMessage.mock.calls.filter(([payload]) => (payload as { kind?: unknown }).kind === "item.list")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Lock vault" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Open vault" })).toBeVisible();
    expect(screen.queryByText("Suggestions")).not.toBeInTheDocument();
    await expectNoSeriousAxeViolations(container);
  });

  it("suggests the logins saved for the open tab and fills from the row", async () => {
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => undefined);
    const { sendToTab } = await renderUnlocked({ tab: { id: 7, url: "https://example.test/account" } });
    const suggestions = await screen.findByRole("region", { name: /^Suggestions/ });
    expect(within(suggestions).getByText("example.test")).toBeVisible();
    expect(within(suggestions).getByText("Example Portal")).toBeVisible();
    fireEvent.click(within(suggestions).getByRole("button", { name: "Fill" }));
    await waitFor(() =>
      expect(sendToTab).toHaveBeenCalledWith(7, { version: 1, kind: "login.fillFromPopup", itemId: LOGIN_ID, expectedRevision: 1 }),
    );
    await waitFor(() => expect(closeSpy).toHaveBeenCalled());
    closeSpy.mockRestore();
  });

  it("says when the open tab has no saved login", async () => {
    await renderUnlocked({ tab: { id: 7, url: "https://other.example/" } });
    expect(await screen.findByText("No logins saved for other.example.")).toBeVisible();
  });

  it("searches every kind from the home screen", async () => {
    await renderUnlocked();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search ShardPass" }), { target: { value: "north" } });
    const results = await screen.findByRole("region", { name: /^Results/ });
    expect(within(results).getByText("North Lab")).toBeVisible();
    expect(within(results).queryByText("Example Portal")).not.toBeInTheDocument();
  });
});

describe("PopupApp screens", () => {
  it("opens a category list, then an item's detail with copyable fields and a masked password", async () => {
    const { sendMessage, writeAuthoritativeClipboardText } = await renderUnlocked();
    fireEvent.click(await screen.findByRole("button", { name: /Logins/ }));
    expect(await screen.findByRole("heading", { name: "Logins" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^Example Portal/ }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ version: 1, kind: "item.get", itemId: LOGIN_ID }));
    expect(await screen.findByRole("heading", { level: 2, name: "Example Portal" })).toBeVisible();
    expect(screen.getByText("alice@example.test", { selector: "span" })).toBeVisible();
    expect(screen.queryByText("hunter2")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByText("hunter2")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    await waitFor(() => expect(writeAuthoritativeClipboardText).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Password copied")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Logins" })).toBeVisible();
  });

  it("shows a live code in the one-time codes list and copies it", async () => {
    const { writeAuthoritativeClipboardText } = await renderUnlocked();
    fireEvent.click(await screen.findByRole("button", { name: /One-time codes/ }));
    const code = await screen.findByRole("button", { name: "Copy code 123456" });
    fireEvent.click(code);
    await waitFor(() => expect(writeAuthoritativeClipboardText).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Code copied")).toBeVisible();
  });

  it("copies a login's password from its list row through login.reveal", async () => {
    const { sendMessage, writeAuthoritativeClipboardText } = await renderUnlocked();
    fireEvent.click(await screen.findByRole("button", { name: /Logins/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy password for Example Portal" }));
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({ version: 1, kind: "login.reveal", itemId: LOGIN_ID, expectedRevision: 1 }),
    );
    await waitFor(() => expect(writeAuthoritativeClipboardText).toHaveBeenCalledTimes(1));
  });

  it("locks the vault from the title bar", async () => {
    const { sendMessage } = await renderUnlocked();
    fireEvent.click(screen.getByRole("button", { name: "Lock vault" }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ version: 1, kind: "vault.lock" }));
    expect(screen.queryByRole("searchbox", { name: "Search ShardPass" })).not.toBeInTheDocument();
  });

  it("surfaces a safe error when the vault page cannot open", async () => {
    const { openVaultPage } = await renderUnlocked();
    openVaultPage.mockImplementationOnce(() => Promise.reject(new Error(rawFailureText)));
    fireEvent.click(screen.getByRole("button", { name: "Open vault settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The vault could not be opened. Try again.");
    expect(screen.queryByText(rawFailureText)).not.toBeInTheDocument();
  });
});

describe("PopupApp vault action hook", () => {
  const stubPlatform = (openVaultPage: () => Promise<void>): ExtensionPlatform => ({
    extensionId: "popup-test-id",
    onMessage: () => () => undefined,
    sendMessage: () => Promise.resolve(undefined),
    sendOtpMessage: () => Promise.reject(new Error("unused")),
    writeAuthoritativeClipboardText: () => Promise.resolve(),
    openVaultPage,
    activeTab: () => Promise.resolve(null),
    sendToTab: () => Promise.resolve(undefined),
  });

  it.each(["resolve", "reject"] as const)("ignores a deferred %s after the action owner unmounts", async (settlement) => {
    let settle: { resolve: () => void; reject: (reason: unknown) => void } = { resolve: () => undefined, reject: () => undefined };
    const pending = new Promise<void>((resolve, reject) => {
      settle = { resolve, reject };
    });
    const { result, unmount } = renderHook(() => useOpenVaultAction(stubPlatform(() => pending)));
    let invocation: Promise<void> | undefined;
    act(() => {
      invocation = result.current.openVault();
    });
    expect(result.current.openingVault).toBe(true);
    unmount();
    await act(async () => {
      if (settlement === "resolve") settle.resolve();
      else settle.reject(new Error(rawFailureText));
      await invocation;
    });
    expect(result.current.openingVault).toBe(true);
    expect(result.current.actionError).toBe(false);
  });

  it("lets only the latest invocation update action state", async () => {
    let firstSettle: () => void = () => undefined;
    let secondSettle: () => void = () => undefined;
    const first = new Promise<void>((resolve) => {
      firstSettle = resolve;
    });
    const second = new Promise<void>((resolve) => {
      secondSettle = resolve;
    });
    const openVaultPage = vi.fn().mockImplementationOnce(() => first).mockImplementationOnce(() => second);
    const { result } = renderHook(() => useOpenVaultAction(stubPlatform(openVaultPage)));
    let firstInvocation: Promise<void> | undefined;
    let secondInvocation: Promise<void> | undefined;
    act(() => {
      firstInvocation = result.current.openVault();
      secondInvocation = result.current.openVault();
    });
    await act(async () => {
      firstSettle();
      await firstInvocation;
    });
    expect(result.current.openingVault).toBe(true);
    await act(async () => {
      secondSettle();
      await secondInvocation;
    });
    expect(result.current.openingVault).toBe(false);
  });
});
