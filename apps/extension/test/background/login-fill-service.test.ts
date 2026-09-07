import type { LoginItem, OtpItem, VaultItem } from "@shardpass/domain";
import type { LoginFillRequest } from "@shardpass/messaging";
import { LoginFillResponseSchema } from "@shardpass/messaging";
import { describe, expect, it } from "vitest";

import {
  LoginFillService,
  LoginFillServiceError,
} from "../../src/background/login/login-fill-service";
import { VaultSessionError } from "../../src/background/vault/session-service";
import type { SessionVaultRepository } from "../../src/background/vault/session-vault-repository";

const ids = {
  login: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
  otherLogin: "018f47a6-7d11-7c2f-8bd9-a1d37f147a21",
  totp: "018f47a6-7d11-7c2f-8bd9-a1d37f147a22",
  hotp: "018f47a6-7d11-7c2f-8bd9-a1d37f147a23",
  missing: "018f47a6-7d11-7c2f-8bd9-a1d37f147a99",
};
const nowIso = "2026-08-10T12:00:00.000Z";

function loginItem(overrides: Partial<LoginItem> = {}): LoginItem {
  return {
    id: ids.login,
    schemaVersion: 2,
    revision: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
    favorite: false,
    tags: [],
    kind: "login",
    name: "Example",
    username: "alice",
    password: "s3cret",
    urls: ["https://example.test"],
    notes: "",
    ...overrides,
  };
}

function otpItem(overrides: Partial<OtpItem> = {}): OtpItem {
  return {
    id: ids.totp,
    schemaVersion: 2,
    revision: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
    favorite: false,
    tags: [],
    kind: "otp",
    issuer: "Example",
    label: "account",
    secret: "JBSWY3DPEHPK3PXP",
    otpType: "totp",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    note: "",
    ...overrides,
  };
}

