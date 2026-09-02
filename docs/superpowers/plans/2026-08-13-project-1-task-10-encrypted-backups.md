# Project 1 Task 10 Encrypted Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a portable password-protected ShardPass backup v2 export, import-only compatibility with the authorized legacy `shardpass-export` fixture, a document/session-bound preview-confirm import flow, and a trusted full-vault backup UI.

**Architecture:** A pure backup package defines a canonical bounded JSON envelope and portable plaintext schema, derives a fresh backup-only key through the existing worker-backed Argon2id executor, and encrypts with the existing XChaCha20-Poly1305 adapter using the canonical header as AAD. The background session exclusively snapshots decrypted portable state, verifies the current password immediately before export, owns one-use preview capabilities, reclassifies against the current authenticated generation, and commits confirmed imports as one immutable generation. The vault page performs KDF work through its local trusted worker and handles file selection/download under direct user gestures; backup passwords never enter runtime messages.

**Tech Stack:** TypeScript 5.9.3 strict mode, Zod Mini 4.4.3, exact-pinned `@noble/hashes` 2.2.0 and `@noble/ciphers` 2.2.0 through existing `@shardpass/crypto`, React 19.2.8, Chrome MV3 minimum 110, Vitest 4.1.10, Playwright 1.62.0, pnpm exactly 10.14.0.

## Global Constraints

- The authoritative scope is Task 10 at `docs/superpowers/plans/2026-07-29-project-1-vault-otp.md:539-582`; Tasks 11–13 remain out of scope.
- This is a non-Git workspace. Do not run Git, branch, worktree, commit, push, or merge commands.
- Use exactly the three implementation phases below and one consolidated review gate per phase; resolve review findings before starting the next phase.
- Create `.sdd/project1-task10-execution-ledger.md` only after the first genuine RED command. Append commands, environment, evidence, reviews, and corrections; never rewrite prior evidence.
- Node is `>=22.14.0 <23`, pnpm is exactly `10.14.0`, and minimum Chrome is 110. Node 24 runs are development-only through the existing allowlist, and later Chromium evidence does not establish Chrome 110 compatibility.
- Preserve the exact 17 authorized legacy artifacts as regular, non-symlink files with pinned hashes. Never edit, rename, regenerate, or package them.
- Do not implement cryptographic primitives manually. Use existing Argon2id and XChaCha20-Poly1305 APIs, fresh random 16-byte salt and 24-byte nonce, canonical padded Base64, and canonical header bytes as AEAD associated data.
- Never serialize the vault DEK, wrapped keys, roots, manifests, encrypted storage records, migration transaction state, Ente credentials, HOTP pending reservations/receipts, session epochs, or capabilities.
- Portable plaintext may contain current `OtpItem` fields, safe settings, and explicitly selected bounded logical journal/tombstone state only. History semantics must be documented and tested; absent state must not be invented.
- Backup plaintext, OTP seeds, full records, passwords, derived keys, and raw backup bodies must not appear in logs, errors, test names, snapshots, screenshots, accessibility labels/descriptions, content messages, popup messages, URL/history, or persistent UI storage.
- Passwords never cross runtime messaging. Current-password step-up and backup-password KDF operations use trusted vault-page KDF execution plus opaque/background-bound challenges or derived-key proof material; raw password strings remain in the vault page and are synchronously cleared on cancel, lock, replacement, completion, and unmount.
- Export uses a separate backup password and fresh backup key material. Before a download is offered, decrypt and strictly parse the generated blob with independently retained inputs and compare its canonical portable payload.
- Import is unlocked-vault-only, full-vault-only, local-only, and performs no writes before explicit preview confirmation. Popup/content senders have no backup authority.
- Import preview capabilities are random, one-use, five-minute, in-memory only, bound to exact extension ID, vault URL, browser-owned `documentId`, and current session epoch. Lock, restart, document replacement, expiry, cancel, or completion invalidates them.
- Confirmation reloads authenticated current state, reclassifies all rows, prevents HOTP counter regression, and returns a changed preview requiring explicit reconfirmation if classifications or merge results differ.
- Successful confirmation creates exactly one staged, verified, authenticated, activated immutable generation. Pre-activation interruption leaves the prior generation active; no partial import or duplicate retry occurs.
- Maintain honest non-CAS semantics: local mutation serialization and authenticated-root checks are not cross-process compare-and-swap.
- Safe errors are fixed allowlisted code/message pairs. Never reflect parser, crypto, storage, filename, label, issuer, password, or raw input strings.
- No `downloads`, clipboard, camera, host, optional-host, offscreen, or network permission is added. Export uses a direct user-gesture anchor plus object URL and always revokes it.
- Tests use synthetic fixtures only: no real browser profile, account, clipboard, camera, external network, password, or production seed.

