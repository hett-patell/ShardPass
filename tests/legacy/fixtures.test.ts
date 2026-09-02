import { createDecipheriv, createHash, createHmac, pbkdf2Sync } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(root, "tests/fixtures/legacy/fixture-manifest.json");
const manifestRelativePath = "tests/fixtures/legacy/fixture-manifest.json";
const knownAnswersRelativePath = "tests/fixtures/otp/known-answers.json";

interface OtpExpectation {
  algorithm: "SHA1" | "SHA256" | "SHA512" | "STEAM";
  code: string;
  counter: number;
  digits: number;
  id: string;
  period: number;
  standard: "RFC4226" | "RFC6238" | "static-inference-only";
  timestamp: number | null;
  verificationState: "Verified standard vector" | "Unverified runtime parity";
}

interface FixtureManifestEntry {
  expectedErrorCategory?: "AUTHENTICATION_FAILED" | "MALFORMED_ENVELOPE";
  expectedFailurePhase?: "decrypt" | "validation";
  expectedOtpAt: OtpExpectation[];
  generationMethod: string;
  id: string;
  path: string;
  scenario?: "malformed-envelope" | "tampered-ciphertext" | "wrong-password";
  sha256: string;
  sourceFiles: string[];
  synthetic: boolean;
  verificationState:
    "Verified static format" | "Verified standard vectors" | "Unverified runtime parity";
}

interface FixtureManifest {
  artifactVersion: string;
  fixtures: FixtureManifestEntry[];
  formatVersion: number;
  gaps: Array<{ dimension: string; status: "Unverified"; reason: string }>;
  pathBase: "project-root";
  synthetic: boolean;
}

interface KnownAnswer extends OtpExpectation {
  secretBase32: string;
  source: string;
}

interface LegacyEnvelope {
  ciphertext: string;
  createdAt: number;
  iterations: number;
  iv: string;
  salt: string;
  updatedAt: number;
  version: 1;
}

type FailureCategory = "AUTHENTICATION_FAILED" | "MALFORMED_ENVELOPE";
type FailurePhase = "decrypt" | "validation";

class LegacyFixtureError extends Error {
  constructor(
    readonly category: FailureCategory,
    readonly phase: FailurePhase,
  ) {
    super(`${category} during ${phase}`);
    this.name = "LegacyFixtureError";
  }
}

const artifactHashes: Record<string, string> = {
  "assets/_commonjsHelpers-BNVkcQi_.js":
    "ca911bd3a8b2f04bc231a59dba4f656ec0e7b29e432804b6b249a283d51563ba",
  "assets/detect-GJf8O2wT.js": "785c921939c4249fdfbe0ce92f214f54494b93b78628ad57671b3724c2c9cf36",
  "assets/format-BF4VSr4S.js": "08251bf5f3286f24fa68b96e469c538ca9d0552a3eada4f45173796c38d0a687",
  "assets/icon-32-Cil8P8kB.png": "1167f7d8ca3516116a199daa7d91c5ccd4e611dda320e4643964df16d65908af",
  "assets/index.html-XjjvDkko.js":
    "9fb38722ba7d7ed8e0d78376b85241f5efb32240cd876fa19235f30855da7a59",
  "assets/index.ts-BbWVF1-a.js": "445d9283f9cc0ab5c0a71d6c3a2d490b76ef98a81f690322ca39c0e329f42bf0",
  "assets/index.ts-DTcWtSwh.js": "8ffc2951f8aabcc36a244ea1d5e22002b81945e1baa9ccd68bd0da58e464c243",
  "assets/index.ts-loader-BWnrBa67.js":
    "67b431071413419e08721f0918a38b107db3f200b98f62a2d8ff6a37c1bfb811",
  "assets/index-wA3AHzJ-.css": "95530ea809c8e174f7d0b47b736d33363a78a74487b409fc51afcead7bee2804",
  "assets/log-B-C8fiGH.js": "68e1f267b4a7202bcdfeace44f7f3fbcb599b23b0df047700475011fcf202e62",
  "icons/icon-128.png": "7cd25938d541034600c622f9c580cb0e2eadb772c941182bfb4ba6c7274bcf2c",
  "icons/icon-16.png": "7b2586fad0850426f6fbfd6ecb8a4c3c7f37140b0d7cd7576b90307117acb170",
  "icons/icon-32.png": "1167f7d8ca3516116a199daa7d91c5ccd4e611dda320e4643964df16d65908af",
  "icons/icon-48.png": "f904fad73e4c8bdd14dbf540fa65dd0a8ea560cdb99c39a0e09da047b83fb233",
  "manifest.json": "12c29933707cd477ee3d65de4dc28e0587af19480df267fa922245412a307245",
  "service-worker-loader.js": "3be8c6948af2def24d89286022d5867b3f2f963f829a1e089fe131e3e1f4be2d",
  "src/popup/index.html": "8d65ec7998e6fa021963b8ac1bc92c039f644f3a0eefbed7885a0d48fcf006ee",
};

