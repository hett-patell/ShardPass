import { describe, expect, it, vi } from "vitest";

import { createWorkerKdfExecutor, type KdfWorkerLike } from "../src/kdf-worker-client";

class FakeWorker implements KdfWorkerLike {
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

const parameters = Object.freeze({
  algorithm: "argon2id" as const,
  memoryKiB: 8192,
  iterations: 1,
  parallelism: 1,
});
const request = () => ({
  password: new TextEncoder().encode("password"),
  salt: new Uint8Array(16).fill(3),
  parameters,
});

describe("single-use worker KDF executor", () => {
  it("transfers owned exact buffers while caller arrays stay intact", async () => {
    const worker = new FakeWorker();
    const caller = request();
    const originalPassword = caller.password.slice();
    const originalSalt = caller.salt.slice();
    const pending = createWorkerKdfExecutor(() => worker, { timeoutMs: 1000 }).derive(caller);
    const posted = worker.posted[0];
    const message = posted?.message as {
      requestId: string;
      password: Uint8Array<ArrayBuffer>;
      salt: Uint8Array<ArrayBuffer>;
    };
    expect(posted).toBeDefined();
    const transfer = posted?.transfer ?? [];
    expect(transfer).toEqual([message.password.buffer, message.salt.buffer]);
    expect(message.password.buffer).not.toBe(caller.password.buffer);
    expect(message.salt.buffer).not.toBe(caller.salt.buffer);
    structuredClone(message, { transfer });
    expect(message.password.byteLength).toBe(0);
    expect(message.salt.byteLength).toBe(0);
    expect(caller.password).toEqual(originalPassword);
    expect(caller.salt).toEqual(originalSalt);
    worker.respond({
      version: 1,
      kind: "success",
      requestId: message.requestId,
      result: new ArrayBuffer(32),
    });
    await expect(pending).resolves.toHaveLength(32);
  });

  it("reports started, accepts one result, nulls handlers, and terminates once", async () => {
    const worker = new FakeWorker();
    const started = vi.fn();
    const pending = createWorkerKdfExecutor(() => worker, { timeoutMs: 1000 }).derive({
      ...request(),
      onStarted: started,
    });
    const posted = worker.posted[0]?.message as { requestId: string };
    worker.respond({ version: 1, kind: "started", requestId: posted.requestId });
    expect(started).toHaveBeenCalledOnce();
    worker.respond({
      version: 1,
      kind: "success",
      requestId: posted.requestId,
      result: new ArrayBuffer(32),
    });
    await expect(pending).resolves.toHaveLength(32);
    expect(worker.terminateCalls).toBe(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });

  it("redacts synchronous factory failure and avoids creating for pre-abort", async () => {
    const failed = createWorkerKdfExecutor(() => {
      throw new Error("sensitive factory detail");
    }).derive(request());
    await expect(failed).rejects.toThrow(/^KDF_EXECUTION_FAILED$/u);

    const factory = vi.fn(() => new FakeWorker());
    const controller = new AbortController();
    controller.abort();
    await expect(
      createWorkerKdfExecutor(factory).derive({ ...request(), signal: controller.signal }),
    ).rejects.toThrow(/^KDF_CANCELLED$/u);
    expect(factory).not.toHaveBeenCalled();
  });

  it("catches abort during factory, never posts, and terminates the returned worker once", async () => {
    const controller = new AbortController();
    const worker = new FakeWorker();
    const pending = createWorkerKdfExecutor(() => {
      controller.abort();
      return worker;
    }).derive({ ...request(), signal: controller.signal });

    await expect(pending).rejects.toThrow(/^KDF_CANCELLED$/u);
    expect(worker.posted).toHaveLength(0);
    expect(worker.terminateCalls).toBe(1);
  });

  it.each([
    ["null", null],
    ["missing postMessage", { terminate() {} }],
    ["missing terminate", { postMessage() {} }],
  ])("rejects malformed factory result: %s", async (_label, malformed) => {
    const factory = () => malformed as unknown as KdfWorkerLike;
    await expect(createWorkerKdfExecutor(factory).derive(request())).rejects.toThrow(
      /^KDF_EXECUTION_FAILED$/u,
    );
  });

  it("contains throwing terminate getter and removes its abort listener", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const candidate = {
      get terminate() {
        throw new Error("raw terminate getter");
      },
      postMessage() {},
    };
    await expect(
      createWorkerKdfExecutor(() => candidate).derive({ ...request(), signal: controller.signal }),
    ).rejects.toThrow(/^KDF_EXECUTION_FAILED$/u);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("captures callable terminate before a throwing postMessage getter", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    let terminateCalls = 0;
    let terminateGets = 0;
    const candidate = {
      get terminate() {
        terminateGets += 1;
        return function (this: unknown) {
          expect(this).toBe(candidate);
          terminateCalls += 1;
        };
      },
      get postMessage() {
        throw new Error("raw post getter");
      },
    };
    await expect(
      createWorkerKdfExecutor(() => candidate).derive({ ...request(), signal: controller.signal }),
    ).rejects.toThrow(/^KDF_EXECUTION_FAILED$/u);
    expect(terminateGets).toBe(1);
    expect(terminateCalls).toBe(1);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("contains Proxy get traps without raw leakage or method rereads", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    let terminateCalls = 0;
    const gets: PropertyKey[] = [];
    const target = {
      terminate() {
        terminateCalls += 1;
      },
    };
    const candidate = new Proxy(target, {
      get(object, property, receiver) {
        gets.push(property);
        if (property === "postMessage") throw new Error("raw proxy trap");
        return Reflect.get(object, property, receiver) as unknown;
      },
    });
    await expect(
      createWorkerKdfExecutor(() => candidate).derive({ ...request(), signal: controller.signal }),
    ).rejects.toThrow(/^KDF_EXECUTION_FAILED$/u);
    expect(gets.filter((property) => property === "terminate")).toHaveLength(1);
    expect(gets.filter((property) => property === "postMessage")).toHaveLength(1);
    expect(terminateCalls).toBe(1);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("preserves fixed settlement when handler cleanup and terminate throw", async () => {
    let terminateAttempts = 0;
    const worker = {
      postMessage() {
        throw new Error("raw post detail");
      },
      terminate() {
        terminateAttempts += 1;
        throw new Error("raw terminate detail");
      },
      set onmessage(_value: unknown) {
        throw new Error("raw handler detail");
      },
      set onerror(_value: unknown) {
        throw new Error("raw handler detail");
      },
    } as unknown as KdfWorkerLike;
    await expect(createWorkerKdfExecutor(() => worker).derive(request())).rejects.toThrow(
      /^KDF_EXECUTION_FAILED$/u,
    );
    expect(terminateAttempts).toBe(1);
  });

  it("cleans up and redacts synchronous postMessage transfer failure", async () => {
    const worker = new FakeWorker();
    worker.postMessage = () => {
      throw new Error("sensitive clone detail");
    };
    await expect(
      createWorkerKdfExecutor(() => worker, { timeoutMs: 1000 }).derive(request()),
    ).rejects.toThrow(/^KDF_EXECUTION_FAILED$/u);
    expect(worker.terminateCalls).toBe(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });

  it("times out, aborts, and redacts asynchronous worker failures", async () => {
    vi.useFakeTimers();
    try {
      const timedWorker = new FakeWorker();
      const timed = createWorkerKdfExecutor(() => timedWorker, { timeoutMs: 25 }).derive(request());
      const timeoutRejection = expect(timed).rejects.toThrow(/timed out/iu);
      await vi.advanceTimersByTimeAsync(25);
      await timeoutRejection;
      expect(timedWorker.terminateCalls).toBe(1);

      const failedWorker = new FakeWorker();
      const failed = createWorkerKdfExecutor(() => failedWorker, { timeoutMs: 25 }).derive(
        request(),
      );
      failedWorker.onerror?.({ message: "sensitive runtime detail" } as ErrorEvent);
      await expect(failed).rejects.toThrow(/^KDF_EXECUTION_FAILED$/u);
      expect(failedWorker.terminateCalls).toBe(1);

      const abortWorker = new FakeWorker();
      const controller = new AbortController();
      const aborted = createWorkerKdfExecutor(() => abortWorker, { timeoutMs: 25 }).derive({
        ...request(),
        signal: controller.signal,
      });
      controller.abort();
      await expect(aborted).rejects.toThrow(/cancelled/iu);
      expect(abortWorker.terminateCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
