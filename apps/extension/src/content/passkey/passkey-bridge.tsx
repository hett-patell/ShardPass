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
type GetRequest = Readonly<{ challenge: string; rpId: string | null; allowCredentialIds: string[] }>;

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

  const post = (message: Record<string, unknown>) => options.window.postMessage({ tag: TAG, ...message }, "/");
  const closeHost = () => {
    const current = host;
    host = null;
    current?.close();
  };
  const reply = (id: string, body: Record<string, unknown>) => {
    if (activeId !== id) return;
    activeId = null;
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
      const preview = await options.platform.sendPasskeyMessage({ version: 1, kind: "passkey.preview", rpId, userName: request.user.name });
      if (preview.kind === "passkey.previewResult" && preview.login !== null) {
        attachToName = preview.login.name;
        attachTo = preview.login.itemId;
      }
    } catch (error) {
      if (errorCode(error) === "VAULT_LOCKED") {
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
                reply(id, { error: { name: "InvalidStateError", message: "A passkey for this account already exists in ShardPass." } });
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
      if (errorCode(error) === "VAULT_LOCKED") {
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
    const data = event.data as { tag?: unknown; direction?: unknown; id?: unknown; type?: unknown; request?: unknown } | null;
    if (data === null || typeof data !== "object" || data.tag !== TAG || typeof data.id !== "string") return;
    if (data.direction === "cancel") {
      if (activeId === data.id) {
        activeId = null;
        closeHost();
      }
      return;
    }
    if (data.direction !== "request") return;
    post({ direction: "ack", id: data.id });
    if (activeId !== null) {
      // One ceremony at a time; a second request while a prompt is open goes to the browser.
      post({ direction: "reply", id: data.id, fallback: true });
      return;
    }
    activeId = data.id;
    if (data.type === "create") void handleCreate(data.id, data.request as CreateRequest);
    else if (data.type === "get") void handleGet(data.id, data.request as GetRequest);
    else fallback(data.id);
  };

  return {
    start() {
      if (started || disposed) return;
      started = true;
      options.window.addEventListener("message", onMessage);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      options.window.removeEventListener("message", onMessage);
      activeId = null;
      closeHost();
    },
  };
}
