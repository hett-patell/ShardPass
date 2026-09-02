# Project 1 Task 12 Ente Read-Only Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual, read-only Ente Auth connection that authenticates with behavior pinned to official Ente source, downloads a complete `sinceTime=0` OTP snapshot, previews conflicts without writing, and applies one confirmed local encrypted generation.

**Architecture:** A reproducibly built, local official `ente-core-wasm` boundary supplies all Ente SRP and cryptography; strict schemas and a fixed-origin client keep source-derived protocol behavior narrow and fail closed. Background-owned authentication and snapshot state expose only bounded metadata and opaque capabilities to the trusted full-vault page, while the existing generation store performs a single immutable local activation. The production extension gains exactly one host, `https://api.ente.io/*`, only after crypto, CSP, AGPL corresponding-source, and deterministic-vector gates pass.

**Tech Stack:** TypeScript 5.9.3 strict mode, React 19.2.8, Zod Mini 4.4.3, official `ente-io/ente@35658c587072b1919d517fcfacf4b4689af2c6a7` `ente-core-wasm`, Rust/WASM built with `wasm-pack 0.15.0`, Chrome MV3 minimum 110, Vitest 4.1.10, Testing Library 16.3.2, Playwright 1.62.0, pnpm exactly 10.14.0.

## Global Constraints

- The approved design at `docs/superpowers/specs/2026-08-20-project-1-task-12-ente-readonly-snapshot-design.md` is authoritative.
- Implement exactly the three top-level phases below, in order, with one consolidated review per phase. Do not begin a later phase while a load-bearing finding remains open.
- This is a non-Git ShardPass workspace. Do not initialize Git here or run ShardPass branch, worktree, commit, merge, tag, or push steps. The separately supplied official Ente source tree must nevertheless carry independently verifiable provenance for the exact upstream commit.
- Node is `>=22.14.0 <23`, pnpm is exactly `10.14.0`, `wasm-pack` is exactly `0.15.0`, and minimum Chrome is 110. Node 24 and newer Chromium results are development-only evidence.
- The sole protocol pin is `ente-io/ente@35658c587072b1919d517fcfacf4b4689af2c6a7`. Record it in source, synthetic fixtures, diagnostics, executable policy, dependency documentation, and release evidence.
- Use only the official `ente-core-wasm` source from that pin for Ente KDF, SRP, sealed-box, secretbox/box, secretstream, key-envelope, and Auth entity operations. Do not hand-write, substitute, polyfill, or retain a fallback implementation.
- `ente-core-wasm` is AGPL-3.0. Legal approval, license notice, complete corresponding source for the exact shipped object, build scripts, toolchain/pin evidence, and a tested release-delivery process are hard blockers, not documentation follow-ups.
- Stop Task 12 before Phase 2 and make no manifest, CSP, host-permission, production-network, or feature UI change if the exact official source artifact is unavailable, deterministic vectors cannot be generated and independently replayed, AGPL-3.0 corresponding-source obligations cannot be satisfied, or the official WASM cannot execute under the existing extension CSP.
- Keep the Phase 1 CSP unchanged: `script-src 'self'; object-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'`. `wasm-unsafe-eval`, `unsafe-eval`, remote modules, dynamic code, network workers, and remote executable resources are forbidden. A need for any such allowance stops Task 12 for separate design and review.
- Preserve all 17 pinned legacy artifacts as regular non-symlink files with exact hashes. Never edit, regenerate, rename, move, delete, format, import, or package the preserved legacy root artifact.
- Production transport is read/auth-only and fixed to `https://api.ente.io`. No generic URL/fetch API and no Ente create, update, delete, restore, signup, enrollment, password-change, recovery mutation, WebSocket, polling loop, or write queue may exist.
- Every refresh begins with `sinceTime=0` and `limit=2500`. No persisted incremental cursor, startup refresh, alarm refresh, wake refresh, or claim of bidirectional/continuous sync is permitted.
- Accept only strict ShardPass-supported `otpauth://` TOTP, HOTP, and Steam projections. Reject `LoginItem`, password fields, generic records, unknown fields, unsupported versions/types, malformed data, and ambiguous pagination.
- Passwords and short-lived codes remain in the trusted full-vault page or its local official crypto worker boundary. Reusable tokens, keys, plaintext entities, conflicts, mappings, and provenance remain background-owned and unlocked-session-bound.
- Never persist or expose account passwords, email OTTs, TOTP codes, SRP proofs, KEKs, master/private/Auth keys, API tokens, raw responses, decrypted URI strings, seeds duplicated in provenance, or remote write operations. Reference clearing and byte overwriting are best effort; do not claim guaranteed JavaScript zeroization.
- UI responses contain only fixed states/errors, bounded counts, safe issuer/label/type metadata, conflict consequences, and opaque capabilities. They contain no remote IDs, fingerprints, hashes, notes, tags, full items, URI strings, ciphertext, tokens, or keys.
- Tests and screenshots use synthetic data only. They must make no production Ente request and contain no real account, credential, token, seed, URI plaintext, or server response.
- Create `.sdd/project1-task12-execution-ledger.md` only after the first genuine RED result. Keep it append-only and record commands, outcomes, pin/toolchain/license evidence, and review dispositions without secret-bearing values.

## Fixed Contracts and Limits

