# Project 1 Task 9 Execution Ledger

## Evidence boundary and provenance

Date: 2026-08-11
Scope: Task 1 only — bounded import model and safe preview projection. Task 2 format parsers were not started.

Provenance labels used in this ledger:

- **Direct command evidence** — command executed in this Task 9 session; exit status and summarized output are recorded from that invocation.
- **Expected RED interpretation** — explanation of why a failing test is the intended pre-implementation result, based on the Task 1 plan and observed output.
- **Static self-review** — source-level inspection performed in this Task 9 session; it is not a substitute for command evidence.
- **Environment caveat** — a limitation of the execution environment that prevents evidence from being described as official.
- **Unverified** — planned or asserted behavior without fresh command or source evidence; it must not be described as passing.

This ledger is Task 9-only and was created immediately after the genuine Task 1 RED command. It does not amend or rely on prior task ledgers.

## Task 1 — Bounded import model and safe preview

Status: In progress.

### Pre-edit context review

**Static self-review:** Read the Task 9 authority/scope, global constraints, exact shared API/type contract, and complete Task 1 section. Reviewed current importer package exports and legacy-v1 schemas/tests, domain canonical Base32 and Unicode scalar validation, OTP item/tag/text/counter bounds, messaging strict-schema patterns, fixed safe-error patterns, TypeScript/Vitest/ESLint/Prettier configuration, and prior ledger provenance conventions before production edits.

### RED evidence

**Direct command evidence:** `pnpm exec vitest run packages/importers/test/import-model.test.ts`

Observed exit code: 1 at 2026-08-11T16:36:40+05:30. Vitest 4.1.10 reported 1 failed file and 10 failed tests. The fixed limits export was `undefined`; `safeImportMetadata`, `hasSameOtpSemanticKey`, `classifyImportCandidates`, and `redactImportBuffer` were not functions. No production model file or model exports existed.

**Expected RED interpretation:** This is the intended pre-implementation failure. The new tests loaded successfully and failed specifically because the Task 1 API and behavior had not been implemented, rather than because of a test syntax, resolution, or environment error.

**Direct command evidence:** `node --version && pnpm --version`

Observed exit code: 0. Node was `v24.18.0`; pnpm was the pinned `10.14.0`.

**Environment caveat:** The project requires Node `>=22.14.0 <23`. Node 24 evidence is development-only and cannot clear the official Node 22 gate.

### GREEN and regression evidence

**Direct command evidence:** `pnpm exec vitest run packages/importers/test/import-model.test.ts packages/importers/test/legacy-v1.test.ts`

Observed exit code: 0. Vitest reported 2 passed files and 20 passed tests: 10/10 bounded import-model tests and 10/10 existing legacy-v1 importer regressions.

**Direct command evidence:** Parallel first static checks ran `pnpm typecheck`, `pnpm lint`, and `pnpm exec prettier --check packages/importers/src/import-model.ts packages/importers/src/index.ts packages/importers/test/import-model.test.ts .sdd/project1-task9-execution-ledger.md`.

Observed results: lint exited 0. Typecheck exited 1 with one `exactOptionalPropertyTypes` diagnostic in the new candidate-copy helper because the first implementation could retain an explicit `counter: undefined`. The focused Prettier check exited 1 for the new model source and test. These were implementation findings, not passing evidence.

**Static self-review:** Corrected the candidate copy to omit `counter` when absent, preserving the exact optional-property contract. Ran Prettier only on the four Task 1 files; it changed the new model source and test and left the barrel and ledger unchanged.

**Direct command evidence:** `pnpm exec vitest run packages/importers/test/import-model.test.ts packages/importers/test/legacy-v1.test.ts && pnpm typecheck && pnpm lint && pnpm exec prettier --check packages/importers/src/import-model.ts packages/importers/src/index.ts packages/importers/test/import-model.test.ts .sdd/project1-task9-execution-ledger.md`

Observed exit code: 0. Vitest reported 2/2 files and 20/20 tests passed. TypeScript completed with no diagnostics. ESLint completed with no diagnostics or warnings. All four Task 1 files passed the focused Prettier check. Node 24 engine warnings remain subject to the environment caveat above.

### Changed files and review outcome

Changed in Task 1:

- `packages/importers/src/import-model.ts` (created)
- `packages/importers/test/import-model.test.ts` (created)
- `packages/importers/src/index.ts`
- `.sdd/project1-task9-execution-ledger.md` (created after genuine RED)

**Direct command evidence:** A no-output `rg` inspection found no parser API names, OTP URI schemes, browser/DOM authority, network sinks, logs, digest/fingerprint construction, cryptography, or production JSON serialization in the Task 1 model/source/test surface. A source listing showed only the new `import-model.ts`, existing barrel, and preserved `legacy-v1` importer files; no Task 2 parser file exists.

**Static self-review:** The public types exactly retain the plan names/shapes. Candidate validation is strict and bounded by current domain rules, including canonical unpadded Base32, scalar/trimmed issuer and label, bounded note/tags, safe HOTP counters including zero, and explicit Steam semantics. Candidate, metadata, row, row-array, and nested tag outputs are fresh and frozen. Preview rows enumerate only `rowId`, `ordinal`, `status`, `reason`, and safe metadata; recursive property-name and JSON tests reject sensitive projection fields. Duplicate equality directly compares only explicit semantic fields and NFKC-normalized issuer/label, builds no serialized equality material, and exposes no key/hash/fingerprint. Classification supports existing-vault and first-wins within-batch comparisons without mutating inputs. Fixed reason enums separate accepted, vault duplicate, batch duplicate, malformed, unsupported, and limit outcomes; classification emits no arbitrary parser/library errors. Input count is rejected before candidate/ID iteration beyond 1,000, IDs are externally generated opaque values validated for count, uniqueness, and non-index form, and ordinal remains stable one-based batch order. The redaction helper synchronously overwrites every byte.

No Critical or Important Task 1 review finding remains after the exact-optional-property correction. Task 2 format parsers, messaging, timestamps/count response schemas, JSON/image decoding, and downstream import service behavior were not implemented.

Status: Task 1 implementation and its focused development gate are complete under Node 24 only; official Node 22 evidence remains open. Task 2 was not started.

## Task 2 — Strict otpauth URI and bounded multiline parser

Status: Complete for the focused development gate under Node 24; official Node 22 evidence remains open.

### Pre-edit context review

**Static self-review:** Read Task 2, the Task 9 global constraints and shared contracts, the approved Task 1 import model, current domain Base32/Unicode/OTP bounds, and the existing `@shardpass/otp` URI parser/formatter and URI tests. The implementation deliberately delegates final OTP URI conversion to the existing strict OTP adapter instead of duplicating its item conversion or Steam recognition behavior. Google migration, Aegis, Ente, QR/image, messaging, UI, and Task 3 were not started.

### RED evidence

**Direct command evidence:** `pnpm exec vitest run packages/importers/test/otpauth.test.ts`

Observed exit code: 1. Vitest 4.1.10 reported 1 failed file and 45 failed tests. Representative failures were `parseOtpAuthUri is not a function` and `parseOtpAuthLines is not a function`; the new test file loaded and exercised the planned exports before any production parser or barrel export existed.

**Expected RED interpretation:** This was the intended Task 2 RED: failures were caused by missing parser APIs, not test syntax or module-resolution errors.

### Implementation and correction loop

Created `packages/importers/src/otpauth.ts`, exported it from `packages/importers/src/index.ts`, moved `@shardpass/otp` from importer dev dependency to runtime dependency, and refreshed only the lockfile classification with `pnpm install --lockfile-only`. The parser checks aggregate encoded UTF-8 bytes and Unicode scalar count before URL construction, pre-scans nonblank line count and line length before per-line parsing, validates percent encoding and the complete query multimap, canonicalizes only valid complete-byte Base32, emits only fixed safe reason codes, and keeps rejected rows secret-free. It accepts blank lines/CRLF and records stable one-based nonblank-row ordinals. It does not allocate IDs; downstream Task 5 background classification will supply opaque row IDs and may call the Task 1 duplicate helper after parsing.

**Direct command evidence:** The first post-implementation targeted run reported 41/45 passing and exposed four corrections: HOTP period validation, trailing-whitespace acceptance by `URL`, case-confusable known query keys, and a boundary-test construction that exceeded the scalar bound. Subsequent focused runs exposed and corrected one encoded-space test fixture, readonly tuple typing, and one lint expression. No production fix was made without an existing failing assertion.

**Direct command evidence:** `pnpm exec vitest run packages/importers/test/otpauth.test.ts packages/otp/test`

Observed exit code: 0. Vitest reported 7 passed files and 116 passed tests: 45/45 Task 2 parser tests plus 71/71 existing OTP URI, RFC 4226, RFC 6238, Steam, reservation, and repository-reservation tests.

### Regression and static evidence

**Direct command evidence:** `pnpm exec vitest run packages/importers/test packages/domain/test packages/otp/test packages/security/test`

Observed exit code: 0. Vitest reported 13 passed files and 223 passed tests, covering importer model/legacy/parser, domain OTP validation, OTP known answers and URI behavior, and security errors/events.

**Direct command evidence:** `pnpm typecheck && pnpm lint && pnpm exec prettier --check packages/importers/src/otpauth.ts packages/importers/src/index.ts packages/importers/package.json packages/importers/test/otpauth.test.ts pnpm-lock.yaml`

Observed exit code: 0. TypeScript completed with no diagnostics, ESLint completed with no diagnostics or warnings, and all focused Task 2 files plus the lockfile passed Prettier. Node engine warnings are subject to the environment caveat below.

**Direct command evidence:** `rg -n "console\\.|fetch\\(|XMLHttpRequest|WebSocket|EventSource|secret.*message|uri.*message|raw.*message" packages/importers/src/otpauth.ts packages/importers/test/otpauth.test.ts`

Observed exit code: 1 with no output, meaning no matches for production/test logs, network sinks, or reflected secret/URI/raw message construction in the inspected Task 2 surface.

**Direct command evidence:** `node --version && pnpm --version` reported Node `v24.18.0` and pnpm `10.14.0`.

**Environment caveat:** Node 24 evidence is development-only because the project requires Node `>=22.14.0 <23`; this task does not claim the official Node 22 gate.

### Review outcome and downstream interface

Changed in Task 2:

- `packages/importers/src/otpauth.ts` (created)
- `packages/importers/test/otpauth.test.ts` (created)
- `packages/importers/src/index.ts`
- `packages/importers/package.json`
- `pnpm-lock.yaml`
- `.sdd/project1-task9-execution-ledger.md` (append-only Task 2 evidence)

**Static self-review:** Public APIs are exactly `parseOtpAuthUri(uri: string): OtpImportCandidate` and `parseOtpAuthLines(text: string): ParsedOtpImport`. The URI parser accepts only `otpauth://totp|hotp`, forbids credentials, ports, fragments, padding/trailing text, malformed percent/UTF-8/NUL, duplicate/confusable known fields, unknown `x-` critical fields, issuer mismatch, empty issuer prefixes, invalid Base32, unsupported algorithms/digits/period/counter combinations, and non-safe counters. Steam is recognized only through the established explicit TOTP Steam issuer/label marker; `otpauth://steam` is rejected and label text alone does not infer Steam. Supported values preserve issuer, colon-bearing label, SHA1/SHA256/SHA512, six/eight digits, TOTP period, and HOTP zero through maximum safe counter. URI sources formally supply no note/tags/favorite, so defaults remain empty/false and no metadata is invented. Multiline parsing returns candidates and fixed malformed/unsupported rows without raw lines, URI, secret, or arbitrary error strings; one bad bounded row does not abort siblings, while aggregate bytes/scalars/entry and per-line limits fail globally. The parser performs no logs, network, storage, browser calls, or mutable byte allocation requiring a zeroization claim.

No Critical or Important Task 2 self-review finding remains. Downstream code can classify parsed candidates with the Task 1 semantic duplicate helper and generate opaque row IDs after parsing. Task 3 and later import formats remain untouched.

## Task 3 — Google Authenticator migration protobuf batches

Status: Complete for the focused development gate under Node 24; official Node 22 evidence remains open. Task 4 was not started.

### Pre-edit context and constraints

**Static self-review:** Read Task 3, the global constraints and exact public API contract, Tasks 1–2 import model and URI parser, strict workspace catalog/package policy, dependency boundary rules, production executable/build scanner, security output tests, and existing Task 9 ledger. The implementation uses the maintained Buf runtime/generated schema and contains no hand-written protobuf wire decoder.

### RED evidence

**Direct command evidence:** `pnpm exec vitest run packages/importers/test/google-migration.test.ts`

Observed exit code: 1. Vitest 4.1.10 reported 1 failed file and 12 failed tests. The literal, generated-independent protobuf vectors loaded successfully; every test failed because `parseGoogleMigrationUri` / `parseGoogleMigrationUris` did not exist. This was the expected pre-dependency/pre-production RED.

### Dependency and generated-schema evidence

**Direct command evidence:** Added exact strict-catalog pins and ran `pnpm install --no-frozen-lockfile`, then `pnpm --filter @shardpass/importers generate:google-migration`. The install added exact `@bufbuild/protobuf@2.13.0`, generation-only `@bufbuild/buf@1.72.0`, and generation-only `@bufbuild/protoc-gen-es@2.13.0`; pnpm reported Buf's install build script ignored. Generation used only local `protoc-gen-es` from `packages/importers/buf.gen.yaml` and produced the checked-in TypeScript schema with its `protoc-gen-es v2.13.0` provenance header.

**Direct command evidence:** Regeneration hash check reported identical before/after SHA-256 `6cbac5937d67c844d7f734f93010184a83e884e44ee4fbbfd80162781f8281c1`. A fixture-independent test also pins this reviewed generated-file hash.

**Dependency review:** `pnpm list --filter @shardpass/importers --depth Infinity` showed the production runtime as one direct `@bufbuild/protobuf@2.13.0` package with no runtime dependencies; Buf platform binaries and protoplugin/TypeScript tooling remain dev-only. `pnpm licenses list --prod --json` reported `(Apache-2.0 AND BSD-3-Clause)` for the Buf runtime. Source scans of the runtime ESM and generated schema found no `eval` or `Function` construction. `pnpm audit --prod` reported no known vulnerabilities. Official project evidence remains blocked by installed Node `v24.18.0`; pnpm is the pinned `10.14.0`.

### GREEN, regression, and static evidence

**Direct command evidence:** `pnpm exec vitest run packages/importers/test/google-migration.test.ts packages/importers/test/import-model.test.ts` passed 2 files and 22 tests after one test-observed correction: the first implementation cleared protobuf-owned secret views too early, so the decoded payload was cloned through the runtime before clearing the input bytes. The rerun passed.

**Direct command evidence:** `pnpm exec vitest run packages/importers/test/google-migration.test.ts packages/importers/test/import-model.test.ts packages/importers/test/otpauth.test.ts packages/importers/test/legacy-v1.test.ts` passed 4 files and 78 tests. `pnpm exec vitest run packages/importers` later passed 5 files and 80 tests, including 13 Google tests after the generator hash test was added.

**Direct command evidence:** The required `rg -n "readVarint|writeVarint|wireType|fieldNumber|>>> 7|& 0x7f" packages/importers/src/google-migration.ts` scan had no matches. A broader source/dist scan found no manual wire tokens, network sinks, production logs, or dynamic evaluation. Protobuf decoding is exclusively `fromBinary(MigrationPayloadSchema, bytes)`; runtime `clone` separates decoded secret arrays before owned input cleanup.

