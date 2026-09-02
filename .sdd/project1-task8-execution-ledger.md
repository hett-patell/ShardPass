# Project 1 Task 8 Execution Ledger

## Evidence boundary and provenance

Date: 2026-08-10
Scope: Task 1 only — session-owned repository bridge and authenticated root coordination.

Provenance labels used in this ledger:

- **Direct command evidence** — command executed in this Task 8 session; exit status and summarized output are recorded from that invocation.
- **Expected RED interpretation** — explanation of why a failing test is the intended pre-implementation result, based on the Task 1 plan and observed output.
- **Static self-review** — source-level inspection performed in this Task 8 session; it is not a substitute for command evidence.
- **Unverified** — planned or asserted behavior without fresh command or source evidence; it must not be described as passing.

This ledger is Task 8-only. It does not amend or rely on Task 7 evidence/provenance records.

## Task 1 — Session-owned repository bridge and authenticated root coordination

Status: In progress.

### Pre-edit context review

**Static self-review:** Read the complete Task 1 section and the plan's global constraints; current `SessionService`, `VaultRepository`, and `GenerationStore`; Chrome local-storage root-change dispatch; opaque migration capability/stage patterns; and focused session/storage tests before production edits.

### RED evidence

**Direct command evidence:** `pnpm exec vitest run packages/storage/test/vault-repository.test.ts apps/extension/test/background/session-vault-repository.test.ts apps/extension/test/background/session-service.test.ts`

Observed exit code: 1. Vitest reported 2 failed files / 1 passed file; 2 failed tests / 37 passed tests. The bridge suite could not import the not-yet-created `session-vault-repository` module. The two new storage coordinator tests failed because their observed hook order was empty rather than `before, after` and `before, failed`.

**Expected RED interpretation:** This is the intended pre-implementation failure: the session bridge module and activation coordinator behavior do not yet exist. Existing focused `SessionService` tests remained green (20/20), so RED was caused by the new Task 1 surface rather than an unrelated regression.

### GREEN and regression evidence

**Direct command evidence:** `pnpm exec vitest run packages/storage apps/extension/test/background/session-vault-repository.test.ts apps/extension/test/background/session-service.test.ts apps/extension/test/background/migration-service.test.ts apps/extension/test/background/migration-destination.test.ts`

Observed exit code: 0. Vitest reported 12 passed files and 148 passed tests. This covered the storage package, bridge tests, session tests, migration service tests, and migration destination tests.

**Direct command evidence:** `pnpm typecheck`

Observed exit code: 0. TypeScript completed with no diagnostics. The environment emitted the pre-existing engine warning because this execution used Node 24.18.0 while the project requires Node `>=22.14.0 <23`; pnpm was the pinned 10.14.0.

**Direct command evidence:** `pnpm lint`

Observed exit code: 0 after correcting seven `require-await` findings introduced by the first implementation pass. The same Node-version warning was emitted.

**Direct command evidence:** `pnpm exec prettier --check apps/extension/src/background/vault/session-vault-repository.ts apps/extension/src/background/vault/session-service.ts apps/extension/test/background/session-vault-repository.test.ts apps/extension/test/background/session-service.test.ts packages/storage/src/vault-repository.ts packages/storage/src/index.ts packages/storage/test/vault-repository.test.ts .sdd/project1-task8-execution-ledger.md`

Observed exit code: 0; all Task 1 matched files used Prettier style.

**Direct command evidence:** A final combined gate reran the exact 148-test regression command followed by `pnpm typecheck`, `pnpm lint`, and the Task 1 Prettier check. Observed exit code: 0; 12/12 files and 148/148 tests passed, typecheck and lint emitted no diagnostics, and all matched Task 1 files passed Prettier.

**Direct command evidence:** `pnpm format:check`

Observed exit code: 1 only because the pre-existing protected Task 7 recovery artifact `.sdd/recovery/project1-task7-contaminated-execution-ledger-2026-08-10.md` is not Prettier-formatted. This Task 8 execution did not modify that Task 7 provenance file. The focused Task 1 Prettier command above passed.

### Changed files and review outcome

Changed in Task 1:

- `apps/extension/src/background/vault/session-vault-repository.ts` (created)
- `apps/extension/test/background/session-vault-repository.test.ts` (created)
- `apps/extension/src/background/vault/session-service.ts`
- `apps/extension/test/background/session-service.test.ts`
- `packages/storage/src/vault-repository.ts`
- `packages/storage/src/index.ts`
- `packages/storage/test/vault-repository.test.ts`
- `.sdd/project1-task8-execution-ledger.md` (created)

**Static self-review:** No Critical or Important findings remained after tracing coordinator order and cleanup, notification-before/after serialization, exact activated-root authentication, epoch and explicit-lock wins, external replacement/deletion fail-closed behavior, callback context lifetime, bridge enumerable surface, and migration regression behavior. The bridge exposes only the seven OTP-domain methods; its callback receives a per-operation context containing a copied DEK that is overwritten in `finally`, so retaining the callback arguments does not retain a usable context after settlement. No Task 7 evidence/provenance file was modified.

Residual limitation: storage activation remains the existing generation-store compare-before-write sequence, not a true atomic storage CAS. A competing write can occur around activation; the bridge authenticates the exact target afterward, updates `expectedRoot` only after that authentication, locks on competing/uncertain outcomes, and does not report ambiguous activation failure as success.

Status: Task 1 implementation and its focused gate are complete; Task 2 was not started. Repository-wide `pnpm format:check` remains blocked solely by the untouched protected Task 7 recovery artifact described above.

## Fix round 1/5 — reviewer corrections

### Finding verification and correction of prior claims

**Static self-review:** The Critical finding is verified. `SessionService.runRepositoryRead` and `runRepositoryMutation` were public generic methods whose callbacks received `VaultRepository` and `VaultCryptoContext`; a caller could return or retain those values despite the copied DEK later being overwritten. The prior line 70 claim that callback lifetime prevented a usable escape was overstated and is superseded by this append-only correction.

**Static self-review:** The Important finding is verified. `handleActiveRootChange` entered only through `mutationMutex`, so a notification crossing a repository mutation was processed after mutation settlement. If storage had returned to the candidate, the notification could be treated as stale/intentional and the mutation could report normal success. The prior external-root-preservation wording is superseded: the underlying compare-before-write activation is not atomic CAS and cannot preserve an external value written in the narrow compare/write window. The enforceable guarantee is observation-bound detection and fail-closed locking without normal success when a non-candidate notification crosses activation.

### RED

**Direct command evidence:** `pnpm exec vitest run apps/extension/test/background/session-vault-repository.test.ts apps/extension/test/background/session-service.test.ts packages/storage/test/vault-repository.test.ts`

Observed exit code: 1. Vitest reported 1 failed file / 2 passed files and 9 failed tests / 39 passed tests. The API-boundary test observed that the generic methods were present and the stable `session.vaultRepository` did not exist; remaining bridge tests consequently failed on the missing stable bridge. This is the expected RED for the reviewed API correction before production edits.

### GREEN, regressions, and review outcome

**Direct command evidence:** `pnpm exec vitest run packages/storage apps/extension/test/background/session-vault-repository.test.ts apps/extension/test/background/session-service.test.ts apps/extension/test/background/migration-service.test.ts apps/extension/test/background/migration-destination.test.ts`

Observed exit code: 0. Vitest reported 12 passed files and 155 passed tests. The controlled bridge suite has 12 tests covering the stable API boundary, intentional notification, explicit-lock/read race, non-candidate notification before candidate write, external root immediately before candidate write, notification between candidate write and `afterActivate`, reentrant candidate notification without deadlock, failure before write, ambiguous failure after write, candidate authentication failure, malformed replacement, competing root, and deletion. Storage, session, migration service, and migration destination regressions remained passing.

**Direct command evidence:** Final combined gate ran the same 155-test command followed by `pnpm typecheck`, `pnpm lint`, and `pnpm exec prettier --check apps/extension/src/background/vault/session-vault-repository.ts apps/extension/src/background/vault/session-service.ts apps/extension/test/background/session-vault-repository.test.ts apps/extension/test/background/session-service.test.ts packages/storage/src/vault-repository.ts packages/storage/src/index.ts packages/storage/test/vault-repository.test.ts .sdd/project1-task8-execution-ledger.md`.

Observed exit code: 0. Tests were 12/12 files and 155/155 tests; typecheck and lint completed without diagnostics; focused Prettier passed. Node 24.18.0 produced the known engine warning against the required Node 22 range; pnpm was 10.14.0.

**Static self-review:** The public generic callback methods are removed at both runtime and compile-time boundaries. `SessionService` constructs and owns one frozen `vaultRepository`; its only public repository surface is the seven domain methods. Repository/context callbacks now exist only in private methods and cannot be supplied or received by a consumer. Root notifications record whether they matched the active commit candidate before waiting on the mutation mutex. Each repository operation binds the starting observation sequence and epoch; any later non-candidate/malformed/deletion observation forces lock and `VAULT_LOCKED`, including when storage has subsequently returned to the candidate. Candidate notifications remain intentional and do not deadlock. Activation failure after an authenticated candidate write is deliberately treated as ambiguous and locked rather than returned as normal success.

Residual non-CAS scope: `GenerationStore.activate` remains the existing compare-before-write sequence, not an atomic storage CAS. The implementation cannot prevent a competing external value from being overwritten in the narrow window after comparison and before the candidate write. It detects browser-delivered non-candidate root notifications crossing the bound operation and fails closed without normal success; it cannot claim preservation of the external value or detection of a change for which the platform emits no notification. Migration and `GenerationStore` semantics were not weakened or changed in this fix round.

Fix round 1/5 status: Critical and Important reviewer findings corrected; no Critical or Important self-review finding remains. Task 2 was not started, and no Task 7 file was modified.

## Fix round 2/5 — runtime privacy and delayed notification classification

### Finding verification and RED

**Static self-review:** The Critical finding is verified. TypeScript `private runRepositoryOperation` and `private runRepositoryOperationWhileMutationHeld` compile to runtime-visible prototype methods, and both accept callbacks receiving `VaultRepository` and `VaultCryptoContext`. Round 1's claim that callback execution was absent from the runtime surface was therefore incomplete and is superseded by this append-only correction. The project targets ES2022, which supports ECMAScript `#private` methods in the required Chrome runtime.

**Static self-review:** The Important finding is verified. Synchronous classification recognized only `commitCandidate`; a delayed notification for the currently authenticated `expectedRoot` crossing a later operation was marked non-candidate and caused a false lock. Exact-root classification must recognize either `expectedRoot` or `commitCandidate`, while the queued authenticated storage read remains authoritative and locks on an actual mismatch.

**Direct command evidence:** `pnpm exec vitest run apps/extension/test/background/session-vault-repository.test.ts`

Observed exit code: 1. Vitest reported 1 failed file, 5 failed tests, and 11 passed tests. Runtime prototype scanning found `runRepositoryOperation`; delayed own-root notifications crossing a read and mutations before/after candidate establishment falsely locked. The forged stale expected-root test reached the authoritative authenticated read and returned `VAULT_UNAVAILABLE`, confirming that notification classification did not mask the storage mismatch; its initial expected error category was corrected to this existing fail-closed distinction before GREEN.

### GREEN, persisted outcomes, and round-2 review

**Direct command evidence:** `pnpm exec vitest run apps/extension/test/background/session-vault-repository.test.ts`

Observed exit code: 0. The focused bridge suite passed 16/16 tests after converting the universal callback executors to ECMAScript `#private` methods and recognizing exact canonical observations matching either authenticated `expectedRoot` or active `commitCandidate`.

**Direct command evidence:** `pnpm exec vitest run packages/storage apps/extension/test/background/session-vault-repository.test.ts apps/extension/test/background/session-service.test.ts apps/extension/test/background/migration-service.test.ts apps/extension/test/background/migration-destination.test.ts`

Observed exit code: 0. Vitest reported 12 passed files and 159 passed tests. Storage, session, repository, interruption, migration destination, and migration service regressions remained passing.

**Direct command evidence:** `pnpm typecheck`, `pnpm lint`, and the focused Task 8.1 Prettier check each exited 0 after correcting one test-only `StorageValue` typing diagnostic. Node 24.18.0 emitted the known engine warning against the required Node 22 range; pnpm was 10.14.0.

**Static self-review:** `SessionService` now uses ES2022-native `#runRepositoryOperation` and `#runRepositoryOperationWhileMutationHeld`; neither appears in `Reflect.ownKeys` of the instance or prototype. Compile-time tests still reject the former public generic methods, the bridge remains frozen, stable, and limited to seven domain methods, and no universal dispatcher is exposed. Delayed own-root observations matching exact `expectedRoot` are intentional both before and after a later mutation establishes its own candidate. A stale expected-root notification cannot mask a real replacement because the queued authenticated active-root read remains authoritative and locks with `VAULT_UNAVAILABLE` on mismatch.

Controlled persisted outcomes are asserted explicitly:

- Failure before candidate write: the prior active root remains and authenticates.
- Failure after candidate write: the candidate root is persisted and authenticates, but the outcome is ambiguous, so the session locks and does not report success.
- Non-candidate replacement immediately before candidate write: the later candidate overwrites it due to non-CAS storage; the final candidate authenticates, but the observed crossing forces lock and rejection.
- Non-candidate replacement between candidate write and `afterActivate`: the replacement remains the final `ACTIVE_ROOT_KEY` and is unauthenticated/corrupt because it names no valid generation; the session locks.
- Malformed notification crossing activation: the candidate remains persisted and authenticates, while the observation forces lock.
- Candidate authentication failure: the candidate remains `ACTIVE_ROOT_KEY`, but its removed verification marker makes the persisted generation corrupt; the session locks.
- Competing replacement: the exact competing root remains persisted and is unauthenticated/corrupt; the session locks without overwriting it afterward.
- Deletion: `ACTIVE_ROOT_KEY` remains absent and the session reports unconfigured/locked behavior.

Residual non-CAS limitation: an external root written in the compare/write window can be overwritten by the candidate before notification settlement. Round 2 claims only detection of delivered crossing observations and fail-closed outcome, not preservation. Conversely, when the competing replacement occurs after the candidate write, it remains persisted. No guarantee exists for an external transition that produces no platform notification. `GenerationStore` and migration behavior were not changed.

Fix round 2/5 status: the runtime privacy and delayed-notification findings are corrected with explicit final storage/authentication assertions. Task 2 was not started, and no Task 7 file was modified.

## Task 2 — Strict OTP messages and fixed safe errors

Date: 2026-08-10
Status: Complete; Task 3 was not started.

### Pre-edit context review

**Static self-review:** Read the complete Task 2 section and global constraints, the supplemental Task 3/4 consumers needed to define projection and HOTP lifecycle fields, current domain OTP/item bounds and invariants, reservation identifiers/TTL semantics, messaging strict-object/discriminated-union and sender-context patterns, existing fixed `SafeError` mapping, and the complete prior Task 8 ledger before production edits.

### RED evidence

**Direct command evidence:** `pnpm exec vitest run packages/messaging/test/otp.test.ts packages/security/test/errors.test.ts`

Observed exit code: 1. The new messaging suite could not resolve the not-yet-declared `@shardpass/domain` dependency needed for canonical bounds and therefore collected 0 tests. The security suite collected 14 tests and reported 9 failures / 5 passes: all eight new OTP/clipboard codes mapped to `message: undefined`, and the explicit non-reflection assertion failed. This was the expected pre-implementation failure for the missing canonical messaging dependency/contracts and safe-error allowlist; no production OTP schema, export, or safe-error code had been added before this run.

### Implementation chronology

**Direct command evidence:** `pnpm install --lockfile-only` and `pnpm install --offline --frozen-lockfile` each exited 0 after adding the existing workspace `@shardpass/domain` package as an explicit messaging dependency. pnpm remained 10.14.0; the environment emitted the known warning because Node was 24.18.0 instead of the required Node 22 range. No external runtime or development package/version was added.

**Direct command evidence:** The first focused post-implementation run exited 1 with the 14 security tests passing and the messaging module failing during collection because Zod Mini does not expose a public union `.options` array. After replacing that construction with named strict branches, the next focused run collected 25 tests and had 24 pass / 1 fail; the failure was a test fixture using `ABCDE`, which correctly contains Steam-forbidden `A` and `E`. Correcting the fixture to an allowed five-character Steam alphabet value produced a focused 25/25 pass. The final schema was then simplified to the exact plan-level `OtpCodeProjection` shape with a strict type-dependent refinement and the response union was made discriminated by `kind` to avoid downgrade/branch ambiguity.

