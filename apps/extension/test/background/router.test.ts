import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/platform/chrome-platform", () => ({
  createChromePlatform: () => new FakeExtensionPlatform("background-entry-test-id"),
}));

import {
  normalizeSenderContext,
  type RawSenderMetadata,
  type SenderContext,
} from "@shardpass/messaging";
import { FakeExtensionPlatform } from "../../../../packages/testing/src/fake-extension-platform";
import { installBackground } from "../../src/background/main";
import { routeMessage } from "../../src/background/router";
import type { VaultService } from "../../src/background/vault/vault-service";
import type {
  BackupRequest,
  MigrationRequest,
  OtpRequest,
  OtpResponse,
} from "@shardpass/messaging";
import { OtpServiceError } from "../../src/background/otp/otp-service";
import { BackupServiceError } from "../../src/background/vault/backup-service";
import { EnteProtocolError } from "../../src/background/ente/protocol";
import { ItemServiceError } from "../../src/background/item/item-service";
import { LoginFillServiceError } from "../../src/background/login/login-fill-service";
import { PasswordGenServiceError } from "../../src/background/password/password-gen-service";

const extensionId = "expected-extension-id";

function popupSender(id = extensionId): SenderContext {
  return {
    extensionId: id,
    contextKind: "popup",
    documentId: "popup-document",
    senderUrl: `chrome-extension://${id}/popup/index.html`,
  };
}

function vaultSender(id = extensionId): SenderContext {
  return {
    extensionId: id,
    contextKind: "vault",
    documentId: "vault-document",
    senderUrl: `chrome-extension://${id}/vault/index.html`,
  };
}

// Thin wrappers around the long routeMessage(...) positional signature so each
// route's tests only have to name the service they care about. `service` is
// cast to `never` at the call boundary the same way other tests in this file
// bypass the handler's exact structural type for a plain vi.fn() mock.
function routeItem(input: unknown, sender: unknown, service?: unknown) {
  return routeMessage(
    input,
    sender,
    extensionId,
    undefined, // vaultService
    undefined, // getState
    undefined, // migrationHandler
    undefined, // otpService
    undefined, // otpImportService
    undefined, // backupService
    undefined, // otpFillService
    undefined, // enteService
    service as never, // itemService
  );
}

function routeLoginFill(input: unknown, sender: unknown, service?: unknown) {
  return routeMessage(
    input,
    sender,
    extensionId,
    undefined, // vaultService
    undefined, // getState
    undefined, // migrationHandler
    undefined, // otpService
    undefined, // otpImportService
    undefined, // backupService
    undefined, // otpFillService
    undefined, // enteService
    undefined, // itemService
    service as never, // loginFillService
  );
}

function routePasswordGen(input: unknown, sender: unknown, service?: unknown) {
  return routeMessage(
    input,
    sender,
    extensionId,
    undefined, // vaultService
    undefined, // getState
    undefined, // migrationHandler
    undefined, // otpService
    undefined, // otpImportService
    undefined, // backupService
    undefined, // otpFillService
    undefined, // enteService
    undefined, // itemService
    undefined, // loginFillService
    service as never, // passwordGenService
  );
}

const contentMetadata = {
  extensionId,
  senderUrl: "https://example.test/login",
  tabId: 7,
  frameId: 0,
  documentId: "document-id",
} satisfies RawSenderMetadata;

const foundationStatus = {
  version: 1,
  kind: "foundation.status",
  phase: "foundation",
  vaultAvailable: false,
} as const;

const invalidMessage = {
  version: 1,
  kind: "error",
  error: {
    code: "INVALID_MESSAGE",
    message: "The request was invalid.",
  },
} as const;

const unauthorizedSender = {
  version: 1,
  kind: "error",
  error: {
    code: "UNAUTHORIZED_SENDER",
    message: "This action is not allowed here.",
  },
} as const;