## Fixed Format and Shared Contracts

The v2 outer envelope is strict canonical JSON with no unknown fields:

```ts
export const BACKUP_V2_LIMITS = Object.freeze({
  maxEnvelopeBytes: 8_388_608,
  maxCiphertextBytes: 8_000_000,
  maxItems: 10_000,
  maxJournalEntries: 10_000,
  maxTombstones: 10_000,
});

export type BackupV2Header = Readonly<{
  type: "shardpass-backup";
  formatVersion: 2;
  payloadSchemaVersion: 1;
  kdf: Readonly<{
    algorithm: "argon2id";
    version: 19;
    memoryKiB: number;
    iterations: number;
    parallelism: number;
    salt: string;
  }>;
  cipher: Readonly<{
    algorithm: "xchacha20-poly1305";
    nonce: string;
  }>;
}>;

export type BackupV2Envelope = Readonly<BackupV2Header & { ciphertext: string }>;
export type PortableBackupPayload = Readonly<{
  schemaVersion: 1;
  exportedAt: string;
  items: readonly OtpItem[];
  settings: Readonly<{ autoLockMinutes: 0 | 5 | 15 | 30 | 60; lockOnScreenLock: boolean }>;
  history: Readonly<{
    journal: readonly PortableJournalEntry[];
    tombstones: readonly PortableTombstone[];
  }>;
}>;
```

Public pure-format APIs:

```ts
encodeBackupV2Header(header: BackupV2Header): Uint8Array;
parseBackupV2Envelope(input: string | Uint8Array): BackupV2Envelope;
exportPortableBackup(input: PortableBackupPayload, password: Uint8Array, executor: KdfExecutor, options?: BackupCryptoOptions): Promise<Uint8Array>;
importPortableBackup(input: Uint8Array, password: Uint8Array, executor: KdfExecutor, options?: BackupImportOptions): Promise<ImportedPortableBackup>;
importLegacyBackup(input: Uint8Array, password: Uint8Array): Promise<ImportedPortableBackup>;
```

`BackupCryptoOptions` accepts only injectable clock/random/KDF parameters needed for deterministic tests. Production uses `webCryptoRandomSource` and `DEFAULT_ARGON2ID_PARAMETERS`. All byte ownership and cleanup rules are explicit; callers retain their input arrays, implementations clear private copies best-effort, and no JavaScript zeroization guarantee is made.

Background/UI messaging is strict version 1 and split so no password crosses it:

```ts
export type BackupRequest =
  | { version: 1; kind: "backup.beginExportStepUp" }
  | { version: 1; kind: "backup.finishExportStepUp"; challengeId: string; derivedKey: Uint8Array }
  | { version: 1; kind: "backup.readPortableSnapshot"; capability: string }
  | {
      version: 1;
      kind: "backup.previewImport";
      descriptor: SafeBackupDescriptor;
      items: readonly PortableImportCandidate[];
    }
  | { version: 1; kind: "backup.confirmImport"; previewToken: string }
  | { version: 1; kind: "backup.cancelImport"; previewToken: string };
```