class FakeRepository
  implements Pick<SessionVaultRepository, "listAllItems" | "getItem" | "createItem" | "updateItem">
{
  readonly items = new Map<string, VaultItem>();
  listError: unknown;

  constructor(values: readonly VaultItem[] = []) {
    for (const value of values) this.items.set(value.id, structuredClone(value));
  }

  listAllItems(): Promise<readonly VaultItem[]> {
    if (this.listError !== undefined) return Promise.reject(asError(this.listError));
    return Promise.resolve([...this.items.values()].map((value) => structuredClone(value)));
  }

  getItem(itemId: string): Promise<VaultItem | null> {
    const value = this.items.get(itemId);
    return Promise.resolve(value === undefined ? null : structuredClone(value));
  }

  createItem(candidate: VaultItem): Promise<VaultItem> {
    this.items.set(candidate.id, structuredClone(candidate));
    return Promise.resolve(structuredClone(candidate));
  }

  updateItem(candidate: VaultItem, expectedRevision: number): Promise<VaultItem> {
    const current = this.items.get(candidate.id);
    if (current === undefined || current.revision !== expectedRevision)
      return Promise.reject(Object.assign(new Error("conflict"), { code: "REVISION_CONFLICT" }));
    const next = { ...structuredClone(candidate), revision: current.revision + 1 };
    this.items.set(candidate.id, next);
    return Promise.resolve(structuredClone(next));
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error("test failure");
}

function request(
  kind: LoginFillRequest["kind"],
  values: Record<string, unknown> = {},
): LoginFillRequest {
  return { version: 1, kind, ...values } as LoginFillRequest;
}

function fixture(values: readonly VaultItem[] = [], now = 15_000) {
  const repository = new FakeRepository(values);
  const activity: string[] = [];
  const service = new LoginFillService({
    repository,
    now: () => now,
    notePrivilegedActivity: () => {
      activity.push("noted");
      return Promise.resolve();
    },
  });
  return { activity, repository, service };
}

describe("LoginFillService", () => {
  it("returns domain-matched suggestions without secrets", async () => {
    const matching = loginItem({ id: ids.login, urls: ["https://example.test/login"] });
    const other = loginItem({ id: ids.otherLogin, name: "Other", urls: ["https://other.test"] });
    const { service } = fixture([matching, other]);

    const result = await service.handle(
      request("login.fillSuggestions", { domain: "example.test" }),
    );
    expect(result).toEqual({
      version: 1,
      kind: "login.fillSuggestionsResult",
      suggestions: [
        {
          itemId: matching.id,
          expectedRevision: 1,
          name: "Example",
          username: "alice",
          favorite: false,
          tags: [],
          hasLinkedOtp: false,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("s3cret");
  });

  it("matches a subdomain against a saved root domain", async () => {
    const stored = loginItem({ urls: ["https://example.test"] });
    const { service } = fixture([stored]);
    const result = await service.handle(
      request("login.fillSuggestions", { domain: "accounts.example.test" }),
    );
    if (result.kind !== "login.fillSuggestionsResult") throw new Error("expected suggestions");
    expect(result.suggestions).toHaveLength(1);
  });

  it("sorts favorites first, then normalized name and username", async () => {
    const values = [
      loginItem({ id: ids.login, name: "Zulu", urls: ["https://example.test"] }),
      loginItem({ id: ids.otherLogin, name: "Acme", favorite: true, urls: ["https://example.test"] }),
    ];
    const { service } = fixture(values);
    const result = await service.handle(
      request("login.fillSuggestions", { domain: "example.test" }),
    );
    if (result.kind !== "login.fillSuggestionsResult") throw new Error("expected suggestions");
    expect(result.suggestions.map((s) => s.itemId)).toEqual([ids.otherLogin, ids.login]);
  });

  it("reports hasLinkedOtp without dereferencing the linked item", async () => {
    const stored = loginItem({ linkedOtpId: ids.totp, urls: ["https://example.test"] });
    const { service } = fixture([stored]);
    const result = await service.handle(
      request("login.fillSuggestions", { domain: "example.test" }),
    );
    if (result.kind !== "login.fillSuggestionsResult") throw new Error("expected suggestions");
    expect(result.suggestions[0]).toMatchObject({ hasLinkedOtp: true });
  });

  it("reports hasLinkedOtp for a login carrying its own inline TOTP secret", async () => {
    const stored = loginItem({ totp: "JBSWY3DPEHPK3PXP", urls: ["https://example.test"] });
    const { service } = fixture([stored]);
    const result = await service.handle(
      request("login.fillSuggestions", { domain: "example.test" }),
    );
    if (result.kind !== "login.fillSuggestionsResult") throw new Error("expected suggestions");
    expect(result.suggestions[0]).toMatchObject({ hasLinkedOtp: true });
    expect(JSON.stringify(result)).not.toContain("JBSWY3DP");
  });

  it("releases username and password on fillSelect", async () => {
    const stored = loginItem();
    const { activity, service } = fixture([stored]);
    const result = await service.handle(
      request("login.fillSelect", { itemId: stored.id, expectedRevision: 1 }),
    );
    expect(result).toEqual({ version: 1, kind: "login.fillRelease", username: "alice", password: "s3cret" });
    expect(activity).toEqual(["noted"]);
  });

  it("includes a TOTP linkedOtpCode when the linked item is a live TOTP", async () => {
    const otp = otpItem({ period: 30 });
    const stored = loginItem({ linkedOtpId: otp.id });
    const { service } = fixture([stored, otp], 15_000);
    const result = await service.handle(
      request("login.fillSelect", { itemId: stored.id, expectedRevision: 1 }),
    );
    if (result.kind !== "login.fillRelease") throw new Error("expected release");
    expect(result.linkedOtpCode).toMatch(/^\d{6}$/u);
  });

  it("includes a code from the login's own inline TOTP secret", async () => {
    const stored = loginItem({ totp: "JBSWY3DPEHPK3PXP" });
    const { service } = fixture([stored], 15_000);
    const result = await service.handle(
      request("login.fillSelect", { itemId: stored.id, expectedRevision: 1 }),
    );
    if (result.kind !== "login.fillRelease") throw new Error("expected release");
    expect(result.linkedOtpCode).toMatch(/^\d{6}$/u);
  });

  it("ignores an unparseable inline TOTP value rather than failing the fill", async () => {
    const stored = loginItem({ totp: "otpauth://totp/x?secret=" });
    const { service } = fixture([stored], 15_000);
    const result = await service.handle(
      request("login.fillSelect", { itemId: stored.id, expectedRevision: 1 }),
    );
    if (result.kind !== "login.fillRelease") throw new Error("expected release");
    expect(result.password).toBe("s3cret");
    expect(result.linkedOtpCode).toBeUndefined();
  });

  it("omits linkedOtpCode when the linked item is HOTP", async () => {
    const hotp = otpItem({ id: ids.hotp, otpType: "hotp", period: 0, counter: 3 });
    const stored = loginItem({ linkedOtpId: hotp.id });
    const { service } = fixture([stored, hotp]);
    const result = await service.handle(
      request("login.fillSelect", { itemId: stored.id, expectedRevision: 1 }),
    );
    if (result.kind !== "login.fillRelease") throw new Error("expected release");
    expect(result.linkedOtpCode).toBeUndefined();
  });

  it("omits linkedOtpCode when the linked id no longer resolves to a live OTP item", async () => {
    const stored = loginItem({ linkedOtpId: ids.missing });
    const { service } = fixture([stored]);
    const result = await service.handle(
      request("login.fillSelect", { itemId: stored.id, expectedRevision: 1 }),
    );
    if (result.kind !== "login.fillRelease") throw new Error("expected release");
    expect(result.linkedOtpCode).toBeUndefined();
  });

  it("rejects fillSelect for a missing or non-login item", async () => {
    const otp = otpItem();
    const { activity, service } = fixture([otp]);
    await expect(
      service.handle(request("login.fillSelect", { itemId: ids.missing, expectedRevision: 1 })),
    ).rejects.toMatchObject({ code: "LOGIN_FILL_NOT_FOUND" });
    await expect(
      service.handle(request("login.fillSelect", { itemId: otp.id, expectedRevision: 1 })),
    ).rejects.toMatchObject({ code: "LOGIN_FILL_NOT_FOUND" });
    expect(activity).toEqual([]);
  });

  it("rejects fillSelect when the revision changed", async () => {
    const stored = loginItem({ revision: 2 });
    const { activity, service } = fixture([stored]);
    await expect(
      service.handle(request("login.fillSelect", { itemId: stored.id, expectedRevision: 1 })),
    ).rejects.toMatchObject({ code: "LOGIN_FILL_ITEM_CHANGED" });
    expect(activity).toEqual([]);
  });

  it.each(["login.fillConfirm", "login.fillCancel"] as const)(
    "acknowledges %s for an id the repository has never seen",
    async (kind) => {
      const { service } = fixture();
      const result = await service.handle(request(kind, { itemId: ids.missing }));
      expect(result).toEqual({ version: 1, kind: "login.fillAck", ok: true });
    },
  );

  it("answers saveOffer with an offer and creates nothing until it is confirmed", async () => {
    const { repository, service } = fixture();
    const result = await service.handle(
      request("login.saveOffer", { domain: "example.test", username: "alice", password: "s3cret" }),
    );
    expect(result).toMatchObject({ version: 1, kind: "login.saveOfferResult", existing: "none" });
    expect(JSON.stringify(result)).not.toContain("s3cret");
    expect(repository.items.size).toBe(0);
  });

  it("maps a locked vault to the opaque unavailable code without leaking storage detail", async () => {
    const { repository, service } = fixture();
    repository.listError = new VaultSessionError("VAULT_LOCKED");
    const failure = await service
      .handle(request("login.fillSuggestions", { domain: "example.test" }))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LoginFillServiceError);
    expect(failure).toEqual(expect.objectContaining({ code: "LOGIN_FILL_UNAVAILABLE" }));
  });

  it("returns responses accepted by the strict login fill messaging schema, deeply frozen", async () => {
    const stored = loginItem({ urls: ["https://example.test"] });
    const { service } = fixture([stored]);
    for (const result of [
      await service.handle(request("login.fillSuggestions", { domain: "example.test" })),
      await service.handle(request("login.fillSelect", { itemId: stored.id, expectedRevision: 1 })),
      await service.handle(request("login.fillConfirm", { itemId: stored.id })),
    ]) {
      expect(LoginFillResponseSchema.safeParse(result).success).toBe(true);
      expect(Object.isFrozen(result)).toBe(true);
    }
  });
});

describe("LoginFillService save offers", () => {
  it("offers a new login when the host has no account with that username, and creates it on confirm", async () => {
    const { repository, service } = fixture([loginItem({ id: ids.login, urls: ["https://example.test"] })]);
    const offer = (await service.handle(
      request("login.saveOffer", { domain: "example.test", username: "second@example.test", password: "pw-2" }),
    )) as { kind: string; offerId: string; existing: string };
    expect(offer).toMatchObject({ kind: "login.saveOfferResult", existing: "none" });

    const saved = (await service.handle(request("login.saveConfirm", { offerId: offer.offerId, choice: "new" }))) as {
      kind: string;
      itemId: string;
      saved: string;
    };
    expect(saved).toMatchObject({ kind: "login.saveResult", saved: "created" });
    const created = repository.items.get(saved.itemId);
    expect(created).toMatchObject({ kind: "login", username: "second@example.test", password: "pw-2", urls: ["https://example.test"] });
    // A second account on the same site coexists with the first.
    expect([...repository.items.values()].filter((item) => item.kind === "login")).toHaveLength(2);
    // The offer is single-use.
    await expect(service.handle(request("login.saveConfirm", { offerId: offer.offerId, choice: "new" }))).rejects.toMatchObject({
      code: "LOGIN_FILL_NOT_FOUND",
    });
  });

  it("offers a password update for the matching username, keeping the old password in history", async () => {
    const stored = loginItem({ id: ids.login, username: "user", password: "old", urls: ["https://example.test"] });
    const { repository, service } = fixture([stored]);
    const offer = (await service.handle(
      request("login.saveOffer", { domain: "www.example.test", username: "USER", password: "new" }),
    )) as { offerId: string; existing: string; existingName?: string };
    expect(offer).toMatchObject({ existing: "different-password", existingName: stored.name });
    await service.handle(request("login.saveConfirm", { offerId: offer.offerId, choice: "update" }));
    expect(repository.items.get(ids.login)).toMatchObject({
      password: "new",
      revision: 2,
      passwordHistory: [{ password: "old", changedAt: stored.updatedAt }],
    });
  });

  it("reports an unchanged credential as already saved, and forgets an expired offer", async () => {
    const stored = loginItem({ id: ids.login, username: "user", password: "same", urls: ["https://example.test"] });
    let now = 15_000;
    const repository = new FakeRepository([stored]);
    const service = new LoginFillService({ repository, now: () => now, notePrivilegedActivity: () => Promise.resolve() });
    const same = (await service.handle(
      request("login.saveOffer", { domain: "example.test", username: "user", password: "same" }),
    )) as { existing: string; offerId: string };
    expect(same.existing).toBe("same");
    now += 6 * 60_000;
    await expect(service.handle(request("login.saveConfirm", { offerId: same.offerId, choice: "new" }))).rejects.toMatchObject({
      code: "LOGIN_FILL_NOT_FOUND",
    });
  });
});
