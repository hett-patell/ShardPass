# Project 1 Task 13 Release Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one fail-closed `pnpm verify:project1` command that proves the complete Project 1 release against one immutable production candidate, one deterministic archive, exact release tools, separated network modes, and a complete trusted evidence DAG.

**Architecture:** Extend the existing Task 12 candidate identity, Chrome 110 evidence, Ed25519 trust-store, and reviewer-approval parsers rather than creating parallel trust mechanisms. A generic deterministic secret scanner and consolidated Project 1 boundary suite feed a disposable-workspace orchestrator that performs one frozen install, one production build, candidate freezing, offline/mock/audit checks, deterministic archive construction, and strict evidence-DAG validation. Documentation and the final disposition are reconciled against the same candidate; Node 24 and Chromium 151 remain explicitly development-only.

**Tech Stack:** Node.js ESM and `node:*` standard-library APIs, TypeScript 5.9.3 strict mode, Vitest 4.1.10, Playwright 1.62.0, pnpm exactly 10.14.0, Chrome/Chromium 110, SHA-256, Ed25519, canonical JSON, deterministic ZIP.

## Global Constraints

- Implementation authority is `docs/superpowers/specs/2026-08-21-project-1-task-13-release-gate-design.md`; roadmap authority is Task 13 at `docs/superpowers/plans/2026-07-29-project-1-vault-otp.md:725-769`. Keep both authoritative files unchanged.
- This is a non-Git workspace. Do not initialize Git or run branch, worktree, add, commit, merge, tag, or push commands. Every task ends with tests and a review gate.
- Implement exactly the three phases below, in order. Do not enter the next phase while a load-bearing finding remains unresolved.
- The sole official entry point is `pnpm verify:project1`. It must fail closed under Node outside `>=22.14.0 <23`, pnpm other than `10.14.0`, Chrome other than observed `110.x`, missing external review, unavailable/malformed audit, network-policy escape, candidate mutation, evidence inconsistency, skipped/zero tests, timeout, signal, or cleanup failure.
- Official evidence uses observed Node major 22, pnpm exactly 10.14.0, and actual Google Chrome/Chromium 110. Node 24 with pnpm 10.14.0 and packaged Playwright Chromium `151.0.7922.34` is development-only and cannot parent or satisfy a release PASS node.
- Build exactly one release `dist/` candidate. Preserve the Task 12 identity `{ name, version, candidateDigest }` and domain `ShardPass packaged candidate v1\0`; after identity creation every consumer treats `dist/` as immutable and verifies the digest before and after external evidence import and final disposition.
- Extend `scripts/task12-release-evidence.mjs` and `scripts/task12-release-evidence.d.mts`; do not duplicate the Task 12 Chrome 110 command, evidence schema, reviewer trust store, detached Ed25519 signature format, or reviewer approval parser.
- Reuse Task 12 Chrome 110 and independent-review evidence only when its exact strict schema, `110.x` observation, candidate identity/digest, Chrome-evidence hash, report hash, signature hash, active in-window unique trusted key, and complete Project 1 review scope all verify. Missing or invalid evidence must be regenerated only through the established Task 12 commands.
- Bootstrap may contact only one recorded HTTPS pnpm registry origin during `pnpm install --frozen-lockfile`; offline commands have OS/container-level network denial; mock browser tests use loopback only with external egress denied; audit permits only `pnpm audit --prod` to the exact registry audit endpoint. No command combines modes.
- The disposable copy contains only a strict declared input manifest and excludes `node_modules/`, `dist/`, `.test-dist/`, Playwright output, coverage, temporary files, old evidence, stores, credentials, and ambient machine state. Reject symlinks and unexpected generated release inputs.
- The secret scanner is generic, deterministic, fail-closed, usable in `source` and `candidate` modes, and accepts only exact rule/schema/path/file-hash/match-hash/count/range/rationale allowlist entries. Real secrets, broad globs, unused/duplicate/overlapping entries, and source/candidate crossing are never allowed.
- The deterministic archive contains exactly `ShardPass-<manifest-version>/` plus every candidate file, bytewise-sorted POSIX paths, timestamp `1980-01-01T00:00:00Z`, files `0644`, directories `0755`, no owner/group/comment/extra field/symlink/executable bit, and one fixed documented compression method and level. Two archive generations must be byte-identical and round-trip to the same candidate identity.
- Canonical evidence JSON has exact keys, UTF-8, no duplicate keys, `JSON.stringify` canonical form, lowercase SHA-256 artifact hashes, typed prerequisite edges, no cycles/duplicates/orphans/path escapes/symlinks/future timestamps/contradictory statuses, and exactly one final root. Emit `PASS-PROJECT1-RELEASE` only after every blocker passes.
- Do not add or change vault, OTP, import, backup, fill, Ente, cryptographic, UI, or production-network behavior. Use only synthetic reserved values in tests and redact raw exceptions, credentials, server bodies, and secret-shaped values from command output and evidence.