**Static self-review:** URI/data length, scheme/authority/query shape, percent syntax, Base64 alphabet/padding/pad bits, and decoded-size limits are checked before allocation/decode. Standard and URL-safe Base64 are canonicalized and re-encoded for exact validation. Protobuf bytes are bounded before `fromBinary` and overwritten in `finally`; cloned per-item secret arrays are overwritten after conversion. Version is exactly 1. Batch size/index/id must be nonzero/consistent, complete, unique, within 16, and supplied in exact index order; mixed, missing, duplicate, reversed, or ambiguous singleton metadata fails. Aggregate entries are pre-counted and capped at 1,000. Unknown preserved payload/item fields fail. Only SHA1/SHA256/SHA512, six/eight digits, and HOTP/TOTP are accepted; absent and unknown semantic enums, MD5, unsafe counters, and unsupported types yield fixed `IMPORT_UNSUPPORTED` rows. Malformed secrets/text yield fixed `IMPORT_MALFORMED` rows. Secrets are emitted as canonical unpadded Base32, text is scalar/trim/length checked, HOTP counter zero is preserved, and Google never infers Steam. Returned failures expose only fixed reason codes and no raw bytes, Base64, secret, protobuf/library errors, or protobuf details.

### Verification and review gate

**Direct command evidence:** `pnpm install --frozen-lockfile` passed. `pnpm typecheck`, `pnpm lint`, focused Prettier for all handwritten Task 3 files, and `pnpm dependencies` passed; dependency-cruiser reported 191 modules and 537 dependencies with no violations. The generated `.proto` and deterministic generated TypeScript are narrowly listed in `.prettierignore.project1-task9`; handwritten files are not ignored. The generated file is exempted only from unused-disable reporting in ESLint because regeneration restores its generator-owned directive.

**Direct command evidence:** `pnpm build:security` passed Vite production build, 7/7 packaged security-output tests, and the production build scan. `node scripts/verify-reproducible-build.mjs` verified 15 files with identical SHA-256 bytes. `pnpm exec vitest run --maxWorkers=1` passed the full 72 files and 1,097 tests. Two normal parallel `pnpm test` attempts had only three pre-existing five-second CSS build test timeouts; the exact style test passed alone (3/3 in 6.90 seconds), and the full single-worker rerun passed, so no product/test source was changed for the environment-sensitive timeout.

**Review outcome:** Compared the local proto fields/enums with the public Google migration structure, reviewed generated provenance/hash, exact lock pins, license/browser/ESM/CSP notes, limit order, fixed result projection, owned-buffer cleanup, no-network/no-runtime-generation behavior, and absence of manual wire primitives. No Critical or Important Task 3 finding remains after the decoded-secret lifetime correction, Base64 chunked re-encode correction, exact-optional typing correction, and generated lint/format policy correction.

Changed in Task 3:

