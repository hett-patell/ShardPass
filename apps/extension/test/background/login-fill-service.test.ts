import type { LoginItem, OtpItem, VaultItem } from "@shardpass/domain";
import type { LoginFillRequest, SenderContext } from "@shardpass/messaging";
import { LoginFillResponseSchema } from "@shardpass/messaging";
import { FakeStoragePort } from "@shardpass/testing/fake-storage-port";
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
  createError: unknown;

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
    if (this.createError !== undefined) return Promise.reject(asError(this.createError));
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

/** The page at example.test, top frame of tab 7. */
const sender: SenderContext = {
  extensionId: "extension-test",
  contextKind: "content",
  tabId: 7,
  frameId: 0,
  documentId: "document-7",
  senderUrl: "https://example.test/login",
};

function fixture(values: readonly VaultItem[] = [], now = 15_000, offerStore?: FakeStoragePort) {
  const repository = new FakeRepository(values);
  const activity: string[] = [];
  const service = new LoginFillService({
    repository,
    now: () => now,
    notePrivilegedActivity: () => {
      activity.push("noted");
      return Promise.resolve();
    },
    ...(offerStore === undefined ? {} : { offerStore }),
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
      sender,
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
      sender,
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
      sender,
    );
    if (result.kind !== "login.fillSuggestionsResult") throw new Error("expected suggestions");
    expect(result.suggestions.map((s) => s.itemId)).toEqual([ids.otherLogin, ids.login]);
  });

  it("leads with the most recently used login, and records a use on fill confirmation", async () => {
    const older = loginItem({ id: ids.login, name: "Older", lastUsedAt: "2026-08-01T00:00:00.000Z" });
    const newer = loginItem({ id: ids.otherLogin, name: "Newer", lastUsedAt: "2026-08-09T00:00:00.000Z" });
    const { service, repository } = fixture([older, newer], Date.UTC(2026, 7, 10, 12));
    const before = await service.handle(request("login.fillSuggestions", { domain: "example.test" }), sender);
    if (before.kind !== "login.fillSuggestionsResult") throw new Error("expected suggestions");
    expect(before.suggestions.map((item) => item.name)).toEqual(["Newer", "Older"]);

    await service.handle(request("login.fillConfirm", { itemId: ids.login }), sender);
    const touched = await repository.getItem(ids.login);
    expect(touched).toMatchObject({ lastUsedAt: "2026-08-10T12:00:00.000Z" });
    const after = await service.handle(request("login.fillSuggestions", { domain: "example.test" }), sender);
    if (after.kind !== "login.fillSuggestionsResult") throw new Error("expected suggestions");
    expect(after.suggestions.map((item) => item.name)).toEqual(["Older", "Newer"]);
  });

  it("keeps a pending save offer across a worker restart, and forgets it once dismissed", async () => {
    const store = new FakeStoragePort();
    const first = fixture([], 15_000, store);
    const offered = await first.service.handle(
      request("login.saveOffer", { domain: "example.test", username: "alice", password: "pw-1" }),
      sender,
    );
    if (offered.kind !== "login.saveOfferResult") throw new Error("expected an offer");

    const second = fixture([], 16_000, store);
    const pending = await second.service.handle(request("login.pendingOffer", {}), sender);
    expect(pending).toMatchObject({ kind: "login.pendingOfferResult", offer: { offerId: offered.offerId, username: "alice" } });
    expect(JSON.stringify(pending)).not.toContain("pw-1");

    await second.service.handle(request("login.saveDismiss", { offerId: offered.offerId }), sender);
    const third = fixture([], 17_000, store);
    await expect(third.service.handle(request("login.pendingOffer", {}), sender)).resolves.toMatchObject({ offer: null });
  });

  it("says which provider a login signs in with, in suggestions and in the release", async () => {
    const stored = loginItem({ password: "", signInWith: "google" });
    const { service } = fixture([stored]);
    const listed = await service.handle(request("login.fillSuggestions", { domain: "example.test" }), sender);
    if (listed.kind !== "login.fillSuggestionsResult") throw new Error("expected suggestions");
    expect(listed.suggestions[0]).toMatchObject({ signInWith: "google" });
    const released = await service.handle(request("login.fillSelect", { itemId: stored.id, expectedRevision: 1 }), sender);
    expect(released).toMatchObject({ kind: "login.fillRelease", signInWith: "google", password: "" });
  });

  it("reports hasLinkedOtp without dereferencing the linked item", async () => {
    const stored = loginItem({ linkedOtpId: ids.totp, urls: ["https://example.test"] });
    const { service } = fixture([stored]);
    const result = await service.handle(
      request("login.fillSuggestions", { domain: "example.test" }),
      sender,
    );
    if (result.kind !== "login.fillSuggestionsResult") throw new Error("expected suggestions");
    expect(result.suggestions[0]).toMatchObject({ hasLinkedOtp: true });
  });

  it("reports hasLinkedOtp for a login carrying its own inline TOTP secret", async () => {
    const stored = loginItem({ totp: "JBSWY3DPEHPK3PXP", urls: ["https://example.test"] });
    const { service } = fixture([stored]);
    const result = await service.handle(
      request("login.fillSuggestions", { domain: "example.test" }),
      sender,
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
      sender,
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
      sender,
    );
    if (result.kind !== "login.fillRelease") throw new Error("expected release");
    expect(result.linkedOtpCode).toMatch(/^\d{6}$/u);
  });

  it("includes a code from the login's own inline TOTP secret", async () => {
    const stored = loginItem({ totp: "JBSWY3DPEHPK3PXP" });
    const { service } = fixture([stored], 15_000);
    const result = await service.handle(
      request("login.fillSelect", { itemId: stored.id, expectedRevision: 1 }),
      sender,
    );
    if (result.kind !== "login.fillRelease") throw new Error("expected release");
    expect(result.linkedOtpCode).toMatch(/^\d{6}$/u);
  });

  it("ignores an unparseable inline TOTP value rather than failing the fill", async () => {
    const stored = loginItem({ totp: "otpauth://totp/x?secret=" });
    const { service } = fixture([stored], 15_000);
    const result = await service.handle(
      request("login.fillSelect", { itemId: stored.id, expectedRevision: 1 }),
      sender,
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
      sender,
    );
    if (result.kind !== "login.fillRelease") throw new Error("expected release");
    expect(result.linkedOtpCode).toBeUndefined();
  });

  it("omits linkedOtpCode when the linked id no longer resolves to a live OTP item", async () => {
    const stored = loginItem({ linkedOtpId: ids.missing });
    const { service } = fixture([stored]);
    const result = await service.handle(
      request("login.fillSelect", { itemId: stored.id, expectedRevision: 1 }),
      sender,
    );
    if (result.kind !== "login.fillRelease") throw new Error("expected release");
    expect(result.linkedOtpCode).toBeUndefined();
  });

  it("rejects fillSelect for a missing or non-login item", async () => {
    const otp = otpItem();
    const { activity, service } = fixture([otp]);
    await expect(
      service.handle(request("login.fillSelect", { itemId: ids.missing, expectedRevision: 1 }), sender),
    ).rejects.toMatchObject({ code: "LOGIN_FILL_NOT_FOUND" });
    await expect(
      service.handle(request("login.fillSelect", { itemId: otp.id, expectedRevision: 1 }), sender),
    ).rejects.toMatchObject({ code: "LOGIN_FILL_NOT_FOUND" });
    expect(activity).toEqual([]);
  });

  it("rejects fillSelect when the revision changed", async () => {
    const stored = loginItem({ revision: 2 });
    const { activity, service } = fixture([stored]);
    await expect(
      service.handle(request("login.fillSelect", { itemId: stored.id, expectedRevision: 1 }), sender),
    ).rejects.toMatchObject({ code: "LOGIN_FILL_ITEM_CHANGED" });
    expect(activity).toEqual([]);
  });

  it.each(["login.fillConfirm", "login.fillCancel"] as const)(
    "acknowledges %s for an id the repository has never seen",
    async (kind) => {
      const { service } = fixture();
      const result = await service.handle(request(kind, { itemId: ids.missing }), sender);
      expect(result).toEqual({ version: 1, kind: "login.fillAck", ok: true });
    },
  );

  it("answers saveOffer with an offer and creates nothing until it is confirmed", async () => {
    const { repository, service } = fixture();
    const result = await service.handle(
      request("login.saveOffer", { domain: "example.test", username: "alice", password: "s3cret" }),
      sender,
    );
    expect(result).toMatchObject({ version: 1, kind: "login.saveOfferResult", existing: "none" });
    expect(JSON.stringify(result)).not.toContain("s3cret");
    expect(repository.items.size).toBe(0);
  });

  it("names a locked vault, and maps every other storage failure to the opaque unavailable code", async () => {
    const { repository, service } = fixture();
    repository.listError = new VaultSessionError("VAULT_LOCKED");
    const locked = await service
      .handle(request("login.fillSuggestions", { domain: "example.test" }), sender)
      .catch((error: unknown) => error);
    expect(locked).toBeInstanceOf(LoginFillServiceError);
    expect(locked).toEqual(expect.objectContaining({ code: "VAULT_LOCKED" }));
    repository.listError = new Error("disk");
    const other = await service
      .handle(request("login.fillSuggestions", { domain: "example.test" }), sender)
      .catch((error: unknown) => error);
    expect(other).toEqual(expect.objectContaining({ code: "LOGIN_FILL_UNAVAILABLE" }));
  });

  it("returns responses accepted by the strict login fill messaging schema, deeply frozen", async () => {
    const stored = loginItem({ urls: ["https://example.test"] });
    const { service } = fixture([stored]);
    for (const result of [
      await service.handle(request("login.fillSuggestions", { domain: "example.test" }), sender),
      await service.handle(request("login.fillSelect", { itemId: stored.id, expectedRevision: 1 }), sender),
      await service.handle(request("login.fillConfirm", { itemId: stored.id }), sender),
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
      sender,
    )) as { kind: string; offerId: string; existing: string };
    expect(offer).toMatchObject({ kind: "login.saveOfferResult", existing: "none" });

    const saved = (await service.handle(request("login.saveConfirm", { offerId: offer.offerId, choice: "new" }), sender)) as {
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
    await expect(service.handle(request("login.saveConfirm", { offerId: offer.offerId, choice: "new" }), sender)).rejects.toMatchObject({
      code: "LOGIN_FILL_NOT_FOUND",
    });
  });

  it("offers a password update for the matching username, keeping the old password in history", async () => {
    const stored = loginItem({ id: ids.login, username: "user", password: "old", urls: ["https://example.test"] });
    const { repository, service } = fixture([stored]);
    const offer = (await service.handle(
      request("login.saveOffer", { domain: "www.example.test", username: "USER", password: "new" }),
      sender,
    )) as { offerId: string; existing: string; existingName?: string };
    expect(offer).toMatchObject({ existing: "different-password", existingName: stored.name });
    await service.handle(request("login.saveConfirm", { offerId: offer.offerId, choice: "update" }), sender);
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
      sender,
    )) as { existing: string; offerId: string };
    expect(same.existing).toBe("same");
    now += 6 * 60_000;
    await expect(service.handle(request("login.saveConfirm", { offerId: same.offerId, choice: "new" }), sender)).rejects.toMatchObject({
      code: "LOGIN_FILL_NOT_FOUND",
    });
  });
});