describe("background router", () => {
  it("returns the fixed missing Auth key state without leaking protocol detail", async () => {
    const ente = {
      handle: vi.fn(() => Promise.reject(new EnteProtocolError("ENTE_AUTH_KEY_MISSING"))),
    };
    await expect(
      routeMessage(
        { version: 1, kind: "ente.manualSync" },
        vaultSender(),
        extensionId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ente as never,
      ),
    ).resolves.toEqual({
      version: 1,
      kind: "error",
      error: {
        code: "ENTE_AUTH_KEY_MISSING",
        message: "This Ente account does not have an Authenticator key.",
      },
    });
  });

  it("routes strict migration commands only from a document-bound full vault page", async () => {
    const migration = {
      handle: vi.fn((request: MigrationRequest, sender: SenderContext) =>
        Promise.resolve({
          version: 1 as const,
          kind: "migration.status" as const,
          available: true,
          phase: request.kind === "migration.inspect" ? ("none" as const) : ("staged" as const),
          itemCount: 0,
          sender,
          rawError: "forbidden",
        }),
      ),
    };
    await expect(
      routeMessage(
        { version: 1, kind: "migration.inspect" },
        vaultSender(),
        extensionId,
        undefined,
        undefined,
        migration,
      ),
    ).resolves.toEqual({
      version: 1,
      kind: "migration.status",
      available: true,
      phase: "none",
      itemCount: 0,
    });
    expect(migration.handle).toHaveBeenCalledWith(
      { version: 1, kind: "migration.inspect" },
      vaultSender(),
    );

    for (const deniedSender of [
      popupSender(),
      normalizeSenderContext(contentMetadata, extensionId)!,
      { ...vaultSender(), senderUrl: `chrome-extension://${extensionId}/popup/index.html` },
      { ...vaultSender(), contextKind: "popup" as const },
    ])
      await expect(
        routeMessage(
          { version: 1, kind: "migration.inspect" },
          deniedSender,
          extensionId,
          undefined,
          undefined,
          migration,
        ),
      ).resolves.toEqual(unauthorizedSender);
    await expect(
      routeMessage(
        { version: 1, kind: "migration.inspect" },
        popupSender(),
        extensionId,
        undefined,
        undefined,
        migration,
      ),
    ).resolves.toEqual(unauthorizedSender);
    await expect(
      routeMessage(
        { version: 1, kind: "migration.start", credentialToken: "invalid" },
        vaultSender(),
        extensionId,
        undefined,
        undefined,
        migration,
      ),
    ).resolves.toEqual(invalidMessage);
  });
  it.each([popupSender(), vaultSender()])(
    "returns the exact foundation status to an authorized extension page",
    async (sender) => {
      await expect(
        routeMessage({ version: 1, kind: "foundation.getStatus" }, sender, extensionId),
      ).resolves.toEqual(foundationStatus);
    },
  );

  it.each([
    undefined,
    null,
    { version: 2, kind: "foundation.getStatus" },
    { version: 1, kind: "foundation.unknown" },
    { version: 1, kind: "foundation.getStatus", secret: "must-not-return" },
  ])("returns one stable safe envelope for invalid payload %#", async (payload) => {
    await expect(routeMessage(payload, popupSender(), extensionId)).resolves.toEqual(
      invalidMessage,
    );
  });

  it("rejects a sender from an external extension ID", async () => {
    await expect(
      routeMessage(
        { version: 1, kind: "foundation.getStatus" },
        popupSender("external-extension-id"),
        extensionId,
      ),
    ).resolves.toEqual(unauthorizedSender);
  });

  it("rejects content even with complete browser-owned identity", async () => {
    const sender = normalizeSenderContext(contentMetadata, extensionId);
    expect(sender).not.toBeNull();

    await expect(
      routeMessage({ version: 1, kind: "foundation.getStatus" }, sender, extensionId),
    ).resolves.toEqual(unauthorizedSender);
  });

  it("fails closed for content contexts without tab, frame, or document identity", async () => {
    const malformedContexts: unknown[] = [
      { ...contentMetadata, contextKind: "content", tabId: undefined },
      { ...contentMetadata, contextKind: "content", frameId: undefined },
      { ...contentMetadata, contextKind: "content", documentId: undefined },
    ];

    for (const sender of malformedContexts) {
      await expect(
        routeMessage({ version: 1, kind: "foundation.getStatus" }, sender, extensionId),
      ).resolves.toEqual(unauthorizedSender);
    }
  });
});

