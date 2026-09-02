import { readFile, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  computeTask12Candidate,
  parseTask12StructuredEvidence,
  sha256,
  verifyTask12ReviewerSignature,
} from "./task12-release-evidence.mjs";

const root = path.resolve(import.meta.dirname, "..");
const output = path.resolve(
  process.env.TASK12_FINAL_EVIDENCE_OUTPUT ??
    path.join(root, ".sdd", "project1-task12-final-disposition.json"),
);
const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value || values.has(key))
    throw new Error("Arguments must be unique --name value pairs");
  values.set(key, value);
}

async function writeExclusiveAtomic(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    const reservation = await open(filePath, "wx", 0o600);
    await reservation.close();
    await rename(temporary, filePath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true });
    throw error;
  }
}

try {
  if (
    values.size !== 3 ||
    !values.has("--review-report") ||
    !values.has("--signature") ||
    !values.has("--trust-store")
  ) {
    throw new Error(
      "Require exactly --review-report PATH --signature PATH --trust-store PATH; owner provisioning is external",
    );
  }
  const reportPath = path.resolve(values.get("--review-report"));
  const signaturePath = path.resolve(values.get("--signature"));
  const trustStorePath = path.resolve(values.get("--trust-store"));
  if (new Set([reportPath, signaturePath, trustStorePath]).size !== 3)
    throw new Error("Review report, signature, and trust store must be separate files");
  const [reportBytes, signatureBytes, trustStoreText, chromeText, candidate] = await Promise.all([
    readFile(reportPath),
    readFile(signaturePath),
    readFile(trustStorePath, "utf8"),
    readFile(path.join(root, ".sdd", "project1-task12-chrome110-evidence.json"), "utf8"),
    computeTask12Candidate(path.join(root, "dist")),
  ]);
  const chrome = parseTask12StructuredEvidence(chromeText, {
    expectedKind: "chrome110",
    expectedCandidate: candidate,
  });
  const chromeEvidenceSha256 = sha256(chromeText);
  const verified = verifyTask12ReviewerSignature(reportBytes, signatureBytes, trustStoreText, {
    expectedCandidateDigest: candidate.candidateDigest,
    expectedChromeEvidenceSha256: chromeEvidenceSha256,
  });
  if (verified.approval.reviewedAt < chrome.observedAt)
    throw new Error("External review predates the bound Chrome evidence");

  const reviewReportSha256 = sha256(reportBytes);
  const signatureSha256 = sha256(signatureBytes);
  const evidenceDirectory = path.join(path.dirname(output), "task12-final-review-evidence");
  const preservedReport = path.join(evidenceDirectory, `${reviewReportSha256}.report.json`);
  const preservedSignature = path.join(evidenceDirectory, `${signatureSha256}.signature`);
  await writeExclusiveAtomic(preservedReport, reportBytes);
  try {
    await writeExclusiveAtomic(preservedSignature, signatureBytes);
    const record = {
      schemaVersion: 2,
      task: "project1-task12",
      kind: "final-disposition",
      status: "PASS-TASK12-PHASE3-FINAL",
      command: "pnpm verify:project1:task12:final-review",
      result: "PASS",
      candidate,
      observedAt: new Date().toISOString(),
      reviewerId: verified.reviewerId,
      reviewerOrganization: verified.organization,
      reviewerKeyFingerprint: verified.fingerprint,
      reviewReportPath: path
        .relative(path.dirname(output), preservedReport)
        .replaceAll(path.sep, "/"),
      reviewReportSha256,
      signaturePath: path
        .relative(path.dirname(output), preservedSignature)
        .replaceAll(path.sep, "/"),
      signatureSha256,
      chromeEvidenceSha256,
    };
    await writeExclusiveAtomic(output, `${JSON.stringify(record)}\n`);
    process.stdout.write(`Wrote ${output}\n`);
  } catch (error) {
    await Promise.all([
      rm(preservedReport, { force: true }),
      rm(preservedSignature, { force: true }),
    ]);
    throw error;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
