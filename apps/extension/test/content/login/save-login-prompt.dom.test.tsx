/* eslint-disable @typescript-eslint/unbound-method -- Vitest mock assertions intentionally inspect platform methods without invoking them. */
import "@testing-library/jest-dom/vitest";

import { act, fireEvent, within } from "@testing-library/react";
import type { LoginFillRequest, LoginFillResponse } from "@shardpass/messaging";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoginFillContentPlatform } from "../../../src/platform/extension-platform";
import { createSaveLoginPrompt } from "../../../src/content/login/save-login-prompt";

const originalAttachShadow = HTMLElement.prototype.attachShadow.call.bind(
  HTMLElement.prototype.attachShadow,
) as (element: HTMLElement, init: ShadowRootInit) => ShadowRoot;
const prompts: Array<ReturnType<typeof createSaveLoginPrompt>> = [];
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const offerId = "a".repeat(32);
const ack: LoginFillResponse = { version: 1, kind: "login.fillAck", ok: true };
const noOffer: LoginFillResponse = { version: 1, kind: "login.pendingOfferResult", offer: null };

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
  button: HTMLButtonElement;
}> {
  const form = document.createElement("form");
  form.addEventListener("submit", (event) => event.preventDefault());
  const username = document.createElement("input");
  username.type = "email";
  username.name = "email";
  const password = document.createElement("input");
  password.type = "password";
  password.name = "password";
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Sign in";
  form.append(username, password, button);
  document.body.append(form);
  return { form, username, password, button };
}

/** Requests the handler leaves unanswered get a plain "nothing held" or an acknowledgement. */
function platform(
  handler: (
    request: LoginFillRequest,
  ) => LoginFillResponse | Promise<LoginFillResponse> | undefined,
): LoginFillContentPlatform & { openVaultPage: ReturnType<typeof vi.fn> } {
  return {
    extensionId: "extension-test",
    onMessage: () => () => undefined,
    sendMessage: () => Promise.resolve(undefined),
    openVaultPage: vi.fn(() => Promise.resolve()),
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
  };
}

function offers(candidate: LoginFillContentPlatform): LoginFillRequest[] {
  return vi
    .mocked(candidate.sendLoginFillMessage)
    .mock.calls.map(([request]) => request)
    .filter((request) => request.kind === "login.saveOffer");
}