- `packages/importers/src/google-authenticator-migration.proto` (created)
- `packages/importers/src/generated/google-authenticator-migration_pb.ts` (created, deterministic generated output)
- `packages/importers/buf.gen.yaml` (created)
- `packages/importers/src/google-migration.ts` (created)
- `packages/importers/test/google-migration.test.ts` (created)
- `.prettierignore.project1-task9` (created, generated-only ignore)
- `packages/importers/src/index.ts`
- `packages/importers/package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `eslint.config.js` (narrow generated-code policy)
- `docs/architecture/dependencies.md`
- `.sdd/project1-task9-execution-ledger.md` (this append-only Task 3 evidence)

No Git/worktree/commit command was run. Task 4 and later tasks remain unimplemented.

## Task 3 correction round 1/5 — isolated async protobuf decode

Status: Correction complete under Node 24 development evidence; official Node 22 evidence remains open. Task 4 was not started.

### Review investigation and decision

**Static investigation:** Reviewed `@bufbuild/protobuf@2.13.0` declarations and implementation. `fromBinary` exposes only `readUnknownFields` and `recursionLimit`; maintained reflection is post-decode and there is no occurrence, repeated-list, byte-allocation, or callback budget. Implementing a pre-expansion occurrence scanner would require forbidden manual protobuf tags/varints/wire cursors. Because there were no consumers, the public synchronous APIs were removed rather than retained as an isolation bypass. The planned names now return `Promise<ParsedOtpImport>` and always use a single-use local module Worker.

### RED evidence

**Direct command evidence:** `pnpm exec vitest run packages/importers/test/google-migration.test.ts packages/importers/test/google-migration-worker.test.ts` exited 1. The new worker suite failed 4/4 because the public parsers still returned synchronously and posted no Worker request; the direct suite failed module resolution because the internal byte decoder/input modules did not yet exist. This was the expected correction RED before production edits.

### Implemented correction

- Public `parseGoogleMigrationUri` and `parseGoogleMigrationUris` are Promise-only and instantiate the local module Worker. The barrel exports no direct decoder.
- Caller-side code prevalidates URI shape, percent syntax, Base64 alphabet/padding/pad bits, canonical Base64 re-encoding, batch count, and decoded byte size before Worker creation. It copies exact `ArrayBuffer`s, captures `postMessage`/`terminate` once, transfers all batches in one operation, clears caller copies, validates one strict response, rejects wrong IDs/unknown fields/excess rows, nulls handlers, removes abort listeners, and terminates on success, fixed failure, hostile message, error, abort, timeout, or post failure.
- Worker protocol is strict version 1. The single-use Worker validates all transferred byte bounds, decodes all batches with maintained `fromBinary`, rejects unknown fields, validates version and batch metadata before cloning, enforces canonical `toBinary` byte equality, validates batch consistency/order and aggregate 1,000 count, converts rows, and clears bytes in outer cleanup.
- Canonical protobuf is now an explicit strict policy. Duplicate singular fields for every payload/item singular field, explicit proto3 defaults, reordered fields, and other noncanonical authentic variants are safely `IMPORT_MALFORMED`; unknown fields are rejected separately. Repeated OTP item order remains meaningful and canonical.
- The direct decoder and injected clear callback are reachable only by relative internal test imports, never from `packages/importers/src/index.ts`.

### Tests and findings

**Direct command evidence:** Focused GREEN passed 2 files and 20 tests. Literal generated-independent fixtures now cover every singular duplicate: payload version/batch size/batch index/batch ID and item secret/name/issuer/algorithm/digits/type/counter, plus reordered fields. A dense 1,001-entry sub-1 MiB fixture is rejected; worker-boundary tests show Promise scheduling responsiveness, hard timeout/abort termination, capture-once methods, exact transfers, strict hostile response rejection, wrong request IDs, result count bounds, and late-response suppression. Cleanup-observer tests cover success, unknown-field failure, version failure, batch-limit failure, and unsupported row conversion; observed input, decoded, and cloned byte arrays are zero-filled.

**Correction during GREEN:** Canonical enforcement revealed earlier literal vectors encoded explicit proto3 default zero fields. Fixtures were regenerated independently into canonical form; explicit-default variants remain rejection fixtures. Decoder validation was reordered so unknown/version/batch metadata run before clone and canonical comparison follows metadata validation. Cloning now occurs only after per-batch count validation. Exact optional response candidates are reconstructed without `counter: undefined` before validation/publication.

### Verification evidence

**Direct command evidence:** `pnpm exec vitest run packages/importers` passed 6 files and 86 tests. `pnpm typecheck`, `pnpm lint`, focused Prettier, and `pnpm dependencies` passed; dependency-cruiser reported 197 modules and 553 dependencies with no violations.

**Direct command evidence:** The manual-wire scan over `packages/importers/src/google-migration*.ts` found no `readVarint`, `writeVarint`, `wireType`, `fieldNumber`, `BinaryReader`, `makeReadContext`, `readField`, `>>> 7`, or `& 0x7f`. Generated-schema regeneration retained SHA-256 `6cbac5937d67c844d7f734f93010184a83e884e44ee4fbbfd80162781f8281c1`. `pnpm audit --prod` reported no known vulnerabilities.

**Direct command evidence:** `pnpm build:security` passed the production Vite build, 7/7 security-output tests, and build scanner. `pnpm exec vitest run --maxWorkers=1` passed 73 files and 1,104 tests. `node scripts/verify-reproducible-build.mjs` verified 15 files with identical SHA-256 bytes.

**Static self-review:** No synchronous public Google migration decoder/export remains and there are no current downstream consumers. Later Task 6/7 production code must consume only the Promise APIs. Worker source is local, performs no fetch/network/eval/Function/runtime generation, and the Worker boundary receives all batches together so aggregate consistency/count and cleanup are not split across privileged calls. The Worker cannot prevent its own maintained decoder allocation before count becomes known; hard termination/timeout and separate execution context are the documented resource boundary. No Critical or Important round-1 finding remains.

Changed in correction round 1:

- `packages/importers/src/google-migration.ts`
- `packages/importers/src/google-migration-decoder.ts` (internal direct decoder)
- `packages/importers/src/google-migration-input.ts` (caller prevalidation/internal tests)
- `packages/importers/src/google-migration-worker-client.ts`
- `packages/importers/src/google-migration-worker-entry.ts`
- `packages/importers/src/google-migration-worker-protocol.ts`
- `packages/importers/test/google-migration.test.ts`
- `packages/importers/test/google-migration-worker.test.ts`
- `docs/architecture/dependencies.md`
- `.sdd/project1-task9-execution-ledger.md`

No Git/worktree/commit operation occurred. Task 4 remains untouched.

## Task 3 correction round 2/5 — transfer and malformed-request cleanup

Status: Correction complete under Node 24 development evidence; official Node 22 evidence remains open. Task 4 was not started.

### Root cause and RED evidence

**Static investigation:** The client created exact transfer `ArrayBuffer`s after the `finish` closure, so a synchronous `postMessage` failure left those non-detached copies unreachable to cleanup. It also read `postMessage` before assigning the already-validated termination closure, so a hostile getter could prevent termination. The Worker entry parsed before owning malformed request buffers; schema or aggregate-size failure could therefore leave transferred buffers uncleared and did not close promptly when no valid request ID existed.

**Direct command evidence:** Initial focused RED could not load because the new internal Worker handler module did not exist. After adding the desired handler boundary, a dedicated getter test failed with two payload getter reads instead of one, proving that defensive collection followed by Zod parsing re-invoked a hostile accessor. Tests also exercised the pre-fix synchronous post failure and termination getter/nonfunction cases.

### Implemented correction

- The client declares exact transfer buffers beside `finish`, making them cleanup-owned for every terminal path. `finish` clears each non-detached transfer through `Uint8Array.fill(0)`, drops the transfer list, clears original decoded payload arrays, removes listeners/handlers, and remains idempotent. Successful structured transfers are detached and skipped harmlessly.
- A valid `terminate` method is captured and installed before `postMessage` is read. A throwing or nonfunction `postMessage` getter therefore invokes termination exactly once. Throwing termination is contained and cannot replace the fixed parser failure.
- Added an internal Worker message handler. Before strict parsing it checks only an own `payloads` property, captures it once with guarded `Reflect.get`, traverses at most `maxMigrationBatches + 1` own array slots, and collects only structurally present `ArrayBuffer` values. Array entries and getters are each guarded.
- Strict request parsing receives a descriptor-preserving shallow copy with the captured payload value, preventing a second payload getter invocation without invoking unrelated getters during the copy. Both defensively collected and successfully parsed buffers are cleared in `finally`.
- The Worker attempts `close()` exactly once after success or every malformed/schema/aggregate/decode path, including missing request IDs. Close and response failures are contained. No hostile request ID, getter error, or parser error is reflected.

### Focused tests

**Direct command evidence:** `pnpm exec vitest run packages/importers/test/google-migration-worker.test.ts` passed 11/11 tests after the single-read correction. New cases verify exact transfer copies retain nonzero data at capture time and are zeroed after synchronous post failure; original payload ownership is also terminated through the common cleanup path. Throwing/nonfunction `postMessage` getters terminate exactly once even when termination itself throws. Worker tests verify schema-failure and aggregate-size-failure buffers are all zeroed, close is attempted, hostile payload access occurs once, hostile IDs/errors are not reflected, and close failures do not escape.

### Regression and security evidence

**Direct command evidence:** Full importer regression passed 6 files and 93 tests. Typecheck and ESLint passed. Focused Prettier passed. Dependency-cruiser reported no violations across 198 modules and 557 dependencies. The prohibited source scan found no manual protobuf wire primitives, network APIs, dynamic evaluation, or production logs in the Google migration modules.

**Direct command evidence:** `pnpm build:security` passed the production build, 7/7 packaged security-output tests, and build scanner. Full single-worker regression passed 73 files and 1,110 tests. Reproducible build verification reported 15 identical files. `pnpm audit --prod` reported no known vulnerabilities.

Changed in correction round 2:

- `packages/importers/src/google-migration-worker-client.ts`
- `packages/importers/src/google-migration-worker-handler.ts` (created internal handler)
- `packages/importers/src/google-migration-worker-entry.ts`
- `packages/importers/src/google-migration-worker-protocol.ts`
- `packages/importers/test/google-migration-worker.test.ts`
- `.sdd/project1-task9-execution-ledger.md`

**Self-review:** Cleanup ownership now begins before every operation that can throw: client originals before Worker creation, termination before `postMessage` access, transfer copies before posting, defensive Worker buffers before schema parsing, and parsed buffers before decode. Cleanup/termination/close are bounded, guarded, idempotent at the client boundary, and reveal no user-controlled details. No Critical or Important round-2 finding remains. No Git/worktree/commit operation occurred; Task 4 remains untouched.

## Task 3 correction round 3/5 — hostile traversal and cleanup isolation

Status: Correction complete under Node 24 development evidence; official Node 22 evidence remains open. Task 4 was not started.

### RED and root cause evidence

**Static investigation:** Defensive payload capture and collection still occurred before the handler's outer `try/finally`. Collection used direct array length access and `instanceof ArrayBuffer`; a proxy array could throw before close, while a proxy around an ArrayBuffer could pass `instanceof` and then throw during byte-length/clear access. Cleanup loops also called one clear operation without per-buffer containment, allowing one cleanup error to stop later buffers and skip close.

**Direct command evidence:** `pnpm exec vitest run packages/importers/test/google-migration-worker.test.ts` exited 1 with 3 failed tests. A proxy array throwing on `length` escaped and close was not reached; a proxied ArrayBuffer caused the intrinsic byte-length TypeError to escape before a following genuine buffer was cleared; and the requested injectable clear dependency was absent, so zero clear calls were observed. These were the expected focused RED failures.

### Implemented correction

- Payload capture, bounded collection, strict parse, decode, response, and failure mapping now all execute inside one outer `try/finally`; close is in the nested finalizer and attempted exactly once regardless of traversal or cleanup failures.
- Array detection is guarded. Length is read once through guarded `Reflect.get`, then required to be a safe nonnegative integer no greater than `maxMigrationBatches + 1`. Every own-index check and `Reflect.get` is independently guarded.
- ArrayBuffer recognition uses the captured intrinsic `ArrayBuffer.prototype.byteLength` getter invoked with `Reflect.apply`. A proxy fails the intrinsic brand check and is never retained. No unguarded hostile byte-length property is read.
- Every collected and parsed buffer clear is isolated in its own `try/catch`; failure on one buffer cannot stop remaining clears. Close runs from an inner `finally`, including when custom test cleanup throws. Production still uses best-effort zero fill for genuine branded non-detached ArrayBuffers.

### Verification evidence

**Direct command evidence:** Focused Worker tests passed 14/14 after GREEN. New tests prove: a proxy array throwing on length does not escape and closes once; a proxied ArrayBuffer is rejected while a following genuine secret-bearing buffer is cleared and close occurs; and an injected clear throwing for the first buffer does not prevent the second buffer from clearing or close.

**Direct command evidence:** Full importer regression passed 6 files and 96 tests. Typecheck, ESLint, focused Prettier, dependency boundaries, and forbidden manual-wire/network/dynamic-code/log scans passed. Dependency-cruiser reported 198 modules and 557 dependencies with no violations.

**Direct command evidence:** `pnpm build:security` passed the production build, 7/7 packaged output tests, and production scanner. Full single-worker regression passed 73 files and 1,113 tests. Reproducible build verification reported 15 identical files. `pnpm audit --prod` reported no known vulnerabilities.

Changed in correction round 3:

- `packages/importers/src/google-migration-worker-handler.ts`
- `packages/importers/test/google-migration-worker.test.ts`
- `.sdd/project1-task9-execution-ledger.md`

**Self-review:** All hostile operations in request traversal are guarded and bounded; buffer retention requires the intrinsic ArrayBuffer brand; every clear is isolated; close is a nested unconditional exactly-once attempt; user-controlled errors and IDs remain unreflected. No Critical or Important round-3 finding remains. No Git/worktree/commit operation occurred; Task 4 remains untouched.

## Task 3 correction round 4/5 — private transfer ownership and complete request snapshots

Status: Correction complete under Node 24 development evidence; official Node 22 evidence remains open. Task 4 was not started.

### RED and root cause evidence

**Static investigation:** Although round 2 made transfer buffers reachable by `finish`, the client exposed the same mutable array as the request payload list, transfer list, and cleanup authority. A hostile `postMessage` implementation could splice both exposed arrays and make genuine copies unreachable. Client settlement also followed several cleanup operations without a nested final settlement guarantee. In the Worker, payload values were snapshotted, but Zod could still consume other fields from the original object and the original proxy payload array remained involved in schema processing.

**Direct command evidence:** Focused RED reported 2 failures. A hostile `postMessage` that replaced request payloads and emptied the transfer list left the genuine transfer buffer nonzero. A payload proxy returning length 2 once and 1,000,000 later was read 1,000,003 times, proving the original proxy reached schema traversal rather than a bounded dense snapshot.

### Implemented correction

- The client now owns a private frozen `ownedTransfers` array. The request receives a separate shallow `requestPayloads` copy and `postMessage` receives a separate shallow `transferList` copy. Hostile mutation of either exposed array cannot alter cleanup ownership.
- Client `finish` captures the Promise resolve/reject functions, sets the settled flag once, and uses nested `try/finally`: each private transfer is intrinsic-brand checked and cleared in isolation; then each original payload is cleared in isolation; then timeout/listeners/handlers/termination are attempted independently; then resolve or reject executes from the innermost finalizer. No cleanup exception can prevent Promise settlement.
- The Worker snapshots all expected own request keys (`version`, `kind`, `requestId`, `payloads`) exactly once through guarded reads. `Reflect.ownKeys` verifies the exact field set without invoking unknown getters. Request IDs are bounded before strict parsing.
- Payload traversal reads proxy length once, validates a safe bounded length, requires every own dense slot, reads each slot once, requires intrinsic ArrayBuffer branding, and constructs a new frozen dense plain array. Zod sees only a frozen plain request object and that dense snapshot, never the original candidate/proxy.
- Genuine buffers are retained for cleanup immediately after each successful guarded read, even if a later field, hole, proxy, brand, or schema check makes the request malformed.

### Focused tests and GREEN evidence

**Direct command evidence:** `pnpm exec vitest run packages/importers/test/google-migration-worker.test.ts` passed 18/18 tests. New cases verify hostile mutation of both exposed client arrays cannot hide genuine owned buffers; fixed rejection settles despite throwing handler setters, termination, and post failure; all expected request fields are read once while an unknown getter is never invoked; and a proxy changing length/entries after first access is read once per property, bounded, converted to a dense snapshot, and both genuine buffers are cleared.

### Regression and security evidence

**Direct command evidence:** Importer regression passed 6 files and 100 tests. Typecheck, ESLint, focused Prettier, dependency boundaries, and forbidden manual-wire/network/dynamic-code/log scans passed. Dependency-cruiser reported no violations across 198 modules and 557 dependencies.

**Direct command evidence:** `pnpm build:security` passed the production build, 7/7 packaged output tests, and production scanner. Full single-worker regression passed 73 files and 1,117 tests. Reproducible build verification reported 15 identical files. `pnpm audit --prod` reported no known vulnerabilities.

Changed in correction round 4:

- `packages/importers/src/google-migration-worker-client.ts`
- `packages/importers/src/google-migration-worker-handler.ts`
- `packages/importers/src/google-migration-worker-protocol.ts`
- `packages/importers/test/google-migration-worker.test.ts`
- `.sdd/project1-task9-execution-ledger.md`

**Exhaustive self-review:** Cleanup authority is private and immutable; hostile arguments are copies; every cleanup phase is independently guarded and settlement is in a finalizer; Worker field access is exact-own, guarded, bounded, and once-only; unknown getters are not invoked; payload proxies never reach Zod; genuine buffers are retained before later failures; errors/IDs remain unreflected. No Critical or Important round-4 finding remains. No Git/worktree/commit operation occurred; Task 4 remains untouched.

## Task 3 correction round 5/5 — aggregate allocation-free Base64 preflight

Status: Final Task 3 correction complete under Node 24 development evidence; official Node 22 evidence remains open. Task 4 was not started.

### RED and root cause evidence

**Static investigation:** The URI byte helper validated and decoded each URI in one loop. Although each payload was individually bounded, multiple sub-limit batches could cumulatively exceed the 1 MiB import input limit after earlier `atob` strings and `Uint8Array`s had already been allocated. Worker creation happened after this helper, so cumulative overflow avoided Worker creation but not prior Base64 allocation.

**Direct command evidence:** Focused RED failed 2 tests. Two 524,289-byte payloads did not reject cumulative overflow and the injected decode counter was called; the exact 1,048,576-byte aggregate boundary did not invoke the injected decoder because no two-pass decoder seam existed. This proved aggregate validation was post-allocation rather than pre-allocation.

### Implemented correction

- Base64 shape validation is now allocation-free with respect to decoded bytes. It validates URI structure, percent encoding, alphabet, standard-vs-URL-safe mode, padding position/count, length modulus, and canonical padded representation, then computes `decodedLength` arithmetically without `atob`, binary strings, `Uint8Array`, or Worker creation.
- `decodeGoogleMigrationUriBytes` is explicitly two-pass. Pass one extracts and validates every URI, stores at most 16 bounded canonical descriptors, safely accumulates canonical encoded lengths and decoded lengths, and rejects aggregate decoded bytes above exactly 1,048,576 before decoding anything. The aggregate canonical encoded bound is limited to the 1 MiB Base64 envelope plus at most four padding characters per allowed batch, preventing a 16-times oversized descriptor set.
- Pass two calls the decoder only after all descriptors pass aggregate preflight. Decoder output must be a `Uint8Array` of the exact precomputed length; prior outputs are cleared if a later decode fails.
- The public Worker executor still calls this helper before Worker creation, so cumulative overflow performs zero Base64 decodes and zero Worker factory calls. The Worker protocol retains its independent per-buffer and cumulative 1 MiB defense.

### Focused tests and GREEN evidence

**Direct command evidence:** Focused RED became GREEN with 35/35 Google parser/Worker tests. Two independently sub-limit 524,289-byte payloads reject `IMPORT_LIMIT_EXCEEDED`; injected decode and Worker factory counters remain zero. Two 524,288-byte payloads at the exact 1,048,576-byte aggregate boundary pass preflight, invoke decode exactly twice, and produce exactly 1,048,576 bytes.

### Regression, security, and environment evidence

**Direct command evidence:** Importer regression passed 6 files and 102 tests. Typecheck, ESLint, focused Prettier, dependency boundaries, and forbidden manual-wire/network/dynamic-code/log scans passed. Dependency-cruiser reported no violations across 198 modules and 558 dependencies. The Worker protocol source still contains its cumulative `total > IMPORT_LIMITS.maxInputBytes` defense.

**Direct command evidence:** `pnpm build:security` passed the production build, 7/7 packaged output tests, and production scanner. The first two full single-worker attempts had one environment-sensitive startup-process failure (`ShardPass startup worker unavailable`). Running startup diagnostics with the harness passed 3/3, and the subsequent full single-worker invocation passed 73 files and 1,119 tests including the startup harness (1/1). No product or harness source was changed for this transient Chromium startup condition. Reproducible build verification reported 15 identical files. `pnpm audit --prod` reported no known vulnerabilities.

Changed in correction round 5:

- `packages/importers/src/google-migration-input.ts`
- `packages/importers/test/google-migration-worker.test.ts`
- `.sdd/project1-task9-execution-ledger.md`

**Final exhaustive self-review:** All URI/Base64 structures and aggregate lengths are checked before decoded allocation or Worker creation; arithmetic uses safe integer checks; descriptor count is limited to 16 and aggregate encoded storage is bounded; exact aggregate boundary is accepted and one-over rejected; canonical decode/re-encode remains separate in pass two; prior decoded bytes clear on later failure; Worker cumulative defense remains; no manual protobuf wire parser exists. No Critical or Important round-5 finding remains. No Git/worktree/commit operation occurred; Task 4 remains untouched.

## Task 3 final adjudication correction after round 5 — canonical protobuf buffer cleanup

Status: The one valid finding identified after correction round 5 is corrected under Node 24 development evidence; official Node 22 evidence remains open. Task 4 was not started.

### Finding, RED, and correction

**Static investigation:** `toBinary()` in `google-migration-decoder.ts` allocated a canonical `Uint8Array` containing every decoded OTP secret. The decoder compared that allocation with the owned input but never cleared it on either the canonical success path or the noncanonical mismatch failure path. Existing decoded, cloned, and input cleanup did not own this separate serializer allocation.

**Direct command evidence:** `pnpm exec vitest run packages/importers/test/google-migration.test.ts` exited 1 at the adjudication RED with 2 failed and 15 passed tests. Both new lifecycle cases—canonical success and noncanonical mismatch—observed zero canonical allocations because the requested internal injectable serializer/clear observation seam did not yet exist. The failures were the expected pre-correction evidence.

The correction adds a relative-only `google-migration-decoder.test-helper.ts`; it is not exported from the package barrel. The helper injects the canonical serializer and observes cleanup without exposing secret bytes through the public package API. Production wraps only canonical comparison in `try/finally`, zeroes the canonical allocation before notifying the observer, and guards both best-effort operations so cleanup cannot replace fixed parser behavior or block decoded/input finalizers. Observer-side repeated `fill(0)` proves clearing is idempotent. Existing decoded, cloned, and input cleanup remains in its prior outer finalizers.

### Focused and regression evidence

**Direct command evidence:** The immediate GREEN rerun of `pnpm exec vitest run packages/importers/test/google-migration.test.ts` passed 1 file and 17/17 tests. After formatting, `pnpm exec vitest run packages/importers/test/google-migration.test.ts packages/importers/test/google-migration-worker.test.ts` passed 2 files and 37/37 tests. `pnpm exec vitest run packages/importers` passed 6 files and 104/104 tests.

**Direct command evidence:** `pnpm typecheck` and `pnpm lint` exited 0 with no diagnostics or warnings. Focused Prettier over the decoder, relative test helper, and Google test passed after formatting one decoder file. `pnpm dependencies` exited 0 with no violations across 199 modules and 562 dependencies.

**Direct command evidence:** `pnpm exec vitest run --maxWorkers=1 --reporter=json --outputFile=/tmp/shardpass-task9-final-vitest.json` exited 0; the JSON report recorded 171/171 passed test files and 1,121/1,121 passed tests. `pnpm build:security` exited 0 after a 1,974-module Vite build, 7/7 packaged security-output tests, and the production build scan. `node scripts/verify-reproducible-build.mjs` verified 15 files with identical SHA-256 bytes. `pnpm audit --prod` reported no known vulnerabilities.

**Direct command evidence:** The unscoped `pnpm format:check` remained nonzero only for three pre-existing excluded/non-Task9 files: the Task 8 ledger, the recovered contaminated Task 7 ledger, and the reviewed generated Google protobuf source. The Task9 ignore-path rerun excluded the generated source and remained nonzero only for the two prior ledgers. No unrelated file was rewritten; focused correction files pass Prettier.

**Environment caveat:** Commands ran with Node `v24.18.0` and pinned pnpm `10.14.0`; the project requires Node `>=22.14.0 <23`, so this remains development evidence and does not clear the official Node 22 gate.

Changed in this post-round-5 adjudication correction:

- `packages/importers/src/google-migration-decoder.ts`
- `packages/importers/src/google-migration-decoder.test-helper.ts`
- `packages/importers/test/google-migration.test.ts`
- `.sdd/project1-task9-execution-ledger.md`

**Final adjudication:** The serializer-owned canonical bytes are now cleared on canonical success and noncanonical mismatch/error before control leaves comparison. Cleanup is best-effort, double clearing is safe, and decoded/cloned/input cleanup still runs. No Git, worktree, or commit operation occurred. Task 4 remains untouched.

## Task 9.3 final narrow correction — test-seam allocation ownership

Status: Complete under Node 24 development evidence; official Node 22 evidence remains open.

### Finding, RED, and correction

**Static investigation:** The relative-only canonical lifecycle test helper allocated canonical protobuf bytes and called `observer.allocated` before returning them to the production decoder. If that allocation observer threw, control left the serializer before production received the allocation, so neither the helper nor production cleared it or notified `observer.cleared`.

**Direct command evidence:** `pnpm exec vitest run packages/importers/test/google-migration.test.ts` exited 1 at strict RED with 2 failed and 17 passed tests. In both new observer-throw cases the allocation was captured, but the cleared observer received no allocation and the captured canonical bytes remained nonzero. The failure was specific to the missing helper-owned cleanup path.

The nonpublic helper now retains ownership until `observer.allocated` returns successfully. If allocation observation throws, it best-effort zero-fills that same canonical allocation, best-effort calls `observer.cleared` with the same allocation, and rethrows the original allocation error. A cleared-observer error is suppressed only on this cleanup path so it cannot replace the allocation-observer error. The helper's optional owned-byte clear seam lets the strict test observe that decoded secret cleanup and input cleanup still execute through production finalizers; it remains absent from the package barrel and package exports.

### GREEN and verification evidence

**Direct command evidence:** The focused GREEN run of `pnpm exec vitest run packages/importers/test/google-migration.test.ts` passed 1 file and 19/19 tests. The new tests prove same-allocation zero-fill and cleared notification, decoded/input cleanup, and original allocation-error identity when both observer callbacks throw.

**Direct command evidence:** `pnpm exec vitest run packages/importers` passed 6 files and 106/106 tests. `pnpm typecheck` and `pnpm lint` exited 0 without diagnostics or warnings. Focused Prettier over the helper and Google migration test passed. `pnpm dependencies` reported no violations across 199 modules and 562 dependencies. A source/export search found the helper only in its own relative source file and the Google migration test, with no barrel, package export, application, or production consumer.

**Direct command evidence:** `pnpm build:security` passed the 1,974-module production build, 7/7 packaged output security tests, and production build scan. `pnpm audit --prod` reported no known vulnerabilities.

**Environment caveat:** Commands ran with Node `v24.18.0` and pinned pnpm `10.14.0`; the project requires Node `>=22.14.0 <23`, so this remains development evidence and does not clear the official Node 22 gate.

Changed in Task 9.3:

- `packages/importers/src/google-migration-decoder.test-helper.ts`
- `packages/importers/test/google-migration.test.ts`
- `.sdd/project1-task9-execution-ledger.md`

No Git, worktree, or commit operation occurred.

## Task 4 — Supported Aegis and Ente exports with deterministic detection

Status: Complete for the focused development gate under Node 24; official Node 22 evidence remains open.

### Scope and format review

**Static review:** Read Task 4, global constraints, the shared import API/model, strict URI behavior, the authorized Aegis vault documentation (unencrypted envelope version 1, database version 3), current Ente Auth export documentation/source, and preserved ShardPass 1.2.1 Ente URI/entity structures. The implementation is local and pure. It does not add Aegis decryption, Ente authentication/sync, QR/image handling, or Task 10 backup behavior.

The supported Ente static envelope is deliberately explicit and OTP-only: `{ format: "ente-auth-export", version: 1, entries: [...] }`. Encrypted Ente version-1 wrappers (`kdfParams`, `encryptedData`, `encryptionNonce`), sync envelopes, credentials, login/future kinds, and unknown critical envelope fields are unsupported. Remote entity metadata may appear only on a supported OTP row and is discarded before candidate construction; credentials and sync authority are rejected globally.

### Strict RED evidence

**Direct command evidence:** `pnpm exec vitest run packages/importers/test/aegis.test.ts packages/importers/test/ente-export.test.ts packages/importers/test/detect.test.ts` exited 1 with 3 failed files and 33 failed tests. Representative failures were `parseAegisExport is not a function`, `parseEnteExport is not a function`, and `parseOtpImportText is not a function`; tests loaded and failed because Task 4 exports did not exist.

A later detector RED added Google migration precedence: `pnpm exec vitest run packages/importers/test/detect.test.ts` exited 1 with 1 failed and 14 passed tests because the detector returned fixed `IMPORT_UNSUPPORTED` for a valid migration discriminator. The correction routed that exact discriminator first through the existing bounded generated-schema decoder; the focused rerun passed 15/15.

### Implementation and dependency decision

Added strict parsers/detection plus shared bounded JSON support. Input UTF-8 byte and Unicode scalar bounds run before parsing. The maintained dependency `@streamparser/json` is pinned at `0.0.22` (MIT, dependency-free, browser-compatible ES6/TextEncoder/TextDecoder surface, released 2025-01-26 and therefore eligible under the workspace minimum-release-age policy). Token callbacks reject duplicate keys before assignment, dangerous `__proto__`/`constructor`/`prototype` keys, depth over 64, more than 256 object keys, more than 1,000 array items, strings over 4,096 code units, NUL, malformed Unicode scalar input, and malformed/trailing JSON. A post-parse iterative walk rejects unsafe/non-integer numeric values before mapping. No manual JSON lexical tokenizer was implemented.

Aegis accepts only unencrypted envelope version 1 with `header.slots === null`, `header.params === null`, object `db`, database version 3, documented strict envelope/database keys, and explicit TOTP/HOTP/Steam entries. It maps groups to bounded tags and preserves supported note/favorite data. Encrypted/password slots return fixed `IMPORT_UNSUPPORTED`; unsupported entry kinds and malformed entry semantics are safe row rejections while valid rows continue.

Ente accepts only the explicit static OTP envelope/version and explicit `type: "otp"` rows. TOTP/HOTP/Steam, algorithms, digits, period, counter, canonical Base32, note/tags/favorite, and missing metadata defaults are explicit. Login/future kinds are row-level unsupported; encrypted/sync/credential envelopes and unknown critical envelope fields are globally unsupported. IDs, timestamps, should-sync state, credentials, and entity metadata never enter candidates.

Detection order is exact Google migration, complete otpauth lines, Aegis discriminator, then Ente discriminator. Mixed Aegis/Ente discriminators are rejected instead of trying one parser and falling back. Arbitrary JSON/prose is never scraped for seeds.

### GREEN, regressions, and security evidence

**Direct command evidence:** The focused GREEN command passed 3/3 files and 33/33 tests. After the migration-precedence RED/correction, the final importer command `pnpm exec vitest run packages/importers` passed 9/9 files and 140/140 tests.

**Direct command evidence:** `pnpm typecheck` exited 0 with no diagnostics. `pnpm lint` exited 0 with no diagnostics or warnings. Focused Prettier over all Task 4 source/tests, importer package metadata, workspace catalog, and lockfile reported all matched files use Prettier style.

**Direct command evidence:** `pnpm exec vitest run --maxWorkers=1 --reporter=json --outputFile=/tmp/shardpass-task4-vitest.json` exited 0 and reported 177/177 passed test files and 1,156/1,156 passed tests before the final migration detector assertion was added; the final focused importer suite includes that added assertion and passed 140/140. `pnpm dependencies` reported no violations across 208 modules and 588 dependencies. `pnpm audit --prod` reported no known vulnerabilities.

**Direct command evidence:** Source scans found no console, network, camera, decryption/password handling, Ente credential/sync authority, or incomplete-work marker in the Task 4 parser sources. Matches for the word `pending` were only the local iterative post-parse validation stack variable, not Ente pending state.

**Environment caveat:** Commands ran with Node `v24.18.0` and pinned pnpm `10.14.0`; the project requires Node `>=22.14.0 <23`, so this is development evidence only and does not clear the official Node 22 gate.

Changed in Task 4:

- `packages/importers/src/aegis.ts`
- `packages/importers/src/ente-export.ts`
- `packages/importers/src/detect.ts`
- `packages/importers/src/strict-json.ts`
- `packages/importers/src/json-candidate.ts`
- `packages/importers/src/index.ts`
- `packages/importers/test/aegis.test.ts`
- `packages/importers/test/ente-export.test.ts`
- `packages/importers/test/detect.test.ts`
- `packages/importers/package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `.sdd/project1-task9-execution-ledger.md`

