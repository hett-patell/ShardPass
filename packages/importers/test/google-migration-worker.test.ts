import { describe, expect, it, vi } from "vitest";

import { parseGoogleMigrationUri, parseGoogleMigrationUris } from "../src";
import {
  executeGoogleMigrationWorker,
  type GoogleMigrationWorkerLike,
} from "../src/google-migration-worker-client";
import { handleGoogleMigrationWorkerMessage } from "../src/google-migration-worker-handler";
import { decodeGoogleMigrationUriBytes } from "../src/google-migration-input";

const CANONICAL_HEX =
  "0a2c0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c652001280130021001180120002807";

function uri(hex = CANONICAL_HEX): string {
  return `otpauth-migration://offline?data=${encodeURIComponent(Buffer.from(hex, "hex").toString("base64"))}`;
}

class FakeWorker implements GoogleMigrationWorkerLike {
  readonly posted: Array<{ message: unknown; transfer: Transferable[] }> = [];
  terminateCalls = 0;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    this.posted.push({ message, transfer });
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

  respond(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

function success(requestId: string): unknown {
  return {
    version: 1,
    kind: "success",
    requestId,
    result: {
      format: "google-migration",
      candidates: [
        {
          issuer: "Example",
          label: "alice",
          secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
          otpType: "totp",
          algorithm: "SHA1",
          digits: 6,
          period: 30,
          favorite: false,
          tags: [],
          note: "",
        },
      ],
      rejected: [],
    },
  };
}

describe("Google migration worker boundary", () => {
  it("rejects cumulative decoded overflow before any Base64 decode or Worker creation", async () => {
    const halfPlusOne = Math.floor(1_048_576 / 2) + 1;
    const data = Buffer.alloc(halfPlusOne, 1).toString("base64");
    const uris = [
      `otpauth-migration://offline?data=${encodeURIComponent(data)}`,
      `otpauth-migration://offline?data=${encodeURIComponent(data)}`,
    ];
    const decode = vi.fn(() => new Uint8Array());
    const workerFactory = vi.fn(() => new FakeWorker());

    expect(() => decodeGoogleMigrationUriBytes(uris, decode)).toThrow(/^IMPORT_LIMIT_EXCEEDED$/u);
    expect(decode).not.toHaveBeenCalled();
    await expect(executeGoogleMigrationWorker(uris, {}, workerFactory)).rejects.toThrow(
      /^IMPORT_LIMIT_EXCEEDED$/u,
    );
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("accepts the exact cumulative decoded-byte boundary in a two-pass decode", () => {
    const half = 1_048_576 / 2;
    const data = Buffer.alloc(half, 2).toString("base64");
    const uris = [
      `otpauth-migration://offline?data=${encodeURIComponent(data)}`,
      `otpauth-migration://offline?data=${encodeURIComponent(data)}`,
    ];
    const decode = vi.fn((canonical: string, decodedLength: number) => {
      expect(canonical.length).toBeGreaterThan(0);
      return new Uint8Array(decodedLength);
    });
    const payloads = decodeGoogleMigrationUriBytes(uris, decode);
    expect(decode).toHaveBeenCalledTimes(2);
    expect(payloads.reduce((total, payload) => total + payload.byteLength, 0)).toBe(1_048_576);
  });

  it("exports only Promise-based planned parser names", () => {
    const worker = new FakeWorker();
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          return worker;
        }
      },
    );
    try {
      const pending = parseGoogleMigrationUri(uri());
      expect(pending).toBeInstanceOf(Promise);
      const request = worker.posted[0]?.message as { requestId: string };
      worker.respond(success(request.requestId));
      return expect(pending).resolves.toMatchObject({ format: "google-migration" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("copies and transfers bounded bytes, captures methods once, and terminates after one response", async () => {
    const worker = new FakeWorker();
    let postReads = 0;
    let terminateReads = 0;
    const guarded = {
      get postMessage() {
        postReads += 1;
        return worker.postMessage.bind(worker);
      },
      get terminate() {
        terminateReads += 1;
        return worker.terminate.bind(worker);
      },
      get onmessage() {
        return worker.onmessage;
      },
      set onmessage(value) {
        worker.onmessage = value;
      },
      get onerror() {
        return worker.onerror;
      },
      set onerror(value) {
        worker.onerror = value;
      },
    } satisfies GoogleMigrationWorkerLike;
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          return guarded;
        }
      },
    );
    try {
      const pending = parseGoogleMigrationUris([uri()]);
      const posted = worker.posted[0]!;
      const request = posted.message as { requestId: string; payloads: ArrayBuffer[] };
      expect(posted.transfer).toEqual(request.payloads);
      expect(request.payloads[0]?.byteLength).toBeGreaterThan(0);
      worker.respond(success(request.requestId));
      await expect(pending).resolves.toMatchObject({ candidates: [{ label: "alice" }] });
      expect(postReads).toBe(1);
      expect(terminateReads).toBe(1);
      expect(worker.terminateCalls).toBe(1);
      expect(worker.onmessage).toBeNull();
      expect(worker.onerror).toBeNull();
      worker.respond({ version: 1, kind: "failure", requestId: request.requestId });
      expect(worker.terminateCalls).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("clears exact transfer copies and originals when postMessage throws synchronously", async () => {
    let captured: ArrayBuffer[] = [];
    const originalSnapshots: Uint8Array[] = [];
    const worker = new FakeWorker();
    worker.postMessage = (message) => {
      captured = (message as { payloads: ArrayBuffer[] }).payloads;
      originalSnapshots.push(...captured.map((buffer) => new Uint8Array(buffer).slice()));
      throw new Error("hostile clone detail");
    };

    await expect(executeGoogleMigrationWorker([uri()], {}, () => worker)).rejects.toThrow(
      /^IMPORT_MALFORMED$/u,
    );
    expect(worker.terminateCalls).toBe(1);
    expect(captured).toHaveLength(1);
    expect(originalSnapshots[0]?.some((value) => value !== 0)).toBe(true);
    expect(captured.every((buffer) => new Uint8Array(buffer).every((value) => value === 0))).toBe(
      true,
    );
  });

  it("keeps private cleanup ownership when hostile postMessage mutates both exposed arrays", async () => {
    let genuineBuffers: ArrayBuffer[] = [];
    const worker = new FakeWorker();
    worker.postMessage = (message, transfer = []) => {
      const requestPayloads = (message as { payloads: ArrayBuffer[] }).payloads;
      genuineBuffers = requestPayloads.slice();
      requestPayloads.splice(0, requestPayloads.length, new Proxy(new ArrayBuffer(1), {}));
      transfer.splice(0, transfer.length);
      throw new Error("hostile mutation detail");
    };

    const settled = executeGoogleMigrationWorker([uri()], {}, () => worker);
    await expect(settled).rejects.toThrow(/^IMPORT_MALFORMED$/u);
    expect(genuineBuffers).toHaveLength(1);
    expect(
      genuineBuffers.every((buffer) => new Uint8Array(buffer).every((value) => value === 0)),
    ).toBe(true);
    expect(worker.terminateCalls).toBe(1);
  });

  it("settles after cleanup even when hostile worker properties and cleanup operations throw", async () => {
    let terminateCalls = 0;
    const candidate = {
      get onmessage() {
        return null;
      },
      set onmessage(_value: unknown) {
        throw new Error("handler cleanup detail");
      },
      get onerror() {
        return null;
      },
      set onerror(_value: unknown) {
        throw new Error("handler cleanup detail");
      },
      terminate() {
        terminateCalls += 1;
        throw new Error("terminate detail");
      },
      postMessage(_message: unknown, transfer: Transferable[] = []) {
        transfer.splice(0, transfer.length);
        throw new Error("post detail");
      },
    } as GoogleMigrationWorkerLike;
    await expect(executeGoogleMigrationWorker([uri()], {}, () => candidate)).rejects.toThrow(
      /^IMPORT_MALFORMED$/u,
    );
    expect(terminateCalls).toBe(1);
  });

  it.each(["throwing postMessage getter", "nonfunction postMessage"])(
    "terminates exactly once when %s prevents posting",
    async (variant) => {
      let terminateCalls = 0;
      const candidate = {
        onmessage: null,
        onerror: null,
        terminate() {
          terminateCalls += 1;
          throw new Error("termination detail");
        },
        get postMessage(): unknown {
          if (variant === "throwing postMessage getter") throw new Error("getter detail");
          return null;
        },
      } as unknown as GoogleMigrationWorkerLike;

      await expect(executeGoogleMigrationWorker([uri()], {}, () => candidate)).rejects.toThrow(
        /^IMPORT_MALFORMED$/u,
      );
      expect(terminateCalls).toBe(1);
    },
  );

  it("rejects hostile messages, count overflow, mismatched IDs, and worker errors with fixed failures", async () => {
    for (const response of [
      null,
      { version: 1, kind: "success", requestId: "wrong", result: {} },
      { version: 1, kind: "success", requestId: "REQUEST", result: { extra: true } },
    ]) {
      const worker = new FakeWorker();
      vi.stubGlobal(
        "Worker",
        class {
          constructor() {
            return worker;
          }
        },
      );
      const pending = parseGoogleMigrationUri(uri());
      const request = worker.posted[0]?.message as { requestId: string };
      const actual = JSON.stringify(response).replace("REQUEST", request.requestId);
      worker.respond(JSON.parse(actual) as unknown);
      await expect(pending).rejects.toThrow(/^IMPORT_MALFORMED$/u);
      expect(worker.terminateCalls).toBe(1);
      vi.unstubAllGlobals();
    }
  });

  it("rejects a dense 1,001-entry result at the worker boundary while the caller remains responsive", async () => {
    const worker = new FakeWorker();
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          return worker;
        }
      },
    );
    try {
      let responsive = false;
      const pending = parseGoogleMigrationUri(uri());
      const request = worker.posted[0]?.message as { requestId: string };
      queueMicrotask(() => {
        responsive = true;
      });
      const candidate = (success(request.requestId) as { result: { candidates: unknown[] } }).result
        .candidates[0]!;
      worker.respond({
        version: 1,
        kind: "success",
        requestId: request.requestId,
        result: {
          format: "google-migration",
          candidates: Array.from({ length: 1_001 }, () => candidate),
          rejected: [],
        },
      });
      await expect(pending).rejects.toThrow(/^IMPORT_MALFORMED$/u);
      expect(responsive).toBe(true);
      expect(worker.terminateCalls).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("clears defensively collected buffers and closes on malformed worker requests", () => {
    for (const makeRequest of [
      (buffers: ArrayBuffer[]) => ({ version: 0, kind: "decode", payloads: buffers }),
      (buffers: ArrayBuffer[]) => ({
        version: 1,
        kind: "decode",
        requestId: "0".repeat(32),
        payloads: buffers,
      }),
    ]) {
      const buffers = [
        Uint8Array.from([1, 2, 3, 4]).buffer,
        new Uint8Array(1_048_576).fill(7).buffer,
      ];
      let closeCalls = 0;
      const responses: unknown[] = [];
      handleGoogleMigrationWorkerMessage(makeRequest(buffers), {
        postMessage: (message) => responses.push(message),
        close: () => {
          closeCalls += 1;
        },
      });
      expect(buffers.every((buffer) => new Uint8Array(buffer).every((value) => value === 0))).toBe(
        true,
      );
      expect(closeCalls).toBe(1);
      expect(responses).toHaveLength(0);
    }
  });

  it("reads a structurally present payload property exactly once before strict parsing", () => {
    const buffer = Uint8Array.from([1, 2, 3, 4]).buffer;
    let payloadReads = 0;
    let closeCalls = 0;
    const request = {
      version: 0,
      kind: "decode",
      get payloads() {
        payloadReads += 1;
        return [buffer];
      },
    };
    handleGoogleMigrationWorkerMessage(request, {
      postMessage: () => undefined,
      close: () => {
        closeCalls += 1;
      },
    });
    expect(payloadReads).toBe(1);
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array(4));
    expect(closeCalls).toBe(1);
  });

  it("snapshots every expected request field once and rejects unknown own fields", () => {
    const buffer = Uint8Array.from([1, 2, 3]).buffer;
    const reads = new Map<string, number>();
    const request = Object.create(null) as Record<string, unknown>;
    for (const [key, value] of [
      ["version", 0],
      ["kind", "decode"],
      ["requestId", "0".repeat(32)],
      ["payloads", [buffer]],
    ] as const) {
      Object.defineProperty(request, key, {
        enumerable: true,
        get() {
          reads.set(key, (reads.get(key) ?? 0) + 1);
          return value;
        },
      });
    }
    Object.defineProperty(request, "extra", {
      enumerable: true,
      get() {
        throw new Error("must not invoke unknown getter");
      },
    });
    let closeCalls = 0;
    expect(() =>
      handleGoogleMigrationWorkerMessage(request, {
        postMessage: () => undefined,
        close: () => {
          closeCalls += 1;
        },
      }),
    ).not.toThrow();
    expect(Object.fromEntries(reads)).toEqual({
      version: 1,
      kind: 1,
      requestId: 1,
      payloads: 1,
    });
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array(3));
    expect(closeCalls).toBe(1);
  });

  it("uses one dense snapshot when a proxy changes length and entries after first read", () => {
    const first = Uint8Array.from([1, 2]).buffer;
    const second = Uint8Array.from([3, 4]).buffer;
    let lengthReads = 0;
    const entryReads = [0, 0];
    const payloads = new Proxy([first, second], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          return lengthReads === 1 ? 2 : 1_000_000;
        }
        if (property === "0" || property === "1") {
          const index = Number(property);
          entryReads[index] = (entryReads[index] ?? 0) + 1;
          return entryReads[index] === 1 ? target[index] : new ArrayBuffer(9);
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    let closeCalls = 0;
    handleGoogleMigrationWorkerMessage(
      { version: 0, kind: "decode", requestId: "0".repeat(32), payloads },
      {
        postMessage: () => undefined,
        close: () => {
          closeCalls += 1;
        },
      },
    );
    expect(lengthReads).toBe(1);
    expect(entryReads).toEqual([1, 1]);
    expect(new Uint8Array(first)).toEqual(new Uint8Array(2));
    expect(new Uint8Array(second)).toEqual(new Uint8Array(2));
    expect(closeCalls).toBe(1);
  });

  it("captures hostile payload access once, closes, and does not reflect hostile values", () => {
    let payloadReads = 0;
    let closeCalls = 0;
    const request = {
      version: 1,
      kind: "decode",
      get payloads() {
        payloadReads += 1;
        throw new Error("hostile payload detail");
      },
      get requestId() {
        throw new Error("hostile id detail");
      },
    };
    expect(() =>
      handleGoogleMigrationWorkerMessage(request, {
        postMessage: () => {
          throw new Error("must not respond");
        },
        close: () => {
          closeCalls += 1;
          throw new Error("close detail");
        },
      }),
    ).not.toThrow();
    expect(payloadReads).toBe(1);
    expect(closeCalls).toBe(1);
  });

  it("contains a proxy array that throws on length and closes exactly once", () => {
    let closeCalls = 0;
    const payloads = new Proxy([], {
      get(_target, property) {
        if (property === "length") throw new Error("hostile length detail");
        return undefined;
      },
    });
    expect(() =>
      handleGoogleMigrationWorkerMessage(
        { version: 1, kind: "decode", requestId: "0".repeat(32), payloads },
        {
          postMessage: () => undefined,
          close: () => {
            closeCalls += 1;
          },
        },
      ),
    ).not.toThrow();
    expect(closeCalls).toBe(1);
  });

  it("ignores a proxied ArrayBuffer brand and still clears a following genuine buffer", () => {
    const proxied = new Proxy(new ArrayBuffer(4), {});
    const genuine = new Uint8Array(4).fill(9).buffer;
    let closeCalls = 0;
    expect(() =>
      handleGoogleMigrationWorkerMessage(
        { version: 0, kind: "decode", payloads: [proxied, genuine] },
        {
          postMessage: () => undefined,
          close: () => {
            closeCalls += 1;
          },
        },
      ),
    ).not.toThrow();
    expect(new Uint8Array(genuine)).toEqual(new Uint8Array(4));
    expect(closeCalls).toBe(1);
  });

  it("continues clearing remaining buffers and closes when one clear operation throws", () => {
    const first = new Uint8Array(4).fill(3).buffer;
    const second = new Uint8Array(4).fill(7).buffer;
    let closeCalls = 0;
    let clearCalls = 0;
    handleGoogleMigrationWorkerMessage(
      { version: 0, kind: "decode", payloads: [first, second] },
      {
        postMessage: () => undefined,
        close: () => {
          closeCalls += 1;
        },
      },
      (buffer) => {
        clearCalls += 1;
        if (buffer === first) throw new Error("clear detail");
        new Uint8Array(buffer).fill(0);
      },
    );
    expect(clearCalls).toBe(2);
    expect(new Uint8Array(second)).toEqual(new Uint8Array(4));
    expect(closeCalls).toBe(1);
  });

  it("terminates on timeout and abort without accepting a late secret-bearing message", async () => {
    vi.useFakeTimers();
    try {
      const timedWorker = new FakeWorker();
      vi.stubGlobal(
        "Worker",
        class {
          constructor() {
            return timedWorker;
          }
        },
      );
      const timed = parseGoogleMigrationUri(uri(), { timeoutMs: 25 });
      const rejection = expect(timed).rejects.toThrow(/^IMPORT_LIMIT_EXCEEDED$/u);
      await vi.advanceTimersByTimeAsync(25);
      await rejection;
      expect(timedWorker.terminateCalls).toBe(1);

      const abortedWorker = new FakeWorker();
      vi.stubGlobal(
        "Worker",
        class {
          constructor() {
            return abortedWorker;
          }
        },
      );
      const controller = new AbortController();
      const aborted = parseGoogleMigrationUri(uri(), { signal: controller.signal });
      controller.abort();
      await expect(aborted).rejects.toThrow(/^IMPORT_MALFORMED$/u);
      expect(abortedWorker.terminateCalls).toBe(1);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
