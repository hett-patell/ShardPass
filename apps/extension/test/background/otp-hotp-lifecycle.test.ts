import type { OtpItem, VaultItem } from "@shardpass/domain";
import type { OtpRequest, SenderContext } from "@shardpass/messaging";
import { HotpReservationService } from "@shardpass/otp";
import {
  StorageError,
  type HotpReservationCommitRequest,
  type TombstoneResult,
} from "@shardpass/storage";
import { describe, expect, it, vi } from "vitest";

import { OtpService } from "../../src/background/otp/otp-service";
import type { SessionVaultRepository } from "../../src/background/vault/session-vault-repository";

const itemId = "018f47a6-7d11-7c2f-8bd9-a1d37f147a20";
const nowIso = "2026-08-10T12:00:00.000Z";
const contentA: SenderContext = {
  extensionId: "extension-id",
  contextKind: "content",
  senderUrl: "https://example.test/form",
  tabId: 7,
  frameId: 0,
  documentId: "document-a",
};
const contentB: SenderContext = { ...contentA, documentId: "document-b" };

function hotp(overrides: Partial<OtpItem> = {}): OtpItem {
  return {
    id: itemId,
    schemaVersion: 2,
    revision: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
    favorite: false,
    tags: [],
    kind: "otp",
    issuer: "Example",
    label: "account",
    secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    otpType: "hotp",
    algorithm: "SHA1",
    digits: 6,
    period: 0,
    counter: 7,
    note: "",
    ...overrides,
  };
}

class Repository implements Omit<
  SessionVaultRepository,
  | "importOtpBatch"
  | "readPortableState"
  | "previewPortableImport"
  | "importPortableState"
  | "previewPortableOtpItems"
  | "importPortableOtpItems"
  | "migrateLegacySchema"
