/**
 * Runs in the page's own world (a MAIN-world content script) and wraps WebAuthn so a site's
 * passkey ceremony can be answered by the vault. It knows nothing secret: it serialises the
 * site's options, asks the isolated content script over window.postMessage, and turns the
 * answer into a PublicKeyCredential-shaped object. Any "fallback" answer, any silence, and
 * anything it cannot handle goes to the browser's own implementation untouched.
 *
 * Dependency-free on purpose: it is built as a standalone script, not through the bundle.
 */

type CredentialLike = Credential & Record<string, unknown>;

const TAG = "shardpass-passkey";
const ACK_TIMEOUT_MS = 700;
const REPLY_TIMEOUT_MS = 180_000;
/** How many acknowledgement windows a conditional request waits for the content script. */
const PATIENT_ATTEMPTS = 20;
/**
 * How many a modal one waits. This script runs at document_start and the content script that
 * answers it at document_idle, so on a slow page a ceremony can start before anything is
 * listening. Giving up immediately hands the request to the browser, which on a desktop with
 * no platform authenticator offers a phone over Bluetooth instead of the vault's own passkey.
 */
const MODAL_ATTEMPTS = 8;

function toBase64Url(input: ArrayBuffer | ArrayBufferView | undefined | null): string {
  if (input === undefined || input === null) return "";
  const bytes =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): ArrayBuffer {
  const padded =
    text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

type Reply =
  | { fallback: true }
  | { error: { name: string; message: string } }
  | { result: Record<string, string> };

export function installPasskeyInterceptor(win: Window & typeof globalThis): void {
  const nav = win.navigator;
  const credentials = nav?.credentials;
  if (credentials === undefined || (win as unknown as Record<string, unknown>)[`__${TAG}`] === true)
    return;
  (win as unknown as Record<string, unknown>)[`__${TAG}`] = true;
  const originalCreate = credentials.create.bind(credentials);
  const originalGet = credentials.get.bind(credentials);

  // Sites ask the browser what it can do before they ask for a passkey at all. A desktop
  // without a fingerprint reader or Windows Hello answers "no platform authenticator", and
  // Google then says the device cannot be used, never calling create(). ShardPass is that
  // authenticator now, and answers conditional requests too, so it says so here; whatever
  // it declines still reaches the browser's own implementation through the fallbacks.
  const publicKeyCredential = win.PublicKeyCredential as
    | (typeof PublicKeyCredential & {
        getClientCapabilities?: () => Promise<Record<string, boolean>>;
      })
    | undefined;
  if (publicKeyCredential !== undefined) {
    publicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(true);
    publicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(true);
    const originalCapabilities =
      publicKeyCredential.getClientCapabilities?.bind(publicKeyCredential);
    if (originalCapabilities !== undefined)
      publicKeyCredential.getClientCapabilities = async () => ({
        ...(await originalCapabilities().catch(() => ({}))),
        conditionalGet: true,
        userVerifyingPlatformAuthenticator: true,
        passkeyPlatformAuthenticator: true,
      });
  }

  const pending = new Map<
    string,
    { ack: () => void; retry: () => void; settle: (reply: Reply) => void }
  >();
  win.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== win) return;
    const data = event.data as { tag?: unknown; direction?: unknown; id?: unknown } | null;
    if (data === null || typeof data !== "object" || data.tag !== TAG) return;
    // The content script announces itself when it loads: anything asked before it was
    // listening is asked again at once, rather than waiting out its next window.
    if (data.direction === "ready") {
      for (const waiter of pending.values()) waiter.retry();
      return;
    }
    if (typeof data.id !== "string") return;
    const waiter = pending.get(data.id);
    if (waiter === undefined) return;
    if (data.direction === "ack") waiter.ack();
    else if (data.direction === "reply") {
      pending.delete(data.id);
      waiter.settle(data as unknown as Reply);
    }
  });

  /**
   * Asks the isolated content script. A modal ceremony gives it one short chance to answer,
   * since a person is waiting. A conditional one (the page asking at load, ready to accept a
   * passkey whenever the person offers one) is patient: it keeps asking until the content
   * script has loaded, and then waits as long as the page does.
   */
  const ask = (
    type: "create" | "get",
    request: unknown,
    signal: AbortSignal | undefined,
    patient = false,
  ): Promise<Reply> =>
    new Promise((resolve) => {
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      let acknowledged = false;
      let attempts = 0;
      let ackTimer = 0;
      let replyTimer = 0;
      const finish = (reply: Reply) => {
        pending.delete(id);
        win.clearTimeout(ackTimer);
        win.clearTimeout(replyTimer);
        signal?.removeEventListener("abort", onAbort);
        resolve(reply);
      };
      const onAbort = () => {
        win.postMessage({ tag: TAG, direction: "cancel", id }, "/");
        finish({ error: { name: "AbortError", message: "The operation was aborted." } });
      };
      const post = () => {
        attempts += 1;
        win.postMessage({ tag: TAG, direction: "request", id, type, request }, "/");
      };
      const attemptLimit = patient ? PATIENT_ATTEMPTS : MODAL_ATTEMPTS;
      const awaitAck = () => {
        ackTimer = win.setTimeout(() => {
          if (acknowledged) return;
          // Nothing has answered yet: ask again until the content script is there, and only
          // then leave the ceremony to the browser.
          if (attempts < attemptLimit) {
            post();
            awaitAck();
          } else finish({ fallback: true });
        }, ACK_TIMEOUT_MS);
      };
      if (!patient)
        replyTimer = win.setTimeout(() => {
          // Tell the content script too: a prompt still open is for a ceremony nobody is
          // waiting on any more, and it must not block the next one.
          win.postMessage({ tag: TAG, direction: "cancel", id }, "/");
          finish({
            error: { name: "NotAllowedError", message: "The passkey request timed out." },
          });
        }, REPLY_TIMEOUT_MS);
      pending.set(id, {
        ack: () => {
          acknowledged = true;
        },
        retry: () => {
          if (acknowledged) return;
          win.clearTimeout(ackTimer);
          post();
          awaitAck();
        },
        settle: finish,
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      post();
      awaitAck();
    });

  const buildResponse = (
    type: "create" | "get",
    result: Record<string, string>,
  ): CredentialLike => {
    const rawId = fromBase64Url(result.credentialId ?? "");
    const clientDataJSON = fromBase64Url(result.clientDataJson ?? "");
    const base = {
      id: result.credentialId ?? "",
      rawId,
      type: "public-key",
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => (type === "create" ? { credProps: { rk: true } } : {}),
    };
    const response =
      type === "create"
        ? {
            clientDataJSON,
            attestationObject: fromBase64Url(result.attestationObject ?? ""),
            getAuthenticatorData: () => fromBase64Url(result.authenticatorData ?? ""),
            getPublicKey: () => fromBase64Url(result.publicKey ?? ""),
            getPublicKeyAlgorithm: () => -7,
            // "internal" alone: this passkey lives in the vault on this browser. Saying
            // "hybrid" as well tells the site it can also be reached from a phone, which is
            // how a desktop with no phone paired ends up showing "turn on Bluetooth" instead
            // of offering ShardPass. A manager with its own phone app says hybrid; this has none.
            getTransports: () => ["internal"],
          }
        : {
            clientDataJSON,
            authenticatorData: fromBase64Url(result.authenticatorData ?? ""),
            signature: fromBase64Url(result.signature ?? ""),
            userHandle: result.userHandle ? fromBase64Url(result.userHandle) : null,
          };
    const toJSON = () =>
      type === "create"
        ? {
            id: base.id,
            rawId: base.id,
            type: "public-key",
            authenticatorAttachment: "platform",
            clientExtensionResults: { credProps: { rk: true } },
            response: {
              clientDataJSON: result.clientDataJson,
              attestationObject: result.attestationObject,
              authenticatorData: result.authenticatorData,
              publicKey: result.publicKey,
              publicKeyAlgorithm: -7,
              transports: ["internal"],
            },
          }
        : {
            id: base.id,
            rawId: base.id,
            type: "public-key",
            authenticatorAttachment: "platform",
            clientExtensionResults: {},
            response: {
              clientDataJSON: result.clientDataJson,
              authenticatorData: result.authenticatorData,
              signature: result.signature,
              userHandle: result.userHandle || undefined,
            },
          };
    const responseProto =
      type === "create"
        ? win.AuthenticatorAttestationResponse?.prototype
        : win.AuthenticatorAssertionResponse?.prototype;
    if (responseProto) Object.setPrototypeOf(response, responseProto);
    const credential = { ...base, response, toJSON };
    if (win.PublicKeyCredential?.prototype)
      Object.setPrototypeOf(credential, win.PublicKeyCredential.prototype);
    return credential;
  };

  /** Whether the request names only cross-device or security-key ways of answering it. */
  const wantsAnotherDevice = (
    publicKey: PublicKeyCredentialRequestOptions & { hints?: unknown },
  ): boolean => {
    const hints = Array.isArray(publicKey.hints) ? publicKey.hints : [];
    if (hints.length > 0 && !hints.includes("client-device")) return true;
    const allow = publicKey.allowCredentials ?? [];
    if (allow.length === 0) return false;
    return allow.every((entry) => {
      const transports = entry.transports ?? [];
      return transports.length > 0 && !transports.includes("internal");
    });
  };

  const serializeCreate = (options: PublicKeyCredentialCreationOptions) => ({
    challenge: toBase64Url(options.challenge),
    rp: { id: options.rp.id ?? null, name: options.rp.name ?? "" },
    user: {
      id: toBase64Url(options.user.id),
      name: options.user.name ?? "",
      displayName: options.user.displayName ?? "",
    },
    algorithms: (options.pubKeyCredParams ?? []).map((param) => param.alg),
    excludeCredentialIds: (options.excludeCredentials ?? []).map((entry) => toBase64Url(entry.id)),
    residentKey: options.authenticatorSelection?.residentKey ?? null,
    userVerification: options.authenticatorSelection?.userVerification ?? null,
    authenticatorAttachment: options.authenticatorSelection?.authenticatorAttachment ?? null,
  });
  const serializeGet = (options: PublicKeyCredentialRequestOptions) => ({
    challenge: toBase64Url(options.challenge),
    rpId: options.rpId ?? null,
    allowCredentialIds: (options.allowCredentials ?? []).map((entry) => toBase64Url(entry.id)),
    userVerification: options.userVerification ?? null,
  });

  credentials.create = async (options?: CredentialCreationOptions): Promise<Credential | null> => {
    const publicKey = options?.publicKey;
    if (!publicKey || !publicKey.challenge || !publicKey.rp || !publicKey.user)
      return originalCreate(options);
    // A cross-platform/security-key request is for a hardware key; leave it to the browser.
    if (publicKey.authenticatorSelection?.authenticatorAttachment === "cross-platform")
      return originalCreate(options);
    const reply = await ask("create", serializeCreate(publicKey), options.signal ?? undefined);
    if ("fallback" in reply) return originalCreate(options);
    if ("error" in reply) throw new win.DOMException(reply.error.message, reply.error.name);
    return buildResponse("create", reply.result);
  };

  credentials.get = async (options?: CredentialRequestOptions): Promise<Credential | null> => {
    const publicKey = options?.publicKey;
    if (!publicKey || !publicKey.challenge) return originalGet(options);
    // The site asked for a phone or a security key by name: that is the browser's ceremony,
    // and stepping in front of it would offer the wrong thing.
    if (wantsAnotherDevice(publicKey)) return originalGet(options);
    // Conditional mediation: the page asks at load and accepts a passkey whenever one is
    // offered. ShardPass offers its own, and hands the request to the browser's UI when it
    // has none or the person declines; the browser's prompt then works as before.
    const conditional = options.mediation === "conditional";
    const reply = await ask(
      "get",
      { ...serializeGet(publicKey), conditional },
      options.signal ?? undefined,
      conditional,
    );
    if ("fallback" in reply) return originalGet(options);
    if ("error" in reply) throw new win.DOMException(reply.error.message, reply.error.name);
    return buildResponse("get", reply.result);
  };
}

if (typeof window !== "undefined") installPasskeyInterceptor(window);
