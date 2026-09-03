# Project 1 Task 9 OTP Imports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded, local-only OTP import from `otpauth://` text, Google Authenticator migration payloads, supported Aegis and Ente exports, and local QR/image input, with safe previews and one explicitly confirmed atomic vault write.

**Architecture:** The broader approved plan at `docs/superpowers/plans/2026-07-29-project-1-vault-otp.md` remains authoritative; this document is an execution-level supplement for its Task 9 only. Pure importer modules convert bounded untrusted input into secret-bearing background-only candidates and secret-free previews; a dedicated extension-page worker performs bounded image decoding; strict vault-only messages bind previews to the browser-owned vault document and background session; confirmation reclassifies the authenticated snapshot against the current vault and commits all accepted items through one session-owned immutable generation.

**Tech Stack:** TypeScript 5.9.3 strict mode, React 19.2.8, Zod Mini 4.4.3, `@bufbuild/protobuf` 2.13.0 with checked-in generated Google Authenticator schema, `@bufbuild/buf` 1.72.0 and `@bufbuild/protoc-gen-es` 2.13.0 as pinned generation-only tools, `jsqr` 1.4.0 in a dedicated local Worker, existing `@shardpass/domain`, `@shardpass/storage`, `@shardpass/messaging`, Chrome MV3 minimum 110, Vitest 4.1.10, Testing Library 16.3.2, Playwright 1.62.0, Prettier 3.9.6, pnpm exactly 10.14.0.

## Authority and scope

- `docs/superpowers/plans/2026-07-29-project-1-vault-otp.md`, especially lines 491–537, is the authoritative Project 1 Task 9 plan.
- `docs/superpowers/specs/2026-07-29-password-manager-foundation-design.md`, especially sections 4 and 5, is the approved foundation specification.
- `docs/superpowers/plans/2026-08-10-project-1-task-8-otp-crud-ui.md` and the current source are authoritative for the completed session-owned repository bridge, strict version-1 OTP messaging, CRUD/migration UI, safe errors, immutable-generation writes, and packaged test architecture.
- Implement exactly the nine tasks below in order. Do not start a later task while the current task's review gate is open.
- This is a non-Git workspace. Do not run Git, branch, worktree, commit, push, or merge commands.
- Create `.sdd/project1-task9-execution-ledger.md` only when implementation Task 1 records its first RED result. Do not create it while writing or reviewing this plan. Record every Task 9 command, environment, review result, correction, and final gate only there.
- Task 9 does not implement Task 10 backup export/import, Task 11 page OTP fill, Task 12 Ente synchronization, or Task 13's Project 1 release gate.

## Global constraints and fixed decisions

- Project 0 and completed Project 1 Tasks 1–8 must remain passing. Use maintainable source; never import or edit preserved ShardPass 1.2.1 bundles. Builds write only to `dist/`.
- Node is `>=22.14.0 <23`, pnpm is exactly `10.14.0`, and minimum Chrome is `110`. Keep exact dependency versions pinned in `pnpm-lock.yaml`; review browser compatibility, maintenance, license, transitive code, CSP behavior, and secret handling before acceptance.
- Official completion requires the full gate under Node 22 and packaged browser evidence in actual Chrome/Chromium 110. Installed Node 24 evidence is development-only and must use the existing `--allow-node24` path; later-Chromium evidence does not clear the Chrome 110 blocker.
- Preserve and verify all exact 17 authorized legacy artifact hashes. Do not edit, rename, regenerate, or package the preserved artifact.
- Imports are local-only: no upload, remote URL, fetch, XHR, WebSocket, analytics, telemetry, remote font/asset, Ente API call, sync operation, or other network sink. Do not request camera permission initially and do not implement live camera capture.
- Accepted input is typed/pasted text, a selected local text/JSON/image file, or a pasted image available to the trusted full-vault page. Clipboard reads are not added; paste uses the browser-delivered user event. There is no popup import surface and no content-script import command.
- No backup export or backup-format import is added. An Ente export is parsed as a local static import only; Ente authentication, upload, download, pending operations, remote metadata mutation, and synchronization remain out of scope.
- Raw import bodies, URI strings, QR pixels, image bytes, protobuf bytes, decoded OTP seeds, candidate secrets, and full `OtpItem` objects are secret-bearing. They must never enter preview/result projections, logs, errors, events, analytics, test titles, fixture filenames, snapshots, screenshot names, accessible names/descriptions, React keys, URL/history, storage, session storage, IndexedDB, cache, DOM attributes, or clipboard output.
- Raw input and candidate references must be redacted synchronously on cancel, lock, unmount, worker termination, replacement, confirmation completion, and every terminal error. Clear mutable byte buffers with `fill(0)` where practical and clear form/file references in the same call stack; do not claim guaranteed JavaScript memory zeroization.
- A preview is non-persistent and requires explicit confirmation. Preview creation performs no vault mutation, journal append, generation stage/activation, item ID allocation, activity update, settings change, Ente write, or browser storage write.
- Strict bounds apply before expensive decoding and after every format expansion. Fixed Task 9 limits are: `MAX_IMPORT_INPUT_BYTES = 1_048_576`, `MAX_IMPORT_TEXT_SCALARS = 262_144`, `MAX_IMPORT_ENTRIES = 1_000`, `MAX_IMPORT_MIGRATION_BATCHES = 16`, `MAX_IMPORT_IMAGE_BYTES = 8_388_608`, `MAX_IMPORT_IMAGE_DIMENSION = 4096`, `MAX_IMPORT_IMAGE_PIXELS = 16_777_216`, and `MAX_IMPORT_QR_PAYLOAD_BYTES = 1_048_576`. Reject over-bound input; do not truncate it into validity.
- Format detection is strict and deterministic: explicit `otpauth-migration://offline?data=` first, then one or more `otpauth://` lines, then strict Aegis JSON discriminator, then strict Ente export discriminator. Reject ambiguous JSON, unknown versions, unknown fields where the format is defined as strict, unsupported encrypted/password-protected exports, malformed percent/Base64/Base32/UTF-8/protobuf, excess batches/items, and trailing non-whitespace text. Never heuristically scrape arbitrary JSON or prose for seeds.
- Supported OTP semantics are exactly current strict `OtpItem`: TOTP, HOTP, Steam; SHA1/SHA256/SHA512; configured digits and period; HOTP counter including zero; issuer, label, note, tags, favorite where a supported source supplies them. Steam remains SHA1, five characters, 30 seconds. Unsupported algorithms/types/digits/periods are rejected row-by-row and never silently downgraded.
- Imported metadata is deterministic: preserve supported source issuer/label/algorithm/digits/period/counter/note/tags/favorite; otherwise use `note: ""`, `tags: []`, `favorite: false`. New local IDs, schema version, revision, `createdAt`, and `updatedAt` are background-owned and assigned only during confirmed import.
- Duplicate equality is the exact semantic key `(otpType, canonical secret, algorithm, digits, period, counter-or-null, NFKC issuer, NFKC label)`. It intentionally includes the HOTP counter and excludes ID, revision, timestamps, note, tags, favorite, and Ente metadata. Duplicate status may say `Already in vault` or `Repeated in this import`; no digest, hash, fingerprint, key serialization, secret fragment, or stable duplicate identifier is exposed.
- Preview row IDs are random opaque background IDs, not array indexes, labels, hashes, fingerprints, or source IDs. Preview IDs are random opaque background IDs. They are bound to the exact browser-owned extension ID, vault URL, `documentId`, and current background session epoch.
- The background keeps preview snapshots in memory only with a five-minute TTL, at most four previews per vault document, and at most 1,000 candidates per preview. Lock, service-worker restart, sender-document replacement, cancel, expiry, confirmation, or disposal destroys the snapshot and makes confirmation fail safely.
- Preview responses contain only opaque row ID, ordinal, classification, fixed safe reason code/message, and non-secret display metadata: issuer, label, OTP type, algorithm, digits, period, and HOTP counter. They never contain secret, URI, raw line, source object, fingerprint, note, tags, favorite, Ente identity/state, or full candidate.
- Confirmation does not trust preview classifications. It authenticates the exact current vault/session, reloads the current vault once, and reclassifies the entire background-held snapshot against that authenticated current state and within-batch order. Any newly duplicate row is skipped and counted; any invalidated/capacity/lock condition aborts without a partial import.
- Confirmation is one session-owned atomic batch operation that produces one newly staged, verified, authenticated, activated immutable generation and one journal create entry per inserted item. It is one-generation all-or-nothing under interruption tests; failed preactivation leaves the old generation active and retry does not double-insert.
- Non-CAS honesty: do not add a caller-supplied root token or claim root-level CAS. `VaultRepository` serializes local mutations and authenticates the exact active root through existing session coordination; external root replacement/races lock fail-closed. Duplicate reclassification and commit occur inside that serialized operation. Report conflicts as fixed safe failure, never as guaranteed multi-process CAS.
- Capacity is checked before staging against importer limits, generation-entry/storage limits, encrypted record limits, journal compaction rules, browser storage bounds, and safe integer/timestamp limits. Insufficient capacity aborts the whole batch without mutation.
- Lock increments the existing session epoch and wins at every await, decode result, parse result, preview publication, reclassification, stage, verify, preactivation, and response boundary. A lock or worker/service interruption cannot publish stale preview data or report a partial success.
- Background exclusively owns decrypted `OtpItem` objects, import candidates, IDs, session epoch, repository crypto context, DEK, authenticated root, duplicate comparison, and import transaction. The worker receives only bounded image bytes and returns only a bounded decoded string; UI receives only strict bounded safe projections.
- Every import runtime message is strict version `1`, rejects unknown fields, is vault-only, and requires the browser-owned extension ID, exact `chrome-extension://<id>/vault/index.html`, and browser-owned `documentId`. UI cannot supply extension ID, sender URL, document ID, tab/frame identity, session epoch, repository/root/context, callback, ID generator, or crypto capability.
- Safe errors are allowlisted fixed code/message pairs. Never reflect raw parser/library/worker/storage errors or user-controlled input. Production code uses no `console.log`.
- Manifest permissions remain exactly `storage`, `alarms`, and `idle`; no camera, `tabs`, `activeTab`, clipboard, downloads, host, optional-host, externally-connectable, offscreen, or unlimited-storage permission is added. Keep the exact existing extension-page CSP unchanged and audit worker loading plus image APIs against it.
- Keep `MigrationPanel`, current CRUD editor/search/delete/conflict behavior, setup/unlock/lock, HOTP lifecycle, and popup behavior intact. Import completion refreshes the same `OtpVaultView`; it does not create a parallel list or migration path.
- UI remains trusted-full-vault-only, keyboard accessible, reduced-motion aware, WCAG AA-oriented, and consistent with the approved dark precise ShardPass style: sharp geometry, compact dense rows, coral selection/confirmation rail, mono tabular counts, clear focus, no generic rounded cards, no dangerous default action.
- Browser E2E uses synthetic secrets and generated local fixtures only. No personal file, real profile, real camera, real Ente account, real clipboard secret, or production seed is used. Test names and screenshots describe behavior, not secret-bearing values.

