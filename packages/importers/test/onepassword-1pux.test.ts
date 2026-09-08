import type { VaultItem } from "@shardpass/domain";
import { describe, expect, it } from "vitest";

import { IMPORT_LIMITS, importOnePassword1pux, OnePassword1puxFormatError } from "../src";
import { zipArchive, type ZipEntrySpec } from "./helpers/zip-writer";

type Field = Readonly<{ title: string; id: string; value: unknown }>;
type LoginField = Readonly<{ value: string; name: string; fieldType: string; designation?: string }>;
type ItemSpec = Readonly<{
  title: string;
  categoryUuid?: string;
  state?: string;
  favIndex?: number;
  createdAt?: number;
  updatedAt?: number;
  loginFields?: readonly LoginField[];
  password?: string;
  notesPlain?: string;
  fields?: readonly Field[];
  passwordHistory?: readonly { value: string; time: number }[];
  documentAttributes?: Record<string, unknown>;
  url?: string;
  urls?: readonly string[];
  tags?: readonly string[];
  ainfo?: string;
}>;

let counter = 0;

/** OTP items carry a label rather than a name; nothing here imports one, but the union says so. */
function nameOf(entry: VaultItem): string {
  return entry.kind === "otp" ? entry.label : entry.name;
}

function item(spec: ItemSpec): Record<string, unknown> {
  counter += 1;
  return {
    uuid: `item-${counter}`,
    favIndex: spec.favIndex ?? 0,
    createdAt: spec.createdAt ?? 1_700_000_000,
    updatedAt: spec.updatedAt ?? 1_710_000_000,
    state: spec.state ?? "active",
    categoryUuid: spec.categoryUuid ?? "001",
    details: {
      loginFields: spec.loginFields ?? [],
      ...(spec.password === undefined ? {} : { password: spec.password }),
      notesPlain: spec.notesPlain ?? "",
      sections: spec.fields === undefined ? [] : [{ title: "", name: "", fields: spec.fields }],
      passwordHistory: spec.passwordHistory ?? [],
      ...(spec.documentAttributes === undefined ? {} : { documentAttributes: spec.documentAttributes }),
    },
    overview: {
      title: spec.title,
      subtitle: "",
      ...(spec.url === undefined ? {} : { url: spec.url }),
      urls: (spec.urls ?? []).map((url) => ({ label: "website", url })),
      tags: spec.tags ?? [],
      ainfo: spec.ainfo ?? "",
    },
  };
}

function exportData(
  vaults: readonly { name: string; items: readonly Record<string, unknown>[] }[],
  accounts: readonly string[] = ["Personal"],
): Record<string, unknown> {
  return {
    accounts: accounts.map((accountName, index) => ({
      attrs: { accountName, name: accountName, email: `${accountName.toLowerCase()}@example.com` },
      vaults: vaults
        .filter((_, vaultIndex) => vaultIndex % accounts.length === index)
        .map((vault) => ({ attrs: { name: vault.name }, items: vault.items })),
    })),
  };
}

function archive(data: Record<string, unknown>, deflate = false, extra: readonly ZipEntrySpec[] = []): Uint8Array {
  return zipArchive([
    { name: "export.attributes", data: '{"version":3}' },
    { name: "export.data", data: JSON.stringify(data), deflate },
    { name: "files/", data: "" },
    ...extra,
  ]);
}

const LOGIN_FIELDS: readonly LoginField[] = [
  { value: "alice@example.com", name: "email", fieldType: "E", designation: "username" },
  { value: "hunter2", name: "password", fieldType: "P", designation: "password" },
];

async function importOne(spec: ItemSpec, deflate = false) {
  const result = await importOnePassword1pux(archive(exportData([{ name: "Personal", items: [item(spec)] }]), deflate));
  return { ...result, item: result.items[0] };
}

