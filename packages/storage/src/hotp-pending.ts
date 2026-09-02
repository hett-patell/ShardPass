import { z } from "zod/mini";

import { canonicalJson } from "./serialization";
import { StorageError } from "./storage-port";

export const MAX_PENDING_HOTP_RESERVATIONS = 100;

export const PendingHotpReservationSchema = z.strictObject({
  reservationId: z.uuid(),
  itemId: z.uuid(),
  expectedRevision: z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER)),
  expectedCounter: z.int().check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER)),
  binding: z.strictObject({
    tabId: z.int().check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER)),
    frameId: z.int().check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER)),
    documentId: z.string().check(z.minLength(1), z.maxLength(512)),
  }),
  createdAt: z.int().check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER)),
  expiresAt: z.int().check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER)),
  sessionEpoch: z.int().check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER)),
  state: z.literal("pending"),
});
export type PendingHotpReservation = z.infer<typeof PendingHotpReservationSchema>;

const PendingHotpReservationsSchema = z.strictObject({
  format: z.literal("shardpass-pending-hotp-reservations"),
  version: z.literal(1),
  reservations: z
    .array(PendingHotpReservationSchema)
    .check(z.maxLength(MAX_PENDING_HOTP_RESERVATIONS)),
});

export function encodePendingHotpReservations(
  values: readonly PendingHotpReservation[],
): Uint8Array {
  try {
    const reservations = [...values].sort((left, right) =>
      left.reservationId.localeCompare(right.reservationId),
    );
    return new TextEncoder().encode(
      canonicalJson(
        PendingHotpReservationsSchema.parse({
          format: "shardpass-pending-hotp-reservations",
          version: 1,
          reservations,
        }),
      ),
    );
  } catch {
    throw new StorageError("VAULT_INVALID");
  }
}

export function decodePendingHotpReservations(
  value: Uint8Array,
): readonly PendingHotpReservation[] {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(value);
    const parsed = PendingHotpReservationsSchema.parse(JSON.parse(decoded));
    if (decoded !== canonicalJson(parsed)) throw new Error("noncanonical");
    if (
      new Set(parsed.reservations.map((entry) => entry.reservationId)).size !==
      parsed.reservations.length
    )
      throw new Error("duplicate");
    return parsed.reservations;
  } catch {
    throw new StorageError("STORAGE_CORRUPT");
  }
}
