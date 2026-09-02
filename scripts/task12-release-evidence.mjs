import { createHash, createPublicKey, verify } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotBuildDirectory } from "./verify-reproducible-build.mjs";

const PHASE_1_RECORD =
  "- Disposition: `PASS-TASK12-PHASE1-EXACT-FINAL-TWO-REPLACEMENT-FINDINGS-CLOSED`. No Phase 2 and no Git operation.";
const PHASE_2_RECORD =
  "- Disposition: `GREEN-TASK12-PHASE2-FUNCTION-REFERENCE-CLOSED`. No Phase 3 and no Git operation.";
const COMMON_FIELDS = [
  "candidate",
  "command",
  "kind",
  "observedAt",
  "result",
  "schemaVersion",
  "status",
  "task",
];
const CHROME_FIELDS = [...COMMON_FIELDS, "version"];
const FINAL_FIELDS = [
  ...COMMON_FIELDS,
  "chromeEvidenceSha256",
  "reviewReportPath",
  "reviewReportSha256",
  "reviewerId",
  "reviewerKeyFingerprint",
  "reviewerOrganization",
  "signaturePath",
  "signatureSha256",
];
const CHROME_COMMAND = "pnpm verify:project1:task12:chrome110";
const FINAL_COMMAND = "pnpm verify:project1:task12:final-review";
const HEX_SHA256 = /^[a-f0-9]{64}$/u;
export const TASK12_FULL_REVIEW_SCOPE = Object.freeze([
  "content-popup-authority",
  "Ente",
  "crypto-storage",
  "migration-import-backup",
  "clipboard-HOTP",
  "scanner-allowlist",
  "clean-install",
  "network-modes",
  "archive",
  "orchestration",
]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const hasExactFields = (value, fields) =>
  isObject(value) &&
  Object.keys(value).length === fields.length &&
  Object.keys(value).every((field) => fields.includes(field));
const isSafeEvidencePath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !path.isAbsolute(value) &&
  !value.split(/[\\/]/u).includes("..") &&
  path.posix.normalize(value.replaceAll("\\", "/")) === value.replaceAll("\\", "/");

function parseCanonicalJson(text) {
  const trimmed = text.trim();
  const value = JSON.parse(trimmed);
  if (JSON.stringify(value) !== trimmed) throw new Error("Evidence must be canonical JSON");
  return value;
}

function parseIsoDate(value) {
  const date = new Date(value);
  if (typeof value !== "string" || !Number.isFinite(date.getTime()) || date.toISOString() !== value)
    throw new Error("Date is invalid");
  return date;
}

function validateDate(value, now) {
  try {
    return parseIsoDate(value).getTime() <= now.getTime();
  } catch {
    return false;
  }
}

function reviewerPublicKey(entry) {
  if (
    !hasExactFields(entry.publicKey, ["format", "value"]) ||
    typeof entry.publicKey.value !== "string"
  )
    throw new Error("Trusted reviewer public key is invalid");
  if (entry.publicKey.format === "pem-spki")
    return createPublicKey({ key: entry.publicKey.value, format: "pem", type: "spki" });
  if (entry.publicKey.format === "raw-ed25519") {
    const raw = Buffer.from(entry.publicKey.value, "base64");
    if (raw.length !== 32 || raw.toString("base64") !== entry.publicKey.value)
      throw new Error("Trusted reviewer raw Ed25519 key is invalid");
    return createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]),
      format: "der",
      type: "spki",
    });
  }
  throw new Error("Trusted reviewer key format is invalid");
}

export function parseTask12ReviewerTrustStore(text, { now = new Date() } = {}) {
  const store = parseCanonicalJson(text);
  if (
    !hasExactFields(store, ["keys", "schemaVersion", "task"]) ||
    store.schemaVersion !== 1 ||
    store.task !== "project1-task12" ||
    !Array.isArray(store.keys) ||
    store.keys.length === 0
  )
    throw new Error("Reviewer trust store is empty or invalid");

  const identities = new Set();
  const fingerprints = new Set();
  const keys = store.keys.map((entry) => {
    if (
      !hasExactFields(entry, [
        "active",
        "fingerprint",
        "notAfter",
        "notBefore",
        "organization",
        "publicKey",
        "reviewerId",
      ]) ||
      typeof entry.reviewerId !== "string" ||
      entry.reviewerId.length === 0 ||
      typeof entry.organization !== "string" ||
      entry.organization.length === 0 ||
      !HEX_SHA256.test(entry.fingerprint) ||
      entry.active !== true
    )
      throw new Error("Trusted reviewer key entry is invalid or inactive");
    const notBefore = parseIsoDate(entry.notBefore);
    const notAfter = parseIsoDate(entry.notAfter);
    if (notBefore > notAfter || now < notBefore || now > notAfter)
      throw new Error("Trusted reviewer key is outside its validity period");
    const key = reviewerPublicKey(entry);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("Trusted reviewer key is not Ed25519");
    const actualFingerprint = sha256(key.export({ type: "spki", format: "der" }));
    if (actualFingerprint !== entry.fingerprint)
      throw new Error("Trusted reviewer fingerprint mismatch");
    const identity = `${entry.reviewerId}\0${entry.organization}`;
    if (identities.has(identity) || fingerprints.has(entry.fingerprint))
      throw new Error("Duplicate trusted reviewer identity or key");
    identities.add(identity);
    fingerprints.add(entry.fingerprint);
    return { ...entry, key };
  });
  return { keys };
}

