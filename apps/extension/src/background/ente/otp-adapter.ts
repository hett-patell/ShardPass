import { canonicalJson } from "@shardpass/storage";

import { EnteProtocolError, ENTE_SYNC_LIMITS, type EnteOtpProjection } from "./protocol";
import { enteOtpProjectionSchema } from "./schemas";
import type { AuthEntityFrame, EnteSodiumAdapter } from "./sodium-adapter";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
export type EnteEncryptedOtpEntity = AuthEntityFrame & Readonly<{ version: 1 }>;

function validateProjection(input: unknown): EnteOtpProjection {
  try {
    const value = enteOtpProjectionSchema.parse(input);
    if (
      !value.issuer ||
      !value.label ||
      encoder.encode(value.issuer).length > 1024 ||
      encoder.encode(value.label).length > 1024
    )
      throw new Error();
    if (value.otpType === "hotp") {
      if (value.counter === undefined || value.period !== undefined) throw new Error();
    } else if (value.counter !== undefined) throw new Error();
    if (value.otpType === "steam" && (value.algorithm !== "SHA1" || value.digits !== 6))
      throw new Error();
    return {
      version: 1,
      kind: "otp",
      otpType: value.otpType,
      issuer: value.issuer,
      label: value.label,
      secretBase32: value.secretBase32,
      algorithm: value.algorithm,
      digits: value.digits,
      ...(value.period === undefined ? {} : { period: value.period }),
      ...(value.counter === undefined ? {} : { counter: value.counter }),
      ...(value.notes === undefined ? {} : { notes: value.notes }),
      ...(value.tags === undefined ? {} : { tags: value.tags }),
    };
  } catch {
    throw new EnteProtocolError("ENTE_INVALID");
  }
}
export function encryptEnteOtpEntity(
  projection: EnteOtpProjection,
  authKey: Uint8Array,
  sodium: EnteSodiumAdapter,
): AuthEntityFrame {
  const owned = validateProjection(projection);
  const plaintext = encoder.encode(canonicalJson(owned));
  if (plaintext.byteLength > ENTE_SYNC_LIMITS.maxDecryptedEntityBytes)
    throw new EnteProtocolError("ENTE_LIMIT_REACHED");
  try {
    return sodium.encryptAuthEntity(plaintext, authKey);
  } catch {
    throw new EnteProtocolError("ENTE_INVALID");
  } finally {
    plaintext.fill(0);
  }
}
export function parseEnteOtpEntity(
  entity: EnteEncryptedOtpEntity,
  authKey: Uint8Array,
  sodium: EnteSodiumAdapter,
): EnteOtpProjection {
  if (entity.version !== 1) throw new EnteProtocolError("ENTE_INVALID");
  let plaintext: Uint8Array | undefined;
  try {
    plaintext = sodium.decryptAuthEntity(entity, authKey);
    if (plaintext.byteLength > ENTE_SYNC_LIMITS.maxDecryptedEntityBytes) throw new Error();
    const text = decoder.decode(plaintext);
    const parsed = validateProjection(JSON.parse(text));
    if (canonicalJson(parsed) !== text) throw new Error();
    return parsed;
  } catch (error) {
    if (error instanceof EnteProtocolError) throw error;
    throw new EnteProtocolError("ENTE_INVALID");
  } finally {
    plaintext?.fill(0);
  }
}
