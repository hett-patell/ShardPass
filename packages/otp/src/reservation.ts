import { OtpItemSchema, type OtpItem } from "@shardpass/domain";

import { OtpError } from "./error";
import { generateOtp } from "./totp";

export const HOTP_RESERVATION_TTL_MS = 30_000;
export const HOTP_COMMITTED_RETENTION_MS = 60_000;
export const HOTP_UNCERTAIN_RETENTION_MS = 5 * 60_000;
export const MAX_HOTP_RESERVATIONS = 100;

export interface ReservationBinding {
  readonly tabId: number;
  readonly frameId: number;
  readonly documentId: string;
}

export interface HotpCommitRequest {
  readonly itemId: string;
  readonly expectedRevision: number;
  readonly expectedCounter: number;
  readonly reservationId: string;
}
export interface HotpCommitResult {
  readonly revision: number;
  readonly counter: number;
}
export interface HotpCounterCommitter {
  commit(request: HotpCommitRequest): Promise<HotpCommitResult>;
}

export class HotpCommitError extends Error {
  readonly outcome: "not-committed" | "unknown-outcome";
  constructor(outcome: "not-committed" | "unknown-outcome") {
    super("HOTP_COMMIT_FAILED");
    this.name = "HotpCommitError";
    this.outcome = outcome;
  }
}

export interface HotpReservation {
  readonly reservationId: string;
  readonly code: string;
  readonly counter: number;
  readonly itemRevision: number;
  readonly expiresAt: number;
}

type EntryState =
  | { readonly kind: "pending" }
  | { readonly kind: "committing"; readonly promise: Promise<HotpCommitResult> }
  | {
      readonly kind: "committed";
      readonly result: HotpCommitResult;
      readonly terminalExpiresAt: number;
    }
  | { readonly kind: "uncertain"; readonly terminalExpiresAt: number };
interface Entry extends Omit<HotpReservation, "code"> {
  code: string;
  readonly itemId: string;
  readonly binding: ReservationBinding;
  state: EntryState;
}

export class HotpReservationService {
  private readonly entries = new Map<string, Entry>();
  private readonly activeByItem = new Map<string, string>();
  private reservationQueue: Promise<void> = Promise.resolve();
  private clearEpoch = 0;

  constructor(
    private readonly dependencies: {
      readonly committer: HotpCounterCommitter;
      readonly clock: { now(): number };
      readonly random: { uuid(): string };
    },
  ) {}

  reserveHotp(candidate: OtpItem, binding: ReservationBinding): Promise<HotpReservation> {
    const queued = this.reservationQueue.then(() => this.reserveHotpQueued(candidate, binding));
    this.reservationQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  clear(): void {
    this.clearEpoch += 1;
    for (const entry of this.entries.values()) entry.code = "";
    this.entries.clear();
    this.activeByItem.clear();
  }

  private async reserveHotpQueued(
    candidate: OtpItem,
    binding: ReservationBinding,
  ): Promise<HotpReservation> {
    const operationClearEpoch = this.clearEpoch;
    const parsed = OtpItemSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.otpType !== "hotp") throw new OtpError("OTP_INVALID_ITEM");
    validateBinding(binding);
    this.pruneExpired();
    const previousId = this.activeByItem.get(parsed.data.id);
    const previous = previousId === undefined ? undefined : this.entries.get(previousId);
    if (previous !== undefined && previous.state.kind !== "pending")
      throw new OtpError("OTP_RESERVATION_BUSY");
    if (previous === undefined && this.entries.size >= MAX_HOTP_RESERVATIONS)
      throw new OtpError("OTP_RESERVATION_CAPACITY");

    const reservationId = this.dependencies.random.uuid();
    if (!UUID.test(reservationId) || this.entries.has(reservationId))
      throw new OtpError("OTP_INVALID_ITEM");
    const counter = parsed.data.counter;
    if (counter === undefined) throw new OtpError("OTP_INVALID_ITEM");
    const generated = await generateOtp(parsed.data, this.dependencies.clock.now());
    if (operationClearEpoch !== this.clearEpoch) throw new OtpError("OTP_RESERVATION_NOT_FOUND");
    const reservation: Entry = {
      reservationId,
      code: generated.code,
      counter,
      itemRevision: parsed.data.revision,
      expiresAt: this.dependencies.clock.now() + HOTP_RESERVATION_TTL_MS,
      itemId: parsed.data.id,
      binding: { ...binding },
      state: { kind: "pending" },
    };
    if (previous !== undefined) this.entries.delete(previous.reservationId);
    this.entries.set(reservationId, reservation);
    this.activeByItem.set(parsed.data.id, reservationId);
    return publicReservation(reservation);
  }