```ts
export const ENTE_PROTOCOL_PIN = "35658c587072b1919d517fcfacf4b4689af2c6a7" as const;
export const ENTE_API_ORIGIN = "https://api.ente.io" as const;
export const ENTE_SNAPSHOT_LIMITS = Object.freeze({
  pageSize: 2500,
  maxPages: 40,
  maxEntities: 100_000,
  maxResponseBytes: 16 * 1024 * 1024,
  maxSnapshotBytes: 64 * 1024 * 1024,
  maxCiphertextBytes: 1024 * 1024,
  maxHeaderBytes: 4096,
  maxDecryptedEntityBytes: 1024 * 1024,
  maxStringCodePoints: 4096,
  requestTimeoutMs: 30_000,
  snapshotTimeoutMs: 120_000,
  previewTtlMs: 300_000,
  maxPreviewRows: 100_000,
});

export type EnteErrorCode =
  | "ENTE_INVALID"
  | "ENTE_UNAVAILABLE"
  | "ENTE_AUTH_FAILED"
  | "ENTE_SECOND_FACTOR_REQUIRED"
  | "ENTE_PASSKEY_UNAVAILABLE"
  | "ENTE_PROTOCOL_UNSUPPORTED"
  | "ENTE_PROTOCOL_DRIFT"
  | "ENTE_SNAPSHOT_LIMIT"
  | "ENTE_SNAPSHOT_AMBIGUOUS"
  | "ENTE_CONFLICT"
  | "ENTE_PREVIEW_EXPIRED"
  | "ENTE_PERMISSION_DENIED";
```

All response schemas are `.strict()`, all strings/arrays/byte encodings have the constants above or narrower endpoint-specific bounds, and every successful parse returns a field-by-field owned projection. Fixed user-visible errors never include a library error, endpoint body, email, URI, label, ciphertext, token, passkey session value, or server message.

---

### Phase 1: Strict Schemas, Official Reproducible Crypto, Deterministic Vectors, and Release Gates

**Files:**

- Create: `packages/ente-core-wasm/package.json`
- Create: `packages/ente-core-wasm/src/index.ts`
- Create: `packages/ente-core-wasm/src/official-bindings.ts`
- Create during the verified build: `packages/ente-core-wasm/vendor/ente_core_wasm.js`
- Create during the verified build: `packages/ente-core-wasm/vendor/ente_core_wasm_bg.wasm`
- Create during the verified build: `packages/ente-core-wasm/vendor/build-manifest.json`
- Create: `packages/ente-core-wasm/test/official-vectors.test.ts`
- Create from the official deterministic generator: `tests/fixtures/ente/official-vectors.json`
- Create: `apps/extension/src/background/ente/protocol.ts`
- Create: `apps/extension/src/background/ente/schemas.ts`
- Create: `apps/extension/src/background/ente/crypto.ts`
- Create: `apps/extension/src/vault/ente/ente-crypto-worker-protocol.ts`
- Create: `apps/extension/src/vault/ente/ente-crypto-worker.ts`
- Create: `apps/extension/src/vault/ente/ente-crypto-executor.ts`
- Create: `apps/extension/test/background/ente-schemas.test.ts`
- Create: `apps/extension/test/background/ente-crypto.test.ts`
- Create: `apps/extension/test/vault/ente-crypto-worker.test.ts`
- Create: `tests/tooling/ente-official-source.test.ts`
- Create: `tests/security/ente-official-wasm.test.ts`
- Create: `scripts/build-ente-core-wasm.mjs`
- Create: `scripts/generate-ente-vectors.mjs`
- Create: `scripts/verify-ente-vectors.mjs`
- Create: `scripts/prepare-ente-corresponding-source.mjs`
- Create: `scripts/verify-ente-release-source.mjs`
- Modify: `apps/extension/package.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `pnpm-workspace.yaml`
- Modify: `dependency-cruiser.config.cjs`
- Modify: `tools/security/executable-policy.ts`
- Modify: `tests/security/executable-policy.test.ts`
- Modify: `tests/security/csp.test.ts`
- Modify: `tests/security/build-output.test.ts`
- Modify: `tests/tooling/dependencies.test.ts`
- Modify: `docs/architecture/dependencies.md`
- Modify: `docs/security/release-checklist.md`
- Create after RED: `.sdd/project1-task12-execution-ledger.md`

**Interfaces:**

```ts
export type EnteOfficialBuildManifest = Readonly<{
  sourceRepository: "https://github.com/ente-io/ente";
  sourceCommit: "35658c587072b1919d517fcfacf4b4689af2c6a7";
  crateName: "ente-core-wasm";
  wasmPackVersion: "0.15.0";
  license: "AGPL-3.0";
  sourceTreeSha256: string;
  javascriptSha256: string;
  wasmSha256: string;
  vectorSha256: string;
}>;

export interface EnteOfficialCrypto {
  deriveKek(input: EnteKdfInput): Promise<Uint8Array>;
  createSrpSession(input: EnteSrpSessionInput): Promise<EnteSrpSession>;
  deriveMasterKey(input: EnteMasterKeyInput): Promise<Uint8Array>;
  decryptApiToken(input: EnteTokenEnvelope): Promise<Uint8Array>;
  unwrapAuthKey(input: EnteAuthKeyEnvelope): Promise<Uint8Array>;
  decryptAuthEntity(input: EnteEncryptedEntity, authKey: Uint8Array): Promise<Uint8Array>;
  dispose(): void;
}

export type EnteSrpSession = Readonly<{
  clientPublicValue: Uint8Array;
  clientProof: Uint8Array;
  verifyServerProof(proof: Uint8Array): boolean;
  dispose(): void;
}>;