describe("importOnePassword1pux", () => {
  it("imports a login with two URLs, tags, a one-time secret, custom fields and password history", async () => {
    const { item: login, warnings, folders } = await importOne(
      {
        title: "Example",
        loginFields: LOGIN_FIELDS,
        favIndex: 3,
        createdAt: 1_700_000_000,
        updatedAt: 1_710_000_000,
        notesPlain: "personal account",
        url: "https://example.com",
        urls: ["https://example.com", "https://login.example.com"],
        tags: ["Work", "work", "Personal"],
        fields: [
          { title: "one-time password", id: "TOTP_1", value: { totp: "JBSW Y3DP EHPK 3PXP" } },
          { title: "Security question", id: "q", value: { string: "first pet" } },
          { title: "Recovery code", id: "rc", value: { concealed: "abcd-efgh" } },
          { title: "Backup e-mail", id: "be", value: { email: { email_address: "alice@backup.test", provider: "" } } },
          { title: "Member since", id: "ms", value: { date: 1_262_347_200 } },
        ],
        passwordHistory: [
          { value: "older", time: 1_600_000_000 },
          { value: "newer", time: 1_650_000_000 },
        ],
      },
      true,
    );
    expect(warnings).toEqual([]);
    expect(folders).toBeUndefined();
    expect(login?.kind).toBe("login");
    if (login?.kind !== "login") return;
    expect(login.name).toBe("Example");
    expect(login.username).toBe("alice@example.com");
    expect(login.password).toBe("hunter2");
    expect(login.urls).toEqual(["https://example.com", "https://login.example.com"]);
    expect(login.tags).toEqual(["Work", "Personal"]);
    expect(login.favorite).toBe(true);
    expect(login.archivedAt).toBeUndefined();
    expect(login.createdAt).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(login.updatedAt).toBe(new Date(1_710_000_000 * 1000).toISOString());
    expect(login.notes).toBe("personal account");
    expect(login.totp).toBe("JBSWY3DPEHPK3PXP");
    expect(login.signInWith).toBeUndefined();
    expect(login.customFields).toEqual([
      { name: "Security question", type: "text", value: "first pet" },
      { name: "Recovery code", type: "hidden", value: "abcd-efgh" },
      { name: "Backup e-mail", type: "text", value: "alice@backup.test" },
      { name: "Member since", type: "text", value: "2010-01-01" },
    ]);
    expect(login.passwordHistory).toEqual([
      { password: "newer", changedAt: new Date(1_650_000_000 * 1000).toISOString() },
      { password: "older", changedAt: new Date(1_600_000_000 * 1000).toISOString() },
    ]);
  });

  describe("sign in with a provider", () => {
    const username: LoginField = { value: "alice@gmail.com", name: "email", fieldType: "E", designation: "username" };

    it("reads an sso field value, as an object or a string", async () => {
      const google = await importOne({
        title: "Site A",
        loginFields: [username],
        fields: [{ title: "Sign in", id: "sso", value: { sso: { provider: "Google", ssoProvider: "google.com" } } }],
      });
      expect(google.warnings).toEqual([]);
      expect(google.item).toMatchObject({ kind: "login", username: "alice@gmail.com", password: "", signInWith: "google" });
      expect((google.item as { customFields?: unknown }).customFields).toBeUndefined();

      const apple = await importOne({
        title: "Site B",
        loginFields: [username],
        fields: [{ title: "", id: "x", value: { sso: "Apple" } }],
      });
      expect(apple.item).toMatchObject({ kind: "login", password: "", signInWith: "apple" });
    });

    it('reads a field titled "Sign in with" whose value or title names the provider', async () => {
      const fromMenu = await importOne({
        title: "Site C",
        loginFields: [username],
        fields: [{ title: "Sign in with", id: "s1", value: { menu: "Apple" } }],
      });
      expect(fromMenu.item).toMatchObject({ kind: "login", signInWith: "apple", password: "" });

      const fromTitle = await importOne({
        title: "Site D",
        loginFields: [username],
        fields: [{ title: "Sign in with Microsoft", id: "s2", value: { string: "alice@outlook.com" } }],
      });
      expect(fromTitle.item).toMatchObject({ kind: "login", signInWith: "microsoft" });

      const fromId = await importOne({
        title: "Site E",
        loginFields: [username],
        fields: [{ title: "", id: "signInWith", value: { string: "X" } }],
      });
      expect(fromId.item).toMatchObject({ kind: "login", signInWith: "twitter" });
      expect(fromId.warnings).toEqual([]);
    });

    it("reads a captured form field typed SSO or designated sso", async () => {
      const typed = await importOne({
        title: "Site F",
        loginFields: [username, { value: "GitHub", name: "provider", fieldType: "SSO" }],
      });
      expect(typed.item).toMatchObject({ kind: "login", signInWith: "github", password: "" });
      expect((typed.item as { customFields?: unknown }).customFields).toBeUndefined();

      const designated = await importOne({
        title: "Site G",
        loginFields: [username, { value: "", name: "Sign in with Facebook", fieldType: "B", designation: "sso" }],
      });
      expect(designated.item).toMatchObject({ kind: "login", signInWith: "facebook" });
    });

    it('keeps an unlisted provider as "other" and says so', async () => {
      const { item: login, warnings } = await importOne({
        title: "Site H",
        loginFields: [username],
        fields: [{ title: "", id: "sso", value: { sso: { provider: "Yandex" } } }],
      });
      expect(login).toMatchObject({ kind: "login", signInWith: "other" });
      expect(warnings).toEqual(['"Site H": signs in with "Yandex", which ShardPass does not list; kept as "other".']);
    });

    it("does not guess a provider from the account's e-mail domain", async () => {
      const { item: login, warnings } = await importOne({ title: "Site I", loginFields: [username] });
      expect(login).toMatchObject({ kind: "login", username: "alice@gmail.com", password: "" });
      expect((login as { signInWith?: unknown }).signInWith).toBeUndefined();
      expect(warnings).toHaveLength(1);
      // The notice describes the export's shape (titles and value types, never values), so
      // an unrecognised "sign in with" layout can be reported.
      expect(warnings[0]).toMatch(
        /^"Site I": imported without a password \(the export has none\)\. Login fields: .+\. Section fields: .+\.$/u,
      );
      expect(warnings[0]).not.toContain("@");
    });
  });

  it("imports a credit card, filing fields it has no column for under the notes", async () => {
    const { item: card, warnings } = await importOne({
      title: "Personal Visa",
      categoryUuid: "002",
      notesPlain: "main card",
      fields: [
        { title: "cardholder name", id: "cardholder", value: { string: "John Doe" } },
        { title: "type", id: "type", value: { creditCardType: "mc" } },
        { title: "number", id: "ccnum", value: { creditCardNumber: "5555444433331111" } },
        { title: "verification number", id: "cvv", value: { concealed: "123" } },
        { title: "expiry date", id: "expiry", value: { monthYear: 203012 } },
        { title: "PIN", id: "pin", value: { concealed: "9876" } },
        { title: "issuing bank", id: "bank", value: { string: "Acme Bank" } },
      ],
    });
    expect(warnings).toEqual([]);
    expect(card).toMatchObject({
      kind: "card",
      name: "Personal Visa",
      brand: "mastercard",
      cardholderName: "John Doe",
      number: "5555444433331111",
      expMonth: "12",
      expYear: "2030",
      cvv: "123",
      pin: "9876",
      notes: "main card\n\nissuing bank: Acme Bank",
    });
  });

  it("imports an identity with its address parts, birth date and phone", async () => {
    const { item: identity, warnings } = await importOne({
      title: "Me",
      categoryUuid: "004",
      fields: [
        { title: "first name", id: "firstname", value: { string: "John" } },
        { title: "initial", id: "initial", value: { string: "Q" } },
        { title: "last name", id: "lastname", value: { string: "Doe" } },
        { title: "birth date", id: "birthdate", value: { date: 631_195_200 } },
        { title: "company", id: "company", value: { string: "Acme" } },
        { title: "occupation", id: "occupation", value: { string: "Engineer" } },
        {
          title: "address",
          id: "address",
          value: { address: { street: "123 Main St", city: "Springfield", state: "IL", zip: "62701", country: "us" } },
        },
        { title: "default phone", id: "defphone", value: { phone: "555-1234" } },
        { title: "email", id: "email", value: { string: "john@example.com" } },
      ],
    });
    expect(warnings).toEqual([]);
    expect(identity).toMatchObject({
      kind: "identity",
      firstName: "John",
      middleName: "Q",
      lastName: "Doe",
      birthDate: "1990-01-01",
      company: "Acme",
      email: "john@example.com",
      phone: "555-1234",
      street: "123 Main St",
      city: "Springfield",
      state: "IL",
      zip: "62701",
      country: "us",
      notes: "occupation: Engineer",
    });
  });

  it("imports a secure note, appending any extra fields to its content", async () => {
    const { item: note, warnings } = await importOne({
      title: "Recovery codes",
      categoryUuid: "003",
      notesPlain: "1234-5678",
      fields: [{ title: "Extra", id: "e", value: { string: "keep me" } }],
    });
    expect(warnings).toEqual([]);
    expect(note).toMatchObject({ kind: "note", name: "Recovery codes", content: "1234-5678\n\nExtra: keep me" });
  });

  it("imports a Password item as a login with an empty username", async () => {
    const { item: login, warnings } = await importOne({ title: "Wi-Fi", categoryUuid: "005", password: "p4ss" });
    expect(warnings).toEqual([]);
    expect(login).toMatchObject({ kind: "login", name: "Wi-Fi", username: "", password: "p4ss", urls: [] });
  });

  it("imports an API credential as a secret whose details are its metadata", async () => {
    const { item: secret, warnings } = await importOne({
      title: "Weather API",
      categoryUuid: "112",
      url: "https://api.example.com",
      fields: [
        { title: "username", id: "username", value: { string: "svc" } },
        { title: "credential", id: "credential", value: { concealed: "sk-123" } },
        { title: "type", id: "type", value: { menu: "bearer" } },
        { title: "hostname", id: "hostname", value: { string: "api.example.com" } },
        { title: "expires", id: "expires", value: { date: 1_900_000_000 } },
      ],
    });
    expect(warnings).toEqual([]);
    expect(secret).toMatchObject({
      kind: "secret",
      secretType: "api_key",
      value: "sk-123",
      metadata: {
        url: "https://api.example.com",
        username: "svc",
        type: "bearer",
        hostname: "api.example.com",
        expires: "2030-03-17",
      },
    });
  });

  it("keeps archived and favourite state", async () => {
    const { item: login } = await importOne({ title: "Old", loginFields: LOGIN_FIELDS, state: "archived", favIndex: 1 });
    expect(login?.favorite).toBe(true);
    expect(login?.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it("files the items of several vaults under a folder per vault", async () => {
    const result = await importOnePassword1pux(
      archive(
        exportData([
          { name: "Personal", items: [item({ title: "Home", loginFields: LOGIN_FIELDS })] },
          { name: "Work", items: [item({ title: "Office", loginFields: LOGIN_FIELDS })] },
        ]),
      ),
    );
    expect(result.folders?.map((folder) => folder.name)).toEqual(["Personal", "Work"]);
    const byName = new Map(result.items.map((entry) => [nameOf(entry), entry.folderId]));
    expect(byName.get("Home")).toBe(result.folders?.[0]?.id);
    expect(byName.get("Office")).toBe(result.folders?.[1]?.id);
  });

  it("nests same-named vaults of different accounts under the account", async () => {
    const result = await importOnePassword1pux(
      archive(
        exportData(
          [
            { name: "Personal", items: [item({ title: "A", loginFields: LOGIN_FIELDS })] },
            { name: "Personal", items: [item({ title: "B", loginFields: LOGIN_FIELDS })] },
          ],
          ["Alice", "Acme"],
        ),
      ),
    );
    expect(result.folders?.map((folder) => `${folder.parentId === undefined ? "" : "> "}${folder.name}`)).toEqual([
      "Alice",
      "> Personal",
      "Acme",
      "> Personal",
    ]);
    expect(new Set(result.items.map((entry) => entry.folderId)).size).toBe(2);
  });

  it("warns about documents, attachments and passkeys instead of importing them", async () => {
    const result = await importOnePassword1pux(
      archive(
        exportData([
          {
            name: "Personal",
            items: [
              item({ title: "Passport scan", categoryUuid: "006", documentAttributes: { fileName: "passport.pdf" } }),
              item({
                title: "With extras",
                loginFields: [LOGIN_FIELDS[0]!],
                fields: [
                  { title: "key", id: "f", value: { file: { fileName: "key.txt", documentId: "doc-1" } } },
                  {
                    title: "passkey",
                    id: "p",
                    value: {
                      passkey: {
                        credentialId: "AQID",
                        rpId: "example.com",
                        userHandle: "BAUG",
                        userName: "alice",
                        privateKey: { kty: "EC", crv: "P-256", d: "x", x: "y", y: "z" },
                      },
                    },
                  },
                ],
              }),
            ],
          },
        ]),
      ),
    );
    expect(result.warnings).toEqual([
      '"Passport scan": document not imported.',
      '"With extras": attachment "key.txt" not imported.',
      '"With extras": passkey not imported.',
    ]);
    expect(result.items.map(nameOf)).toEqual(["With extras"]);
    expect((result.items[0] as { customFields?: unknown }).customFields).toBeUndefined();
  });

  it("leaves out trashed items and stops at the entry limit", async () => {
    const limit = IMPORT_LIMITS.maxThirdPartyEntries;
    const items = Array.from({ length: limit + 2 }, (_, index) =>
      item({ title: `P${index}`, categoryUuid: "005", password: "x" }),
    );
    items.push(item({ title: "Gone", state: "trashed", loginFields: LOGIN_FIELDS }));
    const result = await importOnePassword1pux(archive(exportData([{ name: "Personal", items }])));
    expect(result.items).toHaveLength(limit);
    expect(result.warnings).toEqual([
      "1 item(s) in the trash were left out.",
      `Only the first ${limit} items were imported; 2 item(s) were skipped.`,
    ]);
  });

  describe("rejects what is not a 1PUX export, naming the reason", () => {
    const expectFormatError = async (bytes: Uint8Array, message: RegExp) => {
      const attempt = importOnePassword1pux(bytes);
      await expect(attempt).rejects.toBeInstanceOf(OnePassword1puxFormatError);
      await expect(attempt).rejects.toThrow(message);
    };

    it("a file that is not a ZIP archive", async () => {
      await expectFormatError(new Uint8Array([1, 2, 3, 4, 5]), /not a ZIP archive/u);
      await expectFormatError(new TextEncoder().encode("Title,Url\nExample,https://x"), /not a ZIP archive/u);
    });

    it("a truncated archive", async () => {
      const whole = archive(exportData([{ name: "Personal", items: [item({ title: "A" })] }]));
      await expectFormatError(whole.slice(0, whole.length - 30), /not a ZIP archive|corrupt/u);
    });

    it("an archive without export.data", async () => {
      await expectFormatError(zipArchive([{ name: "readme.txt", data: "hello" }]), /export\.data/u);
    });

    it("an export.data that is not JSON, or not a 1Password export", async () => {
      await expectFormatError(zipArchive([{ name: "export.data", data: "not json" }]), /not valid JSON/u);
      await expectFormatError(zipArchive([{ name: "export.data", data: "{}" }]), /"accounts"/u);
    });

    it("an encrypted or unusually compressed entry", async () => {
      await expectFormatError(zipArchive([{ name: "export.data", data: "{}", flags: 1 }]), /encrypted/u);
      await expectFormatError(zipArchive([{ name: "export.data", data: "{}", method: 12 }]), /compression method 12/u);
    });

    it("corrupt deflate data", async () => {
      const data = JSON.stringify(exportData([{ name: "Personal", items: [item({ title: "A" })] }]));
      const corruptData = new Uint8Array(new TextEncoder().encode(data).length).fill(0xff);
      await expectFormatError(
        zipArchive([{ name: "export.data", data, deflate: true, corruptData: corruptData.slice(0, 40) }]),
        /corrupt/u,
      );
    });
  });

  it("reads 1Password 8's ssoLogin field, whatever keys its payload uses, and takes the account e-mail", async () => {
    const google = await importOne({
      title: "Shodan",
      fields: [{ title: "sign in with", id: "signin", value: { ssoLogin: { vendor: "Google", email: "het@gmail.test" } } }],
    });
    expect(google.items[0]).toMatchObject({ kind: "login", signInWith: "google", username: "het@gmail.test", password: "" });
    expect(google.warnings).toEqual([]);

    const github = await importOne({
      title: "Codeberg",
      loginFields: [{ value: "het", name: "identifier", fieldType: "T", designation: "username" }],
      fields: [{ title: "sign in with", id: "signin", value: { ssoLogin: "GitHub" } }],
    });
    expect(github.items[0]).toMatchObject({ kind: "login", signInWith: "github", username: "het" });
    expect(github.warnings).toEqual([]);
  });

  it("reads dates and month-years in every spelling the export uses, and names an unknown value's shape", async () => {
    const { item: login, warnings } = await importOne({
      title: "API Credentials",
      loginFields: [{ value: "k", name: "key", fieldType: "P", designation: "password" }],
      fields: [
        { title: "valid from", id: "from", value: { date: "1700000000" } },
        { title: "expires", id: "to", value: { monthYear: { year: 202512 } } },
        { title: "weird", id: "w", value: { hologram: { a: 1, b: 2 } } },
        // Left blank in 1Password: exported as null, and not worth a notice.
        { title: "renewed", id: "r", value: { date: null } },
        { title: "cvv", id: "c", value: { concealed: "" } },
      ],
    });
    expect(login).toMatchObject({ kind: "login" });
    const custom = (login as { customFields?: { name: string; value: string }[] }).customFields ?? [];
    expect(custom).toEqual(
      expect.arrayContaining([
        { name: "valid from", type: "text", value: "2023-11-14" },
        { name: "expires", type: "text", value: "2025-12" },
      ]),
    );
    expect(warnings).toEqual([
      '"API Credentials": field "weird" has a value ShardPass cannot store (hologram: object with keys a, b) and was left out.',
    ]);
  });
});
