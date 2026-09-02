import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeTask12Candidate,
  parseTask12ReviewerApproval,
  parseTask12ReviewerTrustStore,
  parseTask12StructuredEvidence,
  verifyTask12ReviewerSignature,
  verifyTask12ReleaseEvidence,
} from "../../scripts/task12-release-evidence.mjs";

const temporaryDirectories: string[] = [];
const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const observedAt = "2026-08-20T12:00:00.000Z";
const fullReviewScope = [
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
] as const;
const phaseRecords =
  "- Disposition: `PASS-TASK12-PHASE1-EXACT-FINAL-TWO-REPLACEMENT-FINDINGS-CLOSED`. No Phase 2 and no Git operation.\n- Disposition: `GREEN-TASK12-PHASE2-FUNCTION-REFERENCE-CLOSED`. No Phase 3 and no Git operation.\n";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "task12-release-evidence-"));
  temporaryDirectories.push(root);
  const distPath = path.join(root, "dist");
  await mkdir(path.join(distPath, "assets"), { recursive: true });
  await writeFile(path.join(distPath, "manifest.json"), '{"name":"ShardPass","version":"9.8.7"}');
  await writeFile(path.join(distPath, "assets", "app.js"), "exact-app-bytes\n");
  await writeFile(path.join(distPath, ".audit.json"), '{"checked":true}\n');
  return {
    root,
    distPath,
    ledgerPath: path.join(root, "ledger.md"),
    chromeEvidencePath: path.join(root, "chrome.json"),
    finalEvidencePath: path.join(root, "final.json"),
    trustStorePath: path.join(root, "reviewers.json"),
    reviewReportPath: path.join(root, "review.report.json"),
    signaturePath: path.join(root, "review.signature"),
  };
}

async function validRecords(paths: Awaited<ReturnType<typeof fixture>>) {
  const candidate = await computeTask12Candidate(paths.distPath);
  const chromeRecord = {
    schemaVersion: 2,
    task: "project1-task12",
    kind: "chrome110",
    status: "PASS",
    version: "110.0.5481.177",
    command: "pnpm verify:project1:task12:chrome110",
    result: "PASS-TASK12-CHROME110",
    candidate,
    observedAt,
  };
  const chromeText = `${JSON.stringify(chromeRecord)}\n`;
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const fingerprint = sha256(publicKey.export({ type: "spki", format: "der" }));
  const report = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      task: "project1-task12",
      status: "APPROVED",
      candidateDigest: candidate.candidateDigest,
      scope: fullReviewScope,
      reviewer: { id: "reviewer@example.test", organization: "External Review" },
      chromeEvidenceSha256: sha256(chromeText),
      toolResults: { chrome110: "PASS", security: "PASS", browser: "PASS" },
      reviewedAt: observedAt,
    }),
  );
  const signature = sign(null, report, privateKey);
  await writeFile(paths.reviewReportPath, report);
  await writeFile(paths.signaturePath, signature);
  await writeFile(
    paths.trustStorePath,
    JSON.stringify({
      schemaVersion: 1,
      task: "project1-task12",
      keys: [
        {
          reviewerId: "reviewer@example.test",
          organization: "External Review",
          fingerprint,
          publicKey: {
            format: "pem-spki",
            value: publicKey.export({ type: "spki", format: "pem" }),
          },
          active: true,
          notBefore: "2026-01-01T00:00:00.000Z",
          notAfter: "2026-12-31T23:59:59.999Z",
        },
      ],
    }),
  );
  const finalRecord = {
    schemaVersion: 2,
    task: "project1-task12",
    kind: "final-disposition",
    status: "PASS-TASK12-PHASE3-FINAL",
    command: "pnpm verify:project1:task12:final-review",
    result: "PASS",
    candidate,
    observedAt,
    reviewerId: "reviewer@example.test",
    reviewerOrganization: "External Review",
    reviewerKeyFingerprint: fingerprint,
    reviewReportPath: path.basename(paths.reviewReportPath),
    reviewReportSha256: sha256(report),
    signaturePath: path.basename(paths.signaturePath),
    signatureSha256: sha256(signature),
    chromeEvidenceSha256: sha256(chromeText),
  };
  return { candidate, chromeRecord, finalRecord };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("Task 12 packaged candidate identity", () => {
  it("binds sorted relative names and exact bytes for every regular dist file", async () => {
    const paths = await fixture();
    const first = await computeTask12Candidate(paths.distPath);
    expect(first).toMatchObject({ name: "ShardPass", version: "9.8.7" });
    expect(first.candidateDigest).toMatch(/^[a-f0-9]{64}$/u);

    await writeFile(path.join(paths.root, "manifest.json"), '{"name":"Legacy","version":"1.2.1"}');
    expect(await computeTask12Candidate(paths.distPath)).toEqual(first);

    await writeFile(path.join(paths.distPath, "assets", "app.js"), "wrong-byte\n");
    expect((await computeTask12Candidate(paths.distPath)).candidateDigest).not.toBe(
      first.candidateDigest,
    );
    await writeFile(path.join(paths.distPath, "assets", "app.js"), "exact-app-bytes\n");
    await writeFile(path.join(paths.distPath, "extra.txt"), "extra");
    expect((await computeTask12Candidate(paths.distPath)).candidateDigest).not.toBe(
      first.candidateDigest,
    );
    await rm(path.join(paths.distPath, "extra.txt"));
    await rm(path.join(paths.distPath, ".audit.json"));
    expect((await computeTask12Candidate(paths.distPath)).candidateDigest).not.toBe(
      first.candidateDigest,
    );
  });

  it("rejects symlinks anywhere in the candidate", async () => {
    const paths = await fixture();
    await symlink("manifest.json", path.join(paths.distPath, "linked-manifest.json"));
    await expect(computeTask12Candidate(paths.distPath)).rejects.toThrow(/Nonregular build entry/u);
  });
});