> {
  current: OtpItem | null;
  readonly receipts = new Map<
    string,
    {
      result: { revision: number; counter: number };
      binding: { tabId: number; frameId: number; documentId: string };
      sessionEpoch: number;
    }
  >();
  commitCalls = 0;
  failAfterReceipt = false;
  readonly committing = new Map<string, Promise<{ revision: number; counter: number }>>();
  sessionEpoch = 0;
  now = 1_000;
  readonly pending = new Map<
    string,
    {
      reservationId: string;
      itemId: string;
      expectedRevision: number;
      expectedCounter: number;
      binding: { tabId: number; frameId: number; documentId: string };
      createdAt: number;
      expiresAt: number;
      sessionEpoch: number;
      state: "pending";
    }
  >();

  constructor(value: OtpItem = hotp()) {
    this.current = structuredClone(value);
  }

  listItems(): Promise<readonly OtpItem[]> {
    return Promise.resolve(this.current === null ? [] : [structuredClone(this.current)]);
  }
  listAllItems(): Promise<readonly VaultItem[]> {
    return this.listItems();
  }
  listMetadata(): Promise<readonly never[]> {
    return Promise.resolve([]);
  }
  get(): Promise<OtpItem | null> {
    return Promise.resolve(this.current === null ? null : structuredClone(this.current));
  }
  getItem(): Promise<VaultItem | null> {
    return this.get();
  }
  create(candidate: OtpItem): Promise<OtpItem> {
    this.current = structuredClone(candidate);
    return Promise.resolve(structuredClone(candidate));
  }
  async createItems(candidates: readonly VaultItem[]) {
    const outcomes: { index: number; status: "created"; itemId: string }[] = [];
    for (const [index, candidate] of candidates.entries()) {
      const created = await this.createItem(candidate);
      outcomes.push({ index, status: "created", itemId: created.id });
    }
    return outcomes;
  }

  createItem(candidate: VaultItem): Promise<VaultItem> {
    return this.create(candidate as OtpItem);
  }
  update(candidate: OtpItem, expectedRevision: number): Promise<OtpItem> {
    if (this.current === null || this.current.revision !== expectedRevision)
      return Promise.reject(new StorageError("REVISION_CONFLICT"));
    this.current = { ...structuredClone(candidate), revision: expectedRevision + 1 };
    return Promise.resolve(structuredClone(this.current));
  }
  updateItem(candidate: VaultItem, expectedRevision: number): Promise<VaultItem> {
    return this.update(candidate as OtpItem, expectedRevision);
  }
  tombstone(_itemId: string, expectedRevision: number): Promise<TombstoneResult> {
    if (this.current === null || this.current.revision !== expectedRevision)
      return Promise.reject(new StorageError("REVISION_CONFLICT"));
    this.current = null;
    return Promise.resolve({ id: itemId, revision: expectedRevision + 1, deletedAt: nowIso });
  }
  commitHotpReservation(
    reservationId: string,
    binding: { tabId: number; frameId: number; documentId: string },
  ): Promise<{ revision: number; counter: number }> {
    const existing = this.committing.get(reservationId);
    if (existing !== undefined) return existing;
    const operation = this.commitHotpReservationOnce(reservationId, binding).finally(() =>
      this.committing.delete(reservationId),
    );
    this.committing.set(reservationId, operation);
    return operation;
  }
  private commitHotpReservationOnce(
    reservationId: string,
    binding: { tabId: number; frameId: number; documentId: string },
  ): Promise<{ revision: number; counter: number }> {
    this.commitCalls += 1;
    const receipt = this.receipts.get(reservationId);
    if (receipt !== undefined) {
      if (
        receipt.sessionEpoch !== this.sessionEpoch ||
        JSON.stringify(receipt.binding) !== JSON.stringify(binding)
      )
        return Promise.reject(new StorageError("REVISION_CONFLICT"));
      return Promise.resolve(receipt.result);
    }
    const pending = this.pending.get(reservationId);
    if (
      pending === undefined ||
      pending.sessionEpoch !== this.sessionEpoch ||
      this.now >= pending.expiresAt ||
      JSON.stringify(pending.binding) !== JSON.stringify(binding) ||
      this.current === null ||
      this.current.otpType !== "hotp" ||
      this.current.revision !== pending.expectedRevision ||
      this.current.counter !== pending.expectedCounter ||
      this.current.counter >= Number.MAX_SAFE_INTEGER
    )
      return Promise.reject(new StorageError("REVISION_CONFLICT"));
    const result = { revision: this.current.revision + 1, counter: this.current.counter + 1 };
    this.current = { ...this.current, ...result };
    this.receipts.set(reservationId, {
      result,
      binding: structuredClone(binding),
      sessionEpoch: this.sessionEpoch,
    });
    this.pending.delete(reservationId);
    return this.failAfterReceipt
      ? Promise.reject(new StorageError("STORAGE_FAILED"))
      : Promise.resolve(result);
  }
  cancelHotpReservation(
    reservationId: string,
    binding: { tabId: number; frameId: number; documentId: string },
  ): Promise<boolean> {
    const pending = this.pending.get(reservationId);
    if (
      pending === undefined ||
      pending.sessionEpoch !== this.sessionEpoch ||
      this.now >= pending.expiresAt ||
      JSON.stringify(pending.binding) !== JSON.stringify(binding)
    )
      return Promise.resolve(false);
    this.pending.delete(reservationId);
    return Promise.resolve(true);
  }
  lookupHotpReservationReceipt(
    request: HotpReservationCommitRequest,
  ): Promise<{ revision: number; counter: number } | null> {
    return Promise.resolve(this.receipts.get(request.reservationId)?.result ?? null);
  }
  savePendingHotpReservation(
    value: Omit<typeof this.pending extends Map<string, infer V> ? V : never, "sessionEpoch">,
  ) {
    for (const [reservationId, pending] of this.pending) {
      if (
        pending.sessionEpoch !== this.sessionEpoch ||
        this.now >= pending.expiresAt ||
        pending.itemId === value.itemId
      )
        this.pending.delete(reservationId);
    }
    this.pending.set(
      value.reservationId,
      structuredClone({ ...value, sessionEpoch: this.sessionEpoch }),
    );
    return Promise.resolve();
  }
  lookupPendingHotpReservation(reservationId: string) {
    const value = this.pending.get(reservationId);
    return Promise.resolve(
      value === undefined || value.sessionEpoch !== this.sessionEpoch
        ? null
        : structuredClone(value),
    );
  }
  removePendingHotpReservation(reservationId: string) {
    const value = this.pending.get(reservationId);
    if (value?.sessionEpoch === this.sessionEpoch) this.pending.delete(reservationId);
    return Promise.resolve();
  }
}