export function verifyTask12ReviewerSignature(
  reportBytes,
  signatureBytes,
  trustStoreText,
  options,
) {
  if (
    !Buffer.isBuffer(reportBytes) ||
    !Buffer.isBuffer(signatureBytes) ||
    signatureBytes.length !== 64
  )
    throw new Error("Reviewer report or detached signature bytes are invalid");
  const approval = parseTask12ReviewerApproval(reportBytes.toString("utf8"), options);
  const store = parseTask12ReviewerTrustStore(trustStoreText, { now: options?.now });
  const matches = store.keys.filter(
    (entry) =>
      entry.reviewerId === approval.reviewer.id &&
      entry.organization === approval.reviewer.organization,
  );
  if (matches.length !== 1 || !verify(null, reportBytes, matches[0].key, signatureBytes))
    throw new Error("External reviewer signature is untrusted or invalid");
  return {
    approval,
    reviewerId: matches[0].reviewerId,
    organization: matches[0].organization,
    fingerprint: matches[0].fingerprint,
  };
}

export async function computeTask12Candidate(distDirectory) {
  const root =
    distDirectory instanceof URL ? fileURLToPath(distDirectory) : path.resolve(distDirectory);
  const snapshot = await snapshotBuildDirectory(root);
  const manifestPath = path.join(root, "manifest.json");
  const manifestMetadata = await lstat(manifestPath);
  if (manifestMetadata.isSymbolicLink() || !manifestMetadata.isFile()) {
    throw new Error("Packaged manifest must be a regular non-symlink file");
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    typeof manifest.name !== "string" ||
    !manifest.name ||
    typeof manifest.version !== "string" ||
    !manifest.version
  ) {
    throw new Error("Packaged manifest name/version are invalid");
  }

  const digest = createHash("sha256");
  digest.update("ShardPass packaged candidate v1\0");
  for (const entry of snapshot) {
    const relativeBytes = Buffer.from(entry.path, "utf8");
    const bytes = await readFile(path.join(root, ...entry.path.split("/")));
    const lengths = Buffer.alloc(16);
    lengths.writeBigUInt64BE(BigInt(relativeBytes.length), 0);
    lengths.writeBigUInt64BE(BigInt(bytes.length), 8);
    digest.update(lengths).update(relativeBytes).update(bytes);
  }
  return { candidateDigest: digest.digest("hex"), name: manifest.name, version: manifest.version };
}

function validateCandidate(candidate, expectedCandidate) {
  return (
    hasExactFields(candidate, ["candidateDigest", "name", "version"]) &&
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    typeof candidate.version === "string" &&
    candidate.version.length > 0 &&
    HEX_SHA256.test(candidate.candidateDigest) &&
    (expectedCandidate === undefined ||
      (candidate.name === expectedCandidate.name &&
        candidate.version === expectedCandidate.version &&
        candidate.candidateDigest === expectedCandidate.candidateDigest))
  );
}

export function parseTask12StructuredEvidence(
  text,
  { expectedKind, expectedCandidate, now = new Date() },
) {
  const record = parseCanonicalJson(text);
  const expectedFields = expectedKind === "chrome110" ? CHROME_FIELDS : FINAL_FIELDS;
  if (!hasExactFields(record, expectedFields)) throw new Error("Evidence fields are invalid");
  if (
    record.schemaVersion !== 2 ||
    record.task !== "project1-task12" ||
    record.kind !== expectedKind ||
    !validateCandidate(record.candidate, expectedCandidate)
  )
    throw new Error("Evidence identity is invalid");
  if (!validateDate(record.observedAt, now)) throw new Error("Evidence date is invalid");

  if (expectedKind === "chrome110") {
    if (
      record.status !== "PASS" ||
      typeof record.version !== "string" ||
      !/^110(?:\.|$)/u.test(record.version) ||
      record.command !== CHROME_COMMAND ||
      record.result !== "PASS-TASK12-CHROME110"
    )
      throw new Error("Chrome 110 evidence is invalid");
  } else if (
    expectedKind !== "final-disposition" ||
    record.status !== "PASS-TASK12-PHASE3-FINAL" ||
    record.command !== FINAL_COMMAND ||
    record.result !== "PASS" ||
    typeof record.reviewerId !== "string" ||
    record.reviewerId.length === 0 ||
    typeof record.reviewerOrganization !== "string" ||
    record.reviewerOrganization.length === 0 ||
    !HEX_SHA256.test(record.reviewerKeyFingerprint) ||
    !isSafeEvidencePath(record.reviewReportPath) ||
    !isSafeEvidencePath(record.signaturePath) ||
    record.reviewReportPath === record.signaturePath ||
    !HEX_SHA256.test(record.reviewReportSha256) ||
    !HEX_SHA256.test(record.signatureSha256) ||
    !HEX_SHA256.test(record.chromeEvidenceSha256)
  ) {
    throw new Error("Final disposition evidence is invalid");
  }
  return record;
}

