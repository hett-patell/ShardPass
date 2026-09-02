# Project 1 Task 13 — Release Gate

**Status:** Approved for implementation planning  
**Date:** 2026-08-21  
**Authority:** `docs/superpowers/plans/2026-07-29-project-1-vault-otp.md`, Task 13, lines 725–769

## 1. Decision

Task 13 establishes one fail-closed command, `pnpm verify:project1`, that creates one complete production `dist/` candidate, identifies it with one deterministic SHA-256 tree digest, and proves every automated and human release claim against that same immutable candidate. The gate runs only from a clean disposable workspace with a frozen install under exact release tools, emits a strict structured evidence graph, and succeeds only when every required node and hash-bound edge is present and valid.

The gate consolidates rather than wraps the historical task gates. It preserves their checks, removes opportunities to rebuild or substitute artifacts between checks, and reuses valid Task 12 Chrome 110 and trusted Ed25519 review evidence when those records bind to the exact Project 1 candidate digest. Any missing, malformed, stale, duplicated, contradictory, untrusted, network-policy-violating, or digest-mismatched input blocks release.

## 2. Goals

- Provide one official release command: `pnpm verify:project1`.
- Build exactly one complete production `dist/` candidate and keep it byte-for-byte immutable after identity is computed.
- Enforce Project 1 content-script, popup, Ente, cryptographic, storage, migration, import, backup, clipboard, HOTP, and secret-redaction boundaries in source and packaged output.
- Detect secrets with a generic scanner usable on both source and the candidate; permit exceptions only through narrow rule/path/content-hash bindings.
- Separate dependency bootstrap, offline verification, synthetic mock traffic, and production audit traffic into explicit network modes.
- Prove clean frozen installation, deterministic build, deterministic archive, exact release runtimes, Chrome 110 behavior, and trusted independent review.
- Preserve one strict, machine-verifiable evidence graph whose root unambiguously identifies the approved archive and complete `dist/` tree.
- Reconcile security and architecture documentation with implemented Project 1 behavior and record residual risks without weakening blockers.

## 3. Non-goals

- Adding or changing vault, OTP, import, backup, fill, Ente, cryptographic, UI, or network features.
- Replacing focused unit, integration, packaged-browser, audit, or human review with a single broad smoke test.
- Scanning arbitrary user data, developer home directories, dependency caches, historical ledgers, or preserved legacy binary fixtures as though they were production source.
- Proving that no secret can ever exist in memory, browser internals, or user-controlled page state.
- Calling Node 24, Chromium 151, static `chrome110` targeting, mocks, or source inspection release evidence.
- Performing live Ente account mutation or permitting routine tests to contact production services.
- Creating a second Chrome 110 run, second independent review, second trust store, or Task 13-specific signature format when valid Task 12 evidence already covers the same candidate.
- Git operations; this workspace is non-Git.

## 4. Immutable complete candidate

The gate removes stale `dist/`, performs one production build, validates its manifest and regular-file/non-symlink shape, and computes the existing Task 12 candidate identity algorithm over the complete sorted `dist/` tree. The digest domain remains `ShardPass packaged candidate v1\0`; each entry contributes its UTF-8 POSIX relative path length, file length, relative path, and bytes. The identity is exactly `{ name, version, candidateDigest }`, with `candidateDigest` a lowercase SHA-256 value.

“Complete” means every regular file below `dist/`, including the manifest, JavaScript, CSS, HTML, icons, local WASM, notices, and generated assets. Directories contribute through their files; empty directories and filesystem metadata do not. Symlinks, non-regular entries, duplicate normalized paths, absolute paths, `..`, case-colliding paths, unstable Unicode path encodings, and files outside `dist/` fail the gate.

After digest creation, `dist/` becomes read-only gate input. Every source/output scan, boundary test, packaged browser run, screenshot review, Chrome 110 record, review approval, and archive operation names that exact identity. The orchestrator recomputes the digest before and after each external evidence import and before final disposition. A changed candidate cannot inherit evidence and must start a new gate run.

