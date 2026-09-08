import { z } from "zod/mini";

import {
  ITEM_SCHEMA_VERSION,
  ItemIdSchema,
  ItemMetadataSchema,
  ItemTimestampSchema,
} from "./item-metadata";
import { UnicodeScalarTextCheck } from "./unicode-scalar-text";

export const MAX_LOGIN_NAME_LENGTH = 256;
export const MAX_LOGIN_USERNAME_LENGTH = 256;
export const MAX_LOGIN_PASSWORD_LENGTH = 4096;
export const MAX_LOGIN_URL_LENGTH = 2048;
export const MAX_LOGIN_URLS = 16;
export const MAX_LOGIN_NOTES_LENGTH = 8192;
export const MAX_LOGIN_CUSTOM_FIELDS = 32;
export const MAX_LOGIN_CUSTOM_FIELD_NAME_LENGTH = 128;
export const MAX_LOGIN_CUSTOM_FIELD_VALUE_LENGTH = 4096;
/** An otpauth:// URI or a bare Base32 secret; long enough for any real issuer/label pair. */
export const MAX_LOGIN_TOTP_LENGTH = 2048;
export const MAX_LOGIN_PASSWORD_HISTORY = 10;

/**
 * How a saved URL decides whether a page qualifies for autofill. "domain" is the
 * registrable-domain match every manager defaults to; the rest narrow it. "never" keeps
 * the URL for display but excludes it from matching entirely.
 */
export const LOGIN_URL_MATCH_MODES = ["domain", "host", "startsWith", "exact", "never"] as const;
export type LoginUrlMatchMode = (typeof LOGIN_URL_MATCH_MODES)[number];

export const LOGIN_CUSTOM_FIELD_TYPES = ["text", "hidden", "boolean", "linked"] as const;
export type LoginCustomFieldType = (typeof LOGIN_CUSTOM_FIELD_TYPES)[number];

const boundedString = (maximum: number) =>
  z.string().check(z.maxLength(maximum), UnicodeScalarTextCheck);

const trimmedBoundedString = (minimum: number, maximum: number) =>
  z.string().check(
    z.minLength(minimum),
    z.maxLength(maximum),
    UnicodeScalarTextCheck,
    z.refine((v) => v === v.trim(), { error: "Value must already be trimmed" }),
  );

/**
 * A user-defined field on a login. "hidden" is masked like a password; "linked" carries no
 * value of its own and tells autofill to write the username or password into a form field
 * of this name, which is how sites with unusual field names get filled.
 */
const customFieldSchema = z
  .strictObject({
    name: trimmedBoundedString(1, MAX_LOGIN_CUSTOM_FIELD_NAME_LENGTH),
    type: z.enum(LOGIN_CUSTOM_FIELD_TYPES),
    value: boundedString(MAX_LOGIN_CUSTOM_FIELD_VALUE_LENGTH),
    linkedTo: z.optional(z.enum(["username", "password"])),
  })
  .check(
    z.refine(
      (field) => (field.type === "linked" ? field.linkedTo !== undefined : field.linkedTo === undefined),
      { error: "linkedTo is required for linked fields and not allowed otherwise" },
    ),
  );

export const MAX_LOGIN_PASSKEYS = 5;
const base64url = (max: number) => z.string().check(z.maxLength(max), z.regex(/^[A-Za-z0-9_-]*$/u));

/**
 * A passkey the vault holds for this login (WebAuthn discoverable credential). The private
 * key is PKCS#8 DER; the public key is a COSE_Key; both base64url. Kept on the login so the
 * passkey lives with the account it signs in to, the way 1Password keeps them.
 */
/** Providers a login can sign in through instead of a password; "other" keeps the fact without the name. */
export const SIGN_IN_PROVIDERS = [
  "google",
  "apple",
  "microsoft",
  "github",
  "facebook",
  "twitter",
  "amazon",
  "linkedin",
  "slack",
  "other",
] as const;
export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number];

