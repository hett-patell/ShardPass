import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_ARGON2ID_PARAMETERS,
  createDeterministicRandomSource,
  encryptEnvelope,
  type KdfExecutor,
  type KdfRequest,
} from "../../crypto/src";
import { describe, expect, it, vi } from "vitest";

import {
  BACKUP_V2_LIMITS,
  encodeBackupV2Header,
  encodeCanonicalPayload,
  encodeLegacyCanonicalPayload,
  exportPortableBackup,
  importLegacyBackup,
  importPortableBackup,
  MAX_LEGACY_BACKUP_ENVELOPE_BYTES,
  parseBackupV2Envelope,
  type BackupV2Envelope,
  type BackupV2Header,
  type PortableBackupPayload,
  type PortableBackupPayloadV2,
} from "../src/backup";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const password = encoder.encode("synthetic backup password");
const otherPassword = encoder.encode("different synthetic password");
const fixedNow = "2026-08-12T12:34:56.789Z";

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function deterministicKey(request: KdfRequest): Uint8Array {
  const key = new Uint8Array(32);
  for (let index = 0; index < key.length; index += 1) {
    key[index] =
      (request.password[index % Math.max(request.password.length, 1)] ?? 0) ^
      request.salt[index % request.salt.length]! ^
      index;
  }
  return key;
}

function executor(onDerive?: (request: KdfRequest) => void): KdfExecutor {
  return {
    derive(request) {
      onDerive?.(request);
      return Promise.resolve(deterministicKey(request));
    },
  };
}

const payload: PortableBackupPayload = {
  schemaVersion: 1,
  exportedAt: fixedNow,
  items: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      schemaVersion: 2,
      revision: 7,
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-06-07T08:09:10.000Z",
      favorite: true,
      archivedAt: "2026-07-08T09:10:11.000Z",
      tags: ["重要", "synthetic"],
      kind: "otp",
      issuer: "Synthetic Ω Service",
      label: "fixture@example.invalid",
      secret: "JBSWY3DPEHPK3PXP",
      otpType: "totp",
      algorithm: "SHA512",
      digits: 8,
      period: 45,
      note: "Unicode survives: café ∕ カフェ",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      schemaVersion: 2,
      revision: 3,
      createdAt: "2026-02-03T04:05:06.000Z",
      updatedAt: "2026-03-04T05:06:07.000Z",
      favorite: false,
      tags: [],
      kind: "otp",
      issuer: "Counter Fixture",
      label: "HOTP fixture",
      secret: "JBSWY3DPEHPK3PXP",
      otpType: "hotp",
      algorithm: "SHA1",
      digits: 6,
      period: 0,
      counter: 9007199254740990,
      note: "",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      schemaVersion: 2,
      revision: 1,
      createdAt: "2026-03-04T05:06:07.000Z",
      updatedAt: "2026-03-04T05:06:07.000Z",
      favorite: false,
      tags: ["steam"],
      kind: "otp",
      issuer: "Steam",
      label: "Synthetic player",
      secret: "JBSWY3DPEHPK3PXP",
      otpType: "steam",
      algorithm: "SHA1",
      digits: 5,
      period: 30,
      note: "",
    },
  ],
  settings: { autoLockMinutes: 15, lockOnScreenLock: true },
  history: {
    journal: [
      {
        sequence: 8,
        itemId: "11111111-1111-4111-8111-111111111111",
        kind: "otp",
        schemaVersion: 1,
        revision: 7,
        operation: "update",
        changedAt: "2026-06-07T08:09:10.000Z",
        mutationId: "44444444-4444-4444-8444-444444444444",
      },
    ],
    tombstones: [
      {
        itemId: "55555555-5555-4555-8555-555555555555",
        revision: 4,
        deletedAt: "2026-05-06T07:08:09.000Z",
      },
    ],
  },
};