---

## Phase 1 — Generic Secret Scanner, Boundary Assertions, and Initial Threat Reconciliation

### Task 1.1: Define and implement the generic source/candidate secret scanner

**Files:**

- Create: `scripts/project1-secret-scanner.mjs`
- Create: `scripts/project1-secret-scanner.d.mts`
- Create: `tests/tooling/project1-secret-scanner.test.ts`
- Create: `config/project1-secret-allowlist.json`

**Interfaces:**

- Produces: `SECRET_SCANNER_SCHEMA_VERSION = 1`, `scanSecretRoot(options: SecretScanOptions): Promise<SecretScanReport>`, `parseSecretAllowlist(text: string): readonly SecretAllowance[]`, and `verifySecretScanReport(report: SecretScanReport): void`.
- `SecretScanOptions` is exactly `{ root: string | URL; rootName: string; mode: "source" | "candidate"; allowlistPath: string | URL; maxTextBytes: number; maxBinaryBytes: number }`.
- `SecretFinding` is exactly `{ ruleId: string; path: string; fileSha256: string; matchSha256: string; startByte: number; endByte: number; count: number }`; it never contains matched bytes.
- `SecretAllowance` binds exactly `{ schemaVersion: 1; scannerSchemaVersion: 1; mode; ruleId; path; fileSha256; matchSha256; startByte; endByte; count; rationale }`, where `rationale` is one of `documented-public-key`, `reserved-synthetic-fixture`, `reviewed-public-identifier`, or `scanner-test-canary`.
- `SecretScanReport` is canonical data with exact keys `{ schemaVersion: 1; mode; rootName; rootDigest; allowlistSha256; filesScanned; findings; allowancesUsed; status }`; status is `PASS` only with zero unallowlisted findings and no invalid/unused allowance.

- [ ] **RED — write scanner contract and adversarial filesystem tests.** Cover deterministic bytewise path order; normalized relative POSIX paths; symlink, FIFO/non-regular entry, duplicate/case-colliding path, unstable Unicode path, unreadable file, unknown type, parse failure, oversized unclassified binary, and path escape rejection. Add rules for secret-shaped serialized key names, `otpauth://`, password/token/key/ciphertext canaries, PEM/private credentials, suspicious high-entropy literals, secret-bearing `console.*`/diagnostics, source maps, fixture markers, and unexpected executable/network strings in candidate mode. Prove binary classification and bounded string extraction with PNG/WASM/ZIP/text samples.
- [ ] **RED — test exact allowances.** Assert rejection of directory/extension/regex/basename/line-number/entropy/generated-file exceptions; changed/moved files; wrong mode/rule/schema; wrong complete-file hash; wrong exact-match hash/range/count; duplicate/overlapping/unused allowances; and an allowlist copied into candidate output. Assert the empty canonical file `{"schemaVersion":1,"scannerSchemaVersion":1,"allowances":[]}` passes for clean source and candidate fixtures.
- [ ] Run `pnpm exec vitest run tests/tooling/project1-secret-scanner.test.ts`; expect FAIL because the scanner module, strict parser, generic rule set, and allowlist do not exist.
- [ ] **GREEN — implement the minimal deterministic scanner.** Walk with `lstat`, never follow links, hash complete files before matching, classify supported text/JSON/HTML/CSS/JS/WASM/PNG/ZIP inputs explicitly, use byte offsets over original buffers, report hashes rather than matched content, validate exact-key canonical allowlist JSON, consume each allowance once, and throw a fixed category error for unreadable/unknown/oversized/malformed inputs.
- [ ] Run `pnpm exec vitest run tests/tooling/project1-secret-scanner.test.ts && pnpm typecheck && pnpm lint`; expect all scanner tests and static checks to PASS.
- [ ] **Review gate:** inspect every rule against design §6. Reject Project 1 filename assumptions, secret text in reports/errors, nondeterministic traversal, implicit binary skips, broad allowances, and any scanner dependency with runtime network or executable loading. Record no Phase 1 approval until every malformed-input test fails for its intended reason.

### Task 1.2: Consolidate Project 1 trust-boundary assertions

**Files:**

- Create: `tests/security/project1-boundaries.test.ts`
- Modify: `dependency-cruiser.config.cjs`
- Modify: `tests/security/build-output.test.ts`
- Modify: `tests/security/executable-policy.test.ts`
- Modify: `tests/security/ente-network-policy.test.ts`
- Modify: `tests/security/ente-credential-canaries.test.ts`

**Interfaces:**

