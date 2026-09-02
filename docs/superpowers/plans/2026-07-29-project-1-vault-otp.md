# ShardPass Project 1 Vault and OTP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a versioned encrypted local vault, safe migration from ShardPass 1.2.1, complete TOTP/HOTP/Steam behavior, OTP import/export and autofill, lock/session controls, and an OTP-only Ente Auth adapter.

**Architecture:** The background worker exclusively owns decrypted items and vault keys. A random vault data key is wrapped by an Argon2id-derived key and records are independently protected with XChaCha20-Poly1305 using authenticated metadata. Mutations commit through immutable generations and an atomic root pointer; Ente operates through a narrow `OtpSyncAdapter` that cannot accept non-OTP records.

**Tech Stack:** Project 0 stack plus Zod schemas, audited browser-compatible libsodium wrappers for Argon2id and XChaCha20-Poly1305, an OTP URI/parser library or small standards adapter backed by known-answer tests, jsQR for local QR decoding, and protobuf support limited to Google Authenticator migration imports.

## Global Constraints

- Project 0 must pass before Project 1 begins.
- Do not implement cryptographic primitives manually or claim guaranteed JavaScript memory zeroization.
- Pin and document exact crypto/import dependency versions after browser compatibility and license review.
- The current ShardPass package is a behavioral reference and fixture source; new code must not import its bundles.
- The old `vault` value must remain recoverable until migration write, decrypt, schema validation, and OTP parity verification all succeed.
- Never expose OTP seeds, vault keys, Ente credentials, backup plaintext, or full decrypted records to content scripts.
- Never put secrets in logs, errors, snapshots, accessibility labels, test names, or fixture filenames.
- Project 1 storage accepts only `OtpItem`; unknown and future item kinds fail closed.
- HOTP advances only after a confirmed successful fill reservation and is concurrency-safe.
- Ente Auth remains an OTP-only adapter. It must reject login and unknown entities at compile time and runtime.
- Automatic form submission remains out of scope.
- This directory is not currently a Git repository; skip commit commands until Git is initialized by the owner.

---

## Target file map

```text
packages/domain/src/item-metadata.ts        common item metadata
packages/domain/src/otp-item.ts             strict persisted OTP schema
packages/crypto/src/kdf.ts                  Argon2id derivation and benchmark policy
packages/crypto/src/aead.ts                 XChaCha20-Poly1305 envelopes
packages/crypto/src/key-hierarchy.ts        DEK creation/wrapping/unwrapping
packages/storage/src/vault-format.ts        root/generation/record schemas
packages/storage/src/vault-repository.ts    encrypted record CRUD
packages/storage/src/generation-store.ts    staged generation commits
packages/storage/src/change-journal.ts      encrypted revision/tombstone entries
packages/otp/src/                           Base32, URI, TOTP/HOTP/Steam, reservations
packages/importers/src/                     legacy backup, GA, Aegis, Ente, QR
apps/extension/src/background/vault/        session and vault command services
apps/extension/src/background/ente/         OTP-only authentication/sync adapter
apps/extension/src/content/otp/              field discovery and fill
apps/extension/src/popup/otp/                account list/editor/import UI
apps/extension/src/vault/otp/                full-page OTP list/editor/settings
tests/fixtures/legacy/                       sanitized encrypted artifact fixtures
tests/browser/project1-*.spec.ts             setup, migration, import, fill, Ente
```

## Task 1: Capture authorized legacy behavior as sanitized fixtures

**Files:**

- Create: `docs/architecture/legacy-vault-format.md`
- Create: `tests/fixtures/legacy/fixture-manifest.json`
- Create: `tests/fixtures/legacy/*.json`
- Create: `tests/fixtures/otp/known-answers.json`
- Create: `scripts/capture-legacy-fixtures.mjs`
- Create: `tests/legacy/fixtures.test.ts`

**Interfaces:**

- Produces: Versioned, synthetic fixtures for legacy vault, backup, OTP, settings, and Ente states with provenance and expected results.

- [ ] **Step 1: Define the fixture manifest test**