---

## Exact file map and responsibilities

### Create

- `packages/importers/src/import-model.ts` — fixed bounds, normalized candidates, safe preview rows, fixed reason codes, exact semantic duplicate key comparison internal to trusted code, and synchronous redaction helpers.
- `packages/importers/src/otpauth.ts` — strict single URI and bounded multiline parser.
- `packages/importers/src/google-authenticator-migration.proto` — reviewed minimal public Google Authenticator migration schema source.
- `packages/importers/src/generated/google-authenticator-migration_pb.ts` — checked-in generated schema used through `@bufbuild/protobuf`; no hand-written wire primitives.
- `packages/importers/buf.gen.yaml` — deterministic local generation configuration using pinned `protoc-gen-es`, never a remote plugin.
- `packages/importers/src/google-migration.ts` — strict migration URI/batch validation and schema-based protobuf conversion.
- `packages/importers/src/aegis.ts` — strict supported unencrypted Aegis export conversion.
- `packages/importers/src/ente-export.ts` — strict supported local Ente export conversion without sync authority.
- `packages/importers/src/detect.ts` — deterministic bounded text/JSON format detection and aggregation.
- `packages/importers/src/qr.ts` — worker request/result schemas and bounded decoded payload validation.
- `packages/importers/test/import-model.test.ts`, `otpauth.test.ts`, `google-migration.test.ts`, `aegis.test.ts`, `ente-export.test.ts`, `detect.test.ts`, `qr.test.ts` — pure parser, limits, ambiguity, semantic preservation, redaction, and no-secret projection tests.
- `apps/extension/src/vault/otp/import/otp-import-worker.ts` — dedicated local image decode worker using `createImageBitmap`, bounded canvas pixels, and `jsqr`.
- `apps/extension/src/vault/otp/import/image-import-executor.ts` — worker lifecycle/timeout/epoch wrapper and synchronous request-buffer cleanup.
- `apps/extension/test/vault/image-import-executor.test.ts` — bytes/dimensions/pixels, stale result, timeout, terminate, and cleanup tests.
- `packages/messaging/src/otp-import.ts` — strict vault-only import requests/responses, safe preview schemas, bounds, sender policy, and response pairing.
- `packages/messaging/test/otp-import.test.ts` — unknown-field, projection-minimization, bound, sender, and request/response tests.
- `apps/extension/src/background/otp/import-service.ts` — in-memory document/session-owned snapshots, parsing, preview, confirmation reclassification, cancellation, expiry, fixed errors, and activity behavior.
- `apps/extension/test/background/otp-import-service.test.ts` — snapshot ownership/TTL/redaction, duplicate/race/capacity/lock/interruption, and atomicity tests.
- `apps/extension/src/vault/otp/import/OtpImportView.tsx` — full-vault input, safe preview, explicit confirm/cancel, and synchronous redaction UX.
- `apps/extension/src/vault/otp/import/OtpImportView.module.css` — sharp responsive import layout, focus, contrast, reduced motion, and safe destructive hierarchy.
- `apps/extension/src/vault/otp/import/useOtpImport.ts` — bounded UI state machine and cancellation/cleanup orchestration.
- `apps/extension/test/vault/OtpImportView.dom.test.tsx` — safe rendering, keyboard, confirmation, cancel/lock/unmount redaction, and CRUD/migration integration.
- `tests/browser/project1-otp-import.spec.ts` — packaged synthetic E2E across text, QR/image, Google, Aegis, Ente, duplicates, lock, interruption, and persistence.
- `tests/browser/__screenshots__/vault-otp-import-preview-linux.png` — reviewed desktop safe-preview baseline with synthetic metadata only.
- `tests/browser/__screenshots__/vault-otp-import-compact-linux.png` — reviewed compact safe-preview baseline with synthetic metadata only.
- `.prettierignore.project1-task9` — narrow ignore only if generated protobuf output is not Prettier-stable; handwritten files must not be ignored.
- `.sdd/project1-task9-execution-ledger.md` — created during implementation Task 1 after the first RED command, never during planning.

### Modify