- Produces: one manifest-driven `project1-boundaries` security suite that statically and at runtime proves content, popup, trusted-vault, Ente, cryptographic, storage, migration, backup, clipboard, HOTP, logging, source-map, and packaged-output constraints.
- Consumes: existing strict messaging schemas/authorization, dependency-cruiser graph, `scripts/scan-build.mjs`, and `scanSecretRoot` from Task 1.1; it does not replace focused unit/integration/browser tests.

- [ ] **RED — add content and popup negatives.** Attempt every forbidden content request: seed/URI/full-record enumeration, export/import/migration/backup, Ente state/credentials/connect/sync/disconnect, password change, derive/rotate/wrap/unwrap keys, decrypted storage, and generic crypto. Assert wrong extension ID/frame/origin/document/field/session, expiry, replay, navigation, restart, and stale completion fail closed. Assert popup has only approved vault/OTP/Ente summaries and lock authority, while exact trusted vault document checks remain required for management commands.
- [ ] **RED — add Ente and crypto/storage negatives.** Compile-time and runtime reject login/password/non-OTP Ente projections, custom origins, generic fetch, redirects, cookies, telemetry, WebSocket/EventSource/beacon, non-OTP endpoints, and writes before durable intent. Assert primitives remain behind reviewed adapters/workers and test tampered authenticated storage, malformed KDF inputs, nonce reuse evidence, interrupted activation, rollback ambiguity, migration corruption, backup authentication failure, uncertain HOTP receipt, stale session ownership, and raw secret-bearing messages/logs/diagnostics/source maps/package fixtures.
- [ ] Run `pnpm exec vitest run tests/security/project1-boundaries.test.ts tests/security/build-output.test.ts tests/security/executable-policy.test.ts tests/security/ente-network-policy.test.ts tests/security/ente-credential-canaries.test.ts tests/tooling/dependencies.test.ts`; expect FAIL on absent consolidated coverage and scanner integration, while existing focused checks remain visible.
- [ ] **GREEN — add only assertion and dependency-policy code.** Reuse public schemas and existing synthetic fixtures; add no production authority. Have source/output assertions call the generic scanner and require secret-safe errors. Keep focused tests intact so the consolidated suite is a second enforcement layer rather than a replacement.
- [ ] Run the same focused command plus `pnpm dependencies`; expect PASS with zero skipped/only tests and no new prohibited import edge.
- [ ] **Review gate:** map every design §7 boundary to both a consolidated assertion and at least one focused test. Reject a content/popup whole-record channel, generic Ente/crypto/storage interface, source-only claim without packaged evidence, or any suppression that permits a real secret.

### Task 1.3: Reconcile the initial Project 1 threat inventory and lock documentation tests

**Files:**

- Modify: `docs/security/threat-model.md`
- Modify: `tests/security/docs.test.ts`

**Interfaces:**

- Produces: current Project 1 assets/trust boundaries and explicit threat records for stolen encrypted storage, weak passwords, KDF resource exhaustion, nonce misuse, interrupted writes, rollback, migration corruption, QR bombs/native decoding, malicious imports, clipboard leakage, hostile-page fill/HOTP races, Ente server compromise/metadata exposure/CAS uncertainty, service-worker restart, build/candidate substitution, registry/network-mode failure, and reviewer-key governance.
- Documentation tests consume exact current source manifest/CSP/permissions and fail obsolete “future” claims about implemented OTP, clipboard, fill, import/backup, and Ente behavior.

- [ ] **RED — extend documentation assertions.** Require each listed threat to state asset, attacker capability, boundary, implemented mitigation, residual risk, and concrete source/test evidence. Require current Project 1 wording and forbid crediting Node 24, Chromium 151, mocks, static `chrome110` targeting, or source inspection as release evidence.
- [ ] Run `pnpm exec vitest run tests/security/docs.test.ts`; expect FAIL because the Project 0-centered model does not yet reconcile all implemented Project 1 behavior and release-gate threats.
- [ ] **GREEN — update only the threat model.** Preserve accurate Project 0 history, mark implemented Project 1 behavior as current, and state residual risks without weakening hard blockers: best-effort memory clearing, weak-password guessing, browser/OS compromise, page/OS visibility of filled/clipboard values, Ente metadata/API/CAS dependency, restart/network uncertainty, registry and reviewer-key trust, and Chrome 110 coverage limits.
- [ ] Run `pnpm exec vitest run tests/security/docs.test.ts && pnpm format:check`; expect PASS.
- [ ] **Phase 1 review gate:** compare the scanner, boundary suite, and threat records to design §§6–7 and §12. Search for duplicate Chrome 110/reviewer/trust-store implementations with `rg -n "chrome110|ReviewerTrustStore|Ed25519|createPublicKey" scripts tests/tooling`; approve Phase 1 only when Task 12 remains the sole trust primitive and all intended RED failures were observed before GREEN.

---

## Phase 2 — Immutable Candidate, Frozen Install, Network Modes, Archive, and Evidence DAG

