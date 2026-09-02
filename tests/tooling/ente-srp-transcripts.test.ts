import { execFile } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { SrpClient, SRP } from "../../apps/extension/node_modules/fast-srp-hap";
import { describe, expect, it } from "vitest";

// @ts-expect-error Executable reference intentionally remains dependency-free JavaScript.
import { decodeSrpProtocolBase64 as untypedDecodeReferenceBase64 } from "../../scripts/replay-ente-srp-reference.mjs";
// @ts-expect-error Executable reference intentionally remains dependency-free JavaScript.
import { verifyExpectedReplay as untypedVerifyExpectedReplay } from "../../scripts/replay-ente-srp-reference.mjs";
import { decodeEnteSrpProtocolBase64 } from "../../apps/extension/src/background/ente/srp-adapter";

const fixtureNames = [
  "srp-legacy-1.2.1-transcript.json",
  "srp-current-pin-transcript.json",
] as const;

type Transcript = Record<string, unknown> & {
  identityUtf8: string;
  loginKeyHex: string;
  saltHex: string;
  clientPrivateHex: string;
  expectedAHex: string;
  serverPublicBHex: string;
  scramblingUHex: string;
  premasterSecretHex: string;
  expectedSessionKeyHex: string;
  expectedM1Hex: string;
  expectedM2Hex: string;
  negativeCases: Record<string, string>;
};

const root = path.resolve(import.meta.dirname, "../..");
type Replay = Readonly<{
  A: string;
  B: string;
  u: string;
  premaster: string;
  sessionKey: string;
  M1: string;
  M2: string;
}>;
const verifyExpectedReplay = untypedVerifyExpectedReplay as (value: Transcript) => Replay;
const decodeReferenceBase64 = untypedDecodeReferenceBase64 as (value: string) => Uint8Array;
const fromHex = (value: string): Buffer => Buffer.from(value, "hex");

function candidateReplay(value: Transcript, serverPublic = value.serverPublicBHex) {
  const client = new SrpClient(
    SRP.params[4096],
    fromHex(value.saltHex),
    Buffer.from(value.identityUtf8),
    fromHex(value.loginKeyHex),
    fromHex(value.clientPrivateHex),
    false,
  );
  const A = client.computeA();
  client.setB(fromHex(serverPublic));
  const evidenceClient = client as unknown as {
    _u: { toBuffer(length: number): Buffer };
    _S: Buffer;
    _M2: Buffer;
  };
  return {
    A: A.toString("hex"),
    B: serverPublic,
    u: evidenceClient._u.toBuffer(32).toString("hex"),
    premaster: evidenceClient._S.toString("hex"),
    sessionKey: client.computeK().toString("hex"),
    M1: client.computeM1().toString("hex"),
    M2: evidenceClient._M2.toString("hex"),
    verifyM2: (proof: string) => client.checkM2(fromHex(proof)),
  };
}

const requiredHex = [
  "saltHex",
  "loginKeyHex",
  "clientPrivateHex",
  "expectedAHex",
  "serverPrivateHex",
  "serverPublicBHex",
  "scramblingUHex",
  "premasterSecretHex",
  "expectedSessionKeyHex",
  "expectedM1Hex",
  "expectedM2Hex",
  "invalidM2Hex",
] as const;

const load = async (name: string): Promise<Transcript> =>
  JSON.parse(
    await readFile(new URL(`../fixtures/ente/${name}`, import.meta.url), "utf8"),
  ) as Transcript;

function digestFixture(value: Transcript): string {
  const copy = { ...value };
  delete copy.fixtureSha256;
  return createHash("sha256")
    .update(`${JSON.stringify(copy, null, 2)}\n`)
    .digest("hex");
}