describe("Task 12 release evidence", () => {
  it("accepts only exact records tied to the current complete dist candidate", async () => {
    const paths = await fixture();
    const { chromeRecord, finalRecord } = await validRecords(paths);
    await writeFile(paths.ledgerPath, phaseRecords);
    await writeFile(paths.chromeEvidencePath, `${JSON.stringify(chromeRecord)}\n`);
    await writeFile(paths.finalEvidencePath, `${JSON.stringify(finalRecord)}\n`);

    await expect(
      verifyTask12ReleaseEvidence({ ...paths, now: new Date("2026-08-21") }),
    ).resolves.toEqual({ failures: [] });
  });

  it("rejects wrong file, byte, extra, missing, legacy version, and symlink candidates", async () => {
    const mutations: Array<(paths: Awaited<ReturnType<typeof fixture>>) => Promise<void>> = [
      (paths) => writeFile(path.join(paths.distPath, "assets", "app.js"), "wrong"),
      (paths) => writeFile(path.join(paths.distPath, "assets", "wrong.js"), "exact-app-bytes\n"),
      (paths) => writeFile(path.join(paths.distPath, "extra"), "extra"),
      (paths) => rm(path.join(paths.distPath, ".audit.json")),
      (paths) =>
        writeFile(
          path.join(paths.distPath, "manifest.json"),
          '{"name":"ShardPass","version":"1.2.1"}',
        ),
      (paths) => symlink("manifest.json", path.join(paths.distPath, "link")),
    ];
    for (const mutate of mutations) {
      const paths = await fixture();
      const { chromeRecord, finalRecord } = await validRecords(paths);
      await writeFile(paths.ledgerPath, phaseRecords);
      await writeFile(paths.chromeEvidencePath, JSON.stringify(chromeRecord));
      await writeFile(paths.finalEvidencePath, JSON.stringify(finalRecord));
      await mutate(paths);
      const result = await verifyTask12ReleaseEvidence({ ...paths, now: new Date("2026-08-21") });
      expect(result.failures.length).toBeGreaterThan(0);
      expect(
        result.failures.includes("packaged candidate identity is invalid or changed") ||
          result.failures.includes("official Chrome 110 structured evidence is invalid"),
      ).toBe(true);
    }
  });

  it("rejects negative prose, malformed records, and candidate digest mismatch", async () => {
    const paths = await fixture();
    const { chromeRecord, finalRecord } = await validRecords(paths);
    await writeFile(paths.ledgerPath, "No PASS-TASK12 evidence exists.\n");
    await writeFile(
      paths.chromeEvidencePath,
      JSON.stringify({
        ...chromeRecord,
        candidate: { ...chromeRecord.candidate, candidateDigest: "0".repeat(64) },
      }),
    );
    await writeFile(paths.finalEvidencePath, JSON.stringify(finalRecord));
    const result = await verifyTask12ReleaseEvidence({ ...paths, now: new Date("2026-08-21") });
    expect(result.failures).toContain("Phase 1 pass evidence is absent");
    expect(result.failures).toContain("official Chrome 110 structured evidence is invalid");
  });

  it("parses valid synthetic evidence without permitting production self-approval", async () => {
    const paths = await fixture();
    const { candidate, chromeRecord } = await validRecords(paths);
    expect(
      parseTask12StructuredEvidence(JSON.stringify(chromeRecord), {
        expectedKind: "chrome110",
        expectedCandidate: candidate,
        now: new Date("2026-08-21"),
      }),
    ).toEqual(chromeRecord);

    const approval = {
      schemaVersion: 2,
      task: "project1-task12",
      status: "APPROVED",
      candidateDigest: candidate.candidateDigest,
      scope: fullReviewScope,
      reviewer: { id: "reviewer@example.test", organization: "External Review" },
      chromeEvidenceSha256: "c".repeat(64),
      toolResults: { chrome110: "PASS", security: "PASS", browser: "PASS" },
      reviewedAt: observedAt,
    };
    expect(
      parseTask12ReviewerApproval(JSON.stringify(approval), {
        expectedCandidateDigest: candidate.candidateDigest,
        expectedChromeEvidenceSha256: "c".repeat(64),
        now: new Date("2026-08-21"),
      }),
    ).toEqual(approval);
    for (const scope of [
      fullReviewScope.slice(0, -1),
      [...fullReviewScope].reverse(),
      [...fullReviewScope, "extra"],
      fullReviewScope.map((entry) => (entry === "Ente" ? "ente" : entry)),
    ])
      expect(() =>
        parseTask12ReviewerApproval(JSON.stringify({ ...approval, scope }), {
          expectedCandidateDigest: candidate.candidateDigest,
          expectedChromeEvidenceSha256: "c".repeat(64),
          now: new Date("2026-08-21"),
        }),
      ).toThrow("External reviewer approval is invalid");

    const packageJson = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts["verify:project1:task12:chrome110"]).toBeTruthy();
    expect(packageJson.scripts["verify:project1:task12:final-review"]).toBeTruthy();
  });

  it("verifies exact canonical report bytes with an active trusted Ed25519 identity", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicDer = publicKey.export({ type: "spki", format: "der" });
    const fingerprint = sha256(publicDer);
    const report = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        task: "project1-task12",
        status: "APPROVED",
        candidateDigest: "a".repeat(64),
        scope: fullReviewScope,
        reviewer: { id: "reviewer@example.test", organization: "Independent Security" },
        chromeEvidenceSha256: "b".repeat(64),
        toolResults: { chrome110: "PASS", security: "PASS", browser: "PASS" },
        reviewedAt: observedAt,
      }),
    );
    const trustStore = JSON.stringify({
      schemaVersion: 1,
      task: "project1-task12",
      keys: [
        {
          reviewerId: "reviewer@example.test",
          organization: "Independent Security",
          fingerprint,
          publicKey: {
            format: "pem-spki",
            value: publicKey.export({ type: "spki", format: "pem" }),
          },
          active: true,
          notBefore: "2026-01-01T00:00:00.000Z",
          notAfter: "2026-12-31T23:59:59.999Z",
        },
      ],
    });

    expect(
      parseTask12ReviewerTrustStore(trustStore, { now: new Date("2026-08-21") }).keys,
    ).toHaveLength(1);
    expect(
      verifyTask12ReviewerSignature(report, sign(null, report, privateKey), trustStore, {
        expectedCandidateDigest: "a".repeat(64),
        expectedChromeEvidenceSha256: "b".repeat(64),
        now: new Date("2026-08-21"),
      }),
    ).toMatchObject({
      reviewerId: "reviewer@example.test",
      organization: "Independent Security",
      fingerprint,
    });
  });

  it.each([
    ["empty", { keys: [] }],
    ["inactive", { active: false }],
    ["expired", { notAfter: "2026-08-20T00:00:00.000Z" }],
  ])("rejects %s reviewer trust", (_name, mutation) => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const key = {
      reviewerId: "reviewer@example.test",
      organization: "Independent Security",
      fingerprint: sha256(publicKey.export({ type: "spki", format: "der" })),
      publicKey: { format: "pem-spki", value: publicKey.export({ type: "spki", format: "pem" }) },
      active: true,
      notBefore: "2026-01-01T00:00:00.000Z",
      notAfter: "2026-12-31T23:59:59.999Z",
      ...mutation,
    };
    const store = {
      schemaVersion: 1,
      task: "project1-task12",
      keys: "keys" in mutation ? mutation.keys : [key],
    };
    expect(() =>
      parseTask12ReviewerTrustStore(JSON.stringify(store), { now: new Date("2026-08-21") }),
    ).toThrow();
  });

  it("rejects unknown, random, wrong-report, identity-mismatch, duplicate, and malformed signatures or keys", () => {
    const trusted = generateKeyPairSync("ed25519");
    const unknown = generateKeyPairSync("ed25519");
    const fingerprint = sha256(trusted.publicKey.export({ type: "spki", format: "der" }));
    const key = {
      reviewerId: "reviewer@example.test",
      organization: "Independent Security",
      fingerprint,
      publicKey: {
        format: "raw-ed25519",
        value: Buffer.from(trusted.publicKey.export({ type: "spki", format: "der" }))
          .subarray(-32)
          .toString("base64"),
      },
      active: true,
      notBefore: "2026-01-01T00:00:00.000Z",
      notAfter: "2026-12-31T23:59:59.999Z",
    };
    const reportObject = {
      schemaVersion: 2,
      task: "project1-task12",
      status: "APPROVED",
      candidateDigest: "a".repeat(64),
      scope: fullReviewScope,
      reviewer: { id: key.reviewerId, organization: key.organization },
      chromeEvidenceSha256: "b".repeat(64),
      toolResults: { chrome110: "PASS", security: "PASS", browser: "PASS" },
      reviewedAt: observedAt,
    };
    const report = Buffer.from(JSON.stringify(reportObject));
    const store = JSON.stringify({ schemaVersion: 1, task: "project1-task12", keys: [key] });
    const options = {
      expectedCandidateDigest: "a".repeat(64),
      expectedChromeEvidenceSha256: "b".repeat(64),
      now: new Date("2026-08-21"),
    };
    expect(() =>
      verifyTask12ReviewerSignature(report, sign(null, report, unknown.privateKey), store, options),
    ).toThrow();
    expect(() =>
      verifyTask12ReviewerSignature(report, Buffer.alloc(64, 7), store, options),
    ).toThrow();
    expect(() =>
      verifyTask12ReviewerSignature(
        Buffer.from(`${report.toString()} `),
        sign(null, report, trusted.privateKey),
        store,
        options,
      ),
    ).toThrow();
    const mismatched = Buffer.from(
      JSON.stringify({
        ...reportObject,
        reviewer: { ...reportObject.reviewer, id: "other@example.test" },
      }),
    );
    expect(() =>
      verifyTask12ReviewerSignature(
        mismatched,
        sign(null, mismatched, trusted.privateKey),
        store,
        options,
      ),
    ).toThrow();
    expect(() =>
      parseTask12ReviewerTrustStore(
        JSON.stringify({ schemaVersion: 1, task: "project1-task12", keys: [key, key] }),
        options,
      ),
    ).toThrow();
    expect(() => parseTask12ReviewerTrustStore('{"schemaVersion":1}', options)).toThrow();
  });

  it("fails closed without an explicit Chrome executable or external reviewer inputs", async () => {
    const paths = await fixture();
    const chrome = spawnSync(process.execPath, ["scripts/create-task12-chrome110-evidence.mjs"], {
      cwd: path.resolve(import.meta.dirname, "../.."),
      env: {
        ...process.env,
        TASK12_CHROME_EXECUTABLE: "",
        TASK12_EVIDENCE_OUTPUT: paths.chromeEvidencePath,
      },
    });
    expect(chrome.status).not.toBe(0);
    await expect(readFile(paths.chromeEvidencePath)).rejects.toThrow();

    const finalReview = spawnSync(
      process.execPath,
      ["scripts/create-task12-final-review-evidence.mjs"],
      {
        cwd: path.resolve(import.meta.dirname, "../.."),
        env: { ...process.env, TASK12_FINAL_EVIDENCE_OUTPUT: paths.finalEvidencePath },
      },
    );
    expect(finalReview.status).not.toBe(0);
    await expect(readFile(paths.finalEvidencePath)).rejects.toThrow();
  });
});