### Task 2.1: Extend Task 12 identity into strict Project 1 candidate/archive/evidence contracts

**Files:**

- Modify: `scripts/task12-release-evidence.mjs`
- Modify: `scripts/task12-release-evidence.d.mts`
- Create: `scripts/project1-release-evidence.mjs`
- Create: `scripts/project1-release-evidence.d.mts`
- Create: `tests/tooling/project1-release-evidence.test.ts`

**Interfaces:**

- Reuses unchanged: `computeTask12Candidate`, `parseTask12StructuredEvidence`, `parseTask12ReviewerApproval`, `parseTask12ReviewerTrustStore`, and `verifyTask12ReviewerSignature`.
- Produces: `computeProject1Candidate(dist: string | URL): Promise<Task12CandidateIdentity>`, implemented by the Task 12 algorithm after stricter tree-shape validation; `parseCanonicalEvidenceJson(text: string): unknown`; `hashEvidenceNode(node: Project1EvidenceNode): string`; and `verifyProject1EvidenceGraph(options): Promise<Project1FinalDisposition>`.
- `EvidenceKind` is exactly `bootstrap | offline-static | source-scan | build | candidate-scan | project1-tests | mock-browser | deterministic-build | archive | audit | docs | task12-chrome110 | task12-review | final`.
- Every node has exact common keys `{ schemaVersion: 1; task: "project1-task13"; id; kind; command; mode; status; startedAt; finishedAt; developmentOnly; candidate; artifacts; prerequisites }`; artifacts and prerequisite edges are sorted by kind/id/hash. Kind-specific payload keys are strict.
- A release final node is exactly `{ ...common, kind: "final", mode: "offline", status: "PASS-PROJECT1-RELEASE", archiveSha256, nodeVersion, pnpmVersion, chromeVersion }` and directly references every required terminal prerequisite hash.

- [ ] **RED — test complete candidate identity.** Add manifest/assets/WASM/notices fixtures and reject symlinks, non-regular entries, absolute/`..`/duplicate-normalized/case-colliding/unstable-Unicode paths, files outside `dist/`, malformed manifest, and mutation between repeated hashes. Assert the digest remains byte-for-byte compatible with Task 12 for a valid tree.
- [ ] **RED — test canonical strict DAG validation.** Reject duplicate JSON keys, noncanonical JSON, unknown keys/kinds/modes, malformed hashes/timestamps, future/reversed times, cycles, duplicate IDs/identities, orphan required nodes, unsafe artifact paths, symlink/non-regular/hash-mismatched artifacts, failed/contradictory prerequisites, candidate drift, development-only release ancestry, multiple/missing final roots, and PASS with any missing required kind.
- [ ] **RED — test immutable Task 12 imports.** Import valid same-candidate Chrome 110 and signed reviewer records as hashed immutable nodes; reject changed/copied/rewritten records, wrong candidate/scope/hash/signature/key window/fingerprint, non-110 browser, or absent external inputs. Assert imported bytes are never rewritten and no Task 13 signature/trust-store schema is accepted.
- [ ] Run `pnpm exec vitest run tests/tooling/task12-release-evidence.test.ts tests/tooling/project1-release-evidence.test.ts`; expect FAIL because strict Project 1 identity/DAG/import functions do not exist.
- [ ] **GREEN — implement strict parsers and graph verification.** Factor only shared canonical JSON/path/date/candidate validation out of Task 12 without changing accepted Task 12 records. Hash canonical node bytes, validate exact key sets per kind, recursively verify typed prerequisite hashes, and emit no final object until the unique rooted DAG is complete.
- [ ] Run the same command plus `pnpm typecheck`; expect both legacy Task 12 and new Task 13 tests to PASS.
- [ ] **Review gate:** diff behavior through tests: every valid Task 12 fixture remains accepted, every malformed new graph is rejected, and no new trust store, Chrome command, signature parser, or reviewer approval format exists.

### Task 2.2: Build the declared disposable workspace and exact frozen bootstrap

**Files:**

- Create: `config/project1-release-inputs.json`
- Create: `scripts/project1-release-workspace.mjs`
- Create: `scripts/project1-release-workspace.d.mts`
- Create: `tests/tooling/project1-release-workspace.test.ts`

**Interfaces:**

