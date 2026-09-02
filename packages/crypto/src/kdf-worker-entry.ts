/// <reference lib="webworker" />

import { deriveArgon2idDirect } from "./kdf-direct";
import { KDF_WORKER_PROTOCOL_VERSION, parseWorkerRequest } from "./kdf-worker-protocol";

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
let used = false;

workerScope.onmessage = (event: MessageEvent<unknown>) => {
  if (used) return;
  used = true;
  let requestId: string | null = null;
  try {
    const request = parseWorkerRequest(event.data);
    requestId = request.requestId;
    workerScope.postMessage({
      version: KDF_WORKER_PROTOCOL_VERSION,
      kind: "started",
      requestId,
    });
    const result = deriveArgon2idDirect(request);
    const transferable = result.buffer.slice(
      result.byteOffset,
      result.byteOffset + result.byteLength,
    ) as ArrayBuffer;
    workerScope.postMessage(
      { version: KDF_WORKER_PROTOCOL_VERSION, kind: "success", requestId, result: transferable },
      [transferable],
    );
  } catch {
    if (requestId !== null) {
      workerScope.postMessage({
        version: KDF_WORKER_PROTOCOL_VERSION,
        kind: "failure",
        requestId,
      });
    }
  }
};
