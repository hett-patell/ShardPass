import { TOTP, HOTP, URI, Secret } from "otpauth";
import { hmac } from "@noble/hashes/hmac.js";
import { sha1 } from "@noble/hashes/legacy.js";
import type { Account } from "@/types";
import { warn } from "@/lib/log";

export function normalizeSecret(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

export function isValidBase32(secret: string): boolean {
  if (!secret) return false;
  return /^[A-Z2-7]+=*$/.test(normalizeSecret(secret));
}

const STEAM_ALPHABET = "23456789BCDFGHJKMNPQRTVWXY";
const STEAM_PERIOD = 30;
const STEAM_DIGITS = 5;

/** Steam Guard: standard RFC 4226 dynamic truncation, but the 31-bit value is
 * encoded as 5 chars from Steam's base-26 alphabet instead of decimal digits. */
function generateSteamCode(secretB32: string, timestamp: number): string {
  const key = Secret.fromBase32(normalizeSecret(secretB32)).bytes;
  let counter = Math.floor(timestamp / 1000 / STEAM_PERIOD);
  const msg = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    msg[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const mac = hmac(sha1, key, msg);
  const offset = mac[mac.length - 1]! & 0xf;
  let bin =
    (((mac[offset]! & 0x7f) << 24) |
      (mac[offset + 1]! << 16) |
      (mac[offset + 2]! << 8) |
      mac[offset + 3]!) >>>
    0;
  let code = "";
  for (let i = 0; i < STEAM_DIGITS; i++) {
    code += STEAM_ALPHABET[bin % STEAM_ALPHABET.length];
    bin = Math.floor(bin / STEAM_ALPHABET.length);
  }
  return code;
}

export function generateCode(account: Account, timestamp: number = Date.now()): string {
  if (account.type === "steam") {
    return generateSteamCode(account.secret, timestamp);
  }
  if (account.type === "hotp") {
    const counter = account.counter ?? 0;
    const hotp = new HOTP({
      issuer: account.issuer,
      label: account.label,
      secret: normalizeSecret(account.secret),
      algorithm: account.algorithm,
      digits: account.digits,
    });
    return hotp.generate({ counter });
  }
  const totp = new TOTP({
    issuer: account.issuer,
    label: account.label,
    secret: normalizeSecret(account.secret),
    algorithm: account.algorithm,
    digits: account.digits,
    period: account.period,
  });
  return totp.generate({ timestamp });
}

export function secondsRemaining(period: number, timestamp: number = Date.now()): number {
  if (period <= 0) return 0; // HOTP accounts carry period 0 — no countdown.
  const epochSec = Math.floor(timestamp / 1000);
  return period - (epochSec % period);
}

export function progress(period: number, timestamp: number = Date.now()): number {
  if (period <= 0) return 0;
  return 1 - secondsRemaining(period, timestamp) / period;
}

function coerceAlgorithm(a: string): "SHA1" | "SHA256" | "SHA512" {
  if (a === "SHA256" || a === "SHA512") return a;
  if (a && a !== "SHA1") warn("totp", `unknown algorithm "${a}", falling back to SHA1`);
  return "SHA1";
}

function coerceDigits(d: number): 6 | 7 | 8 {
  if (d === 7 || d === 8) return d;
  return 6;
}

/**
 * Some broken otpauth URI encoders emit `+` as a space substitute
 * (application/x-www-form-urlencoded style) rather than proper percent-encoding.
 * Replace `+` with space as a defence against these non-conforming producers.
 */
function decodePlus(s: string): string {
  return s.replace(/\+/g, " ").trim();
}

export function parseOtpAuthURI(
  uri: string,
): Omit<Account, "id" | "createdAt" | "tags"> | null {
  try {
    const parsed = URI.parse(uri);
    if (parsed instanceof TOTP) {
      return {
        issuer: decodePlus(parsed.issuer || ""),
        label: decodePlus(parsed.label || ""),
        secret: parsed.secret.base32,
        algorithm: coerceAlgorithm(parsed.algorithm),
        digits: coerceDigits(parsed.digits),
        period: parsed.period || 30,
      };
    }
    if (parsed instanceof HOTP) {
      return {
        type: "hotp",
        issuer: decodePlus(parsed.issuer || ""),
        label: decodePlus(parsed.label || ""),
        secret: parsed.secret.base32,
        algorithm: coerceAlgorithm(parsed.algorithm),
        digits: coerceDigits(parsed.digits),
        period: 0,
        counter: parsed.counter ?? 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function buildOtpAuthURI(account: Account): string {
  const totp = new TOTP({
    issuer: account.issuer,
    label: account.label,
    secret: normalizeSecret(account.secret),
    algorithm: account.algorithm,
    digits: account.digits,
    period: account.period,
  });
  return totp.toString();
}
