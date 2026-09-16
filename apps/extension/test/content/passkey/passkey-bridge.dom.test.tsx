/* eslint-disable @typescript-eslint/unbound-method -- capturing attachShadow for closed-root inspection, as the other content tests do. */
import "@testing-library/jest-dom/vitest";

import { act, fireEvent, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { PasskeyRequest, PasskeyResponse } from "@shardpass/messaging";
import { createPasskeyBridge } from "../../../src/content/passkey/passkey-bridge";
import type { PasskeyContentPlatform } from "../../../src/platform/extension-platform";

// jsdom delivers window.postMessage with `source: null`; both halves ignore messages that are not
// from their own window, so deliver them the way a browser does.
function deliverLikeABrowser(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(window, "postMessage");
  Object.defineProperty(window, "postMessage", {
    configurable: true,
    writable: true,
    value: (message: unknown) => {
      setTimeout(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: message,
            origin: window.location.origin,
            source: window,
          }),
        );
      }, 0);
    },
  });
  return () => {
    if (descriptor) Object.defineProperty(window, "postMessage", descriptor);
  };
}

const originalAttachShadow = HTMLElement.prototype.attachShadow.call.bind(
  HTMLElement.prototype.attachShadow,
) as (element: HTMLElement, init: ShadowRootInit) => ShadowRoot;

/** Every closed shadow root created from here on, so the prompt inside can be inspected. */
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

function platform(
  answer: (request: PasskeyRequest) => PasskeyResponse | Promise<PasskeyResponse>,
): PasskeyContentPlatform & { calls: PasskeyRequest[] } {
  const calls: PasskeyRequest[] = [];
  return {
    calls,
    extensionId: "bridge-test",
    onMessage: () => () => undefined,
    sendMessage: () => Promise.resolve(undefined),
    openVaultPage: () => Promise.resolve(),
    sendPasskeyMessage: (request) => {
      calls.push(request);
      return Promise.resolve(answer(request));
    },
  };
}

function replies() {
  const seen: Record<string, unknown>[] = [];
  const listener = (event: MessageEvent) => {
    const data = event.data as { tag?: string; direction?: string };
    if (data?.tag === "shardpass-passkey" && data.direction === "reply") seen.push(data);
  };
  window.addEventListener("message", listener);
  return { seen, dispose: () => window.removeEventListener("message", listener) };
}

