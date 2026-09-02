import { OtpItemSchema, type ItemMetadata, type OtpItem } from "@shardpass/domain";

import { OtpError } from "./error";

export const MAX_OTP_AUTH_URI_LENGTH = 4096;
const MAX_QUERY_PARAMETERS = 32;
const KNOWN_PARAMETERS = new Set(["secret", "issuer", "algorithm", "digits", "period", "counter"]);

export type OtpUriMetadata = Pick<ItemMetadata, "id" | "revision" | "createdAt" | "updatedAt"> &
  Partial<Pick<ItemMetadata, "favorite" | "tags">>;

export function parseOtpAuthUri(uri: string, metadata: OtpUriMetadata): OtpItem {
  try {
    if (uri.length === 0 || uri.length > MAX_OTP_AUTH_URI_LENGTH)
      throw new OtpError("OTP_INVALID_URI");
    const parsed = new URL(uri);
    if (
      parsed.protocol !== "otpauth:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.hash !== "" ||
      !["totp", "hotp", "steam"].includes(parsed.hostname)
    )
      throw new OtpError("OTP_INVALID_URI");

    const entries = [...parsed.searchParams.entries()];
    if (entries.length > MAX_QUERY_PARAMETERS) throw new OtpError("OTP_INVALID_URI");
    const seen = new Set<string>();
    for (const [name] of entries) {
      if (seen.has(name) || (!KNOWN_PARAMETERS.has(name) && name.toLowerCase().startsWith("x-")))
        throw new OtpError("OTP_INVALID_URI");
      seen.add(name);
    }

    const decodedLabel = decodeURIComponent(parsed.pathname.slice(1));
    if (decodedLabel.length === 0) throw new OtpError("OTP_INVALID_URI");
    const queryIssuer = parsed.searchParams.get("issuer")?.trim() ?? null;
    const exactQueryPrefix = queryIssuer === null ? null : `${queryIssuer}:`;
    const separator = decodedLabel.indexOf(":");
    const labelIssuer = separator < 0 ? "" : decodedLabel.slice(0, separator).trim();
    const label = (
      exactQueryPrefix !== null && decodedLabel.startsWith(exactQueryPrefix)
        ? decodedLabel.slice(exactQueryPrefix.length)
        : separator < 0
          ? decodedLabel
          : decodedLabel.slice(separator + 1)
    ).trim();
    const issuer = queryIssuer ?? labelIssuer;
    const secretValue = parsed.searchParams.get("secret");
    if (secretValue === null || secretValue.length > 2048) throw new OtpError("OTP_INVALID_URI");
    const secret = secretValue.replace(/[\s-]/gu, "").replace(/=+$/u, "").toUpperCase();

    const authority = parsed.hostname;
    const legacySteam =
      authority === "totp" &&
      (issuer.toLowerCase() === "steam" || labelIssuer.toLowerCase() === "steam");
    const otpType = authority === "steam" || legacySteam ? "steam" : authority;
    const algorithmValue = (parsed.searchParams.get("algorithm") ?? "SHA1")
      .replace(/-/gu, "")
      .toUpperCase();
    const digits = parseInteger(parsed.searchParams.get("digits"), otpType === "steam" ? 5 : 6);
    const period = otpType === "hotp" ? 0 : parseInteger(parsed.searchParams.get("period"), 30);
    const counterValue = parsed.searchParams.get("counter");
    if (otpType === "hotp" && counterValue === null) throw new OtpError("OTP_INVALID_URI");

    const candidate = {
      id: metadata.id,
      schemaVersion: 2,
      revision: metadata.revision,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      favorite: metadata.favorite ?? false,
      tags: metadata.tags ?? [],
      kind: "otp",
      issuer: otpType === "steam" && issuer === "" ? "Steam" : issuer,
      label,
      secret,
      otpType,
      algorithm: otpType === "steam" ? "SHA1" : algorithmValue,
      digits: otpType === "steam" ? 5 : digits,
      period: otpType === "steam" ? 30 : period,
      ...(otpType === "hotp" ? { counter: parseInteger(counterValue, 0) } : {}),
      note: "",
    };
    const result = OtpItemSchema.safeParse(candidate);
    if (!result.success) throw new OtpError("OTP_INVALID_URI");
    return result.data;
  } catch (error) {
    if (error instanceof OtpError && error.code === "OTP_INVALID_URI") throw error;
    throw new OtpError("OTP_INVALID_URI");
  }
}

export function formatOtpAuthUri(candidate: OtpItem): string {
  const result = OtpItemSchema.safeParse(candidate);
  if (!result.success) throw new OtpError("OTP_INVALID_ITEM");
  const item = result.data;
  if (item.issuer === "" && item.label.includes(":")) throw new OtpError("OTP_URI_UNREPRESENTABLE");
  const authority = item.otpType;
  const label = item.issuer === "" ? item.label : `${item.issuer}:${item.label}`;
  const query: [string, string][] = [["secret", item.secret]];
  if (item.issuer !== "") query.push(["issuer", item.issuer]);
  query.push(["algorithm", item.algorithm], ["digits", String(item.digits)]);
  if (item.otpType === "hotp") query.push(["counter", String(item.counter)]);
  else query.push(["period", String(item.period)]);
  const encodedQuery = query.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  const uri = `otpauth://${authority}/${encodeURIComponent(label)}?${encodedQuery}`;
  if (uri.length > MAX_OTP_AUTH_URI_LENGTH) throw new OtpError("OTP_URI_UNREPRESENTABLE");
  return uri;
}

function parseInteger(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) throw new OtpError("OTP_INVALID_URI");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new OtpError("OTP_INVALID_URI");
  return parsed;
}
