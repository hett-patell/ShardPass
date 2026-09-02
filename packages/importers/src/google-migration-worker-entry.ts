/// <reference lib="webworker" />

import { handleGoogleMigrationWorkerMessage } from "./google-migration-worker-handler";

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
let used = false;

workerScope.onmessage = (event: MessageEvent<unknown>) => {
  if (used) return;
  used = true;
  handleGoogleMigrationWorkerMessage(event.data, {
    postMessage: (message) => workerScope.postMessage(message),
    close: () => workerScope.close(),
  });
};
