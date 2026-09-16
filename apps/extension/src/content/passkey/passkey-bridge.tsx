import type { ReactNode } from "react";

import type { PasskeyCandidate } from "@shardpass/messaging";
import { clientDataJson, isRegistrableRpId, toBase64Url } from "@shardpass/passkeys";

import type { PasskeyContentPlatform } from "../../platform/extension-platform";
import { createPickerHost, type PickerHandle } from "../createPickerHost";
import { PasskeyPrompt } from "./PasskeyPrompt";

export interface PasskeyBridge {
  start(): void;
  dispose(): void;
}

const TAG = "shardpass-passkey";

type CreateRequest = Readonly<{
  challenge: string;
  rp: { id: string | null; name: string };
  user: { id: string; name: string; displayName: string };
  algorithms: number[];
  excludeCredentialIds: string[];
}>;
type GetRequest = Readonly<{
  challenge: string;
  rpId: string | null;
  allowCredentialIds: string[];
  /** The page asked at load, ready for a passkey whenever one is offered; nobody is waiting. */
  conditional?: boolean;
}>;

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The page script's request, checked field by field: anything else is not a ceremony. */
function isCreateRequest(value: unknown): value is CreateRequest {
  if (!isRecord(value) || !isRecord(value["rp"]) || !isRecord(value["user"])) return false;
  const rp = value["rp"];
  const user = value["user"];
  return (
    typeof value["challenge"] === "string" &&
    (rp["id"] === null || typeof rp["id"] === "string") &&
    typeof rp["name"] === "string" &&
    typeof user["id"] === "string" &&
    typeof user["name"] === "string" &&
    typeof user["displayName"] === "string" &&
    Array.isArray(value["algorithms"]) &&
    value["algorithms"].every((entry) => typeof entry === "number") &&
    isStringList(value["excludeCredentialIds"])
  );
}

