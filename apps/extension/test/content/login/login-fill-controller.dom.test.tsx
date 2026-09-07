/* eslint-disable @typescript-eslint/unbound-method -- Vitest mock assertions intentionally inspect platform methods without invoking them. */
import "@testing-library/jest-dom/vitest";

import { act, fireEvent, within } from "@testing-library/react";
import type { LoginFillRequest, LoginFillResponse, LoginFillSuggestion } from "@shardpass/messaging";
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

type MessageHandler = Parameters<LoginFillContentPlatform["onMessage"]>[0];

const ack: LoginFillResponse = { version: 1, kind: "login.fillAck", ok: true };
const noOffer: LoginFillResponse = { version: 1, kind: "login.pendingOfferResult", offer: null };
const account: LoginFillSuggestion = {
  itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
  expectedRevision: 1,
  name: "Account",
  username: "user@example.test",
  favorite: true,
  tags: [],
  hasLinkedOtp: false,
};
const release: LoginFillResponse = {
  version: 1,
  kind: "login.fillRelease",
  username: "user@example.test",
  password: "s3cret!",
};

/** A thrown handler rejects the request; unanswered kinds get "nothing held" or an acknowledgement. */
function platform(
  handler: (request: LoginFillRequest) => LoginFillResponse | Promise<LoginFillResponse> | undefined,
): LoginFillContentPlatform & { runtime: { handler: MessageHandler | null } } {
  const runtime: { handler: MessageHandler | null } = { handler: null };
  return {
    extensionId: "extension-test",
    onMessage: (listener) => {
      runtime.handler = listener;
      return () => {
        runtime.handler = null;
      };
    },
    sendMessage: () => Promise.resolve(undefined),
    openVaultPage: () => Promise.resolve(),
    sendLoginFillMessage: vi.fn(
      (request: LoginFillRequest) =>
        new Promise<LoginFillResponse>((resolve) => {
          resolve(
            Promise.resolve(handler(request)).then(
              (response) => response ?? (request.kind === "login.pendingOffer" ? noOffer : ack),
            ),
          );
        }),
    ),
    runtime,
  };
}

function suggestionRequests(candidate: LoginFillContentPlatform): number {
  return vi
    .mocked(candidate.sendLoginFillMessage)
    .mock.calls.filter(([request]) => request.kind === "login.fillSuggestions").length;
}

function chipIn(root: ShadowRoot | undefined): HTMLElement {
  return within(root as unknown as HTMLElement).getByRole("button", {
    name: "Fill login with ShardPass",
  });
}