function start(candidate: LoginFillContentPlatform) {
  const prompt = createSaveLoginPrompt({ document, window, platform: candidate });
  prompts.push(prompt);
  act(() => prompt.start());
  return prompt;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function submitAndFlush(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    fireEvent.submit(form);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function banner(roots: readonly ShadowRoot[]) {
  return within(roots.at(-1) as unknown as HTMLElement);
}

afterEach(() => {
  act(() => {
    for (const prompt of prompts.splice(0)) prompt.dispose();
  });
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Save login prompt", () => {
  it("offers to save a new credential without taking focus, and Not now drops the held offer", async () => {
    const roots = captureClosedRoots();
    const { form, username, password } = loginForm();
    username.value = "new-user@example.test";
    password.value = "correct-horse";
    const candidate = platform((request) => {
      if (request.kind === "login.saveOffer")
        return { version: 1, kind: "login.saveOfferResult", offerId, existing: "none" };
      return undefined;
    });
    start(candidate);

    await submitAndFlush(form);

    expect(candidate.sendLoginFillMessage).toHaveBeenCalledWith({
      version: 1,
      kind: "login.saveOffer",
      domain: "localhost",
      username: "new-user@example.test",
      password: "correct-horse",
    });
    expect(
      banner(roots).getByRole("region", { name: "ShardPass save login prompt" }),
    ).toBeVisible();
    expect(banner(roots).getByText("new-user@example.test")).toBeVisible();
    expect(document.activeElement?.localName).not.toBe("shardpass-picker-host");

    await act(async () => {
      fireEvent.click(banner(roots).getByRole("button", { name: "Not now" }));
      await Promise.resolve();
    });
    expect(document.querySelector("shardpass-picker-host")).toBeNull();
    expect(candidate.sendLoginFillMessage).toHaveBeenCalledWith({
      version: 1,
      kind: "login.saveDismiss",
      offerId,
    });
    expect(candidate.openVaultPage).not.toHaveBeenCalled();
  });

  it("confirms the offer as a new login when Save is clicked and says so for a moment, never opening the vault page", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const roots = captureClosedRoots();
    const { form, username, password } = loginForm();
    username.value = "new-user@example.test";
    password.value = "correct-horse";
    const candidate = platform((request) => {
      if (request.kind === "login.saveOffer")
        return { version: 1, kind: "login.saveOfferResult", offerId, existing: "none" };
      if (request.kind === "login.saveConfirm")
        return {
          version: 1,
          kind: "login.saveResult",
          itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a21",
          saved: "created",
        };
      return undefined;
    });
    start(candidate);

    await submitAndFlush(form);
    await act(async () => {
      fireEvent.click(banner(roots).getByRole("button", { name: "Save new login" }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(candidate.sendLoginFillMessage).toHaveBeenCalledWith({
      version: 1,
      kind: "login.saveConfirm",
      offerId,
      choice: "new",
    });
    expect(candidate.openVaultPage).not.toHaveBeenCalled();
    expect(banner(roots).getByRole("status")).toHaveTextContent("Saved to ShardPass");
    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(document.querySelector("shardpass-picker-host")).toBeNull();
  });

  it("offers a password update when the same username already exists here with another password", async () => {
    const roots = captureClosedRoots();
    const { form, username, password } = loginForm();
    username.value = "existing@example.test";
    password.value = "brand-new";
    const candidate = platform((request) => {
      if (request.kind === "login.saveOffer")
        return {
          version: 1,
          kind: "login.saveOfferResult",
          offerId: "b".repeat(32),
          existing: "different-password",
          existingName: "Existing",
        };
      if (request.kind === "login.saveConfirm")
        return {
          version: 1,
          kind: "login.saveResult",
          itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
          saved: "updated",
        };
      return undefined;
    });
    start(candidate);

    await submitAndFlush(form);
    expect(
      banner(roots).getByRole("heading", { name: "Update password for Existing?" }),
    ).toBeVisible();
    await act(async () => {
      fireEvent.click(banner(roots).getByRole("button", { name: "Update password" }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(candidate.sendLoginFillMessage).toHaveBeenCalledWith({
      version: 1,
      kind: "login.saveConfirm",
      offerId: "b".repeat(32),
      choice: "update",
    });
    expect(banner(roots).getByRole("status")).toHaveTextContent("Password updated");
  });

  it("does not prompt when the vault already holds this username with this password", async () => {
    captureClosedRoots();
    const { form, username, password } = loginForm();
    username.value = "Existing@Example.test";
    password.value = "correct-horse";
    const candidate = platform((request) => {
      if (request.kind === "login.saveOffer")
        return {
          version: 1,
          kind: "login.saveOfferResult",
          offerId: "c".repeat(32),
          existing: "same",
          existingName: "Existing",
        };
      return undefined;
    });
    start(candidate);

    await submitAndFlush(form);

    expect(document.querySelector("shardpass-picker-host")).toBeNull();
  });

  it("ignores submissions with no password field or an empty password", async () => {
    captureClosedRoots();
    const searchForm = document.createElement("form");
    searchForm.addEventListener("submit", (event) => event.preventDefault());
    const query = document.createElement("input");
    query.type = "search";
    searchForm.append(query);
    document.body.append(searchForm);
    const { form: loginFormEl, password } = loginForm();
    password.value = "";
    const candidate = platform(() => undefined);
    start(candidate);

    await submitAndFlush(searchForm);
    await submitAndFlush(loginFormEl);
    await flush();

    expect(offers(candidate)).toHaveLength(0);
    expect(document.querySelector("shardpass-picker-host")).toBeNull();
  });

  it("shows the offer held for this tab on the landing page after a sign-in navigated away", async () => {
    const roots = captureClosedRoots();
    const candidate = platform((request) => {
      if (request.kind === "login.pendingOffer")
        return {
          version: 1,
          kind: "login.pendingOfferResult",
          offer: {
            offerId,
            domain: "accounts.example.test",
            username: "alice@example.test",
            existing: "different-password",
            existingName: "Example",
          },
        };
      return undefined;
    });
    start(candidate);
    await flush();

    expect(
      banner(roots).getByRole("heading", { name: "Update password for Example?" }),
    ).toBeVisible();
    expect(banner(roots).getByText("alice@example.test")).toBeVisible();
    expect(banner(roots).getByText("accounts.example.test")).toBeVisible();
  });

  it("ignores clicks on the form's other buttons, so the real submit is still offered", async () => {
    captureClosedRoots();
    const { form, username, password } = loginForm();
    const reveal = document.createElement("button");
    reveal.type = "button";
    reveal.textContent = "Show password";
    form.append(reveal);
    username.value = "alice@example.test";
    password.value = "half-typ";
    const candidate = platform((request) => {
      if (request.kind === "login.saveOffer")
        return { version: 1, kind: "login.saveOfferResult", offerId, existing: "none" };
      return undefined;
    });
    start(candidate);

    await act(async () => {
      fireEvent.click(reveal);
      await Promise.resolve();
    });
    expect(offers(candidate)).toHaveLength(0);

    password.value = "half-typed-now-whole";
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });
    expect(offers(candidate)).toHaveLength(1);
    expect(offers(candidate)[0]).toMatchObject({ password: "half-typed-now-whole" });
  });

  it("arms on the submit control's click and on Enter in the password field, offering each credential once", async () => {
    captureClosedRoots();
    const { form, username, password, button } = loginForm();
    username.value = "alice@example.test";
    password.value = "first-try";
    const candidate = platform((request) => {
      if (request.kind === "login.saveOffer")
        return { version: 1, kind: "login.saveOfferResult", offerId, existing: "none" };
      return undefined;
    });
    start(candidate);

    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.keyDown(password, { key: "Enter" });
      fireEvent.submit(form);
      await Promise.resolve();
    });
    expect(offers(candidate)).toHaveLength(1);
    expect(offers(candidate)[0]).toMatchObject({
      username: "alice@example.test",
      password: "first-try",
    });

    password.value = "second-try";
    await act(async () => {
      fireEvent.keyDown(password, { key: "Enter" });
      await Promise.resolve();
    });
    expect(offers(candidate)).toHaveLength(2);
    expect(offers(candidate)[1]).toMatchObject({ password: "second-try" });
  });

  it("offers a change-password form's new password, with the last username typed on the page", async () => {
    captureClosedRoots();
    document.body.innerHTML = `
      <form id="step"><input type="email" name="email" /><button>Next</button></form>
      <form id="change">
        <input type="password" name="current" />
        <input type="password" name="new" autocomplete="new-password" />
        <input type="password" name="confirm" autocomplete="new-password" />
        <button>Change password</button>
      </form>
    `;
    for (const form of document.querySelectorAll("form"))
      form.addEventListener("submit", (event) => event.preventDefault());
    const field = (name: string) =>
      document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    const candidate = platform((request) => {
      if (request.kind === "login.saveOffer")
        return { version: 1, kind: "login.saveOfferResult", offerId, existing: "none" };
      return undefined;
    });
    start(candidate);

    fireEvent.input(field("email"), { target: { value: "alice@example.test" } });
    field("current").value = "old-pw";
    field("new").value = "new-pw";
    field("confirm").value = "new-pw";
    await submitAndFlush(document.querySelector<HTMLFormElement>("#change")!);

    expect(offers(candidate)).toEqual([
      {
        version: 1,
        kind: "login.saveOffer",
        domain: "localhost",
        username: "alice@example.test",
        password: "new-pw",
      },
    ]);
  });

  it("offers only Not now while the vault is locked, and asks again once the page regains focus", async () => {
    const roots = captureClosedRoots();
    const { form, username, password } = loginForm();
    username.value = "alice@example.test";
    password.value = "pw";
    let unlocked = false;
    const candidate = platform((request) => {
      if (request.kind === "login.saveOffer")
        return { version: 1, kind: "login.saveOfferResult", offerId, existing: "locked" };
      if (request.kind === "login.pendingOffer" && unlocked)
        return {
          version: 1,
          kind: "login.pendingOfferResult",
          offer: { offerId, domain: "localhost", username: "alice@example.test", existing: "none" },
        };
      return undefined;
    });
    start(candidate);

    await submitAndFlush(form);
    expect(
      banner(roots).getByRole("heading", { name: "Unlock ShardPass to save this login" }),
    ).toBeVisible();
    expect(banner(roots).queryByRole("button", { name: /Save|Update/u })).toBeNull();
    expect(banner(roots).getByRole("button", { name: "Not now" })).toBeVisible();

    unlocked = true;
    await act(async () => {
      fireEvent(window, new Event("focus"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(banner(roots).getByRole("heading", { name: "Save this login?" })).toBeVisible();
    expect(banner(roots).getByRole("button", { name: "Save new login" })).toBeVisible();
  });

  it("brings the banner back after a hash change closed it", async () => {
    const roots = captureClosedRoots();
    const { form, username, password } = loginForm();
    username.value = "alice@example.test";
    password.value = "pw";
    let held = false;
    const candidate = platform((request) => {
      if (request.kind === "login.saveOffer") {
        held = true;
        return { version: 1, kind: "login.saveOfferResult", offerId, existing: "none" };
      }
      if (request.kind === "login.pendingOffer" && held)
        return {
          version: 1,
          kind: "login.pendingOfferResult",
          offer: { offerId, domain: "localhost", username: "alice@example.test", existing: "none" },
        };
      return undefined;
    });
    start(candidate);
    await submitAndFlush(form);
    const first = roots.at(-1);

    await act(async () => {
      fireEvent(window, new Event("hashchange"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(roots.at(-1)).not.toBe(first);
    expect(banner(roots).getByRole("heading", { name: "Save this login?" })).toBeVisible();
    expect(document.querySelectorAll("shardpass-picker-host")).toHaveLength(1);
  });
});
