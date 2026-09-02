import { OtpItemSchema, type OtpItem } from "@shardpass/domain";
import { sha256 } from "@noble/hashes/sha2.js";

import { LegacyMigrationError } from "./crypto";
import { LegacyAccountSchema, LegacyEnteStateSchema, type LegacyEnteState } from "./schema";

export type MigratedLockSettings = Readonly<{
  autoLockMinutes: number;
  lockOnScreenLock: boolean;
}>;

export function mapLegacyAccount(candidate: unknown): OtpItem {
  const parsed = LegacyAccountSchema.safeParse(candidate);
  if (!parsed.success) throw new LegacyMigrationError("UNSUPPORTED_LEGACY_RECORD");
  const account = parsed.data;
  const otpType = account.type ?? "totp";
  const mapped = {
    id: legacyAccountId(account.id),
    schemaVersion: 2 as const,
    revision: 1,
    createdAt: new Date(account.createdAt).toISOString(),
    updatedAt: new Date(account.createdAt).toISOString(),
    favorite: false,
    tags: account.tags ?? [],
    kind: "otp" as const,
    issuer: account.issuer,
    label: account.label,
    secret: normalizeBase32(account.secret),
    otpType,
    algorithm: account.algorithm,
    digits: account.digits,
    period: otpType === "hotp" ? 0 : account.period,
    ...(otpType === "hotp" ? { counter: account.counter } : {}),
    note: account.note ?? "",
  };
  const result = OtpItemSchema.safeParse(mapped);
  if (!result.success) throw new LegacyMigrationError("UNSUPPORTED_LEGACY_RECORD");
  return result.data;
}

export function validateLegacyEnteState(candidate: unknown): LegacyEnteState {
  const parsed = LegacyEnteStateSchema.safeParse(candidate);
  if (!parsed.success) throw new LegacyMigrationError("UNSUPPORTED_LEGACY_RECORD");
  const state = parsed.data;
  const mappings = Object.entries(state.entityMap);
  if (new Set(mappings.map(([, accountId]) => accountId)).size !== mappings.length)
    throw new LegacyMigrationError("UNSUPPORTED_LEGACY_RECORD");
  const pendingKeys = new Set<string>();
  const deletedTargets = new Set<string>();
  for (const operation of state.pending ?? []) {
    const pendingKey = `${operation.op}\0${operation.accountId}\0${operation.enteId ?? ""}`;
    if (pendingKeys.has(pendingKey)) throw new LegacyMigrationError("UNSUPPORTED_LEGACY_RECORD");
    pendingKeys.add(pendingKey);
    const targetKey = `${operation.accountId}\0${operation.enteId ?? ""}`;
    if (deletedTargets.has(targetKey)) throw new LegacyMigrationError("UNSUPPORTED_LEGACY_RECORD");
    if (operation.op === "delete") deletedTargets.add(targetKey);
    const mappedAccount =
      operation.enteId === undefined ? undefined : state.entityMap[operation.enteId];
    if (
      operation.op === "create"
        ? operation.enteId !== undefined || mappings.some(([, id]) => id === operation.accountId)
        : operation.enteId === undefined || mappedAccount !== operation.accountId
    )
      throw new LegacyMigrationError("UNSUPPORTED_LEGACY_RECORD");
  }
  return state;
}

export function mapLegacyEnteState(candidate: LegacyEnteState): LegacyEnteState {
  const state = validateLegacyEnteState(candidate);
  const entityMap = Object.fromEntries(
    Object.entries(state.entityMap).map(([remoteId, accountId]) => [
      remoteId,
      legacyAccountId(accountId),
    ]),
  );
  const pending = state.pending?.map((operation) => ({
    ...operation,
    accountId: legacyAccountId(operation.accountId),
  }));
  return { ...state, entityMap, ...(pending === undefined ? {} : { pending }) };
}

export function parseLegacySettings(candidate: unknown): MigratedLockSettings {
  if (typeof candidate !== "object" || candidate === null || Object.keys(candidate).length !== 2)
    throw new LegacyMigrationError("UNSUPPORTED_LEGACY_SETTINGS");
  const value = candidate as { autoLockMinutes?: unknown; lockOnScreenLock?: unknown };
  if (
    !Number.isSafeInteger(value.autoLockMinutes) ||
    (value.autoLockMinutes as number) < 0 ||
    (value.autoLockMinutes as number) > 1_440 ||
    typeof value.lockOnScreenLock !== "boolean"
  )
    throw new LegacyMigrationError("UNSUPPORTED_LEGACY_SETTINGS");
  return value as MigratedLockSettings;
}

export function legacyAccountId(value: string): string {
  const digest = sha256(new TextEncoder().encode(`shardpass:legacy-v1:account:${value}`)).slice(
    0,
    16,
  );
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeBase32(value: string): string {
  return value.replace(/[\s=-]/g, "").toUpperCase();
}