async function loadJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function expectLegacyRegularFile(file: string, expectedHash: string): Promise<void> {
  const metadata = await lstat(file);
  expect(metadata.isSymbolicLink(), `${file} must not be a symbolic link`).toBe(false);
  expect(metadata.isFile(), `${file} must be a regular file`).toBe(true);
  expect(sha256(await readFile(file)), file).toBe(expectedHash);
}

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.replace(/[\s=-]/g, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 test vector");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateOtp(vector: KnownAnswer): string {
  const digest = vector.algorithm === "STEAM" ? "sha1" : vector.algorithm.toLowerCase();
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(vector.counter));
  const hmac = createHmac(digest, decodeBase32(vector.secretBase32)).update(message).digest();
  const offset = hmac.at(-1)! & 0x0f;
  let binary =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
  binary >>>= 0;
  if (vector.algorithm === "STEAM") {
    const alphabet = "23456789BCDFGHJKMNPQRTVWXY";
    let code = "";
    for (let index = 0; index < 5; index += 1) {
      code += alphabet[binary % alphabet.length];
      binary = Math.floor(binary / alphabet.length);
    }
    return code;
  }
  return String(binary % 10 ** vector.digits).padStart(vector.digits, "0");
}

function decodeCanonicalBase64(value: unknown, expectedLength?: number): Buffer {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new LegacyFixtureError("MALFORMED_ENVELOPE", "validation");
  }
  const decoded = Buffer.from(value, "base64");
  if (
    decoded.toString("base64") !== value ||
    (expectedLength !== undefined && decoded.length !== expectedLength)
  ) {
    throw new LegacyFixtureError("MALFORMED_ENVELOPE", "validation");
  }
  return decoded;
}

function parseLegacyEnvelope(value: unknown): LegacyEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LegacyFixtureError("MALFORMED_ENVELOPE", "validation");
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    "ciphertext",
    "createdAt",
    "iterations",
    "iv",
    "salt",
    "updatedAt",
    "version",
  ];
  if (Object.keys(record).sort().join("|") !== expectedKeys.join("|")) {
    throw new LegacyFixtureError("MALFORMED_ENVELOPE", "validation");
  }
  if (
    record.version !== 1 ||
    !Number.isSafeInteger(record.iterations) ||
    Number(record.iterations) < 1 ||
    Number(record.iterations) > 10_000_000 ||
    !Number.isSafeInteger(record.createdAt) ||
    Number(record.createdAt) < 0 ||
    !Number.isSafeInteger(record.updatedAt) ||
    Number(record.updatedAt) < 0
  ) {
    throw new LegacyFixtureError("MALFORMED_ENVELOPE", "validation");
  }
  decodeCanonicalBase64(record.salt, 16);
  decodeCanonicalBase64(record.iv, 12);
  if (decodeCanonicalBase64(record.ciphertext).length < 16) {
    throw new LegacyFixtureError("MALFORMED_ENVELOPE", "validation");
  }
  return record as unknown as LegacyEnvelope;
}

function fixtureEnvelope(document: Record<string, unknown>): unknown {
  if (document.type === "shardpass-export") {
    const { version, salt, iv, ciphertext, iterations, createdAt, updatedAt } = document;
    return { version, salt, iv, ciphertext, iterations, createdAt, updatedAt };
  }
  return document.vault;
}

