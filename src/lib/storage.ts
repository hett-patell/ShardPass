import type { EncryptedVault, Settings, Vault } from "@/types";
import { DEFAULT_SETTINGS } from "@/types";
import {
  CRYPTO_PARAMS,
  bytesToBase64,
  decryptJSON,
  deriveKey,
  encryptJSON,
  randomBytes,
} from "@/lib/crypto";

const KEY_VAULT = "vault";
const KEY_SETTINGS = "settings";

function base64ToBytesLocal(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function getEncryptedVault(): Promise<EncryptedVault | null> {
  const out = await chrome.storage.local.get(KEY_VAULT);
  return (out[KEY_VAULT] as EncryptedVault | undefined) ?? null;
}

export async function setEncryptedVault(v: EncryptedVault): Promise<void> {
  await chrome.storage.local.set({ [KEY_VAULT]: v });
}

export async function clearVault(): Promise<void> {
  await chrome.storage.local.remove(KEY_VAULT);
}

export async function hasVault(): Promise<boolean> {
  return (await getEncryptedVault()) !== null;
}

export async function createVault(
  password: string,
): Promise<{ vault: Vault; key: CryptoKey; encrypted: EncryptedVault }> {
  const salt = randomBytes(CRYPTO_PARAMS.SALT_BYTES);
  const key = await deriveKey(password, salt);
  const vault: Vault = { version: 1, accounts: [] };
  const { iv, ciphertext } = await encryptJSON(vault, key);
  const now = Date.now();
  const encrypted: EncryptedVault = {
    version: 1,
    salt: bytesToBase64(salt),
    iv,
    ciphertext,
    iterations: CRYPTO_PARAMS.PBKDF2_ITERATIONS,
    createdAt: now,
    updatedAt: now,
  };
  await setEncryptedVault(encrypted);
  return { vault, key, encrypted };
}

export async function unlockVault(
  password: string,
): Promise<{ vault: Vault; key: CryptoKey; encrypted: EncryptedVault } | null> {
  const encrypted = await getEncryptedVault();
  if (!encrypted) return null;
  const salt = base64ToBytesLocal(encrypted.salt);
  const key = await deriveKey(password, salt, encrypted.iterations);
  try {
    const vault = await decryptJSON<Vault>(encrypted.iv, encrypted.ciphertext, key);
    return { vault, key, encrypted };
  } catch {
    return null;
  }
}

export async function saveVault(vault: Vault, key: CryptoKey): Promise<void> {
  const existing = await getEncryptedVault();
  if (!existing) throw new Error("No existing vault to update");
  const { iv, ciphertext } = await encryptJSON(vault, key);
  const updated: EncryptedVault = {
    ...existing,
    iv,
    ciphertext,
    updatedAt: Date.now(),
  };
  await setEncryptedVault(updated);
}

export async function getSettings(): Promise<Settings> {
  const out = await chrome.storage.local.get(KEY_SETTINGS);
  const stored = out[KEY_SETTINGS] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function setSettings(s: Partial<Settings>): Promise<Settings> {
  const merged = { ...(await getSettings()), ...s };
  await chrome.storage.local.set({ [KEY_SETTINGS]: merged });
  return merged;
}
