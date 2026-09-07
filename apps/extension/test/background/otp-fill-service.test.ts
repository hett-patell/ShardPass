import type { OtpItem } from "@shardpass/domain";
import type { OtpFillRequest, SenderContext } from "@shardpass/messaging";
import { describe, expect, it, vi } from "vitest";

import { OtpFillService } from "../../src/background/otp/otp-fill-service";

const itemId = "018f47a6-7d11-7c2f-8bd9-a1d37f147a20";
const otherItemId = "018f47a6-7d11-7c2f-8bd9-a1d37f147a21";
const sender: SenderContext = {
  extensionId: "extension-id",
  contextKind: "content",
  senderUrl: "https://example.test/form",
  tabId: 7,
  frameId: 2,
  documentId: "document-a",
};

function otp(overrides: Partial<OtpItem> = {}): OtpItem {
  return {
    id: itemId,
    schemaVersion: 2,
    revision: 1,
    createdAt: "2026-08-10T12:00:00.000Z",
    updatedAt: "2026-08-10T12:00:00.000Z",
    favorite: false,
    tags: ["work"],
    kind: "otp",
    issuer: "Example",
    label: "Account",
    secret: "JBSWY3DPEHPK3PXP",
    otpType: "totp",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    note: "private",
    ...overrides,
  };
}

function request(kind: string, fields: Record<string, unknown>): OtpFillRequest {
  return { version: 1, kind, ...fields } as OtpFillRequest;
}

function harness(items: OtpItem[] = [otp()]) {
  let now = 1_000;
  let authority: object = Object.freeze({});
  let id = 0;
  let cleanup: (() => void) | undefined;
  const hotp = {
    reserve: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn().mockResolvedValue(true),
  };
  const service = new OtpFillService({
    repository: {
      listItems: () => Promise.resolve(items.map((item) => structuredClone(item))),
      get: (id) => Promise.resolve(structuredClone(items.find((item) => item.id === id) ?? null)),
    },
    hotp,
    now: () => now,
    nextOpaqueId: () => `opaque_${String(++id).padStart(16, "0")}`,
    captureSession: () => Promise.resolve(authority),
    assertSession: (candidate) =>
      candidate === authority
        ? Promise.resolve()
        : Promise.reject(Object.assign(new Error(), { code: "VAULT_LOCKED" })),
    notePrivilegedActivity: () => Promise.resolve(),
    registerCleanup: (callback) => {
      cleanup = callback;
      return () => undefined;
    },
  });
  return {
    service,
    hotp,
    setNow: (value: number) => (now = value),
    replaceAuthority: () => (authority = Object.freeze({})),
    cleanup: () => cleanup?.(),
  };
}

async function suggestions(service: OtpFillService, fieldHandle = "field_0123456789abcdef") {
  return service.handle(
    request("otp.fillSuggestions", { requestId: "request_0123456789abcdef", fieldHandle }),
    sender,
  );
}

async function release(
  service: OtpFillService,
  capability: string,
  overrides: Record<string, unknown> = {},
) {
  return service.handle(
    request("otp.fillSelect", {
      capability,
      itemId,
      expectedRevision: 1,
      fieldHandle: "field_0123456789abcdef",
      ...overrides,
    }),
    sender,
  );
}