describe("vault router", () => {
  const service = {
    handle: vi.fn(() =>
      Promise.resolve({
        version: 1 as const,
        kind: "vault.state" as const,
        state: "locked" as const,
        autoLockMinutes: 15 as const,
        lockOnScreenLock: true,
        retryAfterMs: 0,
        streamId: "00000000000000000000000000000001",
        sequence: 1,
      }),
    ),
  } as unknown as VaultService;

  it("routes authorized vault commands and denies content", async () => {
    await expect(
      routeMessage(
        { version: 1, kind: "vault.getState" },
        popupSender(),
        extensionId,
        service,
        () =>
          Promise.resolve({
            version: 1,
            kind: "vault.state",
            state: "locked",
            autoLockMinutes: 15,
            lockOnScreenLock: true,
            retryAfterMs: 0,
            streamId: "00000000000000000000000000000001",
            sequence: 1,
          }),
      ),
    ).resolves.toMatchObject({ kind: "vault.state", state: "locked" });
    const sender = normalizeSenderContext(contentMetadata, extensionId);
    await expect(
      routeMessage({ version: 1, kind: "vault.getState" }, sender, extensionId, service),
    ).resolves.toEqual(unauthorizedSender);
  });
});

describe("item routing", () => {
  const loginItemFixture = {
    id: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
    schemaVersion: 2,
    revision: 1,
    createdAt: "2026-08-10T12:00:00.000Z",
    updatedAt: "2026-08-10T12:00:00.000Z",
    favorite: false,
    tags: [],
    kind: "login",
    name: "Example",
    username: "alice",
    password: "s3cret",
    urls: ["https://example.test"],
    notes: "",
  } as const;

  const itemCases = [
    [
      { version: 1, kind: "item.query" },
      { version: 1, kind: "item.queryResult", items: [] },
    ],
    [
      { version: 1, kind: "item.get", itemId: loginItemFixture.id },
      { version: 1, kind: "item.getResult", item: loginItemFixture },
    ],
    [
      { version: 1, kind: "item.create", item: loginItemFixture },
      { version: 1, kind: "item.mutationResult", item: loginItemFixture },
    ],
    [
      { version: 1, kind: "item.createMany", items: [loginItemFixture] },
      {
        version: 1,
        kind: "item.createManyResult",
        results: [{ index: 0, status: "created", itemId: loginItemFixture.id }],
      },
    ],
    [
      {
        version: 1,
        kind: "item.update",
        itemId: loginItemFixture.id,
        expectedRevision: 1,
        fields: {},
      },
      { version: 1, kind: "item.mutationResult", item: loginItemFixture },
    ],
    [
      { version: 1, kind: "item.delete", itemId: loginItemFixture.id },
      { version: 1, kind: "item.deleteResult", itemId: loginItemFixture.id, revision: 2 },
    ],
  ] as const;

  it("routes item.query/get/create/update/delete only from the vault page", async () => {
    for (const [request, response] of itemCases) {
      const service = { handle: vi.fn().mockResolvedValue(response) };
      await expect(routeItem(request, vaultSender(), service)).resolves.toEqual(response);
      expect(service.handle).toHaveBeenCalledWith(request, vaultSender());

      for (const denied of [popupSender(), normalizeSenderContext(contentMetadata, extensionId)!]) {
        const deniedService = { handle: vi.fn().mockResolvedValue(response) };
        await expect(routeItem(request, denied, deniedService)).resolves.toEqual(
          unauthorizedSender,
        );
        expect(deniedService.handle).not.toHaveBeenCalled();
      }
    }
  });

  it("routes item.list — the popup-safe projection — from both the popup and the vault page", async () => {
    const request = { version: 1, kind: "item.list" } as const;
    const response = { version: 1, kind: "item.listResult", items: [] } as const;

    for (const sender of [popupSender(), vaultSender()]) {
      const service = { handle: vi.fn().mockResolvedValue(response) };
      await expect(routeItem(request, sender, service)).resolves.toEqual(response);
      expect(service.handle).toHaveBeenCalledWith(request, sender);
    }

    const deniedService = { handle: vi.fn().mockResolvedValue(response) };
    await expect(
      routeItem(request, normalizeSenderContext(contentMetadata, extensionId)!, deniedService),
    ).resolves.toEqual(unauthorizedSender);
    expect(deniedService.handle).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized extension ID even from a vault-shaped sender", async () => {
    const service = { handle: vi.fn() };
    await expect(
      routeItem({ version: 1, kind: "item.query" }, vaultSender("external-extension-id"), service),
    ).resolves.toEqual(unauthorizedSender);
    expect(service.handle).not.toHaveBeenCalled();
  });

  it("rejects invalid item payloads before authorization or service invocation", async () => {
    const service = { handle: vi.fn() };
    await expect(
      routeItem({ version: 1, kind: "item.query", forged: true }, vaultSender(), service),
    ).resolves.toEqual(invalidMessage);
    expect(service.handle).not.toHaveBeenCalled();
  });

  it("reports vault unavailable when no item service is registered", async () => {
    await expect(
      routeItem({ version: 1, kind: "item.query" }, vaultSender(), undefined),
    ).resolves.toMatchObject({ kind: "error", error: { code: "VAULT_UNAVAILABLE" } });
  });

  it("maps ItemServiceError codes and treats unknown throws as unexpected", async () => {
    const request = { version: 1, kind: "item.get", itemId: loginItemFixture.id };
    const known = { handle: vi.fn(() => Promise.reject(new ItemServiceError("ITEM_NOT_FOUND"))) };
    await expect(routeItem(request, vaultSender(), known)).resolves.toMatchObject({
      kind: "error",
      error: { code: "ITEM_NOT_FOUND" },
    });

    const unknown = { handle: vi.fn(() => Promise.reject(new Error("boom"))) };
    await expect(routeItem(request, vaultSender(), unknown)).resolves.toMatchObject({
      kind: "error",
      error: { code: "UNEXPECTED" },
    });
  });

  it("rejects a response shape that does not match the request kind", async () => {
    const request = { version: 1, kind: "item.query" } as const;
    const mismatched = {
      version: 1,
      kind: "item.deleteResult",
      itemId: loginItemFixture.id,
      revision: 1,
    };
    const service = { handle: vi.fn().mockResolvedValue(mismatched) };
    await expect(routeItem(request, vaultSender(), service)).resolves.toMatchObject({
      kind: "error",
      error: { code: "VAULT_UNAVAILABLE" },
    });
  });
});