If current session APIs require a different opaque proof shape, preserve the invariant rather than this illustrative field: raw password never leaves the vault page, proof is challenge/document/session-bound, and derived material is transferred/cleared. Responses are exact request-kind paired and expose only safe counts, opaque tokens, fixed statuses, expiry, and the minimum portable snapshot to the trusted vault document. The snapshot response is one-use export-capability-bound; popup/content remain unauthorized.

---

### Phase 1: Backup v2 cryptographic format and legacy compatibility

**Files:**

- Create: `packages/importers/src/backup/v2-format.ts`
- Create: `packages/importers/src/backup/export.ts`
- Create: `packages/importers/src/backup/import.ts`
- Create: `packages/importers/src/backup/model.ts` if keeping strict portable payload schemas separate makes each file single-purpose
- Create: `packages/importers/test/backup.test.ts`
- Modify: `packages/importers/src/index.ts`
- Modify: `packages/importers/package.json` only if existing workspace dependencies are not already declared
- Modify: `docs/security/cryptographic-format.md`
- Create after RED: `.sdd/project1-task10-execution-ledger.md`

**Interfaces:**

- Consumes: `KdfExecutor`, `deriveKeyEncryptionKey`, `encryptEnvelope`, `decryptEnvelope`, `RandomSource`, canonical Base64/JSON helpers, `OtpItemSchema`, legacy `shardpass-export` fixture and legacy-v1 compatibility modules.
- Produces: the fixed format/types/APIs above plus a secret-bearing internal `ImportedPortableBackup` that never crosses untrusted messaging directly.

- [ ] **Step 1: Write one comprehensive RED suite**

Cover deterministic canonical header bytes; strict type/version/algorithm/schema; no unknown fields; canonical padded Base64; exact salt/nonce lengths; KDF parameter bounds before KDF invocation; total envelope/ciphertext/item/history/string bounds before expansion; fresh salt/nonce; complete Project 1 OTP fields including HOTP counters and Steam; settings; intentionally included journal/tombstones; Unicode preservation; wrong password; header/ciphertext tampering; malformed UTF-8/JSON; noncanonical payload; unsupported future versions; cleanup on every success/failure; and import of `tests/fixtures/legacy/backup-export.json` without exporting legacy format. Assert no DEK/wrapped key/root/manifest/receipt/reservation/session/Ente fields exist in canonical plaintext or envelope.

- [ ] **Step 2: Run genuine RED and create the ledger**

Run:

```bash
pnpm exec vitest run packages/importers/test/backup.test.ts
```

Expected: FAIL because backup modules/APIs do not exist. Create `.sdd/project1-task10-execution-ledger.md` immediately afterward and append the exact command, Node/pnpm versions, failure summary, and timestamp without secret values.

- [ ] **Step 3: Implement strict schemas and canonical encoding**

Use Zod Mini strict objects, existing canonical JSON/Base64 helpers, byte-first envelope preflight, safe integer checks, exact algorithms, and `validateArgon2idWorkParameters`. `encodeBackupV2Header` must serialize exactly the header fields in fixed canonical key order; these bytes are AAD. Reject noncanonical outer JSON by re-encoding and comparing UTF-8 bytes. Reject payload bytes that do not re-encode identically after strict parsing.

- [ ] **Step 4: Implement export/import with existing crypto only**

Derive a 32-byte backup-only key from an owned password-byte copy and fresh 16-byte salt, encrypt canonical portable payload bytes with XChaCha20-Poly1305 and fresh 24-byte nonce, authenticate canonical header bytes, then emit canonical envelope bytes. Import strictly parses/preflights, derives only after bounds pass, decrypts with the exact reconstructed header AAD, strictly parses canonical payload, and projects field-by-field. Clear private password/key/plaintext/canonical scratch arrays in independent `finally` paths while documenting best-effort cleanup.

- [ ] **Step 5: Implement legacy import-only adapter**