describe("sanitized deterministic Ente SRP transcripts", () => {
  it.each(fixtureNames)(
    "has complete provenance and self-authenticating synthetic data: %s",
    async (name) => {
      const value = await load(name);
      expect(value.protocolPin).toBe("c69dcf66704ad7ec1f95e32920455be429a566ef");
      expect(value.candidate).toBe("fast-srp-hap@2.0.4");
      expect(value.candidateIntegrity).toBe(
        "sha512-lHRYYaaIbMrhZtsdGTwPN82UbqD9Bv8QfOlKs+Dz6YRnByZifOh93EYmf2iEWFtkOEIqR2IK8cFD0UN5wLIWBQ==",
      );
      expect(value.group).toBe("RFC5054-4096");
      expect(value.hash).toBe("SHA-256");
      expect(value.paddingBytes).toBe(512);
      expect(value.synthetic).toBe(true);
      expect(value.identityUtf8).toMatch(/^(?:legacy|repro)-user-id$/u);
      for (const key of requiredHex) expect(value[key]).toMatch(/^(?:[a-f\d]{2})+$/u);
      expect(value.expectedAHex).toHaveLength(1024);
      expect(value.serverPublicBHex).toHaveLength(1024);
      expect(value.premasterSecretHex).toHaveLength(1024);
      expect(value.expectedM1Hex).toHaveLength(64);
      expect(value.expectedM2Hex).toHaveLength(64);
      expect(value.fixtureSha256).toBe(digestFixture(value));
    },
  );

  it("preserves the official leading-zero Go-server proof and distinct legacy framing", async () => {
    const legacy = await load(fixtureNames[0]);
    const current = await load(fixtureNames[1]);
    expect(current.expectedAHex).toMatch(/^00/u);
    expect(String(current.expectedAHex).slice(2)).not.toMatch(/^00/u);
    expect(current.expectedM1Hex).toBe(
      "c0953b8c74d400fbf664a515deb700d73b65231e7e207a2e2326ff8cf70567ac",
    );
    expect(legacy.framing).toBe("legacy-shardpass-1.2.1");
    expect(current.framing).toBe("ente-current-pin");
    expect(legacy.expectedM1Hex).not.toBe(current.expectedM1Hex);
  });

  it.each(fixtureNames)("executes independent reference and candidate replay: %s", async (name) => {
    const value = await load(name);
    const reference = verifyExpectedReplay(value);
    const candidate = candidateReplay(value);
    expect(candidate).toMatchObject(reference);
    expect(() => candidate.verifyM2(value.expectedM2Hex)).not.toThrow();

    const negatives = value.negativeCases;
    const malformedBase64 = negatives.malformedBase64 ?? "";
    const invalidM2Hex = negatives.invalidM2Hex ?? "";
    expect(Object.keys(negatives).sort()).toEqual(
      [
        "invalidM2Hex",
        "malformedBase64",
        "mixedTranscript",
        "modulusPublicHex",
        "zeroPublicHex",
      ].sort(),
    );
    expect(() => decodeEnteSrpProtocolBase64(malformedBase64)).toThrow("Ente SRP input rejected");
    expect(() => decodeReferenceBase64(malformedBase64)).toThrow("SRP transcript rejected");
    for (const key of ["zeroPublicHex", "modulusPublicHex"] as const) {
      const publicHex = negatives[key] ?? "";
      expect(() => candidateReplay(value, publicHex)).toThrow();
      expect(() => verifyExpectedReplay({ ...value, serverPublicBHex: publicHex })).toThrow();
    }
    expect(() => candidate.verifyM2(invalidM2Hex)).toThrow();
    expect(() => verifyExpectedReplay({ ...value, expectedM2Hex: invalidM2Hex })).toThrow();
    const mixed = await load(negatives.mixedTranscript as (typeof fixtureNames)[number]);
    const mixedCandidate = candidateReplay({ ...value, serverPublicBHex: mixed.serverPublicBHex });
    expect(() => mixedCandidate.verifyM2(value.expectedM2Hex)).toThrow();
    expect(() =>
      verifyExpectedReplay({ ...value, serverPublicBHex: mixed.serverPublicBHex }),
    ).toThrow();
  });

  it("regenerates both fixtures twice and byte-compares each other plus committed", async () => {
    const first = await mkdtemp(path.join(tmpdir(), "shardpass-srp-a-"));
    const second = await mkdtemp(path.join(tmpdir(), "shardpass-srp-b-"));
    try {
      const run = (directory: string) =>
        promisify(execFile)(
          process.execPath,
          [path.resolve(root, "scripts/generate-ente-srp-transcripts.mjs"), directory],
          { cwd: root },
        );
      await run(first);
      await run(second);
      for (const name of fixtureNames) {
        const [a, b, committed] = await Promise.all([
          readFile(path.join(first, name)),
          readFile(path.join(second, name)),
          readFile(path.resolve(root, "tests/fixtures/ente", name)),
        ]);
        expect(a).toEqual(b);
        expect(a).toEqual(committed);
      }
    } finally {
      await Promise.all([
        rm(first, { recursive: true, force: true }),
        rm(second, { recursive: true, force: true }),
      ]);
    }
  });
});
