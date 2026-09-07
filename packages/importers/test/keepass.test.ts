import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  KdbxFormatError,
  KdbxPasswordError,
  convertEntry,
  importKeePassKdbx,
  kdbxTime,
  keyFileKey,
  readKdbx,
  type KeePassEntry,
} from "../src/keepass";

const PASSWORD = "fixture-master-password";
const FIXTURES = path.join(__dirname, "fixtures", "keepass");

function load(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, name)));
}

// Fixtures are produced by pykeepass (an independent implementation) via generate.py.
const COMBINATIONS = [
  ["argon2id-aes256.kdbx", "Argon2id + AES-256-CBC (matches a real-world export)"],
  ["argon2d-aes256.kdbx", "Argon2d + AES-256-CBC"],
  ["argon2id-chacha20.kdbx", "Argon2id + ChaCha20"],
] as const;

describe("KDBX 4 reader", () => {
  it.each(COMBINATIONS)("decrypts %s — %s", async (file) => {
    const database = await readKdbx(load(file), PASSWORD);
    const titles = database.entries.map((entry) => entry.title).sort();
    expect(titles).toEqual([
      "API Credential",
      "GitHub",
      "Nested Bank",
      "No Password",
      "Recovery Codes",
      "TOTP Service",
      "Unicode ✓ Ünïcødé",
    ]);
  });

  it("recovers protected values, not just their ciphertext", async () => {
    const database = await readKdbx(load("argon2id-aes256.kdbx"), PASSWORD);
    const github = database.entries.find((entry) => entry.title === "GitHub");
    expect(github).toMatchObject({
      username: "octocat",
      password: "gh-pa55word!",
      url: "https://github.com/login",
      notes: "Personal account",
    });
  });

  it("preserves non-ASCII titles, usernames and passwords", async () => {
    const database = await readKdbx(load("argon2id-aes256.kdbx"), PASSWORD);
    const entry = database.entries.find((item) => item.title.includes("Ünïcødé"));
    expect(entry?.username).toBe("ünïcødé-user");
    expect(entry?.password).toBe("pä55wörd-✓");
  });

  it("records the group path for nested entries", async () => {
    const database = await readKdbx(load("argon2id-aes256.kdbx"), PASSWORD);
    const nested = database.entries.find((entry) => entry.title === "Nested Bank");
    expect(nested?.path).toEqual(["Web", "Banking"]);
  });

  it("exposes custom fields, keeping protected ones readable", async () => {
    const database = await readKdbx(load("argon2id-aes256.kdbx"), PASSWORD);
    const api = database.entries.find((entry) => entry.title === "API Credential");
    expect(api?.custom.get("api-key")).toBe("sk-live-FIXTURE-0000");
    expect(api?.custom.get("environment")).toBe("production");
  });

  it("rejects a wrong password before decrypting anything", async () => {
    await expect(readKdbx(load("argon2id-aes256.kdbx"), "wrong-password")).rejects.toThrow(
      KdbxPasswordError,
    );
  });

  it("rejects a file that is not a KeePass database", async () => {
    await expect(readKdbx(new Uint8Array(64), PASSWORD)).rejects.toThrow(KdbxFormatError);
  });

  it("rejects a database whose payload has been tampered with", async () => {
    const file = load("argon2id-aes256.kdbx");
    // Flip a bit well past the header, inside the HMAC-protected block stream.
    const target = file.length - 16;
    file[target] = file[target]! ^ 0x01;
    await expect(readKdbx(file, PASSWORD)).rejects.toThrow(KdbxFormatError);
  });
});

describe("KDBX 4 reader: history, attachments and times", () => {
  it("keeps protected values after an entry with history aligned on the keystream", async () => {
    const database = await readKdbx(load("extras.kdbx"), PASSWORD);
    const after = database.entries.find((entry) => entry.title === "After History");
    expect(after?.password).toBe("still-readable");
    const versioned = database.entries.find((entry) => entry.title === "Versioned");
    expect(versioned?.password).toBe("current-secret-3");
    expect(versioned?.history.map((version) => version.password)).toEqual(["old-secret-1", "old-secret-2"]);
  });

  it("counts attachments without reading them", async () => {
    const database = await readKdbx(load("extras.kdbx"), PASSWORD);
    const files = database.entries.find((entry) => entry.title === "With Attachments");
    expect(files?.attachments).toBe(2);
    expect(files?.password).toBe("files-pass");
  });

  it("reads creation and modification times", async () => {
    const database = await readKdbx(load("extras.kdbx"), PASSWORD);
    const dated = database.entries.find((entry) => entry.title === "Old Times");
    expect(dated?.createdAt).toBe("2021-03-04T05:06:07.000Z");
    expect(dated?.updatedAt).toBe("2022-01-02T03:04:05.000Z");
  });

  it("decodes KDBX 4 base64 times and KDBX 3 ISO times, and nothing else", () => {
    // KDBX 4: base64 of a little-endian int64 counting seconds from year 1.
    let seconds = BigInt(Date.UTC(2021, 2, 4, 5, 6, 7) / 1000) + 62_135_596_800n;
    const bytes = new Uint8Array(8);
    for (let index = 0; index < 8; index += 1) {
      bytes[index] = Number(seconds & 0xffn);
      seconds >>= 8n;
    }
    expect(kdbxTime(btoa(String.fromCharCode(...bytes)))).toBe("2021-03-04T05:06:07.000Z");
    expect(kdbxTime("2022-01-02T03:04:05Z")).toBe("2022-01-02T03:04:05.000Z");
    expect(kdbxTime("")).toBeUndefined();
    expect(kdbxTime("not a time")).toBeUndefined();
  });
});

