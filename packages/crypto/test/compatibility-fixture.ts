import type { WrappedVaultKey } from "@shardpass/storage";

import { encryptEnvelope } from "../src/aead";
import { deriveArgon2idDirect } from "../src/kdf-direct";
import type { Argon2idWorkParameters } from "../src/kdf";
import { createDeterministicRandomSource } from "../src/random";

const bytes = Uint8Array.from({ length: 72 }, (_, index) => index);
const base64 = (value: Uint8Array): string => Buffer.from(value).toString("base64");

export async function compatibilityFixture(
  password: string,
  parameters: Argon2idWorkParameters,
): Promise<{ dataKey: Uint8Array; wrapped: WrappedVaultKey }> {
  const salt = bytes.slice(0, 16);
  const dataKey = bytes.slice(16, 48);
  const wrappingAad = new TextEncoder().encode("shardpass:wrapped-vault-key:v1:xchacha20-poly1305");
  const kek = deriveArgon2idDirect({
    password: new TextEncoder().encode(password),
    salt,
    parameters,
  });
  const envelope = await encryptEnvelope(
    kek,
    dataKey,
    wrappingAad,
    createDeterministicRandomSource(bytes.slice(48)),
  );
  return {
    dataKey,
    wrapped: {
      formatVersion: 1,
      kdf: { ...parameters, salt: base64(salt) },
      wrapping: {
        algorithm: "xchacha20-poly1305",
        nonce: base64(envelope.nonce),
        ciphertext: base64(envelope.ciphertext),
        encoding: "base64",
      },
    },
  };
}
