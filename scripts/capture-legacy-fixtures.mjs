import { createCipheriv, createHash, createHmac, pbkdf2Sync } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const legacyDirectory = path.join(root, "tests/fixtures/legacy");
const otpDirectory = path.join(root, "tests/fixtures/otp");
const knownAnswersPath = path.join(otpDirectory, "known-answers.json");
const testOnlyPassword = "TEST-ONLY ShardPass fixture password; never use for real data";
const fixedTime = 1_700_000_000_000;
const otpSource = "assets/_commonjsHelpers-BNVkcQi_.js";
const workerSource = "assets/index.ts-DTcWtSwh.js";

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32(bytes) {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let result = "";
  for (let index = 0; index < bits.length; index += 5) {
    result += base32Alphabet[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  }
  return result;
}

function decodeBase32(value) {
  let bits = "";
  for (const character of value.replace(/[\s=-]/g, "").toUpperCase()) {
    bits += base32Alphabet.indexOf(character).toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function otp({ algorithm, counter, digits, secretBase32 }) {
  const digest = algorithm === "STEAM" ? "sha1" : algorithm.toLowerCase();
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(digest, decodeBase32(secretBase32)).update(message).digest();
  const offset = hmac.at(-1) & 0x0f;
  let binary =
    (((hmac[offset] & 0x7f) << 24) |
      (hmac[offset + 1] << 16) |
      (hmac[offset + 2] << 8) |
      hmac[offset + 3]) >>>
    0;
  if (algorithm === "STEAM") {
    const alphabet = "23456789BCDFGHJKMNPQRTVWXY";
    let result = "";
    for (let index = 0; index < 5; index += 1) {
      result += alphabet[binary % alphabet.length];
      binary = Math.floor(binary / alphabet.length);
    }
    return result;
  }
  return String(binary % 10 ** digits).padStart(digits, "0");
}

function vector({
  id,
  algorithm,
  digits,
  period,
  secretBase32,
  timestamp = null,
  counter,
  source,
  standard,
  verificationState,
}) {
  const resolvedCounter = counter ?? Math.floor(timestamp / 1000 / period);
  const answer = {
    id,
    algorithm,
    code: "",
    counter: resolvedCounter,
    digits,
    period,
    secretBase32,
    source,
    standard,
    timestamp,
    verificationState,
  };
  answer.code = otp(answer);
  return answer;
}

const rfcSha1 = base32(Buffer.from("12345678901234567890", "ascii"));
const rfcSha256 = base32(Buffer.from("12345678901234567890123456789012", "ascii"));
const rfcSha512 = base32(
  Buffer.from("1234567890123456789012345678901234567890123456789012345678901234", "ascii"),
);
const syntheticLongSecret = base32(Buffer.alloc(640, 0x42));

const vectors = [
  vector({
    id: "rfc4226-hotp-counter-0",
    algorithm: "SHA1",
    digits: 6,
    period: 0,
    secretBase32: rfcSha1,
    counter: 0,
    source: "RFC 4226 Appendix D",
    standard: "RFC4226",
    verificationState: "Verified standard vector",
  }),
  vector({
    id: "rfc4226-hotp-counter-7",
    algorithm: "SHA1",
    digits: 6,
    period: 0,
    secretBase32: rfcSha1,
    counter: 7,
    source: "RFC 4226 Appendix D",
    standard: "RFC4226",
    verificationState: "Verified standard vector",
  }),
  ...[
    ["rfc6238-sha1-59", "SHA1", rfcSha1],
    ["rfc6238-sha256-59", "SHA256", rfcSha256],
    ["rfc6238-sha512-59", "SHA512", rfcSha512],
  ].map(([id, algorithm, secretBase32]) =>
    vector({
      id,
      algorithm,
      digits: 8,
      period: 30,
      secretBase32,
      timestamp: 59_000,
      source: "RFC 6238 Appendix B",
      standard: "RFC6238",
      verificationState: "Verified standard vector",
    }),
  ),
  vector({
    id: "synthetic-default-totp",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secretBase32: rfcSha1,
    timestamp: fixedTime,
    source: "RFC 6238 calculation using a synthetic standards-vector secret",
    standard: "RFC6238",
    verificationState: "Verified standard vector",
  }),
  vector({
    id: "synthetic-eight-digit-period-45",
    algorithm: "SHA256",
    digits: 8,
    period: 45,
    secretBase32: rfcSha256,
    timestamp: fixedTime,
    source: "RFC 6238 calculation using synthetic parameters",
    standard: "RFC6238",
    verificationState: "Verified standard vector",
  }),
  vector({
    id: "synthetic-steam",
    algorithm: "STEAM",
    digits: 5,
    period: 30,
    secretBase32: rfcSha1,
    timestamp: fixedTime,
    source:
      "ShardPass 1.2.1 static Steam inference; no artifact runtime execution or capture was performed",
    standard: "static-inference-only",
    verificationState: "Unverified runtime parity",
  }),
];

function account(overrides) {
  return {
    id: "synthetic-account-default",
    createdAt: fixedTime,
    issuer: "Synthetic Service",
    label: "fixture@example.invalid",
    secret: rfcSha1,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    type: "totp",
    tags: [],
    ...overrides,
  };
}

const standardVault = {
  version: 1,
  accounts: [
    account({ id: "synthetic-account-default" }),
    account({ id: "synthetic-account-sha256", algorithm: "SHA256", secret: rfcSha256 }),
    account({ id: "synthetic-account-sha512", algorithm: "SHA512", secret: rfcSha512 }),
    account({
      id: "synthetic-account-custom",
      algorithm: "SHA256",
      digits: 8,
      period: 45,
      secret: rfcSha256,
    }),
    account({ id: "synthetic-account-hotp-zero", type: "hotp", period: 0, counter: 0 }),
    account({ id: "synthetic-account-hotp-later", type: "hotp", period: 0, counter: 7 }),
    account({ id: "synthetic-account-steam", type: "steam", digits: 5 }),
    account({
      id: "synthetic-account-metadata",
      note: "Synthetic note used only to preserve the confirmed legacy field.",
      tags: ["synthetic", "fixture"],
    }),
  ],
};

const boundaryVault = {
  version: 1,
  accounts: [
    account({
      id: "synthetic-account-boundary",
      issuer: "I".repeat(256),
      label: "L".repeat(256),
      secret: syntheticLongSecret,
      note: "N".repeat(256),
      tags: ["T".repeat(256)],
    }),
  ],
};

const enteVault = {
  version: 1,
  accounts: [account({ id: "synthetic-account-ente", tags: ["synthetic-ente-linked"] })],
  integrations: {
    ente: {
      email: "fixture@example.invalid",
      serverUrl: "https://ente.example.invalid",
      authToken: "TEST-ONLY-SYNTHETIC-AUTH-TOKEN",
      masterKey: "TEST-ONLY-SYNTHETIC-MASTER-KEY",
      authenticatorKey: "TEST-ONLY-SYNTHETIC-AUTHENTICATOR-KEY",
      entityMap: { "synthetic-remote-entity": "synthetic-account-ente" },
      pending: [
        {
          op: "update",
          accountId: "synthetic-account-ente",
          enteId: "synthetic-remote-entity",
          enqueuedAt: fixedTime,
          attempts: 0,
        },
      ],
      lastSync: fixedTime,
      needsReauth: false,
    },
  },
};

function deterministicBytes(label, length) {
  return createHash("sha256")
    .update(`ShardPass Task 1 synthetic ${label}`)
    .digest()
    .subarray(0, length);
}

function envelope(plaintext, label) {
  const salt = deterministicBytes(`${label} salt`, 16);
  const iv = deterministicBytes(`${label} iv`, 12);
  const key = pbkdf2Sync(testOnlyPassword, salt, 600_000, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(plaintext), "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    version: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    iterations: 600_000,
    createdAt: fixedTime,
    updatedAt: fixedTime,
  };
}

function expectation(id) {
  const answer = vectors.find((candidate) => candidate.id === id);
  return {
    id: answer.id,
    algorithm: answer.algorithm,
    code: answer.code,
    counter: answer.counter,
    digits: answer.digits,
    period: answer.period,
    standard: answer.standard,
    timestamp: answer.timestamp,
    verificationState: answer.verificationState,
  };
}

const standardExpectations = [
  expectation("synthetic-default-totp"),
  expectation("rfc6238-sha256-59"),
  expectation("rfc6238-sha512-59"),
  expectation("synthetic-eight-digit-period-45"),
  expectation("rfc4226-hotp-counter-0"),
  expectation("rfc4226-hotp-counter-7"),
  expectation("synthetic-steam"),
];

const standardEnvelope = envelope(standardVault, "standard vault");
const fixtures = [
  {
    id: "vault-standard",
    file: "vault-standard.json",
    document: { synthetic: true, testOnlyPassword, vault: standardEnvelope },
    expectedOtpAt: standardExpectations,
    sourceFiles: [otpSource, workerSource],
    generationMethod:
      "Deterministic Node crypto recreation of confirmed PBKDF2-SHA256/AES-256-GCM vault envelope",
    verificationState: "Verified static format",
  },
  {
    id: "vault-boundaries",
    file: "vault-boundaries.json",
    document: {
      synthetic: true,
      testOnlyPassword,
      vault: envelope(boundaryVault, "boundary vault"),
    },
    expectedOtpAt: [],
    sourceFiles: [workerSource],
    generationMethod:
      "Deterministic envelope containing confirmed 256-character metadata and 1024-character secret boundaries",
    verificationState: "Verified static format",
  },
  {
    id: "vault-ente-state",
    file: "vault-ente-state.json",
    document: { synthetic: true, testOnlyPassword, vault: envelope(enteVault, "Ente vault") },
    expectedOtpAt: [expectation("synthetic-default-totp")],
    sourceFiles: [workerSource],
    generationMethod:
      "Deterministic envelope containing only statically confirmed Ente integration, entityMap, and pending-operation fields",
    verificationState: "Verified static format",
  },
  {
    id: "settings",
    file: "settings.json",
    document: { synthetic: true, settings: { autoLockMinutes: 7, lockOnScreenLock: false } },
    expectedOtpAt: [],
    sourceFiles: [workerSource],
    generationMethod:
      "Direct deterministic serialization of the confirmed chrome.storage.local settings value",
    verificationState: "Verified static format",
  },
  {
    id: "wrong-password",
    file: "wrong-password.json",
    document: {
      synthetic: true,
      testOnlyPassword,
      attemptedTestOnlyPassword: "TEST-ONLY intentionally wrong fixture password",
      vault: standardEnvelope,
      expectedErrorCategory: "AUTHENTICATION_FAILED",
      expectedFailurePhase: "decrypt",
      scenario: "wrong-password",
    },
    expectedErrorCategory: "AUTHENTICATION_FAILED",
    expectedFailurePhase: "decrypt",
    scenario: "wrong-password",
    expectedOtpAt: [],
    sourceFiles: [workerSource],
    generationMethod:
      "Valid deterministic legacy envelope paired with a clearly test-only incorrect password",
    verificationState: "Verified static format",
  },
  {
    id: "malformed-envelope",
    file: "malformed-envelope.json",
    document: {
      synthetic: true,
      testOnlyPassword,
      vault: { ...standardEnvelope, iv: "not-base64***" },
      expectedErrorCategory: "MALFORMED_ENVELOPE",
      expectedFailurePhase: "validation",
      scenario: "malformed-envelope",
    },
    expectedErrorCategory: "MALFORMED_ENVELOPE",
    expectedFailurePhase: "validation",
    scenario: "malformed-envelope",
    expectedOtpAt: [],
    sourceFiles: [workerSource],
    generationMethod: "Deterministic mutation of the confirmed envelope IV encoding",
    verificationState: "Verified static format",
  },
  {
    id: "tampered-ciphertext",
    file: "tampered-ciphertext.json",
    document: {
      synthetic: true,
      testOnlyPassword,
      vault: {
        ...standardEnvelope,
        ciphertext: Buffer.from(standardEnvelope.ciphertext, "base64")
          .map((byte, index) => (index === 0 ? byte ^ 1 : byte))
          .toString("base64"),
      },
      expectedErrorCategory: "AUTHENTICATION_FAILED",
      expectedFailurePhase: "decrypt",
      scenario: "tampered-ciphertext",
    },
    expectedErrorCategory: "AUTHENTICATION_FAILED",
    expectedFailurePhase: "decrypt",
    scenario: "tampered-ciphertext",
    expectedOtpAt: [],
    sourceFiles: [workerSource],
    generationMethod: "Single deterministic bit flip in a valid confirmed AES-GCM ciphertext",
    verificationState: "Verified static format",
  },
  {
    id: "backup-export",
    file: "backup-export.json",
    document: { type: "shardpass-export", synthetic: true, testOnlyPassword, ...standardEnvelope },
    expectedOtpAt: standardExpectations,
    sourceFiles: [workerSource, otpSource],
    generationMethod:
      "Confirmed legacy export wrapper around the deterministic encrypted vault envelope",
    verificationState: "Verified static format",
  },
];

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

await mkdir(legacyDirectory, { recursive: true });
await mkdir(otpDirectory, { recursive: true });
for (const name of await (await import("node:fs/promises")).readdir(legacyDirectory)) {
  if (name.endsWith(".json")) await rm(path.join(legacyDirectory, name));
}

const manifestEntries = [];
for (const fixture of fixtures) {
  const contents = serialize(fixture.document);
  await writeFile(path.join(legacyDirectory, fixture.file), contents);
  manifestEntries.push({
    id: fixture.id,
    path: `tests/fixtures/legacy/${fixture.file}`,
    synthetic: true,
    sourceFiles: fixture.sourceFiles,
    generationMethod: fixture.generationMethod,
    sha256: createHash("sha256").update(contents).digest("hex"),
    expectedOtpAt: fixture.expectedOtpAt,
    verificationState: fixture.verificationState,
    ...(fixture.expectedErrorCategory
      ? {
          expectedErrorCategory: fixture.expectedErrorCategory,
          expectedFailurePhase: fixture.expectedFailurePhase,
          scenario: fixture.scenario,
        }
      : {}),
  });
}

const knownAnswersContents = serialize({
  formatVersion: 1,
  synthetic: true,
  disclosure:
    "Secrets are public standards vectors or deterministic synthetic values and must never protect real accounts.",
  vectors,
});
await writeFile(knownAnswersPath, knownAnswersContents);
manifestEntries.push({
  id: "otp-known-answers",
  path: "tests/fixtures/otp/known-answers.json",
  synthetic: true,
  sourceFiles: [otpSource],
  generationMethod:
    "Deterministic Node HMAC calculation of RFC vectors plus static Steam inference; no artifact runtime execution or capture was performed",
  sha256: createHash("sha256").update(knownAnswersContents).digest("hex"),
  expectedOtpAt: vectors.map((answer) => expectation(answer.id)),
  verificationState: "Unverified runtime parity",
});
await writeFile(
  path.join(legacyDirectory, "fixture-manifest.json"),
  serialize({
    formatVersion: 1,
    artifactVersion: "1.2.1",
    synthetic: true,
    pathBase: "project-root",
    generatedBy: "scripts/capture-legacy-fixtures.mjs",
    manifestPath: "tests/fixtures/legacy/fixture-manifest.json",
    manifestHashing: "excluded to avoid self-hash recursion",
    fixtures: manifestEntries,
    gaps: [
      {
        dimension: "Ente pending 2FA chrome.storage.session value",
        status: "Unverified",
        reason:
          "The packaged worker confirms key pending_2fa and session lifecycle but static analysis did not establish a stable persisted field schema suitable for migration fixtures.",
        deferredTo: "Project 1 Task 12",
      },
      {
        dimension: "Live Ente server ciphertext and undocumented response fields",
        status: "Unverified",
        reason:
          "No account or network access was used; only the exact locally persisted integration fields confirmed in the artifact are represented.",
        deferredTo: "Project 1 Task 12",
      },
    ],
  }),
);

console.log(
  `Generated ${fixtures.length} deterministic synthetic legacy fixtures and ${vectors.length} OTP known answers.`,
);