describe("LoginFillService sender binding", () => {
  const popup: SenderContext = {
    extensionId: "extension-test",
    contextKind: "popup",
    senderUrl: "chrome-extension://extension-test/popup/index.html",
    documentId: "popup",
  };
  const elsewhere: SenderContext = {
    ...sender,
    frameId: 3,
    documentId: "document-3",
    senderUrl: "https://evil.test/embed",
  };

  function offerRequest(username: string, password: string): LoginFillRequest {
    return request("login.saveOffer", { domain: "example.test", username, password });
  }

  it("hands a login only to a page it was saved for; the popup's reveal is not page-bound", async () => {
    const stored = loginItem();
    const { service } = fixture([stored]);
    await expect(
      service.handle(request("login.fillSelect", { itemId: stored.id, expectedRevision: 1 }), elsewhere),
    ).rejects.toMatchObject({ code: "LOGIN_FILL_NOT_FOUND" });
    const revealed = await service.handle(
      request("login.reveal", { itemId: stored.id, expectedRevision: 1 }),
      popup,
    );
    expect(revealed).toMatchObject({ kind: "login.fillRelease", password: "s3cret" });
  });

  it("neither suggests nor matches an archived login", async () => {
    const archived = loginItem({ archivedAt: nowIso });
    const { service } = fixture([archived]);
    const suggestions = await service.handle(
      request("login.fillSuggestions", { domain: "example.test" }),
      sender,
    );
    expect(suggestions).toMatchObject({ suggestions: [] });
    expect(await service.handle(offerRequest("alice", "s3cret"), sender)).toMatchObject({
      existing: "none",
    });
  });

  it("holds an offer for the tab that made it, answers only that tab's top frame, and drops it on dismiss", async () => {
    const { service } = fixture();
    const offer = (await service.handle(offerRequest("alice", "pw-hidden"), sender)) as {
      offerId: string;
    };
    expect(
      await service.handle(request("login.pendingOffer"), { ...sender, tabId: 8 }),
    ).toMatchObject({ offer: null });
    expect(
      await service.handle(request("login.pendingOffer"), { ...sender, frameId: 2 }),
    ).toMatchObject({ offer: null });
    const pending = await service.handle(request("login.pendingOffer"), sender);
    expect(pending).toEqual({
      version: 1,
      kind: "login.pendingOfferResult",
      offer: { offerId: offer.offerId, domain: "example.test", username: "alice", existing: "none" },
    });
    expect(JSON.stringify(pending)).not.toContain("pw-hidden");
    await service.handle(request("login.saveDismiss", { offerId: offer.offerId }), sender);
    expect(await service.handle(request("login.pendingOffer"), sender)).toMatchObject({ offer: null });
  });

  it("forgets a held offer once confirmed, once superseded by a newer one, and once expired", async () => {
    let now = 15_000;
    const repository = new FakeRepository();
    const service = new LoginFillService({
      repository,
      now: () => now,
      notePrivilegedActivity: () => Promise.resolve(),
    });
    const first = (await service.handle(offerRequest("a", "p1"), sender)) as { offerId: string };
    const second = (await service.handle(offerRequest("b", "p2"), sender)) as { offerId: string };
    expect(await service.handle(request("login.pendingOffer"), sender)).toMatchObject({
      offer: { offerId: second.offerId, username: "b" },
    });
    await expect(
      service.handle(request("login.saveConfirm", { offerId: first.offerId, choice: "new" }), sender),
    ).rejects.toMatchObject({ code: "LOGIN_FILL_NOT_FOUND" });
    await service.handle(request("login.saveConfirm", { offerId: second.offerId, choice: "new" }), sender);
    expect(await service.handle(request("login.pendingOffer"), sender)).toMatchObject({ offer: null });
    await service.handle(offerRequest("c", "p3"), sender);
    now += 5 * 60_000 + 1;
    expect(await service.handle(request("login.pendingOffer"), sender)).toMatchObject({ offer: null });
  });

  it("holds an offer made while the vault is locked and judges it once the vault opens", async () => {
    const stored = loginItem({ username: "alice", password: "old" });
    const { repository, service } = fixture([stored]);
    repository.listError = new VaultSessionError("VAULT_LOCKED");
    const offer = (await service.handle(offerRequest("alice", "new"), sender)) as { offerId: string; existing: string };
    expect(offer.existing).toBe("locked");
    expect(await service.handle(request("login.pendingOffer"), sender)).toMatchObject({
      offer: { existing: "locked" },
    });
    repository.listError = undefined;
    expect(await service.handle(request("login.pendingOffer"), sender)).toMatchObject({
      offer: { offerId: offer.offerId, existing: "different-password", existingName: "Example" },
    });
    await service.handle(request("login.saveConfirm", { offerId: offer.offerId, choice: "update" }), sender);
    expect(repository.items.get(stored.id)).toMatchObject({ password: "new", revision: 2 });
  });

  it("drops a locked-time offer that turns out to be already saved, and keeps one whose confirm hit a locked vault", async () => {
    const stored = loginItem({ username: "alice", password: "same" });
    const { repository, service } = fixture([stored]);
    repository.listError = new VaultSessionError("VAULT_LOCKED");
    await service.handle(offerRequest("alice", "same"), sender);
    repository.listError = undefined;
    expect(await service.handle(request("login.pendingOffer"), sender)).toMatchObject({ offer: null });

    const offer = (await service.handle(offerRequest("bob", "pw"), sender)) as { offerId: string };
    repository.createError = new VaultSessionError("VAULT_LOCKED");
    await expect(
      service.handle(request("login.saveConfirm", { offerId: offer.offerId, choice: "new" }), sender),
    ).rejects.toMatchObject({ code: "VAULT_LOCKED" });
    expect(await service.handle(request("login.pendingOffer"), sender)).toMatchObject({
      offer: { offerId: offer.offerId, username: "bob" },
    });
  });

  it("judges an offer without a username by the domain's logins alone", async () => {
    const one = loginItem({ id: ids.login, username: "alice", password: "same" });
    const { service: single } = fixture([one]);
    expect(await single.handle(offerRequest("", "same"), sender)).toMatchObject({ existing: "same" });
    expect(await single.handle(offerRequest("", "changed"), sender)).toMatchObject({
      existing: "different-password",
      existingName: "Example",
    });
    const two = loginItem({ id: ids.otherLogin, name: "Bob", username: "bob", password: "other" });
    const { service: several } = fixture([one, two]);
    expect(await several.handle(offerRequest("", "changed"), sender)).toMatchObject({ existing: "none" });
    expect(await several.handle(offerRequest("", "other"), sender)).toMatchObject({ existing: "same" });
  });
});