No Git/worktree/commit operation occurred. Task 5 was not started.

## Task 9.4 correction round 1/5 — preflight, lossless JSON, documented Ente, canonical Aegis

Status: Implemented under Node 24 development evidence; official Node 22 evidence remains open.

### Authoritative finding verification

The reviewer findings were verified against source before correction. `parseOtpImportText` called `startsWith` and allocated `split/filter` output before the shared `measureImportText` preflight. `@streamparser/json@0.0.22` defaulted numeric lexemes through `Number(numberStr)`, so `1.0`, `1e0`, underflow, and rounded unsafe integers could lose their original security-relevant spelling. Its maintained `Tokenizer` exports a protected `parseNumber(numberStr)` override API, so replacement and a hand-written lexer were unnecessary. Official Ente Auth version-1 documentation defines only `{ version, kdfParams: { memLimit, opsLimit, salt }, encryptedData, encryptionNonce }`; decrypted content is newline-separated `otpauth://` text, and no typed unencrypted entries JSON exists. The prior `ente-auth-export` entries claim and acceptance were invented and are superseded here. Official Aegis `docs/vault.md` defines outer version 1, plaintext header nulls, db version 3, complete entry fields, UUID-v4 entry/group identifiers, nullable icon triplet consistency, exact type-dependent info, and complete group fields.

### RED evidence

`pnpm exec vitest run packages/importers/test/detect.test.ts packages/importers/test/aegis.test.ts` failed 2 files with 6 failing assertions: oversized detector input invoked `String.prototype.split` once before rejection; fractional/exponent version lexemes were accepted; invalid digits/period lexemes were accepted; an unsafe counter was rejected globally after lossy conversion. This was the expected preflight/lossless-number RED.

`pnpm exec vitest run packages/importers/test/ente-export.test.ts packages/importers/test/detect.test.ts` failed only the new assertion that the invented typed Ente entries envelope must be unsupported; documented encrypted wrapper refusal and decrypted newline otpauth routing already produced fixed safe behavior.

`pnpm exec vitest run packages/importers/test/aegis.test.ts` then failed 29/39 canonical-schema assertions. Missing canonical entry fields defaulted or received the wrong safe reason; UUID/icon/unknown-field consistency was incomplete; duplicate/referential checks were incomplete; unsupported versus malformed row classification was collapsed; and old 1,000-entry fixtures omitted documented fields.

### Corrections

The detector now calls shared allocation-free byte/scalar preflight before `startsWith`, line splitting, filtering, URI decoding, or JSON parsing. A monkeypatched split counter proves zero split calls for oversized input.

Strict JSON now composes the maintained `Tokenizer` and `TokenParser`. A small subclass overrides the library's documented protected `parseNumber(numberText)` hook; it accepts only lexical `0|[1-9][0-9]*`, rejects signs/fractions/exponents/underflow, limits the bounded lexeme, parses with `BigInt`, enforces `0..Number.MAX_SAFE_INTEGER`, and converts only afterward. Invalid-number sentinels remain in the parsed row so envelope numbers reject globally and entry-local numbers become safe malformed rows. Existing pre-parse input, duplicate key, prototype key, depth, width, string, array, NUL, Unicode, and trailing-input controls remain.

`parseEnteExport` now recognizes only the exact documented encrypted version-1 wrapper and always returns fixed `IMPORT_UNSUPPORTED` after strict shape/number validation. It performs no password handling or decryption. Documented decrypted plaintext is detected and returned as ordinary `otpauth` multiline import. The invented typed Ente JSON acceptance, metadata mapping, login handling, and prior ledger support claim are removed and superseded.

Aegis now requires every documented entry field, exact unknown-field policy, UUID-v4 syntax, unique entry/group IDs, complete group objects, valid group references, icon-null consistency or canonical padded Base64 plus string MIME/hash, and exact type-specific info fields. Supported-type shape/semantic failures produce `IMPORT_MALFORMED` rows; MOTP/Yandex and other unsupported kinds produce `IMPORT_UNSUPPORTED` rows. Valid rows continue.

`docs/architecture/dependencies.md` now reviews exact-pinned `@streamparser/json@0.0.22`: MIT, official repository, 2025-01-26 release, maintainer, zero transitives, browser/CSP behavior, protected API/pre-1.0 risks, exact-pin controls, and alternatives. No dependency replacement occurred.

No Aegis decryption, Ente decryption/auth/sync, QR/image Task 5, or Task 10 backup behavior was added. No Git operation occurred.

### Round 1 GREEN and final verification evidence

**Direct command evidence:** Focused importer verification passed 9/9 files and 170/170 tests after static corrections. `pnpm typecheck`, `pnpm lint`, and focused Prettier over corrected source/tests, dependency review, and this ledger all exited 0.

**Direct command evidence:** `pnpm exec vitest run --maxWorkers=1 --reporter=json --outputFile=/tmp/shardpass-task94-r1-vitest.json` exited 0 with 177/177 passed test files and 1,187/1,187 passed tests.

**Direct command evidence:** `pnpm build:security` built 1,974 modules, passed 7/7 packaged security-output tests, and passed the production build scan. The existing Vite informational warnings about ignored dependency `use client` directives and the existing empty `main.tsx` chunk remained unchanged.

**Direct command evidence:** `pnpm dependencies` found no violations across 208 modules and 590 dependencies. `pnpm audit --prod` found no known vulnerabilities. Parser-source authority scans produced no console, network, camera, decryption/password, Ente credential/sync, or incomplete-work matches.

**Direct command evidence:** `node scripts/verify-reproducible-build.mjs` built twice and verified 15 files with identical SHA-256 bytes.

**Environment caveat:** Final commands ran with Node `v24.18.0` and pinned pnpm `10.14.0`. The project requires Node `>=22.14.0 <23`, so this remains development evidence and does not clear the official Node 22 gate.

**Round 1 self-review:** The official Ente shape is now the only Ente JSON discriminator; prior Task 4 lines describing typed Ente entries remain historical evidence explicitly superseded by this correction and are not current acceptance claims. The maintained tokenizer raw-number override is used instead of a custom lexer. Invalid envelope numbers fail globally; invalid Aegis entry numbers remain row-local malformed values. Aegis complete-field and UUID/icon/group checks precede mapping. No Task 5 or backup/decryption implementation was introduced.

Status: Task 9.4 correction round 1/5 passes its software gates under Node 24 development evidence; official Node 22 evidence remains open.

## Task 9.4 correction round 2/5 — current Aegis serializer and strict icons

Status: Implementation complete pending final round verification under Node 24 development evidence.

### Official serializer investigation

Current official source was read from `beemdevelopment/Aegis` master at commit `a9d45b3ade1eda43ea796c7d7546e0147275ba7c`, matching latest release v3.4.2 published 2026-02-24. `Vault.toJson()` always emits db version 3 fields `version`, `entries`, `groups`, and boolean `icons_optimized`. Commit `e59df63e94e68fdc826028599e26af5f408b83bd` introduced `icons_optimized` on 2025-01-05 without bumping db version 3; its parent serializer omitted the field, and current `fromJson()` tolerates absence as false. Task 4 scope is supported current official export, so the importer requires the field rather than widening support to historical v3 files.

Official `VaultEntryIcon.toJson()` writes null `icon` without MIME/hash properties in current source, while the existing Task 4 canonical contract requires the complete documented icon triplet. For non-null icons it emits padded Base64, MIME from exactly JPEG/PNG/SVG, and lowercase hex hash. `VaultEntryIcon.generateHash()` computes SHA-256 over UTF-8 MIME bytes followed by decoded icon bytes, not icon bytes alone. Round 2 validation follows this serializer semantics and verifies the hash locally before discarding icon metadata.

### Strict RED evidence

`pnpm exec vitest run packages/importers/test/aegis.test.ts` exited 1 with 35 failed and 11 passed tests after the round-2 assertions were added. The missing `icons_optimized` field was accepted, current canonical fixtures containing it were rejected as unknown, a valid 4,800-character icon hit the old global 4,096 string limit, MIME/hash constraints and hash mismatch were not enforced, and downstream canonical cases failed due to the db-key mismatch. This was the expected pre-correction RED.

### Corrections and focused GREEN

`DB_KEYS` now requires exact boolean `icons_optimized`. No undocumented optional compatibility was added; historical omission is recorded above rather than silently accepted.

The maintained tokenizer remains the JSON lexical owner. Its object-key state now records the pending key. String tokens named `icon` may use the encoded bound derived from `maxInputBytes`; all other JSON strings remain bounded to 4,096 Unicode scalars. Total input remains prebounded to 1 MiB/262,144 scalars before parsing, so no accepted icon can exceed the complete document bound. A valid encoded icon above 4,096 is accepted, a non-icon string above 4,096 rejects globally before mapping, and an icon above the total-derived encoded bound rejects before Base64 decode.

Non-null icons now require canonical padded Base64 decode/re-encode, decoded bytes within the input bound, exact MIME `image/jpeg`, `image/png`, or `image/svg+xml`, lowercase 64-hex hash, and SHA-256 equality over `UTF8(mime) || decodedIconBytes`. Decoded icon bytes and temporary hash material are synchronously filled with zero in finalizers as practical, without a JavaScript zeroization claim. Null icons still require null MIME/hash under the strict complete-field contract. Icon fields are validated but never mapped into candidates/previews.

`pnpm exec vitest run packages/importers/test/aegis.test.ts packages/importers/test/detect.test.ts` passed 2/2 files and 62/62 tests at focused GREEN.

No Task 5, Aegis decryption, Ente decryption/auth/sync, or backup behavior was added. No Git operation occurred.

### Round 2 final verification evidence

**Direct command evidence:** `pnpm typecheck`, `pnpm lint`, and focused Prettier all exited 0. The importer suite passed 9/9 files and 178/178 tests.

**Direct command evidence:** Full single-worker Vitest JSON output recorded 177/177 passed files and 1,195/1,195 passed tests. `pnpm build:security` built 1,974 modules, passed 7/7 packaged security-output tests, and passed the production scan. Existing Vite informational warnings about dependency `use client` directives and the existing empty chunk remained unchanged.

**Direct command evidence:** Dependency Cruiser found no violations across 208 modules and 592 dependencies. `pnpm audit --prod` found no known vulnerabilities. Parser authority scans produced no console, network, camera, decryption/password, Ente authority, or incomplete-work matches.

**Direct command evidence:** `node scripts/verify-reproducible-build.mjs` verified 15 output files with identical SHA-256 bytes across two builds.

**Round 2 self-review:** `icons_optimized` is required because support is scoped to the current official serializer; historical version-3 omission before the 2025 serializer change is documented but not accepted. The string exception is tokenizer-key-aware and limited to values of the `icon` property, while total text bounds remain first. Icon Base64 is decoded once through the maintained canonical helper, locally hashed using the existing Noble SHA-256 dependency with official MIME-prefix semantics, and all owned mutable icon/hash material is cleared in finalizers. Icon data does not enter candidates or preview metadata. No Task 5 behavior was introduced.

**Environment caveat:** Commands ran under Node `v24.18.0` and pnpm `10.14.0`; official Node 22 evidence remains open.

Status: Task 9.4 correction round 2/5 passes software gates under Node 24 development evidence.