### GREEN and regression evidence

**Direct command evidence:** `pnpm exec vitest run packages/messaging packages/security`

Observed exit code: 0. Vitest reported 8 passed files and 101 passed tests, including all OTP request/response, policy, bound, invariant, projection-minimization, fixed-error, legacy foundation, vault, migration, sender-context, and authorization tests.

**Direct command evidence:** `pnpm typecheck`

Observed exit code: 0 with no TypeScript diagnostics. The known Node 24.18.0 versus required Node 22 engine warning was emitted.

**Direct command evidence:** `pnpm lint`

Observed exit code: 0 with no ESLint diagnostics. The same engine warning was emitted.

**Direct command evidence:** Initial focused Prettier check reported only the two new OTP source/test files as unformatted. `pnpm exec prettier --write packages/messaging/src/otp.ts packages/messaging/test/otp.test.ts` corrected them.

**Direct command evidence:** Final combined gate `pnpm exec vitest run packages/messaging packages/security && pnpm typecheck && pnpm lint && pnpm exec prettier --check packages/messaging/src/otp.ts packages/messaging/src/index.ts packages/messaging/test/otp.test.ts packages/messaging/package.json packages/security/src/errors.ts packages/security/test/errors.test.ts pnpm-lock.yaml` exited 0. It reported 8/8 files and 101/101 tests passing, no typecheck or lint diagnostics, and all matched Task 2 files using Prettier style.

### Changed files and public interfaces

Changed in Task 2:

- `packages/messaging/src/otp.ts` (created)
- `packages/messaging/test/otp.test.ts` (created)
- `packages/messaging/src/index.ts`
- `packages/messaging/package.json`
- `packages/security/src/errors.ts`
- `packages/security/test/errors.test.ts`
- `pnpm-lock.yaml`
- `.sdd/project1-task8-execution-ledger.md` (append only)

Public messaging exports now include `OtpRequestSchema`, `OtpResponseSchema`, all ten named request schemas, all eight named response schemas, `OtpEditableInputSchema`, `OtpCreateInputSchema`, `OtpListItemProjectionSchema`, `OtpEditorProjectionSchema`, `OtpCodeProjectionSchema`, `otpSenderPolicy`, `MAX_OTP_SEARCH_QUERY_LENGTH`, `MAX_OTP_LIST_ITEMS`, and inferred `OtpRequest`, `OtpResponse`, `OtpCommandKind`, `OtpEditableInput`, `OtpCreateInput`, `OtpListItemProjection`, `OtpEditorProjection`, and `OtpCodeProjection` types. Public security `SafeErrorCode` now includes the eight exact Task 2 codes, each with one fixed non-reflective message.

### Independent self-review gate

**Static self-review:** Compared every field against the supplemental interfaces and downstream Task 3/4 shapes. Requests and responses are strict version-1 objects; top-level unions are discriminated by exact `kind`; every UUID, positive revision, counter, remaining duration, expiry, string, tag array, query, and list allocation is bounded; numeric metadata is finite, integral, nonnegative/positive as appropriate, and capped at `Number.MAX_SAFE_INTEGER`. Editable create/update data reuses canonical domain bounds and invariants while rejecting IDs, revisions, timestamps, state, Ente metadata, keys, roots, tokens, full records, passwords, and unknown fields. TOTP/HOTP/Steam combinations fail closed, with Steam statically explicit as SHA-1/five-character/30-second only.

**Static self-review:** List and mutation projections expose only ID, revision, issuer, label, type, favorite, and tags; they reject seed, secret, note, code, timestamps, Ente metadata, and full-record extras. Delete exposes only ID/revision. The single-item TOTP/Steam code projection is bounded and has no seed. HOTP reservation exposes only reservation/item identifiers, item revision, counter, bounded code, and expiry; commit and cancel carry explicit reservation identifiers and terminal revision/counter or cancellation outcome. An empty `otp.listResult` is the only list-shaped locked projection and has zero account metadata/count/IDs; later service/router locked errors must remain fixed safe errors rather than adding a metadata-bearing locked payload.

**Static self-review:** `otp.getEditor`, create, update, and delete are vault-only and document-bound. List/getCode/copyCode are exact popup-or-vault and document-bound. Reserve/commit/cancel are content-only and require browser-owned tab, frame, and document binding; request schemas accept none of those sender-owned fields. Content is denied every list/editor/CRUD/display/copy command by the exact policy map. The editor schema is the sole response schema containing a secret; its policy is vault-only. Concealed-by-default rendering remains a downstream vault UI responsibility and was not implemented early. Safe errors use fixed allowlisted strings and ignore arbitrary input.

No Critical or Important self-review finding remains. No `OtpService`, router/runtime wiring, UI behavior, Task 3 source/test, or Task 7 evidence/provenance file was created or modified. Known downstream dependencies: Task 3 must generate background-owned IDs/revisions/timestamps and return only these schemas; Task 4 must derive HOTP binding solely from trusted content sender context and implement the declared reservation terminal semantics; Task 5 must authorize/reparse responses and ensure locked errors contain no account data; Task 7 must conceal the vault editor secret by default.

## Task 3 — OtpService search and CRUD

Date: 2026-08-10
Status: Complete; Task 4 was not started.

### Pre-edit context review

**Static self-review:** Read Task 3 and the global constraints; the approved Task 1 `SessionVaultRepository` bridge and session/root-race tests; Task 2 strict OTP messaging projections, policies, bounds, and fixed errors; domain `OtpItemSchema` metadata ownership and TOTP/HOTP/Steam invariants; repository create/update/tombstone revision behavior; `generateOtp` boundary semantics; reservation interface only for the required constructor dependency; and settings privileged-activity behavior. No Git/worktree operation was performed.

### RED evidence

**Direct command evidence:** `pnpm exec vitest run apps/extension/test/background/otp-service.test.ts`

Observed exit code: 1. Vitest reported one failed suite with zero collected tests because the plan-specified `apps/extension/src/background/otp/otp-service.ts` module did not exist. This was the expected Task 3 RED after the complete service test was created and before any production service code.

### Implementation and focused GREEN

Created `OtpService`, `OtpServiceError`, `OtpServiceErrorCode`, and `normalizeOtpSearch`. The service consumes only the frozen `SessionVaultRepository` domain bridge plus injected clock/ID/reservation/activity dependencies; it does not receive or expose a DEK, crypto context, root, wrapped key, or repository implementation. It validates requests and records with the existing strict schemas and reparses/freezes all responses.

The first focused implementation run collected 24 tests and reported 22 pass / 2 fail. Both were test expectation defects rather than production behavior defects: one attempted `not.toContain("")` for an empty note, and the missing-delete case expected conflict instead of the service's not-found result. The test fixtures/expectation were corrected without changing production behavior. The next focused run exited 0 with 24/24 tests passing. A subsequent typecheck exposed only readonly projection typing and test fixture constructor/type issues; narrow typing/fixture corrections were made and the combined typecheck plus focused suite passed.

### GREEN and regression evidence

**Direct command evidence:** `pnpm exec vitest run apps/extension/test/background/otp-service.test.ts apps/extension/test/background/session-vault-repository.test.ts apps/extension/test/background/session-service.test.ts packages/domain packages/otp packages/storage packages/messaging packages/security`

Observed exit code: 0. Vitest reported 27 passed files and 403 passed tests. This covered the 24 Task 3 service tests plus session bridge/root races, session locking, strict domain validation, TOTP/Steam known-answer generation, reservation regressions without lifecycle integration, encrypted storage/repository behavior, messaging schemas/policies, and safe-error mappings.

**Direct command evidence:** `pnpm typecheck`

Observed exit code: 0 with no TypeScript diagnostics. The environment emitted the known engine warning because Node was 24.18.0 while the project requires Node `>=22.14.0 <23`; pnpm remained the pinned 10.14.0.

**Direct command evidence:** `pnpm lint`

Observed exit code: 0 after correcting five test-only lint findings (`require-await` and throwing an unknown fixture value). No production lint finding was reported. The same Node engine warning was emitted.

**Direct command evidence:** `pnpm exec prettier --check apps/extension/src/background/otp/otp-service.ts apps/extension/test/background/otp-service.test.ts`

Observed exit code: 0 after formatting the new test file; both Task 3 files use Prettier style.

### Changed files and exact interfaces

Changed in Task 3:

- `apps/extension/src/background/otp/otp-service.ts` (created)
- `apps/extension/test/background/otp-service.test.ts` (created)
- `.sdd/project1-task8-execution-ledger.md` (this append-only evidence entry)

Public Task 3 interfaces are `OtpServiceErrorCode` with `VAULT_LOCKED`, `VAULT_UNAVAILABLE`, `OTP_INVALID`, `OTP_NOT_FOUND`, `OTP_CONFLICT`, `OTP_HOTP_REQUIRED`, `OTP_RESERVATION_INVALID`, `OTP_RESERVATION_STALE`, and `OTP_RESERVATION_UNCERTAIN`; `OtpServiceError(code)`; `OtpService` with the plan-specified repository, `{ now, isoNow }` clock, `{ next }` IDs, `HotpReservationService`, and `notePrivilegedActivity` constructor dependencies; `handle(request: OtpRequest, sender: SenderContext): Promise<OtpResponse>`; and `normalizeOtpSearch(value): string`.

### Independent self-review gate

**Static self-review:** Traced every projection and decrypted-record lifetime. List uses exact trimmed NFKC plus `toLocaleLowerCase("en-US")` normalization over issuer, label, and tags only; rejects note/secret/code/ID search; excludes null, deleted, invalid, unknown-kind, and metadata-raced records; sorts favorite first and then normalized issuer, normalized label, and raw ID; and returns newly allocated frozen item/tag/result arrays containing no secret, note, timestamps, schema/internal fields, or full record references. Editor rejects non-vault callers before repository access and returns only a fresh frozen editable projection with the seed. Mutation/code responses are likewise strict, freshly projected, and frozen.

**Static self-review:** Create builds ID/revision/timestamp/schema/kind metadata in the background, validates the complete `OtpItem`, and lets the repository normalize authoritative revision/timestamps. Update reads the current valid record, applies only the parsed editable fields, preserves immutable/background metadata, checks `expectedRevision`, and delegates increment/CAS to the bridge. Delete validates existence/current revision and delegates revision-bound tombstoning. Revision conflicts map to fixed `OTP_CONFLICT` and never overwrite; missing records map to fixed `OTP_NOT_FOUND`; all other session/storage/OTP failures map through an allowlisted code boundary without raw text reflection. Locked errors contain no item data, count, ID, query, seed, code, or projection.

**Static self-review:** Code generation handles exactly one valid TOTP or explicit valid Steam item using the injected millisecond clock and existing `generateOtp`; exact boundary `remaining`/`expiresAt` semantics and configured algorithm/digits/period are preserved. A second bridge read after generation makes lock or revision races fail closed before returning the code. HOTP display returns fixed `OTP_HOTP_REQUIRED` without mutation. Reservation commands return fixed `OTP_RESERVATION_INVALID` and do not touch the injected reservation service; Task 4 lifecycle work was not implemented. Privileged activity is awaited exactly once after successful intentional list/editor/CRUD/code/copy responses and never after validation, authorization, lock, conflict, generation race, HOTP deferral, lifecycle deferral, or another failure.

No Critical or Important self-review finding remains. Scope inspection found no key/context/root access, direct repository implementation, console logging, router/runtime composition, UI code, or HOTP lifecycle call in production. Task 4 must replace the fixed lifecycle deferral branches with sender-derived reservation binding and bridge receipt/commit integration. Task 5 must construct and route this service, enforce full runtime sender policy before `handle`, reparse responses at the router boundary, and publish lock-relevant state. No Task 4, Task 5, or UI file was created or modified.

### Final Task 3 verification

**Direct command evidence:** `pnpm exec vitest run apps/extension/test/background/otp-service.test.ts apps/extension/test/background/session-vault-repository.test.ts apps/extension/test/background/session-service.test.ts packages/domain packages/otp packages/storage packages/messaging packages/security && pnpm typecheck && pnpm lint && pnpm exec prettier --check apps/extension/src/background/otp/otp-service.ts apps/extension/test/background/otp-service.test.ts .sdd/project1-task8-execution-ledger.md && test ! -e apps/extension/test/background/otp-hotp-lifecycle.test.ts && ! rg -n "console\\.log|VaultCryptoContext|WrappedVaultKey|VaultRoot|decryptEnvelope|commitHotpReservation\\(|lookupHotpReservationReceipt\\(" apps/extension/src/background/otp/otp-service.ts`

Observed exit code: 0. Fresh final output reported 27/27 test files and 403/403 tests passing, typecheck and lint with no diagnostics, all three matched Task 3 files using Prettier style, no Task 4 lifecycle test file, and no production service match for logging, crypto-context/root access, direct decryption, or HOTP bridge commit/receipt calls. The environment again emitted only the known Node 24.18.0 versus required Node 22 engine warning. Task 3 is bounded complete; execution stopped before Task 4.

## Task 8.3 fix round 1/5 — snapshot listing and best-effort activity

Date: 2026-08-10
Status: Corrections implemented; Task 4 and Task 5 were not started.

### Finding verification and root cause

**Static self-review:** Both Important findings were verified. `OtpService.list` called `listMetadata()` and then `get()` for every metadata row. `VaultRepository.listMetadata()` already loaded and decrypted the complete active generation, while each `get()` loaded the generation again; a 10,000-item list therefore caused up to 10,001 authenticated generation reads/decrypt passes. Separately, `OtpService.handle` awaited `notePrivilegedActivity()` inside its result-producing `try`; an alarm/scheduling rejection entered the safe-error mapper after a successful repository mutation and changed a committed create/update/delete into `VAULT_UNAVAILABLE`.

### RED evidence

**Direct command evidence:** `pnpm exec vitest run apps/extension/test/background/otp-service.test.ts apps/extension/test/background/session-vault-repository.test.ts`

Observed exit code: 1. Vitest reported 2 failed files, 17 failed tests, and 32 passed tests. Service list tests failed because the fake bridge rejected legacy `listMetadata` use and the service had not called the new `listItems` snapshot; the 10,000-item test therefore could not observe one snapshot/zero gets. Six activity-rejection cases failed because successful create/update/delete/list/editor/code responses were replaced by `VAULT_UNAVAILABLE`. Bridge surface/snapshot tests failed because `listItems` did not exist. This was the expected pre-production RED. The first focused GREEN attempt then had 67/68 pass; the sole timeout was caused by a test deadlocking when it awaited `session.lock()` reentrantly from storage while the session mutation mutex was held. The test was corrected to use the established gate-and-concurrent-lock race pattern; production behavior was not changed for that test defect.

### Correction

Added `VaultRepository.listItems(context): Promise<readonly VaultItem[]>`, which performs one active-generation load and decrypt pass. Added the narrow eighth `SessionVaultRepository.listItems(): Promise<readonly OtpItem[]>` bridge method. `SessionService` invokes the storage snapshot inside the existing single repository operation, validates every result through `OtpItemSchema`, rejects deleted/invalid/unknown future records fail-closed with `VAULT_INVALID`, creates fresh objects and tag arrays, freezes every item/tag array and the outer snapshot, and returns only exact OTP domain records. The existing operation wrapper still authenticates the active root before and after, enforces the captured epoch, detects crossing root observations, and overwrites the copied operation DEK in `finally`; no callback, repository, context, key, root, or future non-OTP record crosses the bridge.

`OtpService.list` now calls `listItems()` exactly once and performs search, filtering, projection, and deterministic ordering over that authenticated snapshot without `listMetadata()` or per-item `get()`. The 10,000-item synthetic capacity test completes with one bridge snapshot call and zero item gets. Existing `get()` calls remain only for one-item editor/update/delete/code operations and the post-generation race check.

Activity scheduling remains attempted once after every successful intentional operation, but its rejection is contained by an empty non-reflective catch. It is consistently best-effort for list, editor, code/copy, create, update, and delete. Tests prove rejecting activity preserves all six response categories and that create/update/tombstone each commits exactly once with no retry, duplicate, ambiguity, or raw internal error exposure.