The release archive is generated from that tree without rebuilding. It contains exactly one top-level directory named `ShardPass-<manifest-version>/` and the complete `dist/` contents beneath it, with POSIX paths sorted bytewise, fixed UTC epoch timestamp `1980-01-01T00:00:00Z`, regular-file mode `0644`, directory mode `0755`, no owners, groups, comments, extra fields, symlinks, or executable bits, and a fixed compression method/level selected by the implementation. Two independently generated archives must be byte-identical. The graph records both archive SHA-256 and candidate digest; unpacking the archive and recomputing the candidate identity must reproduce the original identity exactly.

## 5. Clean disposable frozen install

The official gate runs at a newly copied disposable workspace root, not the developer checkout. The copy includes only declared repository inputs and excludes `node_modules/`, `dist/`, `.test-dist/`, Playwright output, coverage, temporary files, previous evidence output, package-manager stores, and untracked machine state. The runner rejects symlinks and unexpected generated release inputs before installation.

Bootstrap uses exact Node `22.x` satisfying `>=22.14.0 <23`, exact pnpm `10.14.0`, the committed `package.json`, workspace manifests, patches/configuration, and `pnpm-lock.yaml`, then runs `pnpm install --frozen-lockfile`. The install may use an empty isolated pnpm store and the explicitly recorded package registry only. Manifest, lockfile, config, and patch hashes are captured before install and must remain unchanged afterward. Lifecycle-script execution and generated dependency files follow the committed pnpm policy; undeclared mutation fails.

After bootstrap, the workspace and isolated store are moved into offline verification. No dependency on the original checkout, global package, ambient `NODE_PATH`, developer browser profile, credential, or pre-existing cache is allowed. The evidence records OS/architecture, exact `node --version`, `pnpm --version`, lockfile hash, store identity, bootstrap endpoint, and install result.

## 6. Generic secret scanning and narrow allowlists

One scanner accepts a named root and mode (`source` or `candidate`) and walks regular non-symlink files deterministically. It applies generic rules rather than Project 1 filename assumptions: known secret-key names and serialized fields; seed/OTP URI/password/token/key/ciphertext canaries; private-key and credential encodings; suspicious high-entropy literals; forbidden logging/diagnostic calls whose values or property names are secret-shaped; source maps, test credentials, fixture markers, and unexpected executable/network strings in production output. Binary files are classified by explicit type and scanned with bounded byte/string extraction; parse errors, unreadable files, oversized unclassified files, and unknown file types fail closed.

An exception is valid only when a reviewed allowlist entry binds all of:

1. scanner rule identifier and scanner schema version;
2. normalized root-relative path, with no glob broader than one explicitly enumerated file;
3. lowercase SHA-256 of the complete file bytes;
4. lowercase SHA-256 of the exact matched byte slice;
5. match count and byte range; and
6. a fixed non-secret rationale category.

An entry cannot suppress another rule, another match, a changed file, or a moved path. Directory-wide, extension-wide, regex-only, basename-only, line-number-only, entropy-threshold, and “generated file” exceptions are forbidden. Duplicate, unused, overlapping, expired-schema, or source/candidate-crossed entries fail. Allowlist files are themselves source-scanned, hashed into evidence, and forbidden from `dist/` and the archive. Real secrets are never valid exceptions; sanitized deterministic fixtures remain outside production output and use reserved test-only values.

## 7. Project 1 boundary assertions

The release suite adds a consolidated security boundary test and retains focused existing tests.

### Content-script boundary

Content messages may request only the reviewed metadata-only discovery/fill flow. They cannot request seeds or OTP URIs, enumerate full records, export or import, migrate, read backups, access Ente state or credentials, connect/sync/disconnect Ente, change passwords, rotate/derive/wrap/unwrap keys, read decrypted storage, or invoke generic cryptographic operations. Sender extension ID, exact frame/origin/document/field/session binding, capability expiry, replay, navigation, worker restart, and stale completion fail closed. Content logs, errors, DOM, accessibility state, screenshots, and packaged strings contain no secret-shaped values.

