import type { OtpItem, VaultItem } from "@shardpass/domain";

import { PortableBackupPayloadSchema, type PortableBackupPayload } from "./model";

const encoder = new TextEncoder();

export const PLAINTEXT_EXPORT_TYPE = "shardpass-plaintext-export";
export const PLAINTEXT_EXPORT_WARNING =
  "This file is not encrypted. Every secret in it can be read by anyone who can open it. Delete it when you are done with it.";
/** The column order most password managers accept for a login import. */
export const LOGINS_CSV_COLUMNS = ["name", "url", "username", "password", "notes", "totp"] as const;

/**
 * The whole vault as readable JSON: every item of every kind with its secrets, plus
 * folders. The document says so about itself in its first fields, because the file will
 * outlive the warning shown when it was created.
 */
export function encodePlaintextJsonExport(input: PortableBackupPayload): Uint8Array {
  const payload = parsePayload(input);
  const document = {
    type: PLAINTEXT_EXPORT_TYPE,
    formatVersion: 1,
    encrypted: false,
    warning: PLAINTEXT_EXPORT_WARNING,
    exportedAt: payload.exportedAt,
    folders: payload.schemaVersion === 1 ? [] : payload.folders,
    items: payload.items,
  };
  return encoder.encode(`${JSON.stringify(document, null, 2)}\n`);
}

/**
 * Logins only, one row each, in the `name,url,username,password,notes,totp` shape that
 * Bitwarden, 1Password, Chrome, and the rest import. The first saved URL is the row's URL.
 * The `totp` column carries the login's inline secret, or an otpauth:// URI built from the
 * one-time code item it is linked to.
 */
export function encodeLoginsCsvExport(input: PortableBackupPayload): Uint8Array {
  const payload = parsePayload(input);
  const otpById = new Map<string, OtpItem>();
  for (const item of payload.items) if (item.kind === "otp") otpById.set(item.id, item);
  const lines: string[] = [LOGINS_CSV_COLUMNS.join(",")];
  for (const item of payload.items) {
    if (item.kind !== "login") continue;
    const row = [
      item.name,
      item.urls[0] ?? "",
      item.username,
      item.password,
      item.notes,
      loginTotp(item, otpById),
    ];
    lines.push(row.map(csvField).join(","));
  }
  return encoder.encode(`${lines.join("\r\n")}\r\n`);
}

function loginTotp(
  item: Extract<VaultItem, { kind: "login" }>,
  otpById: ReadonlyMap<string, OtpItem>,
): string {
  if (item.totp !== undefined && item.totp !== "") return item.totp;
  const linked = item.linkedOtpId === undefined ? undefined : otpById.get(item.linkedOtpId);
  return linked === undefined ? "" : otpauthUri(linked);
}

/** Steam codes use their own alphabet, which no otpauth:// consumer produces; they are left out. */
function otpauthUri(item: OtpItem): string {
  if (item.otpType === "steam") return "";
  const label =
    item.issuer === ""
      ? encodeURIComponent(item.label)
      : `${encodeURIComponent(item.issuer)}:${encodeURIComponent(item.label)}`;
  const query = new URLSearchParams({
    secret: item.secret,
    algorithm: item.algorithm,
    digits: String(item.digits),
  });
  if (item.issuer !== "") query.set("issuer", item.issuer);
  if (item.otpType === "hotp") query.set("counter", String(item.counter ?? 0));
  else query.set("period", String(item.period));
  return `otpauth://${item.otpType}/${label}?${query.toString()}`;
}

function csvField(value: string): string {
  const needsQuotes = /["\r\n,]/u.test(value) || value !== value.trim();
  return needsQuotes ? `"${value.replaceAll('"', '""')}"` : value;
}

function parsePayload(input: unknown): PortableBackupPayload {
  const parsed = PortableBackupPayloadSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid backup payload.");
  return parsed.data;
}