function request(kind: OtpRequest["kind"], values: Record<string, unknown>): OtpRequest {
  return { version: 1, kind, ...values } as OtpRequest;
}

function fixture(value: OtpItem = hotp()) {
  const repository = new Repository(value);
  const now = {
    get value() {
      return repository.now;
    },
    set value(value: number) {
      repository.now = value;
    },
  };
  let nextId = 90;
  const reservations = new HotpReservationService({
    committer: { commit: () => Promise.reject(new Error("repository owns commit")) },
    clock: { now: () => now.value },
    random: { uuid: () => `018f47a6-7d11-7c2f-8bd9-${String(nextId++).padStart(12, "0")}` },
  });
  const activity = vi.fn(() => Promise.resolve());
  const service = new OtpService({
    repository,
    reservations,
    clock: { now: () => now.value, isoNow: () => nowIso },
    ids: { next: () => "018f47a6-7d11-7c2f-8bd9-a1d37f147a30" },
    notePrivilegedActivity: activity,
  });
  return { activity, now, repository, reservations, service };
}

async function reserve(service: OtpService, sender = contentA) {
  const result = await service.handle(request("otp.reserveHotp", { itemId }), sender);
  if (result.kind !== "otp.hotpReserved") throw new Error("expected reservation");
  return result;
}

