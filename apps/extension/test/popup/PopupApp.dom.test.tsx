import "@testing-library/jest-dom/vitest";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { OtpRequest, OtpResponse } from "@shardpass/messaging";
import { FakeExtensionPlatform } from "@shardpass/testing";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PopupApp, useOpenVaultAction } from "../../src/popup/PopupApp";
import type { ExtensionPlatform } from "../../src/platform/extension-platform";

const rawFailureText = "secret backend stack and payload";

function vaultState(
  state: "locked" | "unconfigured" | "unlocked",
  sequence: number,
): Record<string, unknown> {
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

function itemListResult(items: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { version: 1, kind: "item.listResult", items };
}

function loginProjection(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: "10000000-0000-4000-8000-000000000010",
    kind: "login",
    revision: 1,
    name: "Example Portal",
    subtitle: "alice@example.test",
    favorite: false,
    tags: [],
    ...overrides,
  };
}

function otpProjection(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "10000000-0000-4000-8000-000000000020",
    kind: "otp",
    revision: 1,
    name: "North Lab",
    subtitle: "Operator",
    favorite: false,
    tags: [],
    ...overrides,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createTestPlatform() {
  let onState: (state: unknown) => void = () => undefined;
  const itemListQueue: unknown[] = [];

  const sendMessage = vi.fn((payload: unknown) => {
    const kind = (payload as { kind?: unknown }).kind;
    if (kind === "item.list") {
      return Promise.resolve(itemListQueue.shift() ?? itemListResult([]));
    }
    if (kind === "vault.lock") {
      return Promise.resolve({ version: 1, kind: "vault.ok", state: "locked", committed: true });
    }
    return Promise.resolve(undefined);
  });
  const sendOtpMessage = vi.fn<(request: OtpRequest) => Promise<OtpResponse>>(() =>
    Promise.reject(new Error("unused")),
  );
  const writeAuthoritativeClipboardText = vi.fn(() => Promise.resolve());
  const openVaultPage = vi.fn((): Promise<void> => Promise.resolve());

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
  };

  return {
    platform,
    publishVaultState: (state: unknown) => onState(state),
    queueItemList: (result: unknown) => itemListQueue.push(result),
    sendMessage,
    sendOtpMessage,
    writeAuthoritativeClipboardText,
    openVaultPage,
  };
}

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

afterEach(cleanup);

