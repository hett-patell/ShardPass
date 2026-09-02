import type { OtpItem } from "@shardpass/domain";
import { describe, expect, it, vi } from "vitest";

import {
  HotpCommitError,
  HotpReservationService,
  type HotpCounterCommitter,
  type ReservationBinding,
} from "../src";

const binding: ReservationBinding = { tabId: 7, frameId: 0, documentId: "document-a" };
const otherBinding: ReservationBinding = { ...binding, documentId: "document-b" };
const item: OtpItem = {
  id: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
  schemaVersion: 2,
  revision: 4,
  createdAt: "2026-07-29T10:20:30.000Z",
  updatedAt: "2026-07-29T10:20:30.000Z",
  favorite: false,
  tags: [],
  kind: "otp",
  issuer: "RFC",
  label: "counter",
  secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  otpType: "hotp",
  algorithm: "SHA1",
  digits: 6,
  period: 0,
  counter: 0,
  note: "",
};

function service(committer: HotpCounterCommitter, now = { value: 1_000 }) {
  let id = 1;
  return {
    now,
    reservations: new HotpReservationService({
      committer,
      clock: { now: () => now.value },
      random: {
        uuid: () => `018f47a6-7d11-7c2f-8bd9-${String(id++).padStart(12, "0")}`,
      },
    }),
  };
}

