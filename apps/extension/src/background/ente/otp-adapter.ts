import { EnteProtocolError, ENTE_SYNC_LIMITS, type EnteOtpProjection } from "./protocol";
import { enteOtpProjectionSchema } from "./schemas";
import type { AuthEntityFrame, EnteSodiumAdapter } from "./sodium-adapter";

/**
 * Wire codec for Ente Authenticator entities.
 *
 * An entity's plaintext is an `otpauth://` URI in the form the Ente Auth app writes and
 * reads: `otpauth://<type>/<issuer>:<account>?secret=...&issuer=...` with Ente's own
 * `codeDisplay` JSON parameter carrying note, tags, pinned and trashed. Anything else on the
 * wire is unreadable by the app, and anything else the app writes is unreadable here, so
 * this module speaks that dialect exactly -- quirks included -- and keeps
 * {@link EnteOtpProjection} as the internal shape the sync engines work with.
 *
 * On the wire the URI is a JSON string literal -- the app writes `JSON.stringify(uri)` and
 * reads with `JSON.parse` -- so the plaintext is `"otpauth://..."` with the quotes. A bare
 * URI is still read, leniently. A JSON object is the projection an earlier build of this
 * extension wrote; it is still accepted so nothing already synced is lost, but never
 * written again.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
export type EnteEncryptedOtpEntity = AuthEntityFrame & Readonly<{ version: 1 }>;

const MAX_FIELD_LENGTH = 1024;

/** `reason` says which rule an entity broke; it never quotes the entity itself. */
function invalid(reason: string): never {
  throw new EnteProtocolError("ENTE_INVALID", reason);
}

function validateProjection(input: unknown): EnteOtpProjection {
  const result = enteOtpProjectionSchema.safeParse(input);
  if (!result.success)
    invalid(`code failed validation (${result.error.issues[0]?.path.join(".") || "shape"})`);
  const value = result.data;
  if (
    !value.label ||
    encoder.encode(value.issuer).length > MAX_FIELD_LENGTH ||
    encoder.encode(value.label).length > MAX_FIELD_LENGTH
  )
    invalid("code has an empty label or an over-long issuer/label");
  if (value.otpType === "hotp") {
    if (value.counter === undefined || value.period !== undefined)
      invalid("HOTP code without a counter, or with a period");
  } else if (value.counter !== undefined) invalid("time-based code with a counter");
  if (value.otpType === "steam" && (value.algorithm !== "SHA1" || value.digits !== 5))
    invalid("Steam code that is not SHA1 with 5 digits");
  return {
    version: 1,
    kind: "otp",
    otpType: value.otpType,
    issuer: value.issuer,
    label: value.label,
    secretBase32: value.secretBase32,
    algorithm: value.algorithm,
    digits: value.digits,
    ...(value.period === undefined ? {} : { period: value.period }),
    ...(value.counter === undefined ? {} : { counter: value.counter }),
    ...(value.notes === undefined ? {} : { notes: value.notes }),
    ...(value.tags === undefined ? {} : { tags: value.tags }),
  };
}

// ---------------------------------------------------------------------------------------
// Ente URI dialect

type CodeDisplay = Readonly<{
  trashed?: boolean;
  pinned?: boolean;
  note?: string;
  tags?: readonly string[];
}>;

/** Ente normalises secrets by stripping whitespace and dashes and upper-casing. */
function normalizeSecret(raw: string): string {
  return raw.replace(/[\s-]/gu, "").toUpperCase().replace(/=+$/u, "");
}

function safeUrl(uri: string): URL {
  // Some clients leave a literal "#" in labels. The URL parser does not reject that -- it
  // reads everything after it as a fragment, so the query (and the secret) silently
  // disappears. Re-parse with the "#" escaped whenever parsing fails or loses the secret.
  try {
    const url = new URL(uri);
    if (url.searchParams.has("secret") || !uri.includes("#")) return url;
  } catch {
    // fall through to the escaped form
  }
  return new URL(uri.replaceAll("#", "%23"));
}