describe("PopupApp lock screen", () => {
  it("shows the lock screen and never queries items while locked", async () => {
    const { platform, publishVaultState, sendMessage } = createTestPlatform();
    const { container } = render(<PopupApp platform={platform} />);

    act(() => publishVaultState(vaultState("locked", 1)));

    expect(await screen.findByText("Unlock ShardPass")).toBeVisible();
    expect(screen.getByLabelText("Master password")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add item" })).not.toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "item.list" }));
    await expectNoSeriousAxeViolations(container);
  });

  it("shows vault setup guidance when the vault is unconfigured", async () => {
    const platform = new FakeExtensionPlatform("popup-test-id");
    platform.queueSendResponse(vaultState("unconfigured", 1));
    render(<PopupApp platform={platform} />);

    expect(await screen.findByText("Create your vault")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add item" })).not.toBeInTheDocument();
  });
});

describe("PopupApp unlocked shell", () => {
  it("reveals the header, search, filter tabs, item list, and add-item menu once unlocked", async () => {
    const { platform, publishVaultState, queueItemList, sendMessage } = createTestPlatform();
    queueItemList(itemListResult([loginProjection()]));
    const { container } = render(<PopupApp platform={platform} />);

    act(() => publishVaultState(vaultState("unlocked", 1)));

    expect(await screen.findByText("Example Portal")).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "Search items" })).toBeVisible();
    expect(screen.getByRole("tablist", { name: "Filter items" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "All", selected: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add item" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Lock vault" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Open vault settings" })).toBeVisible();
    expect(sendMessage).toHaveBeenCalledWith({
      version: 1,
      kind: "item.list",
      itemKind: undefined,
      search: undefined,
    });
    await expectNoSeriousAxeViolations(container);
  });

  it("shows an empty state when no items match", async () => {
    const { platform, publishVaultState, queueItemList } = createTestPlatform();
    queueItemList(itemListResult([]));
    render(<PopupApp platform={platform} />);

    act(() => publishVaultState(vaultState("unlocked", 1)));

    expect(await screen.findByText("No items yet")).toBeVisible();
  });

  it("switches the filter tab and immediately requeries item.list by kind", async () => {
    const { platform, publishVaultState, queueItemList, sendMessage } = createTestPlatform();
    queueItemList(itemListResult([loginProjection()]));
    queueItemList(itemListResult([otpProjection()]));
    render(<PopupApp platform={platform} />);
    act(() => publishVaultState(vaultState("unlocked", 1)));
    await screen.findByText("Example Portal");

    fireEvent.click(screen.getByRole("tab", { name: "OTP" }));

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        version: 1,
        kind: "item.list",
        itemKind: "otp",
        search: undefined,
      }),
    );
    expect(await screen.findByText("North Lab")).toBeVisible();
    expect(screen.getByRole("tab", { name: "OTP", selected: true })).toBeVisible();
  });

  it("debounces search text before requerying item.list", async () => {
    const { platform, publishVaultState, queueItemList, sendMessage } = createTestPlatform();
    queueItemList(itemListResult([loginProjection()]));
    queueItemList(itemListResult([loginProjection({ name: "Acme Portal" })]));
    render(<PopupApp platform={platform} />);
    act(() => publishVaultState(vaultState("unlocked", 1)));
    await screen.findByText("Example Portal");
    sendMessage.mockClear();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search items" }), {
      target: { value: "acme" },
    });
    expect(sendMessage).not.toHaveBeenCalled();

    await waitFor(
      () =>
        expect(sendMessage).toHaveBeenCalledWith({
          version: 1,
          kind: "item.list",
          itemKind: undefined,
          search: "acme",
        }),
      { timeout: 1_000 },
    );
    expect(await screen.findByText("Acme Portal")).toBeVisible();
  });

  it("shows a live OTP code and copies it when the row is activated", async () => {
    const {
      platform,
      publishVaultState,
      queueItemList,
      sendOtpMessage,
      writeAuthoritativeClipboardText,
    } = createTestPlatform();
    queueItemList(itemListResult([otpProjection()]));
    sendOtpMessage.mockImplementation((request: OtpRequest): Promise<OtpResponse> => {
      const kind = request.kind;
      if (kind === "otp.getCode" || kind === "otp.copyCode") {
        return Promise.resolve({
          version: 1,
          kind: "otp.codeResult",
          itemId: "10000000-0000-4000-8000-000000000020",
          revision: 1,
          code: "123456",
          otpType: "totp",
          period: 30,
          remaining: 30,
          expiresAt: Date.now() + 30_000,
        });
      }
      return Promise.reject(new Error("unused"));
    });
    render(<PopupApp platform={platform} />);
    act(() => publishVaultState(vaultState("unlocked", 1)));

    expect(await screen.findByText("123456")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /North Lab/ }));

    await waitFor(() => expect(writeAuthoritativeClipboardText).toHaveBeenCalledTimes(1));
    expect(sendOtpMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "otp.copyCode",
        itemId: "10000000-0000-4000-8000-000000000020",
      }),
    );
    expect(await screen.findByText("Code copied")).toBeVisible();
  });

  it("locks the vault from the header and hides the item list", async () => {
    const { platform, publishVaultState, queueItemList, sendMessage } = createTestPlatform();
    queueItemList(itemListResult([loginProjection()]));
    render(<PopupApp platform={platform} />);
    act(() => publishVaultState(vaultState("unlocked", 1)));
    await screen.findByText("Example Portal");

    fireEvent.click(screen.getByRole("button", { name: "Lock vault" }));

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({ version: 1, kind: "vault.lock" }),
    );
    expect(screen.queryByRole("button", { name: "Add item" })).not.toBeInTheDocument();
  });

  it("opens vault settings from the header and surfaces a safe error on failure", async () => {
    const { platform, publishVaultState, queueItemList, openVaultPage } = createTestPlatform();
    queueItemList(itemListResult([loginProjection()]));
    openVaultPage.mockImplementationOnce((): Promise<void> =>
      Promise.reject(new Error(rawFailureText)),
    );
    render(<PopupApp platform={platform} />);
    act(() => publishVaultState(vaultState("unlocked", 1)));
    await screen.findByText("Example Portal");

    fireEvent.click(screen.getByRole("button", { name: "Open vault settings" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The vault could not be opened. Try again.",
    );
    expect(screen.queryByText(rawFailureText)).not.toBeInTheDocument();
  });
});