### GREEN and regression evidence

**Direct command evidence:** `pnpm exec vitest run apps/extension/test/background/otp-service.test.ts apps/extension/test/background/session-vault-repository.test.ts packages/storage/test/vault-repository.test.ts`

Observed exit code: 0. Vitest reported 3/3 files and 68/68 tests passing, including 31 service tests, 18 bridge/session boundary tests, and 19 storage repository tests. The capacity snapshot test completed in under one second without pathological encrypted setup.

**Direct command evidence:** `pnpm exec vitest run apps/extension/test/background/otp-service.test.ts apps/extension/test/background/session-vault-repository.test.ts apps/extension/test/background/session-service.test.ts apps/extension/test/background/migration-service.test.ts apps/extension/test/background/migration-destination.test.ts packages/storage packages/domain packages/otp packages/messaging packages/security`

Observed exit code: 0. Vitest reported 29/29 files and 430/430 tests passing, covering service, bridge, session/root races, storage, domain, OTP, messaging/security, and migration service/destination regressions.

**Direct command evidence:** `pnpm typecheck && pnpm lint && pnpm exec prettier --check` over the seven correction source/test files.

Observed exit code: 0. TypeScript and ESLint emitted no diagnostics, and every matched correction file used Prettier style. The environment emitted only the known Node 24.18.0 versus required Node 22 engine warning; pnpm remained 10.14.0.

### Changed files and review outcome

Changed in fix round 1/5:

- `packages/storage/src/vault-repository.ts`
- `packages/storage/test/vault-repository.test.ts`
- `apps/extension/src/background/vault/session-vault-repository.ts`
- `apps/extension/src/background/vault/session-service.ts`
- `apps/extension/test/background/session-vault-repository.test.ts`
- `apps/extension/src/background/otp/otp-service.ts`
- `apps/extension/test/background/otp-service.test.ts`
- `.sdd/project1-task8-execution-ledger.md` (append only)

**Static self-review:** The plan's original seven-method bridge surface is intentionally adapted to exactly eight methods by adding only `listItems`. `listMetadata` remains for existing consumers and compatibility but is no longer used by `OtpService`. Search semantics, ordering, projection minimization, lock redaction, code race checks, CRUD CAS behavior, and HOTP deferral are unchanged. No Critical or Important finding remains from this round. No HOTP lifecycle, router/runtime wiring, or UI code was added.

### Fix round 1/5 final verification

**Direct command evidence:** Fresh final combined gate reran the 29-file service/bridge/session/storage/domain/OTP/messaging/security/migration regression set, `pnpm typecheck`, `pnpm lint`, focused Prettier including this ledger, absence of the Task 4 lifecycle test file, and a production service audit for legacy list metadata/per-item-get loop, logging, and HOTP commit/receipt integration.

Observed exit code: 0. Vitest reported 29/29 files and 430/430 tests passing; the 10,000-item service snapshot test completed with one bridge call and zero gets; typecheck and lint emitted no diagnostics; all matched files used Prettier style; and scope checks found no Task 4 lifecycle file or forbidden production match. The only warning was the known Node 24.18.0 versus required Node 22 engine mismatch. Fix round 1/5 is complete and execution stopped before Task 4/5.

## Task 4 — HOTP reservation, commit, and cancel lifecycle

Date: 2026-08-10
Status: Complete; Task 5 production router/main wiring and UI were not started.

### Pre-edit review and RED evidence

**Static self-review:** Read Task 4 and global constraints, the approved OTP messaging schemas and content sender normalization, `OtpService`, session repository bridge and session root/epoch behavior, `HotpReservationService`, repository committer, encrypted HOTP receipts/repository implementation, and focused OTP/storage/session/service/migration tests. The implementation uses only normalized browser-owned content sender `tabId`, `frameId`, and `documentId`; lifecycle request payloads contain no binding labels.

**Direct command evidence:** `pnpm exec vitest run apps/extension/test/background/otp-hotp-lifecycle.test.ts packages/otp/test/reservation.test.ts packages/otp/test/repository-reservation.test.ts packages/otp-storage/test/repository-committer.test.ts`

Observed exit code: 1. Vitest reported 9 intended failures: the lifecycle bridge adapter was absent, `OtpService` rejected all lifecycle requests, reservation `clear()` was absent, and simultaneous same-item reserve calls could leave two live identities. Existing repository reservation and repository committer tests passed. This was focused pre-implementation RED.

**Direct command evidence:** A new context-free session-bridge committer test failed because `createRepositoryHotpCommitter` still required a crypto context provider. A later single-context reconciliation test failed because the provider was called separately for commit and receipt lookup. The activity semantics test failed because a non-authoritative wrong-binding cancel (`cancelled: false`) was counted as activity. The maximum-counter test initially exposed the fake repository's missing production-equivalent bound check; the fake was corrected to model the existing repository `Number.MAX_SAFE_INTEGER` conflict before GREEN.

### Implementation and interfaces

- `OtpService.handle` now implements `otp.reserveHotp`, `otp.commitHotp`, and `otp.cancelHotp`, derives an immutable reservation binding solely from validated content `SenderContext`, maps reservation outcomes to fixed service errors, reparses bounded responses, and records activity only for successful reserve/commit or an authoritative `cancelled: true`. HOTP `otp.getCode` remains rejected while TOTP/Steam generation remains unchanged.
- Reserve reads one existing exact HOTP item, generates one bounded response code through `HotpReservationService`, then rechecks exact revision/counter/type before returning. A changed or deleted item cancels the new reservation and returns conflict without advancing.
- `createSessionVaultHotpCommitter` delegates to the approved `createRepositoryHotpCommitter` over only session bridge `commitHotpReservation`, receipt lookup, and one-item `get`; no repository crypto context, root, key, or callback crosses the bridge. The committer supports this context-free bridge while retaining the existing direct-repository overload and one stable context per direct commit/reconciliation attempt.
- `HotpReservationService` serializes reserve replacement, preserves in-flight entries during pruning, enforces the existing 30-second pending, 60-second committed, five-minute uncertain, and 100-entry rules with `now >= expiry` exact boundaries, and adds synchronous `clear()`. Removal, terminal transition, and clear overwrite the owned mutable code property with an empty string before dropping references; this is best-effort reference minimization, not a physical zeroization claim. Concurrent commits share one promise, committed replay remains binding-checked, and uncertain retries reconcile durable encrypted receipts.
- `OtpService` accepts an optional narrow lock/disposal cleanup registrar and exposes `dispose()` for Task 5 composition without wiring router/main. Tests use the existing `SessionService.onLockOrDispose`-shaped callback contract; Task 5 will pass that registrar during production composition.
- Added the extension workspace dependency on existing `@shardpass/otp-storage`; no dependency version, runtime authority, manifest, router, main, or UI changed.

Changed in Task 4:

- `apps/extension/src/background/otp/otp-service.ts`
- `apps/extension/src/background/vault/session-vault-repository.ts`
- `apps/extension/test/background/otp-hotp-lifecycle.test.ts` (created)
- `apps/extension/package.json`
- `packages/otp/src/reservation.ts`
- `packages/otp/test/reservation.test.ts`
- `packages/otp-storage/src/index.ts`
- `packages/otp-storage/test/repository-committer.test.ts`
- `pnpm-lock.yaml`
- `.sdd/project1-task8-execution-ledger.md` (append only)

### GREEN, regression, and static gate evidence

**Direct command evidence:** Focused GREEN reruns reached 34/34 passing lifecycle/reservation/committer tests, followed by test-first corrections for activity, maximum counter modeling, lock/dispose cleanup, and stable direct repository context.

**Direct command evidence:** Final combined regression command ran lifecycle, service, session bridge, session, settings, migration service/destination, OTP, OTP-storage, storage, domain, messaging, and security suites.

Observed exit code: 0. Vitest reported 31/31 files and 448/448 tests passing. Coverage includes exact pending/committed/uncertain boundaries, concurrent duplicate commit, same-item reserve replacement serialization, wrong tab/frame/document, identity-bound cancel and committed replay, update/delete races, counter maximum, 100-entry capacity and in-flight protection, clear/lock/dispose behavior, durable receipt reconciliation, TOTP/Steam preservation, repository restart receipt replay, session root/epoch races, and migration regressions.

**Direct command evidence:** `pnpm typecheck`, `pnpm lint`, and focused Prettier over every Task 4 source/test/package/lockfile completed with exit code 0 and no diagnostics or formatting findings. Commands emitted only the known environment warning: Node 24.18.0 was used while the project requires Node `>=22.14.0 <23`; pnpm remained exactly 10.14.0.

### Review outcome and residual limitations

**Static self-review:** No Critical or Important finding remains after tracing exact sender binding, payload shape, reserve recheck, duplicate/parallel semantics, commit receipt reconciliation, error allowlisting, activity placement, expiry comparisons, capacity/pruning, clear/dispose behavior, and scope. No seed is stored in reservation state or returned. Production Task 4 files add no logging and no arbitrary/raw error reflection. Router/main composition and UI remain intentionally deferred to Task 5 and later tasks.

Residual limitations: JavaScript strings are immutable, so overwriting the mutable entry property and dropping maps cannot guarantee physical erasure of prior string storage; no such zeroization claim is made. A commit already in flight when lock begins cannot be cancelled physically, but the session bridge epoch/root checks make lock win at its authoritative repository boundary; `clear()` drops its reservation identity/code references and an eventual result cannot be replayed from memory. Durable encrypted receipt replay after a service-worker restart requires the caller to possess/reconstruct the same fully bound reservation request; Task 4 intentionally does not persist reservation IDs or code state. Production registration of the lock callback and background disposal call is Task 5 composition and was not wired here.

## Task 8.4 fix round 1/5 — restart durability and live receipt retention

Date: 2026-08-10
Status: Findings 2 and 3 corrected under TDD. Task 5 was not started.

### Technical adjudication and root cause

**Static self-review:** Finding 1 is not a Task 4 defect. Production router/main construction and registration of the existing cleanup hook are explicitly Task 5 composition. It remains a pending Task 5 dependency; no router, main, platform, or UI file was changed.

**Static self-review:** Finding 2 was valid. Pending reservation identity and binding lived only in `HotpReservationService` memory, so service recreation lost the exact reservation request even while the 30-second protocol window remained valid. Finding 3 was valid. Receipts had sequence ordering but no authenticated validity timestamps, and count compaction could evict a still-live idempotency proof solely due to unrelated volume.

### RED evidence

**Direct command evidence:** Pending durability tests failed because `VaultRepository.savePendingHotpReservation` did not exist and recreate-then-commit returned `OTP_RESERVATION_INVALID`. Focused output reported 3 failures while existing storage/lifecycle tests remained passing.

**Direct command evidence:** Receipt-capacity RED proved a full live set accepted another commit and incremented instead of rejecting. A separate expired lookup RED proved an expired receipt still replayed without an unrelated mutation. Persisted-cancel RED proved recreation could resurrect and commit a cancelled reservation. Each failure was observed before its production correction.

### Correction and interfaces

- Added authenticated generation metadata name `hotp-pending-state`. Its canonical encrypted plaintext contains only opaque reservation ID, exact item ID/revision/counter, exact `{tabId, frameId, documentId}` binding, created/expiry times, session-owned epoch, and pending state. It contains no code or seed. Metadata is AEAD-bound to generation/name/version and included in the authenticated immutable generation manifest/root.
- Added narrow session repository save/lookup/remove APIs. `SessionService` overwrites and checks `sessionEpoch` internally; `OtpService` cannot supply or forge epoch, DEK, context, root, repository, or callback authority. Normal CRUD and password rotation preserve the authenticated metadata through existing generation-copy behavior. Root/session changes remain subject to existing exact-root and epoch fail-closed checks.
- Reserve persists pending metadata only after exact post-generation item revision/counter recheck. Service recreation authenticates and reconstructs only non-expired exact pending state, then commits the same reservation ID. Wrong binding, exact expiry, item update/delete, changed session epoch, cancel, lock, and dispose do not increment. Successful commit and authoritative cancel remove pending state without touching unrelated metadata, receipts, or legacy data.
- HOTP receipts now authenticate `committedAt` and `expiresAt`; receipt validity is five minutes so uncertain reconciliation remains possible for its full external window, while the in-memory committed duplicate cache remains 60 seconds. Lookup is time-aware with exact `now >= expiresAt` invalidation. Commit deterministically removes expired receipts, never evicts an unexpired receipt for volume, and rejects `STORAGE_CAPACITY_EXCEEDED` before record encryption/journal/root activation when all configured slots are live. The bound remains 1024.
- Added a real 1024-live-receipt fixture and 1025th rejection test, checking zero counter/root writes; expired pruning and same-ID restart replay tests remain passing. No storage CAS or physical zeroization claim was introduced.

Changed in fix round 1/5:

- `packages/storage/src/hotp-pending.ts` (created)
- `packages/storage/src/hotp-receipt.ts`
- `packages/storage/src/vault-format.ts`
- `packages/storage/src/generation-store.ts`
- `packages/storage/src/vault-repository.ts`
- `packages/storage/src/index.ts`
- `packages/storage/test/vault-repository.test.ts`
- `packages/storage/test/generation-metadata.test.ts`
- `packages/otp/src/reservation.ts`
- `packages/otp/test/repository-reservation.test.ts`
- `apps/extension/src/background/otp/otp-service.ts`
- `apps/extension/src/background/vault/session-vault-repository.ts`
- `apps/extension/src/background/vault/session-service.ts`
- `apps/extension/test/background/otp-hotp-lifecycle.test.ts`
- `apps/extension/test/background/otp-service.test.ts`
- `apps/extension/test/background/session-vault-repository.test.ts`
- `.sdd/project1-task8-execution-ledger.md` (append only)

### GREEN and regression evidence

**Direct command evidence:** Final regression command covered lifecycle, OTP service, session bridge/service including password rotation, migration service/destination, all OTP/OTP-storage/storage/domain/messaging/security suites.

Observed exit code: 0. Vitest reported 30/30 files and 454/454 tests passing. The exact 1024-live test passed and rejected the 1025th before activation; restart commit used the same ID at `expiresAt - 1`; exact expiry, wrong binding, changed item/session, persisted cancel, and expired receipt lookup all failed closed.

**Direct command evidence:** `pnpm typecheck` and `pnpm lint` completed with exit code 0 and no diagnostics. Focused Prettier passed after formatting all correction files. The environment emitted only the known Node 24.18.0 versus required Node 22 engine warning; pnpm remained 10.14.0.

### Review outcome and bounded residual dependency

**Static self-review:** No Critical or Important finding remains for findings 2 or 3 after tracing encrypted metadata AAD/manifest inclusion, immutable generation preservation, session-owned epoch, exact binding/expiry, cancel/commit cleanup, live receipt preflight, root activation order, migration/password rotation, and no-code/no-seed persistence. Production correction files add no logging, raw error reflection, router/main wiring, UI, or extra browser authority.

Pending dependency, not Task 4 defect: Task 5 must construct the production lifecycle service and register `SessionService.onLockOrDispose()` plus background disposal. Until Task 5 is executed, production runtime messages cannot reach this lifecycle. This fix round intentionally stops before that composition work.

## Task 8.4 fix round 2/5 — coherent persisted HOTP state transitions

Date: 2026-08-10
Status: All five adjudicated findings corrected under TDD; Task 5 remains untouched.

### Correction of prior overclaim and RED evidence

**Static self-review:** Round 1's statement that successful commit/cancel removed persisted pending state safely was incomplete. Service commit performed counter+receipt activation and pending removal in two generations; recreated cancel relied on in-memory cancellation before durable removal; durable same-item replacement, stale pruning, empty metadata deletion, and receipt binding were not enforced by one repository transition. Those claims are superseded by this append-only correction.

**Direct command evidence:** New repository tests initially reported four focused failures: missing authenticated recreated-cancel API, missing atomic commit API, old same-item reservation remaining durable, and no stale/epoch pruning before capacity. A migration capacity RED reported two failing pending-metadata cases. A persisted cancellation service test and the full generation fault matrix were also observed failing before their corresponding production corrections.

### Coherent transition design

