import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { scanSecretRoot } from "../../scripts/scan-secrets.mjs";

import manifest from "../../apps/extension/src/manifest";
import {
  authorizeSender,
  BackupRequestSchema,
  backupSenderPolicy,
  EnteRequestSchema,
  EnteSafeStateSchema,
  enteSenderPolicy,
  MigrationRequestSchema,
  migrationSenderPolicy,
  normalizeSenderContext,
  OtpFillRequestSchema,
  OtpFillResponseSchema,
  otpFillSenderPolicy,
  OtpImportRequestSchema,
  otpImportSenderPolicy,
  OtpRequestSchema,
  otpSenderPolicy,
  VaultRequestSchema,
  vaultSenderPolicy,
  type CommandSenderPolicy,
} from "../../packages/messaging/src/index";

const extensionId = "synthetic-extension-id";
const documentId = "synthetic-document";
const content = {
  extensionId,
  contextKind: "content",
  tabId: 7,
  frameId: 2,
  documentId,
  senderUrl: "https://example.invalid/account",
} as const;
const popup = {
  extensionId,
  contextKind: "popup",
  senderUrl: `chrome-extension://${extensionId}/popup/index.html`,
  documentId,
} as const;
const vault = {
  extensionId,
  contextKind: "vault",
  senderUrl: `chrome-extension://${extensionId}/vault/index.html`,
  documentId,
} as const;

