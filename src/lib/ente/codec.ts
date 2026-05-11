import type { Account, OtpType } from "@/types";
import { normalizeSecret } from "@/lib/totp";

export interface EnteCodeDisplay {
  trashed?: boolean;
  pinned?: boolean;
  note?: string;
  tags?: string[];
}

export interface EnteParsedCode {
  type: OtpType;
  issuer: string;
  account: string;
  secret: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
  counter?: number;
  codeDisplay?: EnteCodeDisplay;
}

function safeUrl(uriString: string): URL {
  try {
    return new URL(uriString);
  } catch {
    return new URL(uriString.replaceAll("#", "%23"));
  }
}

function parsePathname(url: URL): { type: OtpType; path: string } {
  switch (url.host.toLowerCase()) {
    case "totp":
      return { type: "totp", path: url.pathname };
    case "hotp":
      return { type: "hotp", path: url.pathname };
    case "steam":
      return { type: "steam", path: url.pathname };
  }
  const p = url.pathname.toLowerCase();
  if (p.startsWith("//totp")) return { type: "totp", path: url.pathname.slice(6) };
  if (p.startsWith("//hotp")) return { type: "hotp", path: url.pathname.slice(6) };
  if (p.startsWith("//steam")) return { type: "steam", path: url.pathname.slice(7) };
  throw new Error(`Unsupported otpauth path: ${url.pathname}`);
}

function parseAccount(rawPath: string): string {
  let p = decodeURIComponent(rawPath);
  if (p.startsWith("/")) p = p.slice(1);
  if (p.includes(":")) p = p.split(":").slice(1).join(":");
  return p;
}

function parseIssuer(url: URL, rawPath: string): string {
  let issuer = url.searchParams.get("issuer");
  if (issuer) {
    if (issuer.endsWith("period")) issuer = issuer.slice(0, -6);
    return issuer;
  }
  let p = decodeURIComponent(rawPath);
  if (p.startsWith("/")) p = p.slice(1);
  if (p.includes(":")) return p.split(":")[0]!;
  if (p.includes("-")) return p.split("-")[0]!;
  return "";
}

function parseAlgorithm(url: URL): "SHA1" | "SHA256" | "SHA512" {
  switch (url.searchParams.get("algorithm")?.toLowerCase()) {
    case "sha256":
      return "SHA256";
    case "sha512":
      return "SHA512";
    default:
      return "SHA1";
  }
}

function parseCodeDisplay(url: URL): EnteCodeDisplay | undefined {
  const s = url.searchParams.get("codeDisplay");
  if (!s) return undefined;
  try {
    const obj = JSON.parse(s) as Partial<EnteCodeDisplay>;
    return {
      trashed: obj.trashed === true ? true : undefined,
      pinned: obj.pinned === true ? true : undefined,
      note: typeof obj.note === "string" ? obj.note : undefined,
      tags: Array.isArray(obj.tags) ? obj.tags.filter((t) => typeof t === "string") : undefined,
    };
  } catch {
    return undefined;
  }
}

export function parseEnteUri(uri: string): EnteParsedCode {
  const url = safeUrl(uri);
  const { type, path } = parsePathname(url);
  const secret = url.searchParams.get("secret");
  if (!secret) throw new Error("Missing secret in OTP URI");
  const defaultDigits = type === "steam" ? 5 : 6;
  return {
    type,
    issuer: parseIssuer(url, path),
    account: parseAccount(path),
    secret: normalizeSecret(secret),
    algorithm: parseAlgorithm(url),
    digits: parseInt(url.searchParams.get("digits") || "", 10) || defaultDigits,
    period: parseInt(url.searchParams.get("period") || "", 10) || 30,
    counter: url.searchParams.get("counter")
      ? parseInt(url.searchParams.get("counter")!, 10)
      : undefined,
    codeDisplay: parseCodeDisplay(url),
  };
}

export function enteUriToAccountDraft(
  uri: string,
): Omit<Account, "id" | "createdAt"> | null {
  let parsed: EnteParsedCode;
  try {
    parsed = parseEnteUri(uri);
  } catch {
    return null;
  }
  const cd = parsed.codeDisplay;
  if (cd?.trashed) return null;
  return {
    issuer: parsed.issuer,
    label: parsed.account,
    secret: parsed.secret,
    algorithm: parsed.algorithm,
    digits: parsed.digits,
    period: parsed.period,
    type: parsed.type,
    counter: parsed.counter,
    note: cd?.note,
    tags: cd?.tags ?? [],
  };
}

export function accountToEnteUri(account: Account): string {
  const type: OtpType = account.type ?? "totp";
  const issuer = account.issuer || "";
  const label = account.label || "";
  const labelPart = label
    ? `${encodeURIComponent(issuer)}:${encodeURIComponent(label)}`
    : encodeURIComponent(issuer);
  const url = new URL(`otpauth://${type}/${labelPart}`);
  url.searchParams.set("secret", normalizeSecret(account.secret));
  if (issuer) url.searchParams.set("issuer", issuer);
  if (account.algorithm && account.algorithm !== "SHA1") {
    url.searchParams.set("algorithm", account.algorithm.toLowerCase());
  }
  const defaultDigits = type === "steam" ? 5 : 6;
  if (account.digits && account.digits !== defaultDigits) {
    url.searchParams.set("digits", String(account.digits));
  }
  if (type !== "hotp" && account.period && account.period !== 30) {
    url.searchParams.set("period", String(account.period));
  }
  if (type === "hotp" && account.counter !== undefined) {
    url.searchParams.set("counter", String(account.counter));
  }
  const cd: EnteCodeDisplay = {};
  if (account.note) cd.note = account.note;
  if (account.tags && account.tags.length > 0) cd.tags = account.tags;
  if (Object.keys(cd).length > 0) {
    url.searchParams.set("codeDisplay", JSON.stringify(cd));
  }
  return url.toString();
}