```ts
it("documents every legacy fixture without plaintext production secrets", async () => {
  const manifest = LegacyFixtureManifestSchema.parse(await loadFixtureManifest());
  expect(manifest.artifactVersion).toBe("1.2.1");
  expect(manifest.fixtures.length).toBeGreaterThanOrEqual(8);
  for (const fixture of manifest.fixtures) {
    expect(fixture.synthetic).toBe(true);
    expect(fixture.expectedOtpAt).toBeDefined();
    expect(
      fixture.sourceFiles.every((path) => path.startsWith("assets/") || path === "manifest.json"),
    ).toBe(true);
  }
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec vitest run tests/legacy/fixtures.test.ts`

Expected: FAIL because fixtures do not exist.

- [ ] **Step 3: Generate synthetic fixtures through authorized local execution**

Create fresh, non-personal secrets and cover:

- Default TOTP/SHA-1/6 digits/30 seconds.
- SHA-256 and SHA-512.
- Eight digits and non-default period.
- HOTP with counter 0 and a later counter.
- Steam.
- Tags/note fields and maximum safe lengths.
- Ente-linked item and pending operations.
- Wrong password, malformed envelope, and tampered ciphertext.
- Existing `type: "shardpass-export"` encrypted backup.

Never capture the user’s real browser profile or account. Store only deterministic synthetic material.

- [ ] **Step 4: Verify fixture expectations independently**

Use published RFC 4226/6238 vectors where applicable. For Steam and artifact-specific formatting, record the legacy artifact’s output at fixed timestamps and mark it as compatibility behavior.

- [ ] **Step 5: Run fixture tests**

Run: `pnpm exec vitest run tests/legacy`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add docs/architecture/legacy-vault-format.md tests/fixtures scripts/capture-legacy-fixtures.mjs tests/legacy
 git commit -m "test: preserve legacy ShardPass compatibility fixtures"
```

## Task 2: Define strict item and vault schemas

**Files:**

- Create: `packages/domain/src/item-metadata.ts`
- Create: `packages/domain/src/otp-item.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `packages/domain/test/otp-item.test.ts`
- Create: `packages/storage/src/vault-format.ts`
- Create: `packages/storage/test/vault-format.test.ts`

**Interfaces:**

- Produces: `ItemMetadataSchema`, `OtpItemSchema`, `VaultItemSchema`, `VaultRootSchema`, `VaultGenerationSchema`, `EncryptedRecordSchema`.

- [ ] **Step 1: Write schema tests**

```ts
it("accepts a normalized OTP item and rejects unknown item kinds", () => {
  expect(OtpItemSchema.parse(validOtpItem()).kind).toBe("otp");
  expect(() => VaultItemSchema.parse({ ...validOtpItem(), kind: "login" })).toThrow();
  expect(() => OtpItemSchema.parse({ ...validOtpItem(), secret: "A".repeat(1025) })).toThrow();
});
```

Test immutable ID, integer revision, ISO timestamps, bounded strings/tags, algorithm/digits/period/counter constraints, and strict unknown-field rejection.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run packages/domain packages/storage/test/vault-format.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement schemas**

```ts
export const OtpItemSchema = ItemMetadataSchema.extend({
  kind: z.literal("otp"),
  schemaVersion: z.literal(1),
  issuer: z.string().trim().max(256),
  label: z.string().trim().min(1).max(256),
  secret: z.string().min(1).max(1024),
  otpType: z.enum(["totp", "hotp", "steam"]),
  algorithm: z.enum(["SHA1", "SHA256", "SHA512"]),
  digits: z.number().int().min(5).max(10),
  period: z.number().int().positive().max(300),
  counter: z.number().int().nonnegative().optional(),
  note: z.string().max(4096).default(""),
  tags: z.array(z.string().trim().min(1).max(64)).max(64),
}).strict();
```

Add a refinement requiring `counter` for HOTP and forbidding it for other types. Store UTC timestamps as RFC 3339 strings.

- [ ] **Step 4: Define immutable storage metadata**

`VaultRoot` identifies active generation, format version, wrapped key descriptor, and previous verified generation. `EncryptedRecord` includes item ID, kind, schema version, revision, nonce, ciphertext, and encoding; associated-data fields remain available in clear only where accepted by the metadata threat model.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run packages/domain packages/storage/test/vault-format.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add packages/domain packages/storage/src/vault-format.ts packages/storage/test/vault-format.test.ts
 git commit -m "feat: define versioned OTP vault schemas"
