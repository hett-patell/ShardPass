import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { IMPORT_LIMITS, parseAegisExport } from "../src";

const uuid = (suffix: string) => `123e4567-e89b-42d3-a456-${suffix.padStart(12, "0")}`;
const canonicalEntry = (overrides: Record<string, unknown> = {}) => ({
  type: "totp",
  uuid: uuid("1"),
  name: "Account",
  issuer: "Example",
  note: "Local note",
  icon: null,
  favorite: true,
  info: { secret: "gezd gnbv-gy3tqojq====", algo: "SHA256", digits: 8, period: 45 },
  groups: [uuid("101")],
  ...overrides,
});
const value = {
  version: 1,
  header: { slots: null, params: null },
  db: {
    version: 3,
    entries: [
      canonicalEntry(),
      canonicalEntry({
        type: "hotp",
        uuid: uuid("2"),
        name: "Counter",
        note: "",
        favorite: false,
        info: { secret: "GEZDGNBVGY3TQOJQ", algo: "SHA512", digits: 8, counter: 0 },
        groups: [],
      }),
      canonicalEntry({
        type: "steam",
        uuid: uuid("3"),
        name: "Game",
        issuer: "Valve",
        note: "",
        favorite: false,
        info: { secret: "GEZDGNBVGY3TQOJQ", algo: "SHA1", digits: 5, period: 30 },
        groups: [],
      }),
    ],
    groups: [{ uuid: uuid("101"), name: "Personal" }],
    icons_optimized: true,
  },
};

const encode = (candidate: unknown) => JSON.stringify(candidate);
const fixedFailure = (operation: () => unknown, code?: string) => {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toMatch(/^IMPORT_(?:MALFORMED|UNSUPPORTED|LIMIT_EXCEEDED)$/u);
  if (code !== undefined) expect((thrown as Error).message).toBe(code);
  expect((thrown as Error).message).not.toContain("GEZDGNBV");
};
const oneEntry = (entry: unknown, groups = value.db.groups) =>
  encode({
    version: 1,
    header: { slots: null, params: null },
    db: { version: 3, entries: [entry], groups, icons_optimized: true },
  });

const iconHash = (mime: string, bytes: Uint8Array) =>
  createHash("sha256").update(mime).update(bytes).digest("hex");