## Task 9.4 correction round 3/5 — exact icon union and db-v3 compatibility

Status: Implementation complete pending final round verification under Node 24 development evidence.

### Official-source revalidation and supersession

Official current `VaultEntryIcon.toJson()` writes `icon: null` and omits both `icon_mime` and `icon_hash` when no icon exists. It emits all three fields only for a non-null icon. Therefore round 2's null-MIME/null-hash requirement was incorrect and is superseded here. Entry schema validation now uses an exact discriminated key union rather than one unconditional key list.

Official current `Vault.toJson()` emits `icons_optimized`, but current `Vault.fromJson()` uses `optBoolean("icons_optimized")` and defaults absence to false. The field was introduced without changing db version 3, and official prior db-v3 output omitted it. Therefore round 2's required-field cutoff was too narrow and is superseded here. Supported db-v3 accepts omission with false compatibility semantics; presence still requires an exact boolean, and unknown database keys remain rejected.

### Strict RED and GREEN evidence

`pnpm exec vitest run packages/importers/test/aegis.test.ts` exited 1 with 5 failed and 42 passed tests after round-3 tests/fixtures were added. Omitted `icons_optimized` rejected globally, and canonical official no-icon rows using only `icon: null` became malformed; this also invalidated valid/unsupported/boundary aggregate assertions. The failures directly demonstrated both stale round-2 assumptions.

The entry parser now requires base keys including `icon`, allows no MIME/hash keys when icon is null, and requires both exact MIME/hash keys when icon is non-null. Unknown keys reject under either branch. Database validation uses required `version/entries/groups` plus optional `icons_optimized`; if present it must be boolean. The parsed compatibility default is not exposed or mapped because this source metadata has no candidate semantics.

Focused GREEN: `pnpm exec vitest run packages/importers/test/aegis.test.ts` passed 1/1 file and 47/47 tests.

No Task 5, Aegis decryption, Ente authority/decryption, or backup behavior was added. No Git operation occurred.

### Round 3 final verification evidence

**Direct command evidence:** TypeScript, ESLint, and focused Prettier exited 0. Importer tests passed 9/9 files and 179/179 tests. Full single-worker JSON output recorded 177/177 passed files and 1,196/1,196 passed tests.

**Direct command evidence:** `pnpm build:security` built 1,974 modules, passed 7/7 packaged security-output tests, and passed the build scan. Dependency Cruiser reported no violations across 208 modules and 592 dependencies. `pnpm audit --prod` found no known vulnerabilities. Parser authority scans found no network, camera, logging, decryption/password, Ente authority, or incomplete-work matches.

**Round 3 self-review:** No-icon entries now match official serializer output exactly: `icon: null` with MIME/hash absent. Non-null icons require exactly icon/MIME/hash. Unknown entry keys reject in both branches. Database keys remain exact while `icons_optimized` is optional and boolean-only when present; absence follows official reader false compatibility semantics but is intentionally not projected because it has no OTP candidate meaning. Round 2 cutoff/null claims are historical and explicitly superseded by this section. No Task 5 code was added.

**Environment caveat:** Verification ran under Node `v24.18.0` with pnpm `10.14.0`; official Node 22 evidence remains open.

Status: Task 9.4 correction round 3/5 passes software gates under Node 24 development evidence.

## Task 9.4 correction round 4/5 — null-icon compatibility and plaintext headers

Status: Implementation complete pending final round verification under Node 24 development evidence.

### Official-source verification and supersession

Official current `VaultEntryIcon.toJson()` emits `icon: null` with MIME/hash absent, while official documentation describes all three icon fields and says MIME/hash are null when icon is null. Round 4 therefore supports exactly both official/documented null variants: icon alone, or icon plus both auxiliary fields set to null. Round 3's icon-alone-only claim is superseded. Partial auxiliary presence, one absent/one null, or any non-null auxiliary value with null icon remains malformed. The non-null icon branch is unchanged.

Official `VaultFile.Header.toJson()` emits both `slots` and `params` as null for plaintext. Official format documentation also shows an empty header object for a plaintext upper-level example, and `Header.fromJson()` treats an object where both names resolve as null as empty; `JSONObject.isNull` is true for missing keys. To remain deterministic rather than accepting arbitrary subsets, round 4 supports exactly `{}` and exactly `{ slots: null, params: null }`. One-key subsets, unknown keys, and non-null values are unsupported.

### Strict RED and focused GREEN

`pnpm exec vitest run packages/importers/test/aegis.test.ts` exited 1 with 2 failed and 53 passed tests. Empty header `{}` was rejected globally, and the documented null-icon triplet was rejected row-locally. Negative partial/non-null auxiliary and one-key/non-null/unknown header assertions already passed, isolating the two missing compatibility branches.

Production now chooses exact entry keys from a null-icon union: base keys alone or base plus both icon auxiliary keys; `validateIcon` then requires both auxiliary values null in the second branch. Header validation accepts only exact empty or exact both-null objects before confirming object `db`.

Focused GREEN: `pnpm exec vitest run packages/importers/test/aegis.test.ts` passed 1/1 file and 55/55 tests.

No Task 5, Aegis decryption, Ente authority/decryption, or backup behavior was added. No Git operation occurred.

### Round 4 final verification evidence

**Direct command evidence:** TypeScript, ESLint, and focused Prettier exited 0. Importer tests passed 9/9 files and 187/187 tests. Full single-worker JSON output recorded 177/177 passed files and 1,204/1,204 passed tests.

**Direct command evidence:** `pnpm build:security` built 1,974 modules, passed 7/7 packaged security-output tests, and passed the production scan. Dependency Cruiser found no violations across 208 modules and 592 dependencies. `pnpm audit --prod` found no known vulnerabilities. Parser authority scans found no network, camera, logging, password/decryption, Ente authority, or incomplete-work matches.

**Round 4 self-review:** Header acceptance is an exact two-shape union, not a loose subset test. Null-icon acceptance is also an exact two-shape union; partial auxiliary combinations cannot pass key validation or value validation. Non-null icon hash/Base64/MIME behavior remains unchanged. The round 3 icon-alone-only statement is superseded. No Task 5 behavior was introduced.

**Environment caveat:** Verification ran under Node `v24.18.0` and pnpm `10.14.0`; official Node 22 evidence remains open.

Status: Task 9.4 correction round 4/5 passes software gates under Node 24 development evidence.

## Task 5 — Bounded local QR/image decoding Worker

Date: 2026-08-11
Environment: Node `v24.18.0`, pnpm `10.14.0`, Linux 6.17.0-35-generic x64. This is development evidence only because the official Node range is `>=22.14.0 <23`; Chrome 110 packaged runtime evidence remains open.

### RED evidence

After reading Task 5/global constraints, current strict import detection, the hardened Google migration Worker client/handler patterns, manifest/CSP/build scanners, dependency policy, and Vite `chrome110` configuration, the command `pnpm exec vitest run packages/importers/test/qr.test.ts apps/extension/test/vault/image-import-executor.test.ts` exited 1. The executor suite could not resolve the unimplemented module and all four protocol tests failed because the requested exports did not exist. This was the expected feature-missing RED; no production QR code existed before it.

### Dependency review

Selected exact `jsqr@1.4.0`, pinned through the strict catalog and lockfile. Registry/package inspection identified Apache-2.0 licensing, official `cozmo/jsQR` repository, release date 2021-04-24, built-in declarations, zero runtime dependencies, and exact lockfile integrity. Source/package/build scans found no network, dynamic evaluation, WebAssembly, native code, or runtime asset loading. The package is old and no independent security-audit claim is made. Acceptance is limited to a single-use dedicated local module Worker with fixed protocol, bounds, cleanup, CSP/output scanning, and reproducible-build evidence. `docs/architecture/dependencies.md` records the review and rejected authority expansion.

### Implemented boundary

Added the strict request/response protocol and QR payload validator, parser routing, executor, Worker handler, capture-once Worker entry, explicit Vite worker asset, and tests. The vault executor accepts a browser-owned `Blob`/`File` through exact `decode(file: Blob, signal: AbortSignal): Promise<string>`; it checks the 8 MiB encoded size before reading or Worker creation, copies into an owned transferable, transfers only `{version, requestId, bytes}`, clears mutable main-thread views best-effort without claiming string zeroization, captures Worker methods once, enforces one terminal response, fixed 10-second maximum timeout, abort, wrong/stale-ID rejection, strict unknown-field rejection, fixed errors, listener cleanup, and termination.

The Worker admits exact PNG/JPEG/WebP magic only (not MIME trust), rejects SVG/GIF and other formats, uses `createImageBitmap` in the Worker to obtain metadata, checks safe positive integer width/height, 4,096 per-axis, and overflow-safe 16,777,216 total pixels before `OffscreenCanvas`/RGBA allocation, then reads pixels and invokes `jsQR`. It rejects no-QR and multiple-QR input deterministically, enforces one non-empty Unicode-scalar payload and 1 MiB UTF-8 bound, returns only bounded text or a fixed code, clears pixel/image buffers best-effort, closes the bitmap, and closes the Worker. No main-thread pixel decoding or unsupported fallback was added; unavailable Worker bitmap/canvas APIs return fixed `IMAGE_INVALID`.

No camera, clipboard, host, optional-host, offscreen, or network permission was added. The manifest still grants exactly `storage`, `alarms`, and `idle`; the extension CSP is byte-for-byte unchanged. Candidate strings necessarily cross from Worker to the trusted vault and cannot be zeroized; code drops references on settlement and does not log, reflect, persist, or render payloads.

### Verification evidence

Focused GREEN: 2/2 Task 5 test files and 12/12 tests passed. The final focused/security command passed 5/5 files and 94/94 tests, including manifest, CSP, and 79 build-scanner tests. TypeScript and ESLint exited 0. Focused Prettier passed. Dependency Cruiser passed across 215 modules and 607 dependencies.

`pnpm build:security` built 1,981 modules, emitted local `dist/assets/otpImportWorker-VKlC2tDX.js` (135,397 bytes), passed 7/7 packaged security-output tests, and passed the production scan. The Worker/source scan for camera/media capture, fetch/XHR/WebSocket, remote URL, `importScripts`, console logging, eval/Function, and WebAssembly returned no matches. `node scripts/verify-reproducible-build.mjs` reported 17 identical build files across two builds, including the identical QR Worker asset. `pnpm audit --prod` reported no known vulnerabilities.

The full regression `pnpm test` passed 179/179 files and 1,216/1,216 tests. The repository-wide `pnpm format:check` remains blocked by three pre-existing out-of-scope formatting findings (`.sdd/project1-task8-execution-ledger.md`, its Task 7 recovery ledger, and checked-in generated protobuf); focused Task 5 formatting is clean. The first security build attempt exposed a pre-existing Google-worker bundling interaction when the QR Worker imported the broad importer barrel; the correction split a narrow `qr-worker-protocol` export so the Worker no longer pulls Google decoding code. Focused tests, type/lint, packaged CSP scan, full regression, and reproducibility were rerun after correction.

### Self-review and scope gate

Critical/Important review: no open finding in Task 5. Bounds precede expensive work where Chrome permits; image dimensions/pixels are checked before canvas/RGBA allocation; protocol traversal and Worker methods are bounded/captured; only one response is accepted; late response and abort/timeout paths terminate; raw bytes/pixels/QR content are absent from errors/logs/DOM; packaged code remains local and CSP-compatible. Tests cover byte cap, dimensions, exact pixel boundary, corrupt/unsupported/non-QR/multiple-QR outcomes, payload bounds, strict parser routing, timeout, abort, hostile factory/messages, unknown fields, transfer cleanup, termination, and late response suppression. Browser-native synthetic QR generation/decoding under actual Chrome 110 remains a later packaged-browser evidence blocker; Task 8 owns broader packaged security scan/E2E expansion.

No Git/worktree/commit operation occurred. Task 6 was not started.

Status: Task 5 implementation and software gates pass under Node 24 development evidence; official Node 22 and actual Chrome 110 evidence remain open.

## Task 9.5 correction round 1/5 — encoded metadata preflight and honest QR cardinality

Date: 2026-08-11
Environment: Node `v24.18.0`, pnpm `10.14.0`, Linux x64. Node 24 remains development-only evidence; official Node 22 and actual Chrome 110 evidence remain open.

### Root cause and dependency decision

Review confirmed two Important issues in the original Task 5 evidence. First, `createImageBitmap` was the source of dimensions, so compressed image decoding occurred before dimension/pixel rejection even though RGBA allocation remained bounded. Magic signatures alone did not prove a complete, static, single-image stream. Second, `jsQR` returns one result; erasing its bounding box and scanning again was not a maintained multi-symbol detector and could not justify a deterministic multiple-QR rejection claim.

Registry/source review considered maintained browser metadata parsers. Exact `image-dimensions@2.5.1` is MIT, zero-dependency, browser-compatible, maintained at `sindresorhus/image-dimensions`, and released 2026-05-12. Exact `png-validator@2.0.0` is MIT, zero-dependency ESM from `samal-rasmussen/png-validator`, released 2023-11-16, and checks complete PNG chunk layout plus CRC. Exact `is-apng@1.2.0` is MIT, zero-dependency browser ESM from `vHeemstra/is-apng`, released 2024-08-13, and detects animation control before image data. All are exact-catalog/lockfile pinned with integrity; executable source and bundled output require no eval, WASM, network, native code, runtime asset, or CSP exception. Reviewed libraries did not provide equivalent complete static guarantees for WebP animation or JPEG MPO/additional streams, so support was reduced rather than overclaimed: only structurally valid static PNG is accepted; JPEG and WebP are rejected before bitmap decode.

### Strict TDD evidence

Actual offline-generated encoded PNG/JPEG/WebP fixtures were embedded only in tests with behavior-only names. The RED command `pnpm exec vitest run apps/extension/test/vault/image-import-executor.test.ts` exited 1 with 7/14 failures. Oversized-metadata PNG, APNG, truncated PNG, JPEG, and WebP all called `createImageBitmap` once instead of zero times; the first-result test observed two `decodeQr` calls. These failures directly reproduced both findings before production changes.

GREEN implementation performs `pngValidator`, APNG rejection, maintained `imageDimensionsFromData`, safe positive integer checks, 4,096 per-axis and overflow-safe 16,777,216 pixel checks before `createImageBitmap`. The resulting bitmap width and height must exactly equal preflight metadata before `OffscreenCanvas`/RGBA allocation. Unsupported, malformed, truncated, animated, and over-bound inputs return fixed codes with zero bitmap calls. `IMAGE_IMPORT_ACCEPTED_FORMATS` is now exactly `['png']`.

The erase/rescan behavior was removed. `jsQR` is invoked exactly once and its first deterministic result is returned. Images containing multiple symbols are explicitly unsupported; one first-decodable result may be selected and safe-previewed for explicit confirmation, and rejection/enumeration is not guaranteed. This is not represented as a security boundary.

### Verification evidence

Focused QR tests passed 2/2 files and 17/17 tests. The focused security gate passed 5/5 files and 99/99 tests. TypeScript, ESLint, focused Prettier, and Dependency Cruiser passed; Cruiser inspected 218 modules and 610 dependencies. `pnpm build:security` built 1,991 modules, emitted local `dist/assets/otpImportWorker-CeWrcmij.js` (141,819 bytes), passed 7/7 packaged security-output tests, and passed the production build scan.

The full regression passed 179/179 files and 1,221/1,221 tests. Reproducibility reported 17 identical files across two builds, including `otpImportWorker-CeWrcmij.js`. `pnpm audit --prod` reported no known vulnerabilities. Executable source/dependency/built-worker scans found no camera/media capture, runtime fetch/XHR/WebSocket, `importScripts`, production console logging, eval/Function, or WebAssembly. The only broader package-scan matches were non-executable README/type examples and the unbundled `image-dimensions` CLI; neither is imported or packaged, and the built scanner passed.

### Review and scope