Strictly recognize the authorized `type: "shardpass-export"` wrapper, project its embedded v1 envelope into existing legacy decrypt/convert APIs, reject synthetic/test metadata outside test-only fixture loading before production parsing, preserve supported OTP semantics, omit Ente credentials/state, and return the same portable import model. Never produce a legacy export.

- [ ] **Step 6: Run GREEN and phase regression**

Run:

```bash
pnpm exec vitest run packages/importers/test/backup.test.ts packages/importers/test/legacy-v1.test.ts packages/crypto packages/domain packages/storage/test/canonical-base64.test.ts
pnpm typecheck
```

Expected: PASS under a supported Node 22 environment; under installed Node 24, record development-only evidence and do not claim the official gate.

- [ ] **Step 7: Perform one consolidated Phase 1 review**

Review format ambiguity, canonicalization/AAD identity, KDF-before-bound errors, salt/nonce uniqueness, crypto dependency use, private-copy ownership, cleanup exception containment, parser error reflection, legacy fixture handling, excluded fields, docs accuracy, dependency boundaries, and tests for every branch. Resolve all high-confidence findings and rerun Step 6 once.

---

### Phase 2: Background service, strict messaging, preview capability, and atomic import

**Files:**

- Create: `packages/messaging/src/backup.ts`
- Create: `packages/messaging/test/backup.test.ts`
- Create: `apps/extension/src/background/vault/backup-service.ts`
- Create: `apps/extension/test/background/backup-service.test.ts`
- Modify: `packages/messaging/src/index.ts`
- Modify: `packages/security/src/errors.ts`
- Modify: `packages/security/test/errors.test.ts`
- Modify: `packages/storage/src/vault-repository.ts`
- Modify: `packages/storage/src/index.ts`
- Modify: `packages/storage/test/vault-repository.test.ts`
- Modify: `apps/extension/src/background/vault/session-vault-repository.ts`
- Modify: `apps/extension/src/background/vault/session-service.ts`
- Modify: `apps/extension/test/background/session-vault-repository.test.ts`
- Modify: `apps/extension/test/background/session-service.test.ts`
- Modify: `apps/extension/src/background/router.ts`
- Modify: `apps/extension/test/background/router.test.ts`
- Modify: `apps/extension/src/background/main.ts`
- Modify: `apps/extension/test/background/background-runtime.integration.test.ts`
- Modify: `apps/extension/src/platform/extension-platform.ts`
- Modify: `apps/extension/src/platform/chrome-platform.ts`
- Modify: `apps/extension/test/platform/chrome-platform.test.ts`
- Modify: `.sdd/project1-task10-execution-ledger.md`

**Interfaces:**

- Consumes: Phase 1 portable models, existing exact sender normalization/authorization, challenge/session epoch/root checks, session-owned repository bridge, import duplicate classifier, immutable generation transaction, state publisher, and typed Chrome transport.
- Produces: strict `BackupRequest`/`BackupResponse` parsing and pairing; `BackupService`; one-use export and preview capabilities; a narrow session bridge for portable snapshot/import; exact atomic repository merge result.

- [ ] **Step 1: Write consolidated messaging/service/repository RED tests**

Messaging tests cover strict version 1, unknown fields, byte/item/count bounds, exact response pairing, safe projections, vault-only exact URL/document policy, popup/content/wrong-document rejection, and absence of password fields. Step-up tests cover current-password verification, challenge expiry/replay/document/session/root binding, no snapshot before verification, and proof cleanup. Export capability tests cover one use, five-minute TTL, lock/restart/dispose cleanup, snapshot field inclusion/exclusion, and no universal callback/repository/DEK/root escape. Preview tests cover zero writes, random token, four-per-document/global cap, expiry/cancel/lock/restart/document replacement, duplicates/conflicts, HOTP max-counter merge, changed preview/reconfirm, and safe rows. Repository tests cover one generation, capacity, one authenticated load/reclassification, interruption at stage/verify/preactivation/activation, external root notification, retry, concurrent confirmation, and no partial/double import.

