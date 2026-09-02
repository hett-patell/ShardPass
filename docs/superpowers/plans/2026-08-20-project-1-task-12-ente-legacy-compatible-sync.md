# Project 1 Task 12 Ente Legacy-Compatible Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fail-closed, bidirectional, legacy-compatible synchronization of strict TOTP, HOTP, and Steam records between an unlocked ShardPass vault and exactly `https://api.ente.io`.

**Architecture:** A hard dependency/protocol gate first proves exact libsodium artifacts and selects an SRP implementation only after two independent byte-exact replays of sanitized legacy and current-pin SRP-4096 transcripts. Once that gate passes, background-only authentication, transport, encrypted sync state, bounded three-way merge, one-generation activation, durable writes, uncertainty reconciliation, and unlocked scheduling are exposed through strict capability-bound messages to metadata-only trusted UI. Production authority is added last and released only after packaged-browser, CSP, network, credential, integrity, license, audit, legacy-preservation, accessibility, and consolidated security gates pass.

**Tech Stack:** TypeScript 5.9.3 strict mode, React 19.2.8, Zod Mini 4.4.3, `libsodium-wrappers-sumo@0.8.4`, forced `libsodium-sumo@0.8.0`, one Phase-1-selected exact-pinned JavaScript SRP dependency, Chrome Manifest V3 minimum 110, official Node `>=22.14.0 <23`, pnpm exactly 10.14.0, Vitest 4.1.10, Testing Library 16.3.2, Playwright 1.62.0.

## Global Constraints

- The sole implementation authority is `docs/superpowers/specs/2026-08-20-project-1-task-12-ente-legacy-compatible-sync-design.md`, pinned to `ente-io/ente@c69dcf66704ad7ec1f95e32920455be429a566ef` and production origin `https://api.ente.io`.
- This plan explicitly supersedes `docs/superpowers/plans/2026-08-20-project-1-task-12-ente-readonly-snapshot.md`; that plan and its matching design remain untouched historical records. Their read-only/manual-only scope, old pin, official-`ente-core-wasm` choice, unchanged-CSP gate, and sequence must not leak into this implementation.
- `.sdd/project1-task12-execution-ledger.md` is append-only. Preserve every existing RED result, research entry, artifact hash, and `STOP-TASK12` disposition verbatim. Append a dated replacement-design authorization citing the approved design and new pin; never edit, delete, renumber, or reinterpret earlier STOP history.
- This is a non-Git workspace. Do not initialize Git or run branch, worktree, add, commit, merge, tag, or push commands. Each task ends in tests and a review gate rather than a commit.
- Implement exactly the three implementation phases below, in order. Do not start a later phase while a load-bearing finding remains unresolved.
- Official release evidence must use Node `>=22.14.0 <23`, pnpm exactly `10.14.0`, and Chrome 110. Node 24 or a newer Chromium is development evidence only and cannot clear the final gate.
- Direct dependency is exactly `libsodium-wrappers-sumo@0.8.4`, ISC, integrity `sha512-ql7hcgulKZ3ekfa2DGAogcCKsWU0diA/0nArz1CFzh93WQdb46/Kj18ka/Hifq6uA3Ush34Pc6vU/6HXeRwUkg==`, repository `https://github.com/jedisct1/libsodium.js`; pnpm must force transitive `libsodium-sumo@0.8.0`, ISC, integrity `sha512-Afy7Ya+jUT+JeBx93Vk83tFhmhOjLN521dVPYKi/KiLdHoSsa2j7qf9gxZmvo0HpVxlqhdrLX6nHhVPrfMqRhA==`.
- The owner-approved extension-page CSP is exactly `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.ente.io; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'`. Approval does not include `'unsafe-eval'`, `eval`, `Function`, string timers, blob/data/remote scripts, remote workers/WASM, arbitrary WebAssembly, or remotely fetched executable resources.
- No SRP package is selected at plan time. Evaluate exact-pinned maintainable JavaScript candidates, but add none to production until one reproduces both complete sanitized SRP-4096 suites byte-for-byte through two independent replay implementations and passes license, integrity, transitive, browser, CSP, maintenance, side-channel-surface, and output review. No handwritten SRP, generic bigint implementation, copied legacy minified code, `fast-srp-hap`, official WASM SRP, or libsodium-as-SRP shortcut is allowed.
- If no candidate clears the Phase 1 gate, append `STOP-TASK12-PHASE1-SRP`, retain only non-shipping evidence/tests/policy changes permitted by review, make no production manifest/host/connect-src/scheduler/UI change, and stop. Mocks, partial transcripts, source resemblance, or owner approval of `'wasm-unsafe-eval'` cannot waive this gate.
- Production transport accepts only scheme `https`, ASCII host `api.ente.io`, implicit port 443, no user info/trailing dot/caller base URL, endpoint-specific methods, canonical queries, `redirect: "error"`, `credentials: "omit"`, fixed headers, and `X-Auth-Token` only where required. Production settings have no server field.
- Sync only field-owned `EnteOtpProjection` values with `kind: "otp"` and `otpType: "totp" | "hotp" | "steam"`; reject generic records, login/password content, unknown fields, malformed/noncanonical `otpauth://` data, unsupported versions, and non-OTP endpoints at compile time, runtime, source scan, and packaged-output scan.
- Background owns network, reusable credentials/keys, decrypted remote content, mappings, bases, pending operations, conflicts, scheduler, and coordinator. The dedicated crypto worker has no network, Chrome API, storage, DOM, logging, generic dispatch, or persistence. Full-vault settings gets metadata only; popup is summary-only; content scripts get no Ente command or state authority.
- Persist reusable credentials, Auth key material, mappings, encrypted canonical bases, cursor, conflicts, and pending create/update/delete state only inside authenticated encrypted generation metadata. Never persist plaintext password, TOTP2FA code, token, key, seed, URI, remote ID, raw response, SRP transcript, or legacy plaintext integration secret.
- Enforce every immutable limit from design §8, especially page size 2,500, 40 incremental/full pages, 100,000 changes, 10,000 live/local/pending/conflict entries, 16 MiB response, 64 MiB cycle, 30-second request, 120-second cycle, 15-minute scheduler, and eight mutation attempts. Bounds fail before local activation or another mutation.
- Tests and screenshots use synthetic credentials, entities, and keys only and make no production request. Diagnostics contain only pin, phase, fixed error code, bounded counts, trigger, and booleans.

