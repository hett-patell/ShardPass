import { describe, expect, it } from "vitest";

import {
  EnteSessionHandoffStore,
  decodeEnteSessionPayload,
  encodeEnteSessionPayload,
} from "../../src/background/ente/session-handoff";
import { createEnteSodiumAdapter } from "../../src/background/ente/sodium-adapter";

const sender = {
  extensionId: "extension-id",
  contextKind: "vault" as const,
  senderUrl: "chrome-extension://extension-id/vault/index.html",
  documentId: "vault-document-1",
};

function repository(epoch = 7) {
  return {
    readOtpItemsAndMetadata: () =>
      Promise.resolve({ sessionEpoch: epoch, items: [], metadata: null }),
  } as never;
}

describe("one-use Ente session handoff", () => {
  it("encodes and decodes a strict owned binary payload without JSON or base64", () => {
    const token = new TextEncoder().encode("synthetic-token");
    const masterKey = new Uint8Array(32).fill(11);
    const authKey = new Uint8Array(32).fill(17);
    const accountFingerprint = new Uint8Array(32).fill(22);
    const payload = encodeEnteSessionPayload({ token, masterKey, authKey, accountFingerprint });

    expect(new TextDecoder().decode(payload)).not.toContain("masterKey");
    const decoded = decodeEnteSessionPayload(payload);
    expect(decoded.token).toEqual(token);
    expect(decoded.masterKey).toEqual(masterKey);
    expect(decoded.authKey).toEqual(authKey);
    expect(decoded.accountFingerprint).toEqual(accountFingerprint);
    expect(decoded.token).not.toBe(token);
    expect(() => decodeEnteSessionPayload(Uint8Array.from([...payload, 0]))).toThrow();

    decoded.token.fill(0);
    decoded.masterKey.fill(0);
    decoded.authKey.fill(0);
    decoded.accountFingerprint.fill(0);
    payload.fill(0);
    token.fill(0);
    masterKey.fill(0);
    authKey.fill(0);
    accountFingerprint.fill(0);
  });

  it("seals to a sender/document/session/root-bound capability and consumes it once", async () => {
    const sodium = await createEnteSodiumAdapter();
    let now = 1_000;
    let root = "root-a";
    const store = new EnteSessionHandoffStore(repository(), {
      sodium,
      now: () => now,
      randomCapability: () => "a".repeat(64),
      rootDigest: () => Promise.resolve(root),
    });
    const challenge = await store.issue(sender);
    expect(challenge.publicKey).toHaveLength(32);

    const plaintext = encodeEnteSessionPayload({
      token: new TextEncoder().encode("synthetic-token"),
      masterKey: new Uint8Array(32).fill(1),
      authKey: new Uint8Array(32).fill(3),
      accountFingerprint: new Uint8Array(32).fill(2),
    });
    const ciphertext = sodium.sealedBoxSeal(plaintext, challenge.publicKey);
    plaintext.fill(0);

    const opened = await store.consume(challenge.capability, ciphertext, sender);
    expect(new TextDecoder().decode(opened.token)).toBe("synthetic-token");
    await expect(store.consume(challenge.capability, ciphertext, sender)).rejects.toThrow();
    opened.token.fill(0);
    opened.masterKey.fill(0);
    opened.accountFingerprint.fill(0);
    ciphertext.fill(0);

    const wrongDocument = await store.issue(sender);
    const empty = sodium.sealedBoxSeal(
      encodeEnteSessionPayload({
        token: new Uint8Array([65]),
        masterKey: new Uint8Array(32),
        authKey: new Uint8Array(32),
        accountFingerprint: new Uint8Array(32),
      }),
      wrongDocument.publicKey,
    );
    await expect(
      store.consume(wrongDocument.capability, empty, { ...sender, documentId: "other-document" }),
    ).rejects.toThrow();
    await expect(store.consume(wrongDocument.capability, empty, sender)).rejects.toThrow();

    const stale = await store.issue(sender);
    root = "root-b";
    await expect(store.consume(stale.capability, empty, sender)).rejects.toThrow();

    root = "root-a";
    // A slow sign-in (Argon2id at Ente's 1 GiB setting, SRP, a 2FA code typed by hand) can
    // take minutes; the capability issued before it started must still be good afterwards.
    const slow = await store.issue(sender);
    const slowPlaintext = encodeEnteSessionPayload({
      token: new TextEncoder().encode("slow-token"),
      masterKey: new Uint8Array(32).fill(4),
      authKey: new Uint8Array(32).fill(5),
      accountFingerprint: new Uint8Array(32).fill(6),
    });
    const slowCiphertext = sodium.sealedBoxSeal(slowPlaintext, slow.publicKey);
    slowPlaintext.fill(0);
    now += 5 * 60_000;
    const slowOpened = await store.consume(slow.capability, slowCiphertext, sender);
    expect(new TextDecoder().decode(slowOpened.token)).toBe("slow-token");
    slowOpened.token.fill(0);
    slowOpened.masterKey.fill(0);
    slowOpened.authKey.fill(0);
    slowOpened.accountFingerprint.fill(0);

    const expired = await store.issue(sender);
    now += 10 * 60_000 + 1;
    await expect(store.consume(expired.capability, empty, sender)).rejects.toMatchObject({
      code: "ENTE_AUTH_FAILED",
      detail: expect.stringContaining("longer than the handoff allows") as unknown,
    });

    store.clear();
    sodium.dispose();
  });
});