- Produces: `parseReleaseInputManifest(text): ReleaseInputManifest`, `createDisposableWorkspace(options): Promise<DisposableWorkspace>`, `runFrozenBootstrap(workspace, options): Promise<BootstrapEvidence>`, `assertWorkspaceUnchanged(snapshot): Promise<void>`, and `cleanupDisposableWorkspace(workspace): Promise<void>`.
- `DisposableWorkspace` exposes only `{ root; storeDirectory; sourceSnapshotSha256; releaseInputsSha256 }` and paths under an OS-created private temporary parent.
- The input manifest enumerates repository files/directories needed by package/workspace manifests, source, tests, fixtures, scripts, configuration, and docs; explicit excludes are `node_modules`, `dist`, `.test-dist`, `test-results`, `playwright-report`, `coverage`, `.sdd`, stores, environment files, credentials, and prior Task 13 evidence.
- Bootstrap records exact observed OS/architecture, `node --version`, `pnpm --version`, package-manager/engine declarations, lock/config/patch hashes, isolated-store identity, one HTTPS registry origin, command, status, and secret-safe DNS/HTTP summary.

- [ ] **RED — test strict copy and mutation detection.** Use temporary trees to reject symlink inputs, undeclared generated inputs, excluded artifacts, special files, case/Unicode collisions, source changes during copy, output outside the temporary root, ambient `NODE_PATH`, global package resolution, inherited credentials/proxy variables, and cleanup that leaves plaintext/test artifacts.
- [ ] **RED — test exact bootstrap.** Stub process execution to require Node `>=22.14.0 <23` with observed major 22, pnpm `10.14.0`, `pnpm install --frozen-lockfile`, empty isolated store, unchanged package/workspace manifests/lock/config/patches, and only one same-origin HTTPS registry. Reject redirects, Git URLs, alternate registries, lifecycle network, browser download, Ente traffic, mutation, warning downgrade, signal, timeout, missing tool, and nonzero result.
- [ ] Run `pnpm exec vitest run tests/tooling/project1-release-workspace.test.ts`; expect FAIL because the strict manifest, copier, bootstrap runner, mutation snapshot, and cleanup contract do not exist.
- [ ] **GREEN — implement the manifest copier/bootstrap.** Copy regular files byte-for-byte with exclusive creation, snapshot declared inputs before/after, create an isolated pnpm store, pass a minimal allowlisted environment, invoke only the exact frozen command, and produce canonical evidence without command-output secrets. Keep Node/pnpm/Chrome provisioning outside this function.
- [ ] Run `pnpm exec vitest run tests/tooling/project1-release-workspace.test.ts && pnpm typecheck && pnpm lint`; expect PASS.
- [ ] **Review gate:** independently inspect `config/project1-release-inputs.json` against workspace manifests and all named test suites. Reject implicit wildcard inclusion of machine state, dependency on the original checkout after copy, a nonempty store, mutable lock/config/patch files, or cleanup that can delete preserved Task 12 signed evidence.

### Task 2.3: Enforce bootstrap/offline/mock/audit process network modes

**Files:**

- Create: `scripts/project1-network-runner.mjs`
- Create: `scripts/project1-network-runner.d.mts`
- Create: `tests/tooling/project1-network-runner.test.ts`
- Modify: `tests/browser/ente-synthetic-server.ts`
- Modify: `playwright.config.ts`

**Interfaces:**

- Produces: `runInNetworkMode(options: NetworkRunOptions): Promise<NetworkEvidence>` where `mode` is exactly `bootstrap | offline | mock | audit`, one command belongs to one mode, and the caller supplies an OS/container isolation adapter that proves enforcement rather than merely mocking JavaScript APIs.
- Bootstrap allows only the registry behavior from Task 2.2. Offline denies DNS, sockets, and subprocess escape. Mock permits only a per-run loopback server and denies browser/server external egress. Audit permits only `pnpm audit --prod` to the exact configured registry audit endpoint and forbids installation or workspace mutation.
- `NetworkEvidence` contains only `{ schemaVersion: 1; mode; commandId; isolation; allowedEndpoints; observedAttempts; outputSha256; status }`, with secret-safe endpoint summaries and sorted attempts.

- [ ] **RED — create an isolation-adapter conformance harness.** For each mode, launch fixture commands attempting DNS, IPv4/IPv6 sockets, redirects, child-process escape, proxy use, registry alternates, Ente, and loopback. Assert only the exact mode allowance succeeds and every attempt is recorded. Reject absent/unsupported OS isolation, combined modes, inherited proxy/credential variables, timeout/signal, and unclassified child commands.
- [ ] **RED — harden mock and audit tests.** Assert packaged Ente tests route exact production requests only through harness interception to loopback, capture method/path/status/redirect/cookie summaries, use no real account, and leave no routing code in `dist/`. Assert audit consumes the frozen lock, cannot install/mutate, and blocks unavailable registry, malformed JSON, or any production vulnerability.
- [ ] Run `pnpm exec vitest run tests/tooling/project1-network-runner.test.ts tests/security/ente-network-policy.test.ts`; expect FAIL until all four mode policies and process isolation are explicit.
- [ ] **GREEN — implement fail-closed mode dispatch.** Use one platform adapter selected by tested capability detection; provide no permissive fallback. Strip ambient networking variables, enforce timeout/signal handling, hash complete raw output as an artifact, and expose only bounded secret-safe summaries to evidence.
- [ ] Run the same command plus `pnpm exec playwright test tests/browser/project1-ente-sync.spec.ts`; expect PASS using synthetic loopback traffic and zero external request.
- [ ] **Review gate:** inspect process trees and captured attempts for all four modes. Reject a JavaScript-only fetch mock as offline enforcement, externally reachable mock server, browser download during verification, stale audit cache as success, or a command assigned to multiple modes.

