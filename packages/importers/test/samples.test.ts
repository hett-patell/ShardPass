import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  guessCsvMapping,
  importBitwardenJson,
  importChromeCsv,
  importDashlane,
  importFirefoxCsv,
  importGenericCsv,
  importLastPassCsv,
  importNordPassCsv,
  importOnePasswordCsv,
  importProtonPass,
  importSafariCsv,
  readCsvHeaders,
  type ImportResult,
} from "../src";

const samples = path.resolve(process.cwd(), "docs/import-samples");
const read = (name: string) => readFile(path.join(samples, name), "utf8");
const bytes = async (name: string) => new TextEncoder().encode(await read(name)).buffer;

type Sample = Readonly<{
  file: string;
  run: (text: string) => Promise<ImportResult> | ImportResult;
  kinds: readonly string[];
  /** Notices the sample is expected to raise (a passkey, a CSV that keeps less than the JSON). */
  warnings?: readonly RegExp[];
}>;

const SAMPLES: readonly Sample[] = [
  { file: "chrome.csv", run: importChromeCsv, kinds: ["login", "login"] },
  { file: "firefox.csv", run: importFirefoxCsv, kinds: ["login", "login"] },
  { file: "safari.csv", run: importSafariCsv, kinds: ["login", "login"] },
  {
    file: "bitwarden.json",
    run: importBitwardenJson,
    kinds: ["login", "note", "card", "identity", "secret"],
  },
  { file: "1password.csv", run: importOnePasswordCsv, kinds: ["login", "note"] },
  {
    file: "lastpass.csv",
    run: importLastPassCsv,
    kinds: ["login", "note", "card", "identity", "note"],
  },
  {
    file: "dashlane-credentials.csv",
    run: (t) => importDashlane(encode(t)),
    kinds: ["login", "login"],
  },
  { file: "dashlane-securenotes.csv", run: (t) => importDashlane(encode(t)), kinds: ["note"] },
  { file: "dashlane-payments.csv", run: (t) => importDashlane(encode(t)), kinds: ["card", "note"] },
  { file: "dashlane-personalinfo.csv", run: (t) => importDashlane(encode(t)), kinds: ["identity"] },
  {
    file: "dashlane-ids.csv",
    run: (t) => importDashlane(encode(t)),
    kinds: ["identity", "identity", "identity"],
  },
  { file: "nordpass.csv", run: importNordPassCsv, kinds: ["login", "card", "identity", "note"] },
  {
    file: "protonpass.csv",
    run: (t) => importProtonPass(encode(t)),
    kinds: ["login", "note", "login"],
  },
  {
    file: "protonpass.json",
    run: (t) => importProtonPass(encode(t)),
    kinds: ["login", "note", "card", "identity", "login", "note"],
  },
  {
    file: "generic.csv",
    run: (t) => importGenericCsv(t, guessCsvMapping(readCsvHeaders(t))),
    kinds: ["login", "login"],
  },
];

function encode(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe("docs/import-samples", () => {
  for (const sample of SAMPLES) {
    it(`${sample.file} imports every row without notices`, async () => {
      const result = await sample.run(await read(sample.file));
      expect(result.items.map((item) => item.kind)).toEqual(sample.kinds);
      const unexpected = result.warnings.filter(
        (warning) => !(sample.warnings ?? []).some((pattern) => pattern.test(warning)),
      );
      expect(unexpected).toEqual([]);
      for (const item of result.items) expect("name" in item ? item.name : item.label).not.toBe("");
    });
  }

  it("keeps every importable sample listed in the README", async () => {
    const readme = await read("README.md");
    for (const sample of SAMPLES)
      expect(readme, sample.file).toMatch(sample.file.replace(/^dashlane-.*$/u, "dashlane-*.csv"));
  });

  it("the Dashlane samples import together too", async () => {
    const results = await Promise.all(
      ["credentials", "securenotes", "payments", "personalinfo", "ids"].map((name) =>
        bytes(`dashlane-${name}.csv`).then((buffer) => importDashlane(buffer)),
      ),
    );
    expect(results.flatMap((result) => result.items).length).toBe(9);
  });
});