- [ ] **Step 2: Run RED**

```bash
pnpm exec vitest run packages/messaging/test/backup.test.ts apps/extension/test/background/backup-service.test.ts packages/storage/test/vault-repository.test.ts apps/extension/test/background/session-vault-repository.test.ts apps/extension/test/background/session-service.test.ts apps/extension/test/background/router.test.ts apps/extension/test/platform/chrome-platform.test.ts
```

Expected: FAIL for missing backup schemas/service/bridge/routes.

- [ ] **Step 3: Implement strict messages, authorization, and fixed errors**

Add exact request-response maps and `parseBackupResponseForRequest`. Parse before authorization, authorize exact browser-owned full-vault document, field-project responses, and reparse before return. Add fixed errors such as `BACKUP_INVALID`, `BACKUP_AUTH_FAILED`, `BACKUP_EXPIRED`, `BACKUP_CHANGED`, `BACKUP_CAPACITY`, and `BACKUP_UNAVAILABLE`; map all unknown failures to existing fixed `UNEXPECTED`. Do not include password, raw backup text/bytes, seed, complete item, current root, session epoch, callback, crypto context, or repository in popup/content-capable messages.

- [ ] **Step 4: Implement session-owned step-up and export snapshot**

Reuse the existing challenge/KDF architecture so the vault page performs Argon2id and transfers only challenge-bound proof material. Immediately verify against the authenticated wrapped vault key/root, issue a random one-use export capability bound to sender/session/root with five-minute TTL, then read one authenticated snapshot containing only portable fields. Any await followed by epoch/root/document mismatch fails closed. Lock/dispose clears challenge/proof/snapshot references synchronously.

- [ ] **Step 5: Implement preview capability and atomic portable merge**

The background accepts already decrypted trusted-vault candidates only through strict bounded messages, owns deep copies, classifies against one authenticated current snapshot, and returns safe rows/counts. Confirmation reloads and reclassifies under the serialized repository mutation, chooses `max(currentCounter, importedCounter)` for semantically matching HOTP identities, never regresses revisions/counters, and requires reconfirmation when any row or merge outcome differs. Success appends bounded logical changes and activates exactly one generation. Identity-safe finalizers prevent old operations deleting replacements.

- [ ] **Step 6: Wire router/runtime/platform and cleanup**

Construct one `BackupService`, route and revalidate exact responses, publish authoritative state only after committed import or lock-relevant failure, dispose idempotently, and expose only `sendBackupMessage` on the trusted vault platform. Preserve current OTP/import/migration behavior and unchanged permissions.

- [ ] **Step 7: Run GREEN and phase regression**

```bash
pnpm exec vitest run packages/messaging/test/backup.test.ts apps/extension/test/background/backup-service.test.ts packages/storage/test/vault-repository.test.ts apps/extension/test/background/session-vault-repository.test.ts apps/extension/test/background/session-service.test.ts apps/extension/test/background/router.test.ts apps/extension/test/background/background-runtime.integration.test.ts apps/extension/test/platform/chrome-platform.test.ts
pnpm exec vitest run packages/messaging packages/storage apps/extension/test/background apps/extension/test/platform --maxWorkers=1 --no-file-parallelism
pnpm typecheck
```

- [ ] **Step 8: Perform one consolidated Phase 2 review**

Review every trust boundary, password/proof lifetime, exact sender binding, capability counts/TTL/replay, root/epoch checks after awaits, stale finalizers, preview write-freedom, HOTP non-regression, immutable-generation interruption semantics, non-CAS claims, response pairing, error reflection, state publication, disposal, and no authority widening. Resolve findings and rerun Step 7 once.

---

### Phase 3: Vault UI, packaged browser/security evidence, documentation, and final verification

**Files:**

