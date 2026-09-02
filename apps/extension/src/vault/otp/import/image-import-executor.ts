import {
  IMAGE_IMPORT_TIMEOUT_MS,
  IMPORT_LIMITS,
  parseImageImportWorkerResponse,
  type ImageImportWorkerFailureCode,
} from "@shardpass/importers/qr-worker-protocol";

export interface ImageImportWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}
export type ImageImportExecutor = Readonly<{
  decode(file: Blob, signal: AbortSignal): Promise<string>;
}>;

// Captured intrinsics are invoked only with explicit receivers through Reflect.apply.
// eslint-disable-next-line @typescript-eslint/unbound-method
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
// eslint-disable-next-line @typescript-eslint/unbound-method
const blobSize = Object.getOwnPropertyDescriptor(Blob.prototype, "size")?.get;
// eslint-disable-next-line @typescript-eslint/unbound-method
const blobArrayBuffer = Blob.prototype.arrayBuffer;

function clearBuffer(buffer: ArrayBuffer): void {
  if (arrayBufferByteLength === undefined) return;
  try {
    const length = Reflect.apply(arrayBufferByteLength, buffer, []) as number;
    if (length > 0) new Uint8Array(buffer).fill(0);
  } catch {
    // Detached buffers and hostile cleanup are best effort.
  }
}
function fixedError(code: ImageImportWorkerFailureCode = "IMAGE_INVALID"): Error {
  return new Error(code);
}
function createBrowserWorker(): ImageImportWorkerLike {
  return new Worker(new URL("./otp-import-worker.ts", import.meta.url), { type: "module" });
}

export function createImageImportExecutor(
  workerFactory: () => ImageImportWorkerLike = createBrowserWorker,
  options: Readonly<{ timeoutMs?: number; readBlob?: (blob: Blob) => Promise<ArrayBuffer> }> = {},
): ImageImportExecutor {
  const timeoutMs = options.timeoutMs ?? IMAGE_IMPORT_TIMEOUT_MS;
  const readBlob = options.readBlob ?? ((blob: Blob) => Reflect.apply(blobArrayBuffer, blob, []));
  return Object.freeze({
    decode(file: Blob, signal: AbortSignal): Promise<string> {
      let size: number;
      try {
        if (blobSize === undefined) throw fixedError();
        size = Reflect.apply(blobSize, file, []) as number;
      } catch {
        return Promise.reject(fixedError());
      }
      if (!Number.isSafeInteger(size) || size < 1) return Promise.reject(fixedError());
      if (size > IMPORT_LIMITS.maxImageBytes) return Promise.reject(fixedError("IMAGE_LIMIT"));
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > IMAGE_IMPORT_TIMEOUT_MS)
        return Promise.reject(fixedError());
      if (signal.aborted) return Promise.reject(fixedError());

      return new Promise((resolve, reject) => {
        let settled = false;
        let readFinished = false;
        let worker: ImageImportWorkerLike | null = null;
        let terminate: (() => void) | null = null;
        let loaded: ArrayBuffer | null = null;
        let transfer: ArrayBuffer | null = null;
        const finish = (payload?: string, error?: Error): void => {
          if (settled) return;
          settled = true;
          if (loaded !== null) clearBuffer(loaded);
          if (transfer !== null) clearBuffer(transfer);
          loaded = null;
          transfer = null;
          clearTimeout(timeout);
          try {
            signal.removeEventListener("abort", abort);
          } catch {
            // Cleanup cannot replace a fixed result.
          }
          if (worker !== null) {
            try {
              worker.onmessage = null;
              worker.onerror = null;
            } catch {
              // Continue cleanup.
            }
          }
          try {
            terminate?.();
          } catch {
            // Termination cannot replace a fixed result.
          }
          if (error !== undefined) reject(error);
          else resolve(payload!);
        };
        const abort = () => finish(undefined, fixedError());
        signal.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(() => finish(undefined, fixedError()), timeoutMs);

        let read: Promise<ArrayBuffer>;
        try {
          read = readBlob(file);
          file = new Blob();
        } catch {
          finish(undefined, fixedError());
          return;
        }
        void read.then(
          (buffer) => {
            readFinished = true;
            if (settled) {
              clearBuffer(buffer);
              return;
            }
            loaded = buffer;
            if (buffer.byteLength !== size) {
              finish(undefined, fixedError());
              return;
            }
            try {
              const candidate = workerFactory();
              if (typeof candidate !== "object" || candidate === null) throw fixedError();
              const capturedTerminate = Reflect.get(candidate, "terminate");
              const capturedPostMessage = Reflect.get(candidate, "postMessage");
              if (
                typeof capturedTerminate !== "function" ||
                typeof capturedPostMessage !== "function"
              )
                throw fixedError();
              worker = candidate;
              terminate = () => Reflect.apply(capturedTerminate, candidate, []);
              const requestId = crypto.randomUUID().replaceAll("-", "");
              worker.onerror = () => finish(undefined, fixedError());
              worker.onmessage = (event) => {
                let response;
                try {
                  response = parseImageImportWorkerResponse(event.data);
                } catch {
                  finish(undefined, fixedError());
                  return;
                }
                if (response.requestId !== requestId) {
                  finish(undefined, fixedError());
                  return;
                }
                if (response.kind === "failed") finish(undefined, fixedError(response.code));
                else finish(response.payload);
              };
              transfer = buffer.slice(0);
              const owned = transfer;
              Reflect.apply(capturedPostMessage, candidate, [
                { version: 1, requestId, bytes: owned },
                [owned],
              ]);
              clearBuffer(owned);
              clearBuffer(buffer);
            } catch {
              finish(undefined, fixedError());
            }
          },
          () => {
            readFinished = true;
            finish(undefined, fixedError());
          },
        );
        void readFinished;
      });
    },
  });
}