- The session bridge now exposes narrow `commitHotpReservation(reservationId, binding)` and `cancelHotpReservation(reservationId, binding)` lifecycle mutations. `SessionService` injects the current epoch and bounded numeric clock inside the private repository operation. Context, DEK, root, repository, and receipt/pending lookup callbacks do not cross the bridge.
- `VaultRepository.commitPendingHotpReservation` serializes duplicates and performs one loaded-state transition: authenticate a still-live receipt first; otherwise authenticate exact pending ID/binding/epoch/expiry and item revision/counter; preflight live receipt capacity; update item and journal; create a receipt bound to ID/item/revision/counter/binding/epoch/result/time; remove pending; and activate exactly one generation. There is no second cleanup generation.
- Receipt replay precedes pending/item stale checks and authorizes exact binding/epoch before returning the original result. Concurrent same-ID calls share one promise; restart replay cannot increment twice.
- `cancelPendingHotpReservation` authenticates persisted ID/binding/epoch/expiry and removes it in one generation without requiring a code or seed. Reserve/recreate/cancel/recreate/commit tests keep the counter unchanged.
- Saving pending state validates session-owned safe-integer epoch/clock, prunes `now >= expiresAt` and prior-epoch entries before the 100-entry preflight, and replaces the prior durable entry for the same item/session. Capacity rejection occurs before generation staging/writes.
- Pending metadata is omitted entirely when the final entry is committed, cancelled, or pruned. Unrelated metadata is decrypted, preserved, and re-encrypted under the new generation with existing AAD, capacity, and retained-nonce checks.
- Receipt schema now authenticates exact sender binding and session epoch. The legacy direct repository committer retains a fixed internal compatibility binding; the extension lifecycle no longer exposes or uses split receipt/pending lookup/remove bridge methods.
- Migration record capacity accepts optional pending metadata presence and subtracts its dynamic metadata entry. Existing no-pending callers retain their prior capacity.

### Interruption and regression evidence

**Direct command evidence:** A fault-injection matrix covered every one-key write of the atomic HOTP generation across before/after/partial failures, including root activation/status ambiguity. After recreation, state was either old pending/counter or the exact committed receipt/counter; retry returned the original result and final counter was exactly one increment. No tested path produced a second increment.

**Direct command evidence:** Focused GREEN passed 7 files and 105 tests covering repository transitions, interruption matrix, 1024 receipts, lifecycle, session bridge/service, and migration capacity. The broader relevant regression then passed 30/30 files and 461/461 tests across storage v1/v2/v3, OTP, OTP-storage, session/password rotation, migration, domain, messaging, and security.

**Direct command evidence:** `pnpm typecheck` and `pnpm lint` completed with no diagnostics before the regression run. Focused Prettier and the final verification gate are recorded below. The only environment warning remains Node 24.18.0 versus required Node 22; pnpm is 10.14.0.

### Changed files and review outcome

Changed in fix round 2/5:

- `packages/storage/src/hotp-receipt.ts`
- `packages/storage/src/vault-repository.ts`
- `packages/storage/test/vault-repository.test.ts`
- `packages/storage/test/interruption.test.ts`
- `packages/otp/test/repository-reservation.test.ts`
- `apps/extension/src/background/otp/otp-service.ts`
- `apps/extension/src/background/vault/session-service.ts`
- `apps/extension/src/background/vault/session-vault-repository.ts`
- `apps/extension/src/background/vault/migration-destination.ts`
- `apps/extension/test/background/otp-hotp-lifecycle.test.ts`
- `apps/extension/test/background/otp-service.test.ts`
- `apps/extension/test/background/session-vault-repository.test.ts`
- `apps/extension/test/background/migration-destination.test.ts`
- `.sdd/project1-task8-execution-ledger.md` (append only)

**Static self-review:** The transition now has one authoritative repository load and one immutable-generation activation for commit/cancel. Binding/epoch receipt replay occurs before stale item handling, stale pending state cannot consume capacity, final pending metadata is absent, unrelated metadata remains preserved, and no code/seed/plaintext metadata is exposed. No Task 5 router/main/platform/UI work was introduced.

## Task 8.4 fix round 3/5 — reusable lock cleanup versus permanent disposal

Date: 2026-08-10
Status: Critical lifecycle conflation corrected under TDD; Task 5 was not started.

### Finding verification and RED

**Static self-review:** The Critical finding was valid. The callback registered through the `SessionService.onLockOrDispose()`-shaped dependency set `OtpService.active = false`, so an ordinary session lock permanently disabled the service instance. This incorrectly conflated reusable session cleanup with final object disposal.

**Direct command evidence:** Focused tests for same-service lock/unlock reuse and idempotent permanent disposal failed before production changes. After invoking the lock callback, old commit returned `VAULT_LOCKED` because the service was permanently inactive; after double `dispose()`, a new reserve still succeeded because disposal was only checked on the commit branch. These were the expected lifecycle RED failures.

### Correction

- The registered lock callback now only calls `HotpReservationService.clear()`. It does not alter permanent service state and remains registered for future lock cycles.
- `OtpService.dispose()` now owns a separate `disposed` flag, returns immediately on repeated calls, unregisters the callback exactly once, clears ephemeral reservations, and permanently closes every request path.
- `OtpService.handle()` rejects every request with fixed `VAULT_LOCKED` after explicit disposal, including reserve, list, and non-HOTP paths.
- Same-service tests reserve, invoke lock cleanup, advance the repository/session epoch, prove the old durable ID cannot commit or increment, then reserve and commit a new ID exactly once using the same `OtpService` instance.
- Durable save still prunes prior-epoch pending entries and replaces the old same-item entry before capacity, so the old pending ID is absent after the post-unlock reserve.

Changed in fix round 3/5:

- `apps/extension/src/background/otp/otp-service.ts`
- `apps/extension/test/background/otp-hotp-lifecycle.test.ts`
- `.sdd/project1-task8-execution-ledger.md` (append only)

### GREEN and regressions

**Direct command evidence:** Focused lifecycle GREEN reported 14/14 passing tests, including reusable lock cleanup, old-epoch rejection, post-unlock reserve/commit, permanent disposal, double-dispose idempotence, and exact one-time unregister.

**Direct command evidence:** Full Task 4-relevant regression reported 30/30 files and 463/463 tests passing across lifecycle, service, session bridge/service, migration/password rotation, OTP, OTP-storage, storage v1/v2/v3, domain, messaging, and security. `pnpm typecheck` and `pnpm lint` completed with exit code 0 and no diagnostics. Final Prettier and scope checks are recorded by the fresh completion gate.

**Static self-review:** Lock cleanup is now reusable and disposal is permanently terminal. Old durable pending state remains epoch-bound, cannot commit after lock, and is pruned/replaced by a new reservation. No router/main/platform/UI or other Task 5 work was introduced.

## Task 5 — Production OTP runtime routing and platform adapters

Date: 2026-08-10
Status: Complete under the focused Task 5 gate; Tasks 6/7 were not started.

### RED evidence

**Direct command evidence:** `pnpm exec vitest run apps/extension/test/background/router.test.ts apps/extension/test/background/background-runtime.integration.test.ts apps/extension/test/platform/chrome-platform.test.ts`

Observed exit code: 1. Vitest reported 7 failures: four router cases returned `INVALID_MESSAGE` because OTP routing did not exist, the installed runtime rejected OTP create, and the Chrome platform lacked `sendOtpMessage` and `writeClipboardText`. Existing non-OTP router/platform and migration runtime tests remained passing. This was the focused pre-production RED.

### Implementation and interfaces

- `routeMessage` now parses strict `OtpRequestSchema` before migration/vault/foundation fallback, applies command-specific `otpSenderPolicy` to normalized browser-owned sender context, invokes only the authorized live service, reparses `OtpResponseSchema`, and uses an exhaustive `Record<OtpServiceErrorCode, SafeErrorCode>`. Unknown throws map to fixed `UNEXPECTED`; malformed service output maps to fixed `VAULT_UNAVAILABLE`; locked list alone returns `{ version: 1, kind: "otp.listResult", items: [] }`.
- `installBackground` creates exactly one `HotpReservationService` and one `OtpService` for its lifecycle from `SessionService.vaultRepository`, crypto-safe UUIDs, the shared clock, `SettingsService.notePrivilegedActivity`, and reusable `SessionService.onLockOrDispose` cleanup. It passes the live service to the existing single runtime listener, publishes state after successful create/update/delete/HOTP commit and effective cancel, disposes OTP idempotently before session lock, and leaves migration credential/service composition intact.
- `OtpUiExtensionPlatform` adds required `sendOtpMessage` and UI-only `writeClipboardText`; `BackgroundExtensionPlatform` does not require clipboard or DOM APIs. Chrome reparses OTP responses, converts runtime/background failures to fixed safe errors, and writes only through `navigator.clipboard.writeText`. The fake records clipboard call count and success/failure configuration but never retains values.

### GREEN and regression evidence

**Direct command evidence:** The focused router/runtime/platform rerun passed 3/3 files and 34/34 tests after implementation. The integration coverage was then expanded for raw installed-listener popup/vault list/editor/CRUD/code, exact content HOTP reserve/commit/cancel binding, forged URL/extension/missing tab/frame/document denial, malformed extra fields, lock-safe empty list, unlock reuse, state publication, disposal, and migration coexistence.

**Direct command evidence:** Final relevant regression command `pnpm exec vitest run apps/extension/test/background apps/extension/test/platform packages/messaging packages/security packages/otp packages/storage` passed 37/37 files and 472/472 tests. This includes background readiness/storage/session/root/migration behavior, OTP schemas/service/HOTP lifecycle, interruption/reconciliation, legacy storage compatibility, security errors, and Chrome callback behavior.

**Direct command evidence:** `pnpm typecheck`, `pnpm lint`, focused Prettier check over all Task 5 source/test files, and `pnpm dependencies` all exited 0. Dependency Cruiser reported no violations across 169 modules and 468 dependencies. The environment used pinned pnpm 10.14.0 but emitted the known engine warning because Node was 24.18.0 rather than required Node 22.

**Static authority review:** Source manifest permissions remain exactly `storage`, `alarms`, and `idle`; CSP is unchanged. The repository-root `manifest.json` is a preserved legacy artifact containing older permissions and is not the production source manifest. No `console.log`, clipboard permission, popup OTP UI, vault OTP UI, content autofill activation, or Task 9–13 work was introduced.

### Independent self-review outcome

Critical: none remaining.

Important: none remaining. Parse precedes authorization/service; exact policy precedes invocation; strict response reparsing prevents union/output leakage; only nominal `OtpServiceError` instances are projected; lock list is schema-valid and metadata-free; state publication avoids ineffective cancel; one listener and one service pair exist per install lifecycle; lock cleanup remains reusable while final disposal is terminal; async session lock remains the existing idempotent disposal behavior; migration and trusted-storage readiness remain fail-closed.

Minor: `HotpReservationService` still requires its historical committer constructor dependency although production commit/cancel is repository-owned through `OtpService`; the injected committer is an unreachable fail-closed rejection and contains no secret. Downstream Tasks 6/7 must consume `OtpUiExtensionPlatform` (or required `ExtensionPlatform` methods), call clipboard only from explicit gestures, and must not bypass `sendOtpMessage` response validation.

Changed in Task 5:

- `apps/extension/src/background/router.ts`
- `apps/extension/src/background/main.ts`
- `apps/extension/src/platform/extension-platform.ts`
- `apps/extension/src/platform/chrome-platform.ts`
- `packages/testing/src/fake-extension-platform.ts`
- `apps/extension/test/background/router.test.ts`
- `apps/extension/test/background/background-runtime.integration.test.ts`
- `apps/extension/test/platform/chrome-platform.test.ts`
- `apps/extension/test/popup/PopupApp.dom.test.tsx` (platform test-double compatibility only; no OTP UI)
- `apps/extension/test/vault/VaultApp.dom.test.tsx` (platform test-double compatibility only; no OTP UI)
- `.sdd/project1-task8-execution-ledger.md` (append only)

## Task 8.5 fix round 1/5 — command-bound OTP response validation

Date: 2026-08-10
Status: Valid Important finding corrected under strict TDD; no UI work started.

### Finding correction

**Static self-review correction:** The prior Task 5 claim that union response reparsing prevented all output leakage was incomplete and is superseded here. `OtpResponseSchema` proved only that a payload was some valid OTP response; it did not prove that its discriminant matched the request command. A compromised or defective service could therefore return a valid vault-only `otp.editorResult` to an authorized popup `otp.list` request, and the runtime state-publish predicate treated any non-error response as success for several mutation commands.

### RED evidence

**Direct command evidence:** `pnpm exec vitest run packages/messaging/test/otp.test.ts apps/extension/test/background/router.test.ts apps/extension/test/platform/chrome-platform.test.ts apps/extension/test/background/background-runtime.integration.test.ts`

Observed exit code: 1. Vitest reported 4 failing files / 4 failed tests / 44 passed tests. Messaging lacked the requested exhaustive map/helper; router returned a valid editor projection, including its vault-only secret field, for `otp.list`; Chrome accepted the same cross-command transport response; and runtime lacked a command-matched state-publication predicate. The failure reproduced the reviewed Important finding at each boundary.

### Correction

- `packages/messaging/src/otp.ts` now exports `otpResponseKindByRequest`, declared with `satisfies Record<OtpCommandKind, OtpResponseKind>`, plus `parseOtpResponseForRequest(request, candidate)`. The map covers every request command and TypeScript fails when a new command is added without a mapping. The helper first validates the strict union and then requires the exact command-specific response discriminant.
- Router and Chrome UI transport both reuse the helper. Any strict but cross-command response becomes fixed `VAULT_UNAVAILABLE`; the candidate payload is never returned or reflected.
- `shouldPublishOtpState` first requires the same exhaustive command/response match, then publishes only successful create/update/delete/commit and `otp.cancelHotp` with `cancelled: true`. Valid but wrong variants for create/commit do not publish.
- Table-driven messaging coverage checks every request against every valid response variant. Router explicitly proves `otp.list -> otp.editorResult` does not return the editor secret. Chrome independently rejects that response even if the router boundary were compromised.

### GREEN and regression evidence

**Direct command evidence:** Focused GREEN passed 4/4 files and 48/48 tests after correcting one pre-existing policy test fixture to return the proper reserve response. `pnpm typecheck` then exited 0.

**Direct command evidence:** Relevant regression `pnpm exec vitest run apps/extension/test/background apps/extension/test/platform packages/messaging packages/security packages/otp packages/storage` passed 37/37 files and 475/475 tests.

**Direct command evidence:** `pnpm lint`, `pnpm typecheck`, focused Prettier, and `pnpm dependencies` all exited 0 after formatting and replacing an inline import type. Dependency Cruiser reported no violations across 169 modules and 468 dependencies. Pnpm remained 10.14.0; the environment emitted the known Node 24.18.0 warning against the required Node 22 range.

### Review outcome and changed files

Critical: none found.

Important: corrected. Union collision is rejected at both router and UI transport, state publication requires command-matched success, cancellation remains effective-only, and the exhaustive map makes future command additions a compile-time maintenance point.

Minor: none introduced. No popup/vault OTP UI, content fill, permission, CSP, migration, storage, or dependency scope changed.

Changed in fix round 1/5:

- `packages/messaging/src/otp.ts`
- `packages/messaging/src/index.ts`
- `packages/messaging/test/otp.test.ts`
- `apps/extension/src/background/router.ts`
- `apps/extension/src/background/main.ts`
- `apps/extension/src/platform/chrome-platform.ts`
- `apps/extension/test/background/router.test.ts`
- `apps/extension/test/background/background-runtime.integration.test.ts`
- `apps/extension/test/platform/chrome-platform.test.ts`
- `.sdd/project1-task8-execution-ledger.md` (append only)

## Task 6 — Popup OTP list, countdown, copy, and vault navigation

Date: 2026-08-10
Status: Focused implementation and review gate complete; Task 7 not started.

### RED evidence

**Direct command evidence:** `pnpm exec vitest run apps/extension/test/popup/OtpList.dom.test.tsx apps/extension/test/popup/PopupApp.dom.test.tsx`

Observed exit code: 1. The new component suite failed to resolve the not-yet-created `OtpCountdown` module, and the new PopupApp unlocked-composition test could not find its projected issuer. Existing PopupApp behavior contributed 12 passing tests. This was the expected focused RED for missing Task 6 components and integration.

### Implementation and interfaces

