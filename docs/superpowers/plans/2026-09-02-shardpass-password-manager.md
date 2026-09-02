# ShardPass Password Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend ShardPass from a TOTP-only authenticator into a full local-first password manager with login/note/card/identity/secret storage, password autofill, modern minimal UI, and third-party importers.

**Architecture:** Extend the existing pnpm monorepo on `feature/project1-release`. New item types are added to `@shardpass/domain` as Zod schemas in a discriminated union. The storage layer (`@shardpass/storage`) widens its encrypted record schema to accept all item kinds. A new `@shardpass/autofill` package provides login-form detection. The UI (`@shardpass/ui`) is redesigned with a minimal neutral light/dark palette. The extension popup and vault tab are rebuilt for multi-item-type navigation.

**Tech Stack:** TypeScript 5.9, React 19, Zod 4 (mini), Vite 7, pnpm 10, Chrome MV3, Tailwind-free CSS custom properties, Lucide icons.

**Spec:** `docs/superpowers/specs/2026-09-02-shardpass-password-manager-design.md`

## Global Constraints

- Node >=22.14.0 <23, pnpm 10.14.0, Chrome >=110
- `catalogMode: strict` — all dependency versions pinned in `pnpm-workspace.yaml` catalog
- `strictObject` Zod schemas everywhere (no extra keys)
- `verbatimModuleSyntax` in tsconfig — use `import type` for type-only imports
- All item field lengths have explicit max bounds validated by Zod
- Ente sync stays OTP-only — never pass non-OTP items to any Ente code path
- `crypto.getRandomValues()` for all randomness — no `Math.random()`
- Monospace font only for OTP codes, passwords, and secret values
- Every task ends with `pnpm typecheck && pnpm test` passing

---

### Task 1: Extend `@shardpass/domain` with new item type schemas

**Files:**
- Create: `packages/domain/src/login-item.ts`
- Create: `packages/domain/src/note-item.ts`
- Create: `packages/domain/src/card-item.ts`
- Create: `packages/domain/src/identity-item.ts`
- Create: `packages/domain/src/secret-item.ts`
- Create: `packages/domain/src/folder.ts`
- Modify: `packages/domain/src/item-metadata.ts` — add `folderId`, bump `ITEM_SCHEMA_VERSION`
- Modify: `packages/domain/src/otp-item.ts` — expand `VaultItemSchema` union
- Modify: `packages/domain/src/index.ts` — add new exports
- Create: `packages/domain/test/login-item.test.ts`
- Create: `packages/domain/test/note-item.test.ts`
- Create: `packages/domain/test/card-item.test.ts`
- Create: `packages/domain/test/identity-item.test.ts`
- Create: `packages/domain/test/secret-item.test.ts`
- Create: `packages/domain/test/folder.test.ts`

**Interfaces:**
- Consumes: `ItemMetadataSchema` from `item-metadata.ts`, `UnicodeScalarTextCheck` from `unicode-scalar-text.ts`
- Produces: `LoginItemSchema`, `NoteItemSchema`, `CardItemSchema`, `IdentityItemSchema`, `SecretItemSchema`, `FolderSchema`, `VaultItemSchema` (expanded union). Types: `LoginItem`, `NoteItem`, `CardItem`, `IdentityItem`, `SecretItem`, `Folder`, `VaultItem`.

- [ ] **Step 1: Add `folderId` to `ItemMetadataSchema` and bump version**

In `packages/domain/src/item-metadata.ts`:

```typescript
export const ITEM_SCHEMA_VERSION = 2 as const;

// In ItemMetadataSchema, add before tags:
  folderId: z.optional(ItemIdSchema),
```

Update `schemaVersion` literal from `1` to `ITEM_SCHEMA_VERSION` (it already references the constant — just the constant value changes).

- [ ] **Step 2: Write the `FolderSchema`**

Create `packages/domain/src/folder.ts`:

```typescript
import { z } from "zod/mini";

import { UnicodeScalarTextCheck } from "./unicode-scalar-text";
import { ItemIdSchema } from "./item-metadata";

export const MAX_FOLDER_NAME_LENGTH = 128;
export const MAX_FOLDER_DEPTH = 3;
export const MAX_FOLDERS = 64;

export const FolderSchema = z.strictObject({
  id: ItemIdSchema,
  name: z.string().check(
    z.minLength(1),
    z.maxLength(MAX_FOLDER_NAME_LENGTH),
    UnicodeScalarTextCheck,
    z.refine((v) => v === v.trim(), { error: "Folder name must already be trimmed" }),
  ),
  parentId: z.optional(ItemIdSchema),
});

export type Folder = z.infer<typeof FolderSchema>;
```

- [ ] **Step 3: Write `LoginItemSchema`**

Create `packages/domain/src/login-item.ts`:

```typescript
import { z } from "zod/mini";

import { ITEM_SCHEMA_VERSION, ItemMetadataSchema, ItemIdSchema } from "./item-metadata";
import { UnicodeScalarTextCheck } from "./unicode-scalar-text";

export const MAX_LOGIN_NAME_LENGTH = 256;
export const MAX_LOGIN_USERNAME_LENGTH = 256;
export const MAX_LOGIN_PASSWORD_LENGTH = 4096;
export const MAX_LOGIN_URL_LENGTH = 2048;
export const MAX_LOGIN_URLS = 16;
export const MAX_LOGIN_NOTES_LENGTH = 8192;

const boundedString = (maximum: number) =>
  z.string().check(z.maxLength(maximum), UnicodeScalarTextCheck);

const trimmedBoundedString = (minimum: number, maximum: number) =>
  z.string().check(
    z.minLength(minimum),
    z.maxLength(maximum),
    UnicodeScalarTextCheck,
    z.refine((v) => v === v.trim(), { error: "Value must already be trimmed" }),
  );

export const LoginItemSchema = z
  .extend(ItemMetadataSchema, {
    kind: z.literal("login"),
    schemaVersion: z.literal(ITEM_SCHEMA_VERSION),
    name: trimmedBoundedString(1, MAX_LOGIN_NAME_LENGTH),
    username: boundedString(MAX_LOGIN_USERNAME_LENGTH),
    password: boundedString(MAX_LOGIN_PASSWORD_LENGTH),
    urls: z
      .array(z.string().check(z.minLength(1), z.maxLength(MAX_LOGIN_URL_LENGTH)))
      .check(z.maxLength(MAX_LOGIN_URLS)),
    linkedOtpId: z.optional(ItemIdSchema),
    notes: boundedString(MAX_LOGIN_NOTES_LENGTH),
  });

export type LoginItem = z.infer<typeof LoginItemSchema>;
```

- [ ] **Step 4: Write `NoteItemSchema`**

Create `packages/domain/src/note-item.ts`:

```typescript
import { z } from "zod/mini";

import { ITEM_SCHEMA_VERSION, ItemMetadataSchema } from "./item-metadata";
import { UnicodeScalarTextCheck } from "./unicode-scalar-text";

export const MAX_NOTE_NAME_LENGTH = 256;
export const MAX_NOTE_CONTENT_LENGTH = 65536;

export const NoteItemSchema = z.extend(ItemMetadataSchema, {
  kind: z.literal("note"),
  schemaVersion: z.literal(ITEM_SCHEMA_VERSION),
  name: z.string().check(
    z.minLength(1),
    z.maxLength(MAX_NOTE_NAME_LENGTH),
    UnicodeScalarTextCheck,
    z.refine((v) => v === v.trim(), { error: "Value must already be trimmed" }),
  ),
  content: z.string().check(z.maxLength(MAX_NOTE_CONTENT_LENGTH), UnicodeScalarTextCheck),
});

export type NoteItem = z.infer<typeof NoteItemSchema>;
```

- [ ] **Step 5: Write `CardItemSchema`**

Create `packages/domain/src/card-item.ts`:

```typescript
import { z } from "zod/mini";

import { ITEM_SCHEMA_VERSION, ItemMetadataSchema } from "./item-metadata";
import { UnicodeScalarTextCheck } from "./unicode-scalar-text";

export const MAX_CARD_NAME_LENGTH = 256;
export const MAX_CARD_HOLDER_LENGTH = 256;
export const MAX_CARD_NUMBER_LENGTH = 32;
export const MAX_CARD_NOTES_LENGTH = 8192;

const boundedString = (maximum: number) =>
  z.string().check(z.maxLength(maximum), UnicodeScalarTextCheck);

export const CardItemSchema = z.extend(ItemMetadataSchema, {
  kind: z.literal("card"),
  schemaVersion: z.literal(ITEM_SCHEMA_VERSION),
  name: z.string().check(
    z.minLength(1),
    z.maxLength(MAX_CARD_NAME_LENGTH),
    UnicodeScalarTextCheck,
    z.refine((v) => v === v.trim(), { error: "Value must already be trimmed" }),
  ),
  cardholderName: boundedString(MAX_CARD_HOLDER_LENGTH),
  number: boundedString(MAX_CARD_NUMBER_LENGTH),
  expMonth: boundedString(2),
  expYear: boundedString(4),
  cvv: boundedString(8),
  pin: boundedString(16),
  notes: boundedString(MAX_CARD_NOTES_LENGTH),
});

export type CardItem = z.infer<typeof CardItemSchema>;
```

- [ ] **Step 6: Write `IdentityItemSchema`**

Create `packages/domain/src/identity-item.ts`:

