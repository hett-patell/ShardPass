import {
  MAX_ARGON2_MEMORY_KIB,
  MAX_ARGON2_PARALLELISM,
  MIN_ARGON2_MEMORY_KIB,
} from "@shardpass/storage";

export const MAX_PASSWORD_UTF8_BYTES = 1024;
export const ARGON2ID_SALT_BYTES = 16;
export const KEY_ENCRYPTION_KEY_BYTES = 32;

export interface Argon2idWorkParameters {
  readonly algorithm: "argon2id";
  readonly memoryKiB: number;
  readonly iterations: number;
  readonly parallelism: number;
}

export interface KdfRequestData {
  readonly password: Uint8Array;
  readonly salt: Uint8Array;
  readonly parameters: Argon2idWorkParameters;
}

export interface KdfRequest extends KdfRequestData {
  readonly signal?: AbortSignal;
  readonly onStarted?: () => void;
}

export interface KdfExecutor {
  derive(request: KdfRequest): Promise<Uint8Array>;
}

export const DEFAULT_ARGON2ID_PARAMETERS: Readonly<Argon2idWorkParameters> = Object.freeze({
  algorithm: "argon2id",
  memoryKiB: 65_536,
  iterations: 2,
  parallelism: 1,
});

function validInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

export function validateArgon2idWorkParameters(candidate: unknown): Argon2idWorkParameters {
  if (typeof candidate !== "object" || candidate === null) {
    throw new RangeError("Argon2id parameters are invalid.");
  }
  const value = candidate as Record<string, unknown>;
  if (
    value.algorithm !== "argon2id" ||
    !validInteger(value.memoryKiB, MIN_ARGON2_MEMORY_KIB, MAX_ARGON2_MEMORY_KIB) ||
    !validInteger(value.iterations, 1, 10) ||
    !validInteger(value.parallelism, 1, MAX_ARGON2_PARALLELISM) ||
    Number(value.memoryKiB) < 8 * Number(value.parallelism)
  ) {
    throw new RangeError("Argon2id parameters are outside supported bounds.");
  }
  return {
    algorithm: "argon2id",
    memoryKiB: Number(value.memoryKiB),
    iterations: Number(value.iterations),
    parallelism: Number(value.parallelism),
  };
}

export function validateKdfRequestData(candidate: KdfRequestData): KdfRequestData {
  if (
    !(candidate.password instanceof Uint8Array) ||
    candidate.password.byteLength > MAX_PASSWORD_UTF8_BYTES
  ) {
    throw new RangeError(`Password must be at most ${MAX_PASSWORD_UTF8_BYTES} UTF-8 bytes.`);
  }
  if (
    !(candidate.salt instanceof Uint8Array) ||
    candidate.salt.byteLength !== ARGON2ID_SALT_BYTES
  ) {
    throw new RangeError(`Argon2id salt must be ${ARGON2ID_SALT_BYTES} bytes.`);
  }
  return {
    password: candidate.password,
    salt: candidate.salt,
    parameters: validateArgon2idWorkParameters(candidate.parameters),
  };
}

export async function deriveKeyEncryptionKey(
  executor: KdfExecutor,
  password: string | Uint8Array,
  parameters: Argon2idWorkParameters,
  salt: Uint8Array,
  options: Readonly<{ signal?: AbortSignal; onStarted?: () => void }> = {},
): Promise<Uint8Array> {
  const encoded = typeof password === "string" ? new TextEncoder().encode(password) : password;
  const request = validateKdfRequestData({ password: encoded, salt, parameters });
  const result = await executor.derive({ ...request, ...options });
  if (!(result instanceof Uint8Array) || result.byteLength !== KEY_ENCRYPTION_KEY_BYTES) {
    throw new Error("KDF executor must return a 32-byte key.");
  }
  return result;
}