function parsePathname(url: URL): { type: EnteOtpProjection["otpType"]; path: string } {
  switch (url.host.toLowerCase()) {
    case "totp":
      return { type: "totp", path: url.pathname };
    case "hotp":
      return { type: "hotp", path: url.pathname };
    case "steam":
      return { type: "steam", path: url.pathname };
    default:
      break;
  }
  // "otpauth:////totp/..." is a real-world variant: the type lands in the path.
  const lowered = url.pathname.toLowerCase();
  if (lowered.startsWith("//totp")) return { type: "totp", path: url.pathname.slice(6) };
  if (lowered.startsWith("//hotp")) return { type: "hotp", path: url.pathname.slice(6) };
  if (lowered.startsWith("//steam")) return { type: "steam", path: url.pathname.slice(7) };
  return invalid("otpauth URI with an unsupported code type");
}

function decodePath(rawPath: string): string {
  let path = rawPath;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    // Keep the raw path when it is not valid percent-encoding.
  }
  return path.startsWith("/") ? path.slice(1) : path;
}

function parseAccount(rawPath: string): string {
  const path = decodePath(rawPath);
  return path.includes(":") ? path.split(":").slice(1).join(":") : path;
}

function parseIssuer(url: URL, rawPath: string): string {
  let issuer = url.searchParams.get("issuer");
  if (issuer) {
    // A known Ente export bug appends "period" to the issuer.
    if (issuer.endsWith("period")) issuer = issuer.slice(0, -"period".length);
    return issuer;
  }
  const path = decodePath(rawPath);
  if (path.includes(":")) return path.split(":")[0] ?? "";
  if (path.includes("-")) return path.split("-")[0] ?? "";
  return "";
}

function parseAlgorithm(url: URL): EnteOtpProjection["algorithm"] {
  switch (url.searchParams.get("algorithm")?.toLowerCase()) {
    case "sha256":
      return "SHA256";
    case "sha512":
      return "SHA512";
    default:
      return "SHA1";
  }
}