describe("HOTP reservations", () => {
  it("binds a generated code to exact sender identity for 30 seconds", async () => {
    const committer: HotpCounterCommitter = { commit: vi.fn() };
    const { reservations } = service(committer);
    const reservation = await reservations.reserveHotp(item, binding);
    expect(reservation).toMatchObject({
      code: "755224",
      counter: 0,
      itemRevision: 4,
      expiresAt: 31_000,
    });
    expect(reservation.reservationId).toMatch(/^[0-9a-f-]{36}$/u);
    await expect(
      reservations.commitHotpReservation(reservation.reservationId, otherBinding),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_BINDING" });
  });

  it("keeps the active mapping owned by a committing reservation", async () => {
    let resolve!: (value: { revision: number; counter: number }) => void;
    const commit = vi.fn(
      () =>
        new Promise<{ revision: number; counter: number }>((done) => {
          resolve = done;
        }),
    );
    const { reservations } = service({ commit });
    const first = await reservations.reserveHotp(item, binding);
    const committing = reservations.commitHotpReservation(first.reservationId, binding);

    await expect(reservations.reserveHotp(item, otherBinding)).rejects.toMatchObject({
      code: "OTP_RESERVATION_BUSY",
    });
    resolve({ revision: 5, counter: 1 });
    await expect(committing).resolves.toEqual({ revision: 5, counter: 1 });
    await expect(reservations.commitHotpReservation(first.reservationId, binding)).resolves.toEqual(
      { revision: 5, counter: 1 },
    );

    const next = await reservations.reserveHotp({ ...item, revision: 5, counter: 1 }, otherBinding);
    expect(next.counter).toBe(1);
  });

  it("commits concurrent duplicates once and returns the cached result", async () => {
    let resolve!: (value: { revision: number; counter: number }) => void;
    const commit = vi.fn(
      () =>
        new Promise<{ revision: number; counter: number }>((done) => {
          resolve = done;
        }),
    );
    const { reservations } = service({ commit });
    const reserved = await reservations.reserveHotp(item, binding);
    const first = reservations.commitHotpReservation(reserved.reservationId, binding);
    const duplicate = reservations.commitHotpReservation(reserved.reservationId, binding);
    resolve({ revision: 5, counter: 1 });
    await expect(first).resolves.toEqual({ revision: 5, counter: 1 });
    await expect(duplicate).resolves.toEqual({ revision: 5, counter: 1 });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("resets pending after definitely-not-committed and preserves unknown outcome", async () => {
    const commit = vi
      .fn()
      .mockRejectedValueOnce(new HotpCommitError("not-committed"))
      .mockRejectedValueOnce(new HotpCommitError("unknown-outcome"));
    const { reservations } = service({ commit });
    const reserved = await reservations.reserveHotp(item, binding);
    await expect(
      reservations.commitHotpReservation(reserved.reservationId, binding),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_STALE" });
    await expect(
      reservations.commitHotpReservation(reserved.reservationId, binding),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_UNCERTAIN" });
    commit.mockResolvedValueOnce({ revision: 5, counter: 1 });
    await expect(
      reservations.commitHotpReservation(reserved.reservationId, binding),
    ).resolves.toEqual({ revision: 5, counter: 1 });
    expect(commit).toHaveBeenCalledTimes(3);
  });

  it("cancels superseded, explicit, and expired reservations without committing", async () => {
    const commit = vi.fn();
    const { reservations, now } = service({ commit });
    const first = await reservations.reserveHotp(item, binding);
    const second = await reservations.reserveHotp(item, otherBinding);
    await expect(
      reservations.commitHotpReservation(first.reservationId, binding),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_NOT_FOUND" });
    expect(reservations.cancelHotpReservation(second.reservationId, otherBinding)).toBe(true);
    expect(reservations.cancelHotpReservation(second.reservationId, otherBinding)).toBe(false);
    const expired = await reservations.reserveHotp(item, binding);
    now.value = expired.expiresAt;
    await expect(
      reservations.commitHotpReservation(expired.reservationId, binding),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_EXPIRED" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("retains committed duplicates for 60 seconds then prunes terminal entries", async () => {
    const commit = vi.fn().mockResolvedValue({ revision: 5, counter: 1 });
    const { reservations, now } = service({ commit });
    const reserved = await reservations.reserveHotp(item, binding);
    await reservations.commitHotpReservation(reserved.reservationId, binding);
    now.value += 59_999;
    await expect(
      reservations.commitHotpReservation(reserved.reservationId, binding),
    ).resolves.toEqual({ revision: 5, counter: 1 });
    expect(commit).toHaveBeenCalledTimes(1);
    now.value += 1;
    await expect(
      reservations.commitHotpReservation(reserved.reservationId, binding),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_NOT_FOUND" });
  });

  it("retains uncertain reservations for five minutes then prunes them", async () => {
    const commit = vi.fn().mockRejectedValue(new HotpCommitError("unknown-outcome"));
    const { reservations, now } = service({ commit });
    const reserved = await reservations.reserveHotp(item, binding);
    await expect(
      reservations.commitHotpReservation(reserved.reservationId, binding),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_UNCERTAIN" });
    now.value += 300_000;
    await expect(
      reservations.commitHotpReservation(reserved.reservationId, binding),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_NOT_FOUND" });
  });

  it("supports more than 100 completed cycles as terminal entries expire", async () => {
    const commit = vi.fn().mockResolvedValue({ revision: 2, counter: 1 });
    const { reservations, now } = service({ commit });
    for (let index = 0; index < 101; index += 1) {
      const candidate = {
        ...item,
        id: `018f47a6-7d11-7c2f-8bd9-${String(index).padStart(12, "0")}`,
      };
      const reserved = await reservations.reserveHotp(candidate, binding);
      await reservations.commitHotpReservation(reserved.reservationId, binding);
      now.value += 60_000;
    }
    expect(commit).toHaveBeenCalledTimes(101);
  });

  it("enforces a bounded in-memory reservation count", async () => {
    const { reservations } = service({ commit: vi.fn() });
    const items = Array.from({ length: 101 }, (_, index) => ({
      ...item,
      id: `018f47a6-7d11-7c2f-8bd9-${String(index).padStart(12, "0")}`,
    }));
    for (const candidate of items.slice(0, 100)) await reservations.reserveHotp(candidate, binding);
    await expect(reservations.reserveHotp(items[100]!, binding)).rejects.toMatchObject({
      code: "OTP_RESERVATION_CAPACITY",
    });
  });

  it("treats pending expiry immediately before, at, and after the boundary exactly", async () => {
    const commit = vi.fn().mockResolvedValue({ revision: 5, counter: 1 });
    const before = service({ commit });
    const beforeReservation = await before.reservations.reserveHotp(item, binding);
    before.now.value = beforeReservation.expiresAt - 1;
    await expect(
      before.reservations.commitHotpReservation(beforeReservation.reservationId, binding),
    ).resolves.toEqual({ revision: 5, counter: 1 });

    for (const offset of [0, 1]) {
      const boundary = service({ commit: vi.fn() });
      const reservation = await boundary.reservations.reserveHotp(item, binding);
      boundary.now.value = reservation.expiresAt + offset;
      await expect(
        boundary.reservations.commitHotpReservation(reservation.reservationId, binding),
      ).rejects.toMatchObject({ code: "OTP_RESERVATION_EXPIRED" });
    }
  });

  it("clears all reservations without committing and invalidates retained identities", async () => {
    const commit = vi.fn();
    const { reservations } = service({ commit });
    const first = await reservations.reserveHotp(item, binding);
    const second = await reservations.reserveHotp(
      { ...item, id: "018f47a6-7d11-7c2f-8bd9-a1d37f147a21" },
      otherBinding,
    );

    reservations.clear();

    await expect(
      reservations.commitHotpReservation(first.reservationId, binding),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_NOT_FOUND" });
    expect(reservations.cancelHotpReservation(second.reservationId, otherBinding)).toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });

  it("does not prune an in-flight commit when making capacity available", async () => {
    let resolve!: (value: { revision: number; counter: number }) => void;
    const commit = vi.fn(
      () =>
        new Promise<{ revision: number; counter: number }>((done) => {
          resolve = done;
        }),
    );
    const { reservations, now } = service({ commit });
    const first = await reservations.reserveHotp(item, binding);
    const committing = reservations.commitHotpReservation(first.reservationId, binding);
    for (let index = 1; index < 100; index += 1) {
      await reservations.reserveHotp(
        {
          ...item,
          id: `018f47a6-7d11-7c2f-8bd9-${String(index).padStart(12, "0")}`,
        },
        binding,
      );
    }
    now.value += 30_000;
    await reservations.reserveHotp(
      { ...item, id: "018f47a6-7d11-7c2f-8bd9-a1d37f147a99" },
      binding,
    );
    resolve({ revision: 5, counter: 1 });

    await expect(committing).resolves.toEqual({ revision: 5, counter: 1 });
    await expect(reservations.commitHotpReservation(first.reservationId, binding)).resolves.toEqual(
      { revision: 5, counter: 1 },
    );
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent replacement reservations for one item", async () => {
    const { reservations } = service({ commit: vi.fn() });
    const [first, second] = await Promise.all([
      reservations.reserveHotp(item, binding),
      reservations.reserveHotp(item, otherBinding),
    ]);

    const outcomes = [
      reservations.cancelHotpReservation(first.reservationId, binding),
      reservations.cancelHotpReservation(second.reservationId, otherBinding),
    ];
    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });
});