```typescript
import { z } from "zod/mini";

import { ITEM_SCHEMA_VERSION, ItemMetadataSchema } from "./item-metadata";
import { UnicodeScalarTextCheck } from "./unicode-scalar-text";

export const MAX_IDENTITY_NAME_LENGTH = 256;
export const MAX_IDENTITY_NOTES_LENGTH = 8192;

const boundedString = (maximum: number) =>
  z.string().check(z.maxLength(maximum), UnicodeScalarTextCheck);

export const IdentityItemSchema = z.extend(ItemMetadataSchema, {
  kind: z.literal("identity"),
  schemaVersion: z.literal(ITEM_SCHEMA_VERSION),
  name: z.string().check(
    z.minLength(1),
    z.maxLength(MAX_IDENTITY_NAME_LENGTH),
    UnicodeScalarTextCheck,
    z.refine((v) => v === v.trim(), { error: "Value must already be trimmed" }),
  ),
  firstName: boundedString(256),
  lastName: boundedString(256),
  email: boundedString(256),
  phone: boundedString(64),
  street: boundedString(512),
  city: boundedString(256),
  state: boundedString(256),
  zip: boundedString(32),
  country: boundedString(256),
  notes: boundedString(MAX_IDENTITY_NOTES_LENGTH),
});

export type IdentityItem = z.infer<typeof IdentityItemSchema>;
```

- [ ] **Step 7: Write `SecretItemSchema`**

Create `packages/domain/src/secret-item.ts`:

```typescript
import { z } from "zod/mini";

import { ITEM_SCHEMA_VERSION, ItemMetadataSchema } from "./item-metadata";
import { UnicodeScalarTextCheck } from "./unicode-scalar-text";

export const MAX_SECRET_NAME_LENGTH = 256;
export const MAX_SECRET_VALUE_LENGTH = 65536;
export const MAX_SECRET_METADATA_ENTRIES = 32;
export const MAX_SECRET_METADATA_KEY_LENGTH = 128;
export const MAX_SECRET_METADATA_VALUE_LENGTH = 4096;
export const MAX_SECRET_NOTES_LENGTH = 8192;

const boundedString = (maximum: number) =>
  z.string().check(z.maxLength(maximum), UnicodeScalarTextCheck);

const secretMetadataSchema = z
  .record(
    z.string().check(z.minLength(1), z.maxLength(MAX_SECRET_METADATA_KEY_LENGTH)),
    z.string().check(z.maxLength(MAX_SECRET_METADATA_VALUE_LENGTH)),
  )
  .check(
    z.refine(
      (rec) => Object.keys(rec).length <= MAX_SECRET_METADATA_ENTRIES,
      { error: `Metadata must have at most ${MAX_SECRET_METADATA_ENTRIES} entries` },
    ),
  );

export const SecretItemSchema = z.extend(ItemMetadataSchema, {
  kind: z.literal("secret"),
  schemaVersion: z.literal(ITEM_SCHEMA_VERSION),
  name: z.string().check(
    z.minLength(1),
    z.maxLength(MAX_SECRET_NAME_LENGTH),
    UnicodeScalarTextCheck,
    z.refine((v) => v === v.trim(), { error: "Value must already be trimmed" }),
  ),
  secretType: z.enum(["api_key", "ssh_key", "token", "env", "other"]),
  value: boundedString(MAX_SECRET_VALUE_LENGTH),
  metadata: secretMetadataSchema,
  notes: boundedString(MAX_SECRET_NOTES_LENGTH),
});

export type SecretItem = z.infer<typeof SecretItemSchema>;
```

- [ ] **Step 8: Update `otp-item.ts` — expand `VaultItemSchema` union**

In `packages/domain/src/otp-item.ts`, update the `VaultItemSchema`:

```typescript
import { LoginItemSchema } from "./login-item";
import { NoteItemSchema } from "./note-item";
import { CardItemSchema } from "./card-item";
import { IdentityItemSchema } from "./identity-item";
import { SecretItemSchema } from "./secret-item";

// Replace the existing VaultItemSchema line:
export const VaultItemSchema = z.discriminatedUnion("kind", [
  OtpItemSchema,
  LoginItemSchema,
  NoteItemSchema,
  CardItemSchema,
  IdentityItemSchema,
  SecretItemSchema,
]);
```

Also update `OtpItemSchema`'s `schemaVersion` from `z.literal(1)` to `z.literal(ITEM_SCHEMA_VERSION)`.

Note: since `ITEM_SCHEMA_VERSION` changed from `1 as const` to `2 as const`, `OtpItemSchema` will now require `schemaVersion: 2`. This is correct — all items in the v2 vault have `schemaVersion: 2`.

- [ ] **Step 9: Update `index.ts` — add all new exports**

In `packages/domain/src/index.ts`, add:

```typescript
export {
  FolderSchema,
  MAX_FOLDER_DEPTH,
  MAX_FOLDER_NAME_LENGTH,
  MAX_FOLDERS,
} from "./folder";
export type { Folder } from "./folder";

export { LoginItemSchema, MAX_LOGIN_NAME_LENGTH, MAX_LOGIN_PASSWORD_LENGTH, MAX_LOGIN_URL_LENGTH, MAX_LOGIN_URLS, MAX_LOGIN_USERNAME_LENGTH, MAX_LOGIN_NOTES_LENGTH } from "./login-item";
export type { LoginItem } from "./login-item";

export { NoteItemSchema, MAX_NOTE_NAME_LENGTH, MAX_NOTE_CONTENT_LENGTH } from "./note-item";
export type { NoteItem } from "./note-item";

export { CardItemSchema, MAX_CARD_NAME_LENGTH, MAX_CARD_HOLDER_LENGTH, MAX_CARD_NUMBER_LENGTH, MAX_CARD_NOTES_LENGTH } from "./card-item";
export type { CardItem } from "./card-item";

export { IdentityItemSchema, MAX_IDENTITY_NAME_LENGTH, MAX_IDENTITY_NOTES_LENGTH } from "./identity-item";
export type { IdentityItem } from "./identity-item";

export { SecretItemSchema, MAX_SECRET_NAME_LENGTH, MAX_SECRET_VALUE_LENGTH, MAX_SECRET_METADATA_ENTRIES, MAX_SECRET_NOTES_LENGTH } from "./secret-item";
export type { SecretItem } from "./secret-item";
```

Also export `VaultItemKind`:

```typescript
export const VAULT_ITEM_KINDS = ["otp", "login", "note", "card", "identity", "secret"] as const;
export type VaultItemKind = (typeof VAULT_ITEM_KINDS)[number];
```

- [ ] **Step 10: Write tests for each new schema**

Create test files for each schema. Example for `packages/domain/test/login-item.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { LoginItemSchema } from "../src/login-item";

const validLogin = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  kind: "login" as const,
  schemaVersion: 2,
  revision: 1,
  createdAt: "2026-09-02T10:00:00Z",
  updatedAt: "2026-09-02T10:00:00Z",
  favorite: false,
  tags: [],
  name: "GitHub",
  username: "user@example.com",
  password: "hunter2",
  urls: ["github.com"],
  notes: "",
};

describe("LoginItemSchema", () => {
  it("accepts a valid login item", () => {
    expect(() => LoginItemSchema.parse(validLogin)).not.toThrow();
  });

  it("rejects missing name", () => {
    expect(() => LoginItemSchema.parse({ ...validLogin, name: "" })).toThrow();
  });

  it("rejects name exceeding max length", () => {
    expect(() => LoginItemSchema.parse({ ...validLogin, name: "a".repeat(257) })).toThrow();
  });

  it("accepts empty password", () => {
    expect(() => LoginItemSchema.parse({ ...validLogin, password: "" })).not.toThrow();
  });

  it("rejects too many URLs", () => {
    const urls = Array.from({ length: 17 }, (_, i) => `site${i}.com`);
    expect(() => LoginItemSchema.parse({ ...validLogin, urls })).toThrow();
  });

  it("accepts optional linkedOtpId", () => {
    const withOtp = { ...validLogin, linkedOtpId: "550e8400-e29b-41d4-a716-446655440001" };
    expect(() => LoginItemSchema.parse(withOtp)).not.toThrow();
  });

  it("rejects wrong kind", () => {
    expect(() => LoginItemSchema.parse({ ...validLogin, kind: "otp" })).toThrow();
  });
});
```

Follow the same pattern for `note-item.test.ts`, `card-item.test.ts`, `identity-item.test.ts`, `secret-item.test.ts`, `folder.test.ts` — validate happy path, max-length violations, required fields, and type-specific constraints (e.g., `secretType` enum values for secrets, `expMonth` bounds for cards).

Also add a test in `packages/domain/test/vault-item.test.ts` verifying the discriminated union:

```typescript
import { describe, expect, it } from "vitest";
import { VaultItemSchema } from "../src/otp-item";

describe("VaultItemSchema discriminated union", () => {
  it("parses a login item by kind", () => {
    const login = { /* valid login with kind: "login" */ };
    const result = VaultItemSchema.parse(login);
    expect(result.kind).toBe("login");
  });

  it("parses an otp item by kind", () => {
    const otp = { /* valid otp with kind: "otp" */ };
    const result = VaultItemSchema.parse(otp);
    expect(result.kind).toBe("otp");
  });

  it("rejects unknown kind", () => {
    const unknown = { kind: "unknown", /* ... */ };
    expect(() => VaultItemSchema.parse(unknown)).toThrow();
  });
});
```

- [ ] **Step 11: Fix existing tests that reference `schemaVersion: 1`**

The version bump from 1 to 2 will break all existing tests that construct `OtpItem` objects with `schemaVersion: 1`. Search across `packages/*/test/` and `apps/extension/test/` for `schemaVersion: 1` and update to `schemaVersion: 2`. Also search for `ITEM_SCHEMA_VERSION` usages in `packages/storage/src/vault-format.ts` — the `EncryptedRecordSchema` has `schemaVersion: z.literal(1)` which needs updating (covered in Task 2).

Run: `pnpm typecheck && pnpm test`