describe("KDBX 4 reader: key files", () => {
  it("opens a database locked with a KeePass XML (version 2) key file and a password", async () => {
    const database = await readKdbx(load("keyfile-xml.kdbx"), PASSWORD, load("fixture.keyx"));
    expect(database.entries.map((entry) => entry.title)).toContain("GitHub");
  });

  it("opens a database whose key file is an arbitrary file, hashed", async () => {
    const database = await readKdbx(load("keyfile-raw.kdbx"), PASSWORD, load("fixture-raw.key"));
    expect(database.entries.map((entry) => entry.title)).toContain("GitHub");
  });

  it("names the key file in the error when the credentials do not fit", async () => {
    await expect(readKdbx(load("keyfile-xml.kdbx"), PASSWORD)).rejects.toThrow(
      "Incorrect master password, or the file is corrupt.",
    );
    await expect(
      readKdbx(load("keyfile-xml.kdbx"), PASSWORD, load("fixture-raw.key")),
    ).rejects.toThrow("Incorrect master password or key file, or the file is corrupt.");
    await expect(readKdbx(load("argon2id-aes256.kdbx"), PASSWORD, load("fixture.keyx"))).rejects.toThrow(
      KdbxPasswordError,
    );
  });

  it("derives the key the way KeePass does for each key file layout", async () => {
    const raw = Uint8Array.from({ length: 32 }, (_, index) => index + 0x10);
    const hex = [...raw].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(await keyFileKey(raw)).toEqual(raw);
    expect(await keyFileKey(new TextEncoder().encode(hex))).toEqual(raw);
    expect(await keyFileKey(load("fixture.keyx"))).toEqual(raw);
    const v1 = `<KeyFile><Meta><Version>1.00</Version></Meta><Key><Data>${btoa(String.fromCharCode(...raw))}</Data></Key></KeyFile>`;
    expect(await keyFileKey(new TextEncoder().encode(v1))).toEqual(raw);
    const other = new TextEncoder().encode("any old file");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", other));
    expect(await keyFileKey(other)).toEqual(digest);
  });

  it("refuses an XML key file whose checksum does not match", async () => {
    const damaged = new TextDecoder().decode(load("fixture.keyx")).replace(/Hash="([0-9A-F]{8})"/u, 'Hash="00000000"');
    await expect(keyFileKey(new TextEncoder().encode(damaged))).rejects.toThrow(KdbxFormatError);
  });
});