describe("OtpService HOTP lifecycle", () => {
  it("commits the same authenticated reservation ID after service recreation within 30 seconds", async () => {
    const first = fixture();
    const reserved = await reserve(first.service);
    const recreatedReservations = new HotpReservationService({
      committer: { commit: () => Promise.reject(new Error("repository owns commit")) },
      clock: { now: () => first.now.value },
      random: { uuid: () => "018f47a6-7d11-7c2f-8bd9-a1d37f147a98" },
    });
    const recreated = new OtpService({
      repository: first.repository,
      reservations: recreatedReservations,
      clock: { now: () => first.now.value, isoNow: () => nowIso },
      ids: { next: () => "018f47a6-7d11-7c2f-8bd9-a1d37f147a30" },
      notePrivilegedActivity: () => Promise.resolve(),
    });
    first.now.value = reserved.expiresAt - 1;

    await expect(
      recreated.handle(
        request("otp.commitHotp", { reservationId: reserved.reservationId }),
        contentA,
      ),
    ).resolves.toMatchObject({
      kind: "otp.hotpCommitted",
      reservationId: reserved.reservationId,
      revision: 2,
      counter: 8,
    });
    expect(first.repository.current).toMatchObject({ counter: 8 });
    expect(first.repository.commitCalls).toBe(1);
  });

  it("fails closed after restart for wrong binding, expiry, item change, or session epoch", async () => {
    for (const failure of ["binding", "expiry", "item", "session"] as const) {
      const first = fixture();
      const reserved = await reserve(first.service);
      if (failure === "expiry") first.now.value = reserved.expiresAt;
      if (failure === "item")
        first.repository.current = { ...first.repository.current!, revision: 2 };
      if (failure === "session") first.repository.sessionEpoch = 1;
      const recreated = new OtpService({
        repository: first.repository,
        reservations: new HotpReservationService({
          committer: { commit: () => Promise.reject(new Error("repository owns commit")) },
          clock: { now: () => first.now.value },
          random: { uuid: () => "018f47a6-7d11-7c2f-8bd9-a1d37f147a98" },
        }),
        clock: { now: () => first.now.value, isoNow: () => nowIso },
        ids: { next: () => "018f47a6-7d11-7c2f-8bd9-a1d37f147a30" },
        notePrivilegedActivity: () => Promise.resolve(),
      });

      await expect(
        recreated.handle(
          request("otp.commitHotp", { reservationId: reserved.reservationId }),
          failure === "binding" ? contentB : contentA,
        ),
      ).rejects.toMatchObject({
        code: "OTP_RESERVATION_INVALID",
      });
      expect(first.repository.current?.counter ?? 7).toBe(7);
      expect(first.repository.commitCalls).toBe(1);
    }
  });

  it("increments exactly once after confirmed concurrent commit", async () => {
    const { repository, service } = fixture();
    const reserved = await reserve(service);
    const [first, replay] = await Promise.all([
      service.handle(
        request("otp.commitHotp", { reservationId: reserved.reservationId }),
        contentA,
      ),
      service.handle(
        request("otp.commitHotp", { reservationId: reserved.reservationId }),
        contentA,
      ),
    ]);
    expect(first).toEqual(replay);
    expect(repository.current).toMatchObject({ revision: 2, counter: 8 });
    expect(repository.commitCalls).toBe(1);
  });

  it("derives binding only from exact content sender tab, frame, and document", async () => {
    const { repository, service } = fixture();
    const reserved = await reserve(service);
    for (const sender of [{ ...contentA, tabId: 8 }, { ...contentA, frameId: 1 }, contentB]) {
      await expect(
        service.handle(
          request("otp.commitHotp", { reservationId: reserved.reservationId }),
          sender,
        ),
      ).rejects.toMatchObject({ code: "OTP_RESERVATION_INVALID" });
    }
    await expect(
      service.handle(
        request("otp.cancelHotp", { reservationId: reserved.reservationId }),
        contentB,
      ),
    ).resolves.toMatchObject({ cancelled: false });
    await service.handle(
      request("otp.commitHotp", { reservationId: reserved.reservationId }),
      contentA,
    );
    await expect(
      service.handle(
        request("otp.commitHotp", { reservationId: reserved.reservationId }),
        contentB,
      ),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_INVALID" });
    expect(repository.current).toMatchObject({ counter: 8 });
  });

  it("terminalizes persisted pending state on cancel so recreation cannot commit", async () => {
    const first = fixture();
    const reserved = await reserve(first.service);
    await first.service.handle(
      request("otp.cancelHotp", { reservationId: reserved.reservationId }),
      contentA,
    );
    const recreated = new OtpService({
      repository: first.repository,
      reservations: new HotpReservationService({
        committer: { commit: () => Promise.reject(new Error("repository owns commit")) },
        clock: { now: () => first.now.value },
        random: { uuid: () => "018f47a6-7d11-7c2f-8bd9-a1d37f147a98" },
      }),
      clock: { now: () => first.now.value, isoNow: () => nowIso },
      ids: { next: () => "018f47a6-7d11-7c2f-8bd9-a1d37f147a30" },
      notePrivilegedActivity: () => Promise.resolve(),
    });

    await expect(
      recreated.handle(
        request("otp.commitHotp", { reservationId: reserved.reservationId }),
        contentA,
      ),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_INVALID" });
    expect(first.repository.commitCalls).toBe(1);
  });

  it("does not increment for reserve, identity-bound cancel, or expiry", async () => {
    const { now, repository, service } = fixture();
    const cancelled = await reserve(service);
    await expect(
      service.handle(
        request("otp.cancelHotp", { reservationId: cancelled.reservationId }),
        contentA,
      ),
    ).resolves.toMatchObject({ cancelled: true });
    const expired = await reserve(service);
    now.value = expired.expiresAt;
    await expect(
      service.handle(request("otp.commitHotp", { reservationId: expired.reservationId }), contentA),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_INVALID" });
    expect(repository.current).toMatchObject({ counter: 7 });
  });

  it("rejects the maximum HOTP counter without wrapping or incrementing", async () => {
    const { repository, service } = fixture(hotp({ counter: Number.MAX_SAFE_INTEGER }));
    const reserved = await reserve(service);
    await expect(
      service.handle(
        request("otp.commitHotp", { reservationId: reserved.reservationId }),
        contentA,
      ),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_INVALID" });
    expect(repository.current).toMatchObject({ counter: Number.MAX_SAFE_INTEGER });
  });

  it("rejects stale item update and delete races without incrementing", async () => {
    for (const race of ["update", "delete"] as const) {
      const { repository, service } = fixture();
      const reserved = await reserve(service);
      if (race === "update")
        repository.current = { ...repository.current!, revision: 2, label: "changed" };
      else repository.current = null;
      await expect(
        service.handle(
          request("otp.commitHotp", { reservationId: reserved.reservationId }),
          contentA,
        ),
      ).rejects.toMatchObject({ code: "OTP_RESERVATION_INVALID" });
      expect(repository.commitCalls).toBe(1);
    }
  });

  it("reconciles a durable receipt after an uncertain write and service recreation", async () => {
    const first = fixture();
    first.repository.failAfterReceipt = false;
    const reserved = await reserve(first.service);
    await expect(
      first.service.handle(
        request("otp.commitHotp", { reservationId: reserved.reservationId }),
        contentA,
      ),
    ).resolves.toMatchObject({ revision: 2, counter: 8 });
    const recreated = new OtpService({
      repository: first.repository,
      reservations: new HotpReservationService({
        committer: { commit: () => Promise.reject(new Error("repository owns commit")) },
        clock: { now: () => first.now.value },
        random: { uuid: () => "018f47a6-7d11-7c2f-8bd9-a1d37f147a91" },
      }),
      clock: { now: () => first.now.value, isoNow: () => nowIso },
      ids: { next: () => "018f47a6-7d11-7c2f-8bd9-a1d37f147a30" },
      notePrivilegedActivity: () => Promise.resolve(),
    });
    await expect(
      recreated.handle(
        request("otp.commitHotp", { reservationId: reserved.reservationId }),
        contentA,
      ),
    ).resolves.toMatchObject({ revision: 2, counter: 8 });
    expect(first.repository.current).toMatchObject({ counter: 8 });
  });

  it("records activity only after successful lifecycle semantics", async () => {
    const { activity, service } = fixture();
    const reserved = await reserve(service);
    expect(activity).toHaveBeenCalledTimes(1);
    await expect(
      service.handle(
        request("otp.commitHotp", { reservationId: reserved.reservationId }),
        contentB,
      ),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_INVALID" });
    expect(activity).toHaveBeenCalledTimes(1);
    await expect(
      service.handle(
        request("otp.cancelHotp", { reservationId: reserved.reservationId }),
        contentB,
      ),
    ).resolves.toMatchObject({ cancelled: false });
    expect(activity).toHaveBeenCalledTimes(1);
    await expect(
      service.handle(
        request("otp.cancelHotp", { reservationId: reserved.reservationId }),
        contentA,
      ),
    ).resolves.toMatchObject({ cancelled: true });
    expect(activity).toHaveBeenCalledTimes(2);
  });

  it("rejects TOTP and Steam reservations and keeps getCode lifecycle unchanged", async () => {
    for (const value of [
      hotp({ otpType: "totp", period: 30, counter: undefined }),
      hotp({ otpType: "steam", period: 30, counter: undefined, digits: 5 }),
    ]) {
      const { service } = fixture(value);
      await expect(reserve(service)).rejects.toMatchObject({ code: "OTP_RESERVATION_INVALID" });
      await expect(
        service.handle(request("otp.getCode", { itemId }), { ...contentA, contextKind: "content" }),
      ).resolves.toMatchObject({ kind: "otp.codeResult" });
    }
  });

  it("clears on lock but reuses the same service after a new session epoch", async () => {
    const repository = new Repository();
    const reservations = new HotpReservationService({
      committer: { commit: () => Promise.reject(new Error("repository owns commit")) },
      clock: { now: () => repository.now },
      random: (() => {
        let id = 90;
        return { uuid: () => `018f47a6-7d11-7c2f-8bd9-${String(id++).padStart(12, "0")}` };
      })(),
    });
    let cleanup: (() => void) | undefined;
    const service = new OtpService({
      repository,
      reservations,
      clock: { now: () => repository.now, isoNow: () => nowIso },
      ids: { next: () => "018f47a6-7d11-7c2f-8bd9-a1d37f147a30" },
      notePrivilegedActivity: () => Promise.resolve(),
      registerReservationCleanup: (callback) => {
        cleanup = callback;
        return () => undefined;
      },
    });
    const old = await reserve(service);

    cleanup?.();
    repository.sessionEpoch = 1;
    await expect(
      service.handle(request("otp.commitHotp", { reservationId: old.reservationId }), contentA),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_INVALID" });
    expect(repository.current).toMatchObject({ counter: 7 });

    const fresh = await reserve(service);
    await expect(
      service.handle(request("otp.commitHotp", { reservationId: fresh.reservationId }), contentA),
    ).resolves.toMatchObject({ counter: 8 });
    expect(repository.current).toMatchObject({ counter: 8 });
    expect(repository.pending.has(old.reservationId)).toBe(false);
  });

  it("disposes permanently and unregisters exactly once", async () => {
    const repository = new Repository();
    const unregister = vi.fn();
    const reservations = new HotpReservationService({
      committer: { commit: () => Promise.reject(new Error("repository owns commit")) },
      clock: { now: () => repository.now },
      random: { uuid: () => "018f47a6-7d11-7c2f-8bd9-a1d37f147a90" },
    });
    const service = new OtpService({
      repository,
      reservations,
      clock: { now: () => repository.now, isoNow: () => nowIso },
      ids: { next: () => "018f47a6-7d11-7c2f-8bd9-a1d37f147a30" },
      notePrivilegedActivity: () => Promise.resolve(),
      registerReservationCleanup: () => unregister,
    });
    await reserve(service);

    service.dispose();
    service.dispose();
    repository.sessionEpoch = 1;

    await expect(reserve(service)).rejects.toMatchObject({ code: "VAULT_LOCKED" });
    await expect(
      service.handle(request("otp.list", { query: "" }), contentA),
    ).rejects.toMatchObject({ code: "VAULT_LOCKED" });
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("lock clears ephemeral state while disposal permanently rejects", async () => {
    for (const lifecycle of ["lock", "dispose"] as const) {
      const repository = new Repository();
      const now = { value: 1_000 };
      const reservations = new HotpReservationService({
        committer: { commit: () => Promise.reject(new Error("repository owns commit")) },
        clock: { now: () => now.value },
        random: { uuid: () => "018f47a6-7d11-7c2f-8bd9-a1d37f147a90" },
      });
      let cleanup: (() => void) | undefined;
      const unregister = vi.fn();
      const service = new OtpService({
        repository,
        reservations,
        clock: { now: () => now.value, isoNow: () => nowIso },
        ids: { next: () => "018f47a6-7d11-7c2f-8bd9-a1d37f147a30" },
        notePrivilegedActivity: () => Promise.resolve(),
        registerReservationCleanup: (callback) => {
          cleanup = callback;
          return unregister;
        },
      });
      const reserved = await reserve(service);
      if (lifecycle === "lock") {
        cleanup?.();
        repository.sessionEpoch = 1;
      } else service.dispose();
      await expect(
        service.handle(
          request("otp.commitHotp", { reservationId: reserved.reservationId }),
          contentA,
        ),
      ).rejects.toMatchObject({
        code: lifecycle === "dispose" ? "VAULT_LOCKED" : "OTP_RESERVATION_INVALID",
      });
      expect(repository.commitCalls).toBe(lifecycle === "dispose" ? 0 : 1);
      expect(repository.current).toMatchObject({ counter: 7 });
      expect(unregister).toHaveBeenCalledTimes(lifecycle === "dispose" ? 1 : 0);
    }
  });
});