- [ ] **Step 12: Commit**

```bash
git add packages/domain/
git commit -m "feat(domain): add login, note, card, identity, secret item schemas

Extend VaultItemSchema discriminated union with five new item kinds.
Add FolderSchema. Bump ITEM_SCHEMA_VERSION to 2. Add folderId to
ItemMetadataSchema."
```

---

### Task 2: Widen `@shardpass/storage` for all item kinds

**Files:**
- Modify: `packages/storage/src/vault-format.ts:123-129` — widen `EncryptedRecordSchema.kind` from `z.literal("otp")` to accept all kinds
- Modify: `packages/storage/src/vault-format.ts` — update `schemaVersion` literal
- Modify: `packages/storage/src/vault-repository.ts:43-51` — widen `VaultItemMetadata.kind` type
- Modify: `packages/storage/src/vault-repository.ts` — add `listItemsByKind()`, `importItems()` for non-OTP types
- Modify: existing storage tests to use `schemaVersion: 2`

**Interfaces:**
- Consumes: `VaultItemSchema`, `VaultItemKind`, `VAULT_ITEM_KINDS` from `@shardpass/domain`
- Produces: `VaultRepository.listItemsByKind(kind: VaultItemKind)`, `VaultRepository.importItems(items: VaultItem[])`. Widened `VaultItemMetadata` with `kind: VaultItemKind`.

- [ ] **Step 1: Widen `EncryptedRecordSchema` in `vault-format.ts`**

Find the `EncryptedRecordSchema` definition (~line 123). Change:

```typescript
// FROM:
kind: z.literal("otp"),
schemaVersion: z.literal(1),

// TO:
kind: z.enum(["otp", "login", "note", "card", "identity", "secret"]),
schemaVersion: z.literal(2),
```

Also find `RECORD_FORMAT_VERSION` and any other hardcoded `schemaVersion: 1` references in this file.

- [ ] **Step 2: Widen `VaultItemMetadata` in `vault-repository.ts`**

Find the `VaultItemMetadata` interface (~line 43). Change:

```typescript
// FROM:
export interface VaultItemMetadata {
  readonly id: string;
  readonly kind: "otp";
  readonly schemaVersion: 1;
  // ...
}

// TO:
import type { VaultItemKind } from "@shardpass/domain";

export interface VaultItemMetadata {
  readonly id: string;
  readonly kind: VaultItemKind;
  readonly schemaVersion: number;
  // ...
}
```

- [ ] **Step 3: Add `listItemsByKind` method to `VaultRepository`**

Add to `VaultRepository` class:

```typescript
async listItemsByKind(kind: VaultItemKind): Promise<VaultItem[]> {
  const items = await this.listItems();
  return items.filter((item) => item.kind === kind);
}
```

- [ ] **Step 4: Add generalized `importItems` method**

The existing `importOtpItems` is hardcoded for OTP. Add a general method:

```typescript
async importItems(items: readonly VaultItem[]): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;
  for (const item of items) {
    const parsed = VaultItemSchema.parse(item);
    const existing = await this.get(parsed.id).catch(() => undefined);
    if (existing) {
      skipped++;
      continue;
    }
    await this.create(parsed);
    imported++;
  }
  return { imported, skipped };
}
```

- [ ] **Step 5: Add `FolderSchema` support to vault format**

Add a `folders` array to the vault root schema in `vault-format.ts`. The vault generation should carry folders alongside items:

```typescript
import { FolderSchema } from "@shardpass/domain";

// In the vault generation schema, add:
folders: z.array(FolderSchema).check(z.maxLength(64)),
```

- [ ] **Step 6: Update all existing storage tests**

Search `packages/storage/test/` for `schemaVersion: 1` and update to `schemaVersion: 2`. Search for `kind: "otp"` in test fixtures to ensure they still work. Add new tests:

```typescript
describe("VaultRepository with non-OTP items", () => {
  it("creates and retrieves a login item", async () => {
    const login = createTestLoginItem();
    await repo.create(login);
    const retrieved = await repo.get(login.id);
    expect(retrieved.kind).toBe("login");
    expect(retrieved.name).toBe(login.name);
  });

  it("lists items filtered by kind", async () => {
    await repo.create(createTestOtpItem());
    await repo.create(createTestLoginItem());
    await repo.create(createTestNoteItem());
    const logins = await repo.listItemsByKind("login");
    expect(logins).toHaveLength(1);
    expect(logins[0].kind).toBe("login");
  });
});
```

- [ ] **Step 7: Run tests and commit**

Run: `pnpm typecheck && pnpm test`

```bash
git add packages/storage/ packages/domain/
git commit -m "feat(storage): widen vault format and repository for all item kinds

EncryptedRecordSchema now accepts login/note/card/identity/secret kinds.
VaultItemMetadata uses VaultItemKind union type. Add listItemsByKind()
and importItems() to VaultRepository."
```

---

### Task 3: Extend `@shardpass/messaging` with new message types

**Files:**
- Create: `packages/messaging/src/login.ts`
- Create: `packages/messaging/src/login-fill.ts`
- Create: `packages/messaging/src/item-crud.ts`
- Create: `packages/messaging/src/password-gen.ts`
- Modify: `packages/messaging/src/index.ts` — add new exports
- Create: `packages/messaging/test/login-fill.test.ts`

**Interfaces:**
- Consumes: `MessageEnvelopeSchema` from `envelope.ts`, `VaultItemKind` from `@shardpass/domain`
- Produces: `LoginFillRequestSchema`, `LoginFillResponseSchema`, `ItemCrudRequestSchema`, `ItemCrudResponseSchema`, `PasswordGenRequestSchema`, `PasswordGenResponseSchema`

- [ ] **Step 1: Create login fill messages**

Create `packages/messaging/src/login-fill.ts`:

```typescript
import { z } from "zod/mini";

import { MESSAGE_VERSION } from "./envelope";

export const LoginFillSuggestionSchema = z.strictObject({
  itemId: z.uuid(),
  expectedRevision: z.int().check(z.positive()),
  name: z.string(),
  username: z.string(),
  favorite: z.boolean(),
  tags: z.array(z.string()),
  hasLinkedOtp: z.boolean(),
});

export type LoginFillSuggestion = z.infer<typeof LoginFillSuggestionSchema>;

export const LoginFillSuggestionsRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.fillSuggestions"),
  domain: z.string().check(z.minLength(1), z.maxLength(2048)),
});

export const LoginFillSuggestionsResponseSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.fillSuggestionsResult"),
  suggestions: z.array(LoginFillSuggestionSchema).check(z.maxLength(10000)),
});

export const LoginFillSelectRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.fillSelect"),
  itemId: z.uuid(),
  expectedRevision: z.int().check(z.positive()),
});

export const LoginFillReleaseResponseSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.fillRelease"),
  username: z.string(),
  password: z.string(),
  linkedOtpCode: z.optional(z.string()),
});

export const LoginFillConfirmRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.fillConfirm"),
  itemId: z.uuid(),
});

export const LoginFillCancelRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.fillCancel"),
  itemId: z.uuid(),
});

export const SaveLoginOfferRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.saveOffer"),
  domain: z.string(),
  username: z.string(),
  password: z.string(),
});

export const LoginFillRequestSchema = z.union([
  LoginFillSuggestionsRequestSchema,
  LoginFillSelectRequestSchema,
  LoginFillConfirmRequestSchema,
  LoginFillCancelRequestSchema,
  SaveLoginOfferRequestSchema,
]);

export const LoginFillResponseSchema = z.union([
  LoginFillSuggestionsResponseSchema,
  LoginFillReleaseResponseSchema,
]);
```

- [ ] **Step 2: Create password generation messages**

Create `packages/messaging/src/password-gen.ts`:

```typescript
import { z } from "zod/mini";

import { MESSAGE_VERSION } from "./envelope";

export const GeneratePasswordRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("password.generate"),
  mode: z.enum(["random", "passphrase"]),
  length: z.optional(z.int().check(z.minimum(8), z.maximum(128))),
  uppercase: z.optional(z.boolean()),
  lowercase: z.optional(z.boolean()),
  digits: z.optional(z.boolean()),
  symbols: z.optional(z.boolean()),
  excludeAmbiguous: z.optional(z.boolean()),
  wordCount: z.optional(z.int().check(z.minimum(3), z.maximum(10))),
  separator: z.optional(z.enum(["hyphen", "space", "period", "none"])),
  capitalize: z.optional(z.boolean()),
});

export const GeneratePasswordResponseSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("password.generateResult"),
  password: z.string(),
  entropyBits: z.number(),
});
```

- [ ] **Step 3: Create generic item CRUD messages**

Create `packages/messaging/src/item-crud.ts`:

```typescript
import { z } from "zod/mini";

import { MESSAGE_VERSION } from "./envelope";

export const ItemQueryRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.query"),
  itemKind: z.optional(z.enum(["otp", "login", "note", "card", "identity", "secret"])),
  folderId: z.optional(z.uuid()),
  search: z.optional(z.string().check(z.maxLength(256))),
  favoritesOnly: z.optional(z.boolean()),
});

export const ItemGetRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.get"),
  itemId: z.uuid(),
});

export const ItemCreateRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.create"),
  item: z.unknown(),
});

export const ItemUpdateRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.update"),
  itemId: z.uuid(),
  expectedRevision: z.int().check(z.positive()),
  fields: z.unknown(),
});

export const ItemDeleteRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.delete"),
  itemId: z.uuid(),
});

export const ItemCrudRequestSchema = z.union([
  ItemQueryRequestSchema,
  ItemGetRequestSchema,
  ItemCreateRequestSchema,
  ItemUpdateRequestSchema,
  ItemDeleteRequestSchema,
]);
```

