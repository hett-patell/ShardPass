import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installPasskeyInterceptor } from "../../../src/content/passkey/page-script";

// jsdom delivers window.postMessage with `source: null`; both halves ignore messages that are not
// from their own window, so deliver them the way a browser does.
function deliverLikeABrowser(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(window, "postMessage");
  Object.defineProperty(window, "postMessage", {
    configurable: true,
    writable: true,
    value: (message: unknown) => {
      setTimeout(() => {
        window.dispatchEvent(new MessageEvent("message", { data: message, origin: window.location.origin, source: window }));
      }, 0);
    },
  });
  return () => {
    if (descriptor) Object.defineProperty(window, "postMessage", descriptor);
  };
}

type Reply = { direction: "ack" | "reply"; id: string; fallback?: boolean; result?: Record<string, string>; error?: { name: string; message: string } };

function installWithFakeCredentials() {
  const originalCreate = vi.fn(() => Promise.resolve({ id: "browser-made" } as unknown as Credential));
  const originalGet = vi.fn(() => Promise.resolve({ id: "browser-got" } as unknown as Credential));
  Object.defineProperty(window.navigator, "credentials", {
    configurable: true,
    value: { create: originalCreate, get: originalGet },
  });
  delete (window as unknown as Record<string, unknown>)["__shardpass-passkey"];
  installPasskeyInterceptor(window);
  return { originalCreate, originalGet };
}

/** Plays the content script: acknowledge, then answer every request through `answer`. */
function answerRequests(answer: (type: string, request: Record<string, unknown>) => Omit<Reply, "direction" | "id">) {
  const seen: { type: string; request: Record<string, unknown> }[] = [];
  const listener = (event: MessageEvent) => {
    const data = event.data as { tag?: string; direction?: string; id?: string; type?: string; request?: Record<string, unknown> };
    if (data?.tag !== "shardpass-passkey" || data.direction !== "request" || data.id === undefined) return;
    seen.push({ type: data.type ?? "", request: data.request ?? {} });
    window.postMessage({ tag: "shardpass-passkey", direction: "ack", id: data.id }, "/");
    window.postMessage({ tag: "shardpass-passkey", direction: "reply", id: data.id, ...answer(data.type ?? "", data.request ?? {}) }, "/");
  };
  window.addEventListener("message", listener);
  return { seen, dispose: () => window.removeEventListener("message", listener) };
}

const creationOptions = (): CredentialCreationOptions => ({
  publicKey: {
    challenge: Uint8Array.of(1, 2, 3),
    rp: { id: "example.test", name: "Example" },
    user: { id: Uint8Array.of(9), name: "me@example.test", displayName: "Me" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    excludeCredentials: [{ type: "public-key", id: Uint8Array.of(7, 7) }],
  },
});

let restorePostMessage: () => void = () => undefined;
beforeAll(() => {
  restorePostMessage = deliverLikeABrowser();
});
afterAll(() => restorePostMessage());

afterEach(() => {
  vi.restoreAllMocks();
});

describe("passkey page script", () => {
  it("serialises a create() request for the content script and returns a credential shaped like the platform's", async () => {
    const { originalCreate } = installWithFakeCredentials();
    const relay = answerRequests(() => ({
      result: { credentialId: "Y3JlZA", clientDataJson: "e30", attestationObject: "AQI", authenticatorData: "AwQ", publicKey: "BQY" },
    }));
    const credential = (await navigator.credentials.create(creationOptions())) as PublicKeyCredential & { toJSON(): unknown };
    relay.dispose();
    expect(originalCreate).not.toHaveBeenCalled();
    expect(relay.seen[0]).toMatchObject({
      type: "create",
      request: {
        challenge: "AQID",
        rp: { id: "example.test", name: "Example" },
        user: { id: "CQ", name: "me@example.test", displayName: "Me" },
        algorithms: [-7],
        excludeCredentialIds: ["Bwc"],
      },
    });
    expect(credential.id).toBe("Y3JlZA");
    expect(credential.type).toBe("public-key");
    expect(new Uint8Array(credential.rawId)).toEqual(Uint8Array.from([99, 114, 101, 100]));
    const response = credential.response as AuthenticatorAttestationResponse;
    expect(new Uint8Array(response.attestationObject)).toEqual(Uint8Array.of(1, 2));
    expect(response.getPublicKeyAlgorithm()).toBe(-7);
    expect(credential.toJSON()).toMatchObject({ id: "Y3JlZA", response: { attestationObject: "AQI", publicKeyAlgorithm: -7 } });
  });

  it("falls back to the browser when the content script says so, when nothing answers, and for security-key or conditional requests", async () => {
    const { originalCreate, originalGet } = installWithFakeCredentials();
    const relay = answerRequests(() => ({ fallback: true }));
    await navigator.credentials.create(creationOptions());
    expect(originalCreate).toHaveBeenCalledTimes(1);
    relay.dispose();

    vi.useFakeTimers();
    const silent = navigator.credentials.get({ publicKey: { challenge: Uint8Array.of(1) } });
    await vi.advanceTimersByTimeAsync(800);
    await silent;
    expect(originalGet).toHaveBeenCalledTimes(1);
    vi.useRealTimers();

    const hardware = creationOptions();
    hardware.publicKey!.authenticatorSelection = { authenticatorAttachment: "cross-platform" };
    await navigator.credentials.create(hardware);
    expect(originalCreate).toHaveBeenCalledTimes(2);
    await navigator.credentials.get({ publicKey: { challenge: Uint8Array.of(1) }, mediation: "conditional" });
    expect(originalGet).toHaveBeenCalledTimes(2);
  });

  it("turns an error reply into a DOMException with the given name", async () => {
    installWithFakeCredentials();
    const relay = answerRequests(() => ({ error: { name: "InvalidStateError", message: "already exists" } }));
    await expect(navigator.credentials.create(creationOptions())).rejects.toMatchObject({ name: "InvalidStateError" });
    relay.dispose();
  });
});