## Fixed Contracts

```ts
export const ENTE_PROTOCOL_PIN = "c69dcf66704ad7ec1f95e32920455be429a566ef" as const;
export const ENTE_API_ORIGIN = "https://api.ente.io" as const;
export const ENTE_ALARM_NAME = "shardpass:ente-otp-sync:v1" as const;
export const ENTE_SYNC_LIMITS = Object.freeze({
  pageSize: 2_500,
  maxPagesPerIncremental: 40,
  maxPagesPerSnapshot: 40,
  maxRemoteChanges: 100_000,
  maxLiveRemoteEntities: 10_000,
  maxLocalMappedItems: 10_000,
  maxPendingOperations: 10_000,
  maxConflicts: 10_000,
  maxResponseBytes: 16 * 1024 * 1024,
  maxCycleResponseBytes: 64 * 1024 * 1024,
  maxCiphertextBytes: 1024 * 1024,
  maxHeaderBytes: 4_096,
  maxDecryptedEntityBytes: 64 * 1024,
  maxCanonicalOtpUriBytes: 16 * 1024,
  maxEmailUtf8Bytes: 320,
  maxPasswordUtf8Bytes: 1_024,
  maxOtpCodeLength: 10,
  maxBase64TextBytes: 2 * 1024 * 1024,
  maxSafeTimestamp: 9_007_199_254_740_991,
  requestTimeoutMs: 30_000,
  cycleTimeoutMs: 120_000,
  schedulerMinutes: 15,
  maxMutationAttempts: 8,
  maxDiagnosticEventsPerCycle: 256,
});

export type EnteOtpProjection = Readonly<{
  version: 1;
  kind: "otp";
  otpType: "totp" | "hotp" | "steam";
  issuer: string;
  label: string;
  secretBase32: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: 6 | 7 | 8;
  period?: number;
  counter?: number;
  notes?: string;
  tags?: readonly string[];
}>;

export type EnteErrorCode =
  | "ENTE_INVALID" | "ENTE_UNAVAILABLE" | "ENTE_AUTH_FAILED"
  | "ENTE_TOTP2FA_REQUIRED" | "ENTE_REAUTH_REQUIRED" | "ENTE_SRP_UNSUPPORTED"
  | "ENTE_PROTOCOL_DRIFT" | "ENTE_LIMIT_REACHED" | "ENTE_TIMESTAMP_AMBIGUOUS"
  | "ENTE_CONFLICT" | "ENTE_CREATE_UNCERTAIN" | "ENTE_WRITE_UNCERTAIN"
  | "ENTE_STORAGE_CHANGED" | "ENTE_STORAGE_FAILED" | "ENTE_DEPENDENCY_INTEGRITY"
  | "ENTE_PERMISSION_DENIED";
```

All protocol, decrypted entity, persisted state, queue, conflict, message, and worker schemas are strict and return owned projections. These names and property spellings are contracts for all tasks below.

---

### Phase 1: Dependency, Protocol, Deterministic Crypto, and Hard SRP Gate

#### Task 1.1: Preserve authority history and pin strict protocol contracts

**Files:**
- Modify: `.sdd/project1-task12-execution-ledger.md` (append only)
- Create: `apps/extension/src/background/ente/protocol.ts`
- Create: `apps/extension/src/background/ente/schemas.ts`
- Create: `apps/extension/test/background/ente-protocol-current-pin.test.ts`
- Modify: `apps/extension/test/background/ente-schemas.test.ts`
- Modify: `tests/tooling/ente-official-source.test.ts`

**Interfaces:**
- Produces: `ENTE_PROTOCOL_PIN`, `ENTE_API_ORIGIN`, `ENTE_SYNC_LIMITS`, `EnteErrorCode`, `EnteOtpProjection`, `parseEnteProtocolResponse<T>(schema: ZodType<T>, input: unknown): T`, and strict schemas for SRP attributes/create/verify, TOTP2FA verify, Auth key, entity diff/create/update/delete.
- Protocol table: `GET /users/srp/attributes`, `POST /users/srp/create-session`, `POST /users/srp/verify-session`, `POST /users/two-factor/verify`, `GET /authenticator/key`, `GET /authenticator/entity/diff`, `POST|PUT /authenticator/entity`, and `DELETE /authenticator/entity` only.

- [ ] **RED:** append a replacement-design authorization entry that cites the approved design, new pin, preserved historical STOP, and prohibition on authorizing Phase 2 before this phase; then write tests asserting the exact constants/table, strict unknown-key rejection, canonical base64/UUID/query/timestamp rules, nullable tombstone/live pairing, endpoint-specific bounds, safe errors, and protocol-diff evidence against the pinned official symbols.
- [ ] Run `pnpm exec vitest run apps/extension/test/background/ente-protocol-current-pin.test.ts apps/extension/test/background/ente-schemas.test.ts tests/tooling/ente-official-source.test.ts`; expect failure because the new pin/contracts and complete current endpoint schemas are absent.
- [ ] **GREEN:** implement only field-by-field schemas and fixed constants. `parseEnteProtocolResponse` must catch library detail and throw a fixed `EnteProtocolError(code: EnteErrorCode)` without interpolating input, endpoint, body, email, ID, or crypto value.
- [ ] Run the same command plus `pnpm typecheck`; expect all protocol/schema tests to pass and the negative `LoginItem` compile assertion to remain consumed.
- [ ] **Review gate:** compare every method/path/body/response field with official pin `c69dcf66704ad7ec1f95e32920455be429a566ef`; reject generic URL/method/header/body/fetch interfaces, old pin occurrences in current code/evidence, or any edit to historical documents/ledger lines.