export function createEnteOfficialCrypto(): Promise<EnteOfficialCrypto>;
export function parseEnteProtocolResponse<T>(schema: z.ZodType<T>, value: unknown): T;
```

`official-bindings.ts` is the only TypeScript module allowed to import generated `vendor/ente_core_wasm.js`; it projects explicit official exports into `EnteOfficialCrypto`, owns copied byte buffers, and contains no cryptographic arithmetic. `crypto.ts` wraps that interface with fixed error mapping and cleanup only. The worker protocol accepts bounded challenge/session-bound inputs, returns owned opaque proof/key buffers only to the trusted vault executor, and has no fetch/import URL field.

- [ ] **Step 1: Establish the official-source and license RED gate**

Add tests that require an externally supplied official source tree, locate exactly one Cargo package named `ente-core-wasm`, verify its provenance manifest names `ente-io/ente`, the exact commit, and AGPL-3.0, require `wasm-pack --version` to equal `wasm-pack 0.15.0`, and reject generated artifacts lacking matching source/JS/WASM/vector hashes. Require `verify-ente-release-source.mjs` to reconstruct a clean build from the corresponding-source bundle and compare both shipped output hashes byte-for-byte.

Run: `pnpm exec vitest run tests/tooling/ente-official-source.test.ts tests/security/ente-official-wasm.test.ts`

Expected RED: FAIL because the pinned source manifest, official generated WASM, matching corresponding-source bundle, and verification scripts do not exist.

- [ ] **Step 2: Build only from the pinned official source and prove reproducibility**

Implement `build-ente-core-wasm.mjs` to require `ENTE_SOURCE_DIR`, reject a dirty or unverifiable source identity, find the unique `ente-core-wasm` Cargo package, invoke exactly `wasm-pack 0.15.0 build <crate-directory> --target web --release --out-dir <temporary-directory>`, normalize only non-semantic generated banner/path metadata, run two clean temporary builds, compare bytes, and copy only the official JS/WASM plus `build-manifest.json` after equality. Do not download a package, patch official cryptography, or continue if the exact crate/export set is absent.

Implement `prepare-ente-corresponding-source.mjs` to produce the release-side corresponding-source archive from the exact supplied official tree plus all build scripts/toolchain manifests needed to regenerate the object; implement `verify-ente-release-source.mjs` to unpack it in a temporary directory, rebuild, compare hashes, verify AGPL notice/delivery metadata, and fail if the release artifact and source bundle are separated. Legal approval and an exercised publication/delivery location must be recorded as release evidence; inability to obtain either is `STOP-TASK12`, not a waived check.

Run: `ENTE_SOURCE_DIR=/absolute/path/to/verified/ente-source pnpm run build:ente-official && pnpm run verify:ente-source-release`

Expected GREEN: two official builds are byte-identical; manifest pin/tool/version/license/hashes match; the corresponding-source rebuild matches. If this cannot become GREEN, stop Task 12 and do not perform any later step.

- [ ] **Step 3: Write strict schema and protocol-drift RED tests**

Cover every pinned request/response shape for SRP attributes, OTT request/verification, SRP session/verification, TOTP verification, official passkey handoff/poll state, API token/key attributes, `GET /authenticator/key`, and entity diff fields `id`, `encryptedData`, `header`, `isDeleted`, `updatedAt`. Cover unknown fields at every nesting level, unsafe integers, negative timestamps, invalid base64/hex/UTF-8, oversized body/header/ciphertext/array/string, unsupported envelope/entity versions and types, malformed tombstones, and a compile-time `@ts-expect-error` proving a `LoginItem` cannot satisfy the OTP adapter input.

Run: `pnpm exec vitest run apps/extension/test/background/ente-schemas.test.ts && pnpm typecheck`

Expected RED: FAIL because `protocol.ts`, strict schemas, limits, and OTP-only types do not exist.

- [ ] **Step 4: Implement minimal strict schemas and fixed protocol constants**

Define the fixed contracts and limits verbatim, endpoint-specific strict Zod schemas, bounded canonical encoding decoders, and field-by-field projections. Export no generic remote-record schema and no schema containing a password item projection. Map unsupported pinned versions to `ENTE_PROTOCOL_UNSUPPORTED`, shape changes to `ENTE_PROTOCOL_DRIFT`, and bound violations to `ENTE_SNAPSHOT_LIMIT` without reflecting candidate data.

Run: `pnpm exec vitest run apps/extension/test/background/ente-schemas.test.ts && pnpm typecheck`

Expected GREEN: schema suites pass, the `LoginItem` negative compile test is honored, and all malformed/unknown input fails closed.

- [ ] **Step 5: Generate all deterministic official compatibility vectors**

Create a Rust-side deterministic synthetic vector generator in the temporary pinned Ente source build workspace, linked directly to the official crates used by `ente-core-wasm`. It must use a fixed all-synthetic byte stream and fixed timestamps to emit one canonical JSON fixture covering: password plus KDF parameters to exact KEK; complete SRP client/server transcript including proof verification; key attributes plus password to master key; encrypted token plus keypair to API token; Auth account-key wrapping; Auth entity plaintext/key/header/ciphertext; tombstones; multiple pages; and an equal-`updatedAt` full-page boundary. `generate-ente-vectors.mjs` accepts output only from that pinned generator, canonicalizes JSON, records the pin/tool/output hash, and scans names/values against the fixture secret policy.

Run: `ENTE_SOURCE_DIR=/absolute/path/to/verified/ente-source pnpm run generate:ente-vectors && pnpm run verify:ente-vectors`

Expected GREEN: regeneration is byte-identical and an independent official-source replay verifies every expected byte. If exact deterministic generation or independent replay fails, stop Task 12.

- [ ] **Step 6: Write official adapter and CSP RED tests**

Replay every fixture through the packaged worker and `EnteOfficialCrypto`; compare exact bytes and complete SRP proof behavior; assert disposal invalidates sessions and clears owned buffers best effort. Scan source and output for handwritten SRP/Argon2/sealed-box/secretbox/secretstream/framing implementations, alternate crypto imports, dynamic import expressions, `eval`, `Function`, remote modules/workers, and network-loaded WASM. Load the packaged worker under the current extension CSP and assert no `wasm-unsafe-eval` or other CSP addition is present.

Run: `pnpm exec vitest run packages/ente-core-wasm/test/official-vectors.test.ts apps/extension/test/background/ente-crypto.test.ts apps/extension/test/vault/ente-crypto-worker.test.ts tests/security/ente-official-wasm.test.ts tests/security/csp.test.ts`

Expected RED: FAIL because official bindings, worker lifecycle, executable policy, and packaged CSP evidence are incomplete.

- [ ] **Step 7: Implement the official-only adapter and harden executable policy**

Implement direct, static official bindings and worker request/response projection without cryptographic logic. Extend dependency-cruiser and executable policy so only `official-bindings.ts` reaches the generated module, content/popup code cannot reach Ente crypto, the generated WASM/JS hashes must match the build manifest, and source/output scans reject alternate Ente crypto paths and dynamic/remote execution. Keep `apps/extension/src/manifest.ts` and all network permissions unchanged in this phase.

Run: `pnpm exec vitest run packages/ente-core-wasm/test/official-vectors.test.ts apps/extension/test/background/ente-crypto.test.ts apps/extension/test/vault/ente-crypto-worker.test.ts tests/security/ente-official-wasm.test.ts tests/security/csp.test.ts tests/security/executable-policy.test.ts tests/security/build-output.test.ts && pnpm dependencies && pnpm build:security`

Expected GREEN: official vectors match exactly, worker tests pass, packaged WASM runs under the existing CSP, and scans find no fallback, dynamic code, remote executable source, or manifest/CSP change.

- [ ] **Step 8: Complete the Phase 1 consolidated review and stop/go gate**

Run: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm exec vitest run packages/ente-core-wasm apps/extension/test/background/ente-schemas.test.ts apps/extension/test/background/ente-crypto.test.ts apps/extension/test/vault/ente-crypto-worker.test.ts tests/tooling/ente-official-source.test.ts tests/security && pnpm dependencies && pnpm build:security && pnpm run verify:ente-vectors && pnpm run verify:ente-source-release`

