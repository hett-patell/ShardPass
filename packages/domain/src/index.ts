export {
  ITEM_SCHEMA_VERSION,
  ItemIdSchema,
  ItemMetadataSchema,
  ItemTimestampSchema,
  MAX_ITEM_TAG_LENGTH,
  MAX_ITEM_TAGS,
  MAX_ITEM_TIMESTAMP_LENGTH,
} from "./item-metadata";
export type { ItemMetadata } from "./item-metadata";
export {
  MAX_OTP_ISSUER_LENGTH,
  MAX_OTP_LABEL_LENGTH,
  MAX_OTP_NOTE_LENGTH,
  MAX_OTP_PERIOD_SECONDS,
  MAX_OTP_SECRET_LENGTH,
  OtpItemSchema,
  VaultItemSchema,
} from "./otp-item";
export type { OtpItem, VaultItem } from "./otp-item";
export { isCanonicalUnpaddedBase32 } from "./canonical-base32";
export { isUnicodeScalarText, UnicodeScalarTextCheck } from "./unicode-scalar-text";

export { FolderSchema, MAX_FOLDER_DEPTH, MAX_FOLDER_NAME_LENGTH, MAX_FOLDERS } from "./folder";
export type { Folder } from "./folder";

export {
  LOGIN_CUSTOM_FIELD_TYPES,
  LOGIN_URL_MATCH_MODES,
  MAX_LOGIN_CUSTOM_FIELDS,
  MAX_LOGIN_CUSTOM_FIELD_NAME_LENGTH,
  MAX_LOGIN_CUSTOM_FIELD_VALUE_LENGTH,
  MAX_LOGIN_PASSWORD_HISTORY,
  MAX_LOGIN_TOTP_LENGTH,
  LoginItemSchema,
  MAX_LOGIN_NAME_LENGTH,
  MAX_LOGIN_NOTES_LENGTH,
  MAX_LOGIN_PASSWORD_LENGTH,
  MAX_LOGIN_URL_LENGTH,
  MAX_LOGIN_URLS,
  MAX_LOGIN_USERNAME_LENGTH,
} from "./login-item";
export type {
  LoginCustomField,
  LoginCustomFieldType,
  LoginItem,
  LoginPasswordHistoryEntry,
  LoginUrlMatchMode,
} from "./login-item";

export { MAX_NOTE_CONTENT_LENGTH, MAX_NOTE_NAME_LENGTH, NoteItemSchema } from "./note-item";
export type { NoteItem } from "./note-item";

export {
  CARD_BRANDS,
  CardItemSchema,
  MAX_CARD_HOLDER_LENGTH,
  MAX_CARD_NAME_LENGTH,
  MAX_CARD_NOTES_LENGTH,
  MAX_CARD_NUMBER_LENGTH,
} from "./card-item";
export type { CardBrand, CardItem } from "./card-item";

export {
  IdentityItemSchema,
  MAX_IDENTITY_NAME_LENGTH,
  MAX_IDENTITY_NOTES_LENGTH,
} from "./identity-item";
export type { IdentityItem } from "./identity-item";

export {
  MAX_SECRET_METADATA_ENTRIES,
  MAX_SECRET_METADATA_KEY_LENGTH,
  MAX_SECRET_METADATA_VALUE_LENGTH,
  MAX_SECRET_NAME_LENGTH,
  MAX_SECRET_NOTES_LENGTH,
  MAX_SECRET_VALUE_LENGTH,
  SecretItemSchema,
} from "./secret-item";
export type { SecretItem } from "./secret-item";

export const VAULT_ITEM_KINDS = ["otp", "login", "note", "card", "identity", "secret"] as const;
export type VaultItemKind = (typeof VAULT_ITEM_KINDS)[number];
