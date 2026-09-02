import type { OtpItem } from "@shardpass/domain";
import { HotpReservationService, type ReservationBinding } from "@shardpass/otp";
import { describe, expect, it } from "vitest";

import { createInternalHotpLifecycle } from "../../src/background/otp/hotp-lifecycle";

const itemId = "018f47a6-7d11-7c2f-8bd9-a1d37f147a20";
const binding: ReservationBinding = { tabId: 7, frameId: 0, documentId: "document-a" };
const item: OtpItem = {
  id: itemId,
  schemaVersion: 2,
  revision: 1,
  createdAt: "2026-08-10T12:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
  favorite: false,
  tags: [],
  kind: "otp",
  issuer: "Example",
  label: "Account",
  secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  otpType: "hotp",
  algorithm: "SHA1",
  digits: 6,
  period: 0,
  counter: 7,
  note: "",
};

describe("internal OTP fill HOTP lifecycle", () => {
  it("keeps reservation identifiers internal and confirms durably and idempotently", async () => {
    const pending = new Map<string, { binding: ReservationBinding }>();
    let counter = 7;
    let revision = 1;
    let commits = 0;
    const reservations = new HotpReservationService({
      clock: { now: () => 1_000 },
      random: { uuid: () => "018f47a6-7d11-7c2f-8bd9-a1d37f147a30" },
      committer: { commit: () => Promise.reject(new Error("repository owns commit")) },
    });
    const lifecycle = createInternalHotpLifecycle({
      repository: {
        get: () => Promise.resolve(structuredClone(item)),
        savePendingHotpReservation: (candidate) => {
          pending.set(candidate.reservationId, { binding: candidate.binding });
          return Promise.resolve();
        },
        commitHotpReservation: (reservationId, supplied) => {
          expect(pending.get(reservationId)?.binding).toEqual(supplied);
          commits += 1;
          if (commits === 1) {
            counter += 1;
            revision += 1;
          }
          return Promise.resolve({ counter, revision });
        },
        cancelHotpReservation: () => Promise.resolve(true),
      },
      reservations,
      now: () => 1_000,
    });

    const release = await lifecycle.reserve(itemId, 1, binding);
    expect(release.itemId).toBe(itemId);
    expect(release.itemRevision).toBe(1);
    expect(release.code).toMatch(/^\d{6}$/u);
    await expect(lifecycle.confirm(release.reservationId, binding)).resolves.toEqual({
      counter: 8,
      revision: 2,
    });
    await expect(lifecycle.confirm(release.reservationId, binding)).resolves.toEqual({
      counter: 8,
      revision: 2,
    });
    expect(commits).toBe(1);
  });

  it("rejects revision and binding changes and supports best-effort cancellation", async () => {
    const reservations = new HotpReservationService({
      clock: { now: () => 1_000 },
      random: { uuid: () => "018f47a6-7d11-7c2f-8bd9-a1d37f147a30" },
      committer: { commit: () => Promise.reject(new Error("unused")) },
    });
    const lifecycle = createInternalHotpLifecycle({
      repository: {
        get: () => Promise.resolve(structuredClone(item)),
        savePendingHotpReservation: () => Promise.resolve(),
        commitHotpReservation: () => Promise.resolve({ counter: 8, revision: 2 }),
        cancelHotpReservation: () => Promise.resolve(true),
      },
      reservations,
      now: () => 1_000,
    });

    await expect(lifecycle.reserve(itemId, 2, binding)).rejects.toMatchObject({
      code: "OTP_FILL_ITEM_CHANGED",
    });
    const release = await lifecycle.reserve(itemId, 1, binding);
    const wrong = { ...binding, documentId: "document-b" };
    await expect(lifecycle.confirm(release.reservationId, wrong)).rejects.toMatchObject({
      code: "OTP_FILL_INVALID",
    });
    await expect(lifecycle.cancel(release.reservationId, binding)).resolves.toBe(true);
  });
});