- Create: `apps/extension/src/vault/settings/BackupView.tsx`
- Create: `apps/extension/src/vault/settings/BackupView.module.css`
- Create: `apps/extension/src/vault/settings/useBackup.ts`
- Create: `apps/extension/test/vault/BackupView.dom.test.tsx`
- Create: `tests/browser/project1-backup.spec.ts`
- Create only after visual review if required: `tests/browser/__screenshots__/vault-backup-*.png`
- Modify: `apps/extension/src/vault/VaultApp.tsx`
- Modify: `apps/extension/src/vault/VaultApp.module.css`
- Modify: `apps/extension/test/vault/VaultApp.dom.test.tsx`
- Modify: `apps/extension/test/vault/VaultApp.styles.test.ts`
- Modify: `apps/extension/src/platform/extension-platform.ts`
- Modify: `apps/extension/src/platform/chrome-platform.ts`
- Modify: `apps/extension/src/manifest.ts`
- Modify: `tests/security/manifest.test.ts`
- Modify: `tests/security/csp.test.ts`
- Modify: `tools/security/executable-policy.ts` and output tests only if new build output requires a narrowly audited exception; otherwise leave policy unchanged
- Modify: `docs/security/cryptographic-format.md`
- Modify: `docs/security/threat-model.md`
- Modify: `docs/security/invariants.md`
- Modify: `docs/security/release-checklist.md`
- Modify: `docs/architecture/runtime-boundaries.md`
- Modify: `docs/architecture/permissions.md`
- Create: `.prettierignore.project1-task10` only for append-only ledger exclusions; never ignore handwritten production/tests
- Modify: `package.json`
- Modify: `scripts/check-engine.mjs` only to add exact Task 10 local-command allowlisting
- Modify: `.sdd/project1-task10-execution-ledger.md`

**Interfaces:**

- Consumes: Phase 1 encrypt/decrypt APIs, Phase 2 strict transport/capabilities, existing vault KDF worker, vault lock state, and current ShardPass UI tokens/layout.
- Produces: accessible `BackupView`, owned export/import job state, direct user-gesture download, local file selection, packaged evidence, and Task 10 verification scripts.

- [ ] **Step 1: Write UI/browser/security RED tests**

DOM tests cover unlocked-only rendering; current-password and separate backup-password fields; password confirmation; explicit warnings; direct-gesture export; no blob before step-up; generated blob self-verification before download; object URL creation/revocation; local `.shardpass` selection; v2 and legacy import; safe preview counts; changed preview/reconfirm; cancel; wrong password; lock/unmount/replacement synchronous clearing; stale async result suppression; focus/error announcements without secret values; and no raw bytes/full items in DOM. Browser tests cover packaged round trip of every portable Project 1 field, legacy import, tamper/wrong password, preview zero writes, one-generation confirmation, interruption/restart/lock, encrypted persistence, accessibility, desktop and 200%-effective compact layout. Security tests assert unchanged manifest permissions/CSP, local-only KDF worker, no network/downloads permission, and no secret logs/build artifacts.

- [ ] **Step 2: Run RED**

```bash
pnpm exec vitest run apps/extension/test/vault/BackupView.dom.test.tsx apps/extension/test/vault/VaultApp.dom.test.tsx tests/security/manifest.test.ts tests/security/csp.test.ts
pnpm exec playwright test tests/browser/project1-backup.spec.ts
```

Expected: FAIL because UI/spec do not exist.

- [ ] **Step 3: Implement owned export/import jobs**

`useBackup` creates one identity-token owner per operation. Export clears current-password input synchronously after starting proof derivation, clears backup-password fields after KDF invocation owns private byte copies, requests a one-use snapshot, exports, decrypts/reparses the generated bytes, compares canonical payload, then creates one Blob/object URL only inside the user-gesture flow. Revoke the prior URL before replacement and on completion/error/lock/unmount. Import bounds `File.size` before `arrayBuffer`, clears the file input/reference immediately after owned read starts, installs abort/timeout before reads, decrypts locally, sends only bounded candidates through strict vault-only transport, and clears all private bytes/candidates on terminal paths. Late responses must pass owner and unlocked-state checks.

