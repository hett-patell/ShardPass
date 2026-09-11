import type { KdfRequestData } from "./kdf";
import { KDF_WORKER_PROTOCOL_VERSION, parseWorkerRequest } from "./kdf-worker-protocol";

export type KdfWorkerScope = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

export type KdfDerive = (request: KdfRequestData) => Uint8Array | Promise<Uint8Array>;

/**
 * Serves exactly one derivation on a dedicated worker: "started" as soon as the request
 * parses, then "success" with the key transferred out, or "failure" with nothing else said.
 */
export function installKdfWorker(scope: KdfWorkerScope, derive: KdfDerive): void {
  let used = false;
  scope.onmessage = (event: MessageEvent<unknown>) => {
    if (used) return;
    used = true;
    let requestId: string | null = null;
    const fail = (): void => {
      if (requestId !== null) {
        scope.postMessage({ version: KDF_WORKER_PROTOCOL_VERSION, kind: "failure", requestId });
      }
    };
    try {
      const request = parseWorkerRequest(event.data);
      requestId = request.requestId;
      scope.postMessage({ version: KDF_WORKER_PROTOCOL_VERSION, kind: "started", requestId });
      Promise.resolve()
        .then(() => derive(request))
        .then((result) => {
          const transferable = result.buffer.slice(
            result.byteOffset,
            result.byteOffset + result.byteLength,
          ) as ArrayBuffer;
          result.fill(0);
          scope.postMessage(
            {
              version: KDF_WORKER_PROTOCOL_VERSION,
              kind: "success",
              requestId,
              result: transferable,
            },
            [transferable],
          );
        }, fail);
    } catch {
      fail();
    }
  };
}
