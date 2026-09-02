export {
  decryptLegacyVault,
  decryptLegacyVaultWithDerivedKey,
  deriveLegacyVaultKey,
  inspectLegacyVault,
  LegacyMigrationError,
} from "./crypto";
export type { LegacyMigrationErrorCode } from "./crypto";
export {
  legacyAccountId,
  mapLegacyAccount,
  mapLegacyEnteState,
  parseLegacySettings,
  validateLegacyEnteState,
} from "./migrate";
export type { MigratedLockSettings } from "./migrate";
export {
  LEGACY_PBKDF2_ITERATIONS,
  LegacyAccountSchema,
  LegacyEnteStateSchema,
  LegacyEnvelopeSchema,
  LegacyPlaintextVaultSchema,
  MAX_LEGACY_ACCOUNTS,
  MAX_LEGACY_CIPHERTEXT_BYTES,
  MAX_LEGACY_EPOCH_MS,
  MAX_LEGACY_PASSWORD_UTF8_BYTES,
} from "./schema";
export type {
  LegacyAccount,
  LegacyEnteState,
  LegacyEnvelope,
  LegacyPlaintextVault,
} from "./schema";