- Added `useOtpList` as the parent orchestration hook for active-only `otp.list`, visible TOTP/Steam `otp.getCode`, one nearest-boundary timer, exact `now >= expiresAt` redaction/refresh, focus/visibility revalidation, generation-token stale-response rejection, and lock/unmount cleanup.
- Added `OtpList`, `OtpRow`, and `OtpCountdown`. Rows consume list/code projections only; visually rendered codes are `aria-hidden`; accessible names contain non-secret issuer/label/type only. Steam is identified only from the static `otpType` projection. HOTP receives no code/copy/reservation command and exposes only full-vault navigation.
- Copy remains an explicit click path: `otp.copyCode` must return its exact command-matched short-lived response through `OtpUiExtensionPlatform`; the component rejects `now >= expiresAt`, performs one `platform.writeClipboardText` call, bounds concurrent clicks with a synchronous ref, and emits only `Code copied`, `Code unavailable. Try again.`, or `Copy failed. Try again.` No clear timer or permission change was added.
- PopupApp now tracks `VaultAccess.onUnlockedChange`, mounts OTP content only while foundation-ready and unlocked, and immediately unmounts it on a lock-state publication. Existing setup/unlock/lock/settings and Open vault controls remain owned by `VaultAccess`/PopupApp.
- Scoped CSS retains the exact 360px popup, sharp compact rows, issuer rail, mono tabular code, coral focus/urgency, 44px row actions, responsive behavior, and reduced-motion override without gradients, glass, pills, or card expansion.

### GREEN and regression evidence

**Direct command evidence:** Focused GREEN `pnpm exec vitest run apps/extension/test/popup/OtpList.dom.test.tsx apps/extension/test/popup/PopupApp.dom.test.tsx` passed 2/2 files and 27/27 tests.

**Direct command evidence:** Relevant popup/platform/messaging regression `pnpm exec vitest run apps/extension/test/popup apps/extension/test/platform packages/messaging/test` passed 10/10 files and 127/127 tests after the final lock-transition test used the real vault-state stream callback.

**Direct command evidence:** Runtime regression `pnpm exec vitest run apps/extension/test/background apps/extension/test/platform packages/messaging packages/security` passed 22/22 files and 285/285 tests.

**Direct command evidence:** `pnpm typecheck`, `pnpm lint`, focused Prettier, and `pnpm dependencies` exited 0. Dependency Cruiser reported no violations across 175 modules and 489 dependencies. `pnpm audit --prod` reported no known vulnerabilities.

**Direct command evidence:** `pnpm build:security` exited 0; Vite built fresh `dist`, output security tests passed 7/7, and the build scanner passed. A separate `pnpm exec vitest run tests/security` passed 6/6 files and 295/295 tests. The authoritative source/built manifest retains exactly `storage`, `alarms`, and `idle`; the preserved root `manifest.json` artifact still contains legacy clipboard permissions and remains reference-only as required by the global constraints.

**Direct command evidence:** Static scans of Task 6 popup/platform/current manifest sources and built manifest found no `console.log`, clipboard permission token, OTP-secret pairing, placeholder marker, gradient, or backdrop-filter match. The repository-wide `pnpm format:check` remains exit 1 solely for the untouched protected Task 7 recovery artifact `.sdd/recovery/project1-task7-contaminated-execution-ledger-2026-08-10.md`; focused Task 6 Prettier passed.

Environment note: pnpm was the pinned 10.14.0. Commands emitted the known engine warning because this environment runs Node 24.18.0 while the project requires Node `>=22.14.0 <23`; no version floor was changed.

### Review outcome and changed files

Critical: none found.

Important: none remain. Review traced clipboard gesture timing, synchronous duplicate-click bounding, command-matched transport response, expiry rejection, parent timer cleanup, stale list/code suppression, focus/visibility refresh, lock-transition metadata redaction, HOTP non-increment behavior, digit accessibility, fixed error/status strings, and absence of popup editor/secret authority.

Minor: countdown period is inferred from the code projection's boundary timing because the strict `OtpCodeProjection` intentionally contains `remaining` and `expiresAt`, not configured period. This preserves exact expiry behavior and Steam's static type label without expanding the Task 2 messaging projection; Task 7 may independently decide whether vault editor display needs configured period.

Changed in Task 6:

- `apps/extension/src/popup/otp/useOtpList.ts` (created)
- `apps/extension/src/popup/otp/OtpCountdown.tsx` (created)
- `apps/extension/src/popup/otp/OtpRow.tsx` (created)
- `apps/extension/src/popup/otp/OtpList.tsx` (created)
- `apps/extension/src/popup/otp/OtpList.module.css` (created)
- `apps/extension/test/popup/OtpList.dom.test.tsx` (created)
- `apps/extension/src/popup/PopupApp.tsx`
- `apps/extension/src/popup/PopupApp.module.css`
- `apps/extension/test/popup/PopupApp.dom.test.tsx`
- `.sdd/project1-task8-execution-ledger.md` (append only)

Downstream boundary: Task 7 full-vault search/editor/delete and Task 8 packaged browser E2E/screenshots were not started. No Git/worktree/commit command was run.

## Task 8.6 fix round 1/5 — lock paint, clipboard activation, bounded work, hidden state, and exact period

Date: 2026-08-10
Status: All five findings verified and corrected under focused TDD; Task 7 and browser E2E remain unstarted.

### Finding verification and RED

**Static self-review:** All five findings were valid. `VaultAccess` notified `PopupApp` from a passive effect after its own accepted state paint; copy awaited `otp.copyCode` before clipboard; code loading used unbounded `Promise.allSettled` over the entire list; hidden documents retained code/timer work and focus/visibility events started separate reloads; and the strict code projection omitted configured period, forcing an invalid row inference.

**Direct command evidence:** `pnpm exec vitest run packages/messaging/test/otp.test.ts apps/extension/test/background/otp-service.test.ts apps/extension/test/popup/OtpList.dom.test.tsx apps/extension/test/popup/PopupApp.dom.test.tsx` exited 1 with 13 expected failures. Messaging rejected period-bearing responses, OtpService omitted period, row geometry used inferred values, clipboard was not called before deferred bookkeeping, 10,000 items started unbounded requests, hidden/focus events produced overlapping reloads, and the lock publication still left OTP loading content in the immediate accepted-state batch.

### Corrections

- `VaultAccess` now calls `onUnlockedChange` directly in each authoritative accepted message/stream transition and direct setup/unlock/lock/password-change completion, including unavailable/disconnect/query failure. The passive state-notification effect is removed. PopupApp therefore batches authoritative lock state with OTP unmount/redaction; late list responses cannot remount it.
- Copy synchronously reads the currently displayed projection, requires `now < expiresAt`, marks the item busy through a ref, and invokes `platform.writeClipboardText(currentCode.code)` before starting `otp.copyCode`. Runtime bookkeeping is post-delivery validation/activity only; different, expired, or rejected bookkeeping never rewrites clipboard or exposes either code. Feedback reflects clipboard success/failure only and remains fixed/code-free.
- Popup work is capped at the first 20 list projections. Remaining count is aggregate-only and contains no metadata. Code requests use four workers, generation invalidation, and one coalesced reload scheduler, so at most 20 code requests and four in-flight operations occur for a capacity-sized response.
- Hidden transitions synchronously increment generation, cancel effective timer/code state, retain unlocked metadata only, and suppress refresh. Visible/focus events share one microtask-coalesced reload; hidden fake time across multiple periods produces no request.
- Strict `OtpCodeProjection`/`otp.codeResult` now requires `period` in 1..300, requires Steam period exactly 30, and requires remaining not exceed period. `OtpService` returns the authenticated item's actual period. `OtpRow` passes that exact period to `OtpCountdown`; 30- and 45-second midpoint geometry is covered.

### GREEN, regressions, and static/security evidence

**Direct command evidence:** Focused GREEN passed 4/4 files and 77/77 tests.

**Direct command evidence:** Final popup/background/platform/messaging/security regression passed 25/25 files and 321/321 tests. This includes real lock-stream publication with immediate post-batch redaction, late-response suppression, transient clipboard ordering, duplicate clicks, capacity-sized window/concurrency, hidden suppression/coalescing, strict messaging, service projection, router/runtime, HOTP lifecycle, session, migration, and platform behavior.

**Direct command evidence:** `pnpm typecheck`, `pnpm lint`, focused Prettier, and `pnpm dependencies` exited 0. Dependency Cruiser reported no violations across 175 modules and 490 dependencies. `pnpm audit --prod` reported no known vulnerabilities.

**Direct command evidence:** `pnpm build:security` exited 0; output security tests passed 7/7 and the build scanner passed. `pnpm exec vitest run tests/security` passed 6/6 files and 295/295 tests. Static authority scans found no popup clipboard permission, `console.log`, OTP-secret pairing, TODO/TBD marker, or unsafe authority addition. Source and built manifests retain exactly `storage`, `alarms`, and `idle`.

Environment note: pnpm remained 10.14.0. The environment emitted the known Node 24.18.0 warning against the required Node `>=22.14.0 <23`; no engine floor or dependency changed.

### Review outcome and changed files

Critical: corrected. Accepted lock/unavailable state no longer depends on a passive effect before PopupApp redaction.

Important: corrected. Clipboard precedes runtime settlement; popup work is bounded/coalesced; hidden state suppresses code work; exact period crosses the strict protocol/service boundary.

Minor: none remain. No editor, secret UI, HOTP increment path, permission, CSP, clipboard clear timer, Task 7 vault CRUD, or Task 8 browser E2E scope was added.

Changed in fix round 1/5:

- `apps/extension/src/vault-access/VaultAccess.tsx`
- `apps/extension/src/popup/otp/useOtpList.ts`
- `apps/extension/src/popup/otp/OtpList.tsx`
- `apps/extension/src/popup/otp/OtpRow.tsx`
- `apps/extension/src/popup/otp/OtpList.module.css`
- `apps/extension/src/background/otp/otp-service.ts`
- `packages/messaging/src/otp.ts`
- `packages/messaging/test/otp.test.ts`
- `apps/extension/test/background/otp-service.test.ts`
- `apps/extension/test/popup/OtpList.dom.test.tsx`
- `apps/extension/test/popup/PopupApp.dom.test.tsx`
- `.sdd/project1-task8-execution-ledger.md` (append only)

No Git/worktree/commit command was run. Task 7 and Task 8 browser work were not started.


## Task 8.7 — full-vault OTP CRUD UI, migration coexistence, and review gate

Date: 2026-08-10
Status: Task 7 implementation and focused review gate complete; Task 8 packaged browser E2E/screenshots were not started.

### TDD evidence

**RED:** `pnpm exec vitest run apps/extension/test/vault/OtpVaultView.dom.test.tsx apps/extension/test/vault/VaultApp.dom.test.tsx apps/extension/test/vault/VaultApp.styles.test.ts` exited 1 because `OtpVaultView` did not exist. The pre-existing VaultApp/style tests passed, confirming the focused failure was the missing Task 7 surface. A later focused migration callback test exited 1 because migration completion did not notify the OTP workspace.

**GREEN:** The same focused vault command passed 3/3 files and 17/17 tests after implementation. Final `pnpm exec vitest run apps/extension/test/vault` passed 6/6 files and 25/25 tests, including migration completion callback coverage.

### Implementation and interfaces

- Added `useOtpVault`, which owns one debounced 150 ms raw-trimmed list query, request/lifecycle invalidation, stale response rejection, exact selected-item editor fetches, and revision-bound create/update/delete refresh behavior.
- Added `OtpVaultView`, `OtpEditor`, `DeleteOtpDialog`, and scoped responsive CSS. The view provides a compact keyboard listbox, selected detail, create/edit fields for TOTP/HOTP/Steam, local safe-subset validation, Base32 separator normalization, concealed-by-default secret, favorite/tags/note, and no HOTP code reservation/advance path.
- Conflicts retain attempted controlled form values, refresh the current list and exact editor projection, adopt the latest revision, display fixed guidance, and require a subsequent explicit save. Delete conflicts refresh without deleting the newer record.
- Delete is portal-backed and revision-bound, uses only issuer/label in its copy, traps Tab, cancels on Escape, returns focus, and bounds double submission.
- Lock/unavailable unmounts the OTP workspace synchronously and invalidates list/editor/mutation continuations; controlled secret, dialog, selection, and attempted conflict state are dropped with the component.
- `VaultApp` replaces locked placeholders only while unlocked, retains setup/locked/password/security controls, and keeps `MigrationPanel` in a separate non-nested controls region. Migration completion increments a refresh token so migrated items become visible without removing the panel.

### Review outcome

Critical: none.

Important: one migration coexistence gap was found and corrected under RED/GREEN: completed activation now calls an optional `MigrationPanel.onCompleted`, and VaultApp refreshes the OTP list. Secret DOM/accessibility exposure, controlled-state cleanup, lock races, stale list/editor responses, revision conflict semantics, delete focus/double-submit behavior, type invariants, autocomplete/spellcheck, portal clipping, React text escaping, responsive list/detail structure, reduced motion, and form reset were reviewed after correction.

Minor: the repository root `manifest.json` is the preserved legacy artifact and contains legacy permissions; it is not the build authority. Current source `apps/extension/src/manifest.ts` and fresh `dist/manifest.json` retain only `storage`, `alarms`, and `idle`. The environment remains Node 24.18.0 and emits the known warning against the required Node `>=22.14.0 <23`; pnpm is 10.14.0 and no engine/dependency floor changed.

### Regression and security evidence

- Final relevant vault/popup/platform/messaging/background regression: 19/19 files, 214/214 tests passed.
- `pnpm typecheck`, `pnpm lint`, focused vault Prettier, and `pnpm dependencies` exited 0; Dependency Cruiser reported no violations across 181 modules and 514 dependencies.
- `pnpm build:security` exited 0; output security tests passed 7/7 and the build scanner passed.
- `pnpm audit --prod` reported no known vulnerabilities.
- Static Task 7 source scans found no `console.log`, TODO/TBD marker, gradient, backdrop filter, or secret reflected into an accessibility name/status. The only secret-related ARIA match was the boolean `aria-pressed` state on the explicit reveal control.
- Repository-wide `pnpm format:check` remains blocked only by the untouched protected recovery artifact `.sdd/recovery/project1-task7-contaminated-execution-ledger-2026-08-10.md`; all changed vault files pass Prettier.

### Changed files and downstream boundary

Created: `apps/extension/src/vault/otp/useOtpVault.ts`, `OtpVaultView.tsx`, `OtpEditor.tsx`, `DeleteOtpDialog.tsx`, `OtpVaultView.module.css`, and `apps/extension/test/vault/OtpVaultView.dom.test.tsx`.

Modified: `apps/extension/src/vault/VaultApp.tsx`, `VaultApp.module.css`, `apps/extension/src/vault/migration/MigrationPanel.tsx`, `apps/extension/test/vault/VaultApp.dom.test.tsx`, and `apps/extension/test/vault/MigrationPanel.dom.test.tsx`.

Task 8 dependencies remaining: packaged-extension create/search/edit/delete/conflict/lock/migration E2E, popup code/copy rollover E2E, desktop/compact screenshots, and browser accessibility/runtime evidence. No browser E2E, screenshot, Task 9–13 behavior, Git, worktree, branch, commit, or push operation was performed.

## Task 8.7 fix round 1 recovery — concealed DOM, bounded index, conflict token, and fail-closed list errors

Date: 2026-08-10
Status: Recovered the previous empty-result handoff from current disk state; all four required findings are corrected and verified without browser E2E.

### Recovery inspection and RED

Inspected the existing Task 8 ledger tail, the partially changed vault source/tests, and current generated output without assuming completion. The inherited `OtpVaultView.dom.test.tsx` already contained concealed-DOM and 10,000-item assertions, but production still mounted all 10,000 options. The concealed test was intermittently reset because a fresh editor object was passed on every parent render. No inherited test covered a deferred item-A conflict after selecting item B or pre-publication redaction on list failure.

**Direct RED evidence:** Focused vault execution exited 1 with 2 failures: the capacity test found 10,000 mounted options instead of at most 50, and the combined concealed test intermittently lost its revealed field. Newly added deferred-conflict and list-failure tests both failed: stale item-A attempted values replaced item B, and a failed list retained editor/dialog/input state.

### Corrections