describe("login fill routing", () => {
  const loginFillCases = [
    [
      { version: 1, kind: "login.fillSuggestions", domain: "example.test" },
      { version: 1, kind: "login.fillSuggestionsResult", suggestions: [] },
    ],
    [
      {
        version: 1,
        kind: "login.fillSelect",
        itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
        expectedRevision: 1,
      },
      { version: 1, kind: "login.fillRelease", username: "alice", password: "s3cret" },
    ],
  ] as const;

  it("routes login.fillSuggestions/fillSelect only from a content script", async () => {
    const content = normalizeSenderContext(contentMetadata, extensionId)!;
    for (const [request, response] of loginFillCases) {
      const service = { handle: vi.fn().mockResolvedValue(response) };
      await expect(routeLoginFill(request, content, service)).resolves.toEqual(response);
      expect(service.handle).toHaveBeenCalledWith(request, content);

      for (const denied of [popupSender(), vaultSender()]) {
        const deniedService = { handle: vi.fn().mockResolvedValue(response) };
        await expect(routeLoginFill(request, denied, deniedService)).resolves.toEqual(
          unauthorizedSender,
        );
        expect(deniedService.handle).not.toHaveBeenCalled();
      }
    }
  });

  it("fails closed for a content sender missing tab, frame, or document identity", async () => {
    const response = { version: 1, kind: "login.fillSuggestionsResult", suggestions: [] };
    const request = { version: 1, kind: "login.fillSuggestions", domain: "example.test" };
    for (const malformed of [
      { ...contentMetadata, contextKind: "content" as const, tabId: undefined },
      { ...contentMetadata, contextKind: "content" as const, frameId: undefined },
      { ...contentMetadata, contextKind: "content" as const, documentId: undefined },
    ]) {
      const service = { handle: vi.fn().mockResolvedValue(response) };
      await expect(routeLoginFill(request, malformed, service)).resolves.toEqual(
        unauthorizedSender,
      );
      expect(service.handle).not.toHaveBeenCalled();
    }
  });

  it("rejects invalid login fill payloads before authorization or service invocation", async () => {
    const content = normalizeSenderContext(contentMetadata, extensionId)!;
    const service = { handle: vi.fn() };
    await expect(
      routeLoginFill(
        { version: 1, kind: "login.fillSuggestions", domain: "example.test", forged: true },
        content,
        service,
      ),
    ).resolves.toEqual(invalidMessage);
    expect(service.handle).not.toHaveBeenCalled();
  });

  it("reports unavailable when no login fill service is registered", async () => {
    const content = normalizeSenderContext(contentMetadata, extensionId)!;
    await expect(
      routeLoginFill(
        { version: 1, kind: "login.fillSuggestions", domain: "example.test" },
        content,
        undefined,
      ),
    ).resolves.toMatchObject({ kind: "error", error: { code: "LOGIN_FILL_UNAVAILABLE" } });
  });

  it("maps LoginFillServiceError codes and treats unknown throws as unavailable", async () => {
    const content = normalizeSenderContext(contentMetadata, extensionId)!;
    const request = {
      version: 1,
      kind: "login.fillSelect",
      itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
      expectedRevision: 1,
    };
    const known = {
      handle: vi.fn(() => Promise.reject(new LoginFillServiceError("LOGIN_FILL_NOT_FOUND"))),
    };
    await expect(routeLoginFill(request, content, known)).resolves.toMatchObject({
      kind: "error",
      error: { code: "LOGIN_FILL_NOT_FOUND" },
    });

    const unknown = { handle: vi.fn(() => Promise.reject(new Error("boom"))) };
    await expect(routeLoginFill(request, content, unknown)).resolves.toMatchObject({
      kind: "error",
      error: { code: "LOGIN_FILL_UNAVAILABLE" },
    });
  });
});