#### Task 1.2: Exact-pin libsodium, integrity/license policy, and deterministic wire vectors

**Files:**
- Modify: `apps/extension/package.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/extension/src/background/ente/sodium-adapter.ts`
- Create: `apps/extension/test/background/ente-sodium-adapter.test.ts`
- Create: `tests/fixtures/ente/sodium-wire-vectors.json`
- Create: `tests/security/ente-libsodium-policy.test.ts`
- Modify: `tests/tooling/dependencies.test.ts`
- Modify: `dependency-cruiser.config.cjs`
- Modify: `tools/security/executable-policy.ts`
- Modify: `tests/security/executable-policy.test.ts`

**Interfaces:**
- Produces: `createEnteSodiumAdapter(): Promise<EnteSodiumAdapter>` where the adapter exposes only bounded `randomBytes`, canonical base64 encode/decode, constant-time equality, reviewed `crypto_pwhash`, box/sealed-box, secretbox, and pin-proven Auth metadata operations, plus `dispose(): void`.
- Fixture shape: `{ protocolPin, wrapperVersion, wasmVersion, generatorSha256, vectors: readonly { operation, input, deterministicRandom, expectedWire }[] }` with synthetic values only.

- [ ] **RED:** test exact manifest dependency, pnpm override, lock edge/version/integrity/license/repository, deterministic encrypted wire encodings, fresh nonce behavior outside vectors, malformed/wrong-key/domain-separation failures, bounds before allocation, copy-owned outputs, dispose-after-use, export/call allowlist, and absence of CDN/fallback/runtime download/Emscripten JS fallback.
- [ ] Run `pnpm exec vitest run apps/extension/test/background/ente-sodium-adapter.test.ts tests/security/ente-libsodium-policy.test.ts tests/tooling/dependencies.test.ts tests/security/executable-policy.test.ts`; expect failure on absent exact pins, policy, vectors, and adapter.
- [ ] **GREEN:** add exact direct pin and root `pnpm.overrides` forcing `libsodium-sumo: 0.8.0`; regenerate the lockfile with pnpm 10.14.0; centralize all wrapper access in `sodium-adapter.ts`; generate and pin synthetic deterministic wire vectors without shipping the generator.
- [ ] Run the focused tests, `pnpm audit --prod`, `pnpm dependencies`, and `pnpm typecheck`; expect exact graph/integrities/licenses, no advisory, no forbidden import, and byte-exact vectors.
- [ ] **Review gate:** inventory all wrapper exports, production imports/calls, transitive packages, loader behavior, WASM imports/exports, allocation/view ownership, errors, disposal, known advisories, and maintainability. Record that no independent audit of this exact integration is claimed.

#### Task 1.3: Owner-approved local WASM CSP harness and output controls

**Files:**
- Create: `tests/crypto-extension/ente-sodium-worker.ts`
- Modify: `tests/crypto-extension/manifest.ts`
- Modify: `tests/crypto-extension/vite.config.ts`
- Create: `tests/browser/ente-sodium-csp.spec.ts`
- Modify: `tests/security/csp.test.ts`
- Modify: `tests/security/build-output.test.ts`
- Modify: `scripts/scan-build.mjs`

**Interfaces:**
- Produces build evidence `{ wrapperIntegrity, wasmIntegrity, wasmSha256, loaderSha256, wasmImports, wasmExports, csp }` consumed by Phase 3 release verification.

- [ ] **RED:** add tests requiring local integrity-matched libsodium WASM to initialize under the exact owner-approved CSP, fail when `'wasm-unsafe-eval'` is removed, and reject `'unsafe-eval'`, eval/Function/string timers, blob/data/remote scripts, remote/computed imports, remote workers/WASM, web-accessible WASM, extra `.wasm`, unexpected loader/WASM digest or import/export, and non-inventoried executable output.
- [ ] Run `pnpm build:test:crypto && pnpm exec playwright test tests/browser/ente-sodium-csp.spec.ts && pnpm exec vitest run tests/security/csp.test.ts tests/security/build-output.test.ts`; expect failure before the local-only harness and scanner know the reviewed artifact.
- [ ] **GREEN:** package the npm-supplied WASM only through a fixed worker entry, extend executable policy/scanner with exact artifact inventory and digests, and keep the production manifest unchanged in this phase.
- [ ] Re-run the focused browser/security commands; expect controlled success with exact CSP, controlled failure without `'wasm-unsafe-eval'`, and rejection of every broader executable capability.
- [ ] **Review gate:** confirm the approval is narrow, no arbitrary WebAssembly API is exposed, the WASM is not web-accessible, tree-shaking is not treated as a boundary, and no production host/CSP/UI/scheduler change occurred.

#### Task 1.4: Sanitized complete legacy and current-pin SRP-4096 transcripts

**Files:**
- Create: `tests/fixtures/ente/srp-legacy-1.2.1-transcript.json`
- Create: `tests/fixtures/ente/srp-current-pin-transcript.json`
- Create: `scripts/generate-ente-srp-transcripts.mjs`
- Create: `scripts/replay-ente-srp-reference.mjs`
- Create: `tests/tooling/ente-srp-transcripts.test.ts`
- Modify: `scripts/scan-build.mjs`