- Concealed mode now mounts no secret input and reflects no secret into values or attributes. Reveal uses the OTP-specific `otp-secret-base32` name with autocomplete off, spellcheck false, and autocapitalize none. Conceal clears the live input before unmount; layout cleanup clears it before editor unmount. Stable memoized editor input prevents unrelated renders from resetting reveal state. Lock and list-failure teardown remove the editor and its controlled secret buffer.
- The 10,000-item index now renders a 40-row window plus 5-row overscan, never more than 45 options. Spacer geometry preserves scrolling; options retain listbox semantics with `aria-posinset`/`aria-setsize`. Arrow, Home, and End navigation updates the window, selection, editor request, and focus across virtual boundaries.
- Hook and view operation tokens invalidate create/update/delete continuations when selection, clear, lock, unmount, or fail-closed list handling starts. A deferred conflict for item A therefore cannot refresh/reselect A or publish attempted A values after item B becomes the edit session.
- Current list failure invalidates editor and mutation work, clears the selected ref, and atomically publishes only `{status: error, items: [], editor: null, selectedId: null, loadingEditor: false}`. The view's error transition closes create/edit, attempted/conflict/delete state and dialog and clears submitting before the error UI is observed.
- During requested security verification, the pre-existing unguarded `text-wrap: balance` in the new Task 8 OTP stylesheet failed the source/built Chrome 110 compatibility test. It now has `white-space: normal` and `overflow-wrap: anywhere` fallback and places `text-wrap` inside `@supports`.

### GREEN and requested verification

- Focused `OtpVaultView.dom.test.tsx`: 10/10 passed, including exact concealed DOM cleanup, bounded 10,000-item window/navigation, deferred conflict selection, and pre-lock-style list-failure redaction.
- Full vault suite: 6/6 files and 28/28 tests passed, including migration refresh/callback, dialog, create/update/delete/conflict, styles, and legacy migration KDF behavior.
- Final vault/popup/platform/messaging/background regression: 29/29 files and 333/333 tests passed.
- `pnpm typecheck`, `pnpm lint`, focused changed-file Prettier, and `pnpm dependencies` exited 0; Dependency Cruiser found no violations across 181 modules and 514 dependencies.
- `pnpm build:security` exited 0; built-output security tests passed 7/7 and the build scanner passed. `pnpm exec vitest run tests/security` passed 6/6 files and 295/295 tests after the CSS compatibility correction. `pnpm audit --prod` found no known vulnerabilities.
- Repository-wide `pnpm format:check` exits 1 for two ledger artifacts: this append-only Task 8 ledger and the untouched protected Task 7 recovery artifact. All changed production/test files pass focused Prettier. Task 7 evidence was not modified.

Environment limitation: commands emit the known engine warning because the environment runs Node 24.18.0 while the project requires Node `>=22.14.0 <23`; pnpm remains 10.14.0. No browser E2E was started, as requested. No Git/worktree/commit operation was run.

Changed in this recovery:

- `apps/extension/src/vault/otp/OtpEditor.tsx`
- `apps/extension/src/vault/otp/OtpVaultView.tsx`
- `apps/extension/src/vault/otp/OtpVaultView.module.css`
- `apps/extension/src/vault/otp/useOtpVault.ts`
- `apps/extension/test/vault/OtpVaultView.dom.test.tsx`
- `.sdd/project1-task8-execution-ledger.md` (append only)

## Task 8.7 fix round 2/5 — atomic detail redaction, stale delete reconciliation, and virtual listbox focus

Date: 2026-08-10
Status: All three round-2 findings reproduced under focused RED, corrected, and verified without browser E2E.

### RED and root cause

**Direct RED evidence:** After adding the exact round-2 regressions, `pnpm exec vitest run apps/extension/test/vault/OtpVaultView.dom.test.tsx` exited 1 with 5 failures. The first error commit still contained a revealed create secret and private label because local sensitive state was cleared in a passive effect after the hook's error publication. A stale successful A delete was ignored before reconciliation, leaving A in the list, while stale A completion/error closed or changed B's dialog. The virtual listbox had no container tab stop or active descendant because focus lived on rows that could be unmounted by scrolling.

Root causes were split ownership and ordering: remote list status and local editor/dialog state could not commit atomically; delete continuation cleanup was unscoped and the hook discarded stale success before refreshing; and the virtual window tied keyboard focus to ephemeral option elements.

### Corrections

- All sensitive detail surfaces are synchronously gated by `active && vault.state.status === "ready"`: create/edit editor, loading state, conflict-attempted values, delete conflict, empty detail, and delete dialog. Create is disabled outside ready. Therefore the same commit that publishes list error cannot render any local secret/input/label/dialog, regardless of passive cleanup timing. Profiler-based tests inspect the first error-bearing commit for both revealed create and revealed conflict-attempted secrets.
- `confirmDelete` captures the view operation token, item ID, and revision. Every A-specific close/conflict/mode/attempted/submitting/error mutation is guarded by that token. Selecting B advances the token and establishes B's independent non-submitting dialog state.
- `useOtpVault.remove` now treats a stale but authenticated successful delete as a reconciliation event: it refreshes the current query while preserving `selectedRef.current`, so A disappears without clearing or reselecting B. Stale errors remain inactive and perform no reconciliation or view mutation.
- Keyboard focus now remains on the `tabIndex=0` listbox. `aria-activedescendant` always references a mounted option with a stable ID. Manual scroll moves the active index to the first visible safe option when needed, without selecting it; Arrow Up/Down, Home, and End update the active index/window and select the target. The rendered bound remains 45 options, below the requested 46-ish maximum.

### GREEN and verification

- Focused vault view: 14/14 tests passed. This includes both first-error-commit redaction scenarios, stale successful delete reconciliation with B dialog/editor preserved, stale delete error isolation, manual multi-window scroll with an existing active descendant, continued Arrow/Home/End operation, and bounded option count.
- Final relevant vault/popup/platform/messaging/background regression: 29/29 files and 337/337 tests passed, including migration refresh/dialog/create/update behavior.
- `pnpm typecheck`, `pnpm lint`, focused changed-file Prettier, and `pnpm dependencies` exited 0. Dependency Cruiser reported no violations across 181 modules and 515 dependencies.
- `pnpm build:security` exited 0; built-output tests passed 7/7 and the scanner passed. Source security tests passed 6/6 files and 295/295 tests. `pnpm audit --prod` found no known vulnerabilities.

Environment limitation remains unchanged: Node 24.18.0 emits the known warning against required Node `>=22.14.0 <23`; pnpm is 10.14.0. No browser E2E, Git, worktree, branch, commit, or push operation was run. Task 7 evidence was not touched.

Changed in round 2:

- `apps/extension/src/vault/otp/OtpVaultView.tsx`
- `apps/extension/src/vault/otp/useOtpVault.ts`
- `apps/extension/test/vault/OtpVaultView.dom.test.tsx`
- `.sdd/project1-task8-execution-ledger.md` (append only)

## Task 8.7 fix round 3/5 — authoritative query reconciliation, mounted active descendant, and fixed row geometry

Date: 2026-08-10
Status: All three round-3 findings reproduced under focused RED, corrected, and verified without browser E2E.

### RED and root cause

**Direct RED evidence:** The precise focused command for the new query/ARIA/style tests exited 1 with three expected failures. A stale committed A delete issued reconciliation with the captured empty query instead of the latest `field` query; the Profiler observed an `aria-activedescendant` targeting the old item 9999 after the filtered collection committed; and emitted OTP row CSS lacked exact height, border-box sizing, and row overflow containment.

Root causes: the hook's callbacks closed over rendered `query`; the stale-success path started a new list request that could supersede a newer current-query request; active identity was derived from the full collection rather than the simultaneously rendered window; and virtual math assumed 54 px while CSS guaranteed only a minimum height.

### Corrections

- `useOtpVault` now wraps query updates so `queryRef.current` changes synchronously with the controlled input. On stale authenticated delete success, it immediately removes A from the current projection. It only starts a background refresh when the latest query still equals the delete callback's captured query; otherwise the already scheduled/in-flight latest-query request remains authoritative and is not superseded. Selection/editor state is preserved.
- The listbox derives `aria-activedescendant` only from the currently mounted `visibleItems`: it uses the active collection item when visible, otherwise the first mounted option, and omits the attribute when no options are mounted. Profiler coverage starts near item 9999, changes query/result, and checks every commit for a resolvable ID before continuing keyboard input.
- `OTP_VAULT_ROW_HEIGHT_PX = 54` is exported and used for scroll/window/spacer calculations. The corresponding CSS row has exact `height: 54px`, `min-height: 54px`, `box-sizing: border-box`, and `overflow: hidden`; internal copy remains width-bounded and now also clips overflow while text children use ellipsis. The 54 px fixed row exceeds the 44 px touch target floor.

### GREEN and verification

- Focused vault DOM/style run: 2/2 files and 19/19 tests passed, including latest-query delete race, every-commit active-descendant integrity, keyboard continuation, and exact emitted row geometry.
- Final relevant vault/popup/platform/messaging/background regression: 29/29 files and 340/340 tests passed.
- `pnpm typecheck`, `pnpm lint`, focused changed-file Prettier, and `pnpm dependencies` exited 0. Dependency Cruiser reported no violations across 181 modules and 515 dependencies.
- `pnpm build:security` exited 0; built-output tests passed 7/7 and the build scanner passed. Source security tests passed 6/6 files and 295/295 tests. `pnpm audit --prod` found no known vulnerabilities.

Environment limitation remains unchanged: Node 24.18.0 emits the known warning against required Node `>=22.14.0 <23`; pnpm is 10.14.0. No browser E2E, Git, worktree, branch, commit, or push operation was run. Task 7 evidence was not touched.

Changed in round 3:

- `apps/extension/src/vault/otp/OtpVaultView.tsx`
- `apps/extension/src/vault/otp/useOtpVault.ts`
- `apps/extension/src/vault/otp/OtpVaultView.module.css`
- `apps/extension/test/vault/OtpVaultView.dom.test.tsx`
- `apps/extension/test/vault/VaultApp.styles.test.ts`
- `.sdd/project1-task8-execution-ledger.md` (append only)

## Task 8.8 — packaged-extension OTP CRUD and popup browser coverage

Date: 2026-08-10
Status: Task 8 browser gate passed; execution stopped before Task 9.

### TDD RED evidence

- Created `tests/browser/project1-otp-crud.spec.ts` before Task 8 production/test corrections and ran `pnpm build:security && pnpm exec playwright test tests/browser/project1-otp-crud.spec.ts`.
- Initial RED exited 1 because the clean headless Chrome profile reported the OS idle state as locked and the fixture had not deterministically disabled screen-lock handling. The existing setup/unlock spec reproduced the same `CHALLENGE_INVALID` setup failure. Safe diagnostics proved the current settings key is `shardpass:v1:lock-settings`; after seeding that non-secret preference in the temporary profile before the instrumented launch, setup/unlock passed.
- The intended focused RED then exited 1 because `tests/browser/__screenshots__/popup-otp-linux.png` did not exist. Functional execution also exposed test-path corrections for opaque extension-origin clipboard permissions, stale editor counter reads, and strict locators. Assertions were corrected without weakening production authorization or storage behavior.

### Browser coverage and corrections

- The packaged MV3 test uses a fresh temporary persistent profile, real vault setup/unlock, generated synthetic Base32 material held only in test closure state, and no real account/profile/clipboard data.
- Covered TOTP with a custom 45-second period, HOTP with a synthetic counter, explicit Steam selection, issuer/label/tag NFKC search, keyboard listbox navigation, second trusted vault-page revision conflict with attempted values retained and latest revision reloaded, delete Escape/focus/confirm, immediate lock redaction, reload/unlock persistence, encrypted-at-rest secret scan, and popup compact list/countdown/copy/open-only behavior.
- Secret input is absent before reveal, attributes are inspected only while revealed, conceal removes it before any screenshot, and all screenshots use concealed state. Popup code areas are masked in the visual baseline. No secret/code appears in test titles or screenshot filenames.
- Clipboard permission granting is unavailable for the opaque `chrome-extension://` origin in this headless browser. The test instruments the real `navigator.clipboard.writeText` call boundary, records only call count (never the value), invokes it through the explicit Copy gesture, and verifies code-free status text. Manifest permissions remain exactly `storage`, `alarms`, and `idle`.
- The shipping content script is available on the synthetic untrusted harness page. Through its browser-owned isolated content context, the test proves reserve does not increment, commit increments once, duplicate commit replays the same bounded result, cancel makes commit fail without increment, and content cannot read local/session storage. Popup never requests or advances HOTP. Expiry remains covered by the existing focused HOTP lifecycle source tests; the packaged test does not wait out the 30-second TTL.
- Popup CRUD is denied with `UNAUTHORIZED_SENDER`; vault invalid-item code access returns a bounded safe error. Existing messaging/router tests cover content/list/editor/CRUD denials and response-kind mismatch. No broad permission or Task 9–13 behavior was added.
- Corrected one production accessibility defect found by packaged axe: the loading vault-state element now has `role="status"` with its existing safe label. The profile fixture correction is test-only and preserves production lock defaults.
- Reviewed baselines: `popup-otp-linux.png`, `vault-otp-desktop-linux.png`, and `vault-otp-compact-linux.png`. They show concealed/placeholder states, no clipped primary controls at the target viewports, and no unmasked OTP code in the popup baseline.

### GREEN and regression evidence

- Focused GREEN: `pnpm exec playwright test tests/browser/project1-otp-crud.spec.ts` — exit 0, 1/1 passed.
- Required relevant gate: `pnpm build:security && pnpm exec playwright test tests/browser/project1-otp-crud.spec.ts tests/browser/project1-setup-unlock.spec.ts tests/browser/project1-migration.spec.ts` — exit 0, security output 7/7 passed, build scan passed, browser 3/3 passed in 29.8 seconds.
- Relevant source regressions: 14/14 files and 161/161 tests passed across popup, vault, OTP service/lifecycle, router, platform, and messaging.
- `pnpm typecheck` and `pnpm lint` exited 0. Focused Prettier over all Task 8.8 changed files passed. Workspace `pnpm format:check` remains failed only by two pre-existing ledger/recovery markdown files (`.sdd/project1-task8-execution-ledger.md` and `.sdd/recovery/project1-task7-contaminated-execution-ledger-2026-08-10.md`); no unrelated recovery file was modified. `pnpm dependencies` passed with 181 modules and 515 dependencies and no violations.
- Security build/output scan passed. Concise scans found no `console.log`, no placeholder markers in Task 8 OTP source, no synthetic test strings in `dist`, and unchanged built permissions/CSP/minimum Chrome 110.
- Full browser suite was feasible and run. Result: 12/14 passed. Task 8 OTP, setup/unlock, migration, popup, picker, runtime capture, extension smoke, and responsive tests passed. Two unrelated standing failures remain: `crypto-smoke.spec.ts` times out at its 30-second test limit under this Node 24/Chrome 151 environment, and `vault-visual.spec.ts` differs from its pre-Task-8 foundation baseline because the already-completed unlocked/search availability copy changed before this task. Neither assertion or baseline was weakened or updated.
- One combined relevant rerun experienced a migration teardown timeout after its test timeout; immediate isolated migration rerun passed 1/1, and the final required three-spec gate passed 3/3.

### Environment and bounded review

- Node: 24.18.0. This is an explicit local exception and emits the expected warning against the required `>=22.14.0 <23` range; no Node 22 environment was available.
- pnpm: 10.14.0 (pinned). Playwright: 1.62.0. Chrome for Testing: 151.0.7922.34. No Chrome 110 execution claim is made; the manifest floor remains 110.
- Independent self-review findings: Critical 0. Important 0 after closing the headless idle fixture and loading-state axe defects. Minor limitations are the packaged HOTP expiry timing omission (covered at source level), opaque-origin clipboard permission limitation (real write call/order instrumented without value capture), and the two unrelated full-suite failures documented above.
- No Git/worktree/branch/commit/push operation occurred. No Task 9 script/package change and no Task 9–13 implementation occurred.

Changed in Task 8.8:

- `tests/browser/project1-otp-crud.spec.ts`
- `tests/browser/fixtures.ts`
- `tests/browser/__screenshots__/popup-otp-linux.png`
- `tests/browser/__screenshots__/vault-otp-desktop-linux.png`
- `tests/browser/__screenshots__/vault-otp-compact-linux.png`
- `apps/extension/src/vault-access/VaultAccess.tsx`
- `.sdd/project1-task8-execution-ledger.md` (append only)

## Task 8.8 fix round 1/5 — strict packaged lifecycle and harness evidence

Date: 2026-08-10
Status: Corrections verified; this section supersedes Task 8.8 limitations and full-suite claims above. Execution remains stopped before Task 9.

### Review findings and TDD RED

- The prior countdown assertion accepted either urgency value and did not prove decrement or rollover. The prior HOTP replay occurred without a real worker stop. The fixture hid an uninstrumented seed launch and did not remove profiles. Clipboard instrumentation called the host clipboard. Migration coexistence had no populated same-page visual. The full-suite failures were incorrectly labeled unrelated instead of being closed.
- Added `fixture-clean-startup.spec.ts` first. Focused RED exited 1 because the default profile contained the hidden seeded lock-settings key (`localKeyCount` 1 rather than 0).
- Strengthened the OTP spec before harness changes. Focused RED proved the old countdown path did not reach the demanded urgency boundary under controlled-clock installation. Subsequent real-timer coverage exposed that coarse polling could skip the exact displayed `1`; the final test samples the safe countdown state at 50 ms around rollover and proves the observed pre-boundary value is at most 1 and the post-boundary refreshed projection is greater.
- Worker lifecycle REDs proved `newCDPSession` cannot attach directly to a Playwright Worker, `ServiceWorker.stopAllWorkers` did not provide usable wrapper-close evidence, and waiting for a new Playwright Worker object timed out because Chrome reuses the wrapper. The corrected CDP path uses `ServiceWorker.workerVersionUpdated`, active target closure, old-worker evaluation failure, and stopped-to-running version evidence without production hooks.
- The first migration coexistence assertion failed because no legacy source was present. The correction seeds the deterministic synthetic legacy fixture without altering it, reloads the populated encrypted OTP vault, and asserts the ready migration panel on the same page.
- Crypto smoke with only a 150-second timeout still timed out. Diagnosis isolated the non-production known-answer fixture's `parallelism: 4` as pathological in this headless Node 24/Chrome 151 environment. The fixture now uses production-default parallelism 1 with an independently computed pinned-library known answer; the production KDF floor and defaults are unchanged.

### Corrections and bounded evidence

- Default `context` now launches once and is instrumented from startup. It contains no hidden data. `fixture-clean-startup.spec.ts` proves local/session key counts are zero and startup issues are empty. An explicit `screenLockStabilized` option is enabled only by setup/unlock, migration, and OTP tests that perform long credentials in headless Chrome's synthetic locked-idle environment. Its write occurs in the already instrumented first context. Every profile is recursively removed in `finally` after context close.
- Clipboard `writeText` is replaced by a sink that never calls the original, retains/returns/logs no value, and records only invocation count plus whether `typeof value === "string"` and length is 5–10. The production adapter delegation remains covered by source tests. Because the original API is never invoked and no clipboard permission exists, the host clipboard is untouched without reading it.
- Popup countdown uses real timers. It proves an actual decrement, `data-urgent="true"` at six seconds or less, and the exact expiry crossing through a refreshed projection while inspecting only safe remaining/urgency DOM state. No code is read or logged.
- HOTP reserve and first commit use the real content isolated world and browser-owned binding. CDP captures the extension service-worker version/target, closes the active target, proves old worker evaluation fails, starts the registered worker, and observes stopped-to-running version state. After recreating/unlocking the background session, the same content document sends the same reservation ID. The bounded committed response exactly matches, the counter remains only +1, and active generation ID is unchanged, proving persisted receipt replay rather than live in-memory reservation state or a second root write.
- The populated same vault page asserts `Migrate legacy vault` in ready state and captures `vault-otp-migration-coexistence-linux.png` as a full-page concealed state showing the three OTP projections and migration panel together. No editor secret or code is visible.
- Reviewed and intentionally regenerated the approved pre-unlock Task 8 vault baselines `vault-desktop-linux.png` and `vault-compact-linux.png`; rerun without update passed.
- Crypto smoke timeout is 150 seconds and temporary profile cleanup is explicit. After the non-production parallelism correction, it passes in about 5 seconds.

### Fresh GREEN gates

- Focused fixture plus OTP: `pnpm exec playwright test tests/browser/fixture-clean-startup.spec.ts tests/browser/project1-otp-crud.spec.ts` — exit 0, 2/2 passed.
- Required three-spec gate after fresh security build: exit 0; output security 7/7 passed, scan passed, and OTP/setup/migration 3/3 passed.
- Full built browser suite: `pnpm test:browser:built` — exit 0, 15/15 passed in 1.4 minutes. This includes crypto smoke, clean startup, setup/unlock, migration, OTP lifecycle, popup/picker/vault visuals, runtime capture, and responsive coverage.
- `pnpm typecheck`, `pnpm lint`, focused Prettier, `pnpm dependencies`, and `pnpm build:security` all exited 0. Dependency Cruiser reported no violations across 181 modules and 515 dependencies; security output tests passed 7/7 and scanner passed.
- Final scans found no `console.log`, no clipboard permission or source authority addition, no synthetic OTP/password strings in `dist`, and unchanged manifest permissions (`storage`, `alarms`, `idle`), CSP, and Chrome floor 110.

Environment: Node 24.18.0 local exception with expected engine warning; pnpm 10.14.0; Playwright 1.62.0; Chrome for Testing 151.0.7922.34. No Chrome 110 execution claim. No Git operation, Task 9 package/script change, or Task 9–13 implementation occurred.

Changed in fix round 1/5:

- `tests/browser/fixtures.ts`
- `tests/browser/fixture-clean-startup.spec.ts`
- `tests/browser/project1-otp-crud.spec.ts`
- `tests/browser/project1-setup-unlock.spec.ts`
- `tests/browser/project1-migration.spec.ts`
- `tests/browser/crypto-smoke.spec.ts`
- `tests/crypto-extension/page.ts`
- `tests/browser/__screenshots__/vault-otp-migration-coexistence-linux.png`
- `tests/browser/__screenshots__/vault-desktop-linux.png`
- `tests/browser/__screenshots__/vault-compact-linux.png`
- `.sdd/project1-task8-execution-ledger.md` (append only)

## Task 8.8 fix round 2/5 — pre-CDP process diagnostics and bounded startup claims

Date: 2026-08-10
Status: Important startup-instrumentation claim corrected and verified. This section supersedes any earlier statement that Playwright listeners instrument extension startup from process creation. Execution remains stopped before Task 9.

### TDD RED and investigation

- Added `startup-diagnostics.test.ts` before the classifier existed. Focused Vitest exited 1 because `./startup-diagnostics` was absent. The test requires a synthetic extension-registry `FATAL` line emitted before any target listener to produce a bounded source-only finding and requires exact known benign DBus/object-proxy startup patterns to be ignored.
- The first dedicated child-process test timed out. Bounded diagnostics localized the wait to evaluating storage directly in a CDP-connected service-worker wrapper. Querying through a trusted extension page is reliable. A second failure showed headless Chromium exits when launched without an initial page; adding `about:blank` keeps the controlled process alive. The final process harness completes in under one second.
- Investigation confirmed `launchPersistentContext()` resolves only after Chromium and extension targets may already have started. Therefore the normal fixture's `context.on("serviceworker")`/console listeners provide post-launch runtime coverage only and cannot evidence the process-start window.

### Diagnostic mechanism and honest boundary

- `startup-process-harness.ts` launches the pinned `chromium.executablePath()` through Node `child_process.spawn` with a fresh temporary profile, the same unpacked `dist` load/disable flags used by the browser fixture, `--remote-debugging-port=0`, and `--enable-logging=stderr --v=1`. The stderr pipe listener is installed immediately on the returned child, so capture begins at process creation, before `DevToolsActivePort` exists or CDP can connect.
- The classifier retains no raw diagnostic payload in assertions. It reports only bounded `[FATAL:<source>]` or `[ERROR:<source>]` tokens. Exact allowlisting is limited to the observed benign `object_proxy.cc` DBus error source; warnings and verbose/info lines are not treated as proof of success. A 2 MB collection cap prevents unbounded diagnostics.
- After `DevToolsActivePort` appears, the harness connects over CDP, enumerates existing targets, requires the ShardPass `service-worker-loader.js` target, attaches bounded post-connection service-worker console monitoring, opens a trusted ShardPass vault page, and proves local/session storage are empty. It then closes/kills the process as needed and recursively removes the profile.
- Bounded limitation: target-level console listeners still begin only after the debugging endpoint becomes available. They cannot recover console events emitted and discarded before CDP attachment. The pre-CDP window is covered by process stderr, while post-connection target console errors are covered separately. No claim of complete pre-listener console capture is made.
- The regular Playwright fixture remains a single clean launch, adds listeners immediately after `launchPersistentContext` returns, and proves post-launch storage/runtime state only. Its test title now says “after Playwright launch,” not “from startup.” No production sentinel, error persistence, or product hook was introduced.

### Fresh verification

- Startup unit/process diagnostics: 2 files, 3/3 tests passed. The real child-process test observed the ShardPass target, zero local/session keys, zero classified fatal/error stderr findings, and zero post-CDP target console errors.
- Focused Playwright clean-start plus OTP: 2/2 passed.
- Fresh security build passed output tests 7/7 and scan. The first combined three-spec run later hit a migration teardown timeout after its 300-second test timeout; isolated migration immediately passed 1/1, and the clean required OTP/setup/migration rerun passed 3/3.
- Full `pnpm test:browser:built`: 15/15 passed in 1.2 minutes.
- `pnpm typecheck`, `pnpm lint`, focused Prettier, `pnpm dependencies`, and `pnpm build:security` all exited 0. Dependency Cruiser reported no violations across 181 modules and 515 dependencies; security output tests passed 7/7 and scanner passed.

Environment remains Node 24.18.0 local exception, pnpm 10.14.0, Playwright 1.62.0, Chrome for Testing 151.0.7922.34. Manifest permissions/CSP/Chrome floor are unchanged. No Git operation, Task 9 package/script change, or Task 9–13 implementation occurred.

Changed in fix round 2/5:

- `tests/browser/startup-diagnostics.ts`
- `tests/browser/startup-diagnostics.test.ts`
- `tests/browser/startup-process-harness.ts`
- `tests/browser/startup-process-harness.test.ts`
- `tests/browser/fixture-clean-startup.spec.ts`
- `.sdd/project1-task8-execution-ledger.md` (append only)


## Task 8.9 — repeatable focused verification scripts and cross-layer regression

Date: 2026-08-10
Status: Task 9 script contracts and the complete local Node 24 evidence path pass. The official Node 22 gate remains blocked by this machine's Node 24 runtime. Execution stopped before Task 10 review.

### TDD script-contract evidence

- RED: after adding the workspace contract first, `pnpm exec vitest run tests/tooling/workspace.test.ts` exited 1 with the expected missing-script failure: `format:check:project1:task8` was `undefined`. No package script had been added before this failure.
- GREEN: after the minimal package-script and documented format-exclusion additions, the same command exited 0 with 1/1 file and 6/6 tests passing.
- The contract pins `test:project1:task8`, `verify:project1:task8:evidence`, the Node-22-enforced `verify:project1:task8`, and the explicit development-only `verify:project1:task8:local-node24` strings. It rejects Git, recursive Task 8 verification, snapshot updates, and format writes.
- Existing `verify`, Project 0 verification, browser, build-security, dependency, package-manager, and engine contracts remain unchanged. `packageManager` remains `pnpm@10.14.0`; engines remain Node `>=22.14.0 <23` and pnpm `10.14.0`.

### Command design and bounded lifecycle

- `verify:project1:task8:evidence` is serial (`&&`) and runs typecheck, lint, the Task 8 format policy, dependency boundaries, a clean security build/output scan, the complete source suite, dedicated startup diagnostics, and the complete built browser suite before exact security/legacy regressions, reproducible-build verification, and the production audit.
- The security build creates fresh `dist/` before startup diagnostics. `test:browser:built` calls `build:test:crypto` before Playwright, so `.test-dist` exists before crypto browser coverage; Playwright remains one worker and nonparallel. The complete built suite includes OTP CRUD, setup/unlock, migration, clean startup, crypto, runtime, accessibility, and visual coverage without a duplicate extension security build.
- `format:check:project1:task8` checks all paths covered by the standing `.prettierignore`, except only the append-only Task 8 ledger and sealed read-only Task 7 recovery artifact listed in `.prettierignore.project1-task8`. The policy reason is documented in that file and asserted byte-for-byte by the workspace contract. No source file is excluded. General `format:check` and `verify` were not changed.

### Fresh verification

- `pnpm format:check:project1:task8` exited 0: all matched files use Prettier style.
- Official command: `pnpm verify:project1:task8` exited 1 immediately and correctly before evidence commands because the environment is Node 24.18.0, not required Node 22.14–22.x. pnpm was correctly detected as 10.14.0. This is the known official Node 22 blocker, not a release pass.
- Local command: `pnpm verify:project1:task8:local-node24` exited 0. It explicitly printed that the Node 24.18.0 bypass is development-only and does not clear the official Node 22 release blocker.
- In that complete local gate: TypeScript, ESLint, Task 8 Prettier, and Dependency Cruiser passed; Dependency Cruiser found no violations across 181 modules and 515 dependencies. The clean production security build passed 7/7 output tests and the build scanner.
- The complete source Vitest suite passed within the local gate. Dedicated startup diagnostics passed, including real process-spawn evidence. The complete built Playwright suite passed 15/15 in about one minute, including `project1-otp-crud`, setup/unlock, migration, clean startup, crypto smoke, runtime capture, visual, responsive, and accessibility cases.
- Exact-set standing regressions `pnpm exec vitest run tests/security tests/legacy` passed 7/7 files and 303/303 tests, including legacy artifact exact path/hash/type/symlink checks. Reproducible build verification passed 15 files with identical SHA-256 bytes. `pnpm audit --prod` reported no known vulnerabilities.
- No Chrome 110 execution claim is made. The minimum-Chrome policy and compatibility tests remain unchanged; this local browser evidence used the installed pinned Playwright Chromium environment.

Changed for Task 9:

- `package.json`
- `.prettierignore.project1-task8`
- `tests/tooling/workspace.test.ts`
- `.sdd/project1-task8-execution-ledger.md` (append only)

No secret-bearing output was added. No Git/worktree/commit operation was run. No Task 10 review or broader Project 1 Task 9–13 product implementation was started.


## Task 8.9 fix round 1/5 — regular-file legacy proof and scoped engine guidance

Date: 2026-08-10
Status: Both review findings were reproduced under strict TDD, corrected, and verified. This entry corrects rather than rewrites the prior Task 8.9 overclaim about the standalone legacy fixture proof. Execution remains stopped before Task 10.

### Finding 1 — standalone legacy proof followed symlinks

- Root cause: `tests/legacy/fixtures.test.ts` hashed each of the 17 preserved artifact paths with `readFile` directly. That proved target bytes but followed a final-component symlink and did not independently prove existence as a regular non-symlink file before reading. The separate build scanner had exact-set lstat coverage, but the prior ledger sentence incorrectly attributed path/hash/type/symlink proof to the combined standing regressions without distinguishing the standalone fixture assertion.
- RED: the test was first changed to require an `expectLegacyRegularFile` operation and a temporary symlink whose target had identical bytes. `pnpm exec vitest run tests/legacy/fixtures.test.ts` exited 1 with 2 expected failures because the lstat-based operation did not exist.
- GREEN: `expectLegacyRegularFile` now calls `lstat` before `readFile`, explicitly requires `isSymbolicLink() === false` and `isFile() === true`, then hashes the bytes. Thus a missing path rejects at lstat, a symlink is rejected even when its target bytes match, and a directory fails the regular-file assertion before any read/hash. The temporary fixture proves identical-byte symlink rejection without touching any preserved artifact.
- Focused legacy GREEN passed 9/9. The exact combined command `pnpm exec vitest run tests/security tests/legacy` passed 7/7 files and 304/304 tests. The 17 actual preserved entries passed the new lstat/type/symlink/hash sequence.

### Finding 2 — official Task 8 failure printed Project 0 guidance