- [ ] **Step 4: Implement accessible BackupView integration**

Place BackupView under full-vault `VAULT / SECURITY & MIGRATION` controls without removing `VaultAccess` or `MigrationPanel`. Use explicit labels, warnings that portable backups contain sensitive data protected by the backup password, non-dangerous default focus, disabled/busy states, fixed safe errors, keyboard operation, reduced-motion-aware sharp styling, and virtualized preview if rows can exceed the visible bound. Never render secrets, raw backup bodies, filenames, notes, tags, stable hashes, or full item objects.

- [ ] **Step 5: Add packaged evidence and security documentation**

Use synthetic generated fixtures and no external resources. Assert preview leaves active generation unchanged, confirmation changes it exactly once, persisted data remains encrypted, restart invalidates capabilities, and lock redacts UI synchronously. Update cryptographic format with exact canonical header/AAD/KDF/cipher/bounds/exclusions and cleanup limitations; update threat model/invariants/runtime boundary/permissions/release checklist without claiming independent audit, guaranteed zeroization, CAS, Node 22 evidence when run on Node 24, or Chrome 110 evidence when run on Chrome 151.

- [ ] **Step 6: Add focused verification scripts and run GREEN**

Add `test:project1:task10`, `format:check:project1:task10`, `verify:project1:task10:evidence`, `verify:project1:task10`, and `verify:project1:task10:local-node24`, preserving the official engine gate before evidence and exact local allowlist behavior.

Focused gate:

```bash
pnpm exec vitest run packages/importers/test/backup.test.ts apps/extension/test/vault/BackupView.dom.test.tsx packages/messaging/test/backup.test.ts apps/extension/test/background/backup-service.test.ts
pnpm exec playwright test tests/browser/project1-backup.spec.ts
```

Development full gate on installed Node 24:

```bash
pnpm verify:project1:task10:local-node24
```

Official completion additionally requires `pnpm verify:project1:task10` on Node 22 and actual Chrome/Chromium 110 packaged evidence.

- [ ] **Step 7: Perform one consolidated Phase 3 and whole-Task-10 review**

Review direct user gesture and object URL lifetime, stale owner races, synchronous lock redaction, DOM/a11y/screenshot secrecy, worker/KDF authority, file bounds and cleanup, no permission/network widening, portable round-trip completeness, legacy compatibility, one-generation import, browser interruption evidence, docs honesty, exact legacy artifact verification, reproducible build, audit output, formatting/lint/type/dependency gates, and release-blocker wording. Resolve all high-confidence findings, rerun Step 6 and security/legacy/reproducible-build checks once, then append the final status and remaining environment/external-review blockers to the ledger.

## Plan Self-Review

- **Spec coverage:** All authoritative Task 10 requirements map to Phase 1 format/legacy crypto, Phase 2 step-up/capabilities/atomic import, or Phase 3 UI/evidence/docs. Tasks 11–13 and Ente sync remain excluded.
- **Placeholder scan:** No `TBD`, deferred implementation, generic error-handling instruction, or undefined cross-phase public API remains. Optional file creation is conditional only where actual build/visual evidence determines whether an artifact is needed.
- **Type consistency:** Phase 2 consumes the exact Phase 1 portable models; Phase 3 consumes Phase 1 crypto and Phase 2 transport. `BackupRequest`, `BackupService`, one-use export capability, preview token, and `parseBackupResponseForRequest` names remain consistent.
- **Known implementation adaptation:** The illustrative step-up proof shape may be narrowed to existing session challenge primitives after tests inspect their exact contract, but raw password prohibition, challenge binding, current-password verification, one use, cleanup, and sender/session/root constraints are non-negotiable.
