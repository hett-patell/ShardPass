import { TOTP, HOTP, URI } from "otpauth";
import type { Account } from "@/types";
import { warn } from "@/lib/log";

export function normalizeSecret(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

export function isValidBase32(secret: string): boolean {
  if (!secret) return false;
  return /^[A-Z2-7]+=*$/.test(normalizeSecret(secret));
}

export function generateCode(account: Account, timestamp: number = Date.now()): string {
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
  const epochSec = Math.floor(timestamp / 1000);
  return period - (epochSec % period);
}

export function progress(period: number, timestamp: number = Date.now()): number {
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

function decodePlus(s: string): string {
  return s.replace(/\+/g, " ").trim();
}

export function parseOtpAuthURI(
  uri: string,
): Omit<Account, "id" | "createdAt" | "tags"> | null {
  try {
    const totp = URI.parse(uri);
    if (!(totp instanceof TOTP)) return null;
    return {
      issuer: decodePlus(totp.issuer || ""),
      label: decodePlus(totp.label || ""),
      secret: totp.secret.base32,
      algorithm: coerceAlgorithm(totp.algorithm),
      digits: coerceDigits(totp.digits),
      period: totp.period || 30,
    };
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