function isGetRequest(value: unknown): value is GetRequest {
  return (
    isRecord(value) &&
    typeof value["challenge"] === "string" &&
    (value["rpId"] === null || typeof value["rpId"] === "string") &&
    isStringList(value["allowCredentialIds"]) &&
    (value["conditional"] === undefined || typeof value["conditional"] === "boolean")
  );
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * The isolated-world half of passkey support. It answers the page script's requests: it
 * builds clientDataJSON from the real origin (never from what the page claims), asks the
 * person in a closed shadow root, and has the background do every key operation. Every
 * refusal is a "fallback" so the browser's own passkey UI still gets its turn.
 */
export function createPasskeyBridge(
  options: Readonly<{ document: Document; window: Window; platform: PasskeyContentPlatform }>,
): PasskeyBridge {
  let started = false;
  let disposed = false;
  let host: PickerHandle | null = null;
  let activeId: string | null = null;
  /** The ceremony in progress was offered at page load, with nobody waiting on it. */
  let activeConditional = false;

  /**
   * WebAuthn belongs to the top document and to frames of its own origin. A cross-origin
   * frame gets it only through permissions policy, and then its clientDataJSON must say the
   * ceremony was not top-level; that case is the browser's own, so it is never answered here.
   */
  const frameMayRunCeremony = (): boolean => {
    const win = options.window;
    try {
      if (win.top === win) return true;
    } catch {
      return false;
    }
    const origin = win.location.origin;
    const ancestors: DOMStringList | undefined = win.location.ancestorOrigins;
    if (ancestors !== undefined)
      return Array.from({ length: ancestors.length }, (_, index) => ancestors.item(index)).every(
        (ancestor) => ancestor === origin,
      );
    try {
      for (let frame: Window = win; frame !== frame.parent; frame = frame.parent)
        if (frame.parent.location.origin !== origin) return false;
      return true;
    } catch {
      return false;
    }
  };

  const post = (message: Record<string, unknown>) =>
    options.window.postMessage({ tag: TAG, ...message }, "/");
  const closeHost = () => {
    const current = host;
    host = null;
    current?.close();
  };
  const reply = (id: string, body: Record<string, unknown>) => {
    if (activeId !== id) return;
    activeId = null;
    activeConditional = false;
    closeHost();
    post({ direction: "reply", id, ...body });
  };
  const fallback = (id: string) => reply(id, { fallback: true });

  const show = (id: string, render: (busy: boolean) => ReactNode) => {
    if (!options.document.body.isConnected) return;
    closeHost();
    let busy = false;
    const paint = () => {
      closeHost();
      host = createPickerHost(options.document.body, {
        positionToAnchor: false,
        slot: "prompt",
        content: render(busy),
        // Escape answers the page (the browser's own passkey UI takes over) before closing;
        // a silent close would leave the site waiting on a ceremony nobody is running.
        onRequestClose: () => fallback(id),
      });
    };
    paint();
    return () => {
      busy = true;
      paint();
    };
  };

  const handleCreate = async (id: string, request: CreateRequest) => {
    const origin = options.window.location.origin;
    const rpId = request.rp.id ?? options.window.location.hostname;
    if (!isRegistrableRpId(origin, rpId)) return fallback(id);
    let attachToName: string | null = null;
    let attachTo: string | undefined;
    try {
      const preview = await options.platform.sendPasskeyMessage({
        version: 1,
        kind: "passkey.preview",
        rpId,
        userName: request.user.name,
      });
      if (preview.kind === "passkey.previewResult" && preview.login !== null) {
        attachToName = preview.login.name;
        attachTo = preview.login.itemId;
      }
    } catch (error) {
      // A prompt is only worth drawing while this ceremony is still the live one.
      if (errorCode(error) === "VAULT_LOCKED" && activeId === id) {
        show(id, () => <PasskeyPrompt mode="locked" rpId={rpId} onFallback={() => fallback(id)} />);
        return;
      }
      return fallback(id);
    }
    if (activeId !== id) return;
    const setBusy = show(id, (busy) => (
      <PasskeyPrompt
        mode="create"
        rpId={rpId}
        userName={request.user.name}
        attachToName={attachToName}
        busy={busy}
        onFallback={() => fallback(id)}
        onCreate={() => {
          setBusy?.();
          void (async () => {
            try {
              const client = clientDataJson("webauthn.create", request.challenge, origin);
              const result = await options.platform.sendPasskeyMessage({
                version: 1,
                kind: "passkey.register",
                origin,
                rpId,
                rpName: request.rp.name,
                userHandle: request.user.id,
                userName: request.user.name,
                userDisplayName: request.user.displayName,
                algorithms: request.algorithms,
                excludeCredentialIds: request.excludeCredentialIds,
                clientDataJson: toBase64Url(client),
                ...(attachTo === undefined ? {} : { attachTo }),
              });
              if (result.kind !== "passkey.registerResult") return fallback(id);
              reply(id, {
                result: {
                  credentialId: result.credentialId,
                  clientDataJson: toBase64Url(client),
                  attestationObject: result.attestationObject,
                  authenticatorData: result.authenticatorData,
                  publicKey: result.publicKey,
                },
              });
            } catch (error) {
              if (errorCode(error) === "PASSKEY_EXISTS")
                reply(id, {
                  error: {
                    name: "InvalidStateError",
                    message: "A passkey for this account already exists in ShardPass.",
                  },
                });
              else fallback(id);
            }
          })();
        }}
      />
    ));
  };

  const handleGet = async (id: string, request: GetRequest) => {
    const origin = options.window.location.origin;
    const rpId = request.rpId ?? options.window.location.hostname;
    if (!isRegistrableRpId(origin, rpId)) return fallback(id);
    let candidates: readonly PasskeyCandidate[] = [];
    try {
      const response = await options.platform.sendPasskeyMessage({
        version: 1,
        kind: "passkey.candidates",
        origin,
        rpId,
        allowCredentialIds: request.allowCredentialIds,
      });
      if (response.kind === "passkey.candidatesResult") candidates = response.candidates;
    } catch (error) {
      // A page asking at load has not been asked by anyone: a locked vault stays quiet then,
      // rather than putting a prompt on every sign-in page.
      if (errorCode(error) === "VAULT_LOCKED" && request.conditional !== true && activeId === id) {
        show(id, () => <PasskeyPrompt mode="locked" rpId={rpId} onFallback={() => fallback(id)} />);
        return;
      }
      return fallback(id);
    }
    if (activeId !== id) return;
    if (candidates.length === 0) return fallback(id);
    const setBusy = show(id, (busy) => (
      <PasskeyPrompt
        mode="choose"
        rpId={rpId}
        candidates={candidates}
        busy={busy}
        conditional={request.conditional === true}
        onFallback={() => fallback(id)}
        onSelect={(candidate) => {
          setBusy?.();
          void (async () => {
            try {
              const client = clientDataJson("webauthn.get", request.challenge, origin);
              const result = await options.platform.sendPasskeyMessage({
                version: 1,
                kind: "passkey.assert",
                origin,
                rpId,
                itemId: candidate.itemId,
                credentialId: candidate.credentialId,
                clientDataJson: toBase64Url(client),
              });
              if (result.kind !== "passkey.assertResult") return fallback(id);
              reply(id, {
                result: {
                  credentialId: result.credentialId,
                  clientDataJson: toBase64Url(client),
                  authenticatorData: result.authenticatorData,
                  signature: result.signature,
                  userHandle: result.userHandle,
                },
              });
            } catch {
              fallback(id);
            }
          })();
        }}
      />
    ));
  };

  const onMessage = (event: MessageEvent) => {
    if (disposed || event.source !== options.window) return;
    const data = event.data as {
      tag?: unknown;
      direction?: unknown;
      id?: unknown;
      type?: unknown;
      request?: unknown;
    } | null;
    if (
      data === null ||
      typeof data !== "object" ||
      data.tag !== TAG ||
      typeof data.id !== "string"
    )
      return;
    if (data.direction === "cancel") {
      if (activeId === data.id) {
        activeId = null;
        activeConditional = false;
        closeHost();
      }
      return;
    }
    if (data.direction !== "request") return;
    post({ direction: "ack", id: data.id });
    // A patient request is posted again until it is acknowledged; the repeats are the same
    // ceremony, not a second one.
    if (activeId === data.id) return;
    const request =
      data.type === "create" && isCreateRequest(data.request)
        ? ({ type: "create", body: data.request } as const)
        : data.type === "get" && isGetRequest(data.request)
          ? ({ type: "get", body: data.request } as const)
          : null;
    // Anything but a well-formed ceremony this frame may run goes straight to the browser,
    // and leaves a ceremony already in progress alone.
    if (request === null || !frameMayRunCeremony()) {
      post({ direction: "reply", id: data.id, fallback: true });
      return;
    }
    if (activeId !== null) {
      // One ceremony at a time. An offer made at page load yields to a request the person
      // just made; a second request while somebody is being asked goes to the browser.
      if (!activeConditional) {
        post({ direction: "reply", id: data.id, fallback: true });
        return;
      }
      fallback(activeId);
    }
    activeId = data.id;
    activeConditional = request.type === "get" && request.body.conditional === true;
    if (request.type === "create") void handleCreate(data.id, request.body);
    else void handleGet(data.id, request.body);
  };

  return {
    start() {
      if (started || disposed) return;
      started = true;
      options.window.addEventListener("message", onMessage);
      // The page-world half runs at document_start, this one at document_idle: a ceremony
      // started in between is waiting, and this tells it to ask again now.
      post({ direction: "ready" });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      options.window.removeEventListener("message", onMessage);
      activeId = null;
      activeConditional = false;
      closeHost();
    },
  };
}