describe("password generation routing", () => {
  const request = { version: 1, kind: "password.generate", mode: "random" } as const;
  const response = {
    version: 1,
    kind: "password.generateResult",
    password: "Ab3!fghijklmno1234pq",
    entropyBits: 120,
  } as const;

  it.each([popupSender(), vaultSender()])(
    "routes password.generate from an authorized extension page",
    async (sender) => {
      const service = { handle: vi.fn().mockResolvedValue(response) };
      await expect(routePasswordGen(request, sender, service)).resolves.toEqual(response);
      expect(service.handle).toHaveBeenCalledWith(request);
    },
  );

  it("denies password.generate from a content script sender", async () => {
    const service = { handle: vi.fn().mockResolvedValue(response) };
    const content = normalizeSenderContext(contentMetadata, extensionId)!;
    await expect(routePasswordGen(request, content, service)).resolves.toEqual(unauthorizedSender);
    expect(service.handle).not.toHaveBeenCalled();
  });

  it("rejects invalid password generation payloads before authorization or service invocation", async () => {
    const service = { handle: vi.fn() };
    await expect(
      routePasswordGen({ ...request, forged: true }, popupSender(), service),
    ).resolves.toEqual(invalidMessage);
    expect(service.handle).not.toHaveBeenCalled();
  });

  it("reports invalid when no password generation service is registered", async () => {
    await expect(routePasswordGen(request, popupSender(), undefined)).resolves.toMatchObject({
      kind: "error",
      error: { code: "PASSWORD_GEN_INVALID" },
    });
  });

  it("maps PasswordGenServiceError codes and treats unknown throws as invalid", async () => {
    const known = {
      handle: vi.fn(() => Promise.reject(new PasswordGenServiceError("PASSWORD_GEN_INVALID"))),
    };
    await expect(routePasswordGen(request, popupSender(), known)).resolves.toMatchObject({
      kind: "error",
      error: { code: "PASSWORD_GEN_INVALID" },
    });

    const unknown = { handle: vi.fn(() => Promise.reject(new Error("boom"))) };
    await expect(routePasswordGen(request, popupSender(), unknown)).resolves.toMatchObject({
      kind: "error",
      error: { code: "PASSWORD_GEN_INVALID" },
    });
  });
});