- [ ] **Step 4: Update `index.ts` with new exports and write tests**

Add all new modules to `packages/messaging/src/index.ts`. Write tests validating the message schemas parse valid payloads and reject invalid ones.

Run: `pnpm typecheck && pnpm test`

- [ ] **Step 5: Commit**

```bash
git add packages/messaging/
git commit -m "feat(messaging): add login fill, item CRUD, and password generation messages"
```

---

### Task 4: Redesign `@shardpass/ui` — minimal neutral palette

**Files:**
- Rewrite: `packages/ui/src/styles/tokens.css` — new color tokens, light/dark theming
- Rewrite: `packages/ui/src/styles/base.css` — remove brutalist kickers, add system font
- Modify: `packages/ui/src/styles/primitives.module.css` — update Button, Field, etc.
- Create: `packages/ui/src/components/ItemRow.tsx`
- Create: `packages/ui/src/components/ItemRow.module.css`
- Create: `packages/ui/src/components/CategoryNav.tsx`
- Create: `packages/ui/src/components/CategoryNav.module.css`
- Create: `packages/ui/src/components/SearchBar.tsx`
- Create: `packages/ui/src/components/SearchBar.module.css`
- Modify: `packages/ui/src/index.ts` — export new components
- Create: `packages/ui/test/ItemRow.dom.test.tsx`

**Interfaces:**
- Consumes: `VaultItemKind` from `@shardpass/domain`, `lucide-react` icons
- Produces: `ItemRow` component (props: `{ kind, name, subtitle, rightContent?, onClick?, active? }`), `CategoryNav` component, `SearchBar` component. CSS custom properties for theming.

- [ ] **Step 1: Rewrite `tokens.css`**

```css
:root {
  /* Backgrounds */
  --bg-primary: #ffffff;
  --bg-secondary: #f7f7f8;
  --bg-tertiary: #ebebef;
  --bg-elevated: #ffffff;

  /* Text */
  --text-primary: #111113;
  --text-secondary: #6e6e76;
  --text-tertiary: #9e9ea6;

  /* Accent */
  --accent: #2563eb;
  --accent-hover: #1d4ed8;
  --accent-subtle: #eff6ff;

  /* Borders */
  --border: #e4e4e7;
  --border-hover: #d4d4d8;

  /* Status */
  --danger: #dc2626;
  --danger-subtle: #fef2f2;
  --success: #16a34a;
  --success-subtle: #f0fdf4;
  --warning: #d97706;

  /* Elevation */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07);

  /* Radii */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;

  /* Fonts */
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --font-mono: "SF Mono", "Cascadia Code", "Fira Code", monospace;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg-primary: #111113;
    --bg-secondary: #1a1a1e;
    --bg-tertiary: #232328;
    --bg-elevated: #1a1a1e;

    --text-primary: #ededef;
    --text-secondary: #8e8e96;
    --text-tertiary: #5e5e66;

    --accent: #3b82f6;
    --accent-hover: #60a5fa;
    --accent-subtle: #172554;

    --border: #27272a;
    --border-hover: #3f3f46;

    --danger: #ef4444;
    --danger-subtle: #450a0a;
    --success: #22c55e;
    --success-subtle: #052e16;
    --warning: #f59e0b;

    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
    --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.4);
  }
}

:root[data-theme="dark"] {
  --bg-primary: #111113;
  --bg-secondary: #1a1a1e;
  --bg-tertiary: #232328;
  --bg-elevated: #1a1a1e;

  --text-primary: #ededef;
  --text-secondary: #8e8e96;
  --text-tertiary: #5e5e66;

  --accent: #3b82f6;
  --accent-hover: #60a5fa;
  --accent-subtle: #172554;

  --border: #27272a;
  --border-hover: #3f3f46;

  --danger: #ef4444;
  --danger-subtle: #450a0a;
  --success: #22c55e;
  --success-subtle: #052e16;
  --warning: #f59e0b;

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.4);
}
```

- [ ] **Step 2: Rewrite `base.css`**

```css
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary);
  background: var(--bg-primary);
  -webkit-font-smoothing: antialiased;
}

body {
  background: var(--bg-primary);
  color: var(--text-primary);
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

::selection {
  background: var(--accent);
  color: white;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
```

Remove all `.monoLabel`, `.eyebrow`, vermillion references.

- [ ] **Step 3: Update `primitives.module.css`**

Rewrite Button variants to use the new tokens:

```css
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  font-family: var(--font-sans);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 120ms, border-color 120ms;
}

.primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
.primary:hover { background: var(--accent-hover); }

.secondary {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-color: var(--border);
}
.secondary:hover { border-color: var(--border-hover); }

.ghost {
  background: transparent;
  color: var(--text-secondary);
}
.ghost:hover { background: var(--bg-secondary); color: var(--text-primary); }

.danger {
  background: var(--danger-subtle);
  color: var(--danger);
  border-color: var(--danger);
}
```

- [ ] **Step 4: Create `ItemRow` component**

Create `packages/ui/src/components/ItemRow.tsx`:

```tsx
import { Globe, KeyRound, StickyNote, CreditCard, User, Lock } from "lucide-react";
import type { VaultItemKind } from "@shardpass/domain";

import styles from "./ItemRow.module.css";

const ICONS: Record<VaultItemKind, React.ComponentType<{ size?: number }>> = {
  login: Globe,
  otp: KeyRound,
  note: StickyNote,
  card: CreditCard,
  identity: User,
  secret: Lock,
};

interface ItemRowProps {
  kind: VaultItemKind;
  name: string;
  subtitle?: string;
  rightContent?: React.ReactNode;
  active?: boolean;
  favorite?: boolean;
  onClick?: () => void;
}

export function ItemRow({ kind, name, subtitle, rightContent, active, onClick }: ItemRowProps) {
  const Icon = ICONS[kind];
  return (
    <button
      type="button"
      className={`${styles.row} ${active ? styles.active : ""}`}
      onClick={onClick}
    >
      <span className={styles.icon}>
        <Icon size={16} />
      </span>
      <span className={styles.content}>
        <span className={styles.name}>{name}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </span>
      {rightContent && <span className={styles.right}>{rightContent}</span>}
    </button>
  );
}
```

`ItemRow.module.css`:

```css
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  min-height: 44px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  font-family: var(--font-sans);
  color: var(--text-primary);
  transition: background 80ms;
}
.row:hover { background: var(--bg-secondary); }
.active { background: var(--accent-subtle); }
.active:hover { background: var(--accent-subtle); }

.icon {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subtitle {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  color: var(--text-tertiary);
}
```

- [ ] **Step 5: Create `CategoryNav` and `SearchBar` components**

Follow the same pattern. `CategoryNav` renders a vertical list of category items using `ItemRow`-style styling with count badges. `SearchBar` is a simple input with a search icon.

- [ ] **Step 6: Update existing components that reference old tokens**

Update `AppHeader`, `StatusBadge`, `ShardPassMark` to use the new token names. Remove vermillion references. Update `AppHeader` to drop the `.eyebrow` mono kicker — use a simple text label instead.

- [ ] **Step 7: Export new components from `index.ts` and write DOM tests**

Run: `pnpm typecheck && pnpm test`

- [ ] **Step 8: Commit**

```bash
git add packages/ui/
git commit -m "redesign(ui): minimal neutral palette with light/dark theming

Replace vermillion+graphite dark-only theme with a neutral blue-accent
palette supporting system-adaptive light/dark mode. Drop brutalist
uppercase kickers. Add ItemRow, CategoryNav, SearchBar components."
```

---

### Task 5: Password generator

**Files:**
- Create: `packages/crypto/src/password-generator.ts`
- Create: `packages/crypto/src/wordlist.ts`
- Create: `packages/crypto/test/password-generator.test.ts`
- Modify: `packages/crypto/src/index.ts` — add export
- Modify: `packages/crypto/package.json` — add `"./password-generator"` export

**Interfaces:**
- Consumes: `crypto.getRandomValues()` (global)
- Produces: `generateRandomPassword(opts): { password: string; entropyBits: number }`, `generatePassphrase(opts): { password: string; entropyBits: number }`

- [ ] **Step 1: Write failing tests**

Create `packages/crypto/test/password-generator.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { generateRandomPassword, generatePassphrase } from "../src/password-generator";

describe("generateRandomPassword", () => {
  it("produces a password of the requested length", () => {
    const { password } = generateRandomPassword({ length: 20 });
    expect(password).toHaveLength(20);
  });

  it("includes at least one char from each enabled class", () => {
    const { password } = generateRandomPassword({
      length: 20,
      uppercase: true,
      lowercase: true,
      digits: true,
      symbols: true,
    });
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[^A-Za-z0-9]/);
  });

  it("excludes ambiguous characters when requested", () => {
    const { password } = generateRandomPassword({
      length: 100,
      excludeAmbiguous: true,
      uppercase: true,
      lowercase: true,
      digits: true,
    });
    expect(password).not.toMatch(/[0OIl1]/);
  });

  it("reports entropy bits", () => {
    const { entropyBits } = generateRandomPassword({ length: 20 });
    expect(entropyBits).toBeGreaterThan(0);
  });

  it("rejects length below 8", () => {
    expect(() => generateRandomPassword({ length: 7 })).toThrow();
  });
});

describe("generatePassphrase", () => {
  it("produces the requested number of words", () => {
    const { password } = generatePassphrase({ wordCount: 4, separator: "hyphen" });
    expect(password.split("-")).toHaveLength(4);
  });

  it("capitalizes first letter when requested", () => {
    const { password } = generatePassphrase({ wordCount: 4, separator: "hyphen", capitalize: true });
    for (const word of password.split("-")) {
      expect(word[0]).toBe(word[0].toUpperCase());
    }
  });

  it("reports entropy bits", () => {
    const { entropyBits } = generatePassphrase({ wordCount: 4 });
    expect(entropyBits).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: Implement `password-generator.ts`**

```typescript
import { EFF_WORDLIST } from "./wordlist";