The correction now rejects oversized encoded metadata before compressed decode; validates complete PNG structure/static status before bitmap creation; compares independent metadata and bitmap dimensions; allocates RGBA only after both checks; and honestly models jsQR's one-result behavior. Raw image/pixel/QR values remain absent from responses other than the bounded trusted-vault payload, logs, errors, and DOM. Permissions/CSP remain unchanged. No Git/worktree/commit operation occurred. Task 6 was not started.

Status: correction round 1/5 passes software gates under Node 24 development evidence; official Node 22 and actual Chrome 110 blockers remain open.

## Task 9.5 correction round 2/5 — native PNG track/frame boundary

Date: 2026-08-11
Environment: Node `v24.18.0`, pnpm `10.14.0`, Linux x64. Node 24 remains development-only; actual Chrome 110 evidence remains open.

### Root-cause and research evidence

Direct source inspection and an actual encoded duplicate-IHDR fixture proved `png-validator@2.0.0` accepted a second IHDR. Its source also advances over unknown ancillary CRC without calculating it, accepts non-exact IHDR/IEND lengths, does not enforce all legal bit-depth/color combinations or complete PLTE/contiguous-IDAT ordering, and stores parse state in module globals. Therefore round 1's “complete chunk layout plus CRC” and “structurally valid” claims were false. `is-apng@1.2.0` itself documents only quick detection and warns against integrity-sensitive use. No manual PNG wire/chunk parser was written.

Registry/package research found no maintained exact-pinnable browser parser that exposed the complete requested non-pixel PNG structure contract without incomplete checks, pixel decompression, Node-oriented machinery, or an unsuitable broader surface. `pngjs` is mature but its browser build is a full pixel decoder and its documented parser support/ordering contract is not the requested lightweight preflight. Consequently the implementation moved to the native WebCodecs boundary rather than composing weak parsers.

MDN, Can I Use, and TypeScript's Worker Web API declarations confirm `ImageDecoder` support in Chrome since 94 and availability in dedicated workers, covering minimum Chrome 110. Worker types expose complete buffering, track readiness, selected track `animated`/`frameCount`, complete-frame decode, and closable `VideoFrame`. Native parsing remains a browser attack surface and acceptance authority; no independent PNG CRC/chunk-order guarantee is claimed.

### Strict TDD and implementation evidence

Tests were rewritten against the wished-for native dependency contract before production changes. RED command `pnpm exec vitest run apps/extension/test/vault/image-import-executor.test.ts` exited 1 with 4 failures: the new decoder factory and frame decode were never called, first-result QR was not reached, and non-QR returned the wrong fixed result. Actual offline encoded fixtures cover static PNG, APNG, duplicate IHDR, bad CRC, truncation, oversized dimensions, JPEG, and WebP. Native metadata rejection is asserted to occur before pixel `decode()` for malformed/unsupported fixtures; track animation and frame-count rejection are likewise pre-pixel. Tests also cover incomplete decode and dimension disagreement.

Production now retains only exact `image-dimensions@2.5.1` for a bounded PNG signature/IHDR width/height read and pre-native 4,096-axis/16,777,216-pixel rejection. `png-validator` and `is-apng` were removed from the extension package, strict catalog, install, and lockfile. The dedicated Worker constructs `ImageDecoder` only after the preflight bound, awaits `completed` and `tracks.ready`, requires complete input, one track, one selected non-animated frame, then decodes frame zero with `completeFramesOnly`. It requires a complete result and exact coded/display/preflight dimensions before `OffscreenCanvas`/RGBA readback. Decoder, frame, bytes, and pixels are cleaned in independent `finally` paths; unsupported `ImageDecoder` returns fixed `IMAGE_INVALID` with no `createImageBitmap` or main-thread fallback.

### Documentation and residual-risk correction

`docs/architecture/dependencies.md` now records the validator gaps/removal, failed maintained-library search, Chrome 94+/Worker compatibility, native boundary, and absence of CRC claims. `docs/security/threat-model.md` and `docs/security/invariants.md` now describe static-PNG-only input; local-only/no-camera/no-network authority; encoded/dimension/pixel/time bounds; native ImageDecoder/VideoFrame/OffscreenCanvas residual attack surface; exact one-frame checks; jsQR first-result ambiguity for multiple symbols; strict fixed errors; and best-effort cleanup without physical-zeroization claims.

Round 1 ledger lines remain historical evidence and are superseded wherever they claim complete validation, APNG detector authority, or `createImageBitmap` flow.

### Verification evidence

Focused/security command passed 6/6 files and 119/119 tests, including 17 image executor tests, manifest/CSP, docs, and 79 build-scanner tests. TypeScript, ESLint, focused Prettier, and Dependency Cruiser passed; Cruiser inspected 216 modules and 608 dependencies. `pnpm build:security` built 1,989 modules, emitted `dist/assets/otpImportWorker-DRw9-QxK.js` (138,775 bytes), passed 7/7 packaged output tests, and passed build scan.

Full regression passed 179/179 files and 1,223/1,223 tests. Reproducibility reported 17 identical files, including the Worker. Production audit reported no known vulnerabilities. Source/lock scan confirmed no `png-validator` or `is-apng` dependency remains. Source/built-worker authority scan found no camera, runtime network, dynamic evaluation, WASM, `importScripts`, production logging, or `createImageBitmap` path.

### Review and scope

The implemented claim is deliberately narrow: an inexpensive maintained IHDR dimension bound precedes native parsing; Chrome's native complete one-track/one-frame decode is the malformed/static acceptance boundary; PNG CRC and complete wire conformance are not independently guaranteed. No raw image/pixel/QR value is logged, reflected in fixed errors, or projected to DOM. Permissions/CSP remain unchanged. No Git/worktree/commit operation occurred. Task 6 was not started.

Status: correction round 2/5 passes software gates under Node 24 development evidence; official Node 22 and actual Chrome 110 blockers remain open.

## Task 9.5 correction round 3/5 — native allocation claim precision

Date: 2026-08-11
Scope: documentation and ledger only; no product, test, dependency, manifest, or build configuration code changed. Task 6 was not started.

Round 2 correctly removed false PNG structural/CRC claims but still described the IHDR bound and native decoder sequence too strongly. `image-dimensions` reads the PNG signature and first IHDR dimensions only; it does not establish that IHDR is unique or that later encoded data agrees. `ImageDecoder` can parse, process, or allocate native resources during constructor execution, `completed`, or `tracks.ready`, before the explicit `decode()` and before ShardPass can compare returned frame dimensions. Duplicate or conflicting IHDR metadata could therefore cause native processing/allocation based on larger dimensions before a mismatch is rejected.

`docs/architecture/dependencies.md`, `docs/security/threat-model.md`, and `docs/security/invariants.md` now distinguish the controls precisely. The 8 MiB encoded-byte cap, dedicated single-use Worker, ten-second termination, browser-native limits, and cleanup mitigate native-decoder exposure but do not strictly bound its allocation, decompression work, or memory-safety surface. The 4,096-axis/16,777,216-pixel check strictly bounds only the later ShardPass-owned `OffscreenCanvas` and JavaScript-visible RGBA allocation after a complete one-track/one-frame result whose coded/display dimensions match the first-IHDR preflight.

No CRC, complete structural-validation, unique-IHDR, or hard native-memory-bound claim is made. Static-PNG-only, no camera/network, fixed errors, jsQR first-result ambiguity, and no physical-zeroization claims remain unchanged. Round 2 ledger statements referring generically to an “IHDR dimension bound” are superseded by this first-IHDR/native-allocation clarification.

Verification: focused Prettier passed for all four changed documentation/ledger files. Security documentation/CSP/manifest tests passed 3/3 files and 19/19 tests. The stale-overclaim scan found no assertion of strict/hard native allocation bounds, complete PNG validation, every-CRC validation, or authoritative/unique IHDR; the positive precision scan located first-IHDR, construction/`completed`/`tracks.ready`, non-strict-native-bound, `OffscreenCanvas`, and JavaScript-visible RGBA language in the corrected dependency, threat-model, invariant, and ledger text. No Git/worktree/commit operation occurred.

Status: documentation-only correction round 3/5 passes its focused gate; Node 22 and actual Chrome 110 blockers remain open.

## Task 9.5 correction round 4/5 — permissions-document claim alignment

Date: 2026-08-11
Scope: documentation and ledger only; no product, test, dependency, manifest, or build configuration code changed. Task 6 was not started.

The round 3 stale-claim scan omitted `docs/architecture/permissions.md`, which still described Task 9.5 input as “structurally validated static PNG.” That wording contradicted the corrected native acceptance boundary and made the prior global-scan statement incomplete. The permissions document now says the trusted vault page accepts browser-provided local Blob/File bytes and decodes native-accepted, one-track/one-frame PNG locally in a dedicated module Worker. It explicitly states that browser-native decoding is the acceptance boundary, not independent structural or CRC validation.

Verification: focused Prettier passed for the permissions document and this ledger. Security documentation/CSP/manifest tests passed 3/3 files and 19/19 tests. A global stale-claim scan covered every Markdown document, including `.sdd` ledgers: the only obsolete positive claim is preserved as superseded round 1 historical evidence at line 705, while later ledger corrections explicitly retract it; the other matches are negations, residual-risk statements, or this correction's quotation of the removed wording. No active documentation makes the stale structural/CRC or strict native-allocation claim. A positive scan confirmed the corrected native-accepted, one-track/one-frame Worker wording in `docs/architecture/permissions.md`. No Git operation occurred, and Task 6 was not started.

Status: documentation-only correction round 4/5 passes its focused gate; Node 22 and actual Chrome 110 blockers remain open.

## Task 9.6 — strict vault-only messaging and session-owned atomic batch import

Date: 2026-08-11
Environment: Node `v24.18.0`, pnpm `10.14.0`, Linux x64. Node 24 evidence is development-only; official Node 22 and actual Chrome 110 evidence remain open.
Scope: Task 6 only. No Task 7 UI, Git, worktree, commit, backup, autofill, sync, camera, or network behavior was added.

### Contract decision and RED evidence

The newer operator instruction superseded the supplement's raw-text background request shape: trusted full-vault page/Worker parsing remains outside Task 6, while background preview accepts only strict bounded normalized candidates. Candidate secrets cross only the document-bound vault runtime, matching existing CRUD precedent. Confirmation carries one opaque token and no candidates or password. Responses contain only safe rows/counts/fixed classifications; no secret, note, tags, favorite, root, fingerprint, internal error, or full item is projected.

Strict TDD RED commands established each missing boundary before implementation:

- `pnpm exec vitest run packages/messaging/test/otp-import.test.ts` failed because `packages/messaging/src/otp-import.ts` did not exist.
- `pnpm exec vitest run packages/storage/test/vault-repository.test.ts` failed two new tests because `VaultRepository.importOtpItems` did not exist.
- `pnpm exec vitest run apps/extension/test/background/session-vault-repository.test.ts` failed because the stable bridge had no `importOtpBatch` capability.
- `pnpm exec vitest run apps/extension/test/background/otp-import-service.test.ts` failed because the import service did not exist.
- `pnpm exec vitest run apps/extension/test/background/router.test.ts` failed two import routing/projection tests with `INVALID_MESSAGE`.
- `pnpm exec vitest run apps/extension/test/platform/chrome-platform.test.ts` failed because `sendOtpImportMessage` did not exist.
- A later repository RED proved an unchanged duplicate-only confirmation incorrectly activated an empty new generation; the focused test failed by showing a changed active root and staged keys.

### Implementation and security boundaries

Messaging now defines strict version-1 `otp.importPreview`, `otp.importConfirm`, and `otp.importCancel` requests. Preview requires 1–1,000 strict candidates and a fixed source format; confirm/cancel accept only a UUID token. All commands are exact vault-only/document-required sender policy. Router authorization uses browser-normalized extension ID, exact vault URL, and `documentId`; popup/content/extra-field requests fail before service invocation. Router and Chrome platform project/reparse command-paired responses. Fixed safe errors are `OTP_IMPORT_INVALID`, `OTP_IMPORT_LIMIT`, `OTP_IMPORT_EXPIRED`, `OTP_IMPORT_CAPACITY`, and `OTP_IMPORT_UNAVAILABLE`.

The singleton import service owns in-memory candidates by opaque preview token and exact extension URL/document binding. It applies five-minute expiry, four previews per document, destructive one-use confirmation, idempotent non-disclosing cancel, bounded eviction, lock/session cleanup, disposal cleanup, safe preview classification against one authenticated item snapshot, and post-success best-effort activity. Preview/cancel/failure perform no repository mutation or activity write. A changed confirm-time classification returns a fresh safe `otp.importPreviewChanged` capability requiring explicit reconfirmation; it never silently persists or skips a status-changed row.

`SessionVaultRepository` exposes only `importOtpBatch(candidates, expectedStatuses)`. Under the existing session mutex and epoch/root activation coordinator, `VaultRepository.importOtpItems` authenticates one active generation, validates 1–1,000 candidates, enforces the 10,000-record bound, reclassifies exact semantic duplicates including HOTP counter and NFKC issuer/label, aborts without mutation when any classification changed, assigns background IDs/timestamp/revision 1 only to accepted rows, preserves metadata/HOTP pending/receipts, appends one journal create entry per imported item, and commits through one stage/verify/activate call. Unchanged duplicate-only batches now return without staging. Existing session activation reconciliation remains the authority for ambiguous write/activation failure and external-root/lock races; no caller root/context/CAS capability was introduced.

A packaged security RED then showed that importing the broad importer barrel pulled pinned protobuf runtime code (`globalThis[Symbol.for(...)]`) into the service worker and triggered `computed-global-dynamic-code-access`. Root-cause correction added the narrow `@shardpass/importers/import-model` export and imports only that pure module. The dedicated Google worker remains separate; the packaged security build then passed.

### GREEN and review evidence

Final Task 6 focused gate passed 7/7 files and 95/95 tests. TypeScript and ESLint passed. Focused Prettier passed for every Task 6 file. Dependency Cruiser passed with 220 modules and 619 dependencies. The messaging/storage/security/background/platform regression passed 38/38 files and 713/713 tests. The full project regression passed 181/181 files and 1,233/1,233 tests.

`pnpm build:security` built 1,991 modules, passed 7/7 packaged manifest/CSP tests, and passed the production build scan. The service-worker graph contains the narrow `import-model` chunk rather than the Google protobuf Worker runtime. Boundary scans found no production log or network sink; `secret` matches are confined to the strict candidate request and private service/repository conversion and do not occur in responses.

Self-review traced candidate input from strict document-bound parsing to private snapshot, copied repository request, encrypted generation, and synchronous snapshot-array cleanup. Preview tokens are memory-only, restart-invalidated, bound to the exact document, capped, expired, consumed before commit, and never persisted. Confirm-time status changes produce no write and a new preview. Repository import performs one authenticated load and one commit for nonempty accepted batches, preserves generation metadata/receipts/pending state, and uses existing fail-closed session epoch/root coordination. No Task 7 source was created or modified. No Git operation occurred.

Status: Task 6 software implementation and development gates pass under Node 24. Official Node 22 and actual Chrome 110 evidence remain open for final Task 9 acceptance.

## Task 9.6 correction round 1/5 — replacement ownership and complete capacity accounting

Date: 2026-08-11
Environment: Node `v24.18.0`, pnpm `10.14.0`, Linux x64. Node 24 remains development-only; official Node 22 and actual Chrome 110 evidence remain open.
Scope: Task 6 correction only. No Task 7 UI or Git operation occurred.

### Root causes and strict RED evidence

Three related ownership/capacity gaps were reproduced. First, `otp.importPreviewChanged` spread the consumed snapshot and therefore reused its candidate array; the `finally` cleanup cleared the newly stored replacement, so its token could not complete confirmation. Second, repository capacity checked submitted candidate count before duplicate classification and only record count, while final generations include retained records, compacted journal, receipts, and metadata. Third, preview accounting was only per document; many documents and destructively claimed confirmations could retain unbounded candidate arrays concurrently.

