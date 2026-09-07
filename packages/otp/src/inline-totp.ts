import type { LoginItem, OtpItem } from "@shardpass/domain";

import { parseOtpAuthUri } from "./uri";

const BASE32 = /^[A-Z2-7]+=*$/iu;

/**
 * Turns a login's inline `totp` value into an OtpItem the generator accepts. A full
 * otpauth:// URI is used as-is; a bare Base32 secret gets the standard TOTP defaults
 * (SHA1, 6 digits, 30 s), which is what every issuer that hands out a bare secret means.
 */
export function inlineTotpItem(
  login: Pick<LoginItem, "id" | "name" | "revision" | "createdAt" | "updatedAt" | "totp">,
): OtpItem | null {
  const raw = login.totp?.trim() ?? "";
  if (raw === "") return null;
  // Bitwarden writes Steam Guard secrets as "steam://SECRET"; that is a Steam code, not a URI.
  const steam = /^steam:\/\/([A-Z2-7=]+)$/iu.exec(raw);
  const uri = steam?.[1] !== undefined
    ? `otpauth://steam/Steam?secret=${steam[1].replace(/=+$/u, "").toUpperCase()}&issuer=Steam`
    : BASE32.test(raw)
      ? `otpauth://totp/${encodeURIComponent(login.name)}?secret=${raw.replace(/=+$/u, "").toUpperCase()}`
      : raw;
  try {
    return parseOtpAuthUri(uri, {
      id: login.id,
      revision: login.revision,
      createdAt: login.createdAt,
      updatedAt: login.updatedAt,
    });
  } catch {
    return null;
  }
}
