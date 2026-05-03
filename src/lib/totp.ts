import { TOTP, URI } from "otpauth";
import type { Account } from "@/types";

export function normalizeSecret(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

export function isValidBase32(secret: string): boolean {
  if (!secret) return false;
  return /^[A-Z2-7]+=*$/.test(normalizeSecret(secret));
}

export function generateCode(account: Account, timestamp: number = Date.now()): string {
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

export function formatCode(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  if (code.length === 7) return `${code.slice(0, 3)} ${code.slice(3)}`;
  return code;
}
