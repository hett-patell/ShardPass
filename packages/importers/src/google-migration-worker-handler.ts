import { decodeGoogleMigrationPayloads } from "./google-migration-decoder";
import {
  GOOGLE_MIGRATION_WORKER_VERSION,
  parseGoogleMigrationWorkerRequest,
} from "./google-migration-worker-protocol";
import { IMPORT_LIMITS } from "./import-model";

type WorkerHandlerPort = Readonly<{
  postMessage(message: unknown): void;
  close(): void;
}>;

type ClearBuffer = (buffer: ArrayBuffer) => void;

// The captured intrinsic is invoked only through Reflect.apply with an explicit receiver.
// eslint-disable-next-line @typescript-eslint/unbound-method
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;

function arrayBufferLength(value: unknown): number | null {
  if (arrayBufferByteLength === undefined) return null;
  try {
    return Reflect.apply(arrayBufferByteLength, value, []) as number;
  } catch {
    return null;
  }
}

const clearBuffer: ClearBuffer = (buffer) => {
  const byteLength = arrayBufferLength(buffer);
  if (byteLength !== null && byteLength > 0) new Uint8Array(buffer).fill(0);
};

const EXPECTED_REQUEST_KEYS = Object.freeze(["version", "kind", "requestId", "payloads"] as const);

type RequestSnapshot = Readonly<{
  input: Readonly<Record<string, unknown>>;
  payloads: readonly ArrayBuffer[];
}>;

function snapshotRequest(value: unknown, retained: ArrayBuffer[]): RequestSnapshot {
  if (typeof value !== "object" || value === null) throw new TypeError("IMPORT_MALFORMED");
  let ownKeys: readonly PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError("IMPORT_MALFORMED");
  }
  let valid =
    ownKeys.length === EXPECTED_REQUEST_KEYS.length &&
    EXPECTED_REQUEST_KEYS.every((key) => ownKeys.includes(key));
  const captured = Object.create(null) as Record<string, unknown>;
  for (const key of ["payloads", "version", "kind", "requestId"] as const) {
    if (!ownKeys.includes(key)) {
      valid = false;
      continue;
    }
    try {
      captured[key] = Reflect.get(value, key);
    } catch {
      valid = false;
    }
  }
  if (typeof captured.requestId !== "string" || captured.requestId.length > 64) valid = false;
  let isArray = false;
  try {
    isArray = Array.isArray(captured.payloads);
  } catch {
    valid = false;
  }
  if (!isArray || captured.payloads === null) valid = false;
  let length: unknown;
  if (isArray && captured.payloads !== null) {
    try {
      length = Reflect.get(captured.payloads as object, "length");
    } catch {
      valid = false;
    }
  }
  if (
    !Number.isSafeInteger(length) ||
    (length as number) < 1 ||
    (length as number) > IMPORT_LIMITS.maxMigrationBatches + 1
  )
    valid = false;
  const boundedLength =
    Number.isSafeInteger(length) &&
    (length as number) >= 0 &&
    (length as number) <= IMPORT_LIMITS.maxMigrationBatches + 1
      ? (length as number)
      : 0;
  const payloads: ArrayBuffer[] = [];
  for (let index = 0; index < boundedLength; index += 1) {
    let entry: unknown;
    try {
      if (!Object.prototype.hasOwnProperty.call(captured.payloads, index)) {
        valid = false;
        continue;
      }
      entry = Reflect.get(captured.payloads as object, index);
    } catch {
      valid = false;
      continue;
    }
    if (arrayBufferLength(entry) === null) {
      valid = false;
      continue;
    }
    retained.push(entry as ArrayBuffer);
    payloads.push(entry as ArrayBuffer);
  }
  if (!valid) throw new TypeError("IMPORT_MALFORMED");
  const densePayloads = Object.freeze([...payloads]);
  return Object.freeze({
    input: Object.freeze({
      version: captured.version,
      kind: captured.kind,
      requestId: captured.requestId,
      payloads: densePayloads,
    }),
    payloads: densePayloads,
  });
}

function clearAll(buffers: readonly ArrayBuffer[], clear: ClearBuffer): void {
  for (const buffer of buffers) {
    try {
      clear(buffer);
    } catch {
      // One failed clear cannot prevent cleanup of the remaining buffers.
    }
  }
}

export function handleGoogleMigrationWorkerMessage(
  data: unknown,
  port: WorkerHandlerPort,
  clear: ClearBuffer = clearBuffer,
): void {
  const collected: ArrayBuffer[] = [];
  let parsedBuffers: ArrayBuffer[] = [];
  let requestId: string | null = null;
  try {
    const snapshot = snapshotRequest(data, collected);
    const request = parseGoogleMigrationWorkerRequest(snapshot.input);
    requestId = request.requestId;
    parsedBuffers = [...request.payloads];
    const result = decodeGoogleMigrationPayloads(
      request.payloads.map((payload) => new Uint8Array(payload)),
    );
    port.postMessage({
      version: GOOGLE_MIGRATION_WORKER_VERSION,
      kind: "success",
      requestId,
      result,
    });
  } catch (error) {
    if (requestId !== null) {
      const reason =
        error instanceof Error &&
        (error.message === "IMPORT_UNSUPPORTED" || error.message === "IMPORT_LIMIT_EXCEEDED")
          ? error.message
          : "IMPORT_MALFORMED";
      try {
        port.postMessage({
          version: GOOGLE_MIGRATION_WORKER_VERSION,
          kind: "failure",
          requestId,
          reason,
        });
      } catch {
        // A failed response cannot prevent cleanup and close.
      }
    }
  } finally {
    try {
      clearAll(collected, clear);
      clearAll(parsedBuffers, clear);
    } finally {
      try {
        port.close();
      } catch {
        // Close failure cannot escape the worker handler.
      }
    }
  }
}
