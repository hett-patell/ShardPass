import {
  classifyImportCandidates,
  hasSameOtpSemanticKey,
  IMPORT_LIMITS,
  redactImportBuffer,
  safeImportMetadata,
  type ImportPreviewRow,
  type OtpImportCandidate,
} from "@shardpass/importers";
import { describe, expect, it } from "vitest";

const candidate = (overrides: Partial<OtpImportCandidate> = {}): OtpImportCandidate => ({
  sourceOrdinal: 1,
  issuer: "Example",
  label: "Primary",
  secret: "JBSWY3DP",
  otpType: "totp",
  algorithm: "SHA1",
  digits: 6,
  period: 30,
  favorite: false,
  tags: [],
  note: "",
  ...overrides,
});

const forbiddenPreviewNames = new Set([
  "secret",
  "uri",
  "raw",
  "rawLine",
  "source",
  "sourceId",
  "record",
  "fingerprint",
  "hash",
  "note",
  "tags",
  "favorite",
  "ente",
  "enteId",
]);

function expectNoSensitivePropertyNames(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) expectNoSensitivePropertyNames(entry);
    return;
  }
  if (value === null || typeof value !== "object") return;

  for (const [key, entry] of Object.entries(value)) {
    expect(forbiddenPreviewNames.has(key)).toBe(false);
    expectNoSensitivePropertyNames(entry);
  }
}