function decryptLegacyEnvelope(value: unknown, password: string): Record<string, unknown> {
  const envelope = parseLegacyEnvelope(value);
  const salt = Buffer.from(envelope.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const encrypted = Buffer.from(envelope.ciphertext, "base64");
  try {
    const key = pbkdf2Sync(password, salt, envelope.iterations, 32, "sha256");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(encrypted.subarray(-16));
    return JSON.parse(
      Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString(
        "utf8",
      ),
    ) as Record<string, unknown>;
  } catch {
    throw new LegacyFixtureError("AUTHENTICATION_FAILED", "decrypt");
  }
}

async function generatedJsonPaths(): Promise<string[]> {
  const legacy = (await readdir(path.join(root, "tests/fixtures/legacy")))
    .filter((file) => file.endsWith(".json") && file !== "fixture-manifest.json")
    .map((file) => `tests/fixtures/legacy/${file}`);
  const otp = (await readdir(path.join(root, "tests/fixtures/otp")))
    .filter((file) => file.endsWith(".json"))
    .map((file) => `tests/fixtures/otp/${file}`);
  return [...legacy, ...otp].sort();
}

describe("legacy fixture corpus", () => {
  it("makes the manifest authoritative across generated fixture directories", async () => {
    const manifest = await loadJson<FixtureManifest>(manifestPath);
    expect(manifest).toMatchObject({
      artifactVersion: "1.2.1",
      formatVersion: 1,
      pathBase: "project-root",
      synthetic: true,
    });
    expect(manifest.fixtures).toHaveLength(9);
    expect(manifest.fixtures.map(({ path: fixturePath }) => fixturePath).sort()).toEqual(
      await generatedJsonPaths(),
    );
    expect(
      manifest.fixtures.some(({ path: fixturePath }) => fixturePath === manifestRelativePath),
    ).toBe(false);
    expect(
      manifest.fixtures.some(({ path: fixturePath }) => fixturePath === knownAnswersRelativePath),
    ).toBe(true);
    for (const fixture of manifest.fixtures) {
      expect(fixture.synthetic).toBe(true);
      expect(fixture.expectedOtpAt).toBeDefined();
      expect(fixture.generationMethod.length).toBeGreaterThan(10);
      expect(fixture.verificationState.length).toBeGreaterThan(10);
      expect(fixture.sourceFiles.length).toBeGreaterThan(0);
      expect(
        fixture.sourceFiles.every(
          (source) => source.startsWith("assets/") || source === "manifest.json",
        ),
      ).toBe(true);
      expect(sha256(await readFile(path.resolve(root, fixture.path)))).toBe(fixture.sha256);
    }
  });

  it("keeps the full Steam record and reduced manifest metadata explicitly runtime-unverified", async () => {
    const manifest = await loadJson<FixtureManifest>(manifestPath);
    const knownAnswersEntry = manifest.fixtures.find(
      ({ path: fixturePath }) => fixturePath === knownAnswersRelativePath,
    )!;
    const document = await loadJson<{ vectors: KnownAnswer[] }>(
      path.join(root, knownAnswersRelativePath),
    );
    const fullSteam = document.vectors.find(({ algorithm }) => algorithm === "STEAM")!;
    const manifestSteam = knownAnswersEntry.expectedOtpAt.find(
      ({ algorithm }) => algorithm === "STEAM",
    )!;
    const expectedSource =
      "ShardPass 1.2.1 static Steam inference; no artifact runtime execution or capture was performed";
    const expectedGenerationMethod =
      "Deterministic Node HMAC calculation of RFC vectors plus static Steam inference; no artifact runtime execution or capture was performed";

    expect(fullSteam).toMatchObject({
      source: expectedSource,
      standard: "static-inference-only",
      verificationState: "Unverified runtime parity",
    });
    expect(knownAnswersEntry).toMatchObject({
      generationMethod: expectedGenerationMethod,
      verificationState: "Unverified runtime parity",
    });
    expect(manifestSteam).toEqual({
      id: fullSteam.id,
      algorithm: fullSteam.algorithm,
      code: fullSteam.code,
      counter: fullSteam.counter,
      digits: fullSteam.digits,
      period: fullSteam.period,
      standard: fullSteam.standard,
      timestamp: fullSteam.timestamp,
      verificationState: fullSteam.verificationState,
    });

    const positiveRuntimeEvidence =
      /\b(?:runtime[- ]captured|captured compatibility|verified compatibility)\b/i;
    expect(fullSteam.source).not.toMatch(positiveRuntimeEvidence);
    expect(knownAnswersEntry.generationMethod).not.toMatch(positiveRuntimeEvidence);

    const everySteamExpectation = manifest.fixtures
      .flatMap(({ expectedOtpAt }) => expectedOtpAt)
      .filter(({ algorithm }) => algorithm === "STEAM");
    expect(everySteamExpectation.length).toBeGreaterThan(0);
    expect(
      everySteamExpectation.every(
        ({ standard, verificationState }) =>
          standard === "static-inference-only" && verificationState === "Unverified runtime parity",
      ),
    ).toBe(true);
  });

  it("matches independently calculated RFC answers and inferred Steam expectation", async () => {
    const document = await loadJson<{ synthetic: true; vectors: KnownAnswer[] }>(
      path.join(root, knownAnswersRelativePath),
    );
    expect(document.synthetic).toBe(true);
    expect(new Set(document.vectors.map(({ algorithm }) => algorithm))).toEqual(
      new Set(["SHA1", "SHA256", "SHA512", "STEAM"]),
    );
    for (const vector of document.vectors) {
      expect(generateOtp(vector)).toBe(vector.code);
      if (vector.algorithm === "STEAM") {
        expect(vector).toMatchObject({
          standard: "static-inference-only",
          verificationState: "Unverified runtime parity",
        });
      } else {
        expect(vector.verificationState).toBe("Verified standard vector");
        expect(vector.source).toMatch(/RFC 4226|RFC 6238/);
      }
      if (vector.timestamp !== null)
        expect(vector.counter).toBe(Math.floor(vector.timestamp / 1000 / vector.period));
    }
  });

  it("decrypts strictly validated legacy vault and backup envelopes", async () => {
    const manifest = await loadJson<FixtureManifest>(manifestPath);
    for (const id of ["vault-standard", "vault-boundaries", "vault-ente-state", "backup-export"]) {
      const entry = manifest.fixtures.find((fixture) => fixture.id === id)!;
      const fixture = await loadJson<Record<string, unknown>>(path.join(root, entry.path));
      const plaintext = decryptLegacyEnvelope(
        fixtureEnvelope(fixture),
        String(fixture.testOnlyPassword),
      );
      expect(plaintext.version).toBe(1);
      expect(Array.isArray(plaintext.accounts)).toBe(true);
    }
  });

  it("rejects malformed envelopes before KDF and categorizes authentication failures", async () => {
    const manifest = await loadJson<FixtureManifest>(manifestPath);
    const failures = manifest.fixtures.filter(
      ({ expectedErrorCategory }) => expectedErrorCategory !== undefined,
    );
    expect(failures.map(({ scenario }) => scenario).sort()).toEqual([
      "malformed-envelope",
      "tampered-ciphertext",
      "wrong-password",
    ]);
    for (const entry of failures) {
      const fixture = await loadJson<Record<string, unknown>>(path.join(root, entry.path));
      expect(fixture).toMatchObject({
        expectedErrorCategory: entry.expectedErrorCategory,
        expectedFailurePhase: entry.expectedFailurePhase,
        scenario: entry.scenario,
      });
      const password =
        entry.scenario === "wrong-password"
          ? String(fixture.attemptedTestOnlyPassword)
          : String(fixture.testOnlyPassword);
      let caught: unknown;
      try {
        decryptLegacyEnvelope(fixtureEnvelope(fixture), password);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(LegacyFixtureError);
      expect(caught).toMatchObject({
        category: entry.expectedErrorCategory,
        phase: entry.expectedFailurePhase,
      });
      expect(String((caught as Error).message)).not.toContain(password);
    }
    expect(
      failures
        .filter(({ expectedErrorCategory }) => expectedErrorCategory === "AUTHENTICATION_FAILED")
        .map(({ scenario }) => scenario)
        .sort(),
    ).toEqual(["tampered-ciphertext", "wrong-password"]);

    for (const entry of manifest.fixtures.filter(
      ({ path: fixturePath, expectedErrorCategory }) =>
        fixturePath.startsWith("tests/fixtures/legacy/") && expectedErrorCategory === undefined,
    )) {
      const fixture = await loadJson<Record<string, unknown>>(path.join(root, entry.path));
      expect(fixture).not.toHaveProperty("expectedErrorCategory");
      expect(fixture).not.toHaveProperty("expectedFailurePhase");
      expect(fixture).not.toHaveProperty("scenario");
    }
  });

  it("strictly rejects noncanonical base64, wrong lengths, unknown fields, versions, and iteration bounds", () => {
    const valid = {
      version: 1,
      salt: Buffer.alloc(16).toString("base64"),
      iv: Buffer.alloc(12).toString("base64"),
      ciphertext: Buffer.alloc(16).toString("base64"),
      iterations: 600_000,
      createdAt: 0,
      updatedAt: 0,
    };
    expect(parseLegacyEnvelope(valid)).toEqual(valid);
    for (const invalid of [
      { ...valid, salt: "AAAA" },
      { ...valid, iv: `${valid.iv}\n` },
      { ...valid, ciphertext: Buffer.alloc(15).toString("base64") },
      { ...valid, version: 2 },
      { ...valid, iterations: 0 },
      { ...valid, iterations: 10_000_001 },
      { ...valid, unknown: true },
    ]) {
      expect(() => parseLegacyEnvelope(invalid)).toThrowError(
        new LegacyFixtureError("MALFORMED_ENVELOPE", "validation"),
      );
    }
  });

  it("preserves confirmed settings, boundaries, and Ente pending operation shape", async () => {
    const settings = await loadJson<Record<string, unknown>>(
      path.join(root, "tests/fixtures/legacy/settings.json"),
    );
    expect(settings).toEqual({
      settings: { autoLockMinutes: 7, lockOnScreenLock: false },
      synthetic: true,
    });
    const boundary = await loadJson<Record<string, unknown>>(
      path.join(root, "tests/fixtures/legacy/vault-boundaries.json"),
    );
    const account = (
      decryptLegacyEnvelope(fixtureEnvelope(boundary), String(boundary.testOnlyPassword))
        .accounts as Array<Record<string, unknown>>
    )[0]!;
    expect([
      String(account.issuer).length,
      String(account.label).length,
      String(account.secret).length,
      String(account.note).length,
    ]).toEqual([256, 256, 1024, 256]);
    const ente = await loadJson<Record<string, unknown>>(
      path.join(root, "tests/fixtures/legacy/vault-ente-state.json"),
    );
    const integration = (
      decryptLegacyEnvelope(fixtureEnvelope(ente), String(ente.testOnlyPassword))
        .integrations as Record<string, Record<string, unknown>>
    ).ente!;
    expect(integration.entityMap).toEqual({ "synthetic-remote-entity": "synthetic-account-ente" });
    expect(integration.pending).toEqual([
      expect.objectContaining({
        accountId: "synthetic-account-ente",
        attempts: 0,
        enqueuedAt: 1_700_000_000_000,
        op: "update",
      }),
    ]);
  });

  it("leaves every preserved legacy artifact as an exact regular file", async () => {
    expect(Object.keys(artifactHashes)).toHaveLength(17);
    for (const [relativePath, expectedHash] of Object.entries(artifactHashes)) {
      await expectLegacyRegularFile(path.join(root, relativePath), expectedHash);
    }
  });

  it("rejects a symlink with identical bytes before hashing", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "shardpass-legacy-proof-"));
    const target = path.join(directory, "target.js");
    const candidate = path.join(directory, "candidate.js");
    try {
      await writeFile(target, "identical preserved bytes");
      await symlink(target, candidate);

      await expect(
        expectLegacyRegularFile(candidate, sha256(await readFile(target))),
      ).rejects.toThrow(/symbolic link/iu);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
