/// <reference lib="webworker" />

import { importKeePassKdbx } from "@shardpass/importers";

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
let captured = false;

/**
 * Runs a KDBX import off the main thread. Argon2 at KeePass's default cost (64 MiB, several
 * passes) blocks for long enough to freeze the vault page, and the worker also bounds the
 * lifetime of the master password: the scope is torn down as soon as one import finishes.
 */
workerScope.onmessage = (event: MessageEvent<unknown>) => {
  if (captured) return;
  captured = true;
  const request = event.data as { file?: unknown; password?: unknown };
  void (async () => {
    try {
      if (!(request.file instanceof ArrayBuffer) || typeof request.password !== "string")
        throw new Error("Malformed import request.");
      const result = await importKeePassKdbx(new Uint8Array(request.file), request.password);
      workerScope.postMessage({ ok: true, items: result.items, warnings: result.warnings, folders: result.folders ?? [] });
    } catch (error) {
      workerScope.postMessage({
        ok: false,
        // Only the message survives: it is written for the user, and a stack would carry
        // parser internals into the page for no benefit.
        message: error instanceof Error ? error.message : "The database could not be read.",
      });
    } finally {
      workerScope.close();
    }
  })();
};