describe("OTP import routing", () => {
  const request = {
    version: 1,
    kind: "otp.importPreview",
    format: "otpauth",
    candidates: [
      {
        sourceOrdinal: 1,
        issuer: "Synthetic",
        label: "account",
        secret: "JBSWY3DPEHPK3PXP",
        otpType: "totp",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        favorite: false,
        tags: [],
        note: "",
      },
    ],
  } as const;
  const response = {
    version: 1,
    kind: "otp.importPreviewResult",
    previewToken: "01234567-89ab-4def-8123-456789abcdef",
    format: "otpauth",
    rows: [
      {
        rowId: "fedcba98-7654-4abc-9234-fedcba987654",
        ordinal: 1,
        status: "accepted",
        reason: "IMPORT_ACCEPTED",
        metadata: {
          issuer: "Synthetic",
          label: "account",
          otpType: "totp",
          algorithm: "SHA1",
          digits: 6,
          period: 30,
        },
      },
    ],
    accepted: 1,
    duplicate: 0,
    rejected: 0,
    expiresAt: 300_000,
  } as const;

  it("routes strict imports only from the exact document-bound vault sender", async () => {
    const service = { handle: vi.fn().mockResolvedValue(response) };
    await expect(
      routeMessage(
        request,
        vaultSender(),
        extensionId,
        undefined,
        undefined,
        undefined,
        undefined,
        service,
      ),
    ).resolves.toEqual(response);
    for (const denied of [popupSender(), normalizeSenderContext(contentMetadata, extensionId)!])
      await expect(
        routeMessage(
          request,
          denied,
          extensionId,
          undefined,
          undefined,
          undefined,
          undefined,
          service,
        ),
      ).resolves.toEqual(unauthorizedSender);
    await expect(
      routeMessage(
        { ...request, forged: true },
        vaultSender(),
        extensionId,
        undefined,
        undefined,
        undefined,
        undefined,
        service,
      ),
    ).resolves.toEqual(invalidMessage);
  });

  it("projects and reparses import responses without secret or extra fields", async () => {
    const service = { handle: vi.fn().mockResolvedValue({ ...response, secret: "forbidden" }) };
    await expect(
      routeMessage(
        request,
        vaultSender(),
        extensionId,
        undefined,
        undefined,
        undefined,
        undefined,
        service,
      ),
    ).resolves.toEqual(response);
  });
});

