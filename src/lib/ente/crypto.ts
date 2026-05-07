import sodium from "libsodium-wrappers-sumo";

export type BytesOrB64 = Uint8Array | string;

export async function ready(): Promise<void> {
  await sodium.ready;
}

export async function toB64(input: Uint8Array): Promise<string> {
  await sodium.ready;
  return sodium.to_base64(input, sodium.base64_variants.ORIGINAL);
}

export async function toB64URLSafe(input: Uint8Array): Promise<string> {
  await sodium.ready;
  return sodium.to_base64(input, sodium.base64_variants.URLSAFE);
}

export async function fromB64(input: string): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.from_base64(input, sodium.base64_variants.ORIGINAL);
}

async function bytes(b: BytesOrB64): Promise<Uint8Array> {
  return typeof b === "string" ? fromB64(b) : b;
}

export async function deriveKEK(
  passphrase: string,
  saltB64: string,
  opsLimit: number,
  memLimit: number,
): Promise<string> {
  await sodium.ready;
  const out = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    sodium.from_string(passphrase),
    await fromB64(saltB64),
    opsLimit,
    memLimit,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  return toB64(out);
}

export async function decryptBoxBytes(
  encryptedDataB64: string,
  nonceB64: string,
  keyB64: string,
): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_secretbox_open_easy(
    await bytes(encryptedDataB64),
    await bytes(nonceB64),
    await bytes(keyB64),
  );
}

export async function decryptBoxToB64(
  encryptedDataB64: string,
  nonceB64: string,
  keyB64: string,
): Promise<string> {
  return toB64(await decryptBoxBytes(encryptedDataB64, nonceB64, keyB64));
}

export async function encryptBox(
  data: BytesOrB64,
  keyB64: string,
): Promise<{ encryptedData: string; nonce: string }> {
  await sodium.ready;
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct = sodium.crypto_secretbox_easy(
    await bytes(data),
    nonce,
    await bytes(keyB64),
  );
  return {
    encryptedData: await toB64(ct),
    nonce: await toB64(nonce),
  };
}

export async function decryptBlobJSON<T = unknown>(
  encryptedDataB64: string,
  decryptionHeaderB64: string,
  keyB64: string,
): Promise<T> {
  const decoded = await decryptBlobBytes(encryptedDataB64, decryptionHeaderB64, keyB64);
  return JSON.parse(new TextDecoder().decode(decoded)) as T;
}

export async function decryptBlobBytes(
  encryptedDataB64: string,
  decryptionHeaderB64: string,
  keyB64: string,
): Promise<Uint8Array> {
  await sodium.ready;
  const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(
    await bytes(decryptionHeaderB64),
    await bytes(keyB64),
  );
  const result = sodium.crypto_secretstream_xchacha20poly1305_pull(
    state,
    await bytes(encryptedDataB64),
    null,
  );
  if (!result) throw new Error("secretstream pull failed");
  return result.message;
}

export async function encryptBlobJSON(
  value: unknown,
  keyB64: string,
): Promise<{ encryptedData: string; header: string }> {
  return encryptBlobBytes(new TextEncoder().encode(JSON.stringify(value)), keyB64);
}

export async function encryptBlobBytes(
  data: Uint8Array,
  keyB64: string,
): Promise<{ encryptedData: string; header: string }> {
  await sodium.ready;
  const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(
    await bytes(keyB64),
  );
  const ct = sodium.crypto_secretstream_xchacha20poly1305_push(
    state,
    data,
    null,
    sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
  );
  return {
    encryptedData: await toB64(ct),
    header: await toB64(header),
  };
}

export async function deriveSubKeyBytes(
  keyB64: string,
  subKeyLength: number,
  subKeyID: number,
  context: string,
): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_kdf_derive_from_key(
    subKeyLength,
    subKeyID,
    context,
    await bytes(keyB64),
  );
}

export async function boxSealOpenBytes(
  encryptedDataB64: string,
  publicKeyB64: string,
  privateKeyB64: string,
): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_box_seal_open(
    await bytes(encryptedDataB64),
    await bytes(publicKeyB64),
    await bytes(privateKeyB64),
  );
}

export async function generateAuthenticatorKeyB64(): Promise<string> {
  await sodium.ready;
  return toB64(sodium.crypto_secretbox_keygen());
}