Review the complete Phase 1 diff once for exact source provenance, official-only crypto, vector completeness, schema strictness, type boundaries, current-CSP execution, executable output, AGPL-3.0 legal approval, and tested corresponding-source delivery. Record every finding and disposition in `.sdd/project1-task12-execution-ledger.md`. Phase 1 is GREEN only with no unresolved load-bearing finding and all four hard gates satisfied; otherwise record `STOP-TASK12`, leave manifest/network/UI unchanged, and do not begin Phase 2.

---

### Phase 2: Trusted Authentication, Fixed Read-Only Snapshot, Preview, Atomic Apply, and Disconnect

**Files:**

- Create: `apps/extension/src/background/ente/client.ts`
- Create: `apps/extension/src/background/ente/auth.ts`
- Create: `apps/extension/src/background/ente/snapshot.ts`
- Create: `apps/extension/src/background/ente/otp-adapter.ts`
- Create: `apps/extension/src/background/ente/preview-store.ts`
- Create: `apps/extension/src/background/ente/provenance.ts`
- Create: `apps/extension/src/background/ente/ente-service.ts`
- Create: `packages/messaging/src/ente.ts`
- Create: `packages/messaging/test/ente.test.ts`
- Create: `apps/extension/test/background/ente-client.test.ts`
- Create: `apps/extension/test/background/ente-auth.test.ts`
- Create: `apps/extension/test/background/ente-snapshot.test.ts`
- Create: `apps/extension/test/background/ente-preview-store.test.ts`
- Create: `apps/extension/test/background/ente-service.test.ts`
- Create: `apps/extension/test/background/ente-atomic-apply.integration.test.ts`
- Create: `tests/fixtures/ente/mock-server.ts`
- Modify: `packages/messaging/src/index.ts`
- Modify: `packages/security/src/safe-error.ts`
- Modify: `apps/extension/src/background/router.ts`
- Modify: `apps/extension/src/background/main.ts`
- Modify: `apps/extension/src/background/vault/session-service.ts`
- Modify: `apps/extension/src/background/vault/session-vault-repository.ts`
- Modify: `apps/extension/test/background/router.test.ts`
- Modify: `apps/extension/test/background/background-runtime.integration.test.ts`
- Modify: `packages/storage/src/vault-format.ts`
- Modify: `packages/storage/src/serialization.ts`
- Modify: `packages/storage/src/index.ts`
- Modify: `packages/storage/test/generation-store.test.ts`

**Interfaces:**