```

## Task 3: Implement the audited key hierarchy and AEAD envelopes

**Files:**

- Create: `packages/crypto/package.json`
- Create: `packages/crypto/src/random.ts`
- Create: `packages/crypto/src/kdf.ts`
- Create: `packages/crypto/src/aead.ts`
- Create: `packages/crypto/src/key-hierarchy.ts`
- Create: `packages/crypto/src/index.ts`
- Create: `packages/crypto/test/kdf.test.ts`
- Create: `packages/crypto/test/aead.test.ts`
- Create: `packages/crypto/test/key-hierarchy.test.ts`
- Create: `docs/security/cryptographic-format.md`

**Interfaces:**

- Produces:
  - `deriveKeyEncryptionKey(password, params): Promise<Uint8Array>`
  - `encryptEnvelope(key, plaintext, associatedData): Promise<AeadEnvelope>`
  - `decryptEnvelope(key, envelope, associatedData): Promise<Uint8Array>`
  - `createVaultKeyMaterial(password): Promise<WrappedVaultKey>`
  - `unwrapVaultDataKey(password, wrapped): Promise<Uint8Array>`

- [ ] **Step 1: Write known-answer and tamper tests**

Use libsodium-published vectors where available. Test wrong password, modified nonce, modified ciphertext, modified item ID/kind/revision/schema associated data, invalid parameter bounds, and fresh randomness producing distinct envelopes.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run packages/crypto`

Expected: FAIL.

- [ ] **Step 3: Select and pin the reviewed dependency**

Use an audited browser-compatible libsodium distribution only after confirming MV3 CSP/build behavior, WebAssembly requirements, maintainer provenance, license, and exact version. If it requires `'wasm-unsafe-eval'`, add that token only after a test demonstrates necessity and document the change in `docs/security/cryptographic-format.md`; do not use generic `unsafe-eval`.

- [ ] **Step 4: Implement bounded Argon2id parameters**

Persist algorithm ID, salt, memory, iterations, and parallelism. Reject parameters outside documented bounds before allocation. Benchmark candidate defaults on representative desktop Chromium and choose a target unlock latency with a memory floor that does not make the service worker unstable. Record benchmark evidence; never choose parameters solely from the old PBKDF2 configuration.

- [ ] **Step 5: Implement key wrapping and record AEAD**

Use 32-byte random vault keys and fresh 24-byte XChaCha nonces. Canonically encode associated data containing format ID, item ID, kind, schema version, and revision. Never reuse nonce/key pairs.

- [ ] **Step 6: Run crypto tests in Node and built extension context**

Run: `pnpm exec vitest run packages/crypto && pnpm build && pnpm exec playwright test tests/browser/crypto-smoke.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit when Git exists**

```bash
git add packages/crypto docs/security/cryptographic-format.md tests/browser/crypto-smoke.spec.ts package.json pnpm-lock.yaml
 git commit -m "feat: add audited vault key hierarchy"
```

## Task 4: Add generation-based transactional storage

**Files:**

- Create: `packages/storage/src/storage-port.ts`
- Create: `packages/storage/src/generation-store.ts`
- Create: `packages/storage/src/vault-repository.ts`
- Create: `packages/storage/src/change-journal.ts`
- Create: `packages/storage/src/index.ts`
- Create: `packages/testing/src/fake-storage-port.ts`
- Create: `packages/storage/test/generation-store.test.ts`
- Create: `packages/storage/test/vault-repository.test.ts`
- Create: `packages/storage/test/interruption.test.ts`

**Interfaces:**

- Produces:
  - `StoragePort.get/set/remove`
  - `GenerationStore.stage/verify/activate/rollback`
  - `VaultRepository.listMetadata/get/create/update/tombstone`
  - `ChangeJournal.append/listAfter`.

- [ ] **Step 1: Write interruption tests**

Inject failure after each storage write. Assert every read sees either the old verified generation or the complete new generation, never a mixed state. Assert activation is one root-pointer write and rollback retains the previous verified root.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run packages/storage`

Expected: FAIL.

- [ ] **Step 3: Implement immutable generations**

Store namespaced generation objects, a verification manifest containing record hashes/count, and a small active root. Stage records, read/decrypt/validate every staged record, write verification, then switch the active root. Garbage collection may remove generations only after a later successful start confirms the active root.

- [ ] **Step 4: Implement revision-safe CRUD**