const folderIds = {
  work: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  clients: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  personal: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const metadata = {
  schemaVersion: 2 as const,
  revision: 1,
  createdAt: "2026-03-04T05:06:07.000Z",
  updatedAt: "2026-03-04T05:06:07.000Z",
  favorite: false,
  tags: [],
};
/** Every item kind, folders, and a login linked to a one-time code. */
const mixedPayload: PortableBackupPayloadV2 = {
  schemaVersion: 2,
  exportedAt: fixedNow,
  items: [
    { ...payload.items[0]!, folderId: folderIds.work },
    {
      ...metadata,
      id: "66666666-6666-4666-8666-666666666666",
      kind: "login",
      name: "Synthetic mail",
      username: "fixture@example.invalid",
      password: 'correct horse, "battery" staple',
      urls: ["https://mail.example.invalid/login", "https://example.invalid"],
      urlMatches: ["domain", "host"],
      linkedOtpId: "11111111-1111-4111-8111-111111111111",
      customFields: [{ name: "PIN", type: "hidden", value: "1234" }],
      passwordHistory: [{ password: "older", changedAt: "2026-02-01T00:00:00.000Z" }],
      passkeys: [
        {
          credentialId: "Y3JlZA",
          rpId: "example.invalid",
          userHandle: "dXNlcg",
          userName: "fixture",
          algorithm: -7,
          privateKey: "cHJpdmF0ZQ",
          publicKey: "cHVibGlj",
          counter: 3,
          createdAt: "2026-02-01T00:00:00.000Z",
        },
      ],
      notes: "line one\nline two",
      folderId: folderIds.clients,
    },
    {
      ...metadata,
      id: "77777777-7777-4777-8777-777777777777",
      kind: "note",
      name: "Recovery codes",
      content: "café ∕ カフェ",
      archivedAt: "2026-04-01T00:00:00.000Z",
    },
    {
      ...metadata,
      id: "88888888-8888-4888-8888-888888888888",
      kind: "card",
      name: "Synthetic card",
      brand: "visa",
      cardholderName: "Fixture Holder",
      number: "4111111111111111",
      expMonth: "12",
      expYear: "2031",
      cvv: "123",
      pin: "",
      notes: "",
      folderId: folderIds.personal,
    },
    {
      ...metadata,
      id: "99999999-9999-4999-8999-999999999999",
      kind: "identity",
      name: "Fixture identity",
      firstName: "Fixture",
      lastName: "Person",
      email: "fixture@example.invalid",
      phone: "",
      street: "",
      city: "",
      state: "",
      zip: "",
      country: "",
      notes: "",
    },
    {
      ...metadata,
      id: "aaaaaaaa-1111-4111-8111-111111111111",
      kind: "secret",
      name: "Deploy token",
      secretType: "token",
      value: "tok_synthetic",
      metadata: { env: "staging" },
      notes: "",
    },
  ],
  folders: [
    { id: folderIds.work, name: "Work" },
    { id: folderIds.clients, name: "Clients", parentId: folderIds.work },
    { id: folderIds.personal, name: "Personal" },
  ],
  settings: { autoLockMinutes: 5, lockOnScreenLock: false },
  history: payload.history,
};

const randomFixture = Uint8Array.from({ length: 40 }, (_, index) => index + 1);

async function exportFixture(input: PortableBackupPayload = payload): Promise<Uint8Array> {
  return exportPortableBackup(input, password, executor(), {
    random: createDeterministicRandomSource(randomFixture),
    kdfParameters: DEFAULT_ARGON2ID_PARAMETERS,
  });
}

function parseJsonEnvelope(input: Uint8Array): BackupV2Envelope {
  return JSON.parse(decoder.decode(input)) as BackupV2Envelope;
}

async function envelopeForPlaintext(
  plaintext: string,
  payloadSchemaVersion: 1 | 2 = 1,
): Promise<Uint8Array> {
  const salt = randomFixture.slice(0, 16);
  const nonce = randomFixture.slice(16, 40);
  const header: BackupV2Header = {
    type: "shardpass-backup",
    formatVersion: 2,
    payloadSchemaVersion,
    kdf: {
      algorithm: "argon2id",
      version: 19,
      memoryKiB: DEFAULT_ARGON2ID_PARAMETERS.memoryKiB,
      iterations: DEFAULT_ARGON2ID_PARAMETERS.iterations,
      parallelism: DEFAULT_ARGON2ID_PARAMETERS.parallelism,
      salt: base64(salt),
    },
    cipher: { algorithm: "xchacha20-poly1305", nonce: base64(nonce) },
  };
  const key = deterministicKey({
    password,
    salt,
    parameters: {
      memoryKiB: DEFAULT_ARGON2ID_PARAMETERS.memoryKiB,
      iterations: DEFAULT_ARGON2ID_PARAMETERS.iterations,
      parallelism: DEFAULT_ARGON2ID_PARAMETERS.parallelism,
      algorithm: "argon2id",
    },
  });
  const encrypted = await encryptEnvelope(
    key,
    bytes(plaintext),
    encodeBackupV2Header(header),
    createDeterministicRandomSource(nonce),
  );
  key.fill(0);
  return bytes(JSON.stringify({ ...header, ciphertext: base64(encrypted.ciphertext) }));
}

describe("ShardPass portable backup v2", () => {
  it("encodes the canonical header in one deterministic fixed field order", () => {
    const header: BackupV2Header = {
      type: "shardpass-backup",
      formatVersion: 2,
      payloadSchemaVersion: 1,
      kdf: {
        algorithm: "argon2id",
        version: 19,
        memoryKiB: 65536,
        iterations: 2,
        parallelism: 1,
        salt: "AQIDBAUGBwgJCgsMDQ4PEA==",
      },
      cipher: {
        algorithm: "xchacha20-poly1305",
        nonce: "ERITFBUWFxgZGhscHR4fICEiIyQlJico",
      },
    };
    expect(decoder.decode(encodeBackupV2Header(header))).toBe(
      '{"type":"shardpass-backup","formatVersion":2,"payloadSchemaVersion":1,"kdf":{"algorithm":"argon2id","version":19,"memoryKiB":65536,"iterations":2,"parallelism":1,"salt":"AQIDBAUGBwgJCgsMDQ4PEA=="},"cipher":{"algorithm":"xchacha20-poly1305","nonce":"ERITFBUWFxgZGhscHR4fICEiIyQlJico"}}',
    );
  });

  it("still reads a version 1 (one-time-codes-only) file exactly as written", async () => {
    const exported = await exportFixture();
    expect(parseBackupV2Envelope(exported).payloadSchemaVersion).toBe(1);
    const imported = await importPortableBackup(exported, password, executor());
    expect(imported).toEqual({ sourceFormat: "v2", payload });

    const outer = decoder.decode(exported);
    expect(outer).not.toContain("Synthetic Ω Service");
    expect(outer).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it("round trips a whole vault: every item kind, folders, settings, journal, and tombstones", async () => {
    const exported = await exportFixture(mixedPayload);
    const envelope = parseBackupV2Envelope(exported);
    expect(envelope.payloadSchemaVersion).toBe(2);
    const imported = await importPortableBackup(exported, password, executor());
    expect(imported).toEqual({ sourceFormat: "v2", payload: mixedPayload });
    if (imported.payload.schemaVersion !== 2) throw new Error("expected a version 2 payload");
    expect(imported.payload.items.map((item) => item.kind)).toEqual([
      "otp",
      "login",
      "note",
      "card",
      "identity",
      "secret",
    ]);
    expect(imported.payload.folders).toHaveLength(3);

    const outer = decoder.decode(exported);
    for (const secret of [
      "correct horse",
      "4111111111111111",
      "tok_synthetic",
      "cHJpdmF0ZQ",
      "Recovery codes",
      "Clients",
    ]) {
      expect(outer).not.toContain(secret);
    }
  });

  it("binds the payload version into the authenticated header and rejects a mismatch", async () => {
    const v2AsV1 = await envelopeForPlaintext(
      JSON.stringify({ ...mixedPayload, folders: undefined, schemaVersion: 1 }),
      2,
    );
    await expect(importPortableBackup(v2AsV1, password, executor())).rejects.toThrow();
    const v1AsV2 = await envelopeForPlaintext(JSON.stringify(payload), 2);
    await expect(importPortableBackup(v1AsV2, password, executor())).rejects.toThrow();
    const canonicalV2 = await envelopeForPlaintext(
      decoder.decode(encodeCanonicalPayload(mixedPayload)),
      2,
    );
    await expect(importPortableBackup(canonicalV2, password, executor())).resolves.toEqual({
      sourceFormat: "v2",
      payload: mixedPayload,
    });
  });

  it("accepts a file sealed with the older schema-ordered encoding, and encodes independently of key order", async () => {
    const older = await envelopeForPlaintext(
      decoder.decode(encodeLegacyCanonicalPayload(mixedPayload)),
      2,
    );
    await expect(importPortableBackup(older, password, executor())).resolves.toMatchObject({
      sourceFormat: "v2",
    });
    // A field added to a schema later must not change how the fields before it encode.
    const reordered = {
      ...mixedPayload,
      items: mixedPayload.items.map((item) => Object.fromEntries(Object.entries(item).reverse())),
    } as typeof mixedPayload;
    expect(decoder.decode(encodeCanonicalPayload(reordered))).toBe(
      decoder.decode(encodeCanonicalPayload(mixedPayload)),
    );
  });

  it("rejects folders that are not one bounded tree, and bounds their count", async () => {
    const cyclic = {
      ...mixedPayload,
      folders: [
        { id: folderIds.work, name: "Work", parentId: folderIds.clients },
        { id: folderIds.clients, name: "Clients", parentId: folderIds.work },
      ],
    };
    const orphan = {
      ...mixedPayload,
      folders: [{ id: folderIds.clients, name: "Clients", parentId: folderIds.work }],
    };
    const tooDeep = {
      ...mixedPayload,
      folders: [
        { id: folderIds.work, name: "A" },
        { id: folderIds.clients, name: "B", parentId: folderIds.work },
        { id: folderIds.personal, name: "C", parentId: folderIds.clients },
        { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "D", parentId: folderIds.personal },
      ],
    };
    const duplicateIds = {
      ...mixedPayload,
      folders: [
        { id: folderIds.work, name: "Work" },
        { id: folderIds.work, name: "Work again" },
      ],
    };
    const tooMany = {
      ...mixedPayload,
      folders: Array.from({ length: BACKUP_V2_LIMITS.maxFolders + 1 }, (_, index) => ({
        id: `${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
        name: `Folder ${index.toString()}`,
      })),
    };
    for (const invalid of [cyclic, orphan, tooDeep, duplicateIds, tooMany]) {
      await expect(exportPortableBackup(invalid, password, executor())).rejects.toThrow();
    }
    const v1WithFolders = { ...payload, folders: [] };
    await expect(exportPortableBackup(v1WithFolders, password, executor())).rejects.toThrow();
    const { folders: _folders, ...v2WithoutFolders } = mixedPayload;
    void _folders;
    await expect(
      exportPortableBackup(v2WithoutFolders as never, password, executor()),
    ).rejects.toThrow();
  });

  it("uses fresh 16-byte salts and 24-byte nonces and never mutates caller password bytes", async () => {
    const callerPassword = password.slice();
    const first = await exportPortableBackup(payload, callerPassword, executor());
    const second = await exportPortableBackup(payload, callerPassword, executor());
    expect(callerPassword).toEqual(password);

    const firstEnvelope = parseBackupV2Envelope(first);
    const secondEnvelope = parseBackupV2Envelope(second);
    expect(firstEnvelope.kdf.salt).not.toBe(secondEnvelope.kdf.salt);
    expect(firstEnvelope.cipher.nonce).not.toBe(secondEnvelope.cipher.nonce);
    expect(atob(firstEnvelope.kdf.salt)).toHaveLength(16);
    expect(atob(firstEnvelope.cipher.nonce)).toHaveLength(24);
  });

  it("strictly rejects unknown fields, noncanonical JSON/Base64, lengths, and format identifiers", async () => {
    const valid = parseJsonEnvelope(await exportFixture());
    const invalid = [
      { ...valid, unexpected: true },
      { ...valid, type: "other-backup" },
      { ...valid, formatVersion: 3 },
      { ...valid, payloadSchemaVersion: 3 },
      { ...valid, kdf: { ...valid.kdf, algorithm: "argon2i" } },
      { ...valid, kdf: { ...valid.kdf, version: 16 } },
      { ...valid, kdf: { ...valid.kdf, salt: valid.kdf.salt.replace(/==$/u, "") } },
      { ...valid, kdf: { ...valid.kdf, salt: base64(new Uint8Array(15)) } },
      { ...valid, cipher: { ...valid.cipher, algorithm: "aes-gcm" } },
      { ...valid, cipher: { ...valid.cipher, nonce: base64(new Uint8Array(23)) } },
      { ...valid, ciphertext: `${valid.ciphertext}=` },
    ];
    for (const candidate of invalid) {
      expect(() => parseBackupV2Envelope(bytes(JSON.stringify(candidate)))).toThrow();
    }
    expect(() => parseBackupV2Envelope(bytes(JSON.stringify(valid, null, 2)))).toThrow();
    expect(() => parseBackupV2Envelope(bytes(`\uFEFF${JSON.stringify(valid)}`))).toThrow();
    expect(() => parseBackupV2Envelope(Uint8Array.of(0xff))).toThrow();
  });

  it("rejects envelope, ciphertext, KDF, and collection bounds before invoking the KDF", async () => {
    const valid = parseJsonEnvelope(await exportFixture());
    const derive = vi.fn();
    const neverExecutor: KdfExecutor = { derive };
    const invalidParameters = [
      { memoryKiB: 8191 },
      { memoryKiB: 131073 },
      { iterations: 0 },
      { iterations: 11 },
      { parallelism: 0 },
      { parallelism: 5 },
      { memoryKiB: 8, parallelism: 2 },
      { memoryKiB: Number.MAX_SAFE_INTEGER + 1 },
    ];
    for (const change of invalidParameters) {
      const candidate = { ...valid, kdf: { ...valid.kdf, ...change } };
      await expect(
        importPortableBackup(bytes(JSON.stringify(candidate)), password, neverExecutor),
      ).rejects.toThrow();
    }
    expect(derive).not.toHaveBeenCalled();

    expect(() =>
      parseBackupV2Envelope(new Uint8Array(BACKUP_V2_LIMITS.maxEnvelopeBytes + 1)),
    ).toThrow();
    const oversizedCiphertext = base64(new Uint8Array(BACKUP_V2_LIMITS.maxCiphertextBytes + 1));
    expect(() =>
      parseBackupV2Envelope(bytes(JSON.stringify({ ...valid, ciphertext: oversizedCiphertext }))),
    ).toThrow();

    const exportDerive = vi.fn();
    await expect(
      exportPortableBackup(
        {
          ...payload,
          items: Array.from({ length: BACKUP_V2_LIMITS.maxItems + 1 }, () => payload.items[0]!),
        },
        password,
        executor(exportDerive),
      ),
    ).rejects.toThrow();
    // Well under maxItems, but over maxCiphertextBytes: the byte bound is checked on its own.
    const largeValidItem = { ...payload.items[0]!, note: "x".repeat(4_096) };
    await expect(
      exportPortableBackup(
        {
          ...payload,
          items: Array.from({ length: 2_000 }, () => largeValidItem),
        },
        password,
        executor(exportDerive),
      ),
    ).rejects.toThrow();
    expect(exportDerive).not.toHaveBeenCalled();

    const envelopeRandomBytes = vi.fn(() => {
      throw new Error("random must not run");
    });
    const envelopeDerive = vi.fn();
    await expect(
      exportPortableBackup(
        {
          ...payload,
          items: Array.from({ length: 1_600 }, () => largeValidItem),
        },
        password,
        { derive: envelopeDerive },
        { random: { randomBytes: envelopeRandomBytes } },
      ),
    ).rejects.toThrow();
    expect(envelopeRandomBytes).not.toHaveBeenCalled();
    expect(envelopeDerive).not.toHaveBeenCalled();

    await expect(
      exportPortableBackup(
        {
          ...payload,
          history: {
            ...payload.history,
            journal: Array.from(
              { length: BACKUP_V2_LIMITS.maxJournalEntries + 1 },
              () => payload.history.journal[0]!,
            ),
          },
        },
        password,
        executor(),
      ),
    ).rejects.toThrow();
    await expect(
      exportPortableBackup(
        {
          ...payload,
          history: {
            ...payload.history,
            tombstones: Array.from(
              { length: BACKUP_V2_LIMITS.maxTombstones + 1 },
              () => payload.history.tombstones[0]!,
            ),
          },
        },
        password,
        executor(),
      ),
    ).rejects.toThrow();
  });

  it("authenticates the exact canonical header and ciphertext and rejects a wrong password", async () => {
    const exported = await exportFixture();
    const valid = parseJsonEnvelope(exported);
    const tamperedHeader = {
      ...valid,
      kdf: { ...valid.kdf, iterations: valid.kdf.iterations + 1 },
    };
    const ciphertext = atob(valid.ciphertext);
    const changed = Uint8Array.from(ciphertext, (character) => character.charCodeAt(0));
    changed[0] = changed[0]! ^ 1;

    for (const [candidate, candidatePassword] of [
      [exported, otherPassword],
      [bytes(JSON.stringify(tamperedHeader)), password],
      [bytes(JSON.stringify({ ...valid, ciphertext: base64(changed) })), password],
    ] as const) {
      await expect(
        importPortableBackup(candidate, candidatePassword, executor()),
      ).rejects.toThrow();
    }
  });

  it("rejects malformed and noncanonical decrypted payloads and unsupported payload versions", async () => {
    for (const plaintext of [
      "{",
      JSON.stringify({ ...payload, schemaVersion: 2 }),
      JSON.stringify({ ...payload, schemaVersion: 3 }),
      JSON.stringify({ ...payload, extra: true }),
      JSON.stringify(payload, null, 2),
      `{"exportedAt":"${fixedNow}","schemaVersion":1,"items":[],"settings":{"autoLockMinutes":15,"lockOnScreenLock":true},"history":{"journal":[],"tombstones":[]}}`,
    ]) {
      await expect(
        importPortableBackup(await envelopeForPlaintext(plaintext), password, executor()),
      ).rejects.toThrow();
    }
  });

  it("excludes vault and session internals from both canonical plaintext and envelope", async () => {
    const forbidden = [
      "dek",
      "wrappedKey",
      "root",
      "manifest",
      "receipt",
      "reservation",
      "sessionEpoch",
      "capability",
      "authToken",
      "masterKey",
      "ente",
    ];
    const exported = await exportFixture();
    const envelope = parseJsonEnvelope(exported);
    const imported = await importPortableBackup(exported, password, executor());
    const serializedEnvelope = JSON.stringify(envelope);
    const serializedPayload = JSON.stringify(imported.payload);
    for (const field of forbidden) {
      expect(serializedEnvelope).not.toContain(`"${field}"`);
      expect(serializedPayload).not.toContain(`"${field}"`);
    }
  });

  it("clears implementation-owned password, key, salt, and plaintext copies on success and failure", async () => {
    const observed: KdfRequest[] = [];
    const sourcePassword = password.slice();
    const exported = await exportPortableBackup(
      payload,
      sourcePassword,
      executor((request) => observed.push(request)),
      {
        random: createDeterministicRandomSource(randomFixture),
      },
    );
    expect(sourcePassword).toEqual(password);
    expect(observed).toHaveLength(1);
    expect(observed[0]!.password.every((value) => value === 0)).toBe(true);
    expect(observed[0]!.salt.every((value) => value === 0)).toBe(true);

    observed.length = 0;
    await importPortableBackup(
      exported,
      sourcePassword,
      executor((request) => observed.push(request)),
    );
    expect(sourcePassword).toEqual(password);
    expect(observed[0]!.password.every((value) => value === 0)).toBe(true);
    expect(observed[0]!.salt.every((value) => value === 0)).toBe(true);

    observed.length = 0;
    await expect(
      importPortableBackup(exported, sourcePassword, {
        derive(request) {
          observed.push(request);
          return Promise.reject(new Error("synthetic failure"));
        },
      }),
    ).rejects.toThrow();
    expect(observed[0]!.password.every((value) => value === 0)).toBe(true);
    expect(observed[0]!.salt.every((value) => value === 0)).toBe(true);
  });
});

describe("authorized legacy backup import-only compatibility", () => {
  it("imports the pinned shardpass-export fixture while omitting Ente state", async () => {
    const fixture = JSON.parse(
      await readFile(path.join(root, "tests/fixtures/legacy/backup-export.json"), "utf8"),
    ) as { testOnlyPassword: string };
    const productionArtifact = Object.fromEntries(
      Object.entries(fixture).filter(([key]) => !["synthetic", "testOnlyPassword"].includes(key)),
    );
    const imported = await importLegacyBackup(
      bytes(JSON.stringify(productionArtifact)),
      bytes(fixture.testOnlyPassword),
    );
    expect(imported.sourceFormat).toBe("legacy-v1");
    expect(imported.payload.schemaVersion).toBe(1);
    expect(imported.payload.items).toHaveLength(8);
    expect(
      imported.payload.items.map((item) => (item.kind === "otp" ? item.otpType : item.kind)),
    ).toEqual(["totp", "totp", "totp", "totp", "hotp", "hotp", "steam", "totp"]);
    expect(imported.payload.settings).toEqual({ autoLockMinutes: 15, lockOnScreenLock: true });
    expect(imported.payload.history).toEqual({ journal: [], tombstones: [] });
    expect(JSON.stringify(imported)).not.toContain("authToken");
    expect(JSON.stringify(imported)).not.toContain("masterKey");
  });

  it("rejects an oversized legacy wrapper before parsing or decryption", async () => {
    await expect(
      importLegacyBackup(
        new Uint8Array(MAX_LEGACY_BACKUP_ENVELOPE_BYTES + 1),
        bytes("synthetic password"),
      ),
    ).rejects.toThrow();
  });

  it("strictly rejects metadata accepted only by the test fixture loader and never exposes legacy export", async () => {
    const fixture = JSON.parse(
      await readFile(path.join(root, "tests/fixtures/legacy/backup-export.json"), "utf8"),
    ) as Record<string, unknown>;
    const withoutFixtureMetadata = Object.fromEntries(
      Object.entries(fixture).filter(([key]) => !["synthetic", "testOnlyPassword"].includes(key)),
    );
    await expect(
      importLegacyBackup(
        bytes(JSON.stringify(withoutFixtureMetadata)),
        bytes(String(fixture.testOnlyPassword)),
      ),
    ).resolves.toMatchObject({ sourceFormat: "legacy-v1" });
    await expect(
      importLegacyBackup(bytes(JSON.stringify(fixture)), bytes(String(fixture.testOnlyPassword))),
    ).rejects.toThrow();
    await expect(
      importLegacyBackup(
        bytes(JSON.stringify({ ...withoutFixtureMetadata, unknown: true })),
        bytes(String(fixture.testOnlyPassword)),
      ),
    ).rejects.toThrow();

    const publicApi = await import("../src/index");
    expect(Object.keys(publicApi).some((name) => /exportLegacy/iu.test(name))).toBe(false);
  });
});