```ts
export type EnteConnectionProof =
  | Readonly<{ kind: "email-code"; emailHandle: string; codeProof: Uint8Array }>
  | Readonly<{ kind: "srp"; emailHandle: string; srpProof: Uint8Array }>
  | Readonly<{ kind: "passkey-poll"; handoffCapability: string }>;
export type EnteSecondFactorProof = Readonly<{
  kind: "totp" | "official-passkey";
  proof: Uint8Array;
}>;

export type EnteConnectionStateName =
  | "disconnected"
  | "requesting-email-code"
  | "awaiting-email-code"
  | "deriving-srp"
  | "awaiting-totp"
  | "awaiting-official-passkey"
  | "authenticating"
  | "connected"
  | "loading-snapshot"
  | "preview-ready"
  | "conflict"
  | "applying"
  | "applied"
  | "error";

export type EnteConnectionState = Readonly<{
  state: EnteConnectionStateName;
  error?: EnteErrorCode;
  passkeyUrl?: string;
}>;

export type EnteSnapshotPreviewRow = Readonly<{
  classification:
    | "new"
    | "unchanged-mapped"
    | "replace-mapped"
    | "remote-deleted"
    | "local-conflict"
    | "rejected";
  issuer: string;
  label: string;
  otpType: "totp" | "hotp" | "steam";
  consequence: "create" | "retain" | "replace" | "delete-local" | "require-confirmation" | "ignore";
}>;
export type EnteSnapshotPreview = Readonly<{
  previewToken: string;
  expiresAt: number;
  counts: Readonly<Record<EnteSnapshotPreviewRow["classification"], number>>;
  rows: readonly EnteSnapshotPreviewRow[];
  requiresConflictConfirmation: boolean;
}>;
export type EnteSnapshotApplyResult = Readonly<{
  status: "applied";
  created: number;
  replaced: number;
  deleted: number;
  retained: number;
}>;

export interface OtpSnapshotAdapter {
  connect(input: EnteConnectionProof): Promise<EnteConnectionState>;
  completeSecondFactor(input: EnteSecondFactorProof): Promise<EnteConnectionState>;
  previewSnapshot(): Promise<EnteSnapshotPreview>;
  applySnapshot(previewToken: string): Promise<EnteSnapshotApplyResult>;
  disconnect(): Promise<void>;
}

export interface EnteReadOnlyClient {
  getSrpAttributes(email: string, signal: AbortSignal): Promise<EnteSrpAttributes>;
  requestEmailCode(email: string, signal: AbortSignal): Promise<void>;
  verifyEmailCode(input: EnteEmailCodeRequest, signal: AbortSignal): Promise<EnteAuthResult>;
  verifySrp(input: EnteSrpVerifyRequest, signal: AbortSignal): Promise<EnteAuthResult>;
  verifyTotp(input: EnteTotpVerifyRequest, signal: AbortSignal): Promise<EnteAuthResult>;
  beginPasskey(input: EntePasskeyBeginRequest, signal: AbortSignal): Promise<EntePasskeyHandoff>;
  pollPasskey(input: EntePasskeyPollRequest, signal: AbortSignal): Promise<EnteAuthResult>;
  getAuthenticatorKey(token: Uint8Array, signal: AbortSignal): Promise<EnteAuthKeyEnvelope>;
  getAuthenticatorDiff(
    token: Uint8Array,
    sinceTime: number,
    signal: AbortSignal,
  ): Promise<EnteEntityPage>;
}
```

The client has no public request, URL, method, headers, or fetch member. Its only entity call always sends `limit=2500`; snapshot orchestration supplies `sinceTime=0` first and advances only to a proven unambiguous timestamp boundary. Production construction hard-codes the HTTPS origin; tests inject a fetch-like port directly without widening extension authority.

Version-1 vault-only messages are exactly: `ente.getState`, `ente.requestEmailCode`, `ente.connect`, `ente.completeSecondFactor`, `ente.previewSnapshot`, `ente.applySnapshot`, `ente.disconnect`. Pair each request kind with one strict response kind. Passwords, raw codes, reusable credentials, raw remote values, and generic URLs are not message fields; the trusted local crypto executor supplies challenge/document/session-bound opaque proof buffers.

- [ ] **Step 1: Write fixed transport and trusted-auth RED suites**

Use `tests/fixtures/ente/mock-server.ts` as an in-process deterministic fetch port, not a production extension network server. Cover exact methods/paths/queries/headers, `X-Auth-Token`, `credentials: "omit"`, `redirect: "error"`, timeout/abort/body bounds, safe errors, OTT, SRP, TOTP, official passkey handoff and bounded polling, token recovery, key attributes, Auth-key retrieval, cancellation, lock, restart, and disposal. Assert there is no mutation endpoint or generic fetch escape, no cookies/redirects, and passkey becomes `ENTE_PASSKEY_UNAVAILABLE` if its exact official returned accounts URL cannot be safely validated without added authority.

Run: `pnpm exec vitest run apps/extension/test/background/ente-client.test.ts apps/extension/test/background/ente-auth.test.ts`

Expected RED: FAIL because the fixed client and auth state machine do not exist.

- [ ] **Step 2: Implement the fixed client and session-bound auth state machine**

Implement only the pinned calls: `GET /users/srp/attributes?email=...`, `POST /users/ott`, `POST /users/verify-email`, pinned SRP create/verify path, `POST /users/two-factor/verify`, official accounts passkey handoff/poll behavior, `GET /authenticator/key`, and `GET /authenticator/entity/diff?sinceTime=<n>&limit=2500`. Apply strict schemas before projection, hard timeout/abort, fixed headers, no redirects/cookies, and fixed error mapping. Keep API token, master/private/Auth keys, capabilities, and owned abort controllers in background memory; synchronously invalidate authority on lock, disconnect, restart, cancellation, replacement, or disposal and overwrite owned byte arrays best effort.

Run: `pnpm exec vitest run apps/extension/test/background/ente-client.test.ts apps/extension/test/background/ente-auth.test.ts`

Expected GREEN: all auth branches and lifecycle failures are deterministic, bounded, and read/auth-only.

- [ ] **Step 3: Write complete snapshot RED tests**

Cover `sinceTime=0`, fixed `limit=2500`, multi-page reconstruction, tombstones, out-of-order rows, greatest-`updatedAt` deduplication, acceptance of exact byte-identical duplicate IDs only, strict UTF-8, strict `otpauth://` parsing, TOTP/HOTP/Steam acceptance, login/password/non-OTP rejection, malformed/oversized entities, page/entity/body/time budgets, cancellation, timeout, lock/restart, and early owned-buffer cleanup. Build a full 2500-row equal-timestamp terminal boundary and require `ENTE_SNAPSHOT_AMBIGUOUS` with no partial preview or local write.

Run: `pnpm exec vitest run apps/extension/test/background/ente-snapshot.test.ts`