const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const UPPER_FULL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const LOWER_FULL = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "23456789";
const DIGITS_FULL = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{}|;:,.<>?";

function secureRandomIndex(max: number): number {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] % max;
}

interface RandomPasswordOptions {
  length?: number;
  uppercase?: boolean;
  lowercase?: boolean;
  digits?: boolean;
  symbols?: boolean;
  excludeAmbiguous?: boolean;
}

export function generateRandomPassword(opts: RandomPasswordOptions = {}): {
  password: string;
  entropyBits: number;
} {
  const length = opts.length ?? 20;
  if (length < 8 || length > 128) throw new Error("Length must be 8-128");

  const useAmbiguous = !opts.excludeAmbiguous;
  const classes: string[] = [];
  if (opts.uppercase !== false) classes.push(useAmbiguous ? UPPER_FULL : UPPER);
  if (opts.lowercase !== false) classes.push(useAmbiguous ? LOWER_FULL : LOWER);
  if (opts.digits !== false) classes.push(useAmbiguous ? DIGITS_FULL : DIGITS);
  if (opts.symbols) classes.push(SYMBOLS);

  if (classes.length === 0) throw new Error("At least one character class required");

  const pool = classes.join("");
  const chars: string[] = [];

  for (const cls of classes) {
    chars.push(cls[secureRandomIndex(cls.length)]);
  }

  while (chars.length < length) {
    chars.push(pool[secureRandomIndex(pool.length)]);
  }

  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  const entropyBits = Math.floor(length * Math.log2(pool.length));
  return { password: chars.join(""), entropyBits };
}

interface PassphraseOptions {
  wordCount?: number;
  separator?: "hyphen" | "space" | "period" | "none";
  capitalize?: boolean;
}

const SEPARATORS: Record<string, string> = {
  hyphen: "-",
  space: " ",
  period: ".",
  none: "",
};

export function generatePassphrase(opts: PassphraseOptions = {}): {
  password: string;
  entropyBits: number;
} {
  const wordCount = opts.wordCount ?? 4;
  if (wordCount < 3 || wordCount > 10) throw new Error("Word count must be 3-10");

  const sep = SEPARATORS[opts.separator ?? "hyphen"];
  const words: string[] = [];

  for (let i = 0; i < wordCount; i++) {
    let word = EFF_WORDLIST[secureRandomIndex(EFF_WORDLIST.length)];
    if (opts.capitalize) word = word[0].toUpperCase() + word.slice(1);
    words.push(word);
  }

  const entropyBits = Math.floor(wordCount * Math.log2(EFF_WORDLIST.length));
  return { password: words.join(sep), entropyBits };
}
```

- [ ] **Step 3: Bundle the EFF wordlist**

Create `packages/crypto/src/wordlist.ts` containing the EFF large wordlist (~7,776 words) as a string array:

```typescript
export const EFF_WORDLIST: readonly string[] = [
  "abacus", "abdomen", "abdominal", /* ... full list ... */
];
```

Source the list from the EFF diceware page. The file will be ~40KB.

- [ ] **Step 4: Export and commit**

Add `"./password-generator": "./src/password-generator.ts"` to `packages/crypto/package.json` exports. Add re-export to `packages/crypto/src/index.ts`.

Run: `pnpm typecheck && pnpm test`

```bash
git add packages/crypto/
git commit -m "feat(crypto): add password generator with random and passphrase modes"
```

---

### Task 6: Create `@shardpass/autofill` package

**Files:**
- Create: `packages/autofill/package.json`
- Create: `packages/autofill/src/index.ts`
- Create: `packages/autofill/src/detect-login-fields.ts`
- Create: `packages/autofill/src/domain-match.ts`
- Create: `packages/autofill/src/fill-login-fields.ts`
- Create: `packages/autofill/test/detect-login-fields.test.ts`
- Create: `packages/autofill/test/domain-match.test.ts`
- Create: `packages/autofill/test/fill-login-fields.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no Chrome API dependency)
- Produces: `detectLoginFields(root: Document | ShadowRoot): LoginFieldSet[]`, `matchDomain(domain: string, urls: string[]): boolean`, `fillLoginFields(fieldSet: LoginFieldSet, username: string, password: string): void`

`LoginFieldSet` type: `{ usernameField: HTMLInputElement | null, passwordField: HTMLInputElement, form: HTMLFormElement | null }`

- [ ] **Step 1: Create package scaffolding**

`packages/autofill/package.json`:

```json
{
  "name": "@shardpass/autofill",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {}
}
```

Add `"@shardpass/autofill": "workspace:*"` to `apps/extension/package.json` dependencies.

- [ ] **Step 2: Write failing tests for domain matching**

Create `packages/autofill/test/domain-match.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { matchDomain } from "../src/domain-match";

describe("matchDomain", () => {
  it("matches exact domain", () => {
    expect(matchDomain("github.com", ["github.com"])).toBe(true);
  });

  it("matches subdomain against registered domain", () => {
    expect(matchDomain("login.github.com", ["github.com"])).toBe(true);
  });

  it("rejects non-matching domain", () => {
    expect(matchDomain("evil.com", ["github.com"])).toBe(false);
  });

  it("matches URL with protocol stripped", () => {
    expect(matchDomain("github.com", ["https://github.com/login"])).toBe(true);
  });

  it("handles www prefix", () => {
    expect(matchDomain("www.github.com", ["github.com"])).toBe(true);
  });

  it("rejects partial domain match (no substring)", () => {
    expect(matchDomain("notgithub.com", ["github.com"])).toBe(false);
  });
});
```

- [ ] **Step 3: Implement domain matching**

Create `packages/autofill/src/domain-match.ts`:

```typescript
function extractDomain(urlOrDomain: string): string {
  let d = urlOrDomain.trim().toLowerCase();
  const protoIdx = d.indexOf("://");
  if (protoIdx !== -1) d = d.slice(protoIdx + 3);
  const pathIdx = d.indexOf("/");
  if (pathIdx !== -1) d = d.slice(0, pathIdx);
  const portIdx = d.indexOf(":");
  if (portIdx !== -1) d = d.slice(0, portIdx);
  if (d.startsWith("www.")) d = d.slice(4);
  return d;
}

export function matchDomain(pageDomain: string, urls: readonly string[]): boolean {
  const page = extractDomain(pageDomain);
  return urls.some((url) => {
    const target = extractDomain(url);
    return page === target || page.endsWith("." + target);
  });
}
```

- [ ] **Step 4: Write failing tests for login field detection**

Create `packages/autofill/test/detect-login-fields.test.ts` (using `jsdom` — this is a `*.dom.test.ts` file):

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { detectLoginFields } from "../src/detect-login-fields";

describe("detectLoginFields", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("detects a standard login form", () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="username" />
        <input type="password" name="password" />
      </form>
    `;
    const results = detectLoginFields(document);
    expect(results).toHaveLength(1);
    expect(results[0].usernameField?.name).toBe("username");
    expect(results[0].passwordField.name).toBe("password");
  });

  it("detects password field without username", () => {
    document.body.innerHTML = `<input type="password" name="pwd" />`;
    const results = detectLoginFields(document);
    expect(results).toHaveLength(1);
    expect(results[0].usernameField).toBeNull();
  });

  it("detects text input as username by name heuristic", () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="login_email" />
        <input type="password" name="pwd" />
      </form>
    `;
    const results = detectLoginFields(document);
    expect(results[0].usernameField?.name).toBe("login_email");
  });

  it("returns empty for no password fields", () => {
    document.body.innerHTML = `<input type="text" name="search" />`;
    expect(detectLoginFields(document)).toHaveLength(0);
  });
});
```

Rename to `detect-login-fields.dom.test.ts` for jsdom environment.

- [ ] **Step 5: Implement login field detection**

Create `packages/autofill/src/detect-login-fields.ts`:

```typescript
export interface LoginFieldSet {
  usernameField: HTMLInputElement | null;
  passwordField: HTMLInputElement;
  form: HTMLFormElement | null;
}

const USERNAME_PATTERN =
  /user|email|login|account|phone|identifier|uid|uname/i;

function isUsernameCandidate(input: HTMLInputElement): boolean {
  if (input.type === "email") return true;
  if (input.type !== "text") return false;
  const haystack = [input.name, input.id, input.placeholder, input.autocomplete, input.getAttribute("aria-label") ?? ""].join(" ");
  return USERNAME_PATTERN.test(haystack);
}

function findUsernameField(passwordField: HTMLInputElement): HTMLInputElement | null {
  const form = passwordField.closest("form");
  const container = form ?? passwordField.parentElement ?? document;
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>("input"));
  const pwIdx = inputs.indexOf(passwordField);

  for (let i = pwIdx - 1; i >= 0; i--) {
    if (isUsernameCandidate(inputs[i]) && inputs[i].offsetParent !== null) {
      return inputs[i];
    }
  }

  for (const input of inputs) {
    if (input !== passwordField && isUsernameCandidate(input) && input.offsetParent !== null) {
      return input;
    }
  }

  return null;
}

export function detectLoginFields(root: Document | ShadowRoot): LoginFieldSet[] {
  const passwordFields = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  );

  return passwordFields.map((passwordField) => ({
    usernameField: findUsernameField(passwordField),
    passwordField,
    form: passwordField.closest("form"),
  }));
}
```

- [ ] **Step 6: Implement `fillLoginFields`**

Create `packages/autofill/src/fill-login-fields.ts`:

```typescript
import type { LoginFieldSet } from "./detect-login-fields";

function setNativeValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function fillLoginFields(
  fieldSet: LoginFieldSet,
  username: string,
  password: string,
): void {
  if (fieldSet.usernameField && username) {
    setNativeValue(fieldSet.usernameField, username);
  }
  setNativeValue(fieldSet.passwordField, password);
}
```

- [ ] **Step 7: Wire up `index.ts`, run tests, commit**

```typescript
export { detectLoginFields } from "./detect-login-fields";
export type { LoginFieldSet } from "./detect-login-fields";
export { matchDomain } from "./domain-match";
export { fillLoginFields } from "./fill-login-fields";
```

Run: `pnpm install && pnpm typecheck && pnpm test`

```bash
git add packages/autofill/ apps/extension/package.json pnpm-lock.yaml
git commit -m "feat(autofill): add login field detection, domain matching, and fill logic"
```

---

### Task 7: Background services — item CRUD, login fill, password gen

**Files:**
- Create: `apps/extension/src/background/item/item-service.ts`
- Create: `apps/extension/src/background/login/login-fill-service.ts`
- Create: `apps/extension/src/background/password/password-gen-service.ts`
- Modify: `apps/extension/src/background/main.ts` — wire new services
- Modify: `apps/extension/src/background/router.ts` — add new message routes
- Modify: `apps/extension/src/platform/extension-platform.ts` — add new platform interfaces
- Create: `apps/extension/test/background/item-service.test.ts`
- Create: `apps/extension/test/background/login-fill-service.test.ts`
- Create: `apps/extension/test/background/password-gen-service.test.ts`

**Interfaces:**
- Consumes: `VaultRepository` from `@shardpass/storage`, `VaultItemSchema`/`VaultItemKind` from `@shardpass/domain`, message schemas from `@shardpass/messaging`, `generateRandomPassword`/`generatePassphrase` from `@shardpass/crypto/password-generator`, `matchDomain` from `@shardpass/autofill`
- Produces: `ItemService` (handles `item.query`, `item.get`, `item.create`, `item.update`, `item.delete`), `LoginFillService` (handles `login.fillSuggestions`, `login.fillSelect`, `login.fillConfirm`, `login.fillCancel`, `login.saveOffer`), `PasswordGenService` (handles `password.generate`)

- [ ] **Step 1: Write failing test for `ItemService`**

```typescript
import { describe, expect, it, beforeEach } from "vitest";
// Use @shardpass/testing fakes for storage
import { FakeExtensionPlatform } from "@shardpass/testing";

describe("ItemService", () => {
  it("creates a login item and retrieves it", async () => {
    // Setup: unlocked vault with ItemService wired
    // Act: send item.create with valid login payload
    // Assert: item.get returns same item
  });

  it("queries items filtered by kind", async () => {
    // Create mix of OTP + login items
    // Query with itemKind: "login"
    // Assert only logins returned
  });

  it("rejects invalid item schema", async () => {
    // Send item.create with malformed payload
    // Assert error response
  });
});
```

- [ ] **Step 2: Implement `ItemService`**

Create `apps/extension/src/background/item/item-service.ts`:

```typescript
import type { VaultRepository } from "@shardpass/storage";
import { VaultItemSchema } from "@shardpass/domain";
import type { VaultItem, VaultItemKind } from "@shardpass/domain";

export class ItemService {
  constructor(private readonly repo: VaultRepository) {}

  async query(opts: { itemKind?: VaultItemKind; folderId?: string; search?: string; favoritesOnly?: boolean }): Promise<VaultItem[]> {
    let items = await this.repo.listItems();
    if (opts.itemKind) items = items.filter((i) => i.kind === opts.itemKind);
    if (opts.folderId) items = items.filter((i) => i.folderId === opts.folderId);
    if (opts.favoritesOnly) items = items.filter((i) => i.favorite);
    if (opts.search) {
      const q = opts.search.toLowerCase();
      items = items.filter((i) => {
        const searchable = [i.kind === "otp" ? i.issuer : "", "name" in i ? (i as { name: string }).name : "", ...i.tags].join(" ").toLowerCase();
        return searchable.includes(q);
      });
    }
    return items;
  }

  async get(itemId: string): Promise<VaultItem> {
    return this.repo.get(itemId);
  }

  async create(rawItem: unknown): Promise<VaultItem> {
    const item = VaultItemSchema.parse(rawItem);
    await this.repo.create(item);
    return item;
  }

  async update(itemId: string, expectedRevision: number, fields: unknown): Promise<VaultItem> {
    return this.repo.update(itemId, expectedRevision, fields);
  }

  async delete(itemId: string): Promise<void> {
    await this.repo.tombstone(itemId);
  }
}
```

- [ ] **Step 3: Implement `LoginFillService`**

Similar to existing `OtpFillService`. Uses `matchDomain` from `@shardpass/autofill` to find matching login items by domain. Returns suggestions (no secrets), then releases credentials on `fillSelect`.

- [ ] **Step 4: Implement `PasswordGenService`**

Thin wrapper calling `generateRandomPassword` or `generatePassphrase` based on `mode`.

- [ ] **Step 5: Wire into `main.ts` and `router.ts`**

Add message routing for `item.*`, `login.fill*`, and `password.*` message kinds. Follow the existing pattern: schema parse → sender authorization → service dispatch.

- [ ] **Step 6: Update platform interfaces**

Add `ItemUiPlatform`, `LoginFillContentPlatform`, `PasswordGenUiPlatform` interfaces to `extension-platform.ts` with typed message senders.

- [ ] **Step 7: Run tests and commit**

Run: `pnpm typecheck && pnpm test`

```bash
git add apps/extension/
git commit -m "feat(extension): add item CRUD, login fill, and password gen services"
```

---

### Task 8: Popup redesign — multi-type item list

**Files:**
- Rewrite: `apps/extension/src/popup/PopupApp.tsx`
- Rewrite: `apps/extension/src/popup/PopupApp.module.css`
- Create: `apps/extension/src/popup/components/PopupHeader.tsx`
- Create: `apps/extension/src/popup/components/FilterTabs.tsx`
- Create: `apps/extension/src/popup/components/PopupItemList.tsx`
- Create: `apps/extension/src/popup/components/PopupOtpRow.tsx`
- Create: `apps/extension/src/popup/components/PopupLoginRow.tsx`
- Create: `apps/extension/src/popup/components/AddItemMenu.tsx`
- Create: `apps/extension/src/popup/hooks/useVaultItems.ts`
- Modify: `apps/extension/popup/index.html` — update title

**Interfaces:**
- Consumes: `ItemRow`, `SearchBar` from `@shardpass/ui`, platform message senders, `VaultItemKind` from `@shardpass/domain`
- Produces: `PopupApp` (redesigned root component)

- [ ] **Step 1: Create `useVaultItems` hook**

```typescript
import { useState, useEffect, useCallback } from "react";
import type { VaultItem, VaultItemKind } from "@shardpass/domain";