### Task 2.4: Freeze one candidate and create a byte-identical deterministic archive

**Files:**

- Create: `scripts/project1-candidate.mjs`
- Create: `scripts/project1-candidate.d.mts`
- Create: `scripts/project1-archive.mjs`
- Create: `scripts/project1-archive.d.mts`
- Create: `tests/tooling/project1-candidate-archive.test.ts`

**Interfaces:**

- Produces: `buildAndFreezeCandidate(options): Promise<FrozenCandidate>`, `assertCandidateUnchanged(candidate): Promise<void>`, `createDeterministicArchive(candidate, output): Promise<ArchiveIdentity>`, and `verifyArchiveRoundTrip(candidate, archive): Promise<void>`.
- `buildAndFreezeCandidate` removes stale `dist/`, invokes the production build exactly once, validates complete regular-file shape/manifest, computes `computeProject1Candidate`, snapshots every file hash, and never rebuilds or writes below `dist/` afterward.
- Archive uses one fixed ZIP implementation selected from an exact-pinned dependency only if Node standard APIs cannot emit the required ZIP; compression is fixed to DEFLATE level 9, timestamp `1980-01-01T00:00:00Z`, files `0644`, directories `0755`, and exact top directory `ShardPass-<version>/`.

- [ ] **RED — test one-build freezing.** Assert stale output removal, exactly one build invocation, complete tree digest, read-only post-digest use, digest checks before/after each external import, and failure on any byte/path/manifest/mode/symlink mutation. Verify deterministic rebuild comparison occurs in a separate scratch output and never replaces the candidate.
- [ ] **RED — test exact archive bytes and round-trip.** Generate twice to separate paths and assert equality; inspect central/local headers for sorted POSIX paths, fixed timestamp/compression/modes, no owner/group/comments/extra fields/executable/symlink, and one top directory. Reject traversal, duplicate/case-colliding names, wrong root, missing/extra files, archive self-inclusion, and decompression limits. Unpack to a new directory and recompute the original candidate identity.
- [ ] Run `pnpm exec vitest run tests/tooling/project1-candidate-archive.test.ts`; expect FAIL because the one-build freezer and deterministic archive implementation do not exist.
- [ ] **GREEN — implement candidate and archive functions.** Share Task 12 tree encoding, use a second scratch build only for comparison, write archives outside `dist/`, fsync/close before hashing, and recompute candidate identity around every import/archive/final operation. If an archive package is needed, exact-pin it in `package.json`/`pnpm-lock.yaml` and add its integrity/license/network/executable policy to dependency tests; otherwise make no dependency change.
- [ ] Run `pnpm exec vitest run tests/tooling/project1-candidate-archive.test.ts tests/tooling/task12-release-evidence.test.ts && pnpm typecheck`; expect PASS and unchanged Task 12 identity vectors.
- [ ] **Review gate:** manually inventory a generated fixture archive and compare its unpacked sorted file/hash list to the candidate snapshot. Reject a second release build, mutable `dist/`, archive metadata drift, omitted generated asset, or identity algorithm fork.

### Task 2.5: Orchestrate the complete evidence-producing gate without package aliases

**Files:**

- Create: `config/project1-release-tests.json`
- Create: `scripts/verify-project1-release.mjs`
- Create: `scripts/verify-project1-release.d.mts`
- Create: `tests/tooling/project1-release-gate.test.ts`

**Interfaces:**

- Produces: `runProject1ReleaseGate(options): Promise<Project1FinalDisposition>` and CLI `node scripts/verify-project1-release.mjs --mode=release|development`.
- The strict test manifest names exact commands/suites for typecheck, lint, format, dependency analysis, source scan, one production build, candidate scan, all workspace Vitest projects, Project 1 boundary/security/legacy/tooling tests, packaged browser tests, deterministic scratch build, archive, audit, docs, Task 12 Chrome/review import, and final DAG validation.
- Release mode may emit one canonical final root only after Node 22/pnpm 10.14/Chrome 110/external review pass. Development mode marks every produced node `developmentOnly: true`, expects Node 24/pnpm 10.14/Chromium 151, and never emits `PASS-PROJECT1-RELEASE`.

