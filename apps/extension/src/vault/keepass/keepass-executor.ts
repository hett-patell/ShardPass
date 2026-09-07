import { VaultItemSchema, type VaultItem } from "@shardpass/domain";
import type { ImportFolder } from "@shardpass/importers";

export type KeePassImportOutcome = Readonly<{
  items: readonly VaultItem[];
  warnings: readonly string[];
  folders: readonly ImportFolder[];
}>;

/** Wall-clock ceiling: a wrong-but-huge KDF parameter must not hang the dialog forever. */
const IMPORT_TIMEOUT_MS = 120_000;

function createWorker(): Worker {
  return new Worker(new URL("./keepass-worker.ts", import.meta.url), { type: "module" });
}

/**
 * Decrypts a KeePass database in a worker.
 *
 * The password is handed over once and the worker closes itself when done, so it is not
 * retained anywhere on the page. The file is transferred rather than copied, which also
 * detaches the caller's buffer.
 */
export function runKeePassImport(file: ArrayBuffer, password: string): Promise<KeePassImportOutcome> {
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      action();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error("The database took too long to open."))),
      IMPORT_TIMEOUT_MS,
    );

    worker.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data as {
        ok?: unknown;
        items?: unknown;
        warnings?: unknown;
        folders?: unknown;
        message?: unknown;
      };
      if (message.ok !== true) {
        const reason = typeof message.message === "string" ? message.message : "The database could not be read.";
        finish(() => reject(new Error(reason)));
        return;
      }
      // Re-validated on the way back in: the worker is same-origin, but items cross a
      // structured-clone boundary and everything downstream assumes valid vault items.
      const items: VaultItem[] = [];
      for (const candidate of Array.isArray(message.items) ? message.items : []) {
        const parsed = VaultItemSchema.safeParse(candidate);
        if (parsed.success) items.push(parsed.data);
      }
      const warnings = (Array.isArray(message.warnings) ? message.warnings : []).filter(
        (warning): warning is string => typeof warning === "string",
      );
      const folders: ImportFolder[] = [];
      for (const candidate of Array.isArray(message.folders) ? message.folders : []) {
        const folder = candidate as { id?: unknown; name?: unknown; parentId?: unknown };
        if (typeof folder.id !== "string" || typeof folder.name !== "string") continue;
        folders.push({
          id: folder.id,
          name: folder.name,
          ...(typeof folder.parentId === "string" ? { parentId: folder.parentId } : {}),
        });
      }
      finish(() => resolve({ items, warnings, folders }));
    };
    worker.onerror = () => finish(() => reject(new Error("The database could not be read.")));

    worker.postMessage({ file, password }, [file]);
  });
}
