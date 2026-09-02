export interface LegacyKdfWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export type LegacyKdfDeriveRequest = Readonly<{
  password: Uint8Array;
  salt: Uint8Array;
  iterations: 600_000;
  outputBytes: 32;
  signal?: AbortSignal;
}>;

export type LegacyKdfExecutor = Readonly<{
  derive(request: LegacyKdfDeriveRequest): Promise<Uint8Array>;
}>;

function createBrowserWorker(): Worker {
  return new Worker(new URL("./legacy-kdf-worker.ts", import.meta.url), { type: "module" });
}

export function createLegacyKdfExecutor(
  workerFactory: () => LegacyKdfWorkerLike = createBrowserWorker,
  options: Readonly<{ timeoutMs?: number }> = {},
): LegacyKdfExecutor {
  const timeoutMs = options.timeoutMs ?? 60_000;
  return {
    derive(request) {
      return new Promise((resolve, reject) => {
        let settled = false;
        let worker: LegacyKdfWorkerLike | undefined;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const abort = () => finish(undefined, new Error("LEGACY_KDF_CANCELLED"));
        const finish = (result?: Uint8Array, error?: Error) => {
          if (settled) return;
          settled = true;
          if (timeout !== undefined) clearTimeout(timeout);
          try {
            request.signal?.removeEventListener("abort", abort);
          } catch {
            // Cleanup failure does not replace the bounded result.
          }
          if (worker !== undefined) {
            try {
              worker.onmessage = null;
              worker.onerror = null;
            } catch {
              // Cleanup failure does not replace the bounded result.
            }
            try {
              worker.terminate();
            } catch {
              // Cleanup failure does not replace the bounded result.
            }
          }
          if (error !== undefined) reject(error);
          else resolve(result as Uint8Array);
        };

        try {
          request.signal?.addEventListener("abort", abort, { once: true });
          if (request.signal?.aborted === true) {
            finish(undefined, new Error("LEGACY_KDF_CANCELLED"));
            return;
          }
          worker = workerFactory();
          if (
            typeof worker !== "object" ||
            worker === null ||
            typeof worker.postMessage !== "function" ||
            typeof worker.terminate !== "function"
          ) {
            finish(undefined, new Error("LEGACY_KDF_FAILED"));
            return;
          }
          const requestId = crypto.randomUUID().replaceAll("-", "");
          timeout = setTimeout(() => finish(undefined, new Error("LEGACY_KDF_FAILED")), timeoutMs);
          worker.onerror = () => finish(undefined, new Error("LEGACY_KDF_FAILED"));
          worker.onmessage = (event) => {
            const candidate = event.data as {
              version?: unknown;
              kind?: unknown;
              requestId?: unknown;
              result?: unknown;
            };
            if (
              typeof candidate !== "object" ||
              candidate === null ||
              candidate.version !== 1 ||
              candidate.requestId !== requestId
            ) {
              finish(undefined, new Error("LEGACY_KDF_FAILED"));
              return;
            }
            if (candidate.kind === "failure") {
              finish(undefined, new Error("LEGACY_KDF_FAILED"));
              return;
            }
            if (
              candidate.kind !== "success" ||
              !(candidate.result instanceof ArrayBuffer) ||
              candidate.result.byteLength !== 32
            ) {
              finish(undefined, new Error("LEGACY_KDF_FAILED"));
              return;
            }
            finish(new Uint8Array(candidate.result));
          };
          const password = request.password.slice();
          const salt = request.salt.slice();
          worker.postMessage(
            {
              version: 1,
              kind: "derive",
              requestId,
              password,
              salt,
              iterations: request.iterations,
              outputBytes: request.outputBytes,
            },
            [password.buffer, salt.buffer],
          );
        } catch {
          finish(undefined, new Error("LEGACY_KDF_FAILED"));
        }
      });
    },
  };
}