describe("PopupApp vault action hook", () => {
  it.each(["resolve", "reject"] as const)(
    "ignores a deferred %s after the action owner unmounts",
    async (settlement) => {
      const pending = deferred<void>();
      const platform: ExtensionPlatform = {
        extensionId: "popup-test-id",
        onMessage: () => () => undefined,
        sendMessage: () => Promise.resolve(undefined),
        sendOtpMessage: () => Promise.reject(new Error("unused")),
        writeAuthoritativeClipboardText: () => Promise.resolve(),
        openVaultPage: () => pending.promise,
      };
      const { result, unmount } = renderHook(() => useOpenVaultAction(platform));

      let invocation: Promise<void> | undefined;
      act(() => {
        invocation = result.current.openVault();
      });
      expect(result.current.openingVault).toBe(true);
      unmount();

      await act(async () => {
        if (settlement === "resolve") {
          pending.resolve(undefined);
        } else {
          pending.reject(new Error(rawFailureText));
        }
        await invocation;
      });

      expect(result.current.openingVault).toBe(true);
      expect(result.current.actionError).toBe(false);
    },
  );

  it("lets only the latest programmatic invocation update action state", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const openVaultPage = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const platform: ExtensionPlatform = {
      extensionId: "popup-test-id",
      onMessage: () => () => undefined,
      sendMessage: () => Promise.resolve(undefined),
      sendOtpMessage: () => Promise.reject(new Error("unused")),
      writeAuthoritativeClipboardText: () => Promise.resolve(),
      openVaultPage,
    };
    const { result } = renderHook(() => useOpenVaultAction(platform));

    let firstInvocation: Promise<void> | undefined;
    let secondInvocation: Promise<void> | undefined;
    act(() => {
      firstInvocation = result.current.openVault();
      secondInvocation = result.current.openVault();
    });
    expect(openVaultPage).toHaveBeenCalledTimes(2);

    await act(async () => {
      first.reject(new Error(rawFailureText));
      await firstInvocation;
    });
    expect(result.current.openingVault).toBe(true);
    expect(result.current.actionError).toBe(false);

    await act(async () => {
      second.resolve(undefined);
      await secondInvocation;
    });
    expect(result.current.openingVault).toBe(false);
    expect(result.current.actionError).toBe(false);
  });
});

describe("popup document contract", () => {
  it("scopes the fixed 400x540 popup canvas without clipping or max-height traps", async () => {
    const popupRoot = path.resolve(process.cwd(), "apps/extension");
    const [html, css] = await Promise.all([
      readFile(path.join(popupRoot, "popup/index.html"), "utf8"),
      readFile(path.join(popupRoot, "src/popup/PopupApp.module.css"), "utf8"),
    ]);

    expect(html).toContain('class="popupDocument"');
    expect(html).toContain('class="popupBody"');
    expect(html).toContain('src="../src/popup/main.tsx"');
    expect(css).toMatch(/:global\(\.popupDocument\)[\s\S]*width:\s*400px/);
    expect(css).toMatch(/:global\(\.popupBody\)[\s\S]*width:\s*400px/);
    expect(css).toMatch(/min-height:\s*540px/);
    expect(css).toMatch(/:global\(\.popupBody\)[\s\S]*overflow-x:\s*hidden/);
    expect(css).toMatch(/:global\(\.popupBody\)[\s\S]*overflow-y:\s*auto/);
    expect(css).not.toMatch(/overflow:\s*hidden/);
    expect(css).not.toMatch(/max-height\s*:/);
    expect(css).not.toMatch(/:global\((?:html|body)\)/);
  });

  it("keeps the add-item action reachable after the item list renders", async () => {
    document.documentElement.className = "popupDocument";
    document.body.className = "popupBody";
    const { platform, publishVaultState, queueItemList } = createTestPlatform();
    queueItemList(itemListResult([loginProjection()]));
    render(<PopupApp platform={platform} />);
    act(() => publishVaultState(vaultState("unlocked", 1)));
    await screen.findByText("Example Portal");

    const addItem = screen.getByRole("button", { name: "Add item" });
    expect(document.body).toContainElement(addItem);
    addItem.focus();
    expect(addItem).toHaveFocus();
  });
});