### Popup and trusted-page boundary

The popup receives only the approved vault/OTP/Ente summaries and lock authority; it has no bulk decrypted-record, seed, export/import, backup, password-change, conflict-resolution, Ente credential, or key-operation authority. Full-vault commands require the exact trusted vault document and existing document/session/capability checks. No UI projection exposes OTP seeds, Ente tokens/keys, complete encrypted metadata, bulk decrypted records, or internal crypto/storage errors.

### Ente boundary

Only the background-owned fixed client may contact exactly `https://api.ente.io` through the reviewed endpoint-specific OTP protocol. Content has no Ente authority and popup is summary-only. Production synchronization accepts TOTP, HOTP, and Steam records only; login items and unrelated notes/files/passwords fail compile-time and runtime boundaries. Reusable credentials, Auth-key material, mappings, bases, pending operations, uncertainty, and conflicts remain inside authenticated encrypted generation metadata. Custom origins, generic fetch, redirects, cookies, telemetry, WebSockets, non-OTP payloads, and writes before durable intent fail.

### Cryptographic and storage boundary

Production code reaches primitives only through reviewed adapters and workers. Raw seed/key/password material cannot enter generic messages, logs, diagnostics, screenshots, source maps, or packaged fixtures. Tampered authenticated storage, malformed KDF inputs, nonce misuse/reuse evidence, interrupted generation activation, rollback ambiguity, migration corruption, backup authentication failure, uncertain HOTP receipt, and stale session ownership fail closed. Existing known-answer, fixed-time code, migration preservation, backup round-trip, interruption, exactly-once HOTP, and Ente rejection tests remain mandatory.

Dependency-cruiser, AST checks, strict message schemas, source scan, candidate scan, and packaged tests jointly enforce these boundaries; no single mechanism is treated as sufficient.

## 8. Verification network policy

Every process receives exactly one declared mode. Unclassified network capability is a gate failure.

- **Bootstrap:** only `pnpm install --frozen-lockfile` may access the one configured HTTPS package-registry origin and its same-origin package paths. DNS/HTTP observations are recorded. Git URLs, alternate registries, redirects to unapproved origins, lifecycle-script network, browser downloads, Ente, and all other destinations fail. Toolchains and Chrome 110 must be provisioned before the gate or by separately attested infrastructure, not downloaded during verification.
- **Offline:** typecheck, lint, formatting, dependency analysis, builds, unit/security/legacy/tooling tests, scans, reproducibility, archiving, evidence validation, and documentation checks run with network denied at the OS/container boundary. A mocked JavaScript API alone is not sufficient enforcement. Any attempted socket, DNS request, or subprocess escape fails.
- **Mock:** packaged browser protocol tests run against a per-run loopback synthetic server only. The browser and server are denied external egress; the production extension still contains only its reviewed production authority, while test routing is harness-owned and cannot enter `dist/`. Requests, responses, redirects, cookies, and attempted unexpected destinations are captured with secret-safe summaries. No real Ente account is used.
- **Audit:** only `pnpm audit --prod` may contact the exact configured registry audit endpoint over HTTPS. It uses the already frozen lockfile, cannot install or mutate dependencies, and records endpoint, response status, report hash, and registry availability. Unavailability, malformed output, or any production vulnerability blocks release; it is not converted to a warning or silently satisfied from stale cache.

The graph records mode transitions and command membership. A command cannot combine modes, and no network-enabled result may substitute for an offline result.

## 9. Unified strict structured evidence graph

Evidence is canonical JSON with exact-key schemas, UTF-8, no duplicate keys, and `JSON.stringify` canonical form. The graph is a directed acyclic graph rooted at one final disposition. Every node has an exact kind/schema, Project 1 task identity, command, status, timestamps not in the future, candidate identity where applicable, SHA-256 of its canonical record, SHA-256 of each referenced artifact, and typed edges to prerequisites. Unknown fields, unknown node kinds, cycles, duplicate identities, orphan required nodes, path traversal, absolute paths, symlinks, non-regular artifacts, hash mismatch, contradictory status, or a PASS with a failed prerequisite blocks release.

