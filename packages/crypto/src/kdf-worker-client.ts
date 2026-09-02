import { KEY_ENCRYPTION_KEY_BYTES, type KdfExecutor } from "./kdf";
import {
  KDF_WORKER_PROTOCOL_VERSION,
  KdfWorkerResponseSchema,
  type KdfWorkerRequest,
} from "./kdf-worker-protocol";

export interface KdfWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export type KdfWorkerFactory = () => unknown;

export function createBrowserKdfWorker(): Worker {
  return new Worker(new URL("./kdf-worker-entry.ts", import.meta.url), { type: "module" });
}

const executionFailed = () => new Error("KDF_EXECUTION_FAILED");
const cancelled = () => new Error("KDF_CANCELLED");
const timedOut = () => new Error("KDF worker timed out.");

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function ownedBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(value.byteLength);
  const copy = new Uint8Array(buffer);
  copy.set(value);
  return copy;
}

export function createWorkerKdfExecutor(
  workerFactory: KdfWorkerFactory = createBrowserKdfWorker,
  options: Readonly<{ timeoutMs?: number }> = {},
): KdfExecutor {
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) {
    throw new RangeError("KDF worker timeout is invalid.");
  }
  return {
    derive(request) {
      if (isAborted(request.signal)) return Promise.reject(cancelled());
      return new Promise<Uint8Array>((resolve, reject) => {
        let worker: KdfWorkerLike | null = null;
        let terminate: (() => void) | null = null;
        let terminationAttempted = false;
        let timeout: ReturnType<typeof setTimeout> | null = null;
        let abort: (() => void) | null = null;
        let settled = false;

        const safeTerminate = (): void => {
          if (terminationAttempted || terminate === null) return;
          terminationAttempted = true;
          try {
            terminate();
          } catch {
            // Cleanup failures never replace the sanitized operation outcome.
          }
        };
        const finish = (outcome: Readonly<{ result?: Uint8Array; error?: Error }>): void => {
          if (settled) return;
          settled = true;
          if (timeout !== null) {
            try {
              clearTimeout(timeout);
            } catch {
              // Ignore cleanup failure.
            }
          }
          if (abort !== null) {
            try {
              request.signal?.removeEventListener("abort", abort);
            } catch {
              // Ignore cleanup failure.
            }
          }
          if (worker !== null) {
            try {
              worker.onmessage = null;
            } catch {
              // Ignore cleanup failure.
            }
            try {
              worker.onerror = null;
            } catch {
              // Ignore cleanup failure.
            }
          }
          safeTerminate();
          if (outcome.error !== undefined) reject(outcome.error);
          else resolve(outcome.result as Uint8Array);
        };

        abort = () => finish({ error: cancelled() });
        try {
          request.signal?.addEventListener("abort", abort, { once: true });
        } catch {
          finish({ error: executionFailed() });
          return;
        }
        if (isAborted(request.signal)) {
          finish({ error: cancelled() });
          return;
        }

        let candidate: unknown;
        try {
          candidate = workerFactory();
        } catch {
          finish({ error: executionFailed() });
          return;
        }
        if (typeof candidate !== "object" || candidate === null) {
          finish({ error: executionFailed() });
          return;
        }
        let capturedTerminate: unknown;
        try {
          capturedTerminate = Reflect.get(candidate, "terminate");
        } catch {
          finish({ error: executionFailed() });
          return;
        }
        if (typeof capturedTerminate !== "function") {
          finish({ error: executionFailed() });
          return;
        }
        terminate = () => {
          Reflect.apply(capturedTerminate, candidate, []);
        };
        let capturedPostMessage: unknown;
        try {
          capturedPostMessage = Reflect.get(candidate, "postMessage");
        } catch {
          finish({ error: executionFailed() });
          return;
        }
        if (typeof capturedPostMessage !== "function") {
          finish({ error: executionFailed() });
          return;
        }
        worker = candidate as KdfWorkerLike;
        if (settled || isAborted(request.signal)) {
          if (!settled) finish({ error: cancelled() });
          else safeTerminate();
          return;
        }

        try {
          const requestId = crypto.randomUUID().replaceAll("-", "");
          timeout = setTimeout(() => finish({ error: timedOut() }), timeoutMs);
          worker.onerror = () => finish({ error: executionFailed() });
          worker.onmessage = (event) => {
            const parsed = KdfWorkerResponseSchema.safeParse(event.data);
            if (!parsed.success || parsed.data.requestId !== requestId) {
              finish({ error: executionFailed() });
              return;
            }
            if (parsed.data.kind === "started") {
              request.onStarted?.();
              return;
            }
            if (
              parsed.data.kind === "failure" ||
              parsed.data.result.byteLength !== KEY_ENCRYPTION_KEY_BYTES
            ) {
              finish({ error: executionFailed() });
              return;
            }
            finish({ result: new Uint8Array(parsed.data.result) });
          };
          const privateCopies = {
            password: ownedBytes(request.password),
            salt: ownedBytes(request.salt),
          };
          const message: KdfWorkerRequest = {
            version: KDF_WORKER_PROTOCOL_VERSION,
            kind: "derive",
            requestId,
            password: privateCopies.password,
            salt: privateCopies.salt,
            parameters: request.parameters,
          };
          Reflect.apply(capturedPostMessage, candidate, [
            message,
            [privateCopies.password.buffer, privateCopies.salt.buffer],
          ]);
        } catch {
          finish({ error: executionFailed() });
        }
      });
    },
  };
}
