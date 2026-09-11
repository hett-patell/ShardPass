/// <reference lib="webworker" />

import { deriveArgon2idDirect } from "./kdf-direct";
import { deriveArgon2idWithSodium, sodiumDerives } from "./kdf-sodium";
import { installKdfWorker } from "./kdf-worker-host";

// libsodium's Argon2id when it can serve the parameters (the ~0.2 s path); the pure-JS
// primitive for other lane counts, or if the WebAssembly module cannot load here.
installKdfWorker(globalThis, async (request) => {
  if (sodiumDerives(request.parameters)) {
    try {
      return await deriveArgon2idWithSodium(request);
    } catch {
      // Fall through to the pure-JS primitive; both compute the same function.
    }
  }
  return deriveArgon2idDirect(request);
});