Create requires absent ID; update requires expected current revision and increments exactly once; deletion creates a tombstone. Return `REVISION_CONFLICT` instead of overwriting stale edits.

- [ ] **Step 5: Run storage tests**

Run: `pnpm exec vitest run packages/storage`

Expected: PASS including every injected interruption point.

- [ ] **Step 6: Commit when Git exists**

```bash
git add packages/storage packages/testing/src/fake-storage-port.ts
 git commit -m "feat: add transactional encrypted vault storage"
```

## Task 5: Implement background-owned setup, unlock, lock, and password rotation

**Files:**

- Create: `apps/extension/src/background/vault/session-service.ts`
- Create: `apps/extension/src/background/vault/vault-service.ts`
- Create: `apps/extension/src/background/vault/settings-service.ts`
- Create: `packages/messaging/src/vault.ts`
- Modify: `apps/extension/src/background/router.ts`
- Modify: `apps/extension/src/manifest.ts`
- Create: `apps/extension/test/background/session-service.test.ts`
- Create: `apps/extension/test/background/vault-service.test.ts`
- Create: `tests/browser/project1-setup-unlock.spec.ts`

**Interfaces:**

- Produces versioned commands: `vault.getState`, `vault.setup`, `vault.unlock`, `vault.lock`, `vault.changePassword`, `vault.updateLockSettings`.

- [ ] **Step 1: Write session lifecycle tests**

Test minimum 12-character password, setup only on empty storage, wrong-password throttling, explicit lock, inactivity alarm, screen-lock event, service-worker restart, active-root change, password rotation without record re-encryption, and trusted-context session-storage access.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run apps/extension/test/background/session-service.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement bounded session state**

Keep decrypted vault data key in background memory. If a wrapped session key is retained in `chrome.storage.session` for MV3 restarts, protect it with a random session wrapping key unavailable to content contexts, call `setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`, and document residual profile-compromise risk. Clear all session material on lock.

- [ ] **Step 4: Add alarms and idle permissions only now**

Add `alarms` and `idle` to the manifest with tests and rationale. Default to 15-minute auto-lock and lock on system `locked`; offer off/5/15/30/60-minute choices only through validated settings.

- [ ] **Step 5: Implement password rotation**

Derive a new KEK and rewrap the same random DEK after verifying the old password and new-password policy. Do not decrypt/re-encrypt every item. Retain the prior wrapped header until the new header verifies.

- [ ] **Step 6: Run tests**

Run: `pnpm exec vitest run apps/extension/test/background && pnpm exec playwright test tests/browser/project1-setup-unlock.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit when Git exists**

```bash
git add apps/extension/src/background/vault apps/extension/src/background/router.ts apps/extension/src/manifest.ts packages/messaging/src/vault.ts apps/extension/test/background tests/browser/project1-setup-unlock.spec.ts
 git commit -m "feat: add secure vault session lifecycle"
```

## Task 6: Implement standards-backed OTP primitives

**Files:**

- Create: `packages/otp/package.json`
- Create: `packages/otp/src/base32.ts`
- Create: `packages/otp/src/uri.ts`
- Create: `packages/otp/src/hotp.ts`
- Create: `packages/otp/src/totp.ts`
- Create: `packages/otp/src/steam.ts`
- Create: `packages/otp/src/reservation.ts`
- Create: `packages/otp/src/index.ts`
- Create: `packages/otp/test/rfc4226.test.ts`
- Create: `packages/otp/test/rfc6238.test.ts`
- Create: `packages/otp/test/steam.test.ts`
- Create: `packages/otp/test/uri.test.ts`
- Create: `packages/otp/test/reservation.test.ts`

**Interfaces:**

- Produces: `parseOtpAuthUri`, `formatOtpAuthUri`, `generateOtp(item, now)`, `reserveHotp`, `commitHotpReservation`, `cancelHotpReservation`.

- [ ] **Step 1: Write RFC and legacy parity tests**

Use all RFC 4226 HOTP counters and RFC 6238 SHA-1/SHA-256/SHA-512 timestamps. Add Steam compatibility fixtures, Base32 whitespace/padding/lowercase normalization, URI encoding, issuer precedence, custom digits/period, and invalid-input limits.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run packages/otp`

Expected: FAIL.

- [ ] **Step 3: Implement Web Crypto HMAC adapters**