- [ ] **RED — drive orchestration through fakes.** Assert exact order: preflight, disposable copy, frozen bootstrap, offline source/static checks, one build/freeze/digest, candidate scan/tests, mock packaged browser, deterministic scratch comparison, isolated audit, same-digest Task 12 Chrome/review import, deterministic archive twice/round-trip, docs, final digest/DAG, cleanup. Reject missing/renamed suite, zero tests, `skip`/`only`, warning downgrade, unexpected mutation, stale evidence, failed independent prerequisite, signal/timeout, or cleanup failure.
- [ ] **RED — test release/development separation.** Node 24 or Chromium 151 must produce development-only diagnostics and no final PASS; Node 22 without Chrome 110 or trusted review must fail; no engine/browser override, `--ignore-engines`, mock evidence substitution, or caller-supplied PASS status is accepted.
- [ ] Run `pnpm exec vitest run tests/tooling/project1-release-gate.test.ts`; expect FAIL because the orchestrator and checked test manifest do not exist.
- [ ] **GREEN — implement the orchestrator.** Delegate to Tasks 2.1–2.4, preserve each full command output as a hashed artifact, write nodes atomically outside candidate/archive, stop unsafe preconditions immediately, optionally continue only independent failed checks, recompute the candidate around evidence imports and disposition, and emit the final node last.
- [ ] Run `pnpm exec vitest run tests/tooling/project1-release-gate.test.ts tests/tooling/project1-release-evidence.test.ts tests/tooling/project1-release-workspace.test.ts tests/tooling/project1-network-runner.test.ts tests/tooling/project1-candidate-archive.test.ts`; expect PASS without invoking an official external release environment.
- [ ] **Phase 2 review gate:** run `node scripts/verify-project1-release.mjs --mode=development` under Node 24/pnpm 10.14/packaged Chromium 151. Expect local checks to execute but final release disposition to remain unavailable and all nodes to be `developmentOnly: true`. Inspect the evidence graph for one candidate digest, explicit network modes, immutable Task 12 imports, no orphan, and no unresolved finding before Phase 3.

---

## Phase 3 — Package Scripts, Final Documentation, Official Local Gate, and Review

### Task 3.1: Expose one official package command and one explicit Node 24 diagnostic

**Files:**

- Modify: `package.json`
- Modify: `scripts/check-engine.mjs`
- Modify: `tests/tooling/workspace.test.ts`

**Interfaces:**

- Produces exactly `verify:project1` as the sole official Project 1 release alias and `verify:project1:local-node24` as an explicitly development-only diagnostic.
- Exact scripts are `"verify:project1": "node scripts/check-engine.mjs --local-command=verify:project1:local-node24 && node scripts/verify-project1-release.mjs --mode=release"` and `"verify:project1:local-node24": "node scripts/check-engine.mjs --allow-node24 && node scripts/verify-project1-release.mjs --mode=development"`.
- Historical Task 8–12 commands remain diagnostics and cannot emit `PASS-PROJECT1-RELEASE` or substitute for `verify:project1`.

- [ ] **RED — update workspace policy tests.** Assert the exact two scripts, package-manager/engine pins, allowlisted local-command name, first-step engine check, absence of alternate Project 1 release aliases, and absence of `--ignore-engines`, browser override, inline historical gate chain, or direct caller-selected PASS.
- [ ] Run `pnpm exec vitest run tests/tooling/workspace.test.ts`; expect FAIL before package scripts and engine allowlist include Task 13.
- [ ] **GREEN — add only the two aliases and exact engine allowlist entry.** Keep release behavior in the orchestrator; do not reintroduce a mutable `&&` chain that rebuilds between checks.
- [ ] Run `pnpm exec vitest run tests/tooling/workspace.test.ts && pnpm typecheck && pnpm lint`; expect PASS.
- [ ] **Review gate:** inspect every `verify:project1*` script. Confirm only `verify:project1` can request release mode, Node 24 receives the existing fixed development warning, and historical task aliases cannot clear final blockers.

### Task 3.2: Complete security and architecture reconciliation against implemented Project 1

**Files:**

- Modify: `docs/security/threat-model.md`
- Modify: `docs/security/invariants.md`
- Modify: `docs/security/release-checklist.md`
- Modify: `docs/architecture/runtime-boundaries.md`
- Modify: `docs/architecture/dependencies.md`
- Modify: `docs/architecture/permissions.md`
- Modify: `docs/security/cryptographic-format.md`
- Modify: `tests/security/docs.test.ts`

**Interfaces:**

- Produces exact current documentation for candidate identity/archive, scanner/allowlist policy, disposable frozen install, four network modes, evidence DAG, Task 12 Chrome/review reuse, exact Node/pnpm/Chrome blockers, current content/popup/vault/Ente/crypto/storage boundaries, and residual-risk acceptance.
- Documentation assertions compare source package scripts, manifest/CSP/permissions, evidence schema kinds, dependency pins, candidate inventory, and Task 11/current Task 12 approved designs; prose alone cannot contradict executable contracts.

