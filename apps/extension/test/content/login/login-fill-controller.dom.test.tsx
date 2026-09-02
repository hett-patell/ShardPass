/* eslint-disable @typescript-eslint/unbound-method -- Vitest mock assertions intentionally inspect platform methods without invoking them. */
import "@testing-library/jest-dom/vitest";

import { act, fireEvent, within } from "@testing-library/react";
import type { LoginFillRequest, LoginFillResponse } from "@shardpass/messaging";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoginFillContentPlatform } from "../../../src/platform/extension-platform";
import { createLoginFillController } from "../../../src/content/login/login-fill-controller";

const originalAttachShadow = HTMLElement.prototype.attachShadow.call.bind(
  HTMLElement.prototype.attachShadow,
) as (element: HTMLElement, init: ShadowRootInit) => ShadowRoot;
const controllers: Array<ReturnType<typeof createLoginFillController>> = [];
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

function loginForm(): Readonly<{
  form: HTMLFormElement;
  username: HTMLInputElement;
  password: HTMLInputElement;
}> {
  const form = document.createElement("form");
  const username = document.createElement("input");
  username.type = "email";
  username.name = "email";
  const password = document.createElement("input");
  password.type = "password";
  password.name = "password";
  form.append(username, password);
  document.body.append(form);
  return { form, username, password };
}

function platform(
  handler: (request: LoginFillRequest) => LoginFillResponse | Promise<LoginFillResponse>,
): LoginFillContentPlatform {
  return {
    extensionId: "extension-test",
    onMessage: () => () => undefined,
    sendMessage: () => Promise.resolve(undefined),
    openVaultPage: () => Promise.resolve(),
    sendLoginFillMessage: vi.fn((request: LoginFillRequest) => Promise.resolve(handler(request))),
  };
}