**Interfaces:**
- Each transcript provides synthetic email/password, group modulus/generator/hash/padding/username encoding, salt, KDF/login key, fixed client private ephemeral, `A`, fixed server private ephemeral, `B`, scrambling parameter, premaster secret, session key, `M1`, `M2`, request framing, rejection vectors, generator provenance, and SHA-256 digest.
- Produces: `replaySrpTranscript(transcript): Promise<{ A; B; u; premaster; sessionKey; M1; M2 }>` as the independent reference replay used only by tests/tooling.

- [ ] **RED:** write tests requiring complete non-redacted fields, synthetic-only canaries, exact legacy 1.2.1 framing, exact current-pin `SrpSession`/create-session/verify-session framing, byte-exact reference replay, and rejection of leading-zero mistakes, invalid `A`/`B`, wrong `M2`, malformed base64, out-of-range values, transcript mix-up, and legacy/current divergence.
- [ ] Run `pnpm exec vitest run tests/tooling/ente-srp-transcripts.test.ts`; expect failure because both complete regenerated suites and provenance digests do not yet exist.
- [ ] **GREEN:** derive the current suite from the pinned official source and legacy suite from preserved reviewed 1.2.1 evidence using deterministic test-only ephemerals and non-production keys; implement an independent test-only replay; pin fixture and generator digests; make build scanning reject generators/transcripts in `dist/`.
- [ ] Re-run the transcript test twice from clean generated outputs and compare hashes; expect byte-identical results and all negative vectors to fail closed.
- [ ] **Review gate:** have two reviewers independently verify synthetic provenance, complete value coverage, generator source/pin, no production account data, no copied legacy executable code, and byte-order/padding/framing details.

#### Task 1.5: Evaluate JavaScript SRP candidates and enforce the non-waivable selection gate

**Files:**
- Create: `tests/tooling/ente-srp-candidate-gate.test.ts`
- Create: `scripts/evaluate-ente-srp-candidate.mjs`
- Create only after a candidate passes: `apps/extension/src/background/ente/srp-adapter.ts`
- Create only after a candidate passes: `apps/extension/test/background/ente-srp-adapter.test.ts`
- Modify only after a candidate passes: `apps/extension/package.json`
- Modify only after a candidate passes: `package.json`
- Modify only after a candidate passes: `pnpm-lock.yaml`
- Modify only after a candidate passes: `tools/security/executable-policy.ts`
- Modify: `.sdd/project1-task12-execution-ledger.md` (append gate evidence or STOP only)

**Interfaces:**
- Candidate adapter, if selected: `createEnteSrpClient(input: { usernameUtf8: Uint8Array; passwordKey: Uint8Array; salt: Uint8Array; clientPrivateEphemeral: Uint8Array }): EnteSrpClient`; methods `clientPublicA(): Uint8Array`, `clientProof(serverPublicB: Uint8Array): { M1: Uint8Array; sessionKey: Uint8Array }`, `verifyServerProof(M2: Uint8Array): void`, and `dispose(): void`.
- Candidate report schema: `{ name, version, integrity, license, repository, transitiveGraphSha256, maintenanceEvidence, browserResult, cspResult, sideChannelSurface, outputInventory, legacyReplaySha256, currentReplaySha256, independentReplayAgreement, selected }`.

- [ ] **RED:** make the gate fail unless one exact-pinned candidate produces both complete transcripts byte-for-byte, agrees with the independent replay, rejects every negative vector, has reviewed license/integrity/transitives/maintenance/browser/CSP/side-channel/output evidence, and has an explicit selection record. The test must also fail if more than one candidate or any fallback/handwritten/generic-bigint path is production reachable.
- [ ] Evaluate the script's reviewed candidate set in isolated temporary installs without adding any candidate to the production manifest. Run `node scripts/evaluate-ente-srp-candidate.mjs --all-reviewed-candidates`; require the script to resolve each registry name to an explicit version and integrity before execution, reject ranges/tags/unpinned transitives, and record fixed non-secret evidence and rejection reasons in the append-only ledger.
- [ ] If no candidate passes, append `STOP-TASK12-PHASE1-SRP`, run `pnpm exec vitest run tests/tooling/ente-srp-candidate-gate.test.ts` to preserve the expected blocking result, verify production manifest/host/CSP/UI/scheduler are unchanged, and stop all Task 12 work.
- [ ] If exactly one candidate passes, add only that exact package/integrity, implement the narrow adapter above without fallback, and run both transcript suites through candidate and independent replay; expect byte-for-byte equality and all malformed inputs to be rejected.
- [ ] Run `pnpm exec vitest run tests/tooling/ente-srp-candidate-gate.test.ts apps/extension/test/background/ente-srp-adapter.test.ts tests/tooling/ente-srp-transcripts.test.ts && pnpm audit --prod && pnpm dependencies && pnpm build:security`; expect a single selected dependency, no fallback, no generator/fixture in output, and clean review evidence.
- [ ] **Consolidated Phase 1 gate:** review protocol pin, exact libsodium graph/integrities/licenses, deterministic sodium vectors, both complete SRP transcripts/two replays, selected SRP dependency, local WASM/CSP/browser/output evidence, dependency boundaries, and every finding. Phase 2 is authorized only when all pass with no unresolved load-bearing finding; otherwise append the exact STOP and halt.

### Phase 2: Background Authentication, Encrypted Bidirectional Sync, and Bounded Scheduling

#### Task 2.1: Encrypted sync state, legacy conversion, and one-generation repository