- [ ] **RED — add cross-document executable assertions.** Require `verify:project1`, Node 22/pnpm 10.14/Chrome 110, Node 24/Chromium 151 development-only language, one-build candidate identity/domain, deterministic archive rules, four network modes, strict scanner allowances, required DAG nodes, same-digest Task 12 imports, external review, and `PASS-PROJECT1-RELEASE`. Fail obsolete “future” claims for implemented OTP/copy/fill/import/backup/Ente behavior and any manifest/CSP/permission mismatch.
- [ ] Run `pnpm exec vitest run tests/security/docs.test.ts`; expect FAIL until every current Project 1 document agrees with source and gate contracts.
- [ ] **GREEN — reconcile all named documents.** Preserve historical facts while replacing obsolete current-state claims. Explicitly review memory zeroization limits, weak-password guessing, browser/OS compromise, clipboard/page observability, Ente metadata/API/CAS/restart/network uncertainty, registry/audit availability, reviewer-key governance, and Chrome 110 scope. State that none permits seed disclosure, unauthenticated storage, silent loss/conflict, candidate substitution, audit bypass, or undocumented authority.
- [ ] Run `pnpm exec vitest run tests/security/docs.test.ts && pnpm format:check`; expect PASS.
- [ ] **Review gate:** compare docs against the production manifest, package scripts, `config/project1-release-tests.json`, evidence type declarations, Task 11 design, and current Task 12 design. Reject unsupported audit/zeroization/provenance claims, softened blockers, stale future language, or omitted authority/residual risk.

### Task 3.3: Run the final local diagnostic, official release gate, and independent disposition review

**Files:**

- No source modifications.
- Evidence inputs consumed read-only: `.sdd/project1-task12-chrome110-evidence.json`, `.sdd/project1-task12-final-disposition.json`, the external review report/signature paths named by that disposition, and the canonical Task 12 reviewer trust store supplied through `TASK12_REVIEWER_TRUST_STORE`.
- Generated Task 13 evidence/archive paths are determined by `scripts/verify-project1-release.mjs` inside its disposable evidence output and remain outside `dist/`.

**Interfaces:**

- Consumes: `pnpm verify:project1:local-node24` for development diagnosis and `pnpm verify:project1` for the only release decision.
- Produces: one deterministic `ShardPass-<manifest-version>.zip`, one canonical complete evidence DAG, and exactly one `PASS-PROJECT1-RELEASE` root only in the official environment.

- [ ] **Development-only preflight:** under Node 24.x, pnpm 10.14.0, and packaged Playwright Chromium `151.0.7922.34`, run `pnpm verify:project1:local-node24`. Expect the checks to execute with every node marked `developmentOnly: true`, a fixed warning that Node 22/Chrome 110 blockers remain, and no `PASS-PROJECT1-RELEASE` root.
- [ ] **Official clean gate:** provision exact Node `>=22.14.0 <23` with observed major 22, pnpm `10.14.0`, actual Chrome/Chromium `110.x`, isolated network-mode enforcement, the canonical Task 12 trust store, and valid same-candidate Task 12 Chrome/review evidence; then run `pnpm verify:project1`. Expect exit 0 only after clean disposable copy, frozen install, one build, all named checks, archive round-trip, audit, docs, trusted evidence import, and cleanup pass.
- [ ] **Failure-path confirmation:** repeat with each external prerequisite withheld in isolation—Chrome executable, Chrome record, review report, detached signature, trust store, audit endpoint, and offline isolation adapter. Expect nonzero exit, no PASS root, no candidate/archive substitution, and only fixed secret-safe blocker output.
- [ ] **Evidence review:** verify the root’s candidate digest against the complete frozen `dist/` tree and archive round-trip; verify archive SHA-256 from two byte-identical generations; verify every required node/edge/artifact hash, exact command/mode/runtime, no failed/orphan/contradictory/development-only ancestor, and immutable Task 12 Chrome/review bytes.
- [ ] **Independent final review gate:** the trusted reviewer confirms scope covers content, popup, trusted vault, Ente, cryptographic/storage/migration/import/backup/clipboard/HOTP, scanner/allowlist, clean install, network modes, candidate/archive, and evidence orchestration. Any absent scope, unresolved load-bearing finding, stale signature/key, or residual risk not explicitly accepted blocks release and requires established Task 12 evidence regeneration rather than a Task 13 bypass.
- [ ] **Final disposition:** accept Project 1 only when `pnpm verify:project1` exits zero and the unique canonical root status is `PASS-PROJECT1-RELEASE`. Every other result is `STOP-PROJECT1-RELEASE`; emit no PASS root, perform no Git operation, and preserve signed external evidence unchanged.