describe("OTP routing", () => {
  const listRequest = { version: 1, kind: "otp.list", query: "" } as const;
  const listResponse = { version: 1, kind: "otp.listResult", items: [] } as const;
  const createRequest = {
    version: 1,
    kind: "otp.create",
    input: {
      issuer: "Example",
      label: "Account",
      secret: "JBSWY3DPEHPK3PXP",
      otpType: "totp",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      favorite: false,
      tags: [],
      note: "",
    },
  } as const;
  const reserveRequest = {
    version: 1,
    kind: "otp.reserveHotp",
    itemId: "01234567-89ab-4def-8123-456789abcdef",
  } as const;

  function otp(response: unknown = listResponse) {
    return {
      handle: vi.fn((request: OtpRequest, sender: SenderContext) => {
        void request;
        void sender;
        return response instanceof Error
          ? Promise.reject(response)
          : Promise.resolve(response as OtpResponse);
      }),
    };
  }

  it("parses strictly before exact command authorization and service invocation", async () => {
    const service = otp();
    await expect(
      routeMessage(
        { ...listRequest, forged: true },
        popupSender(),
        extensionId,
        undefined,
        undefined,
        undefined,
        service,
      ),
    ).resolves.toEqual(invalidMessage);
    await expect(
      routeMessage(
        createRequest,
        popupSender(),
        extensionId,
        undefined,
        undefined,
        undefined,
        service,
      ),
    ).resolves.toEqual(unauthorizedSender);
    await expect(
      routeMessage(
        reserveRequest,
        vaultSender(),
        extensionId,
        undefined,
        undefined,
        undefined,
        service,
      ),
    ).resolves.toEqual(unauthorizedSender);
    expect(service.handle).not.toHaveBeenCalled();
  });

  it("accepts popup and vault OTP policies while denying direct content HOTP authority", async () => {
    const service = {
      handle: vi.fn((request: OtpRequest) =>
        Promise.resolve(
          request.kind === "otp.reserveHotp"
            ? {
                version: 1 as const,
                kind: "otp.hotpReserved" as const,
                reservationId: "fedcba98-7654-4abc-9234-fedcba987654",
                itemId: request.itemId,
                itemRevision: 1,
                counter: 0,
                code: "123456",
                expiresAt: 30_000,
              }
            : ({ version: 1, kind: "otp.listResult", items: [] } satisfies OtpResponse),
        ),
      ),
    };
    const content = normalizeSenderContext(contentMetadata, extensionId)!;
    await expect(
      routeMessage(
        listRequest,
        popupSender(),
        extensionId,
        undefined,
        undefined,
        undefined,
        service,
      ),
    ).resolves.toEqual(listResponse);
    await expect(
      routeMessage(
        listRequest,
        vaultSender(),
        extensionId,
        undefined,
        undefined,
        undefined,
        service,
      ),
    ).resolves.toEqual(listResponse);
    await expect(
      routeMessage(reserveRequest, content, extensionId, undefined, undefined, undefined, service),
    ).resolves.toEqual(unauthorizedSender);
    expect(service.handle).toHaveBeenNthCalledWith(1, listRequest, popupSender());
    expect(service.handle).toHaveBeenNthCalledWith(2, listRequest, vaultSender());
    expect(service.handle).toHaveBeenCalledTimes(2);
  });

  it("rejects every cross-command valid response variant without returning its payload", async () => {
    const editorResponse = {
      version: 1,
      kind: "otp.editorResult",
      item: {
        ...createRequest.input,
        id: "01234567-89ab-4def-8123-456789abcdef",
        revision: 1,
      },
    } as const;
    const cases = [
      [listRequest, editorResponse, popupSender()],
      [createRequest, listResponse, vaultSender()],
      [
        {
          version: 1,
          kind: "otp.commitHotp",
          reservationId: "fedcba98-7654-4abc-9234-fedcba987654",
        },
        {
          version: 1,
          kind: "otp.hotpCancelled",
          reservationId: "fedcba98-7654-4abc-9234-fedcba987654",
          cancelled: true,
        },
        normalizeSenderContext(contentMetadata, extensionId)!,
      ],
    ] as const;
    for (const [request, response, sender] of cases) {
      const result = await routeMessage(
        request,
        sender,
        extensionId,
        undefined,
        undefined,
        undefined,
        otp(response),
      );
      expect(result).toEqual(
        request.kind === "otp.commitHotp"
          ? unauthorizedSender
          : {
              version: 1,
              kind: "error",
              error: { code: "VAULT_UNAVAILABLE", message: "The vault could not be verified." },
            },
      );
      expect(JSON.stringify(result)).not.toContain("JBSWY3DPEHPK3PXP");
    }
  });

  it("parses backup requests before exact vault authorization and revalidates paired responses", async () => {
    const request = { version: 1, kind: "backup.beginExportStepUp" } as const;
    const handler = {
      handle: vi.fn((request: BackupRequest, sender: SenderContext) => {
        void request;
        void sender;
        return Promise.resolve({
          version: 1,
          kind: "backup.exportStepUpChallenge",
          challengeId: "0123456789abcdef0123456789abcdef",
          kdf: {
            algorithm: "argon2id",
            salt: "AQEBAQEBAQEBAQEBAQEBAQ==",
            memoryKiB: 65_536,
            iterations: 3,
            parallelism: 1,
          },
          expiresAt: 300_000,
          secret: "forbidden",
        });
      }),
    };

    await expect(
      routeMessage(
        { ...request, unknown: true },
        popupSender(),
        extensionId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        handler,
      ),
    ).resolves.toEqual(invalidMessage);
    expect(handler.handle).not.toHaveBeenCalled();

    for (const denied of [
      popupSender(),
      normalizeSenderContext(contentMetadata, extensionId)!,
      { ...vaultSender(), senderUrl: `chrome-extension://${extensionId}/popup/index.html` },
      { ...vaultSender(), documentId: undefined },
    ])
      await expect(
        routeMessage(
          request,
          denied,
          extensionId,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          handler,
        ),
      ).resolves.toEqual(unauthorizedSender);
    expect(handler.handle).not.toHaveBeenCalled();

    await expect(
      routeMessage(
        request,
        vaultSender(),
        extensionId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        handler,
      ),
    ).resolves.toMatchObject({ kind: "error", error: { code: "BACKUP_UNAVAILABLE" } });
    expect(handler.handle).toHaveBeenCalledWith(request, vaultSender());

    handler.handle.mockResolvedValueOnce({
      version: 1,
      kind: "backup.importCancelled",
      cancelled: true,
    } as never);
    await expect(
      routeMessage(
        request,
        vaultSender(),
        extensionId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        handler,
      ),
    ).resolves.toMatchObject({ kind: "error", error: { code: "BACKUP_UNAVAILABLE" } });
  });

  it("maps only fixed backup errors and maps unknown failures to unexpected", async () => {
    const request = { version: 1, kind: "backup.beginExportStepUp" } as const;
    const known = { handle: vi.fn(() => Promise.reject(new BackupServiceError("BACKUP_EXPIRED"))) };
    await expect(
      routeMessage(
        request,
        vaultSender(),
        extensionId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        known,
      ),
    ).resolves.toMatchObject({ kind: "error", error: { code: "BACKUP_EXPIRED" } });
    const forged = {
      handle: vi.fn(() =>
        Promise.reject(Object.assign(new Error("private"), { code: "BACKUP_EXPIRED" })),
      ),
    };
    await expect(
      routeMessage(
        request,
        vaultSender(),
        extensionId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        forged,
      ),
    ).resolves.toMatchObject({ kind: "error", error: { code: "UNEXPECTED" } });
  });

  it("rejects missing service and malformed service output without leakage", async () => {
    await expect(routeMessage(listRequest, popupSender(), extensionId)).resolves.toMatchObject({
      kind: "error",
      error: { code: "VAULT_UNAVAILABLE" },
    });
    const service = otp({ ...listResponse, arbitrary: "forbidden" });
    await expect(
      routeMessage(
        listRequest,
        popupSender(),
        extensionId,
        undefined,
        undefined,
        undefined,
        service,
      ),
    ).resolves.toMatchObject({ kind: "error", error: { code: "VAULT_UNAVAILABLE" } });
  });

  it("maps only fixed OTP error codes and treats unknown throws as unexpected", async () => {
    const known = otp(new OtpServiceError("OTP_CONFLICT"));
    await expect(
      routeMessage(listRequest, popupSender(), extensionId, undefined, undefined, undefined, known),
    ).resolves.toMatchObject({ kind: "error", error: { code: "OTP_CONFLICT" } });
    const forged = Object.assign(new Error("forbidden"), { code: "OTP_CONFLICT" });
    const unknown = { handle: vi.fn(() => Promise.reject(forged)) };
    await expect(
      routeMessage(
        listRequest,
        popupSender(),
        extensionId,
        undefined,
        undefined,
        undefined,
        unknown,
      ),
    ).resolves.toMatchObject({ kind: "error", error: { code: "UNEXPECTED" } });
  });
});

