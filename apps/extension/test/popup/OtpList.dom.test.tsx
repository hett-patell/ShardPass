import "@testing-library/jest-dom/vitest";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OtpRequest, OtpResponse } from "@shardpass/messaging";
import type { OtpUiExtensionPlatform } from "../../src/platform/extension-platform";
import { OtpCountdown } from "../../src/popup/otp/OtpCountdown";
import { OtpList } from "../../src/popup/otp/OtpList";
import { OtpRow } from "../../src/popup/otp/OtpRow";

const itemId = "10000000-0000-4000-8000-000000000001";
const steamId = "10000000-0000-4000-8000-000000000002";
const hotpId = "10000000-0000-4000-8000-000000000003";
const visiblePlaceholder = "246802";
const steamPlaceholder = "BCDFG";

const listResponse: Extract<OtpResponse, { kind: "otp.listResult" }> = {
  version: 1,
  kind: "otp.listResult",
  items: [
    {
      id: itemId,
      revision: 1,
      issuer: "North Lab",
      label: "Operator",
      otpType: "totp",
      favorite: false,
      tags: ["work"],
    },
    {
      id: steamId,
      revision: 2,
      issuer: "Game Deck",
      label: "Primary",
      otpType: "steam",
      favorite: true,
      tags: [],
    },
    {
      id: hotpId,
      revision: 3,
      issuer: "Field Unit",
      label: "Offline",
      otpType: "hotp",
      favorite: false,
      tags: ["device"],
    },
  ],
} as const;