Do not implement hash functions manually. Convert counters to exactly eight-byte big-endian buffers, apply dynamic truncation, and format digits without numeric precision loss.

- [ ] **Step 4: Implement HOTP reservations**

A reservation binds item ID, current revision, counter, tab/frame/document, and short expiry. Committing performs a revision-checked counter increment once; duplicate commits are idempotent and failed fills cancel without increment.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run packages/otp`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add packages/otp
 git commit -m "feat: implement tested OTP algorithms"
```

## Task 7: Implement lossless legacy migration

**Files:**

- Create: `packages/importers/src/legacy-v1/crypto.ts`
- Create: `packages/importers/src/legacy-v1/schema.ts`
- Create: `packages/importers/src/legacy-v1/migrate.ts`
- Create: `packages/importers/test/legacy-v1.test.ts`
- Create: `apps/extension/src/background/vault/migration-service.ts`
- Create: `packages/messaging/src/migration.ts`
- Create: `apps/extension/test/background/migration-service.test.ts`
- Create: `tests/browser/project1-migration.spec.ts`

**Interfaces:**

- Produces: `inspectLegacyVault`, `decryptLegacyVault`, `mapLegacyAccount`, `MigrationService.start/verify/activate/retry`.

- [ ] **Step 1: Write fixture-driven migration tests**

Assert every field maps losslessly, settings migrate, Ente state is preserved through its dedicated store, malformed entries are reported without destructive writes, reruns are idempotent, and wrong password does not reveal corruption details.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run packages/importers/test/legacy-v1.test.ts apps/extension/test/background/migration-service.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the legacy PBKDF2/AES-GCM reader only**

Support the observed legacy envelope: PBKDF2-HMAC-SHA-256, 600,000 iterations, 16-byte salt, AES-256-GCM, 12-byte IV. This code is import-only and may not generate new vaults or backups.

- [ ] **Step 4: Implement write-new/verify/activate**

Map to new items, stage a generation, decrypt it through the new repository, compare item counts/fields, regenerate expected codes at fixed fixture times, then activate. Preserve legacy keys and prior root until the next verified startup; expose retry/export guidance on failure.

- [ ] **Step 5: Run migration tests**

Run: `pnpm exec vitest run packages/importers apps/extension/test/background/migration-service.test.ts && pnpm exec playwright test tests/browser/project1-migration.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add packages/importers/src/legacy-v1 packages/importers/test/legacy-v1.test.ts apps/extension/src/background/vault/migration-service.ts packages/messaging/src/migration.ts apps/extension/test/background/migration-service.test.ts tests/browser/project1-migration.spec.ts
 git commit -m "feat: migrate legacy ShardPass vaults safely"
```

## Task 8: Add OTP CRUD, list projections, and themed UI

**Files:**

- Create: `packages/messaging/src/otp.ts`
- Create: `apps/extension/src/background/otp/otp-service.ts`
- Create: `apps/extension/src/popup/otp/OtpList.tsx`
- Create: `apps/extension/src/popup/otp/OtpRow.tsx`
- Create: `apps/extension/src/popup/otp/OtpEditor.tsx`
- Create: `apps/extension/src/popup/otp/OtpCountdown.tsx`
- Create: `apps/extension/src/vault/otp/OtpVaultView.tsx`
- Create: `apps/extension/test/background/otp-service.test.ts`
- Create: `apps/extension/test/popup/OtpList.test.tsx`
- Create: `tests/browser/project1-otp-crud.spec.ts`

**Interfaces:**

- Produces: `otp.list`, `otp.getEditor`, `otp.create`, `otp.update`, `otp.delete`, `otp.getCode`, `otp.copyCode` with UI-safe projections.

- [ ] **Step 1: Write service and UI tests**

Assert list projections omit seeds, code responses are one-item/short-lived, locked state returns no account metadata, search covers issuer/label/tags, revision conflicts do not overwrite, countdown updates at boundaries, and copy feedback never announces the code.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run apps/extension/test/background/otp-service.test.ts apps/extension/test/popup/OtpList.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement services and UI**

Preserve compact account rows, issuer marker, mono tabular codes, countdown ring, urgency state, coral selection rail, and sharp geometry. Add responsive full-page editing while keeping secrets concealed by default.

- [ ] **Step 4: Add clipboard permission through user gesture**

