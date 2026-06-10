import { beforeAll, describe, expect, test } from "vitest";
import { installChromeMock, type ChromeMock } from "@/test/chrome-mock";
import {
  bytesToBase64,
  deriveKey,
  encryptJSON,
  randomBytes,
} from "@/lib/crypto";
import type { Account, EncryptedVault, Vault } from "@/types";
import type { AccountWithCode } from "@/lib/messages";

const PASSWORD = "main-vault-password";
const FOREIGN_PASSWORD = "attacker-backup-pw";

let mock: ChromeMock;

/** Build a valid shardpass-export blob encrypted with `password`. Uses a low
 * iteration count (honored by the import path) to keep the test fast. */
async function makeExportBlob(password: string, accounts: Account[]): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, 1_000);
  const vault: Vault = { version: 1, accounts };
  const { iv, ciphertext } = await encryptJSON(vault, key);
  return JSON.stringify({
    type: "shardpass-export",
    version: 1,
    salt: bytesToBase64(salt),
    iv,
    ciphertext,
    iterations: 1_000,
    createdAt: 0,
    updatedAt: 0,
  });
}

function foreignAccount(id: string): Account {
  return {
    id,
    issuer: "Foreign",
    label: "foreign@example.com",
    secret: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    tags: [],
    createdAt: 1,
  };
}

beforeAll(async () => {
  mock = installChromeMock();
  await import("@/background/index");
});

describe("background message handlers", () => {
  test("setup creates and unlocks a vault", async () => {
    const res = await mock.sendMessage({ kind: "setup", password: PASSWORD });
    expect(res.ok).toBe(true);
  }, 30_000);

  test("listAccounts exposes the account algorithm (edit dialog needs it)", async () => {
    const add = await mock.sendMessage({
      kind: "addAccount",
      account: {
        issuer: "GitHub",
        label: "het@example.com",
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: "SHA256",
        digits: 6,
        period: 30,
        tags: [],
      },
    });
    expect(add.ok).toBe(true);

    const list = await mock.sendMessage<AccountWithCode[]>({ kind: "listAccounts" });
    if (!list.ok) throw new Error(list.error);
    expect(list.data).toHaveLength(1);
    expect(list.data[0]!.algorithm).toBe("SHA256");
  });

  test("updateAccount without an algorithm in the patch preserves it", async () => {
    const list = await mock.sendMessage<AccountWithCode[]>({ kind: "listAccounts" });
    if (!list.ok) throw new Error(list.error);
    const id = list.data[0]!.id;

    const res = await mock.sendMessage({
      kind: "updateAccount",
      id,
      patch: { issuer: "GitHub renamed" },
    });
    expect(res.ok).toBe(true);

    const after = await mock.sendMessage<AccountWithCode[]>({ kind: "listAccounts" });
    if (!after.ok) throw new Error(after.error);
    expect(after.data[0]!.algorithm).toBe("SHA256");
  });

  test("importVault while LOCKED refuses to replace the existing vault", async () => {
    const lock = await mock.sendMessage({ kind: "lock" });
    expect(lock.ok).toBe(true);

    const before = mock.local.get("vault") as EncryptedVault;
    const blob = await makeExportBlob(FOREIGN_PASSWORD, [foreignAccount("foreign-1")]);
    const res = await mock.sendMessage({
      kind: "importVault",
      data: blob,
      password: FOREIGN_PASSWORD,
    });

    expect(res.ok).toBe(false);
    // The stored encrypted vault must be untouched.
    const after = mock.local.get("vault") as EncryptedVault;
    expect(after.ciphertext).toBe(before.ciphertext);
    expect(after.salt).toBe(before.salt);
  });

  test("original password still unlocks the original vault after the refused import", async () => {
    const res = await mock.sendMessage({ kind: "unlock", password: PASSWORD });
    expect(res.ok).toBe(true);

    const list = await mock.sendMessage<AccountWithCode[]>({ kind: "listAccounts" });
    if (!list.ok) throw new Error(list.error);
    expect(list.data).toHaveLength(1);
    expect(list.data[0]!.issuer).toBe("GitHub renamed");
  }, 30_000);

  test("importVault while UNLOCKED merges new accounts", async () => {
    const blob = await makeExportBlob(FOREIGN_PASSWORD, [foreignAccount("foreign-2")]);
    const res = await mock.sendMessage<{ merged: boolean; count: number }>({
      kind: "importVault",
      data: blob,
      password: FOREIGN_PASSWORD,
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.merged).toBe(true);

    const list = await mock.sendMessage<AccountWithCode[]>({ kind: "listAccounts" });
    if (!list.ok) throw new Error(list.error);
    expect(list.data).toHaveLength(2);
  });

  test("importVault with no vault at all creates one", async () => {
    await mock.sendMessage({ kind: "lock" });
    mock.local.clear();
    mock.session.clear();

    const blob = await makeExportBlob(FOREIGN_PASSWORD, [foreignAccount("foreign-3")]);
    const res = await mock.sendMessage<{ merged: boolean; count: number }>({
      kind: "importVault",
      data: blob,
      password: FOREIGN_PASSWORD,
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.merged).toBe(false);
    expect(res.data.count).toBe(1);
  }, 30_000);
});