- `packages/importers/src/index.ts` — export the bounded public import APIs and types.
- `packages/importers/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` — pin `@bufbuild/protobuf` 2.13.0 and `jsqr` 1.4.0 after documented review.
- `packages/storage/src/vault-repository.ts` — add one serialized `createBatch` operation that stages/verifies/activates one generation and reclassifies under its authenticated load.
- `packages/storage/test/vault-repository.test.ts` — all-or-nothing batch, duplicate race, capacity, journal, interruption, and single-generation coverage.
- `packages/storage/src/index.ts` — export batch request/result types.
- `apps/extension/src/background/vault/session-vault-repository.ts` — expose only `importOtpBatch(candidates)`; no context/root/repository escape.
- `apps/extension/test/background/session-vault-repository.test.ts` — batch bridge, epoch, lock, root-race, and no-capability tests.
- `packages/messaging/src/index.ts` — export import schemas/types/policy.
- `packages/security/src/errors.ts`, `packages/security/test/errors.test.ts` — fixed import error codes/messages.
- `apps/extension/src/background/router.ts`, `apps/extension/test/background/router.test.ts` — authorize, route, reparse, and safely map import responses/errors.
- `apps/extension/src/background/main.ts`, `apps/extension/test/background/background-runtime.integration.test.ts` — construct/dispose import service, clear snapshots on lock, and publish after successful import only.
- `apps/extension/src/platform/extension-platform.ts`, `apps/extension/src/platform/chrome-platform.ts`, `apps/extension/test/platform/chrome-platform.test.ts` — typed `sendOtpImportMessage` with response revalidation; no added browser authority.
- `apps/extension/src/vault/otp/OtpVaultView.tsx`, `apps/extension/src/vault/otp/OtpVaultView.module.css`, `apps/extension/test/vault/VaultApp.dom.test.tsx` — integrate import mode and refresh the existing list.
- `apps/extension/src/vault/VaultApp.tsx`, `apps/extension/test/vault/VaultApp.dom.test.tsx`, `apps/extension/test/vault/VaultApp.styles.test.ts` — preserve CRUD and `MigrationPanel` while exposing import only when unlocked.
- `apps/extension/src/manifest.ts`, `tests/security/manifest.test.ts`, `tests/security/csp.test.ts`, `tests/security/output/manifest.output.ts` — assert unchanged permissions/CSP and packaged local worker authority.
- `scripts/scan-build.mjs`, `tests/security/build-scan.test.ts` — reject import network/camera/dynamic-code/log/secret leakage in built output.
- `docs/architecture/dependencies.md`, `docs/architecture/permissions.md`, `docs/architecture/runtime-boundaries.md`, `docs/security/threat-model.md`, `docs/security/invariants.md`, `docs/security/release-checklist.md` — record reviewed dependencies and implemented local import boundary without claiming Task 10–13.
- `package.json` — add focused Task 9 test/format/verification commands while retaining existing commands.

## Shared API and type contract

All tasks use these exact names and shapes. Implementations may add private helpers but must not rename or widen these public contracts.

```ts
export const IMPORT_LIMITS = Object.freeze({
  maxInputBytes: 1_048_576,
  maxTextScalars: 262_144,
  maxEntries: 1_000,
  maxMigrationBatches: 16,
  maxImageBytes: 8_388_608,
  maxImageDimension: 4_096,
  maxImagePixels: 16_777_216,
  maxQrPayloadBytes: 1_048_576,
  previewTtlMs: 300_000,
  maxPreviewsPerDocument: 4,
} as const);

export type ImportSourceFormat = "otpauth" | "google-migration" | "aegis" | "ente" | "qr";
export type ImportRowStatus = "accepted" | "duplicate" | "rejected";
export type ImportReasonCode =
  | "IMPORT_ACCEPTED"
  | "IMPORT_DUPLICATE_VAULT"
  | "IMPORT_DUPLICATE_BATCH"
  | "IMPORT_MALFORMED"
  | "IMPORT_UNSUPPORTED"
  | "IMPORT_LIMIT_EXCEEDED";

export type OtpImportCandidate = Readonly<{
  issuer: string;
  label: string;
  secret: string;
  otpType: "totp" | "hotp" | "steam";
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
  counter?: number;
  favorite: boolean;
  tags: readonly string[];
  note: string;
}>;

export type SafeImportMetadata = Readonly<{
  issuer: string;
  label: string;
  otpType: "totp" | "hotp" | "steam";
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
  counter?: number;
}>;

export type ImportPreviewRow = Readonly<{
  rowId: string;
  ordinal: number;
  status: ImportRowStatus;
  reason: ImportReasonCode;
  metadata: SafeImportMetadata | null;
}>;

export type ParsedOtpImport = Readonly<{
  format: ImportSourceFormat;
  candidates: readonly OtpImportCandidate[];
  rejected: readonly Readonly<{ ordinal: number; reason: ImportReasonCode }>[];
}>;

export function parseOtpAuthUri(uri: string): OtpImportCandidate;
export function parseOtpAuthLines(text: string): ParsedOtpImport;
export function parseGoogleMigrationUri(uri: string): ParsedOtpImport;
export function parseGoogleMigrationUris(uris: readonly string[]): ParsedOtpImport;
export function parseAegisExport(text: string): ParsedOtpImport;
export function parseEnteExport(text: string): ParsedOtpImport;
export function parseOtpImportText(text: string): ParsedOtpImport;
export function hasSameOtpSemanticKey(left: OtpImportCandidate, right: OtpImportCandidate): boolean;
export function redactImportBuffer(buffer: Uint8Array): void;
```

```ts
export type OtpImportRequest =
  | { readonly version: 1; readonly kind: "otp.import.previewText"; readonly text: string }
  | { readonly version: 1; readonly kind: "otp.import.previewQr"; readonly payload: string }
  | { readonly version: 1; readonly kind: "otp.import.confirm"; readonly previewId: string }
  | { readonly version: 1; readonly kind: "otp.import.cancel"; readonly previewId: string };

export type OtpImportResponse =
  | {
      readonly version: 1;
      readonly kind: "otp.import.previewResult";
      readonly previewId: string;
      readonly format: ImportSourceFormat;
      readonly rows: readonly ImportPreviewRow[];
      readonly accepted: number;
      readonly duplicate: number;
      readonly rejected: number;
      readonly expiresAt: number;
    }
  | {
      readonly version: 1;
      readonly kind: "otp.import.confirmed";
      readonly imported: number;
      readonly duplicate: number;
    }
  | { readonly version: 1; readonly kind: "otp.import.cancelled"; readonly cancelled: boolean };

export interface OtpImportService {
  handle(request: OtpImportRequest, sender: SenderContext): Promise<OtpImportResponse>;
  clearForSession(): void;
  dispose(): void;
}

export interface SessionVaultRepository {
  // Existing Task 8 methods remain unchanged.
  importOtpBatch(candidates: readonly OtpImportCandidate[]): Promise<ImportOtpBatchResult>;
}

export type ImportOtpBatchResult = Readonly<{
  imported: number;
  duplicate: number;
  items: readonly OtpItem[];
}>;
```

`items` is background-internal and must never cross messaging. `VaultRepository.createBatch` receives the same candidate list plus background-owned metadata factories through its existing session context, performs duplicate reclassification inside its serialized authenticated operation, and returns `ImportOtpBatchResult` to the background bridge only.

## Task 1: Define the bounded import model, safe preview, and execution ledger

**Files:**

- Create: `packages/importers/src/import-model.ts`
- Create: `packages/importers/test/import-model.test.ts`
- Modify: `packages/importers/src/index.ts`
- Create during implementation after RED: `.sdd/project1-task9-execution-ledger.md`

**Interfaces:**

- Produces: `IMPORT_LIMITS`, all model types, `hasSameOtpSemanticKey`, `safeImportMetadata`, `classifyImportCandidates`, and `redactImportBuffer` exactly as specified above.
- Consumes: current domain bounds and canonical Base32 rules from `@shardpass/domain`; no browser globals.