Expected RED: FAIL because complete snapshot reconstruction and ambiguity detection do not exist.

- [ ] **Step 4: Implement fail-closed full snapshot reconstruction**

Start every run at zero, retain only owned bounded projections, apply tombstones by remote entity ID, decrypt live entities through `EnteOfficialCrypto`, decode strict UTF-8, parse only strict ShardPass OTP URIs, and clear raw buffers/references after projection. Deduplicate by greatest timestamp; at equal timestamps accept only byte-identical duplicates. Advance pagination only when the complete boundary proves no unseen equal-timestamp row can be skipped; otherwise throw `ENTE_SNAPSHOT_AMBIGUOUS`. Return a complete in-memory live set or no result.

Run: `pnpm exec vitest run apps/extension/test/background/ente-snapshot.test.ts`

Expected GREEN: valid complete snapshots reconstruct exactly and every ambiguity/limit/malformed case fails before preview.

- [ ] **Step 5: Write preview, conflict, capability, and apply RED suites**

Cover all six classifications, preservation of unrelated local OTPs, unchanged mapped tombstone deletion, locally edited/deleted mapped conflicts, explicit conflict consequences, metadata-only response projection, and zero preview writes/ID allocation/journal/settings/generation activity. Cover random one-use five-minute preview tokens bound to exact vault document, sender/session authority, authenticated root, pin, and snapshot identity; invalidate on expiry, lock, restart, navigation/document replacement, disconnect, replacement preview, apply, and disposal. Mutate local state after preview and require a replacement preview/reconfirmation. Cover exactly one staged/verified/authenticated/activated generation, journal entries only for actual changes, bounded encrypted `ente-otp-state`, interruption before activation, ambiguous activation reconciliation, retry idempotence, and no duplicate items/journal entries.

Run: `pnpm exec vitest run apps/extension/test/background/ente-preview-store.test.ts apps/extension/test/background/ente-service.test.ts apps/extension/test/background/ente-atomic-apply.integration.test.ts packages/storage/test/generation-store.test.ts`

Expected RED: FAIL because preview capability storage, provenance, conflict reclassification, and atomic Ente apply APIs do not exist.

- [ ] **Step 6: Implement write-free preview and one-generation local apply**

Add a dedicated session-service operation that reloads the authenticated active root, decrypts current OTP records and bounded `ente-otp-state`, reclassifies against the held complete snapshot, and either returns a replacement preview or stages exactly one generation containing retained unrelated records/metadata, accepted/replaced OTPs, actual local journal changes, and minimal encrypted provenance. Provenance stores only pin, remote-to-local mapping, applied remote update marker, and local revision/content binding needed for conflict detection; it stores no email, credential/key/token, URI, seed duplicate, raw response, cursor, or pending operation. Verify the staged generation before activation, use existing authenticated-root reconciliation, and make retry idempotent.

Run: `pnpm exec vitest run apps/extension/test/background/ente-preview-store.test.ts apps/extension/test/background/ente-service.test.ts apps/extension/test/background/ente-atomic-apply.integration.test.ts packages/storage/test/generation-store.test.ts`

Expected GREEN: preview is observably write-free, changed previews require reconfirmation, and each successful apply activates exactly one generation.

- [ ] **Step 7: Write messaging, routing, disconnect, and legacy-state RED suites**

Cover strict version-1 exact-document vault-only request/response pairing, sender authorization, sensitive-field rejection, safe fixed errors, stale async suppression, and no popup/content Ente authority. Cover disconnect invalidating memory/capabilities, making zero Ente requests, retaining imported local OTPs, removing only connection/provenance metadata through one local generation when present, and remaining idempotent when absent. Assert migrated Ente credentials/pending operations are never activated; only safe legacy counts are shown until explicit local disconnect/reset removes them.

Run: `pnpm exec vitest run packages/messaging/test/ente.test.ts apps/extension/test/background/router.test.ts apps/extension/test/background/background-runtime.integration.test.ts apps/extension/test/background/ente-service.test.ts`

Expected RED: FAIL because Ente message contracts, routing, runtime disposal, and disconnect integration are absent.

- [ ] **Step 8: Wire the adapter, router, lifecycle, and local-only disconnect**

Export strict message schemas; add Ente safe-error codes; authorize only the full-vault exact document; instantiate one `EnteService` per background runtime; bind it to vault epoch/root/document identity; cancel and dispose it synchronously on lock and runtime teardown. Implement disconnect with no client call, retain all OTP items, and activate one local generation only when encrypted Ente metadata must be removed. Keep legacy write queues unreachable and omit every mutation destination from types and construction.

Run: `pnpm exec vitest run packages/messaging/test/ente.test.ts apps/extension/test/background/ente-client.test.ts apps/extension/test/background/ente-auth.test.ts apps/extension/test/background/ente-snapshot.test.ts apps/extension/test/background/ente-preview-store.test.ts apps/extension/test/background/ente-service.test.ts apps/extension/test/background/ente-atomic-apply.integration.test.ts apps/extension/test/background/router.test.ts apps/extension/test/background/background-runtime.integration.test.ts && pnpm typecheck && pnpm dependencies`

Expected GREEN: all read/auth/apply/disconnect service tests pass and static dependencies expose no mutation or content/popup authority.

- [ ] **Step 9: Complete the Phase 2 consolidated review**

