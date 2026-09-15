import { VaultKdfChallengeResponseSchema } from "@shardpass/messaging";

import type { ExtensionPlatform } from "../platform/extension-platform";
import { createPageKdfExecutor } from "../platform/kdf-executor";
import type { DerivePageKey } from "./VaultAccess";

export type RepromptOutcome = "granted" | "wrong" | "throttled" | "failed";

const defaultDerive: DerivePageKey = async (password, parameters, salt) =>
  createPageKdfExecutor().derive({
    password: new TextEncoder().encode(password),
    salt,
    parameters,
  });

/**
 * Answers an item's master-password re-prompt: a fresh challenge, the key derived on this
 * page, and the background's verdict. The password never leaves the page; the background
 * remembers the grant for a few minutes.
 */
export async function confirmReprompt(
  platform: Pick<ExtensionPlatform, "sendMessage">,
  password: string,
  itemId: string,
  deriveKey: DerivePageKey = defaultDerive,
): Promise<RepromptOutcome> {
  try {
    const raw = await platform.sendMessage({
      version: 1,
      kind: "vault.getKdfChallenge",
      purpose: "reprompt",
    });
    const challenge = VaultKdfChallengeResponseSchema.safeParse(raw);
    if (!challenge.success) return "failed";
    const { salt, ...parameters } = challenge.data.kdf;
    const key = await deriveKey(password, parameters, decodeBase64(salt));
    try {
      const reply = (await platform.sendMessage({
        version: 1,
        kind: "vault.confirmReprompt",
        challengeId: challenge.data.challengeId,
        keyEncryptionKey: encodeBase64(key),
        itemId,
      })) as { kind?: unknown; error?: { code?: unknown } } | null;
      if (reply?.kind === "vault.ok") return "granted";
      const code = reply?.error?.code;
      return code === "INVALID_CREDENTIALS"
        ? "wrong"
        : code === "THROTTLED"
          ? "throttled"
          : "failed";
    } finally {
      key.fill(0);
    }
  } catch {
    return "failed";
  }
}

function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