`pnpm exec vitest run apps/extension/test/background/otp-import-service.test.ts` exited 1 at RED because the requested private candidate observer was absent: zero observed snapshots proved there was no test seam for eviction cleanup. The expanded end-to-end changed-preview test would also fail before correction because its replacement candidate array was cleared with the consumed original. The service tests cover 32 documents, oldest global eviction with synchronous candidate-array clearing, 32 concurrent in-flight confirmations, fixed capacity rejection when no pending snapshot is evictable, successful replacement confirmation, and second-use expiry.

`pnpm exec vitest run packages/storage/test/vault-repository.test.ts` exited 1 with two failures. The wished-for complete preflight helper did not exist, and a 998-duplicate plus two-accepted batch under an injected five-entry generation ceiling committed instead of rejecting. This proved classification/full-entry preflight did not precede ID/time/encryption/write work.

### Corrections

Changed-preview replacement now creates a new candidate array, deep-copies each candidate, copies and freezes each tags array, owns an independent statuses array/token/sequence, inserts that replacement, and only then allows `finally` to clear the consumed original. The replacement confirms end-to-end once and replay returns fixed expiry.

`IMPORT_LIMITS.maxLivePreviews` is 32. The service uses an explicit monotonic sequence for per-document and global oldest-pending eviction. Global accounting is `pending previews + in-flight confirmations`; in-flight snapshots are never evicted. If all 32 slots are in flight, a new preview fails with fixed `OTP_IMPORT_CAPACITY`. Confirm claims move from pending to in-flight before the first await and leave in-flight only in `finally`. Lock/disposal increments a private service generation so an in-flight operation cannot publish a changed preview or success after session invalidation; repository session epoch/root checks remain the commit authority. The private optional observer exposes only owned candidate-array identity to tests and is not part of messaging or public runtime authority.

Repository import now loads/authenticates and classifies all candidates first, compares expected statuses, then preflights capacity using only accepted count. `preflightOtpImportGenerationCapacity` computes final records, compacted journal (`min(maxJournalEntries, current + accepted)`), retained receipts, and retained metadata through shared `generationEntryCount`. It runs before clock, ID, journal encryption, record encryption, staging, or storage writes. Tests inject a smaller generation ceiling to prove two accepted rows fail with zero ID calls, zero clock calls, unchanged storage/root, while a maximum 1,000-row batch containing 999 duplicates and one accepted row succeeds when the complete final generation exactly fits.

The requested literal `9,999 existing records + 999 duplicates + 1 accepted succeeds exactly` cannot coexist with the mandatory create-journal entry and the 10,000 total-generation-entry cap: 10,000 records plus at least one journal entry is 10,001. No answer was supplied to the clarification gate, so the security-preserving interpretation governs: 9,999 records plus one accepted fails before IDs/writes, while the exact empty-journal success boundary is 9,998 records plus one accepted record plus one create journal entry = 10,000 total entries. Additional tests cover receipts/metadata and journal-compaction accounting.

### GREEN and verification evidence

Focused service/storage correction passed 2/2 files and 36/36 tests. Final Task 6 focused gate passed 7/7 files and 99/99 tests. TypeScript, ESLint, focused Prettier, and Dependency Cruiser passed; Cruiser inspected 220 modules and 619 dependencies. Messaging/storage/security/background/platform regressions passed 38/38 files and 717/717 tests. Full regression passed 181/181 files and 1,237/1,237 tests.

`pnpm build:security` built 1,991 modules, passed 7/7 packaged manifest/CSP tests, and passed the production build scan. No Task 7 source changed. No Git/worktree/commit action occurred.

Status: Task 9.6 correction round 1/5 passes software gates under Node 24 development evidence; official Node 22 and actual Chrome 110 blockers remain open.

## Task 9.6 correction round 2/5 — synchronous reservations and layered candidate ownership

Date: 2026-08-11
Environment: Node `v24.18.0`, pnpm `10.14.0`, Linux x64. Node 24 remains development-only; official Node 22 and actual Chrome 110 evidence remain open.
Scope: Task 6 correction only. No Task 7 UI or Git/worktree/commit action occurred.

### Root causes and strict RED evidence

Round 1 registered previews only after `listItems()` returned, so concurrent creating previews were absent from the global cap and lock cleanup. Its pending global-cap policy evicted unrelated documents, allowing a requester to displace another sender. Confirming snapshots remained outside synchronous lock cleanup, and tokens used one unchecked `nextId()` call without collision handling. Although the service passed a deep copy to the session bridge, ownership and cleanup of the bridge/repository copy were implicit rather than enforced by the bridge.

`pnpm exec vitest run apps/extension/test/background/otp-import-service.test.ts` exited 1 with four focused failures. A 33rd unrelated-document preview succeeded instead of fixed capacity rejection; forty gated `listItems` calls produced zero registered candidate arrays while awaiting; lock left a confirming service candidate array populated; and an in-flight token collision was reused rather than retried. These failures directly reproduced the creating/global-accounting, synchronous cleanup, and token-collision gaps.

`pnpm exec vitest run apps/extension/test/background/session-vault-repository.test.ts` exited 1 because clearing the caller source array before the mutation caused `VAULT_INVALID`, proving the session bridge did not take an independent batch copy synchronously.

### Corrections

The import service now uses one private operation map for `creating`, `pending`, and `confirming` states. Each operation owns token, deep-copied/frozen candidates and tags, statuses, exact sender/document key, session generation, monotonic sequence, expiry, and state. A preview reserves its global slot and unique token synchronously before `listItems`; candidates are observable to the private test seam at reservation. After every service await, exact operation identity, session generation, and disposal state are checked before classification changes or response publication. Lock/dispose increments generation, clears candidate arrays for every state synchronously, removes creating/pending records, and leaves only empty confirming records until their await settles.

Global capacity is creating + pending + confirming, maximum 32. Per-document pressure first evicts that exact document's oldest creating/pending operation. At global capacity, the requester is rejected with fixed `OTP_IMPORT_CAPACITY`; unrelated documents are never evicted. Tests gate forty concurrent list snapshots: exactly 32 reserve candidate-bearing operations, eight reject capacity with cleared candidates, lock clears all 40 observed arrays, and no request publishes after invalidation.

Confirmation changes ownership before the first repository await: the service makes an independent repository-bound deep copy, marks the operation confirming, and clears its own candidate array immediately. Lock therefore redacts the service layer synchronously without modifying the repository-bound copy. The session bridge now synchronously deep-copies candidates and tags again, owns statuses, executes the mutation under existing session mutex/epoch/root coordination, and clears its owned arrays in `finally`. Tests prove clearing the caller source/tags immediately does not affect commit and the observed session-owned array is empty after completion. Existing session coordination rejects lock before an uncommitted activation and reconciles ambiguous activation safely.

Token allocation performs at most 16 attempts, accepts only UUID-shaped values, and rejects collisions against the complete operation map, including creating, pending, and confirming tokens. Exhaustion clears the newly reserved candidates and returns fixed `OTP_IMPORT_UNAVAILABLE`. Changed-preview replacement uses the same allocator and capacity policy after removing the consumed confirming record. Row IDs also receive bounded UUID validation. Tests cover pending/in-flight collision retry, distinct replacement token ownership, exhaustion cleanup, and one-use confirmation.

### GREEN and verification evidence

Round 2 focused service/session tests passed 2/2 files and 28/28 tests. Final Task 6 focused gate passed 7/7 files and 103/103 tests. TypeScript, ESLint, focused Prettier, and Dependency Cruiser passed; Cruiser inspected 220 modules and 619 dependencies. Messaging/storage/security/background/platform regressions passed 38/38 files and 721/721 tests. Full regression passed 181/181 files and 1,241/1,241 tests.

`pnpm build:security` built 1,991 modules, passed 7/7 packaged manifest/CSP tests, and passed the production build scan. No Task 7 source changed. No Git operation occurred.

Status: Task 9.6 correction round 2/5 passes software gates under Node 24 development evidence; official Node 22 and actual Chrome 110 blockers remain open.

## Task 9.6 correction round 3/5 — immediate bridge capture cleanup and identity-safe reuse

Date: 2026-08-11
Environment: Node `v24.18.0`, pnpm `10.14.0`, Linux x64. Node 24 remains development-only; official Node 22 and actual Chrome 110 evidence remain open.
Scope: Task 6 correction only. No Task 7 UI or Git/worktree/commit action occurred.

### Root causes and strict RED evidence

Round 2 retained the service's repository-bound candidate copy for the entire repository await even though the session bridge already guarantees a synchronous deep copy before its first await. It also kept empty confirming operation records in the map after lock/dispose. Those records unnecessarily consumed all 32 slots and prevented token reuse until potentially hung repository promises settled. Finally, old confirmation finalizers deleted by token alone, so reusing a token after invalidation could let a late old finalizer delete the new operation.

`pnpm exec vitest run apps/extension/test/background/otp-import-service.test.ts` exited 1 with two new failures. The first observed that the service copy still contained one candidate immediately after synchronous bridge capture. The second created 32 hung confirmations, locked, and then received `OTP_IMPORT_CAPACITY` instead of reserving a new preview, proving confirming records remained counted after invalidation.

### Corrections

Confirmation now creates the repository-bound deep copy, invokes `importOtpBatch` synchronously inside an inner `try`, captures the returned promise, and clears that service copy in the matching `finally` before awaiting it. A separate short-lived trusted retained copy supports confirm-time reclassification/replacement and is cleared in the outer finalizer. Synchronous bridge throws and future bridge changes still clear both copies. Tests prove that immediately after the bridge returns, the service copy is length zero while the bridge-owned deep copy remains intact behind a gated repository promise.

`clearForSession` and `dispose` now synchronously clear candidate arrays and remove every operation record, including confirming operations. This releases all 32 global slots immediately. Session generation still invalidates every old result, while the session repository's epoch/root coordination governs whether an uncommitted mutation may activate and reconciles ambiguous commits safely.

Confirmation finalizers now remove an operation only when `operations.get(token) === operation`. Tokens can therefore be reused after lock/dispose, and a late old finalizer cannot delete the replacement operation with the same token. Tests create 32 hung confirmations, lock, reserve a new preview immediately, deliberately reuse an old token, settle the old promise, and prove the new operation remains consumable.

### GREEN and verification evidence

Round 3 focused service tests passed 1/1 file and 10/10 tests. Final Task 6 focused gate passed 7/7 files and 105/105 tests. TypeScript, ESLint, focused Prettier, and Dependency Cruiser passed; Cruiser inspected 220 modules and 619 dependencies. Messaging/storage/security/background/platform regressions passed 38/38 files and 723/723 tests.

The first full regression attempt had one timing-sensitive failure in the unrelated pre-existing `MigrationPanel.dom.test.tsx`; the isolated file immediately passed 3/3, and an unchanged full rerun passed 181/181 files and 1,243/1,243 tests. No migration or UI source was modified. `pnpm build:security` built 1,991 modules, passed 7/7 packaged manifest/CSP tests, and passed the production build scan.

No Task 7 source changed. No Git operation occurred.

Status: Task 9.6 correction round 3/5 passes software gates under Node 24 development evidence; official Node 22 and actual Chrome 110 blockers remain open.

## 2026-08-11 Task 7 — safe full-vault import UI

**Scope:** Task 7 only. No browser E2E/Task 8, Git, worktree, commit, popup/content import, camera, clipboard read, backup, sync, or network behavior.

**RED command:** `pnpm exec vitest run apps/extension/test/vault/OtpImportView.dom.test.tsx apps/extension/test/vault/OtpVaultView.dom.test.tsx apps/extension/test/vault/VaultApp.dom.test.tsx apps/extension/test/vault/VaultApp.styles.test.ts`

**RED result:** exited 1 as expected. The new DOM suite could not resolve the intentionally absent `OtpImportView`; the three existing suites passed 27/27 tests. This demonstrates the import UI/integration production surface was absent before implementation.

**Task 7 GREEN and review evidence:** The focused Task 7/import/parser/platform gate passed 20/20 files and 268/268 tests. This includes 8 import DOM/state tests, existing OTP CRUD/delete/revision tests, MigrationPanel tests, axe serious/critical checks, image executor bounds, strict import messaging, all text formats, Google async Worker behavior, and emitted responsive/reduced-motion CSS contracts. Focused Prettier, workspace TypeScript, ESLint, and dependency-cruiser (224 modules / 633 dependencies) passed under installed Node 24.18.0 with the expected unsupported-engine warning; official Node 22 was not available.

The UI is full-vault-only and integrated as an OTP toolbar mode. It preserves the existing list/editor/delete workspace and the separate MigrationPanel. Raw text is an uncontrolled local ref with hardened attributes and default visual concealment; file names are never read/rendered; PNG MIME/size is checked before executor decode; parser candidates are sent only by typed `sendOtpImportMessage`; textarea/file controls clear before awaiting preview publication; late operations are epoch-ignored; abort and cleanup use layout-effect lock/unmount cleanup; preview DOM contains only safe metadata/classification rows and fixed local rejection rows; confirmation carries only the preview token and requires an explicit unchecked review control; changed previews reset review; success refreshes existing CRUD once and reports only the fixed imported count. No popup/content/camera/clipboard-read/network/Task 8 behavior was added.

**Full/security caveats:** `pnpm test` ran 1,257 tests; 1,255 passed and two pre-existing build-heavy `VaultApp.styles.test.ts` cases timed out at their fixed 5-second limit only under the full parallel suite. The same complete style file passes 3/3 in the focused gate. `pnpm build:security` builds successfully but the existing executable-policy scan fails on two `@bufbuild/protobuf` `globalThis[Symbol]` text-encoding cache accesses in the generated Google Worker and vault bundles (`computed-global-dynamic-code-access`). This dependency/scanner integration predates Task 7 UI and requires Task 8 security-policy evidence/correction; it is not suppressed here. No Task 8 browser E2E was run or implemented.

**Self-review:** No secret/raw URI/note/tag/favorite/file-name value is rendered, used as a key, status, accessible name, or error. The only `tags` source match is the required candidate transport copy; no console/network/camera/clipboard source match exists in the new UI. Lock/unmount cleanup was changed to `useLayoutEffect` so redaction runs synchronously before paint. A missing parser-rejection projection was found during review, captured with a genuine RED test, and corrected as fixed safe rows/counts without raw data. No Critical or Important Task 7 finding remains. No Git/worktree/commit operation occurred. Task 8 was not started.

## 2026-08-12 Task 9.7 correction round 1/5

Scope: correction of five Task 7 findings only; no Task 8 browser E2E, Git, worktree, commit, camera, clipboard-read, sync, backup, or network behavior.

**TDD RED evidence:** narrow executable-policy test rejected the audited protobuf registry pattern; security build failed on both Worker and vault `globalThis[Symbol]`. Deferred-parser DOM test retained textarea input synchronously. Messaging rejected `sourceOrdinal`; all-rejected parsing produced an error; interleaved rows rendered accepted rows before local rejected rows. Image deferred-read test showed abort/timeout settled but late buffers were not cleared. These failures were observed before corrections.

**Corrections:** Split the direct Google decoder into `google-migration-direct.test-helper.ts`; `google-migration-input.ts` no longer imports the generated decoder, and synchronous detection routes migration to the async Worker path. The vault bundle now contains no `@bufbuild`, generated schema, proto3, protobuf text registry, or computed `globalThis[...]`; only the dedicated Google Worker carries the pinned protobuf runtime. Executable policy now allows exactly a non-invoked `globalThis[key]` access where `key` resolves to `Symbol.for("@bufbuild/protobuf/text-encoding")`; other symbols, dynamic names, invocation, eval, Function, and arbitrary computed globals remain rejected.

The UI now copies raw textarea content and clears textarea/file controls in the same click stack before bounds or parser work. Import candidates carry bounded `sourceOrdinal` in the strict runtime request; parsers assign source positions and background classification preserves them. Local rejected and background safe rows merge and sort by source ordinal into one <=45-row window. All-rejected imports create a tokenless local preview with confirm disabled and no runtime request.