/** Lets promise chains and the (macrotask) message delivery settle. */
async function flush() {
  await act(async () => {
    for (let index = 0; index < 3; index += 1) {
      for (let micro = 0; micro < 4; micro += 1) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });
}

const bridges: { dispose(): void }[] = [];
let restorePostMessage: () => void = () => undefined;
beforeAll(() => {
  restorePostMessage = deliverLikeABrowser();
});
afterAll(() => restorePostMessage());

afterEach(() => {
  for (const bridge of bridges.splice(0)) bridge.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("passkey bridge", () => {
  it("previews the login, asks the person, registers with a clientDataJSON built from the real origin, and replies", async () => {
    const candidate = platform((request) => {
      if (request.kind === "passkey.preview")
        return {
          version: 1,
          kind: "passkey.previewResult",
          login: {
            itemId: "11111111-1111-4111-8111-111111111111",
            name: "Example",
            username: "me",
          },
        };
      if (request.kind === "passkey.register")
        return {
          version: 1,
          kind: "passkey.registerResult",
          itemId: "11111111-1111-4111-8111-111111111111",
          credentialId: "Y3JlZA",
          attestationObject: "AQI",
          authenticatorData: "AwQ",
          publicKey: "BQY",
          publicKeyAlgorithm: -7,
        };
      throw new Error("unexpected");
    });
    const roots = captureClosedRoots();
    const bridge = createPasskeyBridge({ document, window, platform: candidate });
    bridges.push(bridge);
    bridge.start();
    const answers = replies();

    await act(async () => {
      window.postMessage(
        {
          tag: "shardpass-passkey",
          direction: "request",
          id: "req-1",
          type: "create",
          request: {
            challenge: "AQID",
            rp: { id: null, name: "Example" },
            user: { id: "CQ", name: "me", displayName: "Me" },
            algorithms: [-7],
            excludeCredentialIds: [],
          },
        },
        "/",
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    const prompt = roots.at(-1) as unknown as HTMLElement;
    expect(
      within(prompt).getByRole("heading", { name: "Create a passkey for localhost?" }),
    ).toBeVisible();
    expect(within(prompt).getByText("Saved with “Example”")).toBeVisible();
    act(() => {
      fireEvent.click(within(prompt).getByRole("button", { name: "Create passkey" }));
    });
    await flush();

    const register = candidate.calls.find((call) => call.kind === "passkey.register") as Extract<
      PasskeyRequest,
      { kind: "passkey.register" }
    >;
    expect(register).toMatchObject({
      rpId: "localhost",
      origin: window.location.origin,
      attachTo: "11111111-1111-4111-8111-111111111111",
      userName: "me",
    });
    const clientData = JSON.parse(
      atob(register.clientDataJson.replaceAll("-", "+").replaceAll("_", "/")),
    ) as Record<string, unknown>;
    expect(clientData).toEqual({
      type: "webauthn.create",
      challenge: "AQID",
      origin: window.location.origin,
      crossOrigin: false,
    });
    expect(answers.seen.at(-1)).toMatchObject({
      id: "req-1",
      result: { credentialId: "Y3JlZA", attestationObject: "AQI" },
    });
    expect(document.querySelector("shardpass-picker-host")).toBeNull();
    answers.dispose();
  });

  it("offers the browser instead when the vault is locked, and when no passkey matches a get()", async () => {
    const roots = captureClosedRoots();
    const locked = platform(() =>
      Promise.reject(Object.assign(new Error("locked"), { code: "VAULT_LOCKED" })),
    );
    const bridge = createPasskeyBridge({ document, window, platform: locked });
    bridges.push(bridge);
    bridge.start();
    const answers = replies();
    await act(async () => {
      window.postMessage(
        {
          tag: "shardpass-passkey",
          direction: "request",
          id: "req-2",
          type: "get",
          request: { challenge: "AQ", rpId: null, allowCredentialIds: [] },
        },
        "/",
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
    const prompt = roots.at(-1) as unknown as HTMLElement;
    expect(within(prompt).getByRole("heading", { name: "ShardPass is locked" })).toBeVisible();
    act(() => {
      fireEvent.click(within(prompt).getByRole("button", { name: "Use browser instead" }));
    });
    await flush();
    expect(answers.seen.at(-1)).toMatchObject({ id: "req-2", fallback: true });
    bridge.dispose();

    const empty = platform(() => ({
      version: 1,
      kind: "passkey.candidatesResult",
      candidates: [],
    }));
    const second = createPasskeyBridge({ document, window, platform: empty });
    bridges.push(second);
    second.start();
    await act(async () => {
      window.postMessage(
        {
          tag: "shardpass-passkey",
          direction: "request",
          id: "req-3",
          type: "get",
          request: { challenge: "AQ", rpId: null, allowCredentialIds: [] },
        },
        "/",
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
    expect(answers.seen.at(-1)).toMatchObject({ id: "req-3", fallback: true });
    answers.dispose();
  });

  it("answers a page-load (conditional) request with its own prompt, quietly when locked, and once per id", async () => {
    const roots = captureClosedRoots();
    const answers = replies();
    const conditional = { challenge: "AQ", rpId: null, allowCredentialIds: [], conditional: true };

    // Locked: nothing is shown on a page nobody asked ShardPass about; the browser takes it.
    const locked = platform(() =>
      Promise.reject(Object.assign(new Error("locked"), { code: "VAULT_LOCKED" })),
    );
    const first = createPasskeyBridge({ document, window, platform: locked });
    bridges.push(first);
    first.start();
    await act(async () => {
      window.postMessage(
        {
          tag: "shardpass-passkey",
          direction: "request",
          id: "cond-1",
          type: "get",
          request: conditional,
        },
        "/",
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
    expect(roots).toHaveLength(0);
    expect(answers.seen.at(-1)).toMatchObject({ id: "cond-1", fallback: true });
    first.dispose();

    // A matching passkey: the prompt names the site and offers "Not now"; a repeated ask for
    // the same ceremony (the page script retrying until the script loaded) is not a second one.
    const ready = platform((request) =>
      request.kind === "passkey.candidates"
        ? {
            version: 1,
            kind: "passkey.candidatesResult",
            candidates: [
              {
                itemId: "10000000-0000-4000-8000-000000000001",
                credentialId: "Y3JlZA",
                loginName: "Google",
                userName: "me@example.test",
              },
            ],
          }
        : { version: 1, kind: "passkey.candidatesResult", candidates: [] },
    );
    const second = createPasskeyBridge({ document, window, platform: ready });
    bridges.push(second);
    second.start();
    await act(async () => {
      window.postMessage(
        {
          tag: "shardpass-passkey",
          direction: "request",
          id: "cond-2",
          type: "get",
          request: conditional,
        },
        "/",
      );
      window.postMessage(
        {
          tag: "shardpass-passkey",
          direction: "request",
          id: "cond-2",
          type: "get",
          request: conditional,
        },
        "/",
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
    expect(answers.seen.filter((entry) => entry["id"] === "cond-2")).toHaveLength(0);
    const prompt = roots.at(-1) as unknown as HTMLElement;
    expect(
      within(prompt).getByRole("heading", {
        name: `Sign in to ${window.location.hostname} with your passkey?`,
      }),
    ).toBeVisible();
    act(() => {
      fireEvent.click(within(prompt).getByRole("button", { name: "Not now" }));
    });
    await flush();
    expect(answers.seen.filter((entry) => entry["id"] === "cond-2")).toEqual([
      expect.objectContaining({ id: "cond-2", fallback: true }),
    ]);
    answers.dispose();
  });

  it("sends a malformed request to the browser and stays ready for the next ceremony", async () => {
    const candidate = platform((request) => {
      if (request.kind === "passkey.candidates")
        return {
          version: 1,
          kind: "passkey.candidatesResult",
          candidates: [
            {
              itemId: "11111111-1111-4111-8111-111111111111",
              credentialId: "Y3JlZA",
              loginName: "Example",
              userName: "me",
            },
          ],
        };
      throw new Error("unexpected");
    });
    const roots = captureClosedRoots();
    const bridge = createPasskeyBridge({ document, window, platform: candidate });
    bridges.push(bridge);
    bridge.start();
    const answers = replies();

    await act(async () => {
      // No request body at all: not a ceremony, and it must not wedge the bridge.
      window.postMessage(
        { tag: "shardpass-passkey", direction: "request", id: "bad-1", type: "create" },
        "/",
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
    expect(answers.seen.at(-1)).toMatchObject({ id: "bad-1", fallback: true });
    expect(document.querySelector("shardpass-picker-host")).toBeNull();

    await act(async () => {
      window.postMessage(
        {
          tag: "shardpass-passkey",
          direction: "request",
          id: "good-1",
          type: "get",
          request: { challenge: "AQ", rpId: null, allowCredentialIds: [] },
        },
        "/",
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
    const prompt = roots.at(-1) as unknown as HTMLElement;
    expect(within(prompt).getByRole("heading", { name: "Sign in with a passkey" })).toBeVisible();
    answers.dispose();
  });

  it("lets a request the person just made take over from an offer made at page load", async () => {
    const candidate = platform((request) => {
      if (request.kind === "passkey.candidates")
        return {
          version: 1,
          kind: "passkey.candidatesResult",
          candidates: [
            {
              itemId: "11111111-1111-4111-8111-111111111111",
              credentialId: "Y3JlZA",
              loginName: "Example",
              userName: "me",
            },
          ],
        };
      throw new Error("unexpected");
    });
    const roots = captureClosedRoots();
    const bridge = createPasskeyBridge({ document, window, platform: candidate });
    bridges.push(bridge);
    bridge.start();
    const answers = replies();

    const ask = async (id: string, conditional: boolean) => {
      await act(async () => {
        window.postMessage(
          {
            tag: "shardpass-passkey",
            direction: "request",
            id,
            type: "get",
            request: { challenge: "AQ", rpId: null, allowCredentialIds: [], conditional },
          },
          "/",
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await flush();
    };

    await ask("page-load", true);
    expect(
      within(roots.at(-1) as unknown as HTMLElement).getByRole("heading", {
        name: /Sign in to .* with your passkey\?/u,
      }),
    ).toBeVisible();

    await ask("pressed", false);
    // The page-load offer is handed back to the browser; the pressed request gets the prompt.
    expect(answers.seen.map((reply) => reply["id"])).toContain("page-load");
    expect(answers.seen.find((reply) => reply["id"] === "page-load")).toMatchObject({
      fallback: true,
    });
    expect(
      within(roots.at(-1) as unknown as HTMLElement).getByRole("heading", {
        name: "Sign in with a passkey",
      }),
    ).toBeVisible();
    answers.dispose();
  });
});