Required nodes cover: frozen bootstrap; offline static checks; source scan and allowlist; the single build; candidate scan; Project 1 boundary/unit/integration/security/legacy tests; deterministic rebuild comparison without replacing the candidate; packaged mock-browser tests; candidate/archive reproducibility; production audit; documentation reconciliation; Chrome 110; independent review; and final disposition. Command output is preserved as hashed artifacts with secret-safe structured summaries; output text alone cannot assert PASS.

Task 13 extends the existing Task 12 candidate/evidence parsers rather than cloning them. The existing Task 12 Chrome 110 node and final review approval are imported by hash when they:

- use the current strict schemas and exact Project 1 candidate identity;
- report actual version `110.x` for the established Chrome command and PASS result;
- bind the review report to that Chrome evidence hash and candidate digest;
- verify the detached Ed25519 signature against the configured canonical Task 12 reviewer trust store;
- identify an active, in-window, non-duplicated trusted reviewer key by fingerprint; and
- cover the complete Project 1 candidate and relevant content/popup/Ente/crypto/storage/release boundaries.

The imported records remain immutable evidence nodes; Task 13 adds typed references to them and does not copy, rewrite, resign, reinterpret, or regenerate them. If their candidate digest, scope, trust store, signature, report, or Chrome evidence is absent or invalid, release stops and the corresponding evidence must be produced through the established Task 12 commands/formats, not a Task 13 bypass.

The final disposition is PASS only when all required nodes lead to the same candidate, the archive round-trip reproduces it, every blocker is cleared, and the trusted review node approves it. The root records the candidate digest, archive SHA-256, all direct prerequisite hashes, exact runtime versions, and `PASS-PROJECT1-RELEASE`; otherwise no PASS root is emitted.

## 10. Exact release and development environments

Official release evidence requires all of:

- Node `>=22.14.0 <23` and an observed major version of exactly 22;
- pnpm exactly `10.14.0`; and
- an actual Google Chrome or Chromium binary whose observed version begins `110.`.

The engine range, package-manager declaration, lockfile/tool observation, browser executable, and structured records must agree. Version parsing ambiguity or an engine bypass blocks release.

Node `24.x` with pnpm `10.14.0` and packaged Playwright Chromium `151.0.7922.34` is development-only evidence. It may diagnose failures and exercise the same local checks under an explicitly named local command, but its nodes are marked `developmentOnly: true`, cannot satisfy or parent a release PASS prerequisite, cannot clear Node 22 or Chrome 110 blockers, and cannot generate trusted final disposition. No generic `--ignore-engines` or browser-version override exists.

## 11. One command and fail-closed orchestration

`pnpm verify:project1` is the only official entry point. It checks the release engine first, creates the disposable workspace, performs frozen bootstrap, switches to offline verification, builds once, freezes and digests the candidate, runs all static/test/browser/reproducibility checks under their declared network modes, performs the isolated audit, imports and verifies Chrome 110/review evidence, creates and round-trips the deterministic archive, validates the complete graph, and emits the final disposition last.

The command stops at the first unsafe precondition and may continue independent checks only to collect failures; it never emits PASS when any required check failed. Signals, timeouts, test skips/only markers, zero-test selections, warning downgrades, missing tools, unavailable registry, inaccessible evidence, unexpected workspace mutation, candidate mutation, archive drift, or cleanup failure produce nonzero exit. Cleanup removes disposable plaintext/test artifacts and does not delete preserved signed evidence. Secrets and raw exception/server bodies are redacted from output.

Historical task commands remain developer diagnostics but are not alternate Project 1 release gates. `verify:project1` names every preserved test set explicitly or proves its inclusion through a strict checked manifest, so a renamed/missing suite cannot disappear silently.

## 12. Documentation reconciliation and residual risks

Before final disposition, strict documentation tests reconcile the implemented source, production manifest/CSP/permissions, package scripts, evidence schemas, and candidate inventory against:

