import { safeImportMetadata, type ParsedOtpImport } from "./import-model";
import { decodeGoogleMigrationUriBytes } from "./google-migration-input";
import {
  GOOGLE_MIGRATION_WORKER_VERSION,
  GoogleMigrationWorkerResponseSchema,
  type GoogleMigrationWorkerRequest,
} from "./google-migration-worker-protocol";

export interface GoogleMigrationWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export type GoogleMigrationParseOptions = Readonly<{
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

const DEFAULT_TIMEOUT_MS = 2_000;
// Captured intrinsic: always invoked through Reflect.apply with an explicit receiver.
// eslint-disable-next-line @typescript-eslint/unbound-method
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;

function clearArrayBuffer(buffer: ArrayBuffer): void {
  if (arrayBufferByteLength === undefined) return;
  try {
    const length = Reflect.apply(arrayBufferByteLength, buffer, []) as number;
    if (length > 0) new Uint8Array(buffer).fill(0);
  } catch {
    // Detached or hostile buffers are ignored during best-effort cleanup.
  }
}

function clearBytes(bytes: Uint8Array): void {
  try {
    bytes.fill(0);
  } catch {
    // One cleanup failure cannot prevent settlement.
  }
}

function createBrowserWorker(): GoogleMigrationWorkerLike {
  return new Worker(new URL("./google-migration-worker-entry.ts", import.meta.url), {
    type: "module",
  });
}

function fixedError(reason: "IMPORT_MALFORMED" | "IMPORT_LIMIT_EXCEEDED"): Error {
  return new Error(reason);
}

export function executeGoogleMigrationWorker(
  uris: readonly string[],
  options: GoogleMigrationParseOptions = {},
  workerFactory: () => GoogleMigrationWorkerLike = createBrowserWorker,
): Promise<ParsedOtpImport> {
  let payloads: Uint8Array[];
  try {
    payloads = decodeGoogleMigrationUriBytes(uris);
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : fixedError("IMPORT_MALFORMED"));
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    for (const payload of payloads) payload.fill(0);
    return Promise.reject(fixedError("IMPORT_MALFORMED"));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let worker: GoogleMigrationWorkerLike | null = null;
    let terminate: (() => void) | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let ownedTransfers: readonly ArrayBuffer[] = Object.freeze([]);
    const settleResolve = resolve;
    const settleReject = reject;
    const finish = (outcome: { result?: ParsedOtpImport; error?: Error }): void => {
      if (settled) return;
      settled = true;
      try {
        for (const transfer of ownedTransfers) clearArrayBuffer(transfer);
      } finally {
        try {
          for (const payload of payloads) clearBytes(payload);
        } finally {
          try {
            if (timeout !== null) clearTimeout(timeout);
            try {
              options.signal?.removeEventListener("abort", abort);
            } catch {
              // Cleanup failure never replaces a fixed result.
            }
            if (worker !== null) {
              try {
                worker.onmessage = null;
              } catch {
                // Continue with the remaining cleanup.
              }
              try {
                worker.onerror = null;
              } catch {
                // Continue with the remaining cleanup.
              }
            }
            try {
              terminate?.();
            } catch {
              // Cleanup failure never replaces a fixed result.
            }
          } finally {
            if (outcome.error !== undefined) settleReject(outcome.error);
            else settleResolve(outcome.result!);
          }
        }
      }
    };
    const abort = () => finish({ error: fixedError("IMPORT_MALFORMED") });

    try {
      if (options.signal?.aborted === true) {
        finish({ error: fixedError("IMPORT_MALFORMED") });
        return;
      }
      const candidate = workerFactory();
      if (typeof candidate !== "object" || candidate === null)
        throw new TypeError("invalid worker");
      const capturedTerminate = Reflect.get(candidate, "terminate");
      if (typeof capturedTerminate !== "function") throw new TypeError("invalid worker");
      terminate = () => Reflect.apply(capturedTerminate, candidate, []);
      const capturedPostMessage = Reflect.get(candidate, "postMessage");
      if (typeof capturedPostMessage !== "function") throw new TypeError("invalid worker");
      worker = candidate;
      options.signal?.addEventListener("abort", abort, { once: true });
      const requestId = crypto.randomUUID().replaceAll("-", "");
      timeout = setTimeout(() => finish({ error: fixedError("IMPORT_LIMIT_EXCEEDED") }), timeoutMs);
      worker.onerror = () => finish({ error: fixedError("IMPORT_MALFORMED") });
      worker.onmessage = (event) => {
        const parsed = GoogleMigrationWorkerResponseSchema.safeParse(event.data);
        if (!parsed.success || parsed.data.requestId !== requestId) {
          finish({ error: fixedError("IMPORT_MALFORMED") });
          return;
        }
        if (parsed.data.kind === "failure") {
          finish({ error: new Error(parsed.data.reason) });
          return;
        }
        if (parsed.data.result.candidates.length + parsed.data.result.rejected.length > 1_000) {
          finish({ error: fixedError("IMPORT_LIMIT_EXCEEDED") });
          return;
        }
        try {
          const result: ParsedOtpImport = Object.freeze({
            format: "google-migration",
            candidates: Object.freeze(
              parsed.data.result.candidates.map((candidateResult) => {
                const candidate = Object.freeze({
                  ...(candidateResult.sourceOrdinal === undefined
                    ? {}
                    : { sourceOrdinal: candidateResult.sourceOrdinal }),
                  issuer: candidateResult.issuer,
                  label: candidateResult.label,
                  secret: candidateResult.secret,
                  otpType: candidateResult.otpType,
                  algorithm: candidateResult.algorithm,
                  digits: candidateResult.digits,
                  period: candidateResult.period,
                  ...(candidateResult.counter === undefined
                    ? {}
                    : { counter: candidateResult.counter }),
                  favorite: false,
                  tags: Object.freeze([]),
                  note: "",
                });
                const normalized =
                  candidate.counter === undefined
                    ? Object.freeze({
                        ...(candidate.sourceOrdinal === undefined
                          ? {}
                          : { sourceOrdinal: candidate.sourceOrdinal }),
                        issuer: candidate.issuer,
                        label: candidate.label,
                        secret: candidate.secret,
                        otpType: candidate.otpType,
                        algorithm: candidate.algorithm,
                        digits: candidate.digits,
                        period: candidate.period,
                        favorite: false,
                        tags: Object.freeze([]),
                        note: "",
                      })
                    : candidate;
                safeImportMetadata(normalized);
                return normalized;
              }),
            ),
            rejected: Object.freeze(
              parsed.data.result.rejected.map((row) => Object.freeze({ ...row })),
            ),
          });
          finish({ result });
        } catch {
          finish({ error: fixedError("IMPORT_MALFORMED") });
        }
      };
      ownedTransfers = Object.freeze(
        payloads.map((payload) =>
          payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
        ) as ArrayBuffer[],
      );
      const requestPayloads = [...ownedTransfers];
      const transferList = [...ownedTransfers];
      const request: GoogleMigrationWorkerRequest = {
        version: GOOGLE_MIGRATION_WORKER_VERSION,
        kind: "decode",
        requestId,
        payloads: requestPayloads,
      };
      Reflect.apply(capturedPostMessage, candidate, [request, transferList]);
      for (const payload of payloads) clearBytes(payload);
    } catch {
      finish({ error: fixedError("IMPORT_MALFORMED") });
    }
  });
}