export function useVaultItems(platform: OtpUiExtensionPlatform) {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [filter, setFilter] = useState<VaultItemKind | "all">("all");
  const [search, setSearch] = useState("");

  const refresh = useCallback(async () => {
    const result = await platform.sendMessage({
      version: 1,
      kind: "item.query",
      itemKind: filter === "all" ? undefined : filter,
      search: search || undefined,
    });
    setItems(result.items);
  }, [platform, filter, search]);

  useEffect(() => { refresh(); }, [refresh]);

  return { items, filter, setFilter, search, setSearch, refresh };
}
```

- [ ] **Step 2: Build `PopupApp` shell**

```tsx
export function PopupApp({ platform }: { platform: ExtensionPlatform }) {
  const { items, filter, setFilter, search, setSearch } = useVaultItems(platform);
  const [locked, setLocked] = useState(true);

  if (locked) return <VaultAccess platform={platform} onUnlock={() => setLocked(false)} />;

  return (
    <div className={styles.popup}>
      <PopupHeader onLock={() => setLocked(true)} onSettings={openVaultTab} />
      <SearchBar value={search} onChange={setSearch} />
      <FilterTabs active={filter} onChange={setFilter} />
      <PopupItemList items={items} platform={platform} />
      <AddItemMenu platform={platform} />
    </div>
  );
}
```

- [ ] **Step 3: Build `FilterTabs`**

Simple horizontal tab bar: All | Logins | OTP | Notes | Cards | Secrets. Uses `--accent` for active tab underline.

- [ ] **Step 4: Build `PopupItemList`**

Maps items to `ItemRow` components. OTP items show live code + countdown as `rightContent`. Login items show username as subtitle. Notes show first line of content. Cards show masked last 4 digits.

- [ ] **Step 5: Build `AddItemMenu`**

Dropdown button at the bottom. Options: "Login", "OTP", "Note", "Card", "Identity", "Secret". Each opens the vault tab to the appropriate add form.

- [ ] **Step 6: Style the popup at 400×540px**

CSS module with:
```css
.popup {
  width: 400px;
  height: 540px;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  overflow: hidden;
}
```

- [ ] **Step 7: Run tests and commit**

```bash
git add apps/extension/src/popup/ apps/extension/popup/
git commit -m "redesign(popup): multi-type item list with search, filter tabs, compact rows"
```

---

### Task 9: Vault tab redesign — two-panel layout with item details

**Files:**
- Rewrite: `apps/extension/src/vault/VaultApp.tsx`
- Rewrite: `apps/extension/src/vault/VaultApp.module.css`
- Create: `apps/extension/src/vault/components/VaultSidebar.tsx` (rewrite existing)
- Create: `apps/extension/src/vault/components/ItemListPanel.tsx`
- Create: `apps/extension/src/vault/components/ItemDetailPanel.tsx`
- Create: `apps/extension/src/vault/components/detail/LoginDetail.tsx`
- Create: `apps/extension/src/vault/components/detail/OtpDetail.tsx`
- Create: `apps/extension/src/vault/components/detail/NoteDetail.tsx`
- Create: `apps/extension/src/vault/components/detail/CardDetail.tsx`
- Create: `apps/extension/src/vault/components/detail/IdentityDetail.tsx`
- Create: `apps/extension/src/vault/components/detail/SecretDetail.tsx`
- Create: `apps/extension/src/vault/components/forms/LoginForm.tsx`
- Create: `apps/extension/src/vault/components/forms/NoteForm.tsx`
- Create: `apps/extension/src/vault/components/forms/CardForm.tsx`
- Create: `apps/extension/src/vault/components/forms/IdentityForm.tsx`
- Create: `apps/extension/src/vault/components/forms/SecretForm.tsx`
- Modify: existing `apps/extension/src/vault/otp/OtpEditor.tsx` — update styling
- Create: `apps/extension/src/vault/hooks/useVaultState.ts`
- Create: `apps/extension/src/vault/components/PasswordGeneratorDialog.tsx`

**Interfaces:**
- Consumes: `ItemRow`, `CategoryNav`, `SearchBar`, `Button`, `Field` from `@shardpass/ui`, `VaultItem`, `VaultItemKind`, `Folder` from `@shardpass/domain`, platform message senders
- Produces: `VaultApp` (redesigned root), detail views for each item type, edit forms for each item type

- [ ] **Step 1: Create `VaultApp` two-panel shell**

```tsx
export function VaultApp({ platform }: { platform: ExtensionPlatform }) {
  const { items, selectedId, setSelectedId, category, setCategory, search, setSearch, refresh } = useVaultState(platform);
  const selectedItem = items.find((i) => i.id === selectedId);

  return (
    <div className={styles.vault}>
      <div className={styles.sidebar}>
        <VaultSidebar category={category} onCategoryChange={setCategory} itemCounts={countByKind(items)} />
      </div>
      <div className={styles.list}>
        <SearchBar value={search} onChange={setSearch} />
        <ItemListPanel items={items} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      <div className={styles.detail}>
        {selectedItem
          ? <ItemDetailPanel item={selectedItem} platform={platform} onUpdate={refresh} />
          : <EmptyState />}
      </div>
    </div>
  );
}
```

Layout CSS:
```css
.vault {
  display: grid;
  grid-template-columns: 200px 280px 1fr;
  height: 100vh;
  background: var(--bg-primary);
}
.sidebar { border-right: 1px solid var(--border); background: var(--bg-secondary); }
.list { border-right: 1px solid var(--border); overflow-y: auto; }
.detail { overflow-y: auto; padding: 24px; }
```

- [ ] **Step 2: Build `VaultSidebar` with category nav**

Uses `CategoryNav` from `@shardpass/ui`. Categories: All, Logins, OTP, Notes, Cards, Identity, Secrets. Shows item count per category. Folders section below categories. Settings and Ente sync at bottom.

- [ ] **Step 3: Build `ItemListPanel`**

Maps items to `ItemRow` components with kind-appropriate subtitles. Selected item highlighted with `active` prop.

- [ ] **Step 4: Build `ItemDetailPanel` dispatcher**

```tsx
function ItemDetailPanel({ item, platform, onUpdate }: Props) {
  switch (item.kind) {
    case "login": return <LoginDetail item={item} platform={platform} onUpdate={onUpdate} />;
    case "otp": return <OtpDetail item={item} platform={platform} onUpdate={onUpdate} />;
    case "note": return <NoteDetail item={item} platform={platform} onUpdate={onUpdate} />;
    case "card": return <CardDetail item={item} platform={platform} onUpdate={onUpdate} />;
    case "identity": return <IdentityDetail item={item} platform={platform} onUpdate={onUpdate} />;
    case "secret": return <SecretDetail item={item} platform={platform} onUpdate={onUpdate} />;
  }
}
```

- [ ] **Step 5: Build `LoginDetail`**

Shows fields: name, username (copy button), password (reveal/copy), URLs (clickable links), linked OTP (live code if linked), notes. Edit and Delete buttons. Password field uses monospace font with `••••••••` mask and eye icon toggle.

- [ ] **Step 6: Build `NoteDetail`, `CardDetail`, `IdentityDetail`, `SecretDetail`**

Each detail component receives its typed item + platform + onUpdate callback.

`NoteDetail.tsx`:
```tsx
export function NoteDetail({ item, platform, onUpdate }: { item: NoteItem; platform: ExtensionPlatform; onUpdate: () => void }) {
  return (
    <div className={styles.detail}>
      <h2 className={styles.title}>{item.name}</h2>
      <div className={styles.fieldGroup}>
        <label className={styles.label}>Content</label>
        <pre className={styles.content}>{item.content}</pre>
      </div>
      <DetailActions item={item} platform={platform} onUpdate={onUpdate} />
    </div>
  );
}
```

`CardDetail.tsx` — shows `cardholderName`, masked `number` (last 4 visible: `•••• •••• •••• 4242`), `expMonth/expYear` formatted as `MM/YY`, hidden `cvv` and `pin` with reveal toggles, `notes`. Each sensitive field uses a `<RevealField>` wrapper with eye icon toggle and copy button.

`IdentityDetail.tsx` — shows `firstName lastName` as heading, `email` and `phone` with copy buttons, address block (`street`, `city`, `state`, `zip`, `country`) formatted as a mailing address, `notes`.

`SecretDetail.tsx` — shows `secretType` as a `<StatusBadge>`, `value` in a monospace `<RevealField>` (hidden by default), `metadata` as a key-value table (each row: label in `--text-secondary`, value in monospace with copy button), `notes`.

- [ ] **Step 7: Build edit forms for each item type**

Each form uses `Field` from `@shardpass/ui`. `LoginForm` includes inline password generator button opening `PasswordGeneratorDialog`. Forms validate via Zod schema before submitting.

- [ ] **Step 8: Build `PasswordGeneratorDialog`**

Dialog with two tabs: Random and Passphrase. Shows preview of generated password, entropy badge, and Copy + Use buttons. Options match the spec (length slider, character class toggles, word count, separator, capitalize).

- [ ] **Step 9: Update existing OTP components styling**

Update `OtpEditor.tsx`, `OtpVaultView.tsx`, `DeleteOtpDialog.tsx` to use new token variables and remove vermillion references.

- [ ] **Step 10: Run tests and commit**

```bash
git add apps/extension/src/vault/
git commit -m "redesign(vault): two-panel layout with category sidebar, item details, edit forms"
```

---

### Task 10: Content script — login autofill and save prompt

**Files:**
- Create: `apps/extension/src/content/login/login-fill-controller.tsx`
- Create: `apps/extension/src/content/login/LoginPicker.tsx`
- Create: `apps/extension/src/content/login/login-picker.css`
- Create: `apps/extension/src/content/login/save-login-prompt.tsx`
- Modify: `apps/extension/src/content/main.tsx` — instantiate `LoginFillController`
- Modify: `apps/extension/src/content/createPickerHost.tsx` — reuse for login picker
- Modify: `apps/extension/src/content/otp/otp-picker.css` — update to neutral palette
- Create: `apps/extension/test/content/login-fill-controller.test.ts`

**Interfaces:**
- Consumes: `detectLoginFields`, `matchDomain`, `fillLoginFields` from `@shardpass/autofill`, `LoginFillContentPlatform` from platform interfaces, `LoginFillSuggestion` from `@shardpass/messaging`
- Produces: `LoginFillController` (lifecycle: `start()` → detect fields → show chip → fill on select → monitor for save)

- [ ] **Step 1: Create `LoginFillController`**

Follow the same pattern as `OtpFillController`:

```typescript
import { detectLoginFields, fillLoginFields } from "@shardpass/autofill";
import type { LoginFieldSet } from "@shardpass/autofill";

export class LoginFillController {
  private fieldSets: LoginFieldSet[] = [];
  private observer: MutationObserver | null = null;

  constructor(private readonly platform: LoginFillContentPlatform) {}

