import { describe, expect, it, vi } from "vitest";

import { OtpImportService, OtpImportServiceError } from "../../src/background/otp/import-service";

const sender = {
  extensionId: "extension-id",
  contextKind: "vault" as const,
  senderUrl: "chrome-extension://extension-id/vault/index.html",
  documentId: "vault-document",
};
const candidate = {
  sourceOrdinal: 1,
  issuer: "Synthetic",
  label: "account",
  secret: "JBSWY3DPEHPK3PXP",
  otpType: "totp" as const,
  algorithm: "SHA1" as const,
  digits: 6,
  period: 30,
  favorite: false,
  tags: [],
  note: "",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function fixture(
  observeSnapshotCandidates?: (candidates: unknown[]) => void,
  nextId?: () => string,
) {
  let now = 0;
  let id = 0;
  const repository = {
    listItems: vi.fn().mockResolvedValue([]),
    importOtpBatch: vi.fn().mockResolvedValue({
      imported: 1,
      duplicate: 0,
      previewChanged: false,
      items: [],
      statuses: ["accepted"],
    }),
  };
  const activity = vi.fn().mockResolvedValue(undefined);
  const service = new OtpImportService({
    repository,
    now: () => now,
    nextId: nextId ?? (() => `a0000000-0000-4000-8000-${(++id).toString().padStart(12, "0")}`),
    notePrivilegedActivity: activity,
    ...(observeSnapshotCandidates === undefined ? {} : { observeSnapshotCandidates }),
  });
  return { service, repository, activity, advance: (ms: number) => (now += ms) };
}

async function preview(service: OtpImportService, boundSender = sender) {
  const result = await service.handle(
    { version: 1, kind: "otp.importPreview", format: "otpauth", candidates: [candidate] },
    boundSender,
  );
  if (result.kind !== "otp.importPreviewResult") throw new Error("expected preview");
  return result;
}

describe("OtpImportService", () => {
  it("projects every row when random UUIDs begin with digits", async () => {
    const ids = [
      "10000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000002",
      "30000000-0000-4000-8000-000000000003",
    ];
    const { service } = fixture(undefined, () => ids.shift()!);
    const result = await service.handle(
      {
        version: 1,
        kind: "otp.importPreview",
        format: "otpauth",
        candidates: [candidate, { ...candidate, sourceOrdinal: 2 }],
      },
      sender,
    );
    expect(result).toMatchObject({
      kind: "otp.importPreviewResult",
      accepted: 1,
      duplicate: 1,
      rejected: 0,
    });
    if (result.kind !== "otp.importPreviewResult") throw new Error("expected preview");
    expect(result.rows).toHaveLength(2);
  });

  it("creates a safe non-persistent document-bound preview and confirms by one-use token", async () => {
    const { service, repository, activity } = fixture();
    const result = await preview(service);
    expect(result).toMatchObject({
      kind: "otp.importPreviewResult",
      accepted: 1,
      duplicate: 0,
      rows: [{ status: "accepted", metadata: { issuer: "Synthetic", label: "account" } }],
    });
    expect(JSON.stringify(result)).not.toContain(candidate.secret);
    expect(repository.importOtpBatch).not.toHaveBeenCalled();
    expect(activity).not.toHaveBeenCalled();

    const confirmed = await service.handle(
      { version: 1, kind: "otp.importConfirm", previewToken: result.previewToken },
      sender,
    );
    expect(confirmed).toEqual({
      version: 1,
      kind: "otp.importConfirmed",
      imported: 1,
      duplicate: 0,
    });
    expect(repository.importOtpBatch).toHaveBeenCalledTimes(1);
    expect(activity).toHaveBeenCalledTimes(1);
    await expect(
      service.handle(
        { version: 1, kind: "otp.importConfirm", previewToken: result.previewToken },
        sender,
      ),
    ).rejects.toMatchObject({ code: "OTP_IMPORT_EXPIRED" });
  });

  it("rejects wrong documents and expiry, and clears all capabilities on lock/dispose", async () => {
    const { service, repository, advance } = fixture();
    const first = await preview(service);
    await expect(
      service.handle(
        { version: 1, kind: "otp.importConfirm", previewToken: first.previewToken },
        { ...sender, documentId: "forged-document" },
      ),
    ).rejects.toMatchObject({ code: "OTP_IMPORT_EXPIRED" });
    advance(300_001);
    await expect(
      service.handle(
        { version: 1, kind: "otp.importConfirm", previewToken: first.previewToken },
        sender,
      ),
    ).rejects.toMatchObject({ code: "OTP_IMPORT_EXPIRED" });
    expect(repository.importOtpBatch).not.toHaveBeenCalled();

    const second = await preview(service);
    service.clearForSession();
    await expect(
      service.handle(
        { version: 1, kind: "otp.importConfirm", previewToken: second.previewToken },
        sender,
      ),
    ).rejects.toMatchObject({ code: "OTP_IMPORT_EXPIRED" });
    service.dispose();
    await expect(preview(service)).rejects.toMatchObject({ code: "OTP_IMPORT_UNAVAILABLE" });
  });

  it("returns a fresh safe preview and no write when confirm-time classification changed", async () => {
    const { service, repository, activity } = fixture();
    repository.importOtpBatch.mockResolvedValueOnce({
      imported: 0,
      duplicate: 1,
      previewChanged: true,
      items: [],
      statuses: ["duplicate"],
    });
    repository.listItems.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        ...candidate,
        id: "01234567-89ab-4def-8123-456789abcdef",
        kind: "otp",
        schemaVersion: 1,
        revision: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const first = await preview(service);
    const changed = await service.handle(
      { version: 1, kind: "otp.importConfirm", previewToken: first.previewToken },
      sender,
    );
    expect(changed).toMatchObject({ kind: "otp.importPreviewChanged", duplicate: 1 });
    if (changed.kind !== "otp.importPreviewChanged") throw new Error("expected changed preview");
    repository.importOtpBatch.mockResolvedValueOnce({
      imported: 0,
      duplicate: 1,
      previewChanged: false,
      items: [],
      statuses: ["duplicate"],
    });
    await expect(
      service.handle(
        { version: 1, kind: "otp.importConfirm", previewToken: changed.previewToken },
        sender,
      ),
    ).resolves.toEqual({
      version: 1,
      kind: "otp.importConfirmed",
      imported: 0,
      duplicate: 1,
    });
    await expect(
      service.handle(
        { version: 1, kind: "otp.importConfirm", previewToken: changed.previewToken },
        sender,
      ),
    ).rejects.toMatchObject({ code: "OTP_IMPORT_EXPIRED" });
    expect(activity).toHaveBeenCalledTimes(1);
  });

  it("globally caps pending plus in-flight previews and clears globally evicted candidates", async () => {
    const observed: unknown[][] = [];
    const { service, repository } = fixture((candidates) => observed.push(candidates));
    for (let index = 0; index < 32; index++)
      await preview(service, { ...sender, documentId: `document-${index}` });
    expect(observed).toHaveLength(32);
    expect(observed[0]).toHaveLength(1);

    await expect(preview(service, { ...sender, documentId: "document-32" })).rejects.toMatchObject({
      code: "OTP_IMPORT_CAPACITY",
    });
    expect(observed[0]).toHaveLength(1);

    service.clearForSession();
    const holds = Array.from({ length: 32 }, () => deferred<never>());
    repository.importOtpBatch.mockReset();
    holds.forEach((hold) => repository.importOtpBatch.mockImplementationOnce(() => hold.promise));
    const pending = [];
    for (let index = 1; index <= 32; index++) {
      const result = await preview(service, { ...sender, documentId: `inflight-${index}` });
      pending.push(
        service.handle(
          { version: 1, kind: "otp.importConfirm", previewToken: result.previewToken },
          { ...sender, documentId: `inflight-${index}` },
        ),
      );
    }
    await expect(
      preview(service, { ...sender, documentId: "capacity-document" }),
    ).rejects.toMatchObject({
      code: "OTP_IMPORT_CAPACITY",
    });
    holds.forEach((hold) => hold.resolve(Promise.reject(new Error("release")) as never));
    await Promise.allSettled(pending);
  });

  it("registers creating operations before list awaits and invalidates all without publication", async () => {
    const observed: unknown[][] = [];
    const { service, repository } = fixture((candidates) => observed.push(candidates));
    const gates = Array.from({ length: 40 }, () => deferred<readonly never[]>());
    repository.listItems.mockReset();
    gates.forEach((gate) => repository.listItems.mockImplementationOnce(() => gate.promise));

    const requests = Array.from({ length: 40 }, (_, index) =>
      preview(service, { ...sender, documentId: `creating-${index}` }),
    );
    await vi.waitFor(() => expect(observed).toHaveLength(40));
    expect(observed.filter((entries) => entries.length === 1)).toHaveLength(32);
    service.clearForSession();
    expect(observed.every((entries) => entries.length === 0)).toBe(true);
    gates.forEach((gate) => gate.resolve([]));
    const settled = await Promise.allSettled(requests);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(0);
    expect(
      settled.every(
        (result) =>
          result.status === "rejected" &&
          ["OTP_IMPORT_CAPACITY", "VAULT_LOCKED"].includes(
            (result.reason as { code?: string }).code ?? "",
          ),
      ),
    ).toBe(true);
  });

  it("clears confirming service candidates synchronously while repository copy remains independent", async () => {
    const observed: unknown[][] = [];
    const { service, repository } = fixture((candidates) => observed.push(candidates));
    const result = await preview(service);
    const gate = deferred<never>();
    let repositoryCandidates: unknown[] | undefined;
    repository.importOtpBatch.mockImplementationOnce((candidates: unknown[]) => {
      repositoryCandidates = structuredClone(candidates);
      return gate.promise;
    });
    const confirmation = service.handle(
      { version: 1, kind: "otp.importConfirm", previewToken: result.previewToken },
      sender,
    );
    await vi.waitFor(() => expect(repositoryCandidates).toHaveLength(1));
    service.clearForSession();
    expect(observed[0]).toHaveLength(0);
    expect(repositoryCandidates).toHaveLength(1);
    expect(repositoryCandidates).not.toBe(observed[0]);
    gate.resolve(Promise.reject(new Error("release")) as never);
    await expect(confirmation).rejects.toMatchObject({ code: "OTP_IMPORT_UNAVAILABLE" });
  });

  it("clears the repository-bound service copy immediately after synchronous bridge capture", async () => {
    const { service, repository } = fixture();
    const result = await preview(service);
    const gate = deferred<never>();
    let serviceCopy: unknown[] | undefined;
    let bridgeCopy: unknown[] | undefined;
    repository.importOtpBatch.mockImplementationOnce((candidates: unknown[]) => {
      serviceCopy = candidates;
      bridgeCopy = structuredClone(candidates);
      return gate.promise;
    });
    const confirmation = service.handle(
      { version: 1, kind: "otp.importConfirm", previewToken: result.previewToken },
      sender,
    );
    expect(serviceCopy).toHaveLength(0);
    expect(bridgeCopy).toHaveLength(1);
    gate.resolve(Promise.reject(new Error("release")) as never);
    await expect(confirmation).rejects.toMatchObject({ code: "OTP_IMPORT_UNAVAILABLE" });
  });

  it("removes hung confirms on lock and late finalizers cannot delete a reused token", async () => {
    const token = "a0000000-0000-4000-8000-000000000001";
    const rowId = "a0000000-0000-4000-8000-000000000010";
    const ids = Array.from({ length: 32 }, () => [token, rowId]).flat();
    const gates = Array.from({ length: 32 }, () => deferred<never>());
    const repository = {
      listItems: vi.fn().mockResolvedValue([]),
      importOtpBatch: vi.fn(),
    };
    gates.forEach((gate) => repository.importOtpBatch.mockImplementationOnce(() => gate.promise));
    const service = new OtpImportService({
      repository,
      now: () => 0,
      nextId: () => ids.shift() ?? token,
      notePrivilegedActivity: vi.fn().mockResolvedValue(undefined),
    });
    const confirmations = [];
    for (let index = 0; index < 32; index++) {
      ids.unshift(`a0000000-0000-4000-8000-${(index + 100).toString().padStart(12, "0")}`);
      const result = await preview(service, { ...sender, documentId: `hung-${index}` });
      confirmations.push(
        service.handle(
          { version: 1, kind: "otp.importConfirm", previewToken: result.previewToken },
          { ...sender, documentId: `hung-${index}` },
        ),
      );
    }
    service.clearForSession();
    ids.splice(0, ids.length, token, rowId);
    const replacement = await preview(service, { ...sender, documentId: "after-lock" });
    expect(replacement.previewToken).toBe(token);
    gates[0]!.resolve(Promise.reject(new Error("old settled")) as never);
    await Promise.resolve();
    await expect(
      service.handle(
        { version: 1, kind: "otp.importCancel", previewToken: replacement.previewToken },
        { ...sender, documentId: "after-lock" },
      ),
    ).resolves.toMatchObject({ kind: "otp.importCancelled" });
    gates.slice(1).forEach((gate) => gate.resolve(Promise.reject(new Error("release")) as never));
    await Promise.allSettled(confirmations);
  });

  it("retries token collisions against pending and in-flight operations and clears on exhaustion", async () => {
    const collision = "a0000000-0000-4000-8000-000000000001";
    const ids = [
      collision,
      "a0000000-0000-4000-8000-000000000010",
      collision,
      "b0000000-0000-4000-8000-000000000002",
      "b0000000-0000-4000-8000-000000000011",
    ];
    const observed: unknown[][] = [];
    const repository = {
      listItems: vi.fn().mockResolvedValue([]),
      importOtpBatch: vi.fn().mockReturnValue(new Promise(() => undefined)),
    };
    const service = new OtpImportService({
      repository,
      now: () => 0,
      nextId: () => ids.shift() ?? collision,
      notePrivilegedActivity: vi.fn().mockResolvedValue(undefined),
      observeSnapshotCandidates: (candidates) => observed.push(candidates),
    });
    const first = await preview(service);
    expect(first.previewToken).toBe(collision);
    void service.handle(
      { version: 1, kind: "otp.importConfirm", previewToken: first.previewToken },
      sender,
    );
    const second = await preview(service, { ...sender, documentId: "collision-document" });
    expect(second.previewToken).toBe("b0000000-0000-4000-8000-000000000002");

    const exhausting = await preview(service, { ...sender, documentId: "exhaust-document" }).catch(
      (error: unknown) => error,
    );
    expect(exhausting).toMatchObject({ code: "OTP_IMPORT_UNAVAILABLE" });
    expect(observed.at(-1)).toHaveLength(0);
  });

  it("bounds previews to four per document and cancel discloses no token existence", async () => {
    const { service } = fixture();
    const previews = [];
    for (let index = 0; index < 5; index++) previews.push(await preview(service));
    await expect(
      service.handle(
        { version: 1, kind: "otp.importConfirm", previewToken: previews[0]!.previewToken },
        sender,
      ),
    ).rejects.toBeInstanceOf(OtpImportServiceError);
    await expect(
      service.handle(
        {
          version: 1,
          kind: "otp.importCancel",
          previewToken: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        },
        sender,
      ),
    ).resolves.toEqual({ version: 1, kind: "otp.importCancelled", cancelled: true });
  });
});