export function parseTask12ReviewerApproval(
  text,
  {
    expectedCandidateDigest,
    expectedChromeEvidenceSha256,
    expectedSignatureSha256,
    now = new Date(),
  },
) {
  const approval = parseCanonicalJson(text);
  if (
    !hasExactFields(approval, [
      "candidateDigest",
      "chromeEvidenceSha256",
      "reviewedAt",
      "reviewer",
      "schemaVersion",
      "scope",
      "status",
      "task",
      "toolResults",
    ]) ||
    approval.schemaVersion !== 2 ||
    approval.task !== "project1-task12" ||
    !Array.isArray(approval.scope) ||
    approval.scope.length !== TASK12_FULL_REVIEW_SCOPE.length ||
    approval.scope.some((entry, index) => entry !== TASK12_FULL_REVIEW_SCOPE[index]) ||
    approval.status !== "APPROVED" ||
    approval.candidateDigest !== expectedCandidateDigest ||
    approval.chromeEvidenceSha256 !== expectedChromeEvidenceSha256 ||
    !validateDate(approval.reviewedAt, now) ||
    !hasExactFields(approval.reviewer, ["id", "organization"]) ||
    typeof approval.reviewer.id !== "string" ||
    approval.reviewer.id.length === 0 ||
    typeof approval.reviewer.organization !== "string" ||
    approval.reviewer.organization.length === 0 ||
    !hasExactFields(approval.toolResults, ["browser", "chrome110", "security"]) ||
    Object.values(approval.toolResults).some((result) => result !== "PASS") ||
    (expectedSignatureSha256 !== undefined && !HEX_SHA256.test(expectedSignatureSha256))
  )
    throw new Error("External reviewer approval is invalid");
  return approval;
}

async function validateEvidenceFile(filePath, options) {
  try {
    const text = await readFile(filePath, "utf8");
    return parseTask12StructuredEvidence(text, options);
  } catch {
    return undefined;
  }
}

export async function verifyTask12ReleaseEvidence({
  ledgerPath,
  distPath,
  chromeEvidencePath,
  finalEvidencePath,
  trustStorePath,
  now = new Date(),
}) {
  const ledger = await readFile(ledgerPath, "utf8");
  const failures = [];
  const lines = new Set(ledger.split(/\r?\n/u));
  if (!lines.has(PHASE_1_RECORD)) failures.push("Phase 1 pass evidence is absent");
  if (!lines.has(PHASE_2_RECORD)) failures.push("Phase 2 green evidence is absent");

  let expectedCandidate;
  try {
    expectedCandidate = await computeTask12Candidate(distPath);
  } catch {
    failures.push("packaged candidate identity is invalid or changed");
    return { failures };
  }
  const chromeText = await readFile(chromeEvidencePath, "utf8").catch(() => undefined);
  const chrome =
    chromeText === undefined
      ? undefined
      : await validateEvidenceFile(chromeEvidencePath, {
          expectedKind: "chrome110",
          expectedCandidate,
          now,
        });
  if (chrome === undefined) failures.push("official Chrome 110 structured evidence is invalid");
  const final = await validateEvidenceFile(finalEvidencePath, {
    expectedKind: "final-disposition",
    expectedCandidate,
    now,
  });
  let finalReviewValid =
    final !== undefined &&
    chromeText !== undefined &&
    final.chromeEvidenceSha256 === sha256(chromeText) &&
    trustStorePath !== undefined;
  if (finalReviewValid) {
    try {
      const evidenceDirectory = path.dirname(
        finalEvidencePath instanceof URL
          ? fileURLToPath(finalEvidencePath)
          : path.resolve(finalEvidencePath),
      );
      const reportPath = path.resolve(evidenceDirectory, final.reviewReportPath);
      const signaturePath = path.resolve(evidenceDirectory, final.signaturePath);
      for (const preservedPath of [reportPath, signaturePath]) {
        const metadata = await lstat(preservedPath);
        if (metadata.isSymbolicLink() || !metadata.isFile())
          throw new Error("Preserved external review evidence is not a regular file");
      }
      const [reportBytes, signatureBytes, trustStoreText] = await Promise.all([
        readFile(reportPath),
        readFile(signaturePath),
        readFile(trustStorePath, "utf8"),
      ]);
      const verified = verifyTask12ReviewerSignature(reportBytes, signatureBytes, trustStoreText, {
        expectedCandidateDigest: expectedCandidate.candidateDigest,
        expectedChromeEvidenceSha256: sha256(chromeText),
        now,
      });
      finalReviewValid =
        final.reviewReportSha256 === sha256(reportBytes) &&
        final.signatureSha256 === sha256(signatureBytes) &&
        final.reviewerId === verified.reviewerId &&
        final.reviewerOrganization === verified.organization &&
        final.reviewerKeyFingerprint === verified.fingerprint;
    } catch {
      finalReviewValid = false;
    }
  }
  if (!finalReviewValid) failures.push("final review structured disposition is invalid");
  return { failures };
}
