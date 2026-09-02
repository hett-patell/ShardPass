/// <reference lib="webworker" />

import { handleImageImportWorkerMessage } from "./otp-import-worker-handler";

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
let captured = false;

workerScope.onmessage = (event: MessageEvent<unknown>) => {
  if (captured) return;
  captured = true;
  void handleImageImportWorkerMessage(event.data, {
    postMessage: (message) => workerScope.postMessage(message),
    close: () => workerScope.close(),
  });
};