Run: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm exec vitest run packages/messaging packages/storage apps/extension/test/background --maxWorkers=1 --no-file-parallelism && pnpm dependencies && pnpm build:security`

Review the complete Phase 2 diff once for official auth fidelity, fixed transport surface, in-memory credential ownership, exact lifecycle invalidation, complete snapshot correctness, pagination ambiguity, OTP-only typing, write-free preview, explicit conflict consequences, capability binding, one-generation activation, idempotence, disconnect semantics, legacy-state quarantine, and secret-free failures. Record findings and dispositions. Do not begin Phase 3 with any unresolved load-bearing finding.

---

### Phase 3: Trusted UI, Exact Production Authority, Packaged Mock-Server Evidence, Documentation, and Final Verification

**Files:**

- Create: `apps/extension/src/vault/ente/EnteSettings.tsx`
- Create: `apps/extension/src/vault/ente/EnteSettings.module.css`
- Create: `apps/extension/src/vault/ente/useEnteSnapshot.ts`
- Create: `apps/extension/test/vault/EnteSettings.dom.test.tsx`
- Create: `apps/extension/test/vault/ente-crypto-executor.test.ts`
- Create: `tests/browser/project1-ente-snapshot.spec.ts`
- Create: `tests/browser/ente-mock-server.ts`
- Create: `tests/security/ente-network-policy.test.ts`
- Create: `scripts/verify-task12-release.mjs`
- Modify: `apps/extension/src/vault/VaultApp.tsx`
- Modify: `apps/extension/src/vault/VaultApp.module.css`
- Modify: `apps/extension/test/vault/VaultApp.dom.test.tsx`
- Modify: `apps/extension/src/platform/extension-platform.ts`
- Modify: `apps/extension/src/platform/chrome-platform.ts`
- Modify: `apps/extension/test/platform/chrome-platform.test.ts`
- Modify: `apps/extension/src/manifest.ts`
- Modify: `tests/security/manifest.test.ts`
- Modify: `tests/security/csp.test.ts`
- Modify: `tests/security/build-output.test.ts`
- Modify: `scripts/scan-build.mjs`
- Modify: `playwright.config.ts`
- Modify: `package.json`
- Modify: `.prettierignore`
- Modify: `docs/architecture/dependencies.md`
- Modify: `docs/architecture/permissions.md`
- Modify: `docs/architecture/runtime-boundaries.md`
- Modify: `docs/security/invariants.md`
- Modify: `docs/security/threat-model.md`
- Modify: `docs/security/release-checklist.md`
- Modify: `docs/competitor-feature-catalog.md`

**Interfaces:**

```ts
export interface EnteUiExtensionPlatform {
  sendEnteRequest(request: EnteRequest): Promise<EnteResponse | BackgroundErrorResponse>;
  createEnteCryptoExecutor(): EnteCryptoExecutor;
  openOfficialPasskeyPage(url: string): Promise<void>;
}

export interface EnteCryptoExecutor {
  createEmailCodeProof(email: string, code: string): Promise<EnteConnectionProof>;
  createSrpProof(email: string, password: string): Promise<EnteConnectionProof>;
  createTotpProof(code: string): Promise<EnteSecondFactorProof>;
  dispose(): void;
}

export type UseEnteSnapshot = Readonly<{
  state: EnteConnectionState;
  preview: EnteSnapshotPreview | null;
  requestEmailCode(email: string): Promise<void>;
  connectWithEmailCode(email: string, code: string): Promise<void>;
  connectWithPassword(email: string, password: string): Promise<void>;
  completeTotp(code: string): Promise<void>;
  continueOfficialPasskey(): Promise<void>;
  refresh(): Promise<void>;
  apply(previewToken: string, confirmConflicts: boolean): Promise<void>;
  disconnect(): Promise<void>;
  cancel(): void;
}>;
```

The final manifest additions are exactly:

```ts
host_permissions: ["https://api.ente.io/*"],
content_security_policy: {
  extension_pages:
    "script-src 'self'; object-src 'self'; connect-src 'self' https://api.ente.io; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'",
},
```

No optional host, custom server, arbitrary URL, HTTP origin, accounts host fetch authority, WebSocket, telemetry, analytics, or remote executable source is added. The passkey page is opened as a user-visible external trust transition only after exact URL validation; it is not placed in `host_permissions` or `connect-src` unless a future separately approved design requires it.

- [ ] **Step 1: Write trusted UI and sensitive-lifecycle RED suites**

Cover all fixed states; email-code, password/SRP, TOTP, and safe official-passkey transitions; manual refresh; metadata-only preview rows/counts; explicit conflict consequence confirmation; changed-preview reconfirmation; apply; and local disconnect. Assert the copy says “read-only manual snapshot,” “never uploads or deletes Ente data,” “complete snapshot,” the exact pinned commit, and that protocol drift/pagination ambiguity stops before mutation. Assert password/code controls clear on submit, state transition, lock, cancel, error, replacement, and unmount; stale jobs cannot update replacement documents; secrets never enter rendered/accessibility/error text; and focus, labels, live status, keyboard operation, reduced motion, 320 CSS-pixel layout, and 200% zoom remain usable.

Run: `pnpm exec vitest run apps/extension/test/vault/EnteSettings.dom.test.tsx apps/extension/test/vault/ente-crypto-executor.test.ts apps/extension/test/vault/VaultApp.dom.test.tsx`

Expected RED: FAIL because the trusted settings UI, hook, executor lifecycle, and platform bridge are absent.

- [ ] **Step 2: Implement the trusted settings UI and local proof boundary**

Build controlled sensitive inputs whose submitted values are immediately handed to `EnteCryptoExecutor` and cleared; retain only fixed UI state and safe projections. Add abort/job ownership so replacement, cancel, lock, error, and unmount dispose the executor and suppress stale completion. Require a separate explicit checkbox/button confirmation describing replace/delete consequences before applying conflicts. Render no remote IDs/fingerprints/hashes/tags/notes/full items. Integrate only in the unlocked full-vault controls and refresh the OTP view after successful apply/disconnect effects.

Run: `pnpm exec vitest run apps/extension/test/vault/EnteSettings.dom.test.tsx apps/extension/test/vault/ente-crypto-executor.test.ts apps/extension/test/vault/VaultApp.dom.test.tsx apps/extension/test/platform/chrome-platform.test.ts`

Expected GREEN: trusted transitions, redaction, stale-job suppression, accessibility, and compact layout tests pass.

- [ ] **Step 3: Add exact production authority with RED-to-GREEN policy tests**

First update security tests to require exactly `https://api.ente.io/*` in `host_permissions`, exactly `https://api.ente.io` added to extension-page `connect-src`, and no other network authority. Assert output equality, reject `<all_urls>` as background fetch authority, HTTP/custom/optional hosts, wildcard connect sources, redirect destinations, mutation paths/methods, WebSockets, remote workers/modules, analytics, and telemetry.