function locked(): Error {
  return Object.assign(new Error("locked"), { code: "VAULT_LOCKED" });
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Login fill controller", () => {
  it("offers one-click sign-in at the top of the page, then fills and submits the form", async () => {
    const roots = captureClosedRoots();
    const { form, username, password } = loginForm();
    password.getClientRects = () => [{} as DOMRect] as unknown as DOMRectList;
    const submitted = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener("submit", submitted);
    const other: LoginFillSuggestion = { ...account, itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a21", name: "Other", favorite: false };
    const candidate = platform((request) => {
      if (request.kind === "login.fillSuggestions")
        return { version: 1, kind: "login.fillSuggestionsResult", suggestions: [other, account] };
      if (request.kind === "login.fillSelect") return release;
      return undefined;
    });
    start(candidate);
    await flush();

    const bannerRoot = roots.find((root) => root.querySelector(".signIn"));
    expect(bannerRoot).toBeDefined();
    const banner = within(bannerRoot as unknown as HTMLElement);
    // The favourite leads; the rest are a click away.
    expect(banner.getByText("Account")).toBeInTheDocument();
    expect(banner.getByRole("button", { name: "Other options (1)" })).toBeInTheDocument();

    await clickAndFlush(banner.getByRole("button", { name: "Sign in" }));
    expect(username.value).toBe("user@example.test");
    expect(password.value).toBe("s3cret!");
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(bannerRoot?.querySelector(".signIn")).toBeNull();
  });

  it("fills but does not submit from the banner while a CAPTCHA is on the page, and stays away once dismissed", async () => {
    const roots = captureClosedRoots();
    const { form, password } = loginForm();
    password.getClientRects = () => [{} as DOMRect] as unknown as DOMRectList;
    const captcha = document.createElement("div");
    captcha.className = "g-recaptcha";
    captcha.getClientRects = () => [{} as DOMRect] as unknown as DOMRectList;
    document.body.append(captcha);
    const submitted = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener("submit", submitted);
    const candidate = platform((request) => {
      if (request.kind === "login.fillSuggestions")
        return { version: 1, kind: "login.fillSuggestionsResult", suggestions: [account] };
      if (request.kind === "login.fillSelect") return release;
      return undefined;
    });
    start(candidate);
    await flush();
    const bannerRoot = roots.find((root) => root.querySelector(".signIn"));
    const banner = within(bannerRoot as unknown as HTMLElement);
    expect(banner.queryByRole("button", { name: /Other options/ })).toBeNull();
    await clickAndFlush(banner.getByRole("button", { name: "Sign in" }));
    expect(password.value).toBe("s3cret!");
    expect(submitted).not.toHaveBeenCalled();
  });

  it("offers Continue on a username-only first step, then Sign in again once the password step appears", async () => {
    const roots = captureClosedRoots();
    const form = document.createElement("form");
    const username = document.createElement("input");
    username.type = "email";
    username.name = "email";
    username.getClientRects = () => [{} as DOMRect] as unknown as DOMRectList;
    const next = document.createElement("button");
    next.type = "submit";
    form.append(username, next);
    document.body.append(form);
    const submitted = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener("submit", submitted);
    const candidate = platform((request) => {
      if (request.kind === "login.fillSuggestions")
        return { version: 1, kind: "login.fillSuggestionsResult", suggestions: [account] };
      if (request.kind === "login.fillSelect") return release;
      return undefined;
    });
    start(candidate);
    await flush();

    const first = roots.find((root) => root.querySelector(".signIn"));
    await clickAndFlush(within(first as unknown as HTMLElement).getByRole("button", { name: "Continue" }));
    expect(username.value).toBe("user@example.test");
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(first?.querySelector(".signIn")).toBeNull();

    // The site's second step arrives without a navigation.
    const password = document.createElement("input");
    password.type = "password";
    password.name = "password";
    password.getClientRects = () => [{} as DOMRect] as unknown as DOMRectList;
    await act(async () => {
      form.append(password);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    const second = roots.filter((root) => root.querySelector(".signIn")).at(-1);
    expect(second).toBeDefined();
    await clickAndFlush(within(second as unknown as HTMLElement).getByRole("button", { name: "Sign in" }));
    expect(password.value).toBe("s3cret!");
    expect(submitted).toHaveBeenCalledTimes(2);
  });

  it("looks for a sign-in form again when a field gains focus, so a modal shown by a class flip is offered", async () => {
    const roots = captureClosedRoots();
    const { username, password } = loginForm();
    const candidate = platform((request) => {
      if (request.kind === "login.fillSuggestions")
        return { version: 1, kind: "login.fillSuggestionsResult", suggestions: [account] };
      return undefined;
    });
    start(candidate);
    await flush();
    expect(roots.some((root) => root.querySelector(".signIn"))).toBe(false);

    // The modal opens: the same fields, now laid out, and the person clicks into one.
    password.getClientRects = () => [{} as DOMRect] as unknown as DOMRectList;
    focusField(username);
    await flush();
    expect(roots.some((root) => root.querySelector(".signIn"))).toBe(true);
  });

  it("dismisses the sign-in banner for the rest of the page load", async () => {
    const roots = captureClosedRoots();
    const { password } = loginForm();
    password.getClientRects = () => [{} as DOMRect] as unknown as DOMRectList;
    const candidate = platform((request) => {
      if (request.kind === "login.fillSuggestions")
        return { version: 1, kind: "login.fillSuggestionsResult", suggestions: [account] };
      return undefined;
    });
    start(candidate);
    await flush();
    const bannerRoot = roots.find((root) => root.querySelector(".signIn"));
    await clickAndFlush(within(bannerRoot as unknown as HTMLElement).getByRole("button", { name: "Dismiss ShardPass sign-in" }));
    expect(bannerRoot?.querySelector(".signIn")).toBeNull();
    // A later DOM change does not bring it back.
    document.body.append(document.createElement("p"));
    await flush();
    expect(roots.filter((root) => root.querySelector(".signIn"))).toHaveLength(0);
  });

  it("narrows the picker as the person types in the field and picks a row with the arrow keys", async () => {
    const roots = captureClosedRoots();
    const { username } = loginForm();
    const other: LoginFillSuggestion = {
      ...account,
      itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a21",
      name: "Beta",
      username: "beta@example.test",
      favorite: false,
    };
    const candidate = platform((request) => {
      if (request.kind === "login.fillSuggestions")
        return { version: 1, kind: "login.fillSuggestionsResult", suggestions: [account, other] };
      if (request.kind === "login.fillSelect") return release;
      return undefined;
    });
    start(candidate);
    focusField(username);
    await flush();
    await clickAndFlush(chipIn(roots.at(-1)));
    // The picker opens busy and re-renders once the suggestions arrive.
    await flush();

    const pickerRoot = roots.at(-1);
    const picker = within(pickerRoot as unknown as HTMLElement);
    expect(picker.getAllByRole("button", { name: /Use login/u })).toHaveLength(2);
    expect(picker.queryByRole("searchbox")).toBeNull();
    expect(document.activeElement).toBe(username);

    await act(async () => {
      fireEvent.input(username, { target: { value: "be" } });
      await Promise.resolve();
    });
    expect(picker.getAllByRole("button", { name: /Use login/u })).toHaveLength(1);
    expect(picker.getByRole("button", { name: /Use login/u })).toHaveTextContent("Beta");

    await act(async () => {
      fireEvent.keyDown(username, { key: "ArrowDown" });
      await Promise.resolve();
    });
    expect(picker.getByRole("button", { name: /Use login/u })).toHaveAttribute("data-active", "true");
    await act(async () => {
      fireEvent.keyDown(username, { key: "Enter" });
      await Promise.resolve();
      await Promise.resolve();
    });
    const selected = vi
      .mocked(candidate.sendLoginFillMessage)
      .mock.calls.find(([request]) => request.kind === "login.fillSelect");
    expect(selected?.[0]).toMatchObject({ kind: "login.fillSelect", itemId: other.itemId });
  });

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
      // Only the fill's own writes count (they carry inputType); the test types too.
      const fillWrite = (event: Event) => event instanceof InputEvent && event.inputType === "insertText";
      username.addEventListener("input", (event) => fillWrite(event) && usernameEvents++);
      password.addEventListener("input", (event) => fillWrite(event) && passwordEvents++);
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
      // One fetch gated the trigger; opening the picker asks once more, so an unlock or a new
      // login since the chip appeared is noticed.
      expect(suggestionRequests(candidate)).toBe(2);

      // Typing in the page's own field narrows the rows; there is no search box to reach for.
      await act(async () => {
        fireEvent.input(username, { target: { value: "second" } });
        await Promise.resolve();
      });
      expect(within(pickerRoot).getByRole("button", { name: /Secondary/u })).toBeVisible();
      expect(within(pickerRoot).queryByRole("button", { name: /Primary/u })).toBeNull();
      await act(async () => {
        fireEvent.input(username, { target: { value: "" } });
        await Promise.resolve();
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

  it("shows the chip while the vault is locked, explains in the picker, and asks again on the next click", async () => {
    const roots = captureClosedRoots();
    const { username } = loginForm();
    let vaultLocked = true;
    const candidate = platform((request) => {
      if (request.kind === "login.fillSuggestions") {
        if (vaultLocked) throw locked();
        return { version: 1, kind: "login.fillSuggestionsResult", suggestions: [account] };
      }
      return undefined;
    });
    start(candidate);
    focusField(username);
    await flush();

    expect(chipIn(roots.at(-1))).toBeVisible();
    await clickAndFlush(chipIn(roots.at(-1)));
    const picker = within(roots.at(-1) as unknown as HTMLElement);
    expect(picker.getByRole("status")).toHaveTextContent("ShardPass is locked");
    expect(picker.getByRole("status")).toHaveTextContent("Unlock it from the toolbar, then click here again.");

    vaultLocked = false;
    await act(async () => {
      fireEvent.keyDown(username, { key: "Escape" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(chipIn(roots.at(-1))).toBeVisible();
    await clickAndFlush(chipIn(roots.at(-1)));
    expect(
      within(roots.at(-1) as unknown as HTMLElement).getByRole("button", { name: /Account/u }),
    ).toBeVisible();
  });

  it("keeps the field's chip after Escape closes the picker, and shows it again on a new focusin", async () => {
    const roots = captureClosedRoots();
    const { username } = loginForm();
    const candidate = platform((request) =>
      request.kind === "login.fillSuggestions"
        ? { version: 1, kind: "login.fillSuggestionsResult", suggestions: [account] }
        : undefined,
    );
    start(candidate);
    focusField(username);
    await flush();
    await clickAndFlush(chipIn(roots.at(-1)));
    expect(within(roots.at(-1) as unknown as HTMLElement).getByRole("button", { name: /Account/u })).toBeVisible();

    // Escape lands on the field, which keeps focus while the picker is open.
    await act(async () => {
      fireEvent.keyDown(username, { key: "Escape" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(chipIn(roots.at(-1))).toBeVisible();
    expect(username).toHaveFocus();

    // Escape on the chip itself closes it; coming back to the field brings it back, from cache.
    await act(async () => {
      fireEvent.keyDown(username, { key: "Escape" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector("shardpass-picker-host")).toBeNull();
    act(() => username.blur());
    focusField(username);
    await flush();
    expect(chipIn(roots.at(-1))).toBeVisible();
    expect(suggestionRequests(candidate)).toBe(2);
  });

  it("fills from the popup into a rendered form only, and says no-form after a moment when every form is hidden", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    captureClosedRoots();
    const hidden = loginForm();
    const shown = loginForm();
    let shownRects: object[] = [{}];
    Object.defineProperty(shown.password, "getClientRects", { value: () => shownRects });
    const candidate = platform((request) => (request.kind === "login.fillSelect" ? release : undefined));
    start(candidate);
    const ask = () =>
      candidate.runtime.handler?.(
        { version: 1, kind: "login.fillFromPopup", itemId: account.itemId, expectedRevision: 1 },
        { extensionId: "extension-test" },
      );

    const filled = ask();
    await flush();
    await expect(filled).resolves.toMatchObject({ status: "filled" });
    expect(shown.password.value).toBe("s3cret!");
    expect(shown.username.value).toBe("user@example.test");
    expect(hidden.password.value).toBe("");

    shownRects = [];
    const none = ask();
    await flush();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    await expect(none).resolves.toMatchObject({ status: "no-form" });
    // The popup path never asks for suggestions; the one request is the sign-in banner's,
    // made once for the shown form when the page loaded.
    expect(suggestionRequests(candidate)).toBe(1);
  });

  it("fills only the username of a username-only first step", async () => {
    const roots = captureClosedRoots();
    const form = document.createElement("form");
    const email = document.createElement("input");
    email.type = "email";
    email.name = "email";
    const next = document.createElement("button");
    next.textContent = "Next";
    form.append(email, next);
    document.body.append(form);
    const candidate = platform((request) => {
      if (request.kind === "login.fillSuggestions")
        return { version: 1, kind: "login.fillSuggestionsResult", suggestions: [account] };
      if (request.kind === "login.fillSelect") return release;
      return undefined;
    });
    start(candidate);
    focusField(email);
    await flush();
    await clickAndFlush(chipIn(roots.at(-1)));
    await clickAndFlush(
      within(roots.at(-1) as unknown as HTMLElement).getByRole("button", { name: /Account/u }),
    );

    expect(email.value).toBe("user@example.test");
    expect(document.body.innerHTML).not.toContain("s3cret!");
    expect(candidate.sendLoginFillMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "login.fillConfirm", itemId: account.itemId }),
    );
  });

  it("keeps offering a password field after a show-password toggle flips it to text", async () => {
    const roots = captureClosedRoots();
    const { username, password } = loginForm();
    const candidate = platform((request) =>
      request.kind === "login.fillSuggestions"
        ? { version: 1, kind: "login.fillSuggestionsResult", suggestions: [account] }
        : undefined,
    );
    start(candidate);
    focusField(password);
    await flush();
    expect(chipIn(roots.at(-1))).toBeVisible();

    act(() => {
      password.type = "text";
    });
    await flush();
    focusField(username);
    await flush();
    focusField(password);
    await flush();
    expect(chipIn(roots.at(-1))).toBeVisible();
    expect(password.type).toBe("text");
  });
});