  restorePendingHotpReservation(input: {
    readonly reservationId: string;
    readonly itemId: string;
    readonly itemRevision: number;
    readonly counter: number;
    readonly expiresAt: number;
    readonly binding: ReservationBinding;
  }): void {
    validateBinding(input.binding);
    if (!UUID.test(input.reservationId)) throw new OtpError("OTP_INVALID_ITEM");
    const existing = this.entries.get(input.reservationId);
    if (existing !== undefined) return;
    this.entries.set(input.reservationId, {
      ...input,
      code: "",
      binding: { ...input.binding },
      state: { kind: "pending" },
    });
    this.activeByItem.set(input.itemId, input.reservationId);
  }

  commitHotpReservation(
    reservationId: string,
    binding: ReservationBinding,
  ): Promise<HotpCommitResult> {
    const entry = this.entries.get(reservationId);
    if (entry === undefined) return Promise.reject(new OtpError("OTP_RESERVATION_NOT_FOUND"));
    if (!sameBinding(entry.binding, binding))
      return Promise.reject(new OtpError("OTP_RESERVATION_BINDING"));
    if (entry.state.kind === "committed") {
      if (this.dependencies.clock.now() >= entry.state.terminalExpiresAt) {
        this.remove(entry);
        return Promise.reject(new OtpError("OTP_RESERVATION_NOT_FOUND"));
      }
      return Promise.resolve(entry.state.result);
    }
    if (entry.state.kind === "committing") return entry.state.promise;
    if (entry.state.kind === "uncertain") {
      if (this.dependencies.clock.now() >= entry.state.terminalExpiresAt) {
        this.remove(entry);
        return Promise.reject(new OtpError("OTP_RESERVATION_NOT_FOUND"));
      }
    } else if (this.dependencies.clock.now() >= entry.expiresAt) {
      this.remove(entry);
      return Promise.reject(new OtpError("OTP_RESERVATION_EXPIRED"));
    }

    const promise = this.dependencies.committer
      .commit({
        itemId: entry.itemId,
        expectedRevision: entry.itemRevision,
        expectedCounter: entry.counter,
        reservationId: entry.reservationId,
      })
      .then((result) => {
        entry.code = "";
        entry.state = {
          kind: "committed",
          result,
          terminalExpiresAt: this.dependencies.clock.now() + HOTP_COMMITTED_RETENTION_MS,
        };
        this.deleteActiveIfOwned(entry);
        return result;
      })
      .catch((error: unknown) => {
        if (error instanceof HotpCommitError && error.outcome === "not-committed") {
          entry.state = { kind: "pending" };
          throw new OtpError("OTP_RESERVATION_STALE");
        }
        entry.code = "";
        entry.state = {
          kind: "uncertain",
          terminalExpiresAt: this.dependencies.clock.now() + HOTP_UNCERTAIN_RETENTION_MS,
        };
        throw new OtpError("OTP_RESERVATION_UNCERTAIN");
      });
    entry.state = { kind: "committing", promise };
    return promise;
  }

  cancelHotpReservation(reservationId: string, binding: ReservationBinding): boolean {
    const entry = this.entries.get(reservationId);
    if (
      entry === undefined ||
      !sameBinding(entry.binding, binding) ||
      entry.state.kind !== "pending"
    )
      return false;
    this.remove(entry);
    return true;
  }

  private pruneExpired(): void {
    const now = this.dependencies.clock.now();
    for (const entry of this.entries.values()) {
      if (entry.state.kind === "committing") continue;
      const expiry =
        entry.state.kind === "pending" ? entry.expiresAt : entry.state.terminalExpiresAt;
      if (now >= expiry) this.remove(entry);
    }
  }
  private remove(entry: Entry): void {
    entry.code = "";
    this.entries.delete(entry.reservationId);
    this.deleteActiveIfOwned(entry);
  }
  private deleteActiveIfOwned(entry: Entry): void {
    if (this.activeByItem.get(entry.itemId) === entry.reservationId)
      this.activeByItem.delete(entry.itemId);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function validateBinding(binding: ReservationBinding): void {
  if (
    !Number.isSafeInteger(binding.tabId) ||
    binding.tabId < 0 ||
    !Number.isSafeInteger(binding.frameId) ||
    binding.frameId < 0 ||
    binding.documentId.length === 0 ||
    binding.documentId.length > 512
  )
    throw new OtpError("OTP_RESERVATION_BINDING");
}
function sameBinding(left: ReservationBinding, right: ReservationBinding): boolean {
  return (
    left.tabId === right.tabId &&
    left.frameId === right.frameId &&
    left.documentId === right.documentId
  );
}
function publicReservation(entry: Entry): HotpReservation {
  return {
    reservationId: entry.reservationId,
    code: entry.code,
    counter: entry.counter,
    itemRevision: entry.itemRevision,
    expiresAt: entry.expiresAt,
  };
}
