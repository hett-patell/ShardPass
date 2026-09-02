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
  form.addEventListener("submit", (event) => event.preventDefault());
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
): LoginFillContentPlatform & { openVaultPage: ReturnType<typeof vi.fn> } {
  return {
    extensionId: "extension-test",
    onMessage: () => () => undefined,
    sendMessage: () => Promise.resolve(undefined),
    openVaultPage: vi.fn(() => Promise.resolve()),
    sendLoginFillMessage: vi.fn((request: LoginFillRequest) => Promise.resolve(handler(request))),
  };
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

afterEach(() => {
  act(() => {
    for (const prompt of prompts.splice(0)) prompt.dispose();
  });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Save login prompt", () => {
  it("offers to save a new credential with no matching saved login, and dismisses on request", async () => {
    const roots = captureClosedRoots();
    const { form, username, password } = loginForm();
    username.value = "new-user@example.test";
    password.value = "correct-horse";
    const candidate = platform((request) => {
      if (request.kind === "login.fillSuggestions")
        return { version: 1, kind: "login.fillSuggestionsResult", suggestions: [] };
      return { version: 1, kind: "login.fillAck", ok: true };
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
    const bannerRoot = roots.at(-1) as unknown as HTMLElement;
    expect(
      within(bannerRoot).getByRole("region", { name: "ShardPass save login prompt" }),
    ).toBeVisible();
    expect(within(bannerRoot).getByText("new-user@example.test")).toBeVisible();

    await act(async () => {
      fireEvent.click(within(bannerRoot).getByRole("button", { name: "Not now" }));
      await Promise.resolve();
    });
    expect(document.querySelector("shardpass-picker-host")).toBeNull();
    expect(candidate.openVaultPage).not.toHaveBeenCalled();
  });

  it("hands off to the vault tab when Save is clicked", async () => {
    const roots = captureClosedRoots();
    const { form, username, password } = loginForm();
    username.value = "new-user@example.test";
    password.value = "correct-horse";
    const candidate = platform((request) => {
      if (request.kind === "login.fillSuggestions")
        return { version: 1, kind: "login.fillSuggestionsResult", suggestions: [] };
      return { version: 1, kind: "login.fillAck", ok: true };
    });
    start(candidate);

    await submitAndFlush(form);
    const bannerRoot = roots.at(-1) as unknown as HTMLElement;
    await act(async () => {
      fireEvent.click(within(bannerRoot).getByRole("button", { name: "Save to ShardPass" }));
      await Promise.resolve();
    });

    expect(candidate.openVaultPage).toHaveBeenCalledTimes(1);
    expect(document.querySelector("shardpass-picker-host")).toBeNull();
  });

  it("does not prompt when a saved login already matches the submitted username", async () => {
    captureClosedRoots();
    const { form, username, password } = loginForm();
    username.value = "Existing@Example.test";
    password.value = "correct-horse";
    const candidate = platform((request) => {
      if (request.kind === "login.fillSuggestions")
        return {
          version: 1,
          kind: "login.fillSuggestionsResult",
          suggestions: [
            {
              itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
              expectedRevision: 1,
              name: "Existing",
              username: "existing@example.test",
              favorite: false,
              tags: [],
              hasLinkedOtp: false,
            },
          ],
        };
      return { version: 1, kind: "login.fillAck", ok: true };
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
    const candidate = platform(() => ({
      version: 1,
      kind: "login.fillSuggestionsResult",
      suggestions: [],
    }));
    start(candidate);

    await submitAndFlush(searchForm);
    await submitAndFlush(loginFormEl);
    await flush();

    expect(candidate.sendLoginFillMessage).not.toHaveBeenCalled();
    expect(document.querySelector("shardpass-picker-host")).toBeNull();
  });
});
