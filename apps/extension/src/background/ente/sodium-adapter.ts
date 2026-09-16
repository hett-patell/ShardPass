import type * as sodiumModule from "libsodium-wrappers-sumo";

/**
 * Loaded on first use, never at start-up. The wrapper and its WebAssembly are about 1.8 MB,
 * the background service worker is restarted constantly, and a vault that never connects Ente
 * must not pay for this on every wake. One module for the whole extension, as before.
 */
type Sodium = (typeof sodiumModule)["default"];
let loading: Promise<Sodium> | null = null;
async function loadSodium(): Promise<Sodium> {
  loading ??= import("libsodium-wrappers-sumo").then(async (module) => {
    await module.default.ready;
    return module.default;
  });
  return loading;
}

const MAX_INPUT = 1024 * 1024;
const owned = (value: Uint8Array): Uint8Array => Uint8Array.from(value);
const requireLength = (value: Uint8Array, length: number): void => {
  if (value.length !== length) throw new Error("Ente crypto input rejected");
};
const requireBounded = (value: Uint8Array): void => {
  if (value.length > MAX_INPUT) throw new Error("Ente crypto input rejected");
};

export type AuthEntityFrame = Readonly<{ encryptedData: string; header: string }>;

export interface EnteSodiumAdapter {
  randomBytes(length: number): Uint8Array;
  sealedBoxKeypair(): Readonly<{ publicKey: Uint8Array; privateKey: Uint8Array }>;
  toBase64(value: Uint8Array): string;
  fromBase64(value: string): Uint8Array;
  equal(left: Uint8Array, right: Uint8Array): boolean;
  argon2id(
    password: Uint8Array,
    salt: Uint8Array,
    opsLimit: number,
    memLimit: number,
    length: number,
  ): Uint8Array;
  deriveSubkey(key: Uint8Array, length: number, id: number, context: string): Uint8Array;
  sealedBoxSeal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
  sealedBoxOpen(ciphertext: Uint8Array, publicKey: Uint8Array, privateKey: Uint8Array): Uint8Array;
  secretboxSeal(message: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  secretboxOpen(ciphertext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  secretstreamSeal(
    message: Uint8Array,
    key: Uint8Array,
  ): Readonly<{ ciphertext: Uint8Array; header: Uint8Array }>;
  secretstreamOpen(ciphertext: Uint8Array, header: Uint8Array, key: Uint8Array): Uint8Array;
  encryptAuthEntity(message: Uint8Array, key: Uint8Array): AuthEntityFrame;
  decryptAuthEntity(frame: AuthEntityFrame, key: Uint8Array): Uint8Array;
  dispose(): void;
}

export async function createEnteSodiumAdapter(): Promise<EnteSodiumAdapter> {
  const sodium = await loadSodium();
  let disposed = false;
  const active = () => {
    if (disposed) throw new Error("Ente crypto adapter disposed");
  };
  const toBase64 = (value: Uint8Array) => {
    active();
    requireBounded(value);
    return sodium.to_base64(value, sodium.base64_variants.ORIGINAL);
  };
  const fromBase64 = (value: string) => {
    active();
    if (
      value.length > 2 * MAX_INPUT ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
    )
      throw new Error("Ente base64 rejected");
    const decoded = sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
    if (sodium.to_base64(decoded, sodium.base64_variants.ORIGINAL) !== value)
      throw new Error("Ente base64 rejected");
    return owned(decoded);
  };
  const secretstreamSeal = (
    message: Uint8Array,
    key: Uint8Array,
  ): Readonly<{ ciphertext: Uint8Array; header: Uint8Array }> => {
    active();
    requireBounded(message);
    requireLength(key, sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES);
    const init = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
    return {
      ciphertext: owned(
        sodium.crypto_secretstream_xchacha20poly1305_push(
          init.state,
          message,
          null,
          sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
        ),
      ),
      header: owned(init.header),
    };
  };
  const secretstreamOpen = (
    ciphertext: Uint8Array,
    header: Uint8Array,
    key: Uint8Array,
  ): Uint8Array => {
    active();
    requireBounded(ciphertext);
    requireLength(header, sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES);
    requireLength(key, sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES);
    const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, key);
    const result = sodium.crypto_secretstream_xchacha20poly1305_pull(state, ciphertext, null);
    if (!result || result.tag !== sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL)
      throw new Error("Ente crypto input rejected");
    return owned(result.message);
  };
  return {
    randomBytes(length) {
      active();
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_INPUT)
        throw new Error("Ente crypto input rejected");
      return owned(sodium.randombytes_buf(length));
    },
    sealedBoxKeypair() {
      active();
      const pair = sodium.crypto_box_keypair("uint8array");
      return { publicKey: owned(pair.publicKey), privateKey: owned(pair.privateKey) };
    },
    toBase64,
    fromBase64,
    equal(left, right) {
      active();
      return left.length === right.length && sodium.memcmp(left, right);
    },
    argon2id(password, salt, opsLimit, memLimit, length) {
      active();
      requireBounded(password);
      requireLength(salt, sodium.crypto_pwhash_SALTBYTES);
      if (
        !Number.isSafeInteger(length) ||
        length < 16 ||
        length > 64 ||
        !Number.isSafeInteger(opsLimit) ||
        !Number.isSafeInteger(memLimit)
      )
        throw new Error("Ente crypto input rejected");
      return owned(
        sodium.crypto_pwhash(
          length,
          password,
          salt,
          opsLimit,
          memLimit,
          sodium.crypto_pwhash_ALG_ARGON2ID13,
        ),
      );
    },
    deriveSubkey(key, length, id, context) {
      active();
      requireLength(key, sodium.crypto_kdf_KEYBYTES);
      if (
        !Number.isSafeInteger(length) ||
        length < 16 ||
        length > 64 ||
        !Number.isSafeInteger(id) ||
        id < 0 ||
        !/^[\x20-\x7e]{8}$/u.test(context)
      )
        throw new Error("Ente crypto input rejected");
      return owned(sodium.crypto_kdf_derive_from_key(length, id, context, key));
    },
    sealedBoxSeal(message, publicKey) {
      active();
      requireBounded(message);
      requireLength(publicKey, sodium.crypto_box_PUBLICKEYBYTES);
      return owned(sodium.crypto_box_seal(message, publicKey, "uint8array"));
    },
    sealedBoxOpen(ciphertext, publicKey, privateKey) {
      active();
      requireBounded(ciphertext);
      requireLength(publicKey, sodium.crypto_box_PUBLICKEYBYTES);
      requireLength(privateKey, sodium.crypto_box_SECRETKEYBYTES);
      return owned(sodium.crypto_box_seal_open(ciphertext, publicKey, privateKey));
    },
    secretboxSeal(message, nonce, key) {
      active();
      requireBounded(message);
      requireLength(nonce, sodium.crypto_secretbox_NONCEBYTES);
      requireLength(key, sodium.crypto_secretbox_KEYBYTES);
      return owned(sodium.crypto_secretbox_easy(message, nonce, key));
    },
    secretboxOpen(ciphertext, nonce, key) {
      active();
      requireBounded(ciphertext);
      requireLength(nonce, sodium.crypto_secretbox_NONCEBYTES);
      requireLength(key, sodium.crypto_secretbox_KEYBYTES);
      return owned(sodium.crypto_secretbox_open_easy(ciphertext, nonce, key));
    },
    secretstreamSeal,
    secretstreamOpen,
    encryptAuthEntity(message, key) {
      const result = secretstreamSeal(message, key);
      return { encryptedData: toBase64(result.ciphertext), header: toBase64(result.header) };
    },
    decryptAuthEntity(frame, key) {
      return secretstreamOpen(fromBase64(frame.encryptedData), fromBase64(frame.header), key);
    },
    dispose() {
      disposed = true;
    },
  };
}
