import { OtpItemSchema } from "@shardpass/domain";
import type { HotpReservationService, ReservationBinding } from "@shardpass/otp";
import type { HotpReservationCommitResult } from "@shardpass/storage";

import type { SessionVaultRepository } from "../vault/session-vault-repository";

export type InternalHotpRelease = Readonly<{
  reservationId: string;
  itemId: string;
  itemRevision: number;
  code: string;
  expiresAt: number;
}>;

export interface InternalHotpLifecycle {
  reserve(
    itemId: string,
    expectedRevision: number,
    binding: ReservationBinding,
  ): Promise<InternalHotpRelease>;
  confirm(reservationId: string, binding: ReservationBinding): Promise<HotpReservationCommitResult>;
  cancel(reservationId: string, binding: ReservationBinding): Promise<boolean>;
}

export class InternalHotpLifecycleError extends Error {
  constructor(readonly code: "OTP_FILL_INVALID" | "OTP_FILL_ITEM_CHANGED" | "OTP_FILL_UNCERTAIN") {
    super(code);
    this.name = "InternalHotpLifecycleError";
  }
}

type HotpRepository = Pick<
  SessionVaultRepository,
  "get" | "savePendingHotpReservation" | "commitHotpReservation" | "cancelHotpReservation"
>;

type Dependencies = Readonly<{
  repository: HotpRepository;
  reservations: HotpReservationService;
  now(): number;
}>;

export function createInternalHotpLifecycle(dependencies: Dependencies): InternalHotpLifecycle {
  const bindings = new Map<string, ReservationBinding>();
  const committed = new Map<string, HotpReservationCommitResult>();
  return Object.freeze({
    async reserve(itemId: string, expectedRevision: number, binding: ReservationBinding) {
      try {
        const candidate = await dependencies.repository.get(itemId);
        const parsed = OtpItemSchema.safeParse(candidate);
        if (
          !parsed.success ||
          parsed.data.deletedAt !== undefined ||
          parsed.data.otpType !== "hotp" ||
          parsed.data.revision !== expectedRevision
        )
          throw new InternalHotpLifecycleError("OTP_FILL_ITEM_CHANGED");
        const reserved = await dependencies.reservations.reserveHotp(parsed.data, binding);
        const current = OtpItemSchema.safeParse(await dependencies.repository.get(itemId));
        if (
          !current.success ||
          current.data.deletedAt !== undefined ||
          current.data.revision !== reserved.itemRevision ||
          current.data.counter !== reserved.counter
        ) {
          dependencies.reservations.cancelHotpReservation(reserved.reservationId, binding);
          throw new InternalHotpLifecycleError("OTP_FILL_ITEM_CHANGED");
        }
        await dependencies.repository.savePendingHotpReservation({
          reservationId: reserved.reservationId,
          itemId,
          expectedRevision: reserved.itemRevision,
          expectedCounter: reserved.counter,
          binding,
          createdAt: dependencies.now(),
          expiresAt: reserved.expiresAt,
          state: "pending",
        });
        bindings.set(reserved.reservationId, Object.freeze({ ...binding }));
        return Object.freeze({
          reservationId: reserved.reservationId,
          itemId,
          itemRevision: reserved.itemRevision,
          code: reserved.code,
          expiresAt: reserved.expiresAt,
        });
      } catch (error) {
        throw map(error);
      }
    },
    async confirm(reservationId: string, binding: ReservationBinding) {
      const expected = bindings.get(reservationId);
      if (expected !== undefined && !sameBinding(expected, binding))
        throw new InternalHotpLifecycleError("OTP_FILL_INVALID");
      const existing = committed.get(reservationId);
      if (existing !== undefined) return existing;
      try {
        const result = await dependencies.repository.commitHotpReservation(reservationId, binding);
        committed.set(reservationId, Object.freeze({ ...result }));
        bindings.delete(reservationId);
        return result;
      } catch (error) {
        throw map(error);
      }
    },
    async cancel(reservationId: string, binding: ReservationBinding) {
      const expected = bindings.get(reservationId);
      if (expected !== undefined && !sameBinding(expected, binding))
        throw new InternalHotpLifecycleError("OTP_FILL_INVALID");
      const ephemeral = dependencies.reservations.cancelHotpReservation(reservationId, binding);
      try {
        const durable = await dependencies.repository.cancelHotpReservation(reservationId, binding);
        if (ephemeral || durable) bindings.delete(reservationId);
        return ephemeral || durable;
      } catch (error) {
        throw map(error);
      }
    },
  });
}

function sameBinding(left: ReservationBinding, right: ReservationBinding): boolean {
  return (
    left.tabId === right.tabId &&
    left.frameId === right.frameId &&
    left.documentId === right.documentId
  );
}

function map(error: unknown): InternalHotpLifecycleError {
  if (error instanceof InternalHotpLifecycleError) return error;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (code === "OTP_RESERVATION_UNCERTAIN")
    return new InternalHotpLifecycleError("OTP_FILL_UNCERTAIN");
  if (code === "REVISION_CONFLICT" || code === "OTP_RESERVATION_STALE")
    return new InternalHotpLifecycleError("OTP_FILL_ITEM_CHANGED");
  return new InternalHotpLifecycleError("OTP_FILL_INVALID");
}