**Files:**
- Create: `apps/extension/src/background/ente/sync-state.ts`
- Create: `apps/extension/src/background/ente/sync-repository.ts`
- Create: `apps/extension/test/background/ente-sync-state.test.ts`
- Create: `apps/extension/test/background/ente-sync-repository.integration.test.ts`
- Modify: `apps/extension/src/background/ente/ente-otp-metadata-store.ts`
- Modify: `apps/extension/test/background/ente-otp-metadata-store.test.ts`
- Modify: `packages/storage/src/vault-format.ts`
- Modify: `packages/storage/src/generation-store.ts`
- Modify: `packages/storage/src/index.ts`
- Modify: `packages/storage/test/generation-store.test.ts`
- Modify: `tests/fixtures/legacy/vault-ente-state.json`

**Interfaces:**
- Produces: strict `EnteOtpSyncState` version 1 containing pin/origin marker, account fingerprint, encrypted credential/Auth-key envelope, bijective mappings, complete encrypted canonical bases and digests, cursor, pending operations, at most one uncertain operation, encrypted conflicts, scheduler state, and `needsReauth`.
- Produces: `EnteSyncRepository.read(session): Promise<EnteSyncSnapshot>` and `commit(expectedRoot, mutation: EnteGenerationMutation): Promise<"activated" | "root-changed">`, where one mutation retains all unrelated records/journals/HOTP receipts and activates exactly one verified generation.

- [ ] **RED:** test strict state bounds, encrypted-at-rest canaries, bijection/corruption detection, pending create/update/delete schemas, queue normalization (`create+update`, unattempted `create+delete`, repeated update, `update+delete`), uncertain-operation immutability, legacy mapping/pending conversion, exact-server normalization, custom-server/orphan/duplicate/oversize block, and plaintext legacy-secret removal in the same generation.
- [ ] Run focused state/repository/storage tests; expect failure because current metadata stores counts only and lacks versioned encrypted state/atomic mutation.
- [ ] **GREEN:** implement state parsing and repository staging/verification/expected-root activation through the existing `GenerationStore`; on root change abandon staged data and return `"root-changed"`; never activate record-by-record or use a second metadata generation.
- [ ] Run tests for interruptions before/during/after stage, verify, and activation, storage loss, root races, and retention of unrelated records/journals/receipts; expect old complete or new complete state only.
- [ ] **Review gate:** inspect storage keys/messages/logs for credential, key, seed, URI, remote ID, base, and queue canaries; confirm only authenticated encrypted generation blobs contain reusable state and historical legacy fixture hashes remain accounted for.

#### Task 2.2: Fixed-origin endpoint client and SRP plus Ente TOTP2FA authentication

**Files:**
- Create: `apps/extension/src/background/ente/client.ts`
- Create: `apps/extension/src/background/ente/auth.ts`
- Create: `apps/extension/test/background/ente-client.test.ts`
- Create: `apps/extension/test/background/ente-auth.test.ts`
- Create: `tests/fixtures/ente/synthetic-transport.ts`
- Create: `apps/extension/src/vault/ente/ente-auth-worker-protocol.ts`
- Create: `apps/extension/src/vault/ente/ente-auth-worker.ts`
- Create: `apps/extension/src/vault/ente/ente-auth-executor.ts`
- Create: `apps/extension/test/vault/ente-auth-worker.test.ts`

**Interfaces:**
- `EnteClient` exposes only `getSrpAttributes(email, signal)`, `createSrpSession(body, signal)`, `verifySrpSession(body, signal)`, `verifyTotp2fa(body, signal)`, `getAuthenticatorKey(token, signal)`, `getEntityDiff(token, sinceTime, signal)`, `createEntity(token, body, signal)`, `updateEntity(token, body, signal)`, and `deleteEntity(token, id, signal)`.
- `authenticateEnte(input: { email; passwordJob; totpCode?; signal }): Promise<{ status: "totp-required"; challengeCapability } | { status: "authenticated"; reusableCredentialEnvelope; maskedEmail }>`.

- [ ] **RED:** assert exact `https://api.ente.io`, methods/paths/canonical query keys, fixed headers, `X-Auth-Token` placement, omit credentials, redirect errors, bounded status/header/body before JSON/base64, request/cycle abort, and fixed errors. Reject custom host/port/trailing dot/userinfo/base URL/generic fetch, cookies, redirects, raw errors, response messages, and query interpolation.
- [ ] **RED:** assert compatible SRP transcript framing, TOTP-only second factor, Authenticator-key recovery, challenge capability expiry/replay/session binding, password transfer to one-job worker, TOTP code clearing, 401 reauth, unsupported/missing Auth key, and no OTT/passkey/signup/enrollment branches.
- [ ] Run client/auth/worker tests; expect failure on absent endpoint and auth implementations.
- [ ] **GREEN:** implement the endpoint-specific client against injected synthetic fetch and the selected Phase-1 SRP plus sodium adapters; transfer owned password bytes once, keep reusable state background-owned, and dispose worker inputs/results best effort on success/error/cancel/lock.
- [ ] Run focused tests and canary assertions over storage, messages, DOM-shaped outputs, logs, diagnostics, and errors; expect no raw secret-bearing value outside the permitted worker/background lifetime.
- [ ] **Review gate:** verify no production authority is enabled yet, no test address is recognized by production code, and only SRP+TOTP2FA plus existing Auth key are reachable.

#### Task 2.3: Strict OTP adapter and bounded incremental/full read engine

**Files:**
- Create: `apps/extension/src/background/ente/otp-adapter.ts`
- Create: `apps/extension/src/background/ente/read-engine.ts`
- Create: `apps/extension/test/background/ente-otp-adapter.test.ts`
- Create: `apps/extension/test/background/ente-read-engine.test.ts`
- Modify: `dependency-cruiser.config.cjs`