- Root cause: `check-engine.mjs` hard-coded the Project 0 local script in every official-runtime failure. Task 8 correctly stopped on Node 24, but then advised the wrong command.
- RED: workspace contracts first required the exact Task 8 `--local-command=verify:project1:task8:local-node24` invocation, spawned the check under Node 24/pnpm 10.14 context, required Task 8 guidance with no Project 0 instruction, and required an injected/unallowlisted value to fail without reflection. The focused test exited 1 with 3 expected failures: old package script, Project 0 guidance, and absent invalid-command handling.
- GREEN: `check-engine.mjs` accepts only `verify:project0:local-node24` or `verify:project1:task8:local-node24` from `--local-command=`. Omission retains the Project 0 default. Any other value exits 1 with fixed `Invalid local verification command.` text and does not reflect input. The Task 8 official package script supplies its allowlisted local command; no engine or pnpm constraint changed.
- Workspace GREEN passed 8/8. `pnpm verify:project1:task8` still exited 1 before evidence on Node 24.18.0 and now printed only `Use verify:project1:task8:local-node24 for development evidence only.` A direct default invocation retained `verify:project0:local-node24` guidance. The allow-Node-24 path retained the fixed development-only warning that it does not clear the official Node 22 release blocker.

### Complete correction verification

- Affected contracts plus legacy tests passed 2/2 files and 17/17 tests. Typecheck, ESLint, and Task 8 Prettier passed.
- Fresh `pnpm verify:project1:task8:local-node24` exited 0. It passed dependency boundaries (181 modules/515 dependencies), clean security build and 7/7 output tests, complete source tests, startup diagnostics, the full built browser suite 15/15, exact security/legacy 304/304, reproducible build comparison for 15 identical files, and production audit with no known vulnerabilities.
- Official Node 22 remains unverified in this Node 24.18.0 environment. pnpm remains exactly 10.14.0 and engines remain Node `>=22.14.0 <23`. No release or Chrome 110 execution claim is made.

Changed in fix round 1/5:

- `tests/legacy/fixtures.test.ts`
- `scripts/check-engine.mjs`
- `tests/tooling/workspace.test.ts`
- `package.json`
- `.sdd/project1-task8-execution-ledger.md` (append only)

No actual preserved artifact was modified. No secret output, Git/worktree/commit operation, product behavior change, or Task 10 work occurred.


## Task 8 final comprehensive fixes — authoritative clipboard and OTP lock publication

Date: 2026-08-10
Status: Both final findings were reproduced under strict TDD, corrected, and verified. This entry supersedes earlier clipboard claims that synchronous cached `writeText` plus ignored `otp.copyCode` bookkeeping was safe. Task 10 remains untouched and incomplete.

### Finding 1 — synchronous activation with authoritative deferred clipboard payload

- Verified root cause: popup `OtpList.copy` read the cached display projection, synchronously called `writeClipboardText(currentCode.code)`, then sent `otp.copyCode` as ignored bookkeeping. Consequently update/delete/lock/root-authentication and expiry races could export a value the background no longer authorized.
- Compatibility basis: production manifest still targets minimum Chrome 110 with no clipboard permission. Chrome supports `ClipboardItem`, `navigator.clipboard.write()`, and promise-backed clipboard representations before Chrome 110. Runtime feature detection rejects with the fixed `CLIPBOARD_UNAVAILABLE` failure when either required API is absent. There is no cached-code or `writeText` fallback and no permission addition.
- RED: focused popup/platform tests exited 1 with the expected missing `writeAuthoritativeClipboardText` API and zero calls to the wished-for port. Tests required the clipboard API to be entered synchronously before `otp.copyCode` settled, the representation to remain unresolved until that response, a different returned code to be the only completed payload, and update/delete/lock/copy-failure/expired-response cases to complete zero writes.
- GREEN: the UI port now accepts only `Promise<string>`. Popup creates the pending payload and calls the port synchronously in the click handler, then starts command-bound `otp.copyCode`; only a matching, unexpired `otp.codeResult` resolves the payload. All failures reject it and produce fixed code-free feedback. The Chrome adapter immediately calls `navigator.clipboard.write([new ClipboardItem({"text/plain": Promise<Blob>})])`; it retains/logs no value. The fake counts invocation and safe completion only, retaining no payload.
- Browser instrumentation now sinks only `navigator.clipboard.write`. After the deferred representation resolves it inspects only one-item/type plus Blob MIME/size classification; it never converts the Blob to text, retains, logs, or forwards the code. No visual baseline changed because UI did not change.
- Focused GREEN: popup and Chrome platform passed 2/2 files, 37/37 tests. Full popup/platform/messaging/background focus passed 23/23 files, 312/312 tests.

### Finding 2 — authoritative state refresh after OTP lock-capable errors

- Verified root cause: an OTP repository read authenticates the active root and can fail closed by locking `SessionService` with `VAULT_UNAVAILABLE`/`VAULT_LOCKED`, but `installBackground` published OTP state only for successful mutation response kinds. Without a storage notification, other connected trusted pages retained unlocked projections.
- RED: a connected two-page runtime integration set up one unlocked session, observed both trusted pages unlocked, removed the active generation verification marker without sending a storage notification, and issued popup `otp.list` from page A. The response was `VAULT_UNAVAILABLE` and the session locked, but page B received no new publication; the test exited 1 at the expected publication-count assertion.
- GREEN: after every valid routed OTP response whose fixed error category is `VAULT_LOCKED` or `VAULT_UNAVAILABLE`, main calls `publisher.publish()`. The publisher reads `vault.getStateSnapshot()` from the real session/settings state; no error-derived state is synthesized. Its existing coalescing/retry/containment behavior remains responsible for duplicate suppression and read failures. The two-page integration now immediately receives an authoritative locked state on page B and passes without root reactivation or notification loops.

### Fresh verification and bounded limitations

- `pnpm test:project1:task8`: 47/47 files and 622/622 tests passed.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check:project1:task8`, and `pnpm dependencies` exited 0; Dependency Cruiser found no violations across 181 modules and 515 dependencies.
- Exact security/legacy command passed 7/7 files and 304/304 tests. Clean security build/output scan passed 7/7 output tests and scanner.
- Full packaged browser run passed 15/15 with updated non-retaining clipboard instrumentation. No snapshot baseline was changed.
- Reproducible build verification passed 15 byte-identical SHA-256 files. `pnpm audit --prod` reported no known vulnerabilities.
- The complete local Task 8 command was attempted twice. It reached the complete 69-file source suite and failed only because one existing CSS build-contract test exceeded its 5000 ms timeout under combined load (1022/1023 passed); that same file immediately passed separately 3/3 in 4.89 seconds, and the earlier Task 8 source suite passed it within 8.57 seconds. Because the serial local command stops at that timeout, remaining stages were run directly and passed as listed above. This is not recorded as a complete-command pass.
- Environment remains Node 24.18.0 development-only exception with pnpm 10.14.0. Official Node 22 and actual Chrome 110 execution remain unverified. Chrome 110 support is based on the pinned API compatibility floor plus TypeScript compilation and current pinned Chromium behavior; feature detection fails closed if an implementation does not support the deferred operation. Browser clipboard/user-activation behavior can vary outside the Chrome extension target, and no fallback weakens either invariant.

Changed for final fixes:

- `apps/extension/src/platform/extension-platform.ts`
- `apps/extension/src/platform/chrome-platform.ts`
- `apps/extension/src/popup/otp/OtpList.tsx`
- `apps/extension/src/background/main.ts`
- `packages/testing/src/fake-extension-platform.ts`
- affected popup/vault/platform/background tests and test fakes
- `tests/browser/project1-otp-crud.spec.ts`
- `.sdd/project1-task8-execution-ledger.md` (append only)

No Git/worktree/commit operation was run. No permission, visual baseline, secret-bearing output, Task 10 completion, or broader Task 10 implementation was added.

## Task 8 recovery — revision-bound clipboard copy (expectedRevision on otp.copyCode)

Date: 2026-08-10
Status: Recovery after a prior agent failed with a provider error. The ledger's preceding "final comprehensive fixes" entry described authoritative deferred clipboard activation and OTP-lock publication, but it did not bind clipboard copy to the displayed item revision. This entry completes that missing fix under strict TDD and verifies it. Task 9+ remains untouched.

### Recovery inspection (do not assume completion)

- Inspected disk state before editing: `packages/messaging/src/otp.ts` still shared one `itemRequest` factory across `otp.getCode`, `otp.copyCode`, and `otp.reserveHotp`, so `otp.copyCode` carried only `{version, kind, itemId}` and no revision. `OtpService.handle` dispatched both `otp.getCode` and `otp.copyCode` to `getCode(command.itemId)` with no expected-revision parameter. `OtpList.copy` sent `otp.copyCode` with only `itemId`, accepted a response whose revision it never checked, and guarded only on the displayed code's expiry (not its revision). No revision-bound copy logic existed on disk.
- The recovery therefore treats the revision-bound fix as not-yet-done and re-does it from RED.

### Required fix

1. Schema (`packages/messaging/src/otp.ts`): split `OtpCopyCodeRequestSchema` off the shared `itemRequest` factory and added `expectedRevision: positiveSafeInteger` to it only. `otp.getCode` and `otp.reserveHotp` remain item-only (`{version, kind, itemId}`). The exhaustive `otpResponseKindByRequest` map and `otpSenderPolicy` are unchanged because `otp.copyCode` still maps to `otp.codeResult` and the popup/vault sender policy is unchanged; `OtpCodeResultSchema` already carries `revision`, so no response-schema or mapping change was needed.
2. Service (`apps/extension/src/background/otp/otp-service.ts`): `handle` now routes `otp.copyCode` to `getCode(command.itemId, command.expectedRevision)`. `getCode` gained an optional `expectedRevision` and rejects with `OTP_CONFLICT` (via `conflict()`) when `value.revision !== expectedRevision` before `generateOtp` runs. The existing second reread/race validation (`repository.get` + `reparsed.revision !== value.revision`) is retained, so the revision is required unchanged from the bound expected value through the response. `otp.getCode` (display) is unchanged and accepts no `expectedRevision`.
3. Popup (`apps/extension/src/popup/otp/OtpList.tsx`): `copy` now fails before starting clipboard when the displayed `currentCode.revision !== item.revision` (the same guard list as expiry/HotP/already-copying). It sends `expectedRevision: item.revision` on `otp.copyCode`. The response gate now requires `response.kind === "otp.codeResult" && response.itemId === item.id && response.revision === item.revision && now() < response.expiresAt`; otherwise the deferred payload is rejected and no value resolves into the `ClipboardItem`. No cached fallback, no value retained or logged (the only `response.code` reference remains `resolvePayload(response.code)`, which feeds the deferred blob and nothing else).

### TDD RED

- Added focused failing tests before production changes:
  - `packages/messaging/test/otp.test.ts`: `validRequests` `otp.copyCode` now includes `expectedRevision: 1`; the rejection list adds missing-`expectedRevision`, non-positive, and non-integer `expectedRevision`; a new `binds revision only to otp.copyCode and leaves otp.getCode item-only` test asserts `otp.copyCode` requires `expectedRevision` while `otp.getCode` rejects it.
  - `apps/extension/test/background/otp-service.test.ts`: a stale-`expectedRevision` test (item at revision 2, `expectedRevision: 1` rejects `OTP_CONFLICT` with one get and no activity), a reread-race test for `otp.copyCode` (item bumped to revision 2 on the second get rejects `OTP_CONFLICT`, proving the existing race validation is retained for the copy path), and a positive match test returning the authoritative code with two gets and one activity note.
  - `apps/extension/test/popup/OtpList.dom.test.tsx`: a displayed-mismatch test (getCode returns revision 2 while the list item is revision 1 fails before `writeAuthoritativeClipboardText` with "Code unavailable" and zero writes) and a newer-revision-response test (same `itemId`, response revision 2 yields zero completed payloads, one clipboard entry, and "Copy failed").
- Focused RED exited 1 with 11 failures across the three files (4 messaging, 4 service, 3 popup), all the intended ones; 63 pre-existing tests passed.

### GREEN and regression evidence

- Focused GREEN: `vitest run` over the three files — 74/74 passed.
- Affected suites: `apps/extension/test/background apps/extension/test/platform apps/extension/test/popup` — 17 files, 230/230 passed (router 21, background-runtime integration 4, popup OtpList 26, chrome platform, and all vault/migration tests).
- Full relevant source: `pnpm test:project1:task8` — 627/628 passed; the single failure is the pre-existing `VaultApp.styles.test.ts > emits distinct local explanation classes` CSS build-contract test exceeding its 5000 ms timeout under combined load (it ran 5426 ms in-suite). Isolated rerun passed 3/3 in 6.04 s with that test at 2436 ms. No production or test logic change touched this test; the timeout is an aggregate-load artifact documented in earlier rounds.
- `pnpm typecheck`, `pnpm lint` (zero warnings), `pnpm format:check:project1:task8`, and `pnpm dependencies` (181 modules, 515 dependencies, no violations) all exited 0.
- Security build: `pnpm build:security` — output tests 7/7 passed, build scan passed. `tests/security` + `tests/legacy` — 304/304 passed. Startup diagnostics — 3/3 passed. Reproducible build — 15 byte-identical SHA-256 files. `pnpm audit --prod` — no known vulnerabilities.
- Full built browser suite: `pnpm test:browser:built` — 15/15 passed in 1.6 minutes, including the OTP CRUD lifecycle test (1.1 m) that now contains the new revision-bump conflict scenario. No visual baseline changed (the conflict bump is inserted after the vault screenshots and the migration-coexistence screenshot has no item selected, so no revision text is visible).

### Browser conflict/race coverage

- Extended `tests/browser/project1-otp-crud.spec.ts` (no new test count; assertions added to the existing serial OTP CRUD test). After the successful popup copy (`writes: 1, validPayloads: 1`), the popup is brought to front and stabilized so its displayed code settles at the current revision. The vault page then bumps the totp item revision via a document-bound `vault.evaluate` (`otp.list` → `otp.getEditor` → `otp.update` with the same editable input, so the visible label and all vault screenshot baselines are unchanged) without changing page focus. The popup still shows the stale revision, so the next Copy click sends the stale `expectedRevision`; the service rejects with `OTP_CONFLICT`; the popup shows a "Try again." failure and the completed-payload count is unchanged (zero additional completed clipboard writes).
- The instrumentation sinks only `navigator.clipboard.write`, records only call count plus a safe Blob MIME/size classification, and never converts the Blob to text, retains, logs, or forwards the code. The bump evaluate passes the synthetic seed (already stored in the vault and held only in test closure) through `chrome.runtime.sendMessage`; no OTP code is ever read, logged, or asserted.

### Honest limitations

- Environment: Node 24.18.0 development-only exception (engines require `>=22.14.0 <23`); pnpm 10.14.0; Playwright 1.62.0; Chrome for Testing 151.0.7922.34. Official Node 22 and actual Chrome 110 execution remain unverified.
- The one combined-source-suite CSS build-contract timeout under aggregate load is documented above and passes in isolation; it is not a regression introduced by this change.
- The built manifest ships exactly `storage`, `alarms`, `idle` (asserted by `tests/security/build-output.test.ts` and unchanged by this work); the root source `manifest.json` lists additional permissions that the build strips, and no permission was added or removed here.
- The browser conflict scenario is deterministic under the controlled sequence (popup focused and settled before the no-focus bump; copy click reads the stale revision before any focus-triggered reload could refetch). The opaque `chrome-extension://` origin still grants no clipboard permission, so the test instruments the real `navigator.clipboard.write` boundary and counts only safe completions, never the value.
- No Git/worktree/branch/commit/push operation occurred. No Task 9 script/package change and no Task 9–13 implementation occurred. Task 7 evidence/provenance was not touched.

Changed for the revision-bound clipboard copy recovery:

- `packages/messaging/src/otp.ts`
- `apps/extension/src/background/otp/otp-service.ts`
- `apps/extension/src/popup/otp/OtpList.tsx`
- `packages/messaging/test/otp.test.ts`
- `apps/extension/test/background/otp-service.test.ts`
- `apps/extension/test/popup/OtpList.dom.test.tsx`
- `tests/browser/project1-otp-crud.spec.ts`
- `.sdd/project1-task8-execution-ledger.md` (append only)