  start(): void {
    this.scan();
    this.observer = new MutationObserver(() => this.scan());
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  private scan(): void {
    this.fieldSets = detectLoginFields(document);
    for (const fs of this.fieldSets) {
      this.attachChip(fs);
    }
  }

  private attachChip(fieldSet: LoginFieldSet): void {
    const target = fieldSet.usernameField ?? fieldSet.passwordField;
    // Create Shadow DOM host with LoginPicker, same as OTP chip
    // Request suggestions from background via platform.sendMessage
  }

  private async handleSelect(itemId: string, revision: number, fieldSet: LoginFieldSet): Promise<void> {
    const { username, password } = await this.platform.sendMessage({
      version: 1,
      kind: "login.fillSelect",
      itemId,
      expectedRevision: revision,
    });
    fillLoginFields(fieldSet, username, password);
    await this.platform.sendMessage({ version: 1, kind: "login.fillConfirm", itemId });
  }

  dispose(): void {
    this.observer?.disconnect();
  }
}
```

- [ ] **Step 2: Create `LoginPicker` component**

Similar to `OtpPicker` but shows login item names and usernames instead of OTP issuers and codes. Neutral styling matching the new design system.

- [ ] **Step 3: Create save-login prompt**

Listens for form submission events. On submit, captures username + password, sends `login.saveOffer` to background. If background confirms no existing match, shows a small toast/banner at the top of the page asking "Save this login to ShardPass?" with Save and Dismiss buttons.

- [ ] **Step 4: Wire into `main.tsx`**

```typescript
import { LoginFillController } from "./login/login-fill-controller";
import { OtpFillController } from "./otp/otp-fill-controller";

const platform = new ChromePlatform();
const loginController = new LoginFillController(platform);
const otpController = new OtpFillController(platform);

loginController.start();
otpController.start();

window.addEventListener("pagehide", () => {
  loginController.dispose();
  otpController.dispose();
});
```

- [ ] **Step 5: Update OTP picker and chip styling**

Replace vermillion accent with neutral `--border` and `--accent` from the new tokens. Update `otp-picker.css` and `picker.css` accordingly.

- [ ] **Step 6: Run tests and commit**

```bash
git add apps/extension/src/content/
git commit -m "feat(content): add login autofill with field detection, fill, and save prompt"
```

---

### Task 11: Third-party password importers

**Files:**
- Create: `packages/importers/src/bitwarden/index.ts`
- Create: `packages/importers/src/bitwarden/bitwarden-json.ts`
- Create: `packages/importers/src/onepassword/index.ts`
- Create: `packages/importers/src/onepassword/onepassword-csv.ts`
- Create: `packages/importers/src/chrome/index.ts`
- Create: `packages/importers/src/chrome/chrome-csv.ts`
- Create: `packages/importers/src/firefox/index.ts`
- Create: `packages/importers/src/firefox/firefox-csv.ts`
- Create: `packages/importers/src/common/csv-parser.ts`
- Modify: `packages/importers/src/index.ts` — add new exports
- Modify: `packages/importers/package.json` — add new export entries
- Create: `packages/importers/test/bitwarden-json.test.ts`
- Create: `packages/importers/test/chrome-csv.test.ts`
- Create: `packages/importers/test/firefox-csv.test.ts`
- Create: `packages/importers/test/onepassword-csv.test.ts`

**Interfaces:**
- Consumes: `LoginItemSchema`, `NoteItemSchema`, `CardItemSchema`, `IdentityItemSchema` from `@shardpass/domain`
- Produces: `importBitwardenJson(json: string): ImportResult`, `importOnePasswordCsv(csv: string): ImportResult`, `importChromeCsv(csv: string): ImportResult`, `importFirefoxCsv(csv: string): ImportResult`

`ImportResult`: `{ items: VaultItem[]; warnings: string[] }`

- [ ] **Step 1: Write failing tests for Chrome CSV importer**

```typescript
import { describe, expect, it } from "vitest";
import { importChromeCsv } from "../src/chrome/chrome-csv";

describe("importChromeCsv", () => {
  it("parses a standard Chrome password CSV", () => {
    const csv = `name,url,username,password,note
GitHub,https://github.com,user@example.com,hunter2,
AWS Console,https://aws.amazon.com,admin,s3cret,production account`;
    const result = importChromeCsv(csv);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].kind).toBe("login");
    expect(result.items[0].name).toBe("GitHub");
    expect(result.items[0].username).toBe("user@example.com");
    expect(result.items[0].urls).toContain("https://github.com");
  });

  it("skips rows with empty password", () => {
    const csv = `name,url,username,password,note\nEmpty,,user,,`;
    const result = importChromeCsv(csv);
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement CSV parser utility**

Create `packages/importers/src/common/csv-parser.ts`:

```typescript
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = values[i] ?? "";
    }
    return row;
  });

  return { headers, rows };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { current += char; }
    } else {
      if (char === '"') { inQuotes = true; }
      else if (char === ",") { result.push(current); current = ""; }
      else { current += char; }
    }
  }
  result.push(current);
  return result;
}
```

- [ ] **Step 3: Implement Chrome CSV importer**

```typescript
import { parseCsv } from "../common/csv-parser";
import type { VaultItem } from "@shardpass/domain";

interface ImportResult {
  items: VaultItem[];
  warnings: string[];
}

export function importChromeCsv(text: string): ImportResult {
  const { rows } = parseCsv(text);
  const items: VaultItem[] = [];
  const warnings: string[] = [];

  for (const row of rows) {
    const password = row["password"] ?? "";
    if (!password) {
      warnings.push(`Skipped "${row["name"] ?? "unnamed"}": empty password`);
      continue;
    }

    items.push({
      id: crypto.randomUUID(),
      kind: "login",
      schemaVersion: 2,
      revision: 1,
      createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      favorite: false,
      tags: [],
      name: row["name"] || row["url"] || "Imported login",
      username: row["username"] ?? "",
      password,
      urls: row["url"] ? [row["url"]] : [],
      notes: row["note"] ?? "",
    });
  }

  return { items, warnings };
}
```

- [ ] **Step 4: Implement Firefox CSV importer**

Firefox CSV has columns: `url`, `username`, `password`, `httpRealm`, `formActionOrigin`, `guid`, `timeCreated`, `timeLastUsed`, `timePasswordChanged`. Map to `LoginItem`.

- [ ] **Step 5: Implement Bitwarden JSON importer**

Bitwarden JSON export has `{ items: [{ type, name, login, notes, fields, card, identity }] }`. Map `type: 1` → login, `type: 2` → note, `type: 3` → card, `type: 4` → identity.

- [ ] **Step 6: Implement 1Password CSV importer**

1Password CSV export has columns like `Title`, `Username`, `Password`, `URL`, `Notes`, `Type`. Map to appropriate `VaultItem` kinds.

- [ ] **Step 7: Export, run tests, commit**

Update `packages/importers/src/index.ts` and `package.json` exports.

Run: `pnpm typecheck && pnpm test`

```bash
git add packages/importers/
git commit -m "feat(importers): add Chrome, Firefox, Bitwarden, and 1Password importers"
```

---

### Task 12: Vault migration, import UI, and final integration

**Files:**
- Modify: `apps/extension/src/vault-access/VaultAccess.tsx` — update styling to new tokens
- Create: `apps/extension/src/vault/import/ImportDialog.tsx` — extended import UI supporting new formats
- Modify: `apps/extension/src/vault/settings/BackupView.tsx` — update export format to v2
- Modify: `apps/extension/src/background/vault/vault-service.ts` — add migration on unlock
- Modify: `apps/extension/src/manifest.ts` — add `clipboardRead`, `clipboardWrite` permissions if not present
- Modify: `apps/extension/src/background/main.ts` — ensure all services initialized

**Interfaces:**
- Consumes: all prior tasks
- Produces: working end-to-end flow: unlock vault → migrate → browse all item types → add/edit/delete → autofill logins → import from third parties → export encrypted backup

- [ ] **Step 1: Add vault migration logic**

In `apps/extension/src/background/vault/vault-service.ts`, after vault unlock:

```typescript
async unlock(password: string): Promise<void> {
  await this.repo.unlock(password);
  await this.migrateIfNeeded();
}

private async migrateIfNeeded(): Promise<void> {
  const generation = await this.repo.currentGeneration();
  if (generation.schemaVersion < 2) {
    // All existing items are kind: "otp" — they're already valid under the new union
    // Just update the generation metadata
    await this.repo.upgradeSchemaVersion(2);
  }
}
```

- [ ] **Step 2: Update `BackupView` for v2 export format**

Add `version: 2` to the export envelope. The encrypted blob already contains the full vault — just the metadata wrapper changes.

- [ ] **Step 3: Build extended `ImportDialog`**

New import dialog with source selector:
- Existing: QR Code, otpauth:// URI, ShardPass Backup
- New: Chrome CSV, Firefox CSV, Bitwarden JSON, 1Password CSV

Each source shows a brief instruction (e.g., "Export from chrome://password-manager/settings → Download file") and a file picker. After parsing, show a preview table of items to import with checkboxes. Import button calls `item.create` for each selected item.

- [ ] **Step 4: Update `VaultAccess` styling**

Replace vermillion accent references with new `--accent` tokens. Update font to system sans-serif. Ensure light/dark mode works on the setup and unlock screens.

- [ ] **Step 5: End-to-end smoke test**

Build the extension: `pnpm build`

Manual verification checklist:
1. Load extension in Chrome → setup screen shows with new styling
2. Create vault → unlock → empty state shows categories
3. Add a login item → appears in Logins category and popup
4. Add an OTP item → shows live code in popup
5. Add a note, card, identity, secret → each appears in correct category
6. Search filters items across all types
7. Edit and delete items work
8. Import Chrome CSV → logins appear
9. Export encrypted backup → re-import on fresh vault → all items present
10. Visit a login page → autofill chip appears → fill works
11. Light/dark mode toggle works
12. Ente sync still works for OTP items only

- [ ] **Step 6: Run full test suite and commit**

```bash
pnpm typecheck && pnpm test && pnpm build
git add .
git commit -m "feat: complete ShardPass password manager with vault migration and import UI"
```

---

## Task Dependency Graph

```
Task 1 (domain schemas)
  ├→ Task 2 (storage widening)
  ├→ Task 3 (messaging)
  └→ Task 4 (UI redesign) ─── standalone, no domain dependency
       │
Task 5 (password gen) ─── depends on nothing
Task 6 (autofill pkg) ─── depends on nothing
       │
Task 7 (background services) ← depends on Tasks 1, 2, 3, 5, 6
       │
Task 8 (popup redesign) ← depends on Tasks 4, 7
Task 9 (vault tab redesign) ← depends on Tasks 4, 7
Task 10 (content script) ← depends on Tasks 6, 7
Task 11 (importers) ← depends on Task 1
       │
Task 12 (migration + integration) ← depends on all above
```

Tasks 1, 4, 5, 6 can run in parallel. Tasks 2, 3, 11 depend only on Task 1. Tasks 8, 9, 10 depend on Task 7. Task 12 is the integration task.
