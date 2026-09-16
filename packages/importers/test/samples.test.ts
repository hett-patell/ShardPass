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

/** What each sample must yield, field by field, so a swapped column or a lost secret shows. */
const FIELD_CHECKS: Record<string, readonly Record<string, unknown>[]> = {
  "chrome.csv": [
    {
      username: "alice@example.com",
      password: "Chr0me-Sample-1",
      urls: ["https://example.com/login"],
      notes: "Work account",
    },
  ],
  "firefox.csv": [
    { username: "alice@example.com", password: "F1refox-Sample-1", urls: ["https://example.com"] },
  ],
  "safari.csv": [
    {
      username: "alice",
      password: "S4fari-Sample-1",
      totp: "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example",
      notes: "Two lines\nof notes",
    },
  ],
  "bitwarden.json": [
    {
      username: "alice@example.com",
      password: "B1twarden-Sample-1",
      totp: "JBSWY3DPEHPK3PXP",
      favorite: true,
      customFields: [{ name: "Member ID", value: "42", type: "text" }],
    },
    { content: "Router password on the box" },
    { brand: "visa", number: "4111111111111111", expMonth: "03", expYear: "2029", cvv: "123" },
    {
      firstName: "Alice",
      lastName: "Example",
      email: "alice@example.com",
      zip: "62701",
      notes: "Title: Ms",
    },
    {
      secretType: "ssh_key",
      metadata: { fingerprint: "SHA256:0000000000000000000000000000000000000000000" },
    },
  ],
  "1password.csv": [
    {
      username: "alice@example.com",
      password: "1P-Sample-1",
      totp: "JBSWY3DPEHPK3PXP",
      favorite: true,
    },
  ],
  "lastpass.csv": [
    {
      username: "alice@example.com",
      password: "LastP4ss-Sample-1",
      totp: "JBSWY3DPEHPK3PXP",
      favorite: true,
    },
    { content: "Just a plain secure note\non two lines" },
    {
      brand: "visa",
      number: "4111111111111111",
      expMonth: "03",
      expYear: "2029",
      cvv: "123",
      notes: "Personal card",
    },
    {
      firstName: "Alice",
      lastName: "Example",
      city: "Springfield",
      zip: "62701",
      email: "alice@example.com",
    },
    {
      content:
        "Type: Wi-Fi Password\nSSID: HomeNet\nPassword: LastP4ss-WiFi\nNotes: Router in the hall",
    },
  ],
  "dashlane-credentials.csv": [
    {
      username: "alice@example.com",
      password: "D4shlane-Sample-1",
      totp: "JBSWY3DPEHPK3PXP",
      customFields: [{ name: "Username 2", value: "alice" }],
    },
  ],
  "dashlane-payments.csv": [
    { brand: "visa", cardholderName: "Alice Example", expMonth: "03", expYear: "2029" },
  ],
  "dashlane-personalinfo.csv": [
    {
      firstName: "Alice",
      lastName: "Example",
      email: "alice@example.com",
      phone: "555-0100",
      city: "Springfield",
    },
  ],
  "dashlane-ids.csv": [
    { passportNumber: "P1234567" },
    { licenseNumber: "L7654321" },
    { nationalId: "123-45-6789" },
  ],
  "nordpass.csv": [
    {
      username: "alice@example.com",
      password: "N0rdPass-Sample-1",
      urls: ["https://example.com", "https://login.example.com"],
      customFields: [
        { name: "Member ID", value: "42", type: "text" },
        { name: "Recovery", value: "N0rd-recovery", type: "hidden" },
      ],
    },
    { brand: "visa", expMonth: "03", expYear: "2029", cvv: "123" },
    { firstName: "Alice", lastName: "Example", zip: "62701" },
    { content: "Admin password on the box" },
  ],
  "protonpass.csv": [
    {
      username: "alice",
      password: "Pr0ton-Sample-1",
      customFields: [{ name: "Email", value: "alice@example.com" }],
    },
  ],
  "protonpass.json": [
    {
      username: "alice",
      password: "Pr0ton-Sample-1",
      favorite: true,
      createdAt: "2023-11-14T22:13:20.000Z",
    },
    { content: "Admin password on the box" },
    { brand: "visa", expMonth: "03", expYear: "2029" },
    { firstName: "Alice", lastName: "Example", company: "ACME" },
    { username: "shop.alias@passmail.net" },
    { content: "In the trash" },
  ],
  "generic.csv": [
    {
      username: "alice@example.com",
      password: "Gener1c-Sample-1",
      totp: "JBSWY3DPEHPK3PXP",
      urls: ["https://example.com"],
    },
  ],
};

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
      for (const [index, expected] of (FIELD_CHECKS[sample.file] ?? []).entries())
        expect(result.items[index], `${sample.file} item ${index}`).toMatchObject(expected);
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