Hook work is held in one explicit owned-job ref. Disposal synchronously aborts and nulls text, File, decoded payload, candidate collection, request collection, token/rows through state reset, and array contents where mutable. Promise continuations close only over the owner whose slots are empty after disposal. Import request arrays are cleared immediately after the platform invocation; the Chrome platform starts `sendMessage` synchronously and validates through a non-async promise chain. Image ownership drops its File slot immediately after executor invocation.

The image executor installs its abort listener and overall timeout before beginning `arrayBuffer`; abort/timeout settles a never-resolving read, late buffers are cleared, and no Worker is created. Existing worker transfer, hostile-object, decode, timeout, and abort tests remain passing.

**Verification:** focused correction gate passed 21/21 files and 283/283 tests; TypeScript, ESLint, and dependency-cruiser passed (225 modules / 635 dependencies). Security build passed 2/2 files and 7/7 output tests, then build scan passed. Direct bundle inspection found no forbidden protobuf/runtime markers in `dist/assets/vault-*.js`. Reproducible-build verification passed with identical first/second trees. Full Vitest executed 1,263 tests: 1,260 passed; the only failures were two pre-existing 5-second Vite CSS-build timeouts and one unrelated MigrationPanel effect timing assertion under full parallel load; the same complete affected files pass 42/42 in isolation, and the complete focused correction gate passes. Installed Node 24.18.0 remains development-only; official Node 22 was unavailable.

No Critical or Important correction finding remains. No suppression of arbitrary computed global access was added. No Task 8 work occurred.

## 2026-08-12 Task 9.7 correction round 2/5

Scope: two Task 7 correction findings only; no Task 8 browser E2E, Git, worktree, commit, camera, clipboard-read, sync, backup, or network behavior.

**TDD RED:** executable-policy tests demonstrated the prior literal-only exception incorrectly allowed the audited registry in an unrelated vault file and did not enforce the exact access count/shape. Additional RED cases covered altered access counts, other/dynamic symbols, multi-hop declaration/assignment aliases, invocation, and computed destructuring. Messaging accepted duplicate candidate `sourceOrdinal`; hook tests showed duplicate candidate ordinals and candidate/rejected collisions could reach transport/merge.

**Security correction:** general executable scanning again rejects the protobuf registry pattern everywhere unless the caller supplies a root-scoped `.shardpass-executable-audit.json` naming one exact file. Output security evidence finds exactly one JavaScript asset containing the pinned registry literal, requires its hashed path to match the dedicated `google-migration-worker-entry-*` Worker asset, verifies the emitted vault bundle points to that exact Worker URL, then supplies the ephemeral audit binding before the recursive scan. The scanner requires exactly one audited literal and exactly three `globalThis[...]` accesses (the pinned runtime's guard, initialization write, and return read). Altered counts, symbols, dynamic names, invocation, aliases, and destructuring remain rejected. The audit metadata is test-generated output evidence and is not packaged by the production build scan.

**Ordinal correction:** `OtpImportPreviewRequestSchema` now rejects duplicate candidate ordinals after strict bounded candidate parsing. The trusted-page hook validates the combined candidate and rejected ordinal collection for defined safe integers in 1..1000 and global uniqueness before creating safe rows or invoking transport. A collision synchronously disposes the owner and publishes only the fixed malformed error; no candidate request or preview rows are produced.

**Verification:** focused round-2 gate passed 15/15 files and 427/427 tests; TypeScript and ESLint passed. Production security build passed 2/2 output files and 7/7 tests, and build scan passed. Reproducible-build verification passed with identical trees. Full Vitest executed 1,266 tests: 1,263 passed; two pre-existing 5-second Vite CSS build timeouts and one unrelated OTP conflict-effect timing assertion failed only under full parallel load. Focused OTP/security suites are green. Installed Node 24.18.0 remains development-only; official Node 22 was unavailable.

No arbitrary computed-global exception remains, no ordinal collision reaches transport, and no Task 8 work occurred.


## 2026-08-12 Task 8 — packaged browser and security evidence

**Scope and environment:** Task 8 only in the non-Git workspace. Repository Playwright used a fresh `shardpass-playwright-*` temporary profile for every context and removed it during fixture teardown; no real profile, account, clipboard, camera, or network authority was used. Development environment was Node 24.18.0, pnpm 10.14.0, Playwright 1.62.0, and Chrome for Testing/Chromium 151.0.7922.34. This is development evidence only: Node 22 and actual Chrome/Chromium 110 remain official acceptance blockers.

**Genuine packaged RED:** `pnpm build:security && pnpm exec playwright test tests/browser/project1-otp-import.spec.ts` built and security-scanned successfully, then failed because a multi-row packaged text preview returned the fixed `OTP_IMPORT_UNAVAILABLE` response instead of safe preview rows. Root-cause tests then established two independent real defects: random UUID row IDs beginning with a digit were rejected by the importer row-ID pattern, and session batch validation received the preview-only `sourceOrdinal` field and rejected it as an unknown `OtpItem` key. A strict transport-ownership regression also demonstrated that the Chrome platform must own a synchronous deep candidate copy before the UI clears its request array. A later genuine RED DOM test showed synchronous parser exceptions escaped React and left the view loading instead of publishing a fixed error.

**Corrections:** row IDs now accept opaque alphanumeric starts while retaining the bounded opaque grammar; the Chrome platform makes a private deep candidate/tag transport snapshot before calling `sendMessage`; the session bridge explicitly projects only storage candidate fields and drops `sourceOrdinal`; and the UI catches synchronous parser throws, disposes owned input, and maps them to the fixed safe error. Focused unit RED/GREEN tests cover numeric-leading UUIDs, source-ordinal projection, transport ownership, and synchronous parser failure.

**Packaged GREEN evidence:** `pnpm exec playwright test tests/browser/project1-otp-import.spec.ts` passed 3/3. Synthetic packaged flows cover setup/unlock, multiline accepted/rejected/in-batch duplicate safe projection and immediate textarea clearing, no preview storage change, explicit token confirmation, one-generation activation, encrypted storage boolean scans, a second trusted vault creating a confirm-time duplicate and forcing a changed preview with no first persistence, popup/content denial and content storage denial, actual bundled Google protobuf Worker with protobuf absent from the vault main bundle, actual bundled ImageDecoder QR Worker using an offline generated static PNG, MIME and encoded-size rejection before Worker creation, no filename rendering, canonical Aegis v3, fixed unsupported Ente encrypted wrapper, lock redaction, all-rejected tokenless disabled confirmation, axe serious/critical, and compact responsive rendering. Worker observations record local path/type only; sensitive storage scans return booleans only. No secret-bearing screenshots or traces were enabled.

**Focused/source/security evidence:** TypeScript and ESLint passed. The focused Task 9 suite executed 673 tests; 672 passed and one known Vite CSS build test exceeded its fixed five-second timeout under parallel load, while the complete `VaultApp.styles.test.ts` file passed 3/3 in isolation. Dependency-cruiser passed 225 modules / 635 dependencies. `build:security` passed 2 output files / 7 tests and the production build scan. Exact17 passed through `tests/legacy/fixtures.test.ts` (9/9). Startup diagnostics passed 3/3. Reproducibility passed with 22 identical files. `pnpm audit --prod` reported no known vulnerabilities. Authority scan found no camera/network/log/clipboard/host-permission matches in the scoped production source and manifest. Bundle audit found protobuf only in the local `google-migration-worker-entry-*` asset, no protobuf/proto3 in `vault-*`, and no remote URL or eval in either import Worker.

**Required packaged regression:** migration, setup/unlock, and all three import tests passed. Existing OTP CRUD completed behaviorally but its reviewed compact visual baseline differed by 5,254 pixels (2%); no baseline was updated because Task 8 made no intentional CRUD visual change. Focused Task 8 import is GREEN. Full browser/full `verify` acceptance remains blocked by that baseline mismatch, the existing whole-tree Prettier failures in `.sdd/project1-task8-execution-ledger.md` and `.sdd/recovery/project1-task7-contaminated-execution-ledger-2026-08-10.md`, official Node 22 absence, and actual Chrome 110 absence. No Git/worktree/commit operation occurred. Task 9 final closure was not started.

## 2026-08-12 Task 9.8 fix round 1 recovery

**Recovery and initial RED:** Recovered after the prior implementer returned no report. Timestamps showed a partially expanded `/home/het/Downloads/Extension/ShardPass/tests/browser/project1-otp-import.spec.ts`, a new desktop import preview baseline, no compact import baseline, and an intentional narrow heading-action CSS change. The retained `test-results` failure and a fresh focused run both failed the first test at the exact safe runtime event-array assertion: the expected sequence incorrectly described a two-candidate changed preview as one candidate and omitted the replacement-confirm and explicit stale-token-confirm messages. After correcting that stale expectation, the next strict assertion exposed another stale count: four marker items persisted, not three. The focused suite then reached the missing compact import baseline. A first 390x844 physical viewport at 200% produced a blank screenshot because it represented only 195 CSS pixels; the corrected 780x1688 physical viewport produces the intended 390x844 CSS layout at real 200% zoom.

**Corrections and acceptance coverage:** Runtime instrumentation now records only structural top-level message keys, preview candidate counts, a forbidden-key boolean, and root-change count; it does not retain candidate keys or values. The exact event order/count now includes preview, cancel, changed-preview confirmations, stale-token confirmation, and final confirmation. Assertions retain no preview/cancel/failed-confirm increment, exact successful +1 increments, encrypted-storage boolean scans, changed-preview second confirmation, stale token failure, popup/content denial, actual packaged Google and ImageDecoder Workers, valid local PNG persistence, JPEG and >8 MiB rejection before Worker creation, oversized IHDR axis/pixels and APNG rejection, and secret-free rendering. Recovery added real CDP service-worker termination/restart after successful import, required unlock, four-item encrypted persistence after restart, imported-item edit/reload/delete regression, Aegis HOTP counter 0/SHA256/8 digits/note/tag/favorite persistence after worker restart, the official omitted `icons_optimized` older variant, encrypted Ente wrapper rejection, and decrypted newline `otpauth` confirmation. No production hook was added. Decode/preview lock behavior remains covered by unit/DOM ownership tests and packaged synchronous preview lock; confirmation activation interruption remains governed and covered by repository/session interruption suites rather than a timing-racy production hook.

**Visual review:** Added safe `/home/het/Downloads/Extension/ShardPass/tests/browser/__screenshots__/vault-otp-import-compact-linux.png` at actual 200% zoom and retained `/home/het/Downloads/Extension/ShardPass/tests/browser/__screenshots__/vault-otp-import-preview-linux.png`. Both are preview-only states after the textarea is removed and contain no raw input or secret. The grouped run reproduced the pre-existing `/home/het/Downloads/Extension/ShardPass/tests/browser/__screenshots__/vault-otp-compact-linux.png` mismatch. Manual old/received/diff review confirmed the intentional `OtpVaultView.module.css` narrow layout now stacks `Import` and `Create OTP` without overlap, so that existing baseline alone was deliberately updated.

**GREEN and gate evidence:** Focused import passed 4/4. The packaged setup/OTP/migration/import matrix passed 7/7. Full packaged browser passed 19/19. Full source passed 81/81 files and 1,269/1,269 tests after raising only the three Vite CSS-build test timeouts from 5s to 15s; each had repeatedly passed in isolation but timed out under whole-suite load. Task 9 relevant source behavior passed except for that pre-correction whole-suite timeout, then the complete full-source rerun passed. TypeScript, ESLint, Task 9 Prettier, Dependency Cruiser (225 modules, 635 dependencies), security build/output 7/7 and build scan, security/legacy 306/306, reproducible build (22 identical files), and production audit (no known vulnerabilities) passed. Startup diagnostics first failed transiently because the worker was unavailable, then unchanged retry passed 3/3. The Task 9 Prettier ignore now explicitly excludes the three append-only historical ledgers rather than rewriting evidence history.

**Open blockers/status:** Evidence was produced under development Node 24.18.0 and Chromium 151.0.7922.34. Official Node 22 and actual Chrome/Chromium 110 acceptance remain unavailable. The requested worker-termination coverage is feasible and now present after successful import; deterministic termination exactly during the confirmation activation micro-window was not added because it would require a production hook or timing-racy test. No Git/worktree/commit operation occurred. Task 9 final closure was not performed.


## 2026-08-12 Task 9.9 final verification preparation recovery

**Recovered partial state and TDD:** The prior agent had already added Task 9 package scripts, the allowlisted `verify:project1:task9:local-node24` check-engine argument, Task 9 workspace contracts, and the narrow Task 9 ledger ignore, but had not appended a result or run the final command. The initial workspace contract was green against an incomplete evidence chain. A strict RED contract then required a bounded serial full-source run, an explicit bounded importer diagnostic run, bounded startup diagnostics, the existing built-browser chain, and bounded exact security/legacy tests. It failed against the prior duplicate full-source plus scoped-source chain. A second RED required exact Task 9 engine guidance and failed because check-engine still labeled the requirement `Project 0`. The first fresh final gate exposed one additional real policy gap: the Buf-generated Google migration protobuf source was not covered by the standard generated-source Prettier policy. A RED workspace assertion captured that gap before adding its exact generated file path and explanatory comment to the standard `.prettierignore`; no broad Task 9 source exclusion was added.

**Final command contract:** `verify:project1:task9:evidence` now runs, in serial shell order: typecheck; lint; Task 9 scoped formatting; dependency-cruiser; clean security build/output scan; full source Vitest with `--maxWorkers=1 --no-file-parallelism`; bounded importer diagnostics; bounded startup diagnostics; `test:browser:built` (which runs `build:test:crypto` before the complete built Playwright suite without cleaning `dist`); exact bounded `tests/security tests/legacy`; reproducible build; and production audit. The official command performs check-engine first with exact Task 9 local guidance. The development-only Node 24 command performs the allowlisted bypass and then the identical evidence command. Workspace contracts preserve `pnpm@10.14.0` and engines `{ node: ">=22.14.0 <23", pnpm: "10.14.0" }`, reject Git, recursion, snapshot updates, and writes, and retain non-reflecting rejection of unallowlisted local-command input.

**Fresh final gate evidence:** `pnpm verify:project1:task9:local-node24` exited 0 under Node 24.18.0, pnpm 10.14.0, Linux x64, Playwright 1.62.0, and Chromium 151.0.7922.34. TypeScript, ESLint, scoped Prettier, and dependency-cruiser passed (225 modules / 635 dependencies). Security build transformed 2,016 modules, passed 2/2 output files and 7/7 output tests, and passed the production build scan. Full bounded serial source passed 81/81 files and 1,271/1,271 tests. Bounded importer diagnostics passed 10/10 files and 191/191 tests. Startup diagnostics passed 2/2 files and 3/3 tests. The complete built browser suite passed 19/19 using one worker. Exact security/legacy verification passed 7/7 files and 306/306 tests; the legacy corpus includes regular-file `lstat` checks before SHA-256 comparison and its symlink-before-hash regression. Reproducibility verified 22 files with identical SHA-256 bytes. Production audit reported no known vulnerabilities.

**Official gate and safe ledger scan:** On Node 24, `pnpm verify:project1:task9` exited 1 before the evidence script started and printed the exact Task 9 development guidance: `Use verify:project1:task9:local-node24 for development evidence only.` A value-suppressing ledger scan counted zero private-key markers, AWS access-key patterns, GitHub token patterns, generic quoted secret assignments, and TODO/TBD/FIXME/change-me placeholders; no matched values were printed.

**Status and blockers:** This is final verification preparation and development evidence only, not Task 10 or final approval. Official Node >=22.14.0 <23 evidence and actual Chrome/Chromium 110 evidence remain unavailable and open. Owner review remains pending. No Git, worktree, commit, snapshot-update, or approval action occurred.