function parseCodeDisplay(url: URL): CodeDisplay | undefined {
  const raw = url.searchParams.get("codeDisplay");
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof CodeDisplay, unknown>>;
    return {
      ...(value.trashed === true ? { trashed: true } : {}),
      ...(value.pinned === true ? { pinned: true } : {}),
      ...(typeof value.note === "string" ? { note: value.note } : {}),
      ...(Array.isArray(value.tags)
        ? { tags: value.tags.filter((tag): tag is string => typeof tag === "string") }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function positiveInt(raw: string | null): number | undefined {
  if (raw === null || raw === "") return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** Parses an Ente Auth URI into the internal projection; `null` when the code is trashed. */
export function projectionFromEnteUri(uri: string): EnteOtpProjection | null {
  const url = safeUrl(uri);
  if (url.protocol !== "otpauth:") invalid("plaintext is not an otpauth URI");
  const { type, path } = parsePathname(url);
  const secret = url.searchParams.get("secret");
  if (!secret) invalid("otpauth URI without a secret");
  const display = parseCodeDisplay(url);
  if (display?.trashed) return null;

  const issuer = parseIssuer(url, path);
  const account = parseAccount(path);
  const defaultDigits = type === "steam" ? 5 : 6;
  const counter = url.searchParams.get("counter");
  const candidate = {
    version: 1,
    kind: "otp",
    otpType: type,
    issuer,
    // Ente allows an empty account; the vault needs a label, so the issuer stands in.
    label: account || issuer,
    secretBase32: normalizeSecret(secret),
    algorithm: parseAlgorithm(url),
    digits: positiveInt(url.searchParams.get("digits")) ?? defaultDigits,
    ...(type === "hotp"
      ? { counter: counter === null ? 0 : Math.max(0, Number.parseInt(counter, 10) || 0) }
      : { period: positiveInt(url.searchParams.get("period")) ?? 30 }),
    ...(display?.note ? { notes: display.note } : {}),
    ...(display?.tags && display.tags.length > 0 ? { tags: display.tags } : {}),
  };
  return validateProjection(candidate);
}

/** Serialises the internal projection into the URI the Ente Auth app expects. */
export function projectionToEnteUri(projection: EnteOtpProjection): string {
  const owned = validateProjection(projection);
  const issuer = owned.issuer;
  const label = owned.label;
  const labelPart =
    issuer === ""
      ? encodeURIComponent(label)
      : `${encodeURIComponent(issuer)}:${encodeURIComponent(label)}`;
  const url = new URL(`otpauth://${owned.otpType}/${labelPart}`);
  url.searchParams.set("secret", owned.secretBase32);
  if (issuer !== "") url.searchParams.set("issuer", issuer);
  if (owned.algorithm !== "SHA1") url.searchParams.set("algorithm", owned.algorithm.toLowerCase());
  const defaultDigits = owned.otpType === "steam" ? 5 : 6;
  if (owned.digits !== defaultDigits) url.searchParams.set("digits", String(owned.digits));
  if (owned.otpType === "hotp") url.searchParams.set("counter", String(owned.counter ?? 0));
  else if (owned.period !== undefined && owned.period !== 30)
    url.searchParams.set("period", String(owned.period));
  const display: { note?: string; tags?: readonly string[] } = {
    ...(owned.notes ? { note: owned.notes } : {}),
    ...(owned.tags && owned.tags.length > 0 ? { tags: owned.tags } : {}),
  };
  if (Object.keys(display).length > 0) url.searchParams.set("codeDisplay", JSON.stringify(display));
  return url.toString();
}

// ---------------------------------------------------------------------------------------
// Encrypted entity frames

export function encryptEnteOtpEntity(
  projection: EnteOtpProjection,
  authKey: Uint8Array,
  sodium: EnteSodiumAdapter,
): AuthEntityFrame {
  const plaintext = encoder.encode(JSON.stringify(projectionToEnteUri(projection)));
  if (plaintext.byteLength > ENTE_SYNC_LIMITS.maxDecryptedEntityBytes)
    throw new EnteProtocolError("ENTE_LIMIT_REACHED");
  try {
    return sodium.encryptAuthEntity(plaintext, authKey);
  } catch {
    throw new EnteProtocolError("ENTE_INVALID", "entity could not be encrypted");
  } finally {
    plaintext.fill(0);
  }
}

/**
 * Decrypts an entity to the internal projection. Returns `null` for a code Ente has
 * trashed. Throws ENTE_INVALID for anything that is not an authenticator code.
 */
export function parseEnteOtpEntity(
  entity: EnteEncryptedOtpEntity,
  authKey: Uint8Array,
  sodium: EnteSodiumAdapter,
): EnteOtpProjection | null {
  if (entity.version !== 1) invalid("unsupported entity frame version");
  let plaintext: Uint8Array | undefined;
  try {
    plaintext = sodium.decryptAuthEntity(entity, authKey);
    if (plaintext.byteLength > ENTE_SYNC_LIMITS.maxDecryptedEntityBytes)
      invalid("decrypted entity is larger than the sync accepts");
    const text = decoder.decode(plaintext).trim();
    let value: unknown = text;
    try {
      value = JSON.parse(text);
    } catch {
      // Not JSON: treat the raw text as a bare URI below.
    }
    if (typeof value === "string") return projectionFromEnteUri(value);
    if (typeof value === "object" && value !== null) return validateProjection(value);
    return invalid("decrypted entity is neither a URI nor a code object");
  } catch (error) {
    if (error instanceof EnteProtocolError) throw error;
    // Wrong key, corrupt ciphertext, or bytes that are not UTF-8: the entity is unreadable.
    throw new EnteProtocolError("ENTE_INVALID", "entity could not be decrypted");
  } finally {
    plaintext?.fill(0);
  }
}