Prefer `navigator.clipboard.writeText` from an explicit UI action. Add manifest clipboard permission only if browser tests prove it is required. Add a configurable short clear timer when the extension can verify it still owns the clipboard value.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run apps/extension/test/background/otp-service.test.ts apps/extension/test/popup/OtpList.test.tsx && pnpm exec playwright test tests/browser/project1-otp-crud.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add packages/messaging/src/otp.ts apps/extension/src/background/otp apps/extension/src/popup/otp apps/extension/src/vault/otp apps/extension/test tests/browser/project1-otp-crud.spec.ts
 git commit -m "feat: add encrypted OTP vault workflows"
```

## Task 9: Add QR and supported OTP imports

**Files:**

- Create: `packages/importers/src/otpauth.ts`
- Create: `packages/importers/src/google-migration.ts`
- Create: `packages/importers/src/aegis.ts`
- Create: `packages/importers/src/ente-export.ts`
- Create: `packages/importers/src/qr.ts`
- Create: `packages/importers/src/import-preview.ts`
- Create: `packages/importers/test/*.test.ts`
- Create: `apps/extension/src/background/otp/import-service.ts`
- Create: `apps/extension/src/vault/otp/OtpImportView.tsx`
- Create: `tests/browser/project1-otp-import.spec.ts`

**Interfaces:**

- Produces: `parseOtpImport(input): ImportPreview`, with explicit accepted/rejected/duplicate rows and no persistence until confirmation.

- [ ] **Step 1: Write bounded parser tests**

Cover `otpauth://`, multiline text, Google migration protobuf batches, supported Aegis JSON, supported Ente export, invalid Base32, duplicate detection, oversized files, excessive QR pixels, too many entries, malformed protobuf, and unsupported algorithms.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run packages/importers`

Expected: FAIL for new parsers.

- [ ] **Step 3: Implement local-only decoding**

Decode files, pasted images, and QR pixels locally. Cap encoded input, image dimensions/pixels, item count, text lengths, and migration batch count before expensive work. Never upload an image or import body.

- [ ] **Step 4: Build preview/confirm UI**

Show accepted, duplicate, unsupported, and malformed counts plus row-level safe messages. Require explicit confirmation before a single transaction creates accepted items.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run packages/importers && pnpm exec playwright test tests/browser/project1-otp-import.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add packages/importers apps/extension/src/background/otp/import-service.ts apps/extension/src/vault/otp/OtpImportView.tsx tests/browser/project1-otp-import.spec.ts package.json pnpm-lock.yaml
 git commit -m "feat: import OTP accounts safely"
```

## Task 10: Add encrypted backup export and legacy backup import

**Files:**

- Create: `packages/importers/src/backup/v2-format.ts`
- Create: `packages/importers/src/backup/export.ts`
- Create: `packages/importers/src/backup/import.ts`
- Create: `packages/importers/test/backup.test.ts`
- Create: `apps/extension/src/background/vault/backup-service.ts`
- Create: `apps/extension/src/vault/settings/BackupView.tsx`
- Create: `tests/browser/project1-backup.spec.ts`
- Modify: `docs/security/cryptographic-format.md`

**Interfaces:**

- Produces: portable password-protected v2 backup plus import-only legacy backup compatibility.

- [ ] **Step 1: Write round-trip, tamper, and compatibility tests**

Test every Project 1 field, settings, tombstones/journal where intentionally included, wrong password, corrupted authenticated metadata, unsupported versions, excessive KDF parameters, duplicate merge preview, and legacy `shardpass-export` fixture import.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run packages/importers/test/backup.test.ts`

Expected: FAIL.

- [ ] **Step 3: Define and implement the v2 envelope**

Document magic/type, format version, KDF and bounds, cipher, nonce, salt, canonical authenticated header, schema version, and item counts. Backups use a separate export password and fresh key; never serialize the in-memory DEK or session material.

- [ ] **Step 4: Require step-up authentication and safe download UI**

Require current master-password verification immediately before export. State that exported data is portable and sensitive. Verify the generated blob can be re-imported before offering download.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run packages/importers/test/backup.test.ts && pnpm exec playwright test tests/browser/project1-backup.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add packages/importers/src/backup packages/importers/test/backup.test.ts apps/extension/src/background/vault/backup-service.ts apps/extension/src/vault/settings/BackupView.tsx tests/browser/project1-backup.spec.ts docs/security/cryptographic-format.md
 git commit -m "feat: add portable encrypted backups"
```

## Task 11: Add safe in-page OTP detection and fill

**Files:**

- Create: `apps/extension/src/content/otp/discoverOtpFields.ts`
- Create: `apps/extension/src/content/otp/fillOtpField.ts`
- Create: `apps/extension/src/content/otp/OtpPicker.tsx`
- Create: `apps/extension/src/background/otp/otp-fill-service.ts`
- Modify: `packages/messaging/src/otp.ts`
- Create: `apps/extension/test/content/otp.test.tsx`
- Create: `apps/extension/test/background/otp-fill-service.test.ts`
- Create: `tests/fixtures/sites/otp.html`
- Create: `tests/browser/project1-otp-autofill.spec.ts`

**Interfaces:**

- Produces metadata-only OTP suggestions and one selected code/fill reservation scoped to tab/frame/document.

- [ ] **Step 1: Write discovery and native-setter tests**

Cover `autocomplete=one-time-code`, OTP/2FA/MFA labels, numeric 4–8 digit fields, false positives, hidden/disabled/readonly/offscreen fields, React-controlled input, DOM replacement, and no auto-submit.

- [ ] **Step 2: Write secret-boundary tests**

Assert suggestions omit code and seed; selected release is one document/field, five seconds, single-use; sender is revalidated; HOTP increments only after content reports successful setter/events and duplicate confirmation is idempotent.

- [ ] **Step 3: Verify failure**

Run: `pnpm exec vitest run apps/extension/test/content/otp.test.tsx apps/extension/test/background/otp-fill-service.test.ts`

Expected: FAIL.

- [ ] **Step 4: Implement discovery, picker, and fill**

Reuse the closed Shadow DOM host and shared tokens. Fill through the native prototype setter and dispatch bubbling `input` and `change`. Recheck field visibility, editability, document identity, and origin immediately before writing.

- [ ] **Step 5: Run browser tests**

Run: `pnpm exec playwright test tests/browser/project1-otp-autofill.spec.ts`

Expected: PASS for TOTP and exactly-once HOTP; no form submission occurs.

- [ ] **Step 6: Commit when Git exists**

```bash
git add apps/extension/src/content/otp apps/extension/src/background/otp/otp-fill-service.ts packages/messaging/src/otp.ts apps/extension/test tests/fixtures/sites/otp.html tests/browser/project1-otp-autofill.spec.ts
 git commit -m "feat: add isolated OTP autofill"
```

## Task 12: Rebuild the Ente Auth OTP adapter

**Files:**

- Create: `apps/extension/src/background/ente/otp-sync-adapter.ts`
- Create: `apps/extension/src/background/ente/client.ts`
- Create: `apps/extension/src/background/ente/auth.ts`
- Create: `apps/extension/src/background/ente/crypto.ts`
- Create: `apps/extension/src/background/ente/sync-engine.ts`
- Create: `apps/extension/src/background/ente/schemas.ts`
- Create: `packages/messaging/src/ente.ts`
- Create: `apps/extension/src/vault/settings/EnteSettings.tsx`
- Create: `apps/extension/test/background/ente/*.test.ts`
- Create: `tests/browser/project1-ente.spec.ts`
- Modify: `apps/extension/src/manifest.ts`
- Create: `docs/architecture/ente-otp-boundary.md`

**Interfaces:**

- Produces:

```ts
export interface OtpSyncAdapter {
  connect(input: EnteConnectionInput): Promise<EnteConnectionState>;
  disconnect(options: DisconnectOptions): Promise<void>;
  pull(cursor?: string): Promise<OtpRemoteChangePage>;
  push(operations: readonly OtpSyncOperation[]): Promise<OtpPushResult>;
}
```

- [ ] **Step 1: Write compile-time/runtime boundary tests**

Use `@ts-expect-error` assertions showing `LoginItem` cannot enter `OtpSyncOperation`. Runtime-parse every remote entity and reject non-`otpauth` payloads, unknown fields, invalid URLs, oversized ciphertext, and unsupported entity versions.

- [ ] **Step 2: Write protocol fixture tests**

Build synthetic recorded fixtures for SRP login, optional 2FA, key material, create/update/delete, cursor pull, tombstones, custom server URL, network failures, and simultaneous changes. Do not use real credentials or live account mutation in routine tests.

- [ ] **Step 3: Verify failure**

Run: `pnpm exec vitest run apps/extension/test/background/ente`

Expected: FAIL.

- [ ] **Step 4: Implement from documented/current open-source Ente behavior**

Keep authentication, HTTP transport, cryptography, and sync merge in separate files. Use audited libsodium operations and a reviewed SRP implementation. Treat undocumented endpoints and cursor/conflict behavior as compatibility dependencies in documentation, not guaranteed public APIs.

- [ ] **Step 5: Add network permission narrowly**

Add `https://api.ente.io/*` host permission only with manifest tests. For custom servers, require explicit normalized HTTPS origin and user confirmation; request optional host permission at connection time rather than granting arbitrary hosts permanently. Permit HTTP only for explicit localhost development with a severe warning if product policy allows it.

- [ ] **Step 6: Implement transparent sync states**

Show disconnected, authenticating, pending 2FA, pending operations, syncing, synced, conflict, and error states. Use per-item revisions/tombstones. If deterministic resolution is impossible, create an explicit conflict state instead of silently overwriting.

- [ ] **Step 7: Run tests**

Run: `pnpm exec vitest run apps/extension/test/background/ente && pnpm exec playwright test tests/browser/project1-ente.spec.ts`

Expected: PASS using synthetic protocol fixtures.

- [ ] **Step 8: Commit when Git exists**

```bash
git add apps/extension/src/background/ente packages/messaging/src/ente.ts apps/extension/src/vault/settings/EnteSettings.tsx apps/extension/test/background/ente tests/browser/project1-ente.spec.ts apps/extension/src/manifest.ts docs/architecture/ente-otp-boundary.md package.json pnpm-lock.yaml
 git commit -m "feat: restore OTP-only Ente synchronization"
```

## Task 13: Establish the Project 1 release gate

**Files:**

- Create: `scripts/scan-secrets.mjs`
- Create: `tests/security/project1-boundaries.test.ts`
- Modify: `docs/security/threat-model.md`
- Modify: `docs/security/invariants.md`
- Modify: `docs/security/release-checklist.md`
- Modify: `package.json`

**Interfaces:**

- Produces: `pnpm verify:project1`.

- [ ] **Step 1: Add boundary assertions**

Test that content messages cannot request seeds, list full records, export, migrate, access Ente credentials, change password, or invoke key operations. Test build output and source for forbidden logging of secret-shaped fields.

- [ ] **Step 2: Update threat model**

Add stolen encrypted storage, weak password, KDF resource exhaustion, nonce misuse, interrupted writes, rollback, migration corruption, QR bombs, malicious imports, clipboard leakage, HOTP races, Ente server compromise, metadata exposure, and service-worker restart.

- [ ] **Step 3: Add the gate**

```json
{
  "scripts": {
    "verify:project1": "pnpm verify:project0 && pnpm vitest run packages/domain packages/crypto packages/storage packages/otp packages/importers apps/extension/test && pnpm exec playwright test tests/browser/project1-*.spec.ts && node scripts/scan-secrets.mjs && pnpm audit --prod"
  }
}
```

- [ ] **Step 4: Run from a clean installation**

Run: `pnpm install --frozen-lockfile && pnpm verify:project1`

Expected: PASS. Every migration fixture preserves fields and fixed-time codes; tampered storage fails closed; interruption tests retain a verified generation; backups round-trip; HOTP commits exactly once; Ente rejects non-OTP data.

- [ ] **Step 5: Commit when Git exists**

```bash
git add scripts/scan-secrets.mjs tests/security/project1-boundaries.test.ts docs/security package.json
 git commit -m "test: enforce Project 1 security gate"
```

## Project 1 completion evidence

- Existing ShardPass vaults and backups migrate without deleting their source before verification.
- Setup, unlock, lock, password rotation, and interruption recovery pass.
- TOTP, HOTP, Steam, QR, Google migration, supported Aegis/Ente imports, copy, countdown, and fill pass known-answer and browser tests.
- Ente synchronization is visibly stateful and statically/runtime limited to OTP items.
- New encrypted backups are versioned, portable, authenticated, and round-trip complete for Project 1.
- No content or UI projection exposes OTP seeds or bulk decrypted records.