- [ ] **Step 1: Write focused failing model tests**

  Add tests with behavior-focused, secret-free titles. Assert exact numeric limits; strict candidate parsing; metadata/HOTP counter preservation; safe projection key set; exact semantic duplicate behavior including NFKC issuer/label and counter distinction; within-batch first-wins order; 1,001-entry rejection; and `redactImportBuffer` replacing every byte with zero. Add a recursive assertion that serialized `ImportPreviewRow` contains none of `secret`, `uri`, `raw`, `fingerprint`, `hash`, `note`, `tags`, `favorite`, or `ente`.

- [ ] **Step 2: Run RED and create the Task 9 ledger**

  Run: `pnpm exec vitest run packages/importers/test/import-model.test.ts`

  Expected: FAIL because `import-model.ts` and exports do not exist.

  Immediately after recording this genuine RED result, create `.sdd/project1-task9-execution-ledger.md` with date, exact command/output, Node/pnpm versions, and Task 1 status. Do not include candidate values or raw fixture content.

- [ ] **Step 3: Implement the minimal model**

  Implement constants and strict frozen values. `hasSameOtpSemanticKey` compares fields directly without building or returning a serialized key or digest. `safeImportMetadata` copies only the seven allowed metadata fields plus optional counter. `classifyImportCandidates(candidates, existing, ids)` emits random opaque row IDs, first occurrence accepted, later semantic duplicates classified with fixed reasons, and never mutates inputs. Throw a fixed typed limit error before iterating beyond 1,000 candidates.

- [ ] **Step 4: Run GREEN and package regression**

  Run: `pnpm exec vitest run packages/importers/test/import-model.test.ts packages/importers/test/legacy-v1.test.ts`

  Expected: PASS; existing legacy importer behavior remains unchanged.

- [ ] **Step 5: Review gate**

  Review exports and test snapshots manually. Reject the task if any public preview type can carry candidate/raw/source fields, if duplicate comparison exposes a key/fingerprint, if exact bounds differ, or if `.sdd/project1-task9-execution-ledger.md` was created before the RED result. Record findings and corrections in the ledger.

## Task 2: Parse strict otpauth URIs and bounded multiline input

**Files:**

- Create: `packages/importers/src/otpauth.ts`
- Create: `packages/importers/test/otpauth.test.ts`
- Modify: `packages/importers/src/index.ts`
- Modify: `.sdd/project1-task9-execution-ledger.md`

**Interfaces:**

- Consumes: `OtpImportCandidate`, `ParsedOtpImport`, `IMPORT_LIMITS`, domain Base32/text/OTP bounds.
- Produces: `parseOtpAuthUri(uri: string): OtpImportCandidate` and `parseOtpAuthLines(text: string): ParsedOtpImport`.

- [ ] **Step 1: Write failing standards and rejection tests**

  Cover issuer-prefix/parameter agreement, UTF-8 percent decoding, `+` remaining literal in labels, canonical uppercase unpadded Base32 normalization only when decoding complete bytes, TOTP defaults (SHA1/6/30), HOTP required nonnegative safe counter and period 0, Steam exact constraints, SHA256/SHA512, eight digits, custom period, blank lines, CRLF, and stable ordinal. Reject non-`otpauth` scheme, authority other than `totp`/`hotp`, credentials/fragment, duplicate query keys, unknown security-relevant parameters, missing secret/label, malformed percent encoding, invalid UTF-8/Base32, issuer conflict, unsupported type/algorithm/digits/period, line trailing text, scalar/byte/item overflow, and all-whitespace input.

- [ ] **Step 2: Run RED**

  Run: `pnpm exec vitest run packages/importers/test/otpauth.test.ts`

  Expected: FAIL because parser exports do not exist.

- [ ] **Step 3: Implement strict parsing**

  Parse with `URL` only after byte/scalar bounds. Validate the complete query-key multimap before conversion. Decode and validate the secret, then return canonical Base32 without logging or embedding input in thrown errors. Multiline parsing accepts exactly one URI per nonblank line and turns individual malformed/unsupported lines into fixed rejected rows while refusing global limit violations. Do not scan prose or split on spaces/commas.

- [ ] **Step 4: Run GREEN and known-answer checks**

  Run: `pnpm exec vitest run packages/importers/test/otpauth.test.ts packages/otp/test`

  Expected: PASS; imported semantics generate the existing RFC/Steam known answers without changing OTP code logic.

- [ ] **Step 5: Review gate**

  Independently verify RFC compatibility, strict detection, metadata/HOTP preservation, no raw-error interpolation, no URI/secret projection, and rejection rather than silent defaults for explicitly unsupported values. Record review and fixes.

## Task 3: Decode Google Authenticator migration protobuf with maintained generated schema

**Files:**