**Interfaces:**
- `parseEnteOtpEntity(entity, authKey): Promise<EnteOtpProjection>` and `encryptEnteOtpEntity(projection, authKey, random): Promise<{ encryptedData; header }>`; no `VaultItem` or generic item type crosses this interface.
- `readRemoteState(input: { client; token; authKey; sinceTime; forceSnapshot; signal }): Promise<{ mode: "incremental" | "snapshot"; entities: ReadonlyMap<string, RemoteOtpState>; nextCursor: number }>`.

- [ ] **RED:** test canonical TOTP/HOTP/Steam round trips and reject non-OTP schemes/types, LoginItem/password/unknown fields, duplicate query keys, fragments, userinfo, malformed percent/base32, controls/NUL/surrogates, invalid algorithm/digits/period/counter, missing label/secret, unsupported entity shape/version, oversized data, and non-round-tripping plaintext.
- [ ] **RED:** cover empty/partial/full 2,500-row pages, 40-page/100,000 caps, 10,000 live cap, tombstones, duplicate IDs, equal-boundary timestamp, non-progress, repeated/contradictory row, timestamp regression/malformed value, incremental candidate discard, exactly one `sinceTime=0` fallback, fallback failure, and cursor reset/advance rules.
- [ ] Run adapter/read tests; expect failure on absent implementations.
- [ ] **GREEN:** implement field-by-field canonical parsing/encryption and deterministic remote normalization; any ambiguity must discard the incremental candidate before mutation and perform one bounded full snapshot; unresolved full-snapshot ambiguity returns `ENTE_TIMESTAMP_AMBIGUOUS` with no cursor/merge/write.
- [ ] Run focused tests, typecheck, dependency-cruiser, and hostile decrypted-plaintext tests; expect compile-time and runtime OTP-only enforcement.
- [ ] **Review gate:** scan source for generic Ente entity adapters, `VaultItem`, `LoginItem`, password models, arbitrary JSON, non-OTP endpoints, and timestamp-as-authority logic; all must be absent from the adapter/read boundary.

#### Task 2.4: Three-way merge, explicit conflicts, and one-generation activation

**Files:**
- Create: `apps/extension/src/background/ente/merge.ts`
- Create: `apps/extension/src/background/ente/conflicts.ts`
- Create: `apps/extension/test/background/ente-merge.test.ts`
- Create: `apps/extension/test/background/ente-conflicts.test.ts`
- Create: `apps/extension/test/background/ente-one-generation.integration.test.ts`

**Interfaces:**
- `mergeEnteOtp(input: { base; local; remote; mappings; pending }): EnteMergePlan` implements exact B/L/R byte equality and returns local record mutations, mapping/base updates, normalized pending operations, and encrypted conflict bodies without applying them.
- `resolveEnteConflict(input: { conflictId; choice: "keep-local" | "keep-ente" | "keep-both"; capability; currentDigests }): EnteMergePlan`; keep-both is legal only when local and remote are live.

- [ ] **RED:** table-test every design §14 B/L/R row, local/remote additions, unknown tombstone, mapping corruption, edit/edit, edit/delete, delete/edit, delete/delete, convergent equality, HOTP counter divergence, each conflict choice, keep-both precondition, stale digest/session capability, and absence of newest-wins/default/bulk/timeout resolution.
- [ ] Run merge/conflict tests; expect failure because merge planner and freshness-bound decisions are absent.
- [ ] **GREEN:** implement versioned canonical byte comparison, metadata-only conflict projections, random expiring single-purpose capabilities bound to session epoch and B/L/R digests, and root/remote reread before applying a choice.
- [ ] Integrate plans with `EnteSyncRepository.commit`; test exactly one activated generation per accepted merge, complete unrelated-state retention, and full recomputation after `"root-changed"`.
- [ ] **Review gate:** confirm neither local nor remote timestamp chooses content, true divergence never writes automatically, and UI projection excludes seed, URI, remote ID, base digest, token/key/ciphertext, HOTP code, and queue payload.

#### Task 2.5: Durable writes, preflight, conflicts, and uncertain reconciliation

**Files:**
- Create: `apps/extension/src/background/ente/write-engine.ts`
- Create: `apps/extension/test/background/ente-write-engine.test.ts`
- Create: `apps/extension/test/background/ente-uncertain-writes.integration.test.ts`

**Interfaces:**
- `executeQueueHead(input: { snapshot; client; token; authKey; signal }): Promise<WriteDisposition>` handles exactly one deterministic queue head.
- `reconcileUncertain(input: { operation; beforeSnapshot; fullSnapshot }): ReconciliationDisposition` returns `complete`, `retry`, `conflict`, or `blocked-create-uncertain`.

- [ ] **RED:** prove no request before durable intent; immediate preflight rechecks unlock/session/account/pin/head/snapshot/conflict; attempts increment durably before dispatch; one write at a time; strict create entity success; provisional update/delete; 401 `needsReauth`; fixed 4xx block; 5xx retain; eight-attempt manual block.
- [ ] **RED:** inject timeout, abort, network loss, restart, lock, malformed/truncated success, post-response storage failure, and exception after handoff; require one uncertain head, no later write, mandatory full snapshot before retry, update/delete desired/base/divergent classification, and create unique/zero/multiple/indeterminate before-after matching.
- [ ] Run write and interruption tests; expect failure on absent write state machine.
- [ ] **GREEN:** construct bounded plaintext only after preflight, encrypt with fresh randomness, dispose buffers best effort, durably mark handoff uncertainty, preserve provisional update/delete until observed, and never infer uncertain-create identity from content equality alone.
- [ ] Re-run tests at every network/storage boundary; expect full-snapshot reconciliation, conflict conversion, no duplicate auto-retry, and no lost queue intent.
- [ ] **Review gate:** trace each mutation from durable enqueue through attempt, dispatch, response, next generation, interruption, and disconnect; reject any window where a write can occur without recoverable local intent.

