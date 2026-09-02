import "@testing-library/jest-dom/vitest";

import { readFile } from "node:fs/promises";
import path from "node:path";

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

const foundationStatus = {
  version: 1,
  kind: "foundation.status",
  phase: "foundation",
  vaultAvailable: false,
} as const;

const rawFailureText = "secret backend stack and payload";

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

function createDeferredPlatform(): {
  platform: ExtensionPlatform;
  sendMessage: ReturnType<typeof vi.fn>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
} {
  let resolveResponse: (value: unknown) => void = () => undefined;
  let rejectResponse: (reason: unknown) => void = () => undefined;
  const response = new Promise<unknown>((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  const sendMessage = vi.fn(() => response);

  return {
    platform: {
      extensionId: "popup-test-id",
      onMessage: () => () => undefined,
      sendMessage,
      sendOtpMessage: vi.fn(() => Promise.reject(new Error("unused"))),
      writeAuthoritativeClipboardText: vi.fn(() => Promise.resolve()),
      openVaultPage: vi.fn(() => Promise.resolve()),
    },
    sendMessage,
    resolve: resolveResponse,
    reject: rejectResponse,
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

describe("PopupApp foundation states", () => {
  it("shows a compact loading skeleton and announces status while requesting the strict command", async () => {
    const { platform, sendMessage } = createDeferredPlatform();
    const { container } = render(<PopupApp platform={platform} />);

    expect(screen.getByRole("banner", { name: "ShardPass" })).toBeVisible();
    expect(screen.getByText("FOUNDATION")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Checking foundation status");
    expect(screen.getByTestId("foundation-skeleton")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Open vault" })).toBeDisabled();
    expect(sendMessage).toHaveBeenCalledWith({
      version: 1,
      kind: "foundation.getStatus",
    });
    await expectNoSeriousAxeViolations(container);
  });

  it("renders only validated foundation status and restrained setup guidance", async () => {
    const platform = new FakeExtensionPlatform("popup-test-id");
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
    const { container } = render(<PopupApp platform={platform} />);

    expect(await screen.findByRole("status")).toHaveTextContent("Foundation ready");
    expect(await screen.findByText("Create your vault")).toBeVisible();
    expect(screen.getByText(/derives the unlock key in a dedicated worker/i)).toBeVisible();
    expect(platform.sentMessages).toEqual([
      { version: 1, kind: "foundation.getStatus" },
      { version: 1, kind: "ente.status" },
      { version: 1, kind: "vault.getState" },
    ]);
    expect(screen.getByLabelText("Master password")).toBeVisible();
    expect(screen.queryByText(/fake|demo secret/i)).not.toBeInTheDocument();
    await expectNoSeriousAxeViolations(container);
  });

  it("mounts OTP content only for the unlocked vault state and removes metadata on lock", async () => {
    let publishVaultState: (state: unknown) => void = () => undefined;
    const platform: ExtensionPlatform = {
      extensionId: "popup-test-id",
      onMessage: () => () => undefined,
      sendMessage: vi.fn().mockResolvedValueOnce(foundationStatus).mockResolvedValueOnce({
        version: 1,
        kind: "vault.state",
        state: "unlocked",
        autoLockMinutes: 15,
        lockOnScreenLock: true,
        retryAfterMs: 0,
        streamId: "00000000000000000000000000000001",
        sequence: 1,
      }),
      connectVaultState: (onState) => {
        publishVaultState = onState;
        return () => undefined;
      },
      sendOtpMessage: vi.fn(() =>
        Promise.resolve({
          version: 1 as const,
          kind: "otp.listResult" as const,
          items: [
            {
              id: "10000000-0000-4000-8000-000000000001",
              revision: 1,
              issuer: "North Lab",
              label: "Operator",
              otpType: "hotp" as const,
              favorite: false,
              tags: [],
            },
          ],
        }),
      ),
      writeAuthoritativeClipboardText: () => Promise.resolve(),
      openVaultPage: () => Promise.resolve(),
    };
    render(<PopupApp platform={platform} />);

    expect(await screen.findByText("North Lab")).toBeVisible();
    act(() => {
      publishVaultState({
        version: 1,
        kind: "vault.state",
        state: "locked",
        autoLockMinutes: 15,
        lockOnScreenLock: true,
        retryAfterMs: 0,
        streamId: "00000000000000000000000000000001",
        sequence: 2,
      });
    });

    expect(screen.queryByText("North Lab")).not.toBeInTheDocument();
    expect(screen.queryByText("Operator")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Secret")).not.toBeInTheDocument();
  });

  it("redacts synchronously in the accepted lock publication batch and ignores late OTP data", async () => {
    let publishVaultState: (state: unknown) => void = () => undefined;
    const lateList = deferred<unknown>();
    const platform: ExtensionPlatform = {
      extensionId: "popup-test-id",
      onMessage: () => () => undefined,
      sendMessage: vi.fn().mockResolvedValueOnce(foundationStatus).mockResolvedValueOnce({
        version: 1,
        kind: "vault.state",
        state: "unlocked",
        autoLockMinutes: 15,
        lockOnScreenLock: true,
        retryAfterMs: 0,
        streamId: "00000000000000000000000000000001",
        sequence: 1,
      }),
      connectVaultState: (onState) => {
        publishVaultState = onState;
        return () => undefined;
      },
      sendOtpMessage: vi.fn(() => lateList.promise as Promise<never>),
      writeAuthoritativeClipboardText: () => Promise.resolve(),
      openVaultPage: () => Promise.resolve(),
    };
    render(<PopupApp platform={platform} />);
    expect(await screen.findByText("Loading OTP items…")).toBeVisible();

    act(() => {
      publishVaultState({
        version: 1,
        kind: "vault.state",
        state: "locked",
        autoLockMinutes: 15,
        lockOnScreenLock: true,
        retryAfterMs: 0,
        streamId: "00000000000000000000000000000001",
        sequence: 2,
      });
    });
    expect(screen.queryByText("Loading OTP items…")).not.toBeInTheDocument();
    lateList.resolve({
      version: 1,
      kind: "otp.listResult",
      items: [
        {
          id: "10000000-0000-4000-8000-000000000001",
          revision: 1,
          issuer: "North Lab",
          label: "Operator",
          otpType: "hotp",
          favorite: false,
          tags: [],
        },
      ],
    });
    await act(async () => Promise.resolve());
    expect(screen.queryByText("North Lab")).not.toBeInTheDocument();
  });

  it.each([
    ["a rejected request", () => Promise.reject(new Error(rawFailureText))],
    ["a malformed response", () => Promise.resolve({ ...foundationStatus, vaultAvailable: true })],
    [
      "a background error envelope",
      () =>
        Promise.resolve({
          version: 1,
          kind: "error",
          error: { code: "UNEXPECTED", message: rawFailureText },
        }),
    ],
  ])("uses one safe stable error state for %s", async (_label, sendMessage) => {
    const platform: ExtensionPlatform = {
      extensionId: "popup-test-id",
      onMessage: () => () => undefined,
      sendMessage,
      sendOtpMessage: () => Promise.reject(new Error("unused")),
      writeAuthoritativeClipboardText: () => Promise.resolve(),
      openVaultPage: () => Promise.resolve(),
    };
    const { container } = render(<PopupApp platform={platform} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ShardPass couldn’t confirm its foundation status. Try reopening the popup.",
    );
    expect(screen.queryByText(rawFailureText)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open vault" })).toBeEnabled();
    await expectNoSeriousAxeViolations(container);
  });
});

describe("PopupApp vault action", () => {
  it("opens the full vault through the platform with keyboard activation", async () => {
    const platform = new FakeExtensionPlatform("popup-test-id");
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
    render(<PopupApp platform={platform} />);
    const openVault = await screen.findByRole("button", { name: "Open vault" });

    openVault.focus();
    fireEvent.keyDown(openVault, { key: "Enter", code: "Enter" });
    fireEvent.keyUp(openVault, { key: "Enter", code: "Enter" });
    fireEvent.click(openVault);

    await waitFor(() => expect(platform.openVaultPageCallCount).toBe(1));
  });

  it("announces a safe action error without exposing platform details", async () => {
    const platform: ExtensionPlatform = {
      extensionId: "popup-test-id",
      onMessage: () => () => undefined,
      sendMessage: () => Promise.resolve(foundationStatus),
      sendOtpMessage: () => Promise.reject(new Error("unused")),
      writeAuthoritativeClipboardText: () => Promise.resolve(),
      openVaultPage: () => Promise.reject(new Error(rawFailureText)),
    };
    render(<PopupApp platform={platform} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open vault" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The vault could not be opened. Try again.",
    );
    expect(screen.queryByText(rawFailureText)).not.toBeInTheDocument();
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a deferred %s after the action owner unmounts",
    async (settlement) => {
      const pending = deferred<void>();
      const platform: ExtensionPlatform = {
        extensionId: "popup-test-id",
        onMessage: () => () => undefined,
        sendMessage: () => Promise.resolve(foundationStatus),
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
      sendMessage: () => Promise.resolve(foundationStatus),
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
  it("scopes exact width, horizontal clipping, and vertical scrolling to popup classes", async () => {
    const popupRoot = path.resolve(process.cwd(), "apps/extension");
    const [html, css] = await Promise.all([
      readFile(path.join(popupRoot, "popup/index.html"), "utf8"),
      readFile(path.join(popupRoot, "src/popup/PopupApp.module.css"), "utf8"),
    ]);

    expect(html).toContain('class="popupDocument"');
    expect(html).toContain('class="popupBody"');
    expect(html).toContain('src="../src/popup/main.tsx"');
    expect(css).toMatch(/:global\(\.popupDocument\)[\s\S]*width:\s*360px/);
    expect(css).toMatch(/:global\(\.popupBody\)[\s\S]*width:\s*360px/);
    expect(css).toMatch(/:global\(\.popupBody\)[\s\S]*overflow-x:\s*hidden/);
    expect(css).toMatch(/:global\(\.popupBody\)[\s\S]*overflow-y:\s*auto/);
    expect(css).not.toMatch(/overflow:\s*hidden/);
    expect(css).not.toMatch(/max-height\s*:/);
    expect(css).not.toMatch(/:global\((?:html|body)\)/);
  });

  it("keeps enlarged content, the live region, and primary action reachable in scroll order", async () => {
    document.documentElement.className = "popupDocument";
    document.body.className = "popupBody";
    const platform = new FakeExtensionPlatform("popup-test-id");
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
    render(<PopupApp platform={platform} />);

    const liveStatus = await screen.findByRole("status");
    const action = screen.getByRole("button", { name: "Open vault" });
    const longCopy = await screen.findByText(/derives the unlock key in a dedicated worker/i);
    longCopy.textContent = Array.from({ length: 40 }, () => "Long localized setup guidance.").join(
      " ",
    );

    Object.defineProperties(document.body, {
      clientHeight: { configurable: true, value: 240 },
      scrollHeight: { configurable: true, value: 960 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    Object.defineProperty(action, "offsetTop", { configurable: true, value: 900 });

    expect(document.body.scrollHeight).toBeGreaterThan(document.body.clientHeight);
    expect(document.body).toContainElement(liveStatus);
    expect(document.body).toContainElement(action);
    action.focus();
    expect(action).toHaveFocus();

    document.body.scrollTop = action.offsetTop - document.body.clientHeight;
    expect(document.body.scrollTop + document.body.clientHeight).toBe(action.offsetTop);
    expect(screen.getAllByRole("button")).toContain(action);
  });
});