function kinds(source: string): string[] {
  return [...source.matchAll(/kind:\s*z\.literal\("([^"]+)"\)/gu)].map((match) => match[1] ?? "");
}

function rejectsForbiddenFields(
  schema: { safeParse(value: unknown): { success: boolean } },
  base: object,
) {
  for (const field of [
    "seed",
    "secretBase32",
    "otpauthUri",
    "records",
    "vault",
    "backup",
    "migration",
    "enteCredentials",
    "password",
    "key",
    "repository",
    "root",
    "hotpCounter",
    "reservationId",
    "cryptoOperation",
  ]) {
    expect(schema.safeParse({ ...base, [field]: "forbidden" }).success, field).toBe(false);
  }
}

function authorize(policy: CommandSenderPolicy, sender: unknown): boolean {
  return authorizeSender(sender, { extensionId, ...policy });
}

describe("Project 1 scanner boundary", () => {
  it("scans the declared tooling source root with only exact reviewed test allowances", async () => {
    const report = await scanSecretRoot({
      root: new URL("../tooling/", import.meta.url),
      rootName: "tests/tooling",
      mode: "source",
      allowlistPath: new URL("../../config/project1-secret-allowlist.json", import.meta.url),
      maxTextBytes: 8 * 1024 * 1024,
      maxBinaryBytes: 32 * 1024 * 1024,
    });
    expect(report.status).toBe("PASS");
    expect(report.findings).toEqual([]);
    expect(report.allowancesUsed.length).toBeGreaterThan(0);
    expect(
      report.allowancesUsed.every(
        ({ mode, path, rationale }) =>
          mode === "source" &&
          rationale === "scanner-test-canary" &&
          /(?:^|\/)(?:[^/]+\.test\.(?:ts|tsx|js|mjs)|project1-candidate-harness\.ts|fixtures?\/[^/]+)$/u.test(
            path,
          ),
      ),
    ).toBe(true);
  });
});

describe("Project 1 content and popup authority", () => {
  it("exposes content only to four exact high-level OTP fill commands", async () => {
    const source = await readFile(
      new URL("../../packages/messaging/src/otp-fill.ts", import.meta.url),
      "utf8",
    );
    expect(kinds(source).filter((kind) => kind.startsWith("otp.fill"))).toEqual([
      "otp.fillSuggestions",
      "otp.fillSelect",
      "otp.fillConfirm",
      "otp.fillCancel",
      "otp.fillSuggestionsResult",
      "otp.fillRelease",
      "otp.fillConfirmed",
      "otp.fillCancelled",
    ]);
    expect(Object.keys(otpFillSenderPolicy).sort()).toEqual([
      "otp.fillCancel",
      "otp.fillConfirm",
      "otp.fillSelect",
      "otp.fillSuggestions",
    ]);
    for (const policy of Object.values(otpFillSenderPolicy)) {
      expect(policy).toEqual({
        allowedContexts: ["content"],
        requireTab: true,
        requireFrame: true,
        requireDocument: true,
      });
      expect(authorize(policy, content)).toBe(true);
      expect(authorize(policy, popup)).toBe(false);
      expect(authorize(policy, vault)).toBe(false);
    }
  });

  it("rejects content requests for seeds, records, backup, migration, Ente, credentials, passwords, keys, repositories, roots, and low-level HOTP", () => {
    const suggestion = {
      version: 1,
      kind: "otp.fillSuggestions",
      requestId: "request_0123456789abcdef",
      fieldHandle: "field_0123456789abcdef",
    };
    rejectsForbiddenFields(OtpFillRequestSchema, suggestion);

    for (const request of [
      { version: 1, kind: "otp.list" },
      { version: 1, kind: "otp.reserveHotp", itemId: "00000000-0000-4000-8000-000000000000" },
      { version: 1, kind: "vault.getState" },
      { version: 1, kind: "backup.beginExportStepUp" },
      { version: 1, kind: "migration.inspect" },
      { version: 1, kind: "otp.importPreview" },
      { version: 1, kind: "ente.status" },
    ]) {
      expect(OtpFillRequestSchema.safeParse(request).success, request.kind).toBe(false);
    }
    const nonContentPolicies: readonly CommandSenderPolicy[] = [
      ...Object.values(otpSenderPolicy),
      ...Object.values(vaultSenderPolicy),
      ...Object.values(backupSenderPolicy),
      ...Object.values(migrationSenderPolicy),
      ...Object.values(otpImportSenderPolicy),
      ...Object.values(enteSenderPolicy),
    ];
    for (const policy of nonContentPolicies) expect(authorize(policy, content)).toBe(false);
  });

  it("limits popup to summaries/code operations and lock authority while management is exact vault-document only", () => {
    expect(authorize(vaultSenderPolicy["vault.getState"], popup)).toBe(true);
    expect(authorize(vaultSenderPolicy["vault.lock"], popup)).toBe(true);
    expect(authorize(otpSenderPolicy["otp.list"], popup)).toBe(true);
    expect(authorize(otpSenderPolicy["otp.getCode"], popup)).toBe(true);
    expect(authorize(otpSenderPolicy["otp.getEditor"], popup)).toBe(false);
    expect(authorize(vaultSenderPolicy["vault.changePassword"], popup)).toBe(false);
    expect(authorize(backupSenderPolicy["backup.beginExportStepUp"], popup)).toBe(false);
    expect(authorize(migrationSenderPolicy["migration.inspect"], popup)).toBe(false);
    expect(authorize(otpImportSenderPolicy["otp.importPreview"], popup)).toBe(false);
    expect(authorize(enteSenderPolicy["ente.status"], popup)).toBe(true);
    expect(authorize(enteSenderPolicy["ente.connect"], popup)).toBe(false);

    const noDocument = { ...vault, documentId: undefined };
    const documentPolicies: readonly CommandSenderPolicy[] = [
      ...Object.values(backupSenderPolicy),
      ...Object.values(migrationSenderPolicy),
      ...Object.values(otpImportSenderPolicy),
      ...Object.values(enteSenderPolicy),
    ];
    for (const policy of documentPolicies) {
      if (policy.allowedContexts.includes("vault"))
        expect(authorize(policy, noDocument)).toBe(false);
    }
  });

  it("fails wrong extension, frame, origin, document, fields, and sender schemes closed", () => {
    const policy = otpFillSenderPolicy["otp.fillSuggestions"];
    for (const sender of [
      { ...content, extensionId: "wrong" },
      { ...content, tabId: undefined },
      { ...content, frameId: undefined },
      { ...content, frameId: -1 },
      { ...content, documentId: undefined },
      { ...content, senderUrl: "file:///tmp/page.html" },
      { ...content, senderUrl: `chrome-extension://${extensionId}/vault/index.html` },
      { ...content, unexpected: true },
    ])
      expect(authorize(policy, sender)).toBe(false);

    expect(
      normalizeSenderContext({ extensionId, senderUrl: content.senderUrl }, extensionId),
    ).toBeNull();
    expect(normalizeSenderContext({ ...content, extensionId: "wrong" }, extensionId)).toBeNull();
  });
});

describe("Project 1 minimized responses and execution boundaries", () => {
  it("allows only OTP Ente projections and rejects login/password/non-OTP state", () => {
    const safeState = {
      version: 1,
      kind: "ente.state",
      state: "idle",
      connected: true,
      pendingCount: 0,
      conflictCount: 0,
      lastSuccessAt: null,
      maskedEmail: "s…@example.invalid",
    };
    expect(EnteSafeStateSchema.safeParse(safeState).success).toBe(true);
    rejectsForbiddenFields(EnteSafeStateSchema, safeState);
    for (const field of [
      "login",
      "email",
      "password",
      "credentials",
      "vaultRecords",
      "passwordItems",
      "notes",
    ]) {
      expect(EnteSafeStateSchema.safeParse({ ...safeState, [field]: "forbidden" }).success).toBe(
        false,
      );
    }
    for (const request of [
      { version: 1, kind: "ente.login", password: "forbidden" },
      { version: 1, kind: "ente.fetchPasswords" },
      { version: 1, kind: "ente.fetchNotes" },
      { version: 1, kind: "ente.customOrigin", origin: "https://example.invalid" },
    ])
      expect(EnteRequestSchema.safeParse(request).success).toBe(false);
  });

  it("keeps fill responses metadata/code-only and has no submit authority", async () => {
    const response = {
      version: 1,
      kind: "otp.fillRelease",
      releaseId: "release_0123456789abcdef",
      code: "123456",
      expiresAt: 1,
      codeLength: 6,
      characterClass: "digits",
    };
    expect(OtpFillResponseSchema.safeParse(response).success).toBe(true);
    rejectsForbiddenFields(OtpFillResponseSchema, response);
    const fillSource = await readFile(
      new URL("../../apps/extension/src/content/otp/fill-otp-field.ts", import.meta.url),
      "utf8",
    );
    const controllerSource = await readFile(
      new URL("../../apps/extension/src/content/otp/otp-fill-controller.tsx", import.meta.url),
      "utf8",
    );
    expect(`${fillSource}\n${controllerSource}`).not.toMatch(
      /\.submit\s*\(|requestSubmit|KeyboardEvent\s*\(|(?:form|submitButton|pageControl)\s*\.\s*click\s*\(/u,
    );
  });

  it("pins exact production network, CSP, permission, endpoint, redirect, cookie, telemetry, and WASM policy", async () => {
    const productionManifest = manifest as {
      permissions: string[];
      host_permissions: string[];
      content_security_policy: { extension_pages: string };
    };
    expect(productionManifest.permissions).toEqual([
      "storage",
      "unlimitedStorage",
      "alarms",
      "idle",
      "activeTab",
      "contextMenus",
      "favicon",
    ]);
    expect(productionManifest.host_permissions).toEqual([
      "https://api.ente.io/*",
      "https://quack.duckduckgo.com/*",
    ]);
    expect(productionManifest.content_security_policy.extension_pages).toBe(
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.ente.io https://api.pwnedpasswords.com https://quack.duckduckgo.com; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'",
    );
    const protocol = await readFile(
      new URL("../../apps/extension/src/background/ente/protocol.ts", import.meta.url),
      "utf8",
    );
    const client = await readFile(
      new URL("../../apps/extension/src/background/ente/client.ts", import.meta.url),
      "utf8",
    );
    expect(protocol).toContain('export const ENTE_API_ORIGIN = "https://api.ente.io"');
    expect(client).toContain('redirect: "error"');
    expect(client).toContain('credentials: "omit"');
    expect(`${protocol}\n${client}`).not.toMatch(
      /WebSocket|EventSource|sendBeacon|XMLHttpRequest|telemetry|analytics|document\.cookie|serverUrl|baseUrl/u,
    );
    expect(
      productionManifest.content_security_policy.extension_pages.match(/wasm-unsafe-eval/gu),
    ).toHaveLength(1);
  });

  it("keeps generic crypto, storage, repository, and primitive imports outside content and popup", async () => {
    for (const relativePath of [
      "../../apps/extension/src/content/main.tsx",
      "../../apps/extension/src/content/otp/otp-fill-controller.tsx",
      "../../apps/extension/src/popup/main.tsx",
      "../../apps/extension/src/popup/PopupApp.tsx",
    ]) {
      const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
      expect(source, relativePath).not.toMatch(
        /@shardpass\/(?:crypto|storage|otp-storage)|VaultRepository|SessionVaultRepository|derive|rotate|wrap|unwrap|decrypt|encrypt|argon2|libsodium|hotp-lifecycle/u,
      );
    }
  });

  it("keeps every non-fill schema strict against cross-boundary fields", () => {
    rejectsForbiddenFields(VaultRequestSchema, { version: 1, kind: "vault.getState" });
    rejectsForbiddenFields(OtpRequestSchema, { version: 1, kind: "otp.list" });
    rejectsForbiddenFields(BackupRequestSchema, { version: 1, kind: "backup.beginExportStepUp" });
    rejectsForbiddenFields(MigrationRequestSchema, { version: 1, kind: "migration.inspect" });
    rejectsForbiddenFields(OtpImportRequestSchema, {
      version: 1,
      kind: "otp.importCancel",
      previewId: "preview_0123456789abcdef",
    });
  });
});