#### Task 2.6: Background coordinator, message authority, and unlocked triggers

**Files:**
- Create: `apps/extension/src/background/ente/coordinator.ts`
- Create: `apps/extension/src/background/ente/ente-service.ts`
- Create: `packages/messaging/src/ente.ts`
- Create: `packages/messaging/test/ente.test.ts`
- Modify: `packages/messaging/src/index.ts`
- Modify: `packages/security/src/errors.ts`
- Modify: `apps/extension/src/background/router.ts`
- Modify: `apps/extension/src/background/main.ts`
- Modify: `apps/extension/src/background/vault/session-service.ts`
- Modify: `apps/extension/src/platform/extension-platform.ts`
- Modify: `apps/extension/src/platform/chrome-platform.ts`
- Create: `apps/extension/test/background/ente-coordinator.test.ts`
- Modify: `apps/extension/test/background/router.test.ts`
- Modify: `apps/extension/test/background/background-runtime.integration.test.ts`
- Modify: `apps/extension/test/platform/chrome-platform.test.ts`

**Interfaces:**
- `EnteSyncCoordinator.trigger(trigger: "connected" | "restart" | "unlock" | "manual" | "alarm"): Promise<void>`, `cancel(): void`, `lock(): void`, and `dispose(): void`; at most one running and one coalesced follow-up cycle.
- Strict versioned requests: `ente.status`, `ente.connect`, `ente.submitTotp2fa`, `ente.manualSync`, `ente.cancel`, `ente.resolveConflict`, `ente.reauthenticate`, `ente.disconnectPreview`, `ente.disconnectConfirm`; responses expose only the 18 safe UI states/counts/times/masked email/capabilities.

- [ ] **RED:** test successful connection trigger, restart while unlocked, locked restart deferral to unlock, explicit manual trigger, exact alarm name/15-minute period, connected+unlocked gating, one running/one follow-up, abort on lock/restart, uncertain handoff, no sub-15-minute retry loop, and offline/auth wait.
- [ ] **RED:** reject content, popup mutation, web page, external extension, wrong frame/URL, stale document/session, malformed version, unknown keys, replayed/expired capability, and generic command dispatch; verify popup receives summary only and content receives no Ente state.
- [ ] Run coordinator/messaging/router/runtime/platform tests; expect failure on absent strict commands and scheduler ownership.
- [ ] **GREEN:** wire the sole coordinator into background startup/session transitions/alarm platform, serialize cycles with mutex plus persisted epoch, invalidate capabilities and abort transport/workers on lock/disconnect/reset/account/session change, and reload encrypted metadata only after unlocked authorization.
- [ ] Implement disconnect as one confirmed local-only generation removing credentials/mappings/bases/cursor/conflicts/pending state; show safe counts, warn on uncertain outcome, and make no network request or local/remote OTP deletion.
- [ ] Run all Phase 2 tests plus `pnpm typecheck && pnpm lint && pnpm dependencies`; expect deterministic mock transport only and no production host authority.
- [ ] **Consolidated Phase 2 gate:** review interruption coverage at every boundary, root recomputation, timestamp fallback, complete conflict/deletion matrix, queue coalescing/bounds, uncertain create/update/delete, no-write-before-intent, credential lifecycle, sender authority, restart/manual/15-minute behavior, and absence of production authority. Resolve every load-bearing finding before Phase 3.

### Phase 3: UI, Production Authority, Packaged Browser/Security Evidence, Documentation, and Final Gate

#### Task 3.1: Complete trusted settings UI and summary-only popup

**Files:**
- Create: `apps/extension/src/vault/ente/EnteSettings.tsx`
- Create: `apps/extension/src/vault/ente/EnteSettings.module.css`
- Create: `apps/extension/src/vault/ente/useEnteSync.ts`
- Create: `apps/extension/test/vault/EnteSettings.dom.test.tsx`
- Modify: `apps/extension/src/vault/VaultApp.tsx`
- Modify: `apps/extension/src/vault/VaultApp.module.css`
- Modify: `apps/extension/test/vault/VaultApp.dom.test.tsx`
- Modify: `apps/extension/src/popup/PopupApp.tsx`
- Modify: `apps/extension/test/popup/PopupApp.dom.test.tsx`

**Interfaces:**
- `useEnteSync()` returns the strict metadata-only state and command functions matching Task 2.6; sensitive email/password/TOTP2FA values are never returned after transfer.
- `EnteSettings` renders exactly the 18 states in design §18.2 and exact keep-local/keep-Ente/keep-both and disconnect consequences.

- [ ] **RED:** table-test all 18 states, no server field, exact `api.ente.io`/OTP-only/15-minute/conflict/uncertainty consequence copy, sensitive clearing on submit/transition/cancel/error/lock/replacement/unmount, stale async suppression, no preselected/default conflict action, and metadata-only DOM/accessibility tree.
- [ ] **RED:** test keyboard operation, focus order/restoration, restrained live regions, labels/descriptions, reduced motion, 320 CSS-pixel compact layout, and popup summary with only “Open vault settings” and no connect/sync/resolve/disconnect mutation.
- [ ] Run vault/popup DOM and style tests; expect failure before the settings state machine exists.
- [ ] **GREEN:** implement the strict hook/panel, conflict rows with individually described choices, disabled cancellation during local activation, and safe category-only write progress; clear component and worker-owned sensitive buffers on every specified transition.
- [ ] Re-run DOM/style tests and automated axe checks; inspect rendered output with canaries for secrets, IDs, URIs, ciphertext, queue data, hashes, and complete records; expect none.
- [ ] **Review gate:** perform keyboard/screen-reader/focus/320px/reduced-motion review and verify only the exact full-vault page can mutate Ente state.