function start(candidate: LoginFillContentPlatform) {
  const controller = createLoginFillController({ document, window, platform: candidate });
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

describe("Login fill controller", () => {
  it("shows no trigger for a login field when no saved logins match the domain", async () => {
    captureClosedRoots();
    const { password } = loginForm();
    start(platform(() => ({ version: 1, kind: "login.fillSuggestionsResult", suggestions: [] })));

    focusField(password);
    await flush();

    expect(document.querySelector("shardpass-picker-host")).toBeNull();
  });

  it("shows no trigger for an unrelated input that is not part of a login field set", async () => {
    captureClosedRoots();
    const search = document.createElement("input");
    search.type = "search";
    document.body.append(search);
    start(platform(() => Promise.reject(new Error("not requested"))));

    focusField(search);
    await flush();

    expect(document.querySelector("shardpass-picker-host")).toBeNull();
  });

  it(
    "shows one isolated trigger once suggestions exist, sorts favorites, searches, fills " +
      "username and password exactly once, and confirms the selected item",
    async () => {
      const roots = captureClosedRoots();
      const { username, password } = loginForm();
      let usernameEvents = 0;
      let passwordEvents = 0;
      username.addEventListener("input", () => usernameEvents++);
      password.addEventListener("input", () => passwordEvents++);
      const candidate = platform((request) => {
        if (request.kind === "login.fillSuggestions")
          return {
            version: 1,
            kind: "login.fillSuggestionsResult",
            suggestions: [
              {
                itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
                expectedRevision: 1,
                name: "Secondary",
                username: "member@example.test",
                favorite: false,
                tags: ["team"],
                hasLinkedOtp: false,
              },
              {
                itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a21",
                expectedRevision: 2,
                name: "Primary",
                username: "owner@example.test",
                favorite: true,
                tags: ["safe"],
                hasLinkedOtp: true,
              },
            ],
          };
        if (request.kind === "login.fillSelect")
          return {
            version: 1,
            kind: "login.fillRelease",
            username: "owner@example.test",
            password: "s3cret!",
          };
        return { version: 1, kind: "login.fillAck", ok: true };
      });
      start(candidate);
      focusField(username);
      await flush();

      expect(candidate.sendLoginFillMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "login.fillSuggestions", domain: "localhost" }),
      );
      await clickAndFlush(
        within(roots[0] as unknown as HTMLElement).getByRole("button", {
          name: "Fill login with ShardPass",
        }),
      );

      const pickerRoot = roots.at(-1) as unknown as HTMLElement;
      expect(
        within(pickerRoot)
          .getAllByRole("button", { name: /Use login/u })
          .map((node) => node.textContent),
      ).toEqual([expect.stringContaining("Primary"), expect.stringContaining("Secondary")]);
      // The picker renders from the same fetch that gated the trigger; opening it must not
      // issue a second `login.fillSuggestions` request.
      expect(candidate.sendLoginFillMessage).toHaveBeenCalledTimes(1);

      fireEvent.change(within(pickerRoot).getByRole("searchbox", { name: "Search saved logins" }), {
        target: { value: "team" },
      });
      expect(within(pickerRoot).getByRole("button", { name: /Secondary/u })).toBeVisible();
      fireEvent.change(within(pickerRoot).getByRole("searchbox", { name: "Search saved logins" }), {
        target: { value: "" },
      });
      await clickAndFlush(within(pickerRoot).getByRole("button", { name: /Primary/u }));

      expect(username.value).toBe("owner@example.test");
      expect(password.value).toBe("s3cret!");
      expect(usernameEvents).toBe(1);
      expect(passwordEvents).toBe(1);
      expect(username).toHaveFocus();
      expect(document.querySelector("shardpass-picker-host")).toBeNull();
      expect(candidate.sendLoginFillMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "login.fillConfirm",
          itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a21",
        }),
      );
      expect(candidate.sendLoginFillMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ kind: "login.fillCancel" }),
      );
    },
  );

  it("cancels the selected login on field replacement mid-flight and never fills", async () => {
    const roots = captureClosedRoots();
    const { username, password } = loginForm();
    const candidate = platform((request) => {
      if (request.kind === "login.fillSuggestions")
        return {
          version: 1,
          kind: "login.fillSuggestionsResult",
          suggestions: [
            {
              itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
              expectedRevision: 1,
              name: "Account",
              username: "user@example.test",
              favorite: true,
              tags: [],
              hasLinkedOtp: false,
            },
          ],
        };
      if (request.kind === "login.fillSelect") {
        const replacement = password.cloneNode() as HTMLInputElement;
        password.replaceWith(replacement);
        return {
          version: 1,
          kind: "login.fillRelease",
          username: "user@example.test",
          password: "s3cret!",
        };
      }
      return { version: 1, kind: "login.fillAck", ok: true };
    });
    start(candidate);
    focusField(username);
    await flush();
    await clickAndFlush(
      within(roots[0] as unknown as HTMLElement).getByRole("button", {
        name: "Fill login with ShardPass",
      }),
    );
    await clickAndFlush(
      within(roots.at(-1) as unknown as HTMLElement).getByRole("button", { name: /Account/u }),
    );

    expect(candidate.sendLoginFillMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "login.fillCancel",
        itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
      }),
    );
    expect(candidate.sendLoginFillMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "login.fillConfirm" }),
    );
    expect(username.value).toBe("");
  });

  it("invalidates async owners on disposal without rendering stale metadata", async () => {
    captureClosedRoots();
    const { password } = loginForm();
    let resolveSuggestions: ((value: LoginFillResponse) => void) | undefined;
    const candidate = platform(
      () =>
        new Promise((resolve) => {
          resolveSuggestions = resolve;
        }),
    );
    const controller = start(candidate);
    focusField(password);
    await act(async () => {
      controller.dispose();
      resolveSuggestions?.({
        version: 1,
        kind: "login.fillSuggestionsResult",
        suggestions: [
          {
            itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
            expectedRevision: 1,
            name: "Account",
            username: "user@example.test",
            favorite: true,
            tags: [],
            hasLinkedOtp: false,
          },
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector("shardpass-picker-host")).toBeNull();
    expect(document.body.textContent).not.toContain("Account");
  });
});