describe("OTP fill service", () => {
  it("returns bounded favorite-first metadata and no code before explicit selection", async () => {
    const favorite = otp({
      id: otherItemId,
      favorite: true,
      label: "Favorite",
      secret: "GEZDGNBVGY3TQOJQ",
    });
    const { service } = harness([otp(), favorite]);
    const response = await suggestions(service);
    expect(response).toEqual({
      version: 1,
      kind: "otp.fillSuggestionsResult",
      capability: (response as { capability: string }).capability,
      expiresAt: 301_000,
      suggestions: [
        {
          itemId: otherItemId,
          expectedRevision: 1,
          issuer: "Example",
          label: "Favorite",
          otpType: "totp",
          favorite: true,
          tags: ["work"],
          siteMatch: true,
        },
        {
          itemId,
          expectedRevision: 1,
          issuer: "Example",
          label: "Account",
          otpType: "totp",
          favorite: false,
          tags: ["work"],
          siteMatch: true,
        },
      ],
    });
    expect(JSON.stringify(response)).not.toContain("secret");
    expect(JSON.stringify(response)).not.toContain("private");
    expect(JSON.stringify(response)).not.toContain("code");
  });

  it("puts the page's own accounts first and marks the others as belonging elsewhere", async () => {
    const elsewhere = otp({ id: otherItemId, issuer: "Other Service", label: "someone", favorite: true, secret: "GEZDGNBVGY3TQOJQ" });
    const { service } = harness([elsewhere, otp()]);
    const response = (await suggestions(service)) as { suggestions: Array<{ itemId: string; siteMatch?: boolean }> };
    expect(response.suggestions.map((item) => [item.itemId, item.siteMatch])).toEqual([
      [itemId, true],
      [otherItemId, false],
    ]);
  });

  it("binds capabilities and releases to exact sender origin field item revision and session", async () => {
    const { service, replaceAuthority } = harness();
    const suggestion = await suggestions(service);
    const capability = (suggestion as { capability: string }).capability;
    for (const changedSender of [
      { ...sender, tabId: 8 },
      { ...sender, frameId: 3 },
      { ...sender, documentId: "document-b" },
      { ...sender, senderUrl: "https://other.test/form" },
      { ...sender, extensionId: "other-extension" },
    ])
      await expect(
        service.handle(
          request("otp.fillSelect", {
            capability,
            itemId,
            expectedRevision: 1,
            fieldHandle: "field_0123456789abcdef",
          }),
          changedSender,
        ),
      ).rejects.toMatchObject({ code: "OTP_FILL_INVALID" });
    await expect(
      release(service, capability, { fieldHandle: "field_other_0123456789" }),
    ).rejects.toMatchObject({ code: "OTP_FILL_FIELD_CHANGED" });
    replaceAuthority();
    await expect(release(service, capability)).rejects.toMatchObject({
      code: "OTP_FILL_UNAVAILABLE",
    });
  });

  it("issues a five-second single-attempt TOTP release and retains duplicate terminal confirmation", async () => {
    const { service, setNow } = harness();
    const suggestion = await suggestions(service);
    const selected = await release(service, (suggestion as { capability: string }).capability);
    expect(selected).toMatchObject({
      kind: "otp.fillRelease",
      expiresAt: 6_000,
      codeLength: 6,
      characterClass: "digits",
    });
    expect((selected as { releaseId: string }).releaseId).toMatch(/^opaque_/u);
    expect((selected as { code: string }).code).toMatch(/^\d{6}$/u);
    const releaseId = (selected as { releaseId: string }).releaseId;
    const confirmation = request("otp.fillConfirm", {
      releaseId,
      fieldHandle: "field_0123456789abcdef",
      result: "filled",
    });
    await expect(service.handle(confirmation, sender)).resolves.toEqual({
      version: 1,
      kind: "otp.fillConfirmed",
      result: "committed",
    });
    await expect(service.handle(confirmation, sender)).resolves.toEqual({
      version: 1,
      kind: "otp.fillConfirmed",
      result: "committed",
    });
    setNow(61_001);
    await expect(service.handle(confirmation, sender)).rejects.toMatchObject({
      code: "OTP_FILL_INVALID",
    });
  });

  it("expires and consumes releases on the first failed or cancellation attempt", async () => {
    for (const action of ["failed", "cancel", "expired"] as const) {
      const { service, setNow } = harness();
      const suggestion = await suggestions(service);
      const selected = await release(service, (suggestion as { capability: string }).capability);
      const releaseId = (selected as { releaseId: string }).releaseId;
      if (action === "expired") setNow(6_001);
      const first =
        action === "cancel"
          ? service.handle(
              request("otp.fillCancel", { releaseId, fieldHandle: "field_0123456789abcdef" }),
              sender,
            )
          : service.handle(
              request("otp.fillConfirm", {
                releaseId,
                fieldHandle: "field_0123456789abcdef",
                result: action === "failed" ? "failed" : "filled",
              }),
              sender,
            );
      if (action === "expired")
        await expect(first).rejects.toMatchObject({ code: "OTP_FILL_EXPIRED" });
      else
        await expect(first).resolves.toMatchObject({
          kind: action === "cancel" ? "otp.fillCancelled" : "otp.fillConfirmed",
        });
    }
  });

  it("uses the internal HOTP lifecycle and commits only after filled confirmation", async () => {
    const hotpItem = otp({ otpType: "hotp", period: 0, counter: 7 });
    const { service, hotp } = harness([hotpItem]);
    hotp.reserve.mockResolvedValue({
      reservationId: "internal-reservation",
      itemId,
      itemRevision: 1,
      code: "123456",
      expiresAt: 31_000,
    });
    hotp.confirm.mockResolvedValue({ revision: 2, counter: 8 });
    const suggestion = await suggestions(service);
    const selected = await release(service, (suggestion as { capability: string }).capability);
    expect(selected).not.toHaveProperty("reservationId");
    const releaseId = (selected as { releaseId: string }).releaseId;
    await expect(
      service.handle(
        request("otp.fillConfirm", {
          releaseId,
          fieldHandle: "field_0123456789abcdef",
          result: "filled",
        }),
        sender,
      ),
    ).resolves.toEqual({ version: 1, kind: "otp.fillConfirmed", result: "committed" });
    expect(hotp.confirm).toHaveBeenCalledTimes(1);
    await expect(
      service.handle(
        request("otp.fillConfirm", {
          releaseId,
          fieldHandle: "field_0123456789abcdef",
          result: "filled",
        }),
        sender,
      ),
    ).resolves.toEqual({ version: 1, kind: "otp.fillConfirmed", result: "committed" });
    expect(hotp.confirm).toHaveBeenCalledTimes(1);
  });

  it("reserves capability and release capacity synchronously across concurrent awaits", async () => {
    let settleList: ((items: OtpItem[]) => void) | undefined;
    const list = new Promise<OtpItem[]>((resolve) => {
      settleList = resolve;
    });
    let id = 0;
    const service = new OtpFillService({
      repository: {
        listItems: () => list,
        get: () => Promise.resolve(otp()),
      },
      hotp: { reserve: vi.fn(), confirm: vi.fn(), cancel: vi.fn() },
      now: () => 1_000,
      nextOpaqueId: () => `opaque_${String(++id).padStart(16, "0")}`,
      captureSession: () => Promise.resolve(Object.freeze({})),
      assertSession: () => Promise.resolve(),
      notePrivilegedActivity: () => Promise.resolve(),
    });
    const pending = Array.from({ length: 5 }, (_, index) =>
      suggestions(service, `field_${String(index).padStart(16, "0")}`),
    );
    await expect(pending[4]).rejects.toMatchObject({ code: "OTP_FILL_UNAVAILABLE" });
    settleList?.([otp()]);
    await expect(Promise.all(pending.slice(0, 4))).resolves.toHaveLength(4);
  });

  it("cancels an internal HOTP reservation if session authority changes before publication", async () => {
    const hotpItem = otp({ otpType: "hotp", period: 0, counter: 7 });
    const { service, hotp, replaceAuthority } = harness([hotpItem]);
    hotp.reserve.mockImplementation(() => {
      replaceAuthority();
      return Promise.resolve({
        reservationId: "internal-reservation",
        itemId,
        itemRevision: 1,
        code: "123456",
        expiresAt: 31_000,
      });
    });
    const suggestion = await suggestions(service);
    await expect(
      release(service, (suggestion as { capability: string }).capability),
    ).rejects.toMatchObject({ code: "OTP_FILL_UNAVAILABLE" });
    expect(hotp.cancel).toHaveBeenCalledWith("internal-reservation", {
      tabId: 7,
      frameId: 2,
      documentId: "document-a",
    });
  });

  it("clears capabilities on lock and disposes idempotently while cancelling known HOTP", async () => {
    const hotpItem = otp({ otpType: "hotp", period: 0, counter: 7 });
    const { service, hotp, cleanup } = harness([hotpItem]);
    hotp.reserve.mockResolvedValue({
      reservationId: "internal-reservation",
      itemId,
      itemRevision: 1,
      code: "123456",
      expiresAt: 31_000,
    });
    const suggestion = await suggestions(service);
    await release(service, (suggestion as { capability: string }).capability);
    cleanup();
    expect(hotp.cancel).toHaveBeenCalledTimes(1);
    await expect(suggestions(service)).resolves.toMatchObject({
      kind: "otp.fillSuggestionsResult",
    });
    service.dispose();
    service.dispose();
    await expect(suggestions(service)).rejects.toMatchObject({ code: "OTP_FILL_UNAVAILABLE" });
  });

  it("gives same-field concurrent suggestion ownership only to the latest identity", async () => {
    const lists: Array<(items: OtpItem[]) => void> = [];
    let id = 0;
    const service = new OtpFillService({
      repository: {
        listItems: () => new Promise<OtpItem[]>((resolve) => lists.push(resolve)),
        get: () => Promise.resolve(otp()),
      },
      hotp: { reserve: vi.fn(), confirm: vi.fn(), cancel: vi.fn() },
      now: () => 1_000,
      nextOpaqueId: () => `opaque_${String(++id).padStart(16, "0")}`,
      captureSession: () => Promise.resolve(Object.freeze({})),
      assertSession: () => Promise.resolve(),
      notePrivilegedActivity: () => Promise.resolve(),
    });

    const first = suggestions(service);
    const firstExpectation = expect(first).rejects.toMatchObject({ code: "OTP_FILL_UNAVAILABLE" });
    const second = suggestions(service);
    await vi.waitFor(() => expect(lists).toHaveLength(1));
    lists[0]?.([otp()]);
    await expect(second).resolves.toMatchObject({ kind: "otp.fillSuggestionsResult" });
    await firstExpectation;
  });

  it("atomically claims one capability before selection awaits and reserves HOTP once", async () => {
    const hotpItem = otp({ otpType: "hotp", period: 0, counter: 7 });
    const { service, hotp } = harness([hotpItem]);
    let settleReserve:
      | ((value: {
          reservationId: string;
          itemId: string;
          itemRevision: number;
          code: string;
          expiresAt: number;
        }) => void)
      | undefined;
    hotp.reserve.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleReserve = resolve;
        }),
    );
    const suggestion = await suggestions(service);
    const capability = (suggestion as { capability: string }).capability;
    const first = release(service, capability);
    const second = release(service, capability);
    const secondExpectation = expect(second).rejects.toMatchObject({ code: "OTP_FILL_INVALID" });
    await vi.waitFor(() => expect(hotp.reserve).toHaveBeenCalledTimes(1));
    await secondExpectation;
    settleReserve?.({
      reservationId: "internal-reservation",
      itemId,
      itemRevision: 1,
      code: "123456",
      expiresAt: 31_000,
    });
    await expect(first).resolves.toMatchObject({ kind: "otp.fillRelease" });
  });

  it("bounds a HOTP release to a reservation expiring earlier than five seconds", async () => {
    const hotpItem = otp({ otpType: "hotp", period: 0, counter: 7 });
    const { service, hotp } = harness([hotpItem]);
    hotp.reserve.mockResolvedValue({
      reservationId: "internal-reservation",
      itemId,
      itemRevision: 1,
      code: "123456",
      expiresAt: 4_000,
    });
    const suggestion = await suggestions(service);

    await expect(
      release(service, (suggestion as { capability: string }).capability),
    ).resolves.toMatchObject({ kind: "otp.fillRelease", expiresAt: 4_000 });
  });

  it("rejects source expiry at or before release publication and cancels HOTP", async () => {
    for (const sourceExpiresAt of [1_000, 999]) {
      const hotpItem = otp({ otpType: "hotp", period: 0, counter: 7 });
      const { service, hotp } = harness([hotpItem]);
      hotp.reserve.mockResolvedValue({
        reservationId: "internal-reservation",
        itemId,
        itemRevision: 1,
        code: "123456",
        expiresAt: sourceExpiresAt,
      });
      const suggestion = await suggestions(service);

      await expect(
        release(service, (suggestion as { capability: string }).capability),
      ).rejects.toMatchObject({ code: "OTP_FILL_EXPIRED" });
      expect(hotp.cancel).toHaveBeenCalledOnce();
      expect(hotp.cancel).toHaveBeenCalledWith("internal-reservation", {
        tabId: 7,
        frameId: 2,
        documentId: "document-a",
      });
    }
  });

  it("joins concurrent duplicate confirmation to one binding-scoped terminal operation", async () => {
    const hotpItem = otp({ otpType: "hotp", period: 0, counter: 7 });
    const { service, hotp } = harness([hotpItem]);
    hotp.reserve.mockResolvedValue({
      reservationId: "internal-reservation",
      itemId,
      itemRevision: 1,
      code: "123456",
      expiresAt: 31_000,
    });
    let settleConfirm: ((value: { revision: number; counter: number }) => void) | undefined;
    hotp.confirm.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleConfirm = resolve;
        }),
    );
    const suggestion = await suggestions(service);
    const selected = await release(service, (suggestion as { capability: string }).capability);
    const confirmation = request("otp.fillConfirm", {
      releaseId: (selected as { releaseId: string }).releaseId,
      fieldHandle: "field_0123456789abcdef",
      result: "filled",
    });
    const first = service.handle(confirmation, sender);
    const duplicate = service.handle(confirmation, sender);
    await vi.waitFor(() => expect(hotp.confirm).toHaveBeenCalledTimes(1));
    settleConfirm?.({ revision: 2, counter: 8 });
    const [left, right] = await Promise.all([first, duplicate]);
    expect(left).toEqual({ version: 1, kind: "otp.fillConfirmed", result: "committed" });
    expect(right).toEqual(left);
    expect(hotp.confirm).toHaveBeenCalledTimes(1);
  });

  it.each(["totp", "steam"] as const)(
    "bounds %s release to its generated interval and treats exact expiry as expired",
    async (otpType) => {
      const { service, setNow } = harness([
        otp({ otpType, digits: otpType === "steam" ? 5 : 6, period: 30 }),
      ]);
      setNow(29_999);
      const suggestion = await suggestions(service);
      const selected = await release(service, (suggestion as { capability: string }).capability);
      expect(selected).toMatchObject({ expiresAt: 30_000 });
      setNow(30_000);
      await expect(
        service.handle(
          request("otp.fillConfirm", {
            releaseId: (selected as { releaseId: string }).releaseId,
            fieldHandle: "field_0123456789abcdef",
            result: "filled",
          }),
          sender,
        ),
      ).rejects.toMatchObject({ code: "OTP_FILL_EXPIRED" });
    },
  );

  it("invalidates deferred suggestion loading and item rereads synchronously", async () => {
    let settleList: ((items: OtpItem[]) => void) | undefined;
    let settleGet: ((item: OtpItem) => void) | undefined;
    let cleanup: (() => void) | undefined;
    let id = 0;
    const service = new OtpFillService({
      repository: {
        listItems: () => new Promise((resolve) => (settleList = resolve)),
        get: () => new Promise((resolve) => (settleGet = resolve)),
      },
      hotp: { reserve: vi.fn(), confirm: vi.fn(), cancel: vi.fn() },
      now: () => 1_000,
      nextOpaqueId: () => `opaque_${String(++id).padStart(16, "0")}`,
      captureSession: () => Promise.resolve(Object.freeze({})),
      assertSession: () => Promise.resolve(),
      notePrivilegedActivity: () => Promise.resolve(),
      registerCleanup: (callback) => {
        cleanup = callback;
        return () => undefined;
      },
    });
    const pendingSuggestions = suggestions(service);
    await vi.waitFor(() => expect(settleList).toBeTypeOf("function"));
    cleanup?.();
    settleList?.([otp()]);
    await expect(pendingSuggestions).rejects.toMatchObject({ code: "OTP_FILL_UNAVAILABLE" });

    const pendingSelectService = new OtpFillService({
      repository: {
        listItems: () => Promise.resolve([otp()]),
        get: () => new Promise((resolve) => (settleGet = resolve)),
      },
      hotp: { reserve: vi.fn(), confirm: vi.fn(), cancel: vi.fn() },
      now: () => 1_000,
      nextOpaqueId: (() => {
        let next = 0;
        return () => `opaque_${String(++next).padStart(16, "0")}`;
      })(),
      captureSession: () => Promise.resolve(Object.freeze({})),
      assertSession: () => Promise.resolve(),
      notePrivilegedActivity: () => Promise.resolve(),
    });
    const pendingSuggestion = await suggestions(pendingSelectService);
    const pendingSelect = release(
      pendingSelectService,
      (pendingSuggestion as { capability: string }).capability,
    );
    await vi.waitFor(() => expect(settleGet).toBeTypeOf("function"));
    pendingSelectService.dispose();
    settleGet?.(otp());
    await expect(pendingSelect).rejects.toMatchObject({ code: "OTP_FILL_UNAVAILABLE" });
  });

  it("cancels a HOTP reservation that resolves after synchronous disposal", async () => {
    const hotpItem = otp({ otpType: "hotp", period: 0, counter: 7 });
    const { service, hotp } = harness([hotpItem]);
    let settleReserve:
      | ((value: {
          reservationId: string;
          itemId: string;
          itemRevision: number;
          code: string;
          expiresAt: number;
        }) => void)
      | undefined;
    hotp.reserve.mockImplementation(() => new Promise((resolve) => (settleReserve = resolve)));
    const suggestion = await suggestions(service);
    const pending = release(service, (suggestion as { capability: string }).capability);
    await vi.waitFor(() => expect(hotp.reserve).toHaveBeenCalledTimes(1));
    service.dispose();
    settleReserve?.({
      reservationId: "internal-reservation",
      itemId,
      itemRevision: 1,
      code: "123456",
      expiresAt: 31_000,
    });
    await expect(pending).rejects.toMatchObject({ code: "OTP_FILL_UNAVAILABLE" });
    expect(hotp.cancel).toHaveBeenCalledWith("internal-reservation", {
      tabId: 7,
      frameId: 2,
      documentId: "document-a",
    });
  });
});
