/// <reference lib="webworker" />

const ITERATIONS = 600_000;
const OUTPUT_BYTES = 32;
const SALT_BYTES = 16;
const MAX_PASSWORD_BYTES = 1024;
const REQUEST_ID = /^[a-f\d]{32}$/u;

export type LegacyKdfRequest = Readonly<{
  password: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
  iterations: number;
  outputBytes: number;
}>;

export async function deriveLegacyPbkdf2(request: LegacyKdfRequest): Promise<Uint8Array> {
  if (
    !(request.password instanceof Uint8Array) ||
    request.password.byteLength > MAX_PASSWORD_BYTES ||
    !(request.salt instanceof Uint8Array) ||
    request.salt.byteLength !== SALT_BYTES ||
    request.iterations !== ITERATIONS ||
    request.outputBytes !== OUTPUT_BYTES
  )
    throw new Error("LEGACY_KDF_FAILED");

  let imported: CryptoKey;
  try {
    imported = await crypto.subtle.importKey("raw", request.password, "PBKDF2", false, [
      "deriveBits",
    ]);
    const result = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: request.salt,
        iterations: ITERATIONS,
      },
      imported,
      OUTPUT_BYTES * 8,
    );
    if (result.byteLength !== OUTPUT_BYTES) throw new Error("LEGACY_KDF_FAILED");
    return new Uint8Array(result);
  } catch {
    throw new Error("LEGACY_KDF_FAILED");
  }
}

type WorkerRequest = Readonly<{
  version: 1;
  kind: "derive";
  requestId: string;
  password: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
  iterations: number;
  outputBytes: number;
}>;

function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<WorkerRequest>;
  return (
    candidate.version === 1 &&
    candidate.kind === "derive" &&
    typeof candidate.requestId === "string" &&
    REQUEST_ID.test(candidate.requestId) &&
    candidate.password instanceof Uint8Array &&
    candidate.salt instanceof Uint8Array &&
    candidate.iterations === ITERATIONS &&
    candidate.outputBytes === OUTPUT_BYTES
  );
}

const workerScope = globalThis as unknown as Partial<DedicatedWorkerGlobalScope>;
if (typeof workerScope.postMessage === "function") {
  let used = false;
  workerScope.onmessage = (event: MessageEvent<unknown>) => {
    if (used) return;
    used = true;
    void (async () => {
      let requestId: string | null = null;
      let password: Uint8Array<ArrayBuffer> | undefined;
      let salt: Uint8Array<ArrayBuffer> | undefined;
      let result: Uint8Array | undefined;
      try {
        if (!isWorkerRequest(event.data)) return;
        requestId = event.data.requestId;
        password = event.data.password;
        salt = event.data.salt;
        result = await deriveLegacyPbkdf2(event.data);
        const transferable = result.buffer.slice(
          result.byteOffset,
          result.byteOffset + result.byteLength,
        ) as ArrayBuffer;
        workerScope.postMessage?.(
          { version: 1, kind: "success", requestId, result: transferable },
          [transferable],
        );
      } catch {
        if (requestId !== null)
          workerScope.postMessage?.({ version: 1, kind: "failure", requestId });
      } finally {
        password?.fill(0);
        salt?.fill(0);
        result?.fill(0);
      }
    })();
  };
}
