/* eslint-disable @typescript-eslint/unbound-method -- Vitest mock assertions intentionally inspect platform methods without invoking them. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric matcher values are intentionally untyped. */
import "@testing-library/jest-dom/vitest";

import { act, fireEvent, within } from "@testing-library/react";
import type { OtpFillRequest, OtpFillResponse } from "@shardpass/messaging";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OtpFillContentPlatform } from "../../../src/platform/extension-platform";
import { createOtpFillController } from "../../../src/content/otp/otp-fill-controller";

const originalAttachShadow = HTMLElement.prototype.attachShadow.call.bind(
  HTMLElement.prototype.attachShadow,
) as (element: HTMLElement, init: ShadowRootInit) => ShadowRoot;
const controllers: Array<ReturnType<typeof createOtpFillController>> = [];
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function captureClosedRoots(): ShadowRoot[] {
  const roots: ShadowRoot[] = [];
  vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (
    this: HTMLElement,
    init,
  ) {
    const root = originalAttachShadow(this, init);
    roots.push(root);
    return root;
  });
  return roots;
}

function eligibleField(): HTMLInputElement {
  const input = document.createElement("input");
  input.autocomplete = "one-time-code";
  input.getClientRects = () =>
    [
      { left: 24, top: 24, right: 184, bottom: 56, width: 160, height: 32 },
    ] as unknown as DOMRectList;
  input.getBoundingClientRect = () => ({
    left: 24,
    top: 24,
    right: 184,
    bottom: 56,
    width: 160,
    height: 32,
    x: 24,
    y: 24,
    toJSON: () => ({}),
  });
  document.body.append(input);
  return input;
}

function platform(
  handler: (request: OtpFillRequest) => OtpFillResponse | Promise<OtpFillResponse>,
): OtpFillContentPlatform {
  return {
    extensionId: "extension-test",
    onMessage: () => () => undefined,
    sendMessage: () => Promise.resolve(undefined),
    openVaultPage: () => Promise.resolve(),
    sendOtpFillMessage: vi.fn((request: OtpFillRequest) => Promise.resolve(handler(request))),
  };
}