#### Task 3.2: Enable exact production authority and packaged synthetic-server browser matrix

**Files:**
- Modify: `apps/extension/src/manifest.ts`
- Modify: `tests/security/manifest.test.ts`
- Modify: `tests/security/csp.test.ts`
- Create: `tests/browser/ente-synthetic-server.ts`
- Create: `tests/browser/project1-ente-sync.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Manifest host permission is exactly `https://api.ente.io/*`; extension-page CSP equals the approved string exactly.
- Browser harness redirects the exact origin only at Playwright/network interception; production code still sees and permits only `https://api.ente.io`.

- [ ] **RED:** assert exact host-permission equality, exact CSP equality, no optional/wildcard/custom authority, and no CSP source beyond the approved string; tests must fail while production authority remains disabled.
- [ ] **GREEN:** add only `https://api.ente.io/*` and the exact approved CSP after Phase 2 review evidence is complete; add no server setting, externally connectable authority, web-accessible WASM, or additional permission.
- [ ] Build a packaged synthetic server that implements only the pinned method/path/schema table and records every request; fail the run if any request escapes interception or uses another origin/path/method/header/query.
- [ ] Test packaged login+TOTP2FA, initial full sync, unambiguous incremental sync, ambiguity fallback, all three conflict choices, uncertain create/update/delete, restart, unlocked deferral, 15-minute alarm, manual sync, offline, lock, reauth, protocol drift, local-only disconnect, and no mutation before durable intent.
- [ ] Run `pnpm build:security && pnpm exec playwright test tests/browser/project1-ente-sync.spec.ts tests/browser/ente-sodium-csp.spec.ts`; expect all scenarios to pass with synthetic data and zero real external requests.
- [ ] **Review gate:** inspect request logs, packaged manifest, worker graph, and browser console; confirm exact authority, no raw server/secret errors, no content/popup mutation, and controlled CSP failure without `'wasm-unsafe-eval'`.

#### Task 3.3: CSP/network/credential scanner, dependency audit, license/integrity, docs, and final release gate

**Files:**
- Create: `tests/security/ente-network-policy.test.ts`
- Create: `tests/security/ente-credential-canaries.test.ts`
- Modify: `tests/security/build-output.test.ts`
- Modify: `tests/security/executable-policy.test.ts`
- Modify: `scripts/scan-build.mjs`
- Create: `scripts/verify-task12-release.mjs`
- Modify: `package.json`
- Modify: `.prettierignore`
- Modify: `docs/architecture/dependencies.md`
- Modify: `docs/architecture/permissions.md`
- Modify: `docs/architecture/runtime-boundaries.md`
- Modify: `docs/security/invariants.md`
- Modify: `docs/security/threat-model.md`
- Modify: `docs/security/release-checklist.md`
- Modify: `docs/competitor-feature-catalog.md`
- Modify: `.sdd/project1-task12-execution-ledger.md` (append evidence only)

**Interfaces:**
- `verify-task12-release.mjs` exits nonzero unless official runtime/browser, full tests, reproducibility, audit, exact dependency/integrity/license graph, CSP/output inventory, legacy hashes, docs assertions, and all three phase-review dispositions pass.
- Fresh `dist/.shardpass-executable-audit.json` records fixed executable/assets, network sinks, WASM/loader digests/imports/exports, package versions/integrities/licenses, CSP, protocol pin, and scan result without secrets.

- [ ] **RED:** extend AST and fresh-output tests to reject generic fetch, alternate hosts/ports, redirects/cookies, WebSocket/EventSource/beacon/telemetry, non-OTP endpoint/mutation, `LoginItem`/password adapters, raw errors, dynamic code, extra/remote WASM, official Ente source bundle, legacy artifact import, source maps with secrets, transcript generators/fixtures, credential literals, and unexpected executable/assets/network sinks.
- [ ] **RED:** canary password, TOTP2FA, SRP values, token, master/Auth keys, seed, URI, ciphertext, remote ID, email, and server body across storage keys, runtime messages, DOM/accessibility, logs, diagnostics, errors, screenshots, and crash/interruption evidence; permit reusable values only inside authenticated encrypted generation blobs.
- [ ] Run focused security tests and `node scripts/verify-task12-release.mjs`; expect failure until docs, official environment evidence, inventory, review dispositions, and release script are complete.
- [ ] **GREEN:** implement source/output scanner checks, exact license notices and integrity evidence, reproducible fresh build comparison, production `pnpm audit --prod`, and docs that state exact pin/origin/dependencies/CSP, boundaries, uncertainty/CAS limitations, best-effort memory cleanup, no independent libsodium integration audit, local-only disconnect, and upgrade re-review requirements.
- [ ] Verify the preserved 17 legacy artifacts are byte-identical regular non-symlink files, old read-only spec/plan are untouched, and every earlier ledger line/STOP remains byte-for-byte present before appended replacement evidence.
- [ ] On official Node `>=22.14.0 <23` and pnpm 10.14.0, run `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm dependencies && pnpm build:security && pnpm test:browser:built && node scripts/verify-reproducible-build.mjs && pnpm audit --prod`; record exact commands/results. Repeat the required packaged acceptance matrix in Chrome 110 and record its exact version; do not substitute newer Chromium.
- [ ] Run `node scripts/verify-task12-release.mjs`; expect exit 0 only when protocol/dependency pinning, complete sync matrix, authority/output scans, legacy/history preservation, accessibility, reproducibility, audit, official runtime/browser, and all review evidence pass.
- [ ] **Consolidated Phase 3/final gate:** perform one fresh spec-to-code and source-to-package review. Release only with no unresolved load-bearing finding in any phase and all design §24 acceptance criteria satisfied; otherwise append a fixed blocking disposition to the preserved ledger and do not claim Task 12 complete.