describe("KeePass import classification", () => {
  it("routes each entry to the right vault category", async () => {
    const { items } = await importKeePassKdbx(load("argon2id-aes256.kdbx"), PASSWORD);
    const byName = new Map(items.map((item) => [nameOf(item), item.kind]));

    expect(byName.get("GitHub")).toBe("login");
    expect(byName.get("Nested Bank")).toBe("login");
    expect(byName.get("Recovery Codes")).toBe("note");
    // A token next to a username and password is a login that carries a token, not a secret
    // that throws the credentials away.
    expect(byName.get("API Credential")).toBe("login");
  });

  it("splits a TOTP entry into a login plus a linked OTP item", async () => {
    const { items } = await importKeePassKdbx(load("argon2id-aes256.kdbx"), PASSWORD);
    const otp = items.find((item) => item.kind === "otp");
    const login = items.find((item) => item.kind === "login" && item.name === "TOTP Service");

    expect(otp).toBeDefined();
    expect(otp?.kind === "otp" && otp.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(login?.kind === "login" && login.linkedOtpId).toBe(otp?.id);
  });

  it("keeps an entry that has no password rather than dropping it", async () => {
    const { items } = await importKeePassKdbx(load("argon2id-aes256.kdbx"), PASSWORD);
    const item = items.find((candidate) => nameOf(candidate) === "No Password");
    expect(item?.kind).toBe("login");
    expect(item?.kind === "login" && item.username).toBe("user-only");
  });

  it("turns KeePass groups into a folder tree and files each entry into its group", async () => {
    const { items, folders } = await importKeePassKdbx(load("argon2id-aes256.kdbx"), PASSWORD);
    const nested = items.find((item) => nameOf(item) === "Nested Bank");
    const banking = folders?.find((folder) => folder.name === "Banking");
    const web = folders?.find((folder) => folder.name === "Web");
    expect(banking?.parentId).toBe(web?.id);
    expect(web?.parentId).toBeUndefined();
    expect(nested?.folderId).toBe(banking?.id);
    expect(nested?.kind === "login" && nested.notes).not.toContain("KeePass group");
  });

  it("keeps the token of a credentialed entry as a hidden custom field", async () => {
    const { items } = await importKeePassKdbx(load("argon2id-aes256.kdbx"), PASSWORD);
    const api = items.find((item) => nameOf(item) === "API Credential");
    if (api?.kind !== "login") throw new Error("expected login");
    expect(api.username).toBe("svc-account");
    expect(api.password).toBe("not-the-real-key");
    expect(api.customFields).toEqual([
      { name: "api-key", type: "hidden", value: "sk-live-FIXTURE-0000" },
      { name: "environment", type: "text", value: "production" },
    ]);
  });

  it("produces items that all satisfy the vault schema", async () => {
    const { items, warnings } = await importKeePassKdbx(load("argon2id-aes256.kdbx"), PASSWORD);
    expect(items.length).toBeGreaterThanOrEqual(7);
    expect(warnings).toEqual([]);
  });
});

describe("KeePass import: history, attachments, times and TOTP plugins", () => {
  it("carries older passwords into the login's password history, newest first", async () => {
    const { items } = await importKeePassKdbx(load("extras.kdbx"), PASSWORD);
    const versioned = items.find((item) => nameOf(item) === "Versioned");
    if (versioned?.kind !== "login") throw new Error("expected login");
    expect(versioned.password).toBe("current-secret-3");
    expect(versioned.passwordHistory?.map((entry) => entry.password)).toEqual(["old-secret-2", "old-secret-1"]);
  });

  it("says how many attachments were left behind", async () => {
    const { items, warnings } = await importKeePassKdbx(load("extras.kdbx"), PASSWORD);
    expect(items.find((item) => nameOf(item) === "With Attachments")?.kind).toBe("login");
    expect(warnings).toContain('"With Attachments": 2 attachments not imported.');
  });

  it("keeps the entry's own creation and modification times", async () => {
    const { items } = await importKeePassKdbx(load("extras.kdbx"), PASSWORD);
    const dated = items.find((item) => nameOf(item) === "Old Times");
    expect(dated?.createdAt).toBe("2021-03-04T05:06:07.000Z");
    expect(dated?.updatedAt).toBe("2022-01-02T03:04:05.000Z");
  });

  it("reads KeeTrayTOTP seeds and settings, including the Steam form", async () => {
    const { items, warnings } = await importKeePassKdbx(load("extras.kdbx"), PASSWORD);
    const tray = items.find((item) => item.kind === "otp" && item.issuer === "Tray TOTP");
    expect(tray).toMatchObject({ secret: "JBSWY3DPEHPK3PXP", otpType: "totp", digits: 6, period: 30, label: "tray-user" });
    const steam = items.find((item) => item.kind === "otp" && item.issuer === "Tray Steam");
    expect(steam).toMatchObject({ secret: "GEZDGNBVGY3TQOJQ", otpType: "steam", digits: 5, period: 30 });
    // The seed and settings found their place on the OTP item, so the login does not repeat them.
    const login = items.find((item) => item.kind === "login" && item.name === "Tray TOTP");
    if (login?.kind !== "login") throw new Error("expected login");
    expect(login.customFields).toBeUndefined();
    expect(login.linkedOtpId).toBe(tray?.id);
    expect(warnings.filter((warning) => warning.includes("Tray"))).toEqual([]);
  });

  it("reads a KeeOTP otp string", async () => {
    const { items } = await importKeePassKdbx(load("extras.kdbx"), PASSWORD);
    const otp = items.find((item) => item.kind === "otp" && item.issuer === "KeeOTP Service");
    expect(otp).toMatchObject({ secret: "JBSWY3DPEHPK3PXP", otpType: "totp", digits: 6, period: 30, label: "keeotp-user" });
  });

  it("keeps a login that also carries an API token, with the token hidden", async () => {
    const { items } = await importKeePassKdbx(load("extras.kdbx"), PASSWORD);
    const login = items.find((item) => nameOf(item) === "Service With Token");
    if (login?.kind !== "login") throw new Error("expected login");
    expect(login.username).toBe("svc");
    expect(login.urls).toEqual(["https://svc.test"]);
    expect(login.customFields).toEqual([{ name: "api token", type: "hidden", value: "tok-FIXTURE-1234" }]);
  });

  it("keeps a card's sign-in details and never copies a protected field into notes", async () => {
    const { items, warnings } = await importKeePassKdbx(load("extras.kdbx"), PASSWORD);
    const card = items.find((item) => nameOf(item) === "Bank Visa");
    if (card?.kind !== "card") throw new Error("expected card");
    expect(card.number).toBe("4111111111111111");
    expect(card.cvv).toBe("123");
    expect(card.expMonth).toBe("12");
    expect(card.expYear).toBe("2030");
    expect(card.pin).toBe("4321");
    expect(card.notes).toBe("Username: cardsite-user\nURL: https://cards.test");
    expect(card.notes).not.toContain("web-pass");
    expect(warnings).toContain('"Bank Visa": protected field "Online Password" was not imported.');
  });
});

function nameOf(item: { kind: string; name?: string; issuer?: string }): string {
  return item.kind === "otp" ? (item.issuer ?? "") : (item.name ?? "");
}

describe("KeePass classifier hardening", () => {
  const entry = (overrides: Partial<KeePassEntry> = {}): KeePassEntry => ({
    title: "Entry",
    username: "",
    password: "",
    url: "",
    notes: "",
    otp: "",
    custom: new Map<string, string>(),
    protectedKeys: new Set<string>(),
    path: [],
    tags: [],
    attachments: 0,
    history: [],
    ...overrides,
  });

  it("routes a PEM key pasted into the Password field to a secret", () => {
    const { items, warnings } = convertEntry(
      entry({ title: "deploy key", password: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----" }),
    );
    expect(items[0]?.kind).toBe("secret");
    expect(items[0]?.kind === "secret" && items[0].secretType).toBe("ssh_key");
    expect(warnings).toEqual([]);
  });

  it("routes a password the login schema cannot hold to a secret instead of dropping it", () => {
    const { items } = convertEntry(entry({ password: "x".repeat(5000) }));
    expect(items[0]?.kind).toBe("secret");
  });

  it("classifies a token-only entry as a secret by its type, with leftovers as metadata", () => {
    const custom = new Map([["api-key", "sk-live-0000"], ["environment", "production"]]);
    const { items, warnings } = convertEntry(entry({ title: "API", custom, protectedKeys: new Set(["api-key"]) }));
    const secret = items[0];
    if (secret?.kind !== "secret") throw new Error("expected secret");
    expect(secret.secretType).toBe("api_key");
    expect(secret.value).toBe("sk-live-0000");
    expect(secret.metadata).toEqual({ environment: "production" });
    expect(warnings).toEqual([]);
  });

  it("collapses tags that differ only by case", () => {
    const { items } = convertEntry(entry({ password: "p", tags: ["Work", "work", "WORK", "home"] }));
    expect(items[0]?.tags).toEqual(["Work", "home"]);
  });

  it("truncates over-long notes and says so rather than rejecting the item", () => {
    const { items, warnings } = convertEntry(entry({ password: "p", notes: "n".repeat(9000) }));
    expect(items[0]?.kind).toBe("login");
    expect(items[0]?.kind === "login" && items[0].notes.length).toBeLessThanOrEqual(8192);
    expect(warnings.some((warning) => warning.includes("truncated"))).toBe(true);
  });

  it("splits a URL field holding several addresses", () => {
    const { items } = convertEntry(entry({ password: "p", url: "https://a.test\nhttps://b.test https://c.test" }));
    expect(items[0]?.kind === "login" && items[0].urls).toEqual([
      "https://a.test",
      "https://b.test",
      "https://c.test",
    ]);
  });

  it("warns about a one-time-code secret it cannot read instead of dropping it silently", () => {
    const { items, warnings } = convertEntry(entry({ password: "p", otp: "key=not-base32!" }));
    expect(items.map((item) => item.kind)).toEqual(["login"]);
    expect(warnings).toEqual(['"Entry": the one-time-code secret could not be read and was skipped.']);
  });

  it("keeps an identity's username and URL, and says the password had nowhere to go", () => {
    const custom = new Map([["First Name", "Ada"], ["Last Name", "Lovelace"]]);
    const { items, warnings } = convertEntry(
      entry({ title: "Passport", username: "ada", password: "pw", url: "https://gov.test", custom }),
    );
    const identity = items[0];
    if (identity?.kind !== "identity") throw new Error("expected identity");
    expect(identity.firstName).toBe("Ada");
    expect(identity.username).toBe("ada");
    expect(identity.notes).toBe("URL: https://gov.test");
    expect(warnings).toEqual(['"Passport": the password field has no place on an identity and was not imported.']);
  });
});