function start(candidate: OtpFillContentPlatform) {
  const controller = createOtpFillController({ document, window, platform: candidate });
  controllers.push(controller);
  act(() => controller.start());
  return controller;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function clickAndFlush(element: Element): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function focusField(input: HTMLInputElement): void {
  act(() => {
    input.focus();
    fireEvent.focusIn(input);
  });
}

afterEach(() => {
  act(() => {
    for (const controller of controllers.splice(0)) controller.dispose();
  });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("OTP fill controller", () => {
  it("looks again at a field focused while its step was still hidden, and shows the trigger once it can", async () => {
    const roots = captureClosedRoots();
    const wrapper = document.createElement("div");
    wrapper.setAttribute("aria-hidden", "true");
    document.body.append(wrapper);
    const input = eligibleField();
    wrapper.append(input);
    start(platform(() => Promise.reject(new Error("not requested"))));
    focusField(input);
    await flush();
    expect(roots).toHaveLength(0);

    // The step finished rendering: its wrapper is no longer hidden.
    wrapper.removeAttribute("aria-hidden");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(roots).toHaveLength(1);
    expect(
      within(roots[0] as unknown as HTMLElement).getByRole("button", {
        name: "Fill one-time code with ShardPass",
      }),
    ).toBeVisible();
  });

  it("shows one isolated field-relative trigger only for the focused eligible field", async () => {
    const roots = captureClosedRoots();
    const first = eligibleField();
    const second = eligibleField();
    start(platform(() => Promise.reject(new Error("not requested"))));

    focusField(first);
    await flush();

    expect(document.querySelectorAll("shardpass-picker-host")).toHaveLength(1);
    expect(document.querySelector("shardpass-picker-host")?.shadowRoot).toBeNull();
    expect(
      within(roots[0] as unknown as HTMLElement).getByRole("button", {
        name: "Fill one-time code with ShardPass",
      }),
    ).toBeVisible();
    expect((document.querySelector("shardpass-picker-host") as HTMLElement).style.position).toBe(
      "fixed",
    );

    focusField(second);
    await flush();
    expect(document.querySelectorAll("shardpass-picker-host")).toHaveLength(1);
    expect(roots).toHaveLength(2);

    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => {
      outside.focus();
      outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    await flush();
    expect(document.querySelector("shardpass-picker-host")).toBeNull();
  });

  it("copies the code and says so when the field will not take it, instead of closing in silence", async () => {
    const roots = captureClosedRoots();
    const input = eligibleField();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const candidate = platform((request) => {
      if (request.kind === "otp.fillSuggestions")
        return {
          version: 1,
          kind: "otp.fillSuggestionsResult",
          capability: "capability_0123456789abcdef",
          expiresAt: Date.now() + 300_000,
          suggestions: [
            {
              itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
              expectedRevision: 1,
              issuer: "Example",
              label: "Member",
              otpType: "totp",
              favorite: false,
              tags: [],
            },
          ],
        };
      if (request.kind === "otp.fillSelect") {
        // The page locks the field between the pick and the write: the fill cannot land.
        input.readOnly = true;
        return {
          version: 1,
          kind: "otp.fillRelease",
          releaseId: "release_0123456789abcdef",
          code: "246810",
          expiresAt: Date.now() + 5_000,
          codeLength: 6,
          characterClass: "digits",
        };
      }
      return { version: 1, kind: "otp.fillCancelled", cancelled: true };
    });
    start(candidate);
    focusField(input);
    await flush();
    await clickAndFlush(
      within(roots[0] as unknown as HTMLElement).getByRole("button", {
        name: "Fill one-time code with ShardPass",
      }),
    );
    await flush();
    await clickAndFlush(
      within(roots.at(-1) as unknown as HTMLElement).getByRole("button", {
        name: /Use OTP account/u,
      }),
    );
    await flush();

    expect(input.value).toBe("");
    expect(writeText).toHaveBeenCalledWith("246810");
    expect(within(roots.at(-1) as unknown as HTMLElement).getByRole("status")).toHaveTextContent(
      "It was copied instead: paste it.",
    );
    expect(
      vi
        .mocked(candidate.sendOtpFillMessage)
        .mock.calls.some(([request]) => request.kind === "otp.fillCancel"),
    ).toBe(true);
  });

  it("opens metadata only on explicit click, sorts favorites, searches, fills exactly once, and confirms after synchronous code cleanup", async () => {
    const roots = captureClosedRoots();
    const input = eligibleField();
    let selectedRelease: { code: string } | undefined;
    let inputEvents = 0;
    let changeEvents = 0;
    input.addEventListener("input", () => inputEvents++);
    input.addEventListener("change", () => changeEvents++);
    const candidate = platform((request) => {
      if (request.kind === "otp.fillSuggestions")
        return {
          version: 1,
          kind: "otp.fillSuggestionsResult",
          capability: "capability_0123456789abcdef",
          expiresAt: Date.now() + 300_000,
          suggestions: [
            {
              itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
              expectedRevision: 1,
              issuer: "Secondary",
              label: "Member",
              otpType: "totp",
              favorite: false,
              tags: ["team"],
            },
            {
              itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a21",
              expectedRevision: 2,
              issuer: "Primary",
              label: "Owner",
              otpType: "steam",
              favorite: true,
              tags: ["safe"],
            },
          ],
        };
      if (request.kind === "otp.fillSelect") {
        selectedRelease = { code: "246810" };
        return {
          version: 1,
          kind: "otp.fillRelease",
          releaseId: "release_0123456789abcdef",
          code: selectedRelease.code,
          expiresAt: Date.now() + 5_000,
          codeLength: 6,
          characterClass: "digits",
        };
      }
      if (request.kind === "otp.fillConfirm") {
        expect(selectedRelease?.code).toBe("");
        return { version: 1, kind: "otp.fillConfirmed", result: "committed" };
      }
      return { version: 1, kind: "otp.fillCancelled", cancelled: true };
    });
    start(candidate);
    focusField(input);
    await flush();

    expect(candidate.sendOtpFillMessage).not.toHaveBeenCalled();
    await clickAndFlush(
      within(roots[0] as unknown as HTMLElement).getByRole("button", {
        name: "Fill one-time code with ShardPass",
      }),
    );

    const pickerRoot = roots.at(-1) as unknown as HTMLElement;
    expect(
      within(pickerRoot)
        .getAllByRole("button", { name: /Use OTP account/u })
        .map((node) => node.textContent),
    ).toEqual([expect.stringContaining("Primary"), expect.stringContaining("Secondary")]);
    expect(pickerRoot.textContent).not.toMatch(
      /246810|release_0123456789abcdef|capability_0123456789abcdef/u,
    );
    expect(within(pickerRoot).queryByRole("searchbox")).toBeNull();
    expect(within(pickerRoot).getByRole("button", { name: /Secondary Member/u })).toBeVisible();
    await clickAndFlush(within(pickerRoot).getByRole("button", { name: /Secondary Member/u }));

    expect(input.value).toBe("246810");
    expect(inputEvents).toBe(1);
    expect(changeEvents).toBe(1);
    expect(input).toHaveFocus();
    expect(document.querySelector("shardpass-picker-host")).toBeNull();
    expect(candidate.sendOtpFillMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "otp.fillConfirm", result: "filled" }),
    );
    expect(candidate.sendOtpFillMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "otp.fillCancel" }),
    );
  });

  it("cancels one selected release on replacement and never retries, submits, or advances focus", async () => {
    const roots = captureClosedRoots();
    const form = document.createElement("form");
    let submissions = 0;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submissions++;
    });
    const input = eligibleField();
    form.append(input);
    document.body.append(form);
    const next = document.createElement("button");
    document.body.append(next);
    const candidate = platform((request) => {
      if (request.kind === "otp.fillSuggestions")
        return {
          version: 1,
          kind: "otp.fillSuggestionsResult",
          capability: "capability_0123456789abcdef",
          expiresAt: Date.now() + 300_000,
          suggestions: [
            {
              itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
              expectedRevision: 1,
              issuer: "Account",
              label: "One",
              otpType: "hotp",
              favorite: true,
              tags: [],
            },
          ],
        };
      if (request.kind === "otp.fillSelect") {
        const replacement = input.cloneNode() as HTMLInputElement;
        input.replaceWith(replacement);
        return {
          version: 1,
          kind: "otp.fillRelease",
          releaseId: "release_0123456789abcdef",
          code: "135790",
          expiresAt: Date.now() + 5_000,
          codeLength: 6,
          characterClass: "digits",
        };
      }
      if (request.kind === "otp.fillCancel")
        return { version: 1, kind: "otp.fillCancelled", cancelled: true };
      return { version: 1, kind: "otp.fillConfirmed", result: "cancelled" };
    });
    start(candidate);
    focusField(input);
    await clickAndFlush(
      within(roots[0] as unknown as HTMLElement).getByRole("button", {
        name: "Fill one-time code with ShardPass",
      }),
    );
    await clickAndFlush(
      within(roots.at(-1) as unknown as HTMLElement).getByRole("button", {
        name: /Account One/u,
      }),
    );

    expect(candidate.sendOtpFillMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "otp.fillCancel", fieldHandle: expect.any(String) }),
    );
    expect(candidate.sendOtpFillMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "otp.fillConfirm", result: "filled" }),
    );
    expect(submissions).toBe(0);
    expect(next).not.toHaveFocus();
    expect((form.querySelector("input") as HTMLInputElement).value).toBe("");
  });

  it("invalidates async owners on disposal and navigation without rendering stale metadata", async () => {
    const roots = captureClosedRoots();
    const input = eligibleField();
    let resolveSuggestions: ((value: OtpFillResponse) => void) | undefined;
    const candidate = platform(
      () =>
        new Promise((resolve) => {
          resolveSuggestions = resolve;
        }),
    );
    const controller = start(candidate);
    focusField(input);
    fireEvent.click(
      within(roots[0] as unknown as HTMLElement).getByRole("button", {
        name: "Fill one-time code with ShardPass",
      }),
    );
    await act(async () => {
      controller.dispose();
      resolveSuggestions?.({
        version: 1,
        kind: "otp.fillSuggestionsResult",
        capability: "capability_0123456789abcdef",
        expiresAt: Date.now() + 300_000,
        suggestions: [],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector("shardpass-picker-host")).toBeNull();
    expect(document.body.textContent).not.toContain("OTP accounts");
  });
});
