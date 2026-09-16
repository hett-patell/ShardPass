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

  const pending = new Map<string, { ack: () => void; settle: (reply: Reply) => void }>();
  win.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== win) return;
    const data = event.data as { tag?: unknown; direction?: unknown; id?: unknown } | null;
    if (data === null || typeof data !== "object" || data.tag !== TAG) return;
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
      const awaitAck = () => {
        ackTimer = win.setTimeout(() => {
          if (acknowledged) return;
          // No content script answered yet. A modal request goes to the browser now; a
          // patient one asks again until the script is there, then gives up quietly.
          if (patient && attempts < PATIENT_ATTEMPTS) {
            post();
            awaitAck();
          } else finish({ fallback: true });
        }, ACK_TIMEOUT_MS);
      };
      if (!patient)
        replyTimer = win.setTimeout(
          () =>
            finish({
              error: { name: "NotAllowedError", message: "The passkey request timed out." },
            }),
          REPLY_TIMEOUT_MS,
        );
      pending.set(id, {
        ack: () => {
          acknowledged = true;
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
            getTransports: () => ["internal", "hybrid"],
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
              transports: ["internal", "hybrid"],
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