- `docs/security/threat-model.md`;
- `docs/security/invariants.md`;
- `docs/security/release-checklist.md`;
- relevant runtime/dependency/cryptographic architecture documents; and
- the Task 11 and current Task 12 approved designs.

The threat model must cover stolen encrypted storage, weak passwords, KDF resource exhaustion, nonce misuse, interrupted writes, rollback, migration corruption, QR bombs, malicious imports, clipboard leakage, HOTP races, Ente server compromise, metadata exposure, and service-worker restart. Invariants and checklist language must describe current Project 1 behavior, exact tools, candidate identity, evidence reuse, network modes, and hard blockers; obsolete “future” claims about implemented OTP/clipboard/fill/Ente behavior fail reconciliation.

The final review explicitly accepts or blocks these residual risks: JavaScript/browser memory cannot guarantee zeroization; weak user passwords remain guessable subject to the bounded KDF/throttle design; a compromised browser/OS can defeat extension isolation; clipboard and filled-page values become observable to the OS/page as disclosed; Ente observes account/timing/size metadata and its server/API is a compatibility dependency; its lack of transactional CAS requires reconciliation/conflict handling; service-worker termination and network timeout create bounded uncertainty; dependency/audit registries and reviewer-key governance are external trust dependencies; and Chrome 110 evidence does not predict every later browser behavior. None permits seed disclosure, unauthenticated storage acceptance, silent conflict/loss, candidate substitution, audit bypass, or undocumented authority.

## 13. Three phases

### Phase 1 — Gate primitives and RED boundary evidence

Define exact schemas for the candidate, archive, scanner findings/allowlists, network-mode records, and unified evidence graph by extending Task 12 evidence primitives. Add failing assertions for content, popup, Ente, crypto/storage, source-secret, and candidate-secret boundaries. Add disposable-workspace, exact-tool, frozen-install, offline enforcement, deterministic-walk/archive, and evidence-parser tests. Phase 1 passes only when every required failure is observed for the intended reason and the implementation inventory shows no duplicate Task 12 Chrome/reviewer mechanism.

### Phase 2 — Single-candidate orchestration and GREEN evidence

Implement the generic scanner, narrow allowlists, network-mode runner, clean installer, one-build candidate freezer, deterministic archive, consolidated boundary suite, evidence DAG, and `pnpm verify:project1`. Bring all focused Project 1 tests to GREEN against the one candidate, including migration field/fixed-time preservation, tamper failure, interruption generation retention, backup round-trip, exactly-once HOTP, and OTP-only Ente rejection. Phase 2 passes only under offline/mock/audit separation with reproducible candidate and archive identities and no unresolved finding.

### Phase 3 — Official environment, reconciliation, and disposition

Run the complete command in the disposable environment under Node 22 and pnpm 10.14.0; attach the established same-digest Chrome 110 node and trusted Ed25519 review node; reconcile security/architecture docs and residual risks; verify the deterministic archive round-trip and complete evidence graph; then emit the sole final disposition. Node 24/Chromium 151 results remain development-only. Any unresolved blocker emits no PASS and stops Project 1 release. No Git operation is performed.

## 14. Acceptance criteria

Project 1 is release-gate complete only when `pnpm verify:project1` exits zero from a clean disposable frozen installation and the final canonical evidence graph proves:

- exact Node 22, pnpm 10.14.0, and Chrome 110 release evidence;
- one unchanged complete `dist/` candidate digest across every applicable node;
- source and candidate secret scans with no unallowlisted finding and no broad/unused allowance;
- all content/popup/Ente/crypto/storage boundaries and Task 13 roadmap outcomes passing;
- bootstrap/offline/mock/audit network policy compliance;
- byte-identical deterministic build and archive, with archive-to-candidate round-trip;
- valid reused same-candidate Chrome 110 and trusted Ed25519 independent-review evidence;
- production audit success with no known vulnerability;
- reconciled documentation and explicitly reviewed residual risks; and
- one final `PASS-PROJECT1-RELEASE` root with no missing, failed, orphaned, contradictory, or untrusted prerequisite.

Every other outcome is a release failure.