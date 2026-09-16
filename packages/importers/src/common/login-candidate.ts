import {
  LoginItemSchema,
  MAX_LOGIN_CUSTOM_FIELDS,
  MAX_LOGIN_CUSTOM_FIELD_NAME_LENGTH,
  MAX_LOGIN_CUSTOM_FIELD_VALUE_LENGTH,
  MAX_LOGIN_NAME_LENGTH,
  MAX_LOGIN_NOTES_LENGTH,
  MAX_LOGIN_PASSWORD_LENGTH,
  MAX_LOGIN_URLS,
  MAX_LOGIN_URL_LENGTH,
  MAX_LOGIN_USERNAME_LENGTH,
  MAX_SECRET_METADATA_ENTRIES,
  MAX_SECRET_METADATA_VALUE_LENGTH,
  MAX_SECRET_NOTES_LENGTH,
  MAX_SECRET_VALUE_LENGTH,
  SecretItemSchema,
  type LoginCustomField,
  type LoginPasswordHistoryEntry,
  type LoginUrlMatchMode,
  type VaultItem,
} from "@shardpass/domain";
import { inlineTotpItem } from "@shardpass/otp";

import { clampList, clampName, clampText, keepIfValid, looksLikeKeyMaterial } from "./clamp";
import type { NewItemBase } from "./item-base";

/** What every third-party source knows about a login, before it is fitted to the schema. */
export type LoginDraft = Readonly<{
  name: string;
  username: string;
  password: string;
  urls: readonly string[];
  notes: string;
  totp?: string;
  urlMatches?: readonly LoginUrlMatchMode[];
  customFields?: readonly LoginCustomField[];
  passwordHistory?: readonly LoginPasswordHistoryEntry[];
  linkedOtpId?: string;
}>;

/** Item metadata an importer has already decided on: timestamps, folder, favourite, tags. */
export type LoginBase = NewItemBase & Readonly<{ folderId?: string; archivedAt?: string }>;

/**
 * Turns a draft into a login item, clamping what the schema bounds and saying so, or into a
 * secret item when the password is longer than a login can hold (a pasted key, typically).
 * Whatever still fails is skipped with the offending field named. Returns whether an item
 * was kept.
 */
export function emitLogin(
  base: LoginBase,
  draft: LoginDraft,
  label: string,
  warnings: string[],
  items: VaultItem[],
): boolean {
  const name = clampName(draft.name, MAX_LOGIN_NAME_LENGTH, "Imported login", label, warnings);
  const username = clampText(
    draft.username,
    MAX_LOGIN_USERNAME_LENGTH,
    "username",
    label,
    warnings,
  );
  const notes = clampText(draft.notes, MAX_LOGIN_NOTES_LENGTH, "notes", label, warnings);
  const { urls, urlMatches } = clampUrls(draft, label, warnings);

  if (draft.password.length > MAX_LOGIN_PASSWORD_LENGTH) {
    warnings.push(
      `"${label}": the password is longer than a login can hold, so it was imported as a secret.`,
    );
    const metadata: Record<string, string> = {};
    const remember = (key: string, value: string, what: string) => {
      if (value.trim() === "" || Object.keys(metadata).length >= MAX_SECRET_METADATA_ENTRIES)
        return;
      metadata[key] = clampText(value, MAX_SECRET_METADATA_VALUE_LENGTH, what, label, warnings);
    };
    remember("username", username, "username");
    urls.forEach((url, index) => remember(index === 0 ? "url" : `url ${index + 1}`, url, "URL"));
    // Everything else the login carried stays readable beside the key, not silently dropped.
    remember("totp", draft.totp ?? "", "one-time code");
    for (const field of draft.customFields ?? [])
      remember(
        field.name.trim() === "" ? "field" : field.name.trim(),
        field.value,
        `field "${field.name}"`,
      );
    const candidate = {
      ...base,
      kind: "secret" as const,
      name,
      secretType: looksLikeKeyMaterial(draft.password) ? ("ssh_key" as const) : ("other" as const),
      value: clampText(draft.password, MAX_SECRET_VALUE_LENGTH, "password", label, warnings),
      metadata,
      notes: clampText(notes, MAX_SECRET_NOTES_LENGTH, "notes", label, warnings),
    };
    return keepIfValid(SecretItemSchema, candidate, "secret", label, warnings, items);
  }

  const totp = validTotp(base, name, draft.totp, label, warnings);
  const customFields = clampCustomFields(draft.customFields ?? [], label, warnings);
  const candidate = {
    ...base,
    kind: "login" as const,
    name,
    username,
    password: draft.password,
    urls,
    ...(urlMatches === undefined ? {} : { urlMatches }),
    ...(totp === undefined ? {} : { totp }),
    ...(customFields.length === 0 ? {} : { customFields }),
    ...(draft.passwordHistory === undefined || draft.passwordHistory.length === 0
      ? {}
      : { passwordHistory: [...draft.passwordHistory] }),
    ...(draft.linkedOtpId === undefined ? {} : { linkedOtpId: draft.linkedOtpId }),
    notes,
  };
  return keepIfValid(LoginItemSchema, candidate, "login", label, warnings, items);
}

function clampUrls(
  draft: LoginDraft,
  label: string,
  warnings: string[],
): { urls: string[]; urlMatches: LoginUrlMatchMode[] | undefined } {
  const kept: { url: string; match: LoginUrlMatchMode }[] = [];
  draft.urls.forEach((raw, index) => {
    const url = raw.trim();
    if (url === "") return;
    kept.push({ url, match: draft.urlMatches?.[index] ?? "domain" });
  });
  const bounded = clampList(kept, MAX_LOGIN_URLS, "URLs", label, warnings);
  const urls = bounded.map((entry) =>
    clampText(entry.url, MAX_LOGIN_URL_LENGTH, "URL", label, warnings),
  );
  const urlMatches = bounded.some((entry) => entry.match !== "domain")
    ? bounded.map((entry) => entry.match)
    : undefined;
  return { urls, urlMatches };
}

function clampCustomFields(
  fields: readonly LoginCustomField[],
  label: string,
  warnings: string[],
): LoginCustomField[] {
  return clampList(fields, MAX_LOGIN_CUSTOM_FIELDS, "custom fields", label, warnings).map(
    (field) => ({
      ...field,
      name: clampName(field.name, MAX_LOGIN_CUSTOM_FIELD_NAME_LENGTH, "Field", label, warnings),
      value: clampText(
        field.value,
        MAX_LOGIN_CUSTOM_FIELD_VALUE_LENGTH,
        `field "${field.name}"`,
        label,
        warnings,
      ),
    }),
  );
}

/**
 * A one-time-code secret is kept only when the generator can read it: an otpauth:// URI, a
 * bare Base32 secret or a steam:// one. Anything else would sit on the login as dead text.
 */
function validTotp(
  base: LoginBase,
  name: string,
  totp: string | undefined,
  label: string,
  warnings: string[],
): string | undefined {
  const raw = totp?.trim() ?? "";
  if (raw === "") return undefined;
  // Exporters space or dash a bare secret into groups; the generator wants it compact.
  const compact = raw.replace(/[\s-]/gu, "");
  const value = /^[A-Z2-7]+=*$/iu.test(compact) ? compact.toUpperCase() : raw;
  const item = inlineTotpItem({
    id: base.id,
    name,
    revision: base.revision,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    totp: value,
  });
  if (item !== null) return value;
  warnings.push(`"${label}": the one-time-code secret could not be read and was left out.`);
  return undefined;
}