describe("supported canonical Aegis JSON imports", () => {
  it("accepts omitted icons_optimized as the official db-v3 false default", () => {
    const omitted = structuredClone(value) as { db: Record<string, unknown> };
    delete omitted.db.icons_optimized;
    expect(parseAegisExport(encode(omitted)).candidates).toHaveLength(3);
  });

  it("accepts present boolean icons_optimized and rejects non-booleans", () => {
    expect(parseAegisExport(encode(value)).candidates).toHaveLength(3);
    expect(
      parseAegisExport(encode({ ...value, db: { ...value.db, icons_optimized: false } }))
        .candidates,
    ).toHaveLength(3);
    fixedFailure(
      () => parseAegisExport(encode({ ...value, db: { ...value.db, icons_optimized: "true" } })),
      "IMPORT_UNSUPPORTED",
    );
  });

  it("accepts both documented unencrypted header shapes", () => {
    expect(parseAegisExport(encode(value)).candidates).toHaveLength(3);
    expect(parseAegisExport(encode({ ...value, header: {} })).candidates).toHaveLength(3);
  });

  it.each([
    ["slots only null", { slots: null }],
    ["params only null", { params: null }],
    ["unknown key", { slots: null, params: null, critical: true }],
    ["nonnull slots", { slots: [], params: null }],
    ["nonnull params", { slots: null, params: {} }],
  ])("rejects unsupported unencrypted header shape %s", (_name, header) => {
    fixedFailure(() => parseAegisExport(encode({ ...value, header })), "IMPORT_UNSUPPORTED");
  });

  it("accepts both exact null-icon shapes", () => {
    expect(parseAegisExport(oneEntry(canonicalEntry())).candidates).toHaveLength(1);
    expect(
      parseAegisExport(oneEntry(canonicalEntry({ icon_mime: null, icon_hash: null }))).candidates,
    ).toHaveLength(1);
  });

  it("rejects partial or nonnull auxiliary fields for a null icon", () => {
    for (const entry of [
      canonicalEntry({ icon_mime: null }),
      canonicalEntry({ icon_hash: null }),
      canonicalEntry({ icon_mime: null, icon_hash: "0".repeat(64) }),
      canonicalEntry({ icon_mime: "image/jpeg", icon_hash: null }),
      canonicalEntry({ icon_mime: "image/jpeg", icon_hash: "0".repeat(64) }),
    ]) {
      expect(parseAegisExport(oneEntry(entry))).toEqual({
        format: "aegis",
        candidates: [],
        rejected: [{ ordinal: 1, reason: "IMPORT_MALFORMED" }],
      });
    }
  });

  it("rejects unknown entry fields under both icon variants", () => {
    expect(parseAegisExport(oneEntry(canonicalEntry({ critical: true })))).toEqual({
      format: "aegis",
      candidates: [],
      rejected: [{ ordinal: 1, reason: "IMPORT_MALFORMED" }],
    });
    const bytes = Uint8Array.of(1, 2, 3);
    const mime = "image/png";
    expect(
      parseAegisExport(
        oneEntry(
          canonicalEntry({
            icon: Buffer.from(bytes).toString("base64"),
            icon_mime: mime,
            icon_hash: iconHash(mime, bytes),
            critical: true,
          }),
        ),
      ),
    ).toEqual({
      format: "aegis",
      candidates: [],
      rejected: [{ ordinal: 1, reason: "IMPORT_MALFORMED" }],
    });
  });

  it("preserves documented complete TOTP, HOTP, Steam, and local metadata", () => {
    expect(parseAegisExport(encode(value))).toEqual({
      format: "aegis",
      candidates: [
        {
          sourceOrdinal: 1,
          issuer: "Example",
          label: "Account",
          secret: "GEZDGNBVGY3TQOJQ",
          otpType: "totp",
          algorithm: "SHA256",
          digits: 8,
          period: 45,
          favorite: true,
          tags: ["Personal"],
          note: "Local note",
        },
        expect.objectContaining({ otpType: "hotp", counter: 0, period: 0, note: "", tags: [] }),
        expect.objectContaining({ otpType: "steam", algorithm: "SHA1", digits: 5, period: 30 }),
      ],
      rejected: [],
    });
  });

  it.each(["type", "uuid", "name", "issuer", "note", "icon", "favorite", "info", "groups"])(
    "marks a supported entry missing required %s as malformed",
    (field) => {
      const entry = canonicalEntry();
      delete entry[field as keyof typeof entry];
      expect(parseAegisExport(oneEntry(entry))).toEqual({
        format: "aegis",
        candidates: [],
        rejected: [{ ordinal: 1, reason: "IMPORT_MALFORMED" }],
      });
    },
  );

  it.each([
    ["entry UUID version", canonicalEntry({ uuid: "123e4567-e89b-12d3-a456-426614174000" })],
    ["unknown entry field", canonicalEntry({ critical: true })],
    ["unknown info field", canonicalEntry({ info: { ...canonicalEntry().info, counter: 1 } })],
    ["wrong note type", canonicalEntry({ note: null })],
    ["wrong favorite type", canonicalEntry({ favorite: 1 })],
  ])("marks malformed supported %s row safely", (_name, entry, groups = value.db.groups) => {
    expect(parseAegisExport(oneEntry(entry, groups))).toEqual({
      format: "aegis",
      candidates: [],
      rejected: [{ ordinal: 1, reason: "IMPORT_MALFORMED" }],
    });
  });

  it("accepts a valid icon larger than the generic string bound and verifies its hash", () => {
    const bytes = Uint8Array.from({ length: 3_600 }, (_, index) => index % 251);
    const mime = "image/png";
    const icon = Buffer.from(bytes).toString("base64");
    expect(icon.length).toBeGreaterThan(4_096);
    expect(
      parseAegisExport(
        oneEntry(canonicalEntry({ icon, icon_mime: mime, icon_hash: iconHash(mime, bytes) })),
      ).candidates,
    ).toHaveLength(1);
  });

  it("rejects non-icon strings above the generic scalar bound", () => {
    fixedFailure(
      () => parseAegisExport(oneEntry(canonicalEntry({ note: "n".repeat(4_097) }))),
      "IMPORT_LIMIT_EXCEEDED",
    );
  });

  it.each([
    ["null icon with null MIME", { icon: null, icon_mime: null }],
    ["null icon with null hash", { icon: null, icon_hash: null }],
    [
      "null icon with MIME/hash",
      { icon: null, icon_mime: "image/jpeg", icon_hash: "0".repeat(64) },
    ],
    ["icon missing MIME", { icon: "YWJjZA==", icon_hash: "0".repeat(64) }],
    ["icon missing hash", { icon: "YWJjZA==", icon_mime: "image/jpeg" }],
    ["unpadded icon", { icon: "YWJjZA", icon_mime: "image/jpeg", icon_hash: "0".repeat(64) }],
    ["unsupported MIME", { icon: "YWJjZA==", icon_mime: "image/webp", icon_hash: "0".repeat(64) }],
    ["uppercase hash", { icon: "YWJjZA==", icon_mime: "image/jpeg", icon_hash: "A".repeat(64) }],
    ["short hash", { icon: "YWJjZA==", icon_mime: "image/jpeg", icon_hash: "a".repeat(63) }],
    ["hash mismatch", { icon: "YWJjZA==", icon_mime: "image/jpeg", icon_hash: "0".repeat(64) }],
  ])("enforces documented icon consistency for %s", (_name, iconFields) => {
    expect(parseAegisExport(oneEntry(canonicalEntry(iconFields)))).toEqual({
      format: "aegis",
      candidates: [],
      rejected: [{ ordinal: 1, reason: "IMPORT_MALFORMED" }],
    });
  });

  it("rejects an icon whose encoded length exceeds the total input-derived bound", () => {
    const icon = "A".repeat(Math.ceil(IMPORT_LIMITS.maxInputBytes / 3) * 4 + 4);
    fixedFailure(
      () =>
        parseAegisExport(
          oneEntry(
            canonicalEntry({
              icon,
              icon_mime: "image/jpeg",
              icon_hash: "0".repeat(64),
            }),
          ),
        ),
      "IMPORT_LIMIT_EXCEEDED",
    );
  });

  it("marks a supported row with a non-array groups field malformed", () => {
    expect(parseAegisExport(oneEntry(canonicalEntry({ groups: "group" })))).toEqual({
      format: "aegis",
      candidates: [],
      rejected: [{ ordinal: 1, reason: "IMPORT_MALFORMED" }],
    });
  });

  it("rejects invalid/duplicate entry and group UUIDs and missing references globally", () => {
    fixedFailure(
      () =>
        parseAegisExport(
          oneEntry(canonicalEntry(), [
            { uuid: "123e4567-e89b-12d3-a456-426614174000", name: "Personal" },
          ]),
        ),
      "IMPORT_UNSUPPORTED",
    );
    fixedFailure(
      () =>
        parseAegisExport(
          encode({
            ...value,
            db: { ...value.db, entries: [value.db.entries[0], value.db.entries[0]] },
          }),
        ),
      "IMPORT_UNSUPPORTED",
    );
    fixedFailure(
      () =>
        parseAegisExport(
          encode({
            ...value,
            db: { ...value.db, groups: [value.db.groups[0], value.db.groups[0]] },
          }),
        ),
      "IMPORT_UNSUPPORTED",
    );
    fixedFailure(
      () => parseAegisExport(oneEntry(canonicalEntry({ groups: [uuid("999")] }))),
      "IMPORT_UNSUPPORTED",
    );
  });

  it("uses malformed for malformed supported rows and unsupported for unsupported types", () => {
    const malformed = canonicalEntry({ info: { ...canonicalEntry().info, period: -1 } });
    const unsupported = canonicalEntry({ type: "motp", uuid: uuid("2") });
    expect(
      parseAegisExport(
        encode({ ...value, db: { ...value.db, entries: [malformed, unsupported] } }),
      ),
    ).toEqual({
      format: "aegis",
      candidates: [],
      rejected: [
        { ordinal: 1, reason: "IMPORT_MALFORMED" },
        { ordinal: 2, reason: "IMPORT_UNSUPPORTED" },
      ],
    });
  });

  it.each([
    ["envelope version", { ...value, version: 2 }],
    ["database version", { ...value, db: { ...value.db, version: 2 } }],
    ["unknown envelope field", { ...value, critical: true }],
    ["unknown database field", { ...value, db: { ...value.db, critical: true } }],
  ])("rejects unsupported or unknown %s", (_name, candidate) => {
    fixedFailure(() => parseAegisExport(encode(candidate)), "IMPORT_UNSUPPORTED");
  });

  it("returns fixed unsupported for encrypted and password-protected vaults", () => {
    fixedFailure(
      () =>
        parseAegisExport(
          encode({
            version: 1,
            header: { slots: [{ type: 1 }], params: { nonce: "00", tag: "00" } },
            db: "ciphertext",
          }),
        ),
      "IMPORT_UNSUPPORTED",
    );
  });

  it.each([
    ["rounded unsafe version", "9007199254740993"],
    ["fractional version", "1.0"],
    ["exponent version", "1e0"],
    ["underflow version", "1e-400"],
  ])("rejects non-lossless %s numeric lexemes", (_name, lexeme) => {
    fixedFailure(
      () =>
        parseAegisExport(
          `{"version":${lexeme},"header":{"slots":null,"params":null},"db":{"version":3,"entries":[],"groups":[],"icons_optimized":true}}`,
        ),
      "IMPORT_UNSUPPORTED",
    );
  });

  it.each([
    ["digits", "8.0"],
    ["period", "4.5e1"],
    ["counter", "9007199254740993"],
  ])("rejects invalid %s numeric lexemes row-by-row", (field, lexeme) => {
    const source = field === "counter" ? value.db.entries[1] : value.db.entries[0];
    const entry = JSON.stringify(source).replace(
      new RegExp(`"${field}":(?:8|45|0)`, "u"),
      `"${field}":${lexeme}`,
    );
    const text = `{"version":1,"header":{"slots":null,"params":null},"db":{"version":3,"entries":[${entry}],"groups":${JSON.stringify(value.db.groups)},"icons_optimized":true}}`;
    expect(parseAegisExport(text)).toEqual({
      format: "aegis",
      candidates: [],
      rejected: [{ ordinal: 1, reason: "IMPORT_MALFORMED" }],
    });
  });

  it("enforces 1,000 entries before mapping and rejects one over", () => {
    const boundary = {
      ...value,
      db: {
        ...value.db,
        groups: [],
        entries: Array.from({ length: IMPORT_LIMITS.maxEntries }, (_, index) => ({
          type: "totp",
          uuid: uuid(String(index + 1)),
          name: `A${index}`,
          issuer: "E",
          note: "",
          icon: null,
          favorite: false,
          info: { secret: "MY", algo: "SHA1", digits: 6, period: 30 },
          groups: [] as string[],
        })),
      },
    };
    expect(parseAegisExport(encode(boundary)).candidates).toHaveLength(IMPORT_LIMITS.maxEntries);
    boundary.db.entries.push(canonicalEntry({ uuid: uuid("1001"), groups: [] }));
    fixedFailure(() => parseAegisExport(encode(boundary)), "IMPORT_LIMIT_EXCEEDED");
  });
});