function codeResponse(
  id: string,
  code: string,
  otpType: "totp" | "steam",
  expiresAt = 30_000,
  revision = 1,
) {
  return {
    version: 1,
    kind: "otp.codeResult",
    itemId: id,
    revision,
    code,
    otpType,
    period: 30,
    remaining: 15,
    expiresAt,
  } as const;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function createPlatform(
  responder: (request: OtpRequest) => Promise<OtpResponse> = (request) => {
    if (request.kind === "otp.list") return Promise.resolve(listResponse);
    if (request.kind === "otp.getCode") {
      return Promise.resolve(
        request.itemId === steamId
          ? codeResponse(steamId, steamPlaceholder, "steam")
          : codeResponse(itemId, visiblePlaceholder, "totp"),
      );
    }
    if (request.kind === "otp.copyCode") {
      return Promise.resolve(codeResponse(request.itemId, visiblePlaceholder, "totp"));
    }
    throw new Error("unexpected request");
  },
) {
  const sendOtpMessage = vi.fn(responder);
  const writeAuthoritativeClipboardText = vi.fn((value: Promise<string>): Promise<void> =>
    value.then(() => undefined),
  );
  const openVaultPage = vi.fn((): Promise<void> => Promise.resolve());
  const platform: OtpUiExtensionPlatform = {
    extensionId: "popup-test-id",
    onMessage: () => () => undefined,
    sendMessage: () => Promise.resolve(undefined),
    sendOtpMessage,
    writeAuthoritativeClipboardText,
    openVaultPage,
  };
  return { platform, sendOtpMessage, writeAuthoritativeClipboardText, openVaultPage };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function expectNoSeriousAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    resultTypes: ["violations"],
    rules: { "color-contrast": { enabled: false } },
  });
  expect(
    results.violations.filter(({ impact }) => ["serious", "critical"].includes(impact ?? "")),
  ).toEqual([]);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("OtpCountdown", () => {
  it.each([
    [30, 30, 6, "0"],
    [15, 30, 6, "50"],
    [0, 30, 6, "100"],
  ] as const)(
    "maps an exact period boundary to the ring offset",
    (remaining, period, urgentAt, offset) => {
      render(<OtpCountdown remaining={remaining} period={period} urgentAt={urgentAt} />);
      expect(screen.getByTestId("otp-countdown-ring")).toHaveAttribute("stroke-dashoffset", offset);
    },
  );

  it("marks only the near-expiry interval urgent without announcing changing time", () => {
    const { rerender } = render(<OtpCountdown remaining={7} period={30} urgentAt={6} />);
    expect(screen.getByTestId("otp-countdown")).toHaveAttribute("data-urgent", "false");
    rerender(<OtpCountdown remaining={6} period={30} urgentAt={6} />);
    expect(screen.getByTestId("otp-countdown")).toHaveAttribute("data-urgent", "true");
    expect(screen.getByTestId("otp-countdown")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("OtpRow", () => {
  it.each([
    [30, 15, "50"],
    [45, 15, "66.66666666666666"],
  ] as const)("uses the configured period for countdown geometry", (period, remaining, offset) => {
    render(
      <OtpRow
        item={listResponse.items[0]!}
        code={{ ...codeResponse(itemId, visiblePlaceholder, "totp"), period, remaining }}
        time={30_000 - remaining * 1_000}
        copying={false}
        onCopy={() => undefined}
        onOpenVault={() => undefined}
      />,
    );
    expect(screen.getByTestId("otp-countdown-ring")).toHaveAttribute("stroke-dashoffset", offset);
  });
});

describe("OtpList", () => {
  it("requests bounded list projections and presents compact non-sensitive row semantics", async () => {
    const { platform, sendOtpMessage } = createPlatform();
    const { container } = render(<OtpList platform={platform} active now={() => 15_000} />);

    expect(await screen.findByText("North Lab")).toBeVisible();
    expect(sendOtpMessage).toHaveBeenCalledWith({ version: 1, kind: "otp.list", query: "" });
    expect(screen.getByText("Operator")).toBeVisible();
    expect(screen.getByText("work")).toBeVisible();
    expect(screen.getByText("TOTP")).toBeVisible();
    expect(screen.getByText(visiblePlaceholder)).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText(steamPlaceholder)).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("STEAM")).toBeVisible();
    expect(container.querySelector('[aria-label*="246"]')).toBeNull();
    expect(container.querySelector('[aria-label*="BCDF"]')).toBeNull();
    expect(container.querySelector('input, textarea, [aria-label="Secret"]')).toBeNull();
    await expectNoSeriousAxeViolations(container);
  });

  it("keeps HOTP read-only and navigates to the full vault without requesting a code", async () => {
    const { platform, sendOtpMessage, openVaultPage } = createPlatform();
    render(<OtpList platform={platform} active now={() => 15_000} />);

    fireEvent.click(await screen.findByRole("button", { name: "Open Field Unit in vault" }));
    await waitFor(() => expect(openVaultPage).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Available in full vault")).toBeVisible();
    const hotpRequests = sendOtpMessage.mock.calls
      .map(([request]) => request)
      .filter((request) => "itemId" in request && request.itemId === hotpId);
    expect(hotpRequests).toEqual([]);
  });

  it("captures clipboard activation before runtime settles and resolves only the authoritative code", async () => {
    const authoritative = deferred<OtpResponse>();
    let runtimeStarted = false;
    const completedPayloads: string[] = [];
    const { platform, writeAuthoritativeClipboardText } = createPlatform((request) => {
      if (request.kind === "otp.list")
        return Promise.resolve({ ...listResponse, items: [listResponse.items[0]!] });
      if (request.kind === "otp.getCode")
        return Promise.resolve(codeResponse(itemId, visiblePlaceholder, "totp"));
      if (request.kind === "otp.copyCode") {
        runtimeStarted = true;
        return authoritative.promise;
      }
      throw new Error("unexpected request");
    });
    writeAuthoritativeClipboardText.mockImplementation((payload) => {
      expect(runtimeStarted).toBe(false);
      return payload.then((value) => {
        completedPayloads.push(value);
      });
    });
    render(<OtpList platform={platform} active now={() => 15_000} />);

    fireEvent.click(await screen.findByRole("button", { name: "Copy code for North Lab" }));
    expect(writeAuthoritativeClipboardText).toHaveBeenCalledTimes(1);
    expect(runtimeStarted).toBe(true);
    expect(completedPayloads).toEqual([]);

    authoritative.resolve(codeResponse(itemId, "864208", "totp", 30_000));
    await flush();
    expect(completedPayloads).toEqual(["864208"]);
    expect(completedPayloads).not.toContain(visiblePlaceholder);
    expect(screen.getByRole("status")).toHaveTextContent("Code copied");
  });

  it.each([
    ["updated", () => Promise.reject(new Error("OTP_CONFLICT"))],
    ["deleted", () => Promise.reject(new Error("OTP_NOT_FOUND"))],
    ["locked", () => Promise.reject(new Error("VAULT_LOCKED"))],
    ["copy failure", () => Promise.reject(new Error("UNEXPECTED"))],
    [
      "expired authoritative code",
      () => Promise.resolve(codeResponse(itemId, "864208", "totp", 15_000)),
    ],
  ] as const)(
    "completes zero clipboard writes when the item is %s",
    async (_case, copyResponse) => {
      const completedPayloads: string[] = [];
      const { platform, writeAuthoritativeClipboardText } = createPlatform((request) => {
        if (request.kind === "otp.list")
          return Promise.resolve({ ...listResponse, items: [listResponse.items[0]!] });
        if (request.kind === "otp.getCode")
          return Promise.resolve(codeResponse(itemId, visiblePlaceholder, "totp"));
        if (request.kind === "otp.copyCode") return copyResponse();
        throw new Error("unexpected request");
      });
      writeAuthoritativeClipboardText.mockImplementation((payload) =>
        payload.then((value) => {
          completedPayloads.push(value);
        }),
      );
      render(<OtpList platform={platform} active now={() => 15_000} />);

      fireEvent.click(await screen.findByRole("button", { name: "Copy code for North Lab" }));
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent("Copy failed. Try again."),
      );
      expect(writeAuthoritativeClipboardText).toHaveBeenCalledTimes(1);
      expect(completedPayloads).toEqual([]);
    },
  );

  it("writes only from an explicit copy click and keeps feedback code-free", async () => {
    const { platform, sendOtpMessage, writeAuthoritativeClipboardText } = createPlatform();
    render(<OtpList platform={platform} active now={() => 15_000} />);
    await screen.findByText("North Lab");

    expect(writeAuthoritativeClipboardText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Copy code for North Lab" }));

    await waitFor(() => expect(writeAuthoritativeClipboardText).toHaveBeenCalledTimes(1));
    expect(sendOtpMessage).toHaveBeenCalledWith({
      version: 1,
      kind: "otp.copyCode",
      itemId,
      expectedRevision: 1,
    });
    expect(screen.getByRole("status")).toHaveTextContent("Code copied");
    expect(screen.getByRole("status")).not.toHaveTextContent(visiblePlaceholder);
  });

  it("rejects an expired displayed code before clipboard write", async () => {
    let currentNow = 14_000;
    const { platform, writeAuthoritativeClipboardText } = createPlatform(async (request) => {
      await Promise.resolve();
      if (request.kind === "otp.list") return { ...listResponse, items: [listResponse.items[0]!] };
      if (request.kind === "otp.getCode")
        return codeResponse(itemId, visiblePlaceholder, "totp", 15_000);
      if (request.kind === "otp.copyCode") return codeResponse(itemId, visiblePlaceholder, "totp");
      throw new Error("unexpected request");
    });
    render(<OtpList platform={platform} active now={() => currentNow} />);
    const copy = await screen.findByRole("button", { name: "Copy code for North Lab" });
    currentNow = 15_000;

    fireEvent.click(copy);
    expect(screen.getByRole("status")).toHaveTextContent("Code unavailable. Try again.");
    expect(writeAuthoritativeClipboardText).not.toHaveBeenCalled();
  });

  it("fails before starting clipboard when the displayed code revision differs from the selected item revision", async () => {
    const { platform, writeAuthoritativeClipboardText } = createPlatform((request) => {
      if (request.kind === "otp.list")
        return Promise.resolve({ ...listResponse, items: [listResponse.items[0]!] });
      if (request.kind === "otp.getCode")
        return Promise.resolve(codeResponse(itemId, visiblePlaceholder, "totp", 30_000, 2));
      if (request.kind === "otp.copyCode")
        return Promise.resolve(codeResponse(itemId, visiblePlaceholder, "totp", 30_000, 2));
      throw new Error("unexpected request");
    });
    render(<OtpList platform={platform} active now={() => 15_000} />);

    fireEvent.click(await screen.findByRole("button", { name: "Copy code for North Lab" }));
    expect(screen.getByRole("status")).toHaveTextContent("Code unavailable. Try again.");
    expect(writeAuthoritativeClipboardText).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).not.toHaveTextContent(visiblePlaceholder);
  });

  it("completes zero clipboard writes when the authoritative code returns a newer revision for the same item", async () => {
    const completedPayloads: string[] = [];
    const { platform, writeAuthoritativeClipboardText } = createPlatform((request) => {
      if (request.kind === "otp.list")
        return Promise.resolve({ ...listResponse, items: [listResponse.items[0]!] });
      if (request.kind === "otp.getCode")
        return Promise.resolve(codeResponse(itemId, visiblePlaceholder, "totp"));
      if (request.kind === "otp.copyCode")
        return Promise.resolve(codeResponse(itemId, "864208", "totp", 30_000, 2));
      throw new Error("unexpected request");
    });
    writeAuthoritativeClipboardText.mockImplementation((payload) =>
      payload.then((value) => {
        completedPayloads.push(value);
      }),
    );
    render(<OtpList platform={platform} active now={() => 15_000} />);

    fireEvent.click(await screen.findByRole("button", { name: "Copy code for North Lab" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Copy failed. Try again."),
    );
    expect(writeAuthoritativeClipboardText).toHaveBeenCalledTimes(1);
    expect(completedPayloads).toEqual([]);
    expect(completedPayloads).not.toContain("864208");
    expect(screen.getByRole("status")).not.toHaveTextContent("864208");
  });

  it("uses fixed failure feedback and bounds double clicks to one clipboard write", async () => {
    const pending = deferred<void>();
    const { platform, writeAuthoritativeClipboardText } = createPlatform();
    writeAuthoritativeClipboardText.mockImplementation(() => pending.promise);
    render(<OtpList platform={platform} active now={() => 15_000} />);
    const copy = await screen.findByRole("button", { name: "Copy code for North Lab" });

    fireEvent.click(copy);
    fireEvent.click(copy);
    await waitFor(() => expect(writeAuthoritativeClipboardText).toHaveBeenCalledTimes(1));
    act(() => pending.resolve());
    await waitFor(() => expect(copy).toBeEnabled());

    writeAuthoritativeClipboardText.mockRejectedValueOnce(new Error("private clipboard detail"));
    fireEvent.click(copy);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Copy failed. Try again."),
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("private clipboard detail");
  });

  it("refreshes at now greater than or equal to expiry and never leaves stale code visible", async () => {
    vi.useFakeTimers();
    let currentNow = 15_000;
    const { platform, sendOtpMessage } = createPlatform(async (request) => {
      await Promise.resolve();
      if (request.kind === "otp.list") return { ...listResponse, items: [listResponse.items[0]!] };
      if (request.kind === "otp.getCode")
        return codeResponse(itemId, visiblePlaceholder, "totp", 30_000);
      if (request.kind === "otp.copyCode") return codeResponse(itemId, visiblePlaceholder, "totp");
      throw new Error("unexpected request");
    });
    render(<OtpList platform={platform} active now={() => currentNow} />);
    await flush();
    expect(screen.getByText(visiblePlaceholder)).toBeVisible();

    currentNow = 30_000;
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(screen.queryByText(visiblePlaceholder)).not.toBeInTheDocument();
    const kinds = sendOtpMessage.mock.calls.map(([request]) => request.kind);
    expect(kinds.filter((kind) => kind === "otp.list")).toHaveLength(2);
    expect(kinds.filter((kind) => kind === "otp.getCode")).toHaveLength(2);
  });

  it("revalidates on focus and visibility and ignores stale responses after lock", async () => {
    const delayed = deferred<OtpResponse>();
    const { platform, sendOtpMessage } = createPlatform(async (request) => {
      await Promise.resolve();
      if (request.kind === "otp.list") return delayed.promise;
      throw new Error("unexpected request");
    });
    const { rerender } = render(<OtpList platform={platform} active now={() => 15_000} />);

    rerender(<OtpList platform={platform} active={false} now={() => 15_000} />);
    delayed.resolve(listResponse);
    await flush();
    expect(screen.queryByText("North Lab")).not.toBeInTheDocument();

    rerender(<OtpList platform={platform} active now={() => 15_000} />);
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(sendOtpMessage.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("caps visible work and code concurrency for a maximum-sized list", async () => {
    const items = Array.from({ length: 10_000 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      revision: 1,
      issuer: `Issuer ${index + 1}`,
      label: "Operator",
      otpType: "totp" as const,
      favorite: false,
      tags: [],
    }));
    let inFlight = 0;
    let maximumInFlight = 0;
    const pending: Array<ReturnType<typeof deferred<OtpResponse>>> = [];
    const { platform, sendOtpMessage } = createPlatform((request) => {
      if (request.kind === "otp.list") {
        return Promise.resolve({ version: 1, kind: "otp.listResult", items });
      }
      if (request.kind === "otp.getCode") {
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        const operation = deferred<OtpResponse>();
        pending.push(operation);
        return operation.promise.finally(() => {
          inFlight -= 1;
        });
      }
      throw new Error("unexpected request");
    });
    render(<OtpList platform={platform} active now={() => 15_000} />);
    await waitFor(() => expect(pending).toHaveLength(4));
    expect(maximumInFlight).toBeLessThanOrEqual(4);

    while (pending.length > 0) {
      const operation = pending.shift()!;
      operation.resolve(codeResponse(itemId, visiblePlaceholder, "totp"));
      await flush();
    }
    const codeRequests = sendOtpMessage.mock.calls
      .map(([request]) => request)
      .filter(({ kind }) => kind === "otp.getCode");
    expect(codeRequests.length).toBeLessThanOrEqual(20);
    expect(await screen.findByText("9,980 MORE ITEMS")).toBeVisible();
    expect(screen.queryByText("Issuer 21")).not.toBeInTheDocument();
  });

  it("invalidates codes while hidden, suppresses expiry work, and coalesces visible refresh", async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const { platform, sendOtpMessage } = createPlatform();
    render(<OtpList platform={platform} active now={() => Date.now()} />);
    await flush();
    const beforeHidden = sendOtpMessage.mock.calls.length;

    visibility = "hidden";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.queryByText(visiblePlaceholder)).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(sendOtpMessage).toHaveBeenCalledTimes(beforeHidden);

    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    const listRequests = sendOtpMessage.mock.calls
      .map(([request]) => request)
      .filter(({ kind }) => kind === "otp.list");
    expect(listRequests).toHaveLength(2);
  });

  it("shows safe loading, empty, and error states without raw failures", async () => {
    const delayed = deferred<OtpResponse>();
    const loading = createPlatform(() => delayed.promise);
    const view = render(<OtpList platform={loading.platform} active />);
    expect(screen.getByText("Loading OTP items…")).toBeVisible();
    delayed.resolve({ ...listResponse, items: [] });
    expect(await screen.findByText("No OTP items yet")).toBeVisible();

    view.unmount();
    const failing = createPlatform(async () => {
      await Promise.resolve();
      throw new Error("private service detail");
    });
    render(<OtpList platform={failing.platform} active />);
    expect(await screen.findByRole("alert")).toHaveTextContent("OTP items unavailable. Try again.");
    expect(screen.queryByText("private service detail")).not.toBeInTheDocument();
  });

  it("cleans the parent timer on unmount", async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const { platform } = createPlatform();
    const view = render(<OtpList platform={platform} active now={() => 15_000} />);
    await flush();
    view.unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});

describe("popup OTP style contract", () => {
  it("keeps compact sharp responsive rows, visible focus, urgency, and reduced motion", async () => {
    const css = await readFile(
      path.resolve(process.cwd(), "apps/extension/src/popup/otp/OtpList.module.css"),
      "utf8",
    );
    expect(css).toMatch(/min-height:\s*44px/u);
    expect(css).toMatch(/font-variant-numeric:\s*tabular-nums/u);
    expect(css).toMatch(/:focus-visible/u);
    expect(css).toMatch(/data-urgent/u);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/u);
    expect(css).toMatch(/@media\s*\(max-width:\s*360px\)/u);
    expect(css).not.toMatch(/gradient|backdrop-filter|border-radius:\s*(?:999|50%)/u);
  });
});
