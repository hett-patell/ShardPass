import { describe, expect, it, vi } from "vitest";

import { installKdfWorker, type KdfWorkerScope } from "../src/kdf-worker-host";

const requestId = "0123456789abcdef0123456789abcdef";
const owned = (values: number[]): Uint8Array<ArrayBuffer> => Uint8Array.from(values);
const derive = () => ({
  version: 1,
  kind: "derive",
  requestId,
  password: owned([1, 2, 3]),
  salt: owned(Array.from({ length: 16 }, (_, index) => index)),
  parameters: { algorithm: "argon2id", memoryKiB: 8_192, iterations: 1, parallelism: 1 },
});

function scope(): KdfWorkerScope & { posted: unknown[][] } {
  const posted: unknown[][] = [];
  return {
    onmessage: null,
    posted,
    postMessage(message: unknown, transfer?: Transferable[]) {
      posted.push([message, transfer]);
    },
  };
}

const deliver = (host: KdfWorkerScope, data: unknown) =>
  host.onmessage?.({ data } as MessageEvent<unknown>);
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("KDF worker host", () => {
  it("answers started, then success with the key transferred out and the source wiped", async () => {
    const host = scope();
    const key = owned(Array.from({ length: 32 }, (_, index) => 32 - index));
    installKdfWorker(host, () => Promise.resolve(key));
    deliver(host, derive());
    await settled();
    expect(host.posted).toHaveLength(2);
    expect(host.posted[0]?.[0]).toEqual({ version: 1, kind: "started", requestId });
    const [success, transfer] = host.posted[1] as [
      { kind: string; result: ArrayBuffer },
      Transferable[],
    ];
    expect(success.kind).toBe("success");
    expect(Array.from(new Uint8Array(success.result))[0]).toBe(32);
    expect(transfer).toEqual([success.result]);
    expect(Array.from(key).every((byte) => byte === 0)).toBe(true);
  });

  it("reports failure after started when deriving throws, synchronously or later", async () => {
    for (const failing of [
      () => {
        throw new Error("boom");
      },
      () => Promise.reject(new Error("boom")),
    ]) {
      const host = scope();
      installKdfWorker(host, failing);
      deliver(host, derive());
      await settled();
      expect(host.posted.map(([message]) => (message as { kind: string }).kind)).toEqual([
        "started",
        "failure",
      ]);
    }
  });

  it("says nothing about a request it cannot parse, and serves one request only", async () => {
    const host = scope();
    const run = vi.fn(() => owned(Array.from({ length: 32 }, () => 7)));
    installKdfWorker(host, run);
    deliver(host, { version: 1, kind: "derive", requestId: "short" });
    await settled();
    expect(host.posted).toEqual([]);
    deliver(host, derive());
    await settled();
    expect(run).not.toHaveBeenCalled();
  });
});
