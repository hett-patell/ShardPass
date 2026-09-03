import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  KdbxFormatError,
  KdbxPasswordError,
  importKeePassKdbx,
  readKdbx,
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

describe("KeePass import classification", () => {
  it("routes each entry to the right vault category", async () => {
    const { items } = await importKeePassKdbx(load("argon2id-aes256.kdbx"), PASSWORD);
    const byName = new Map(items.map((item) => [nameOf(item), item.kind]));

    expect(byName.get("GitHub")).toBe("login");
    expect(byName.get("Nested Bank")).toBe("login");
    expect(byName.get("Recovery Codes")).toBe("note");
    expect(byName.get("API Credential")).toBe("secret");
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

  it("carries the KeePass group into the imported notes", async () => {
    const { items } = await importKeePassKdbx(load("argon2id-aes256.kdbx"), PASSWORD);
    const nested = items.find((item) => nameOf(item) === "Nested Bank");
    expect(nested?.kind === "login" && nested.notes).toContain("Web / Banking");
  });

  it("classifies a secret by its type", async () => {
    const { items } = await importKeePassKdbx(load("argon2id-aes256.kdbx"), PASSWORD);
    const secret = items.find((item) => item.kind === "secret");
    expect(secret?.kind === "secret" && secret.secretType).toBe("api_key");
    expect(secret?.kind === "secret" && secret.value).toBe("sk-live-FIXTURE-0000");
  });

  it("produces items that all satisfy the vault schema", async () => {
    const { items, warnings } = await importKeePassKdbx(load("argon2id-aes256.kdbx"), PASSWORD);
    expect(items.length).toBeGreaterThanOrEqual(7);
    expect(warnings).toEqual([]);
  });
});

function nameOf(item: { kind: string; name?: string; issuer?: string }): string {
  return item.kind === "otp" ? (item.issuer ?? "") : (item.name ?? "");
}
