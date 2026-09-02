import { describe, expect, it } from "vitest";

import { deriveKeyEncryptionKey, type KdfExecutor, type KdfRequest } from "../src/kdf";

const parameters = Object.freeze({
  algorithm: "argon2id" as const,
  memoryKiB: 8192,
  iterations: 1,
  parallelism: 1,
});

describe("KDF execution port", () => {
  it("maps validated exact password bytes, salt, and parameters to the executor", async () => {
    let received: KdfRequest | undefined;
    const executor: KdfExecutor = {
      derive(request) {
        received = request;
        return Promise.resolve(new Uint8Array(32).fill(7));
      },
    };
    const salt = new Uint8Array(16).fill(3);

    const result = await deriveKeyEncryptionKey(executor, "caf\u00e9", parameters, salt);

    expect(result).toEqual(new Uint8Array(32).fill(7));
    expect(received?.password).toEqual(new TextEncoder().encode("caf\u00e9"));
    expect(received?.salt).toEqual(salt);
    expect(received?.parameters).toEqual(parameters);
  });

  it("rejects invalid inputs before invoking the executor and invalid executor output", async () => {
    let calls = 0;
    const executor: KdfExecutor = {
      derive() {
        calls += 1;
        return Promise.resolve(new Uint8Array(31));
      },
    };
    await expect(
      deriveKeyEncryptionKey(executor, "password", parameters, new Uint8Array(15)),
    ).rejects.toThrow(/salt/iu);
    expect(calls).toBe(0);
    await expect(
      deriveKeyEncryptionKey(executor, "password", parameters, new Uint8Array(16)),
    ).rejects.toThrow(/32-byte/iu);
  });

  it("passes cancellation and started notification without direct fallback", async () => {
    const controller = new AbortController();
    let started = false;
    const executor: KdfExecutor = {
      derive(request) {
        expect(request.signal).toBe(controller.signal);
        request.onStarted?.();
        return Promise.resolve(new Uint8Array(32));
      },
    };
    await deriveKeyEncryptionKey(executor, "password", parameters, new Uint8Array(16), {
      signal: controller.signal,
      onStarted: () => {
        started = true;
      },
    });
    expect(started).toBe(true);
  });
});