describe("bounded OTP import model", () => {
  it("publishes the exact fixed import limits as a frozen value", () => {
    expect(IMPORT_LIMITS).toEqual({
      maxInputBytes: 1_048_576,
      maxTextScalars: 262_144,
      maxEntries: 1_000,
      maxThirdPartyEntries: 5_000,
      maxMigrationBatches: 16,
      maxImageBytes: 8_388_608,
      maxImageDimension: 4_096,
      maxImagePixels: 16_777_216,
      maxQrPayloadBytes: 1_048_576,
      previewTtlMs: 300_000,
      maxPreviewsPerDocument: 4,
      maxLivePreviews: 32,
    });
    expect(Object.isFrozen(IMPORT_LIMITS)).toBe(true);
  });

  it("creates only a fresh deeply frozen safe metadata projection", () => {
    const tags = ["local"];
    const input = candidate({
      otpType: "hotp",
      period: 0,
      counter: 0,
      favorite: true,
      tags,
      note: "private",
    });

    const metadata = safeImportMetadata(input);
    tags[0] = "changed";

    expect(metadata).toEqual({
      issuer: "Example",
      label: "Primary",
      otpType: "hotp",
      algorithm: "SHA1",
      digits: 6,
      period: 0,
      counter: 0,
    });
    expect(Object.keys(metadata)).toEqual([
      "issuer",
      "label",
      "otpType",
      "algorithm",
      "digits",
      "period",
      "counter",
    ]);
    expect(Object.isFrozen(metadata)).toBe(true);
    expectNoSensitivePropertyNames(JSON.parse(JSON.stringify(metadata)));
  });

  it("rejects invalid candidate shapes instead of coercing or downgrading them", () => {
    const invalidCandidates = [
      candidate({ secret: "lowercase" }),
      candidate({ otpType: "steam", digits: 6 }),
      candidate({ otpType: "steam", algorithm: "SHA256", digits: 5 }),
      candidate({ otpType: "hotp", period: 0, counter: Number.MAX_SAFE_INTEGER + 1 }),
      candidate({ otpType: "totp", counter: 0 }),
      candidate({ digits: Number.NaN }),
      { ...candidate(), raw: "not allowed" },
    ];

    for (const invalid of invalidCandidates) {
      expect(() => safeImportMetadata(invalid as OtpImportCandidate)).toThrow(
        "Invalid OTP import candidate.",
      );
    }
  });

  it("compares the exact semantic fields directly with NFKC issuer and label", () => {
    const base = candidate({ issuer: "Cafe\u0301", label: "Ａccount" });
    expect(hasSameOtpSemanticKey(base, candidate({ issuer: "Café", label: "Account" }))).toBe(true);

    for (const changed of [
      candidate({ otpType: "hotp", period: 0, counter: 0 }),
      candidate({ secret: "MZXW6YTB" }),
      candidate({ algorithm: "SHA256" }),
      candidate({ digits: 8 }),
      candidate({ period: 60 }),
      candidate({ issuer: "Elsewhere" }),
      candidate({ label: "Secondary" }),
    ]) {
      expect(hasSameOtpSemanticKey(base, changed)).toBe(false);
    }

    expect(
      hasSameOtpSemanticKey(
        candidate({ otpType: "hotp", period: 0, counter: 0 }),
        candidate({ otpType: "hotp", period: 0, counter: 1 }),
      ),
    ).toBe(false);
    expect(
      hasSameOtpSemanticKey(
        candidate({ note: "one", tags: ["one"], favorite: true }),
        candidate({ note: "two", tags: ["two"], favorite: false }),
      ),
    ).toBe(true);
  });

  it("classifies existing and within-batch duplicates in first-wins order", () => {
    const first = candidate({ sourceOrdinal: 1 });
    const existingDuplicate = candidate({ sourceOrdinal: 3, label: "Stored" });
    const rows = classifyImportCandidates(
      [first, candidate({ sourceOrdinal: 2, note: "different" }), existingDuplicate],
      [existingDuplicate],
      ["opaque-row-a", "opaque-row-b", "opaque-row-c"],
    );

    expect(
      rows.map(({ rowId, ordinal, status, reason }) => ({ rowId, ordinal, status, reason })),
    ).toEqual([
      {
        rowId: "opaque-row-a",
        ordinal: 1,
        status: "accepted",
        reason: "IMPORT_ACCEPTED",
      },
      {
        rowId: "opaque-row-b",
        ordinal: 2,
        status: "duplicate",
        reason: "IMPORT_DUPLICATE_BATCH",
      },
      {
        rowId: "opaque-row-c",
        ordinal: 3,
        status: "duplicate",
        reason: "IMPORT_DUPLICATE_VAULT",
      },
    ]);
    expect(rows.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(rows)).toBe(true);
    expectNoSensitivePropertyNames(JSON.parse(JSON.stringify(rows)));
  });

  it("returns fresh output and never changes mutable candidate, existing, or ID inputs", () => {
    const candidates = [candidate()];
    const existing: OtpImportCandidate[] = [];
    const ids = ["opaque-row-a"];
    const candidatesBefore = structuredClone(candidates);
    const idsBefore = [...ids];

    const rows = classifyImportCandidates(candidates, existing, ids);
    candidates[0] = candidate({ label: "Changed later" });
    ids[0] = "changed-later";

    expect(candidatesBefore).toEqual([candidate()]);
    expect(idsBefore).toEqual(["opaque-row-a"]);
    expect(rows[0]?.rowId).toBe("opaque-row-a");
    expect(rows[0]?.metadata?.label).toBe("Primary");
  });

  it("rejects the total-entry boundary plus one before consuming row IDs", () => {
    const atLimit = Array.from({ length: IMPORT_LIMITS.maxEntries }, (_, index) =>
      candidate({ label: `Entry ${index}` }),
    );
    const ids = Array.from({ length: IMPORT_LIMITS.maxEntries }, (_, index) => `opaque-${index}`);
    expect(classifyImportCandidates(atLimit, [], ids)).toHaveLength(IMPORT_LIMITS.maxEntries);

    const tooMany = [...atLimit, candidate({ label: "One over" })];
    expect(() => classifyImportCandidates(tooMany, [], [...ids, "opaque-over"])).toThrow(
      "OTP import limit exceeded.",
    );
  });

  it("rejects missing, reused, index-derived, and non-opaque row IDs", () => {
    expect(() => classifyImportCandidates([candidate()], [], [])).toThrow(
      "Invalid OTP import row ID.",
    );
    expect(() => classifyImportCandidates([candidate()], [], ["0"])).toThrow(
      "Invalid OTP import row ID.",
    );
    expect(() =>
      classifyImportCandidates(
        [candidate(), candidate({ label: "Other" })],
        [],
        ["same-row", "same-row"],
      ),
    ).toThrow("Invalid OTP import row ID.");
  });

  it("keeps the public row enumerable and serialized key set minimal", () => {
    const row: ImportPreviewRow = classifyImportCandidates([candidate()], [], ["opaque-row-a"])[0]!;
    expect(Object.keys(row)).toEqual(["rowId", "ordinal", "status", "reason", "metadata"]);
    expect(Object.keys(JSON.parse(JSON.stringify(row)) as object)).toEqual([
      "rowId",
      "ordinal",
      "status",
      "reason",
      "metadata",
    ]);
    expectNoSensitivePropertyNames(row);
  });

  it("redacts every mutable byte synchronously", () => {
    const bytes = new Uint8Array([255, 1, 127, 64]);
    redactImportBuffer(bytes);
    expect([...bytes]).toEqual([0, 0, 0, 0]);
  });
});