describe("background installation", () => {
  it("normalizes only raw browser-owned metadata with the platform runtime ID", async () => {
    const platform = new FakeExtensionPlatform(extensionId);
    installBackground(platform);

    await expect(
      platform.dispatchMessage(
        { version: 1, kind: "foundation.getStatus", contextKind: "popup" },
        {
          extensionId,
          senderUrl: `chrome-extension://${extensionId}/popup/index.html`,
        },
      ),
    ).resolves.toEqual(invalidMessage);

    await expect(
      platform.dispatchMessage(
        { version: 1, kind: "foundation.getStatus" },
        {
          extensionId: "external-extension-id",
          senderUrl: `chrome-extension://${extensionId}/popup/index.html`,
        },
      ),
    ).resolves.toEqual(unauthorizedSender);

    await expect(
      platform.dispatchMessage(
        { version: 1, kind: "foundation.getStatus" },
        {
          extensionId,
          contextKind: "popup",
          senderUrl: `chrome-extension://${extensionId}/popup/index.html`,
        },
      ),
    ).resolves.toEqual(unauthorizedSender);
  });

  it("returns status for browser-owned popup metadata", async () => {
    const platform = new FakeExtensionPlatform(extensionId);
    installBackground(platform);

    await expect(
      platform.dispatchMessage(
        { version: 1, kind: "foundation.getStatus" },
        {
          extensionId,
          senderUrl: `chrome-extension://${extensionId}/popup/index.html`,
          documentId: "popup-document",
        },
      ),
    ).resolves.toEqual(foundationStatus);
  });

  it("disposes the installed listener idempotently", async () => {
    const platform = new FakeExtensionPlatform(extensionId);
    const dispose = installBackground(platform);
    expect(platform.listenerCount).toBe(1);

    dispose();
    dispose();
    expect(platform.listenerCount).toBe(0);

    await expect(
      platform.dispatchMessage(
        { version: 1, kind: "foundation.getStatus" },
        {
          extensionId,
          senderUrl: `chrome-extension://${extensionId}/popup/index.html`,
        },
      ),
    ).rejects.toThrow("No extension message listener is installed.");
  });

  it("provides deterministic fake send and vault operations", async () => {
    const platform = new FakeExtensionPlatform(extensionId);
    platform.queueSendResponse(foundationStatus);

    await expect(
      platform.sendMessage({ version: 1, kind: "foundation.getStatus" }),
    ).resolves.toEqual(foundationStatus);
    await expect(platform.openVaultPage()).resolves.toBeUndefined();

    expect(platform.sentMessages).toEqual([{ version: 1, kind: "foundation.getStatus" }]);
    expect(platform.openVaultPageCallCount).toBe(1);
  });
});