/** How the provider reads in copy: "Continue with Google". */
export const SIGN_IN_PROVIDER_LABELS: Readonly<Record<SignInProvider, string>> = {
  google: "Google",
  apple: "Apple",
  microsoft: "Microsoft",
  github: "GitHub",
  facebook: "Facebook",
  twitter: "X",
  amazon: "Amazon",
  linkedin: "LinkedIn",
  slack: "Slack",
  other: "a provider",
};

const passkeySchema = z.strictObject({
  credentialId: base64url(128),
  rpId: z.string().check(z.minLength(1), z.maxLength(253)),
  rpName: z.optional(boundedString(256)),
  userHandle: base64url(128),
  userName: boundedString(256),
  userDisplayName: z.optional(boundedString(256)),
  algorithm: z.literal(-7),
  privateKey: base64url(4096),
  publicKey: base64url(1024),
  counter: z.int().check(z.nonnegative()),
  createdAt: ItemTimestampSchema,
  lastUsedAt: z.optional(ItemTimestampSchema),
});

const passwordHistoryEntrySchema = z.strictObject({
  password: boundedString(MAX_LOGIN_PASSWORD_LENGTH),
  /** When this password stopped being current. */
  changedAt: ItemTimestampSchema,
});

export const LoginItemSchema = z.extend(ItemMetadataSchema, {
  kind: z.literal("login"),
  schemaVersion: z.literal(ITEM_SCHEMA_VERSION),
  name: trimmedBoundedString(1, MAX_LOGIN_NAME_LENGTH),
  username: boundedString(MAX_LOGIN_USERNAME_LENGTH),
  password: boundedString(MAX_LOGIN_PASSWORD_LENGTH),
  urls: z
    .array(z.string().check(z.minLength(1), z.maxLength(MAX_LOGIN_URL_LENGTH)))
    .check(z.maxLength(MAX_LOGIN_URLS)),
  /**
   * Match mode per URL, positionally aligned with `urls`; a missing entry means "domain".
   * A parallel array rather than a `{url, mode}` object keeps `urls` a plain string list for
   * every existing reader (autofill, importers, exports) and needs no record migration.
   */
  urlMatches: z.optional(z.array(z.enum(LOGIN_URL_MATCH_MODES)).check(z.maxLength(MAX_LOGIN_URLS))),
  linkedOtpId: z.optional(ItemIdSchema),
  /** Inline one-time-code secret: an otpauth:// URI or a bare Base32 secret. */
  totp: z.optional(boundedString(MAX_LOGIN_TOTP_LENGTH)),
  customFields: z.optional(z.array(customFieldSchema).check(z.maxLength(MAX_LOGIN_CUSTOM_FIELDS))),
  /** Most recent first. Maintained by the background on password change. */
  passwordHistory: z.optional(
    z.array(passwordHistoryEntrySchema).check(z.maxLength(MAX_LOGIN_PASSWORD_HISTORY)),
  ),
  passkeys: z.optional(z.array(passkeySchema).check(z.maxLength(MAX_LOGIN_PASSKEYS))),
  /** When this login was last filled; the background sets it on fill confirmation. */
  lastUsedAt: z.optional(ItemTimestampSchema),
  /**
   * The account signs in through a provider ("Continue with Google") rather than a
   * password of its own. The page-side flow then presses that provider's button.
   */
  signInWith: z.optional(z.enum(SIGN_IN_PROVIDERS)),
  notes: boundedString(MAX_LOGIN_NOTES_LENGTH),
});

export type LoginItem = z.infer<typeof LoginItemSchema>;
export type LoginCustomField = z.infer<typeof customFieldSchema>;
export type LoginPasswordHistoryEntry = z.infer<typeof passwordHistoryEntrySchema>;
export type LoginPasskey = z.infer<typeof passkeySchema>;