Run before manifest change: `pnpm exec vitest run tests/security/manifest.test.ts tests/security/csp.test.ts tests/security/ente-network-policy.test.ts`

Expected RED: FAIL because exact Ente authority is not yet present.

Then apply only the manifest/CSP snippet in this phase and update executable/build policy to bind every Ente fetch to the fixed client allowlist.

Run after manifest change: `pnpm exec vitest run tests/security/manifest.test.ts tests/security/csp.test.ts tests/security/ente-network-policy.test.ts tests/security/build-output.test.ts && pnpm build:security`

Expected GREEN: source and packaged manifest have one exact Ente host permission/connect source, unchanged script policy, and no mutation or arbitrary network sink.

- [ ] **Step 4: Write and run packaged mock-server browser/security evidence**

The Playwright fixture starts a loopback HTTPS mock and routes only browser test traffic for `https://api.ente.io` to it; production code and manifest remain fixed to the production origin. Cover OTT, SRP, TOTP, safe passkey unavailable/handoff state, token/key recovery, multi-page/tombstone snapshot, metadata-only preview, conflict confirmation, changed preview, one apply, retry without duplication, disconnect with zero remote mutation, timeout/abort, lock, service-worker restart, ambiguous pagination, malformed entity, protocol drift, compact viewport, keyboard/focus, accessibility, and secret-free screenshots/console/network logs. Reject any method/path outside the pinned allowlist at the mock boundary and assert no real external request escapes routing.

Run: `pnpm build:security && pnpm exec playwright test tests/browser/project1-ente-snapshot.spec.ts --project=chromium`

Expected GREEN: packaged extension scenarios pass against synthetic routed responses, no mutation request occurs, and no sensitive value appears in browser evidence.

- [ ] **Step 5: Harden build scans and update architecture/security documentation**

Extend `scan-build.mjs` and output tests to reject synthetic/production credential literals, fixture secrets, URI seeds, raw endpoint responses, dynamic code, remote modules/workers, unexpected network sinks, Ente mutation strings, legacy-bundle imports, mismatched WASM/vector/source hashes, missing AGPL notice/source-delivery metadata, and any change to the exact 17 legacy artifacts. Update the listed existing documents with the read-only/manual limitation, source-derived unstable protocol pin, complete-snapshot/ambiguity behavior, official-only crypto, best-effort clearing claim, external passkey trust transition, exact authority, encrypted provenance, conflict semantics, no remote mutation, AGPL-3.0 obligations, corresponding-source delivery/rebuild commands, and future-write requirement for a separate design/review/approval.

Run: `pnpm build:security && pnpm exec vitest run tests/security tests/legacy --maxWorkers=1 --no-file-parallelism && node scripts/scan-build.mjs && pnpm run verify:ente-source-release`

Expected GREEN: output and documentation checks pass, all legacy hashes remain exact, and release source evidence reconstructs the shipped official object.

- [ ] **Step 6: Add exact Task 12 verification scripts and run RED-to-GREEN**

Add `test:project1:task12`, `format:check:project1:task12`, `verify:project1:task12:evidence`, `verify:project1:task12`, and `verify:project1:task12:local-node24`. The evidence command must run typecheck, lint, Task 12 format check, dependency boundaries, official vector/source/WASM gates, serial full Vitest, startup diagnostics, packaged browser tests, security/legacy tests, build scan, exact 17-artifact verification, reproducible build verification, corresponding-source rebuild comparison, and `pnpm audit --prod`. The official command must enforce Node 22; the Node 24 command must label itself local development evidence and cannot satisfy release.

Run before scripts exist: `pnpm run verify:project1:task12`

Expected RED: FAIL with missing script.

Run after scripts are added under official Node 22: `pnpm run verify:project1:task12`

Expected GREEN: every required unit, integration, packaged-browser, security, reproducibility, license/source, and production-audit gate passes.

- [ ] **Step 7: Complete the Phase 3 consolidated review and final release decision**

Run: `pnpm run verify:project1:task12 && pnpm exec playwright test tests/browser/project1-ente-snapshot.spec.ts --project=chrome-110 && pnpm run verify:ente-source-release`

Review the complete Task 12 diff once against every approved-spec goal, non-goal, endpoint, state, error, data boundary, snapshot rule, conflict rule, lifecycle invalidation, disconnect rule, network/CSP rule, official-crypto rule, AGPL corresponding-source obligation, and residual-risk claim. Confirm actual official Node 22 and actual Chrome/Chromium 110 evidence rather than inferred compatibility; confirm no unresolved Phase 1/2/3 review finding; inspect the execution ledger for secret-free command evidence and dispositions. Any missing official-source artifact, deterministic vector replay, legal/corresponding-source delivery, existing-CSP WASM proof, exact-browser/runtime evidence, legacy hash, reproducibility result, production audit, or load-bearing review resolution blocks release and must not be waived.
