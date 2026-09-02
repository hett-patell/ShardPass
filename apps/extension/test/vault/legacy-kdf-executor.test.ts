import { describe, expect, it, vi } from "vitest";

import {
  createLegacyKdfExecutor,
  type LegacyKdfWorkerLike,
} from "../../src/vault/migration/legacy-kdf-executor";

class FakeWorker implements LegacyKdfWorkerLike {
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

const request = () => ({
  password: new TextEncoder().encode("synthetic passphrase"),
  salt: Uint8Array.from({ length: 16 }, (_, index) => index),
  iterations: 600_000 as const,
  outputBytes: 32 as const,
});

describe("legacy PBKDF2 worker executor", () => {
  it("transfers private copies, accepts one exact result, and terminates", async () => {
    const worker = new FakeWorker();
    const input = request();
    const passwordBefore = input.password.slice();
    const pending = createLegacyKdfExecutor(() => worker, { timeoutMs: 1000 }).derive(input);
    const posted = worker.posted[0];
    const message = posted?.message as {
      requestId: string;
      password: Uint8Array<ArrayBuffer>;
      salt: Uint8Array<ArrayBuffer>;
    };

    expect(posted?.transfer).toEqual([message.password.buffer, message.salt.buffer]);
    expect(message.password.buffer).not.toBe(input.password.buffer);
    expect(input.password).toEqual(passwordBefore);

    const result = new Uint8Array(32).fill(9);
    worker.respond({
      version: 1,
      kind: "success",
      requestId: message.requestId,
      result: result.buffer,
    });
    await expect(pending).resolves.toEqual(result);
    expect(worker.terminateCalls).toBe(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();

    worker.respond({ version: 1, kind: "failure", requestId: message.requestId });
    expect(worker.terminateCalls).toBe(1);
  });

  it("cancels, ignores late responses, and redacts worker failures", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const pending = createLegacyKdfExecutor(() => worker, { timeoutMs: 1000 }).derive({
      ...request(),
      signal: controller.signal,
    });
    const posted = worker.posted[0]?.message as { requestId: string };
    controller.abort();

    await expect(pending).rejects.toThrow(/^LEGACY_KDF_CANCELLED$/u);
    expect(worker.terminateCalls).toBe(1);
    worker.respond({
      version: 1,
      kind: "success",
      requestId: posted.requestId,
      result: new ArrayBuffer(32),
    });
    expect(worker.terminateCalls).toBe(1);

    const failedWorker = new FakeWorker();
    const failed = createLegacyKdfExecutor(() => failedWorker).derive(request());
    failedWorker.onerror?.({ message: "arbitrary private worker detail" } as ErrorEvent);
    await expect(failed).rejects.toThrow(/^LEGACY_KDF_FAILED$/u);
  });

  it("rejects malformed, wrong-request, and wrong-length results", async () => {
    for (const response of [
      { version: 1, kind: "success", requestId: "f".repeat(32), result: new ArrayBuffer(32) },
      { version: 1, kind: "success", requestId: "REQUEST", result: new ArrayBuffer(31) },
      { version: 1, kind: "success", requestId: "REQUEST", result: "not-a-buffer" },
    ]) {
      const worker = new FakeWorker();
      vi.spyOn(crypto, "randomUUID").mockReturnValueOnce("00000000-0000-4000-8000-000000000000");
      const pending = createLegacyKdfExecutor(() => worker).derive(request());
      const posted = worker.posted[0]?.message as { requestId: string };
      worker.respond({
        ...response,
        requestId: response.requestId === "REQUEST" ? posted.requestId : response.requestId,
      });
      await expect(pending).rejects.toThrow(/^LEGACY_KDF_FAILED$/u);
    }
  });
});
