import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { replaySrpTranscript } from "./replay-ente-srp-reference.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const committedDirectory = resolve(root, "tests/fixtures/ente");
const outputDirectory = resolve(process.argv[2] ?? committedDirectory);
const fixtures = ["srp-legacy-1.2.1-transcript.json", "srp-current-pin-transcript.json"];
const digest = (value) =>
  createHash("sha256")
    .update(`${JSON.stringify(value, null, 2)}\n`)
    .digest("hex");

await mkdir(outputDirectory, { recursive: true });
for (const name of fixtures) {
  const sourcePath = resolve(committedDirectory, name);
  const outputPath = resolve(outputDirectory, name);
  const value = JSON.parse(await readFile(sourcePath, "utf8"));
  const replay = replaySrpTranscript(value);
  Object.assign(value, {
    modulusHex: (await import("./replay-ente-srp-reference.mjs")).N_HEX,
    expectedAHex: replay.A,
    serverPublicBHex: replay.B,
    scramblingUHex: replay.u,
    premasterSecretHex: replay.premaster,
    expectedSessionKeyHex: replay.sessionKey,
    expectedM1Hex: replay.M1,
    expectedM2Hex: replay.M2,
    invalidM2Hex: `${replay.M2.slice(0, 2) === "00" ? "01" : "00"}${replay.M2.slice(2)}`,
    negativeCases: {
      malformedBase64: "***not-base64***",
      zeroPublicHex: "00".repeat(512),
      modulusPublicHex: (await import("./replay-ente-srp-reference.mjs")).N_HEX,
      mixedTranscript: name === fixtures[0] ? fixtures[1] : fixtures[0],
      invalidM2Hex: `${replay.M2.slice(0, 2) === "00" ? "01" : "00"}${replay.M2.slice(2)}`,
    },
  });
  delete value.fixtureSha256;
  value.fixtureSha256 = digest(value);
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`);
}