- Create: `packages/importers/src/google-authenticator-migration.proto`
- Create: `packages/importers/src/generated/google-authenticator-migration_pb.ts`
- Create: `packages/importers/buf.gen.yaml`
- Create: `packages/importers/src/google-migration.ts`
- Create: `packages/importers/test/google-migration.test.ts`
- Modify: `packages/importers/src/index.ts`
- Modify: `packages/importers/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `docs/architecture/dependencies.md`
- Modify: `.sdd/project1-task9-execution-ledger.md`

**Interfaces:**

- Consumes: `@bufbuild/protobuf` 2.13.0 schema APIs, `ParsedOtpImport`, `IMPORT_LIMITS`, and model validation.
- Produces: `parseGoogleMigrationUri(uri: string): ParsedOtpImport`, `parseGoogleMigrationUris(uris: readonly string[]): ParsedOtpImport`; generated `MigrationPayloadSchema` used only inside importers.

- [ ] **Step 1: Write failing fixture and boundary tests**

  Programmatically encode synthetic payloads through the generated schema in tests. Cover TOTP/HOTP, zero/later counter, SHA1/SHA256/SHA512, six/eight digits, issuer/name, batch index/size/id, multiple batches supplied in deterministic URI order, duplicate items, malformed URL-safe Base64, oversized decoded bytes, malformed/truncated protobuf, unknown enum values, non-safe counter, unsupported digits/type/algorithm, inconsistent batch IDs/sizes/indexes, duplicate/missing batch indexes, more than 16 batches, and aggregate more than 1,000 entries. Assert errors contain fixed codes only.

- [ ] **Step 2: Run RED before dependency/install changes**

  Run: `pnpm exec vitest run packages/importers/test/google-migration.test.ts`

  Expected: FAIL because the generated schema, protobuf dependency, and parser do not exist.

- [ ] **Step 3: Pin and review the maintained protobuf dependency**

  Add exact `@bufbuild/protobuf` `2.13.0` as the runtime dependency and exact generation-only dev dependencies `@bufbuild/buf` `1.72.0` and `@bufbuild/protoc-gen-es` `2.13.0` through the strict workspace catalog and lockfile. Add `packages/importers/buf.gen.yaml` selecting the local `protoc-gen-es` plugin with `target=ts`, and add package script `generate:google-migration` that runs the pinned local `buf generate` without managed/remote plugins. Record package/version/license, repository/release recency, browser/ESM support, transitive dependency count, generated-code policy, CSP/dynamic-evaluation scan, and production audit result in `docs/architecture/dependencies.md` and the ledger. Check in the minimal reviewed `.proto` and deterministic generated TypeScript so normal builds require no network or runtime code generation.

- [ ] **Step 4: Implement schema-based decoding without wire primitives**

  Decode URL-safe Base64 with bounded platform helpers, then use `fromBinary(MigrationPayloadSchema, bytes)` (or the exact 2.13.0 equivalent). Do not implement varints, tags, field numbers, wire types, byte cursors, or manual protobuf parsing. Validate batch metadata and aggregate limits before candidate conversion. Clear decoded mutable bytes in `finally`. Preserve HOTP counter; map only documented enums; reject unknown/unsupported values.

- [ ] **Step 5: Run GREEN and primitive scan**

  Run: `pnpm exec vitest run packages/importers/test/google-migration.test.ts packages/importers/test/import-model.test.ts`

  Expected: PASS.

  Run: `rg -n "readVarint|writeVarint|wireType|fieldNumber|>>> 7|& 0x7f" packages/importers/src/google-migration.ts`

  Expected: no matches; all wire work is library/generated-schema owned.

- [ ] **Step 6: Review gate**

  A reviewer compares the `.proto` fields/enums to the public Google migration schema, checks generated provenance, lockfile pin, license/browser/CSP notes, limit order, buffer cleanup, and absence of manual wire primitives. Close all Critical/Important findings before Task 4.

## Task 4: Parse supported Aegis and Ente exports with deterministic detection

**Files:**

- Create: `packages/importers/src/aegis.ts`
- Create: `packages/importers/src/ente-export.ts`
- Create: `packages/importers/src/detect.ts`
- Create: `packages/importers/test/aegis.test.ts`
- Create: `packages/importers/test/ente-export.test.ts`
- Create: `packages/importers/test/detect.test.ts`
- Modify: `packages/importers/src/index.ts`
- Modify: `.sdd/project1-task9-execution-ledger.md`

**Interfaces:**

- Consumes: Tasks 1–3 parsers/types/limits.
- Produces: `parseAegisExport`, `parseEnteExport`, and `parseOtpImportText` with the shared signatures.

- [ ] **Step 1: Write failing format tests**

  Use synthetic in-memory objects with safe metadata. Aegis tests cover supported unencrypted version/database entry discriminators, TOTP/HOTP/Steam, algorithm/digits/period/counter, issuer/name, note/favorite/tags where documented, missing optional metadata defaults, unknown version/type, encrypted/password-protected export rejection, malformed strict shapes, and item/text limits. Ente tests cover the explicitly supported local export discriminator/version and OTP details, TOTP/HOTP/Steam semantics, metadata preservation, unsupported encrypted/export/sync envelopes, remote-state fields ignored rather than imported, malformed/ambiguous objects, and bounds. Detection tests prove migration URI first, multiline otpauth second, exact Aegis discriminator third, exact Ente discriminator fourth, with arbitrary/ambiguous JSON and prose rejected.

- [ ] **Step 2: Run RED**

  Run: `pnpm exec vitest run packages/importers/test/aegis.test.ts packages/importers/test/ente-export.test.ts packages/importers/test/detect.test.ts`

  Expected: FAIL because parsers/detector do not exist.

- [ ] **Step 3: Implement strict schemas and conversion**

  Parse JSON only after byte/scalar bounds. Use strict Zod schemas for supported envelope versions and separately strict entry schemas. Never recursively hunt for likely seed fields. Convert each supported entry through the common candidate validator, return fixed row rejection reasons for entry-local failures, and fail the whole document for an unsupported/ambiguous envelope or global bound. Ente parsing is static local interoperability only and imports no remote ID, key, token, pending operation, sync state, or server URL.

- [ ] **Step 4: Run GREEN and detection fuzz boundary**

  Run: `pnpm exec vitest run packages/importers/test/aegis.test.ts packages/importers/test/ente-export.test.ts packages/importers/test/detect.test.ts`

  Expected: PASS with deterministic classification independent of JSON property order.

- [ ] **Step 5: Review gate**

  Review against sanitized authorized format evidence; verify no undocumented format is accepted, no Ente sync/backup authority appears, all supported semantics survive, global versus row rejection is deterministic, and error/projection text contains no raw values.

## Task 5: Decode local QR/image input in a dedicated bounded worker and audit CSP

**Files:**

- Create: `packages/importers/src/qr.ts`
- Create: `packages/importers/test/qr.test.ts`
- Create: `apps/extension/src/vault/otp/import/otp-import-worker.ts`
- Create: `apps/extension/src/vault/otp/import/image-import-executor.ts`
- Create: `apps/extension/test/vault/image-import-executor.test.ts`
- Modify: `packages/importers/src/index.ts`
- Modify: `packages/importers/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/extension/src/manifest.ts`
- Modify: `tests/security/manifest.test.ts`
- Modify: `tests/security/csp.test.ts`
- Modify: `tests/security/output/manifest.output.ts`
- Modify: `scripts/scan-build.mjs`
- Modify: `tests/security/build-scan.test.ts`
- Modify: `docs/architecture/dependencies.md`
- Modify: `docs/architecture/permissions.md`
- Modify: `.sdd/project1-task9-execution-ledger.md`

**Interfaces:**

- Produces: `ImageImportExecutor.decode(file: Blob, signal: AbortSignal): Promise<string>`, strict worker request `{ version: 1; requestId: string; bytes: ArrayBuffer }`, strict success `{ version: 1; requestId: string; kind: "decoded"; payload: string }`, and fixed failure `{ version: 1; requestId: string; kind: "failed"; code: "IMAGE_INVALID" | "IMAGE_LIMIT" | "QR_NOT_FOUND" }`.
- Consumes: `IMPORT_LIMITS`, `jsqr` 1.4.0, browser-owned local Blob/File, and Task 4 text detector after decode.

- [ ] **Step 1: Write worker/executor RED tests**

  Test pre-read 8 MiB file cap, post-decode width/height 4,096 cap, 16,777,216 pixel cap using overflow-safe multiplication, one QR only, 1 MiB UTF-8 payload cap, no QR, malformed image, worker timeout, abort, stale/wrong request ID, unknown result fields, lock/unmount termination, and synchronous clearing of main-thread and worker mutable buffers. Assert no request contains filename, MIME-derived trust decision, sender identity, preview ID, vault data, or callback.

- [ ] **Step 2: Run RED**

  Run: `pnpm exec vitest run packages/importers/test/qr.test.ts apps/extension/test/vault/image-import-executor.test.ts`

  Expected: FAIL because worker contracts and executor do not exist.

- [ ] **Step 3: Pin and review QR dependency**

  Add exact `jsqr` `1.4.0` through the strict catalog/lockfile. Record maintenance status, MIT license, browser compatibility, no network behavior, no dynamic evaluation, transitive count, and rationale for containing this older but audited decoder in a dedicated worker with strict resource limits. Do not use a CDN or runtime import.

- [ ] **Step 4: Implement bounded worker flow**

  The trusted vault page checks `Blob.size`, copies bytes to a fresh transferable buffer, clears its mutable view immediately after `postMessage`, and starts a dedicated module worker. Worker validates the request, creates an image bitmap locally, checks dimensions/pixels before canvas allocation/readback, decodes once with `jsQR`, checks encoded payload bytes, closes bitmap, clears pixels/bytes in `finally`, and returns only bounded text/fixed failure. Executor accepts one terminal response, validates request ID/schema, terminates immediately, and ignores stale output. Use a fixed 10-second timeout.

- [ ] **Step 5: Audit unchanged authority and run GREEN**

  Run: `pnpm exec vitest run packages/importers/test/qr.test.ts apps/extension/test/vault/image-import-executor.test.ts tests/security/manifest.test.ts tests/security/csp.test.ts tests/security/build-scan.test.ts`

  Expected: PASS; source manifest still has exactly `storage`, `alarms`, `idle` and the exact existing CSP.

  Run: `rg -n "getUserMedia|camera|MediaDevices|fetch\(|XMLHttpRequest|WebSocket|importScripts|https?://|console\.log" apps/extension/src/vault/otp/import packages/importers/src/qr.ts`

  Expected: no matches.

- [ ] **Step 6: Review gate**

  Inspect fresh built worker output: local packaged URL only, no source map, remote URL, dynamic code, inline code, camera/clipboard permission, network sink, raw input log, or main-thread image decode. Review byte/dimension/pixel checks before allocations and all cleanup paths.

## Task 6: Add vault-only messaging and session-owned atomic batch import

**Files:**

- Create: `packages/messaging/src/otp-import.ts`
- Create: `packages/messaging/test/otp-import.test.ts`
- Create: `apps/extension/src/background/otp/import-service.ts`
- Create: `apps/extension/test/background/otp-import-service.test.ts`
- Modify: `packages/storage/src/vault-repository.ts`
- Modify: `packages/storage/test/vault-repository.test.ts`
- Modify: `packages/storage/src/index.ts`
- Modify: `apps/extension/src/background/vault/session-vault-repository.ts`
- Modify: `apps/extension/test/background/session-vault-repository.test.ts`
- Modify: `packages/messaging/src/index.ts`
- Modify: `packages/security/src/errors.ts`
- Modify: `packages/security/test/errors.test.ts`
- Modify: `apps/extension/src/background/router.ts`
- Modify: `apps/extension/test/background/router.test.ts`
- Modify: `apps/extension/src/background/main.ts`
- Modify: `apps/extension/test/background/background-runtime.integration.test.ts`
- Modify: `apps/extension/src/platform/extension-platform.ts`
- Modify: `apps/extension/src/platform/chrome-platform.ts`
- Modify: `apps/extension/test/platform/chrome-platform.test.ts`
- Modify: `.sdd/project1-task9-execution-ledger.md`

**Interfaces:**

- Consumes: shared contracts, `SenderContext`, `SessionVaultRepository`, existing session epoch/root coordination, `OtpItemSchema`, immutable generation/journal APIs.
- Produces: exact `OtpImportRequest`, `OtpImportResponse`, `OtpImportService`, `SessionVaultRepository.importOtpBatch`, and `ImportOtpBatchResult` contracts above; `ExtensionPlatform.sendOtpImportMessage(request): Promise<OtpImportResponse>`.

- [ ] **Step 1: Write messaging and service RED tests**

  Messaging tests cover strict version 1, unknown fields, exact input/row/count/ID/timestamp bounds, preview minimization, response pairing, vault-only exact URL/document sender policy, and popup/content/wrong-document rejection. Service tests cover preview non-persistence, random IDs, document/session ownership, five-minute TTL, four-preview eviction, cancel idempotence without disclosure, lock/dispose/restart cleanup, no activity on preview/cancel/failure, activity after successful import, and synchronous raw/candidate cleanup.

- [ ] **Step 2: Write repository atomicity RED tests**

  Cover empty batch, mixed accepted/new duplicate, exact semantic key including HOTP counter, duplicate against current vault, duplicate introduced between preview and confirm, concurrent confirms, one generated ID per inserted item only, metadata/default preservation, 1,000 items, total generation capacity, encrypted-record capacity, journal entries, one stage/verify/activate, stage/verify/preactivation/activation interruption, external root notification/race, lock at every await, retry after failed preactivation, and no partial insertion. Assert active generation ID changes exactly once on success and not at all on failure.

- [ ] **Step 3: Run RED**

  Run: `pnpm exec vitest run packages/messaging/test/otp-import.test.ts packages/storage/test/vault-repository.test.ts apps/extension/test/background/otp-import-service.test.ts apps/extension/test/background/session-vault-repository.test.ts apps/extension/test/background/router.test.ts apps/extension/test/platform/chrome-platform.test.ts`

  Expected: FAIL for missing schemas/service/batch bridge/routes.

- [ ] **Step 4: Implement strict message and fixed error boundaries**

  Add fixed safe codes/messages: `OTP_IMPORT_INVALID`, `OTP_IMPORT_LIMIT`, `OTP_IMPORT_EXPIRED`, `OTP_IMPORT_CAPACITY`, and `OTP_IMPORT_UNAVAILABLE`. Parse input before dispatch, authorize exact vault document, project candidate responses field-by-field, reparse the projected response, and map all raw parser/library/storage failures to fixed codes. `chrome-platform` reparses paired responses before UI return. No input-derived string is placed in `Error.message`.

- [ ] **Step 5: Implement in-memory preview ownership**

  `ImportService.handle` parses text/QR payload, loads current items through the session bridge for preview classification, allocates random preview/row UUIDs in background, stores candidates only in a private memory map keyed by preview ID plus exact sender binding/session epoch/expiry, and returns safe rows. Use one cleanup function for cancel/expiry/lock/dispose/confirm/error; clear candidate arrays and mutable inputs synchronously where practical. Never write preview state to browser storage.

- [ ] **Step 6: Implement serialized one-generation batch import**

  Add `VaultRepository.createBatch` behind `SessionVaultRepository.importOtpBatch`. Inside the existing mutation serialization, authenticate/load the exact active root once, reclassify candidates against current records and earlier accepted candidates, validate capacity and construct all new strict `OtpItem`s with background IDs/timestamps, encrypt all records/journal entries, then call existing commit once. Preserve activation coordinator and session epoch checks. Do not loop over existing `create`, expose repository/context, add caller root CAS, or activate multiple generations.

- [ ] **Step 7: Implement confirm race semantics**

  Confirmation atomically claims the preview so parallel confirm/cancel cannot both consume it, authenticates sender/session, calls `importOtpBatch` with the held full snapshot, and returns imported/current-duplicate counts only. A newly duplicate candidate is skipped; capacity/lock/root race aborts all. On uncertain activation, return fixed unavailable and rely on authenticated generation reconciliation; never retry blindly or report partial counts.

- [ ] **Step 8: Run GREEN integration**

  Run: `pnpm exec vitest run packages/messaging/test/otp-import.test.ts packages/storage/test/vault-repository.test.ts apps/extension/test/background/otp-import-service.test.ts apps/extension/test/background/session-vault-repository.test.ts apps/extension/test/background/router.test.ts apps/extension/test/background/background-runtime.integration.test.ts apps/extension/test/platform/chrome-platform.test.ts`

  Expected: PASS, including one-generation interruption and duplicate-race assertions.

- [ ] **Step 9: Review gate**

  Independently trace raw input from UI boundary to cleanup and candidate from parser to encrypted commit. Verify trusted-vault-only routing, background IDs, authenticated confirmation reclassification, one repository load/commit, non-CAS language, capacity abort, lock epoch checks, no context escape, and no candidate in responses/errors/logs.

## Task 7: Integrate the safe full-vault import UI with CRUD and migration

**Files:**

- Create: `apps/extension/src/vault/otp/import/OtpImportView.tsx`
- Create: `apps/extension/src/vault/otp/import/OtpImportView.module.css`
- Create: `apps/extension/src/vault/otp/import/useOtpImport.ts`
- Create: `apps/extension/test/vault/OtpImportView.dom.test.tsx`
- Modify: `apps/extension/src/vault/otp/OtpVaultView.tsx`
- Modify: `apps/extension/src/vault/otp/OtpVaultView.module.css`
- Modify: `apps/extension/test/vault/VaultApp.dom.test.tsx`
- Modify: `apps/extension/src/vault/VaultApp.tsx`
- Modify: `apps/extension/test/vault/VaultApp.dom.test.tsx`
- Modify: `apps/extension/test/vault/VaultApp.styles.test.ts`
- Modify: `.sdd/project1-task9-execution-ledger.md`

**Interfaces:**

- Consumes: `ExtensionPlatform.sendOtpImportMessage`, `ImageImportExecutor`, strict safe preview responses, existing OTP refresh/list/editor and `MigrationPanel`.
- Produces: `OtpImportView({ platform, active, onImported })`; on successful confirmation calls `onImported()` exactly once to refresh the existing CRUD list.

- [ ] **Step 1: Write failing DOM and state-machine tests**

  Test unlock-only visibility; `Import` opens a distinct mode without destroying list state; text area, local file chooser, and paste-event image; no camera/live scan/remote URL/backup/sync control; preflight byte limits; format summary and accepted/duplicate/rejected counts; safe metadata rows and fixed reasons; no secret/raw/note/tag/favorite/fingerprint DOM/accessibility content; explicit unchecked-by-default confirmation; disabled confirm for zero accepted; cancel/replace/lock/unmount synchronous clearing; file input reset; worker termination; stale response suppression; fixed error copy; keyboard focus restoration; Escape cancel; reduced motion; 200% compact reflow; import success refreshes existing list once; CRUD remains usable; and `MigrationPanel` remains present.

- [ ] **Step 2: Run RED**

  Run: `pnpm exec vitest run apps/extension/test/vault/OtpImportView.dom.test.tsx apps/extension/test/vault/VaultApp.dom.test.tsx apps/extension/test/vault/VaultApp.dom.test.tsx apps/extension/test/vault/VaultApp.styles.test.ts`

  Expected: FAIL because import UI/integration does not exist.

- [ ] **Step 3: Implement bounded input and synchronous redaction**

  Keep raw text/File/bytes out of React render output and reducer history. Before replacing or clearing, synchronously set text value to `""`, clear refs/state, reset `input.value`, abort/terminate worker, issue best-effort background cancel for an existing preview, then advance an operation token. Never derive React keys, labels, filenames, telemetry, or error text from input. Lock/`active=false` invokes the same cleanup before rendering the locked state.

- [ ] **Step 4: Implement safe preview and explicit confirmation**

  Render only schema-validated safe rows. Use neutral fixed wording for rejected/duplicate rows and announce counts, not secret-bearing values. Require a separate explicit checkbox `I reviewed the import summary` and a `Confirm import` button; cancel is visually primary until confirmation is checked. Confirmation sends only `previewId`. Disable all inputs during confirm, handle expiry/capacity/lock with fixed guidance, and clear all local/background state before invoking `onImported` after success.

- [ ] **Step 5: Integrate with current sharp vault architecture**

  Add import as a full-vault toolbar mode beside create, not in popup. Preserve `OtpVaultView` search/list/editor/delete/conflict behavior and `MigrationPanel`. Use compact square controls, coral rail only for selected/confirmed state, mono tabular counts, clear bordered classifications, no generic card grid/pills, visible focus, and CSS media/reduced-motion rules matching Task 8.

- [ ] **Step 6: Run GREEN and accessibility checks**

  Run: `pnpm exec vitest run apps/extension/test/vault/OtpImportView.dom.test.tsx apps/extension/test/vault/VaultApp.dom.test.tsx apps/extension/test/vault/VaultApp.dom.test.tsx apps/extension/test/vault/VaultApp.styles.test.ts`

  Expected: PASS with no serious axe violation in the import states and no secret/raw projection.

- [ ] **Step 7: Review gate**

  Review with keyboard-only, 200% zoom assumptions, reduced motion, locked transition, cancel/replacement, stale worker/background response, zero-accepted preview, and confirm failure. Inspect DOM snapshots for forbidden fields. Reject any popup/content import surface or any loss of CRUD/migration behavior.

## Task 8: Produce packaged browser and security evidence

**Files:**

- Create: `tests/browser/project1-otp-import.spec.ts`
- Create: `tests/browser/__screenshots__/vault-otp-import-preview-linux.png`
- Create: `tests/browser/__screenshots__/vault-otp-import-compact-linux.png`
- Modify: `apps/extension/src/manifest.ts`
- Modify: `tests/security/manifest.test.ts`
- Modify: `tests/security/csp.test.ts`
- Modify: `tests/security/output/manifest.output.ts`
- Modify: `scripts/scan-build.mjs`
- Modify: `tests/security/build-scan.test.ts`
- Modify: `docs/architecture/dependencies.md`
- Modify: `docs/architecture/permissions.md`
- Modify: `docs/architecture/runtime-boundaries.md`
- Modify: `docs/security/threat-model.md`
- Modify: `docs/security/invariants.md`
- Modify: `docs/security/release-checklist.md`
- Modify: `package.json`
- Create if needed: `.prettierignore.project1-task9`
- Modify: `.sdd/project1-task9-execution-ledger.md`

**Interfaces:**

- Consumes: Tasks 1–7 and existing packaged-extension fixture helpers.
- Produces: `test:project1:task9`, `format:check:project1:task9`, `verify:project1:task9:evidence`, `verify:project1:task9`, and `verify:project1:task9:local-node24` scripts.

- [ ] **Step 1: Add exact focused command scripts**

  Add:

  ```json
  {
    "test:project1:task9": "vitest run packages/importers packages/messaging packages/storage apps/extension/test/background apps/extension/test/platform apps/extension/test/vault",
    "format:check:project1:task9": "prettier --check . --ignore-path .prettierignore --ignore-path .prettierignore.project1-task9",
    "verify:project1:task9:evidence": "pnpm typecheck && pnpm lint && pnpm format:check:project1:task9 && pnpm dependencies && pnpm build:security && pnpm test && pnpm exec vitest run tests/browser/startup-diagnostics.test.ts tests/browser/startup-process-harness.test.ts && pnpm test:browser:built && pnpm exec vitest run tests/security tests/legacy && node scripts/verify-reproducible-build.mjs && pnpm audit --prod",
    "verify:project1:task9": "node scripts/check-engine.mjs --local-command=verify:project1:task9:local-node24 && pnpm verify:project1:task9:evidence",
    "verify:project1:task9:local-node24": "node scripts/check-engine.mjs --allow-node24 && pnpm verify:project1:task9:evidence"
  }
  ```

  If generated protobuf is ignored, `.prettierignore.project1-task9` contains exactly `packages/importers/src/generated/google-authenticator-migration_pb.ts`; otherwise keep it empty/absent. No handwritten file is ignored.

- [ ] **Step 2: Write packaged E2E before updating baselines**

  Build synthetic inputs in test memory: multiline URI, generated Google protobuf URI, unencrypted supported Aegis JSON, supported Ente JSON, and a locally generated QR PNG. Exercise fresh setup/unlock, safe preview, explicit confirmation, list refresh/edit/delete, metadata and HOTP counter preservation, exact duplicate within input/current vault, malformed/unsupported/oversized input, image byte/dimension/pixel bounds, cancel, lock while decoding/previewing/confirming, worker restart/interrupted generation, retry without double insertion, and encrypted persistence after extension restart. Assert no backup, sync, camera, popup, or content import path.

- [ ] **Step 3: Run packaged RED**

  Run: `pnpm build:security && pnpm exec playwright test tests/browser/project1-otp-import.spec.ts`

  Expected: FAIL until packaged worker paths, UI selectors, security scans, and fresh baselines are complete; record the actual behavioral failure, not a fabricated expected message.

- [ ] **Step 4: Complete source/output security assertions and docs**

  Assert exact manifest permissions/CSP; no camera/network/dynamic-code/remote asset/source map; worker is packaged locally; preview/result bundles have no secret fields; content/popup cannot invoke imports; raw values never appear in logs/snapshots/accessibility. Update threat model for malicious files, QR bombs, decompression/image bombs, protobuf expansion, ambiguous formats, duplicate races, interrupted batch, stale preview, lock/restart, shoulder-surfed metadata, and dependency compromise. State local-only, no guaranteed zeroization, no backup/Ente sync, and non-CAS semantics exactly.

- [ ] **Step 5: Run packaged GREEN and inspect visuals/runtime**

  Run: `pnpm build:security && pnpm exec playwright test tests/browser/project1-otp-import.spec.ts`

  Expected: PASS against fresh `dist/`.

  Review desktop and compact screenshots visually for sharp design, focus, count hierarchy, no secret/raw content, no clipping at 200% zoom, and safe confirmation hierarchy. Inspect vault page, popup, service-worker, and worker console messages; no unexpected errors/warnings or secret-shaped output.

- [ ] **Step 6: Run authority and artifact scans**

  Run: `rg -n "getUserMedia|camera|fetch\(|XMLHttpRequest|WebSocket|EventSource|console\.log|clipboard(Read|Write)|host_permissions|optional_host_permissions" apps/extension/src packages/importers/src packages/messaging/src dist/manifest.json`

  Expected: no new camera/network/log/clipboard/host authority; review existing comments/schema matches individually.

  Run: `pnpm exec vitest run tests/legacy/fixtures.test.ts`

  Expected: PASS, including the existing assertion that `artifactHashes` has exactly 17 entries and every preserved artifact file matches its pinned SHA-256. Do not create a second hash source of truth.

- [ ] **Step 7: Review gate**

  Independent security review covers dependencies/generated schema, worker/CSP/manifest, strict format bounds, vault-only messaging, snapshot ownership, atomic batch/interruption, redaction, UI/accessibility, built output, and exact17 preservation. Correct every Critical/Important finding and rerun the smallest affected RED/GREEN plus packaged E2E and security build.

## Task 9: Verify final acceptance and close bounded Task 9 evidence

**Files:**

- Modify: `.sdd/project1-task9-execution-ledger.md`

**Interfaces:**

- Consumes: Tasks 1–8, authoritative Task 9/foundation/Task 8/current architecture, independent reviews, and fresh command output.
- Produces: a closed Task 9 ledger with an explicit pass/fail/caveat for every acceptance gate. This task introduces no source behavior.

- [ ] **Step 1: Add a specification coverage matrix**

  Map ledger evidence to: import model/bounds/safe projection; URI/multiline; generated-schema Google protobuf/no wire primitives; Aegis; Ente local export/no sync; worker byte/dimension/pixel limits; local-only/no camera/network; strict detection; vault-only messaging; browser IDs/document/session ownership; no persistence before explicit confirm; duplicate key/no fingerprint; confirm-time authenticated reclassification; one-generation atomicity; non-CAS honesty; capacity/interruption/races; metadata/HOTP; CRUD/migration integration; synchronous redaction; safe sharp UI; packaged synthetic E2E; CSP/permissions; Node/Chrome blockers; and exact17. Mark missing evidence FAIL, not pending prose.

- [ ] **Step 2: Run the clean official focused gate under declared Node 22**

  Run: `pnpm install --frozen-lockfile && pnpm verify:project1:task9`

  Expected: PASS under Node `>=22.14.0 <23` and pnpm `10.14.0`. If only Node 24 is available, run `pnpm verify:project1:task9:local-node24`, label it development-only, leave the Node 22 blocker open, and do not claim official completion.

- [ ] **Step 3: Run full regression and production evidence**

  Run: `pnpm verify && pnpm test:browser:built && node scripts/verify-reproducible-build.mjs && pnpm audit --prod`

  Expected: PASS from the same fresh candidate. Record exact test counts, dependency audit result, browser binary/version, and candidate hashes. Actual Chrome/Chromium 110 packaged evidence is required to clear the minimum-browser blocker; later versions remain useful but insufficient.

- [ ] **Step 4: Run final secret/placeholder/authority inspections**

  Run: `rg -n "TO[D]O|T[B]D|implement[[:space:]]+later|fill[[:space:]]+in[[:space:]]+details|Similar[[:space:]]+to[[:space:]]+Task|console\\.log|getUserMedia|camera|fetch\\(|XMLHttpRequest|WebSocket|EventSource" packages/importers/src packages/messaging/src/otp-import.ts apps/extension/src/background/otp/import-service.ts apps/extension/src/vault/otp/import`

  Expected: no incomplete-work markers, production logs, camera, or network sinks.

  Run: `rg -n "secret|raw|uri|fingerprint|hash|note|tags|favorite|ente" packages/messaging/src/otp-import.ts apps/extension/src/vault/otp/import apps/extension/src/background/otp/import-service.ts`

  Expected: every legitimate match is confined to background candidate handling or explicit negative/redaction assertions; none appears in preview/result/accessibility/log contracts. Record reviewed matches rather than claiming zero matches.

- [ ] **Step 5: Perform final independent review and correction loop**

  A fresh reviewer reads the three authority documents, this supplement, changed files, dependency review, Task 9 ledger, generated schema provenance, and final outputs. The reviewer reports Critical, Important, and Minor findings; checks no Task 10–13 scope or git action; and verifies evidence lives only in the Task 9 ledger. Close every Critical/Important finding, rerun the smallest affected RED/GREEN test, then rerun Steps 2–4 and packaged import E2E.

- [ ] **Step 6: Close with bounded acceptance status**

  Mark Task 9 complete only when every software gate passes, Critical/Important findings are closed, Node 22 and Chrome 110 blockers are cleared, exact17 is preserved, and the tested artifact equals the reviewed artifact. State that Task 9 adds local OTP imports only; backup export/import, page autofill, Ente sync, and Project 1 release completion remain unimplemented. If an environment blocker remains, record implementation status separately and stop release acceptance.

## Final acceptance gates

- [ ] All import formats are strictly detected, bounded before expensive work and after expansion, and use fixed safe errors.
- [ ] `otpauth://`, multiline, Google migration, supported unencrypted Aegis, and supported static Ente export preserve issuer/label/type/algorithm/digits/period/HOTP counter and supported note/tags/favorite semantics.
- [ ] Google protobuf uses pinned `@bufbuild/protobuf` 2.13.0 and checked-in reviewed generated schema; no hand-written wire primitive exists.
- [ ] Image decoding is local in a dedicated packaged worker with exact byte/dimension/pixel/payload bounds, timeout/abort, stale-result rejection, and cleanup.
- [ ] No network, camera permission/live capture, backup export/import, Ente sync, popup import, or content import is present.
- [ ] Preview is explicit, non-persistent, safe-projection-only, browser-ID/document/session bound, TTL/capacity bounded, and cleared on cancel/lock/restart/replacement/error/confirm.
- [ ] Raw input, image/protobuf bytes, seeds, candidates, and full items never enter previews, logs, errors, content, snapshots, accessibility text, storage, clipboard, or background IDs.
- [ ] Duplicate equality uses the exact semantic key, includes HOTP counter, exposes no fingerprint/hash/key, and first-wins within a batch.
- [ ] Confirmation reclassifies the authenticated held snapshot against the current vault and handles newly introduced duplicates/races deterministically.
- [ ] Confirmed accepted items commit all-or-nothing in exactly one staged, verified, authenticated, activated immutable generation; capacity/lock/interruption leaves no partial import.
- [ ] Repository/session design makes no false root-CAS claim and adds no caller root/context/repository capability.
- [ ] Full-vault UI requires explicit confirmation, synchronously redacts local state, remains safe/sharp/accessible/responsive, refreshes existing CRUD, and preserves `MigrationPanel`.
- [ ] Packaged synthetic E2E covers all formats, QR/image, duplicates, bounds, lock, interruption, restart, metadata/HOTP preservation, and no secret leakage.
- [ ] Manifest permissions remain exactly `storage`, `alarms`, `idle`; exact CSP remains unchanged; built worker and output pass security scans.
- [ ] Existing Task 1–8, migration, storage, HOTP, browser, reproducibility, dependency, and production audit gates pass.
- [ ] All exact 17 preserved legacy artifact hashes remain unchanged.
- [ ] Official Node 22 and actual Chrome/Chromium 110 blockers are cleared; Node 24/later-Chromium results alone are not called official acceptance.
- [ ] Every task review and final result is recorded only in `.sdd/project1-task9-execution-ledger.md`, created during implementation Task 1 after its genuine RED result.
- [ ] No Git/worktree/commit operation and no Task 10–13 implementation occurred.
