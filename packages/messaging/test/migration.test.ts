import { describe, expect, it } from "vitest";

import {
  MigrationRequestSchema,
  MigrationResponseSchema,
  migrationSenderPolicy,
} from "../src/migration";

const opaqueId = "0123456789abcdef0123456789abcdef";
const canonicalKey = Buffer.alloc(32, 7).toString("base64");

describe("migration messages", () => {
  it("accepts only strict document-bound lifecycle and credential commands", () => {
    for (const kind of ["migration.inspect", "migration.verify", "migration.activate"] as const) {
      expect(MigrationRequestSchema.parse({ version: 1, kind })).toEqual({ version: 1, kind });
    }
    expect(
      MigrationRequestSchema.parse({ version: 1, kind: "migration.getCredentialChallenge" }),
    ).toEqual({ version: 1, kind: "migration.getCredentialChallenge" });
    expect(
      MigrationRequestSchema.parse({
        version: 1,
        kind: "migration.authorizeCredential",
        challengeId: opaqueId,
        derivedKey: canonicalKey,
      }),
    ).toEqual({
      version: 1,
      kind: "migration.authorizeCredential",
      challengeId: opaqueId,
      derivedKey: canonicalKey,
    });
    expect(
      MigrationRequestSchema.parse({
        version: 1,
        kind: "migration.start",
        credentialToken: opaqueId,
      }),
    ).toEqual({ version: 1, kind: "migration.start", credentialToken: opaqueId });
    expect(MigrationRequestSchema.parse({ version: 1, kind: "migration.retry" })).toEqual({
      version: 1,
      kind: "migration.retry",
    });
    expect(
      MigrationRequestSchema.parse({
        version: 1,
        kind: "migration.retry",
        credentialToken: opaqueId,
      }),
    ).toEqual({ version: 1, kind: "migration.retry", credentialToken: opaqueId });
    expect(migrationSenderPolicy).toEqual(
      Object.fromEntries(
        [
          "migration.inspect",
          "migration.getCredentialChallenge",
          "migration.authorizeCredential",
          "migration.start",
          "migration.verify",
          "migration.activate",
          "migration.retry",
        ].map((kind) => [kind, { allowedContexts: ["vault"], requireDocument: true }]),
      ),
    );
  });

  it("rejects malformed keys and every forbidden secret-bearing or unbounded extra field", () => {
    for (const derivedKey of [
      "not-base64",
      Buffer.alloc(31, 7).toString("base64"),
      Buffer.alloc(33, 7).toString("base64"),
      canonicalKey.replace(/=$/u, ""),
      canonicalKey.replace(/=$/u, "=="),
      `${canonicalKey.slice(0, -2)}f=`,
    ]) {
      expect(
        MigrationRequestSchema.safeParse({
          version: 1,
          kind: "migration.authorizeCredential",
          challengeId: opaqueId,
          derivedKey,
        }).success,
      ).toBe(false);
    }
    for (const extra of [
      { password: "forbidden" },
      { seed: "forbidden" },
      { sourceCiphertext: "forbidden" },
      { records: [{}] },
      { enteSecrets: {} },
      { root: {} },
      { fingerprint: "forbidden" },
      { error: "forbidden" },
    ]) {
      expect(
        MigrationRequestSchema.safeParse({
          version: 1,
          kind: "migration.start",
          credentialToken: opaqueId,
          ...extra,
        }).success,
      ).toBe(false);
    }
  });

  it("projects only strict challenge, authorization, and status allowlists", () => {
    expect(
      MigrationResponseSchema.parse({
        version: 1,
        kind: "migration.credentialChallenge",
        challengeId: opaqueId,
        kdf: {
          algorithm: "PBKDF2-HMAC-SHA-256",
          salt: "AAECAwQFBgcICQoLDA0ODw==",
          iterations: 600_000,
          outputBytes: 32,
        },
        expiresAt: 31_000,
      }),
    ).toMatchObject({ kind: "migration.credentialChallenge", challengeId: opaqueId });
    expect(
      MigrationResponseSchema.parse({
        version: 1,
        kind: "migration.credentialAuthorized",
        credentialToken: opaqueId,
        expiresAt: 31_000,
      }),
    ).toMatchObject({ kind: "migration.credentialAuthorized", credentialToken: opaqueId });
    expect(
      MigrationResponseSchema.parse({
        version: 1,
        kind: "migration.status",
        available: true,
        phase: "failed",
        itemCount: 8,
        guidance: "retry-or-export",
      }),
    ).toMatchObject({ kind: "migration.status", guidance: "retry-or-export" });
    for (const response of [
      {
        version: 1,
        kind: "migration.credentialChallenge",
        challengeId: opaqueId,
        kdf: {
          algorithm: "PBKDF2-HMAC-SHA-256",
          salt: "AAECAwQFBgcICQoLDA0ODw==",
          iterations: 600_000,
          outputBytes: 32,
        },
        expiresAt: 31_000,
        fingerprint: "forbidden",
      },
      {
        version: 1,
        kind: "migration.credentialAuthorized",
        credentialToken: opaqueId,
        expiresAt: 31_000,
        derivedKey: canonicalKey,
      },
      {
        version: 1,
        kind: "migration.status",
        available: true,
        phase: "completed",
        itemCount: 1,
        items: [{}],
      },
    ]) {
      expect(MigrationResponseSchema.safeParse(response).success).toBe(false);
    }
  });
});
