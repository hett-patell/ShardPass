# Project 1 Task 13 Phase 1 execution ledger

Date: 2026-08-21
Scope: Phase 1 only. No Git operation was performed. This ledger does not claim Project 1 release approval; Phases 2 and 3 remain unimplemented.

## Task 1.1 — generic source/candidate scanner

RED:

- `pnpm exec vitest run tests/tooling/project1-secret-scanner.test.ts`
- Exit 1: `Cannot find module '../../scripts/scan-secrets.mjs'`.
- The test existed before scanner production code and exercised the requested scanner contract.

GREEN:

- `pnpm exec vitest run tests/tooling/project1-secret-scanner.test.ts && pnpm typecheck && pnpm lint`
- 30 scanner tests passed; typecheck and lint passed after test typing cleanup.
- Candidate validation after fresh build: `node scripts/scan-secrets.mjs dist candidate config/project1-secret-allowlist.json` passed and scanned 40 regular files.

Implemented evidence:

- Generic streaming scanner with source/candidate modes and fixed safe error categories.
- Deterministic bytewise POSIX traversal; complete-file and exact-match SHA-256 evidence; no matched bytes in findings or CLI output.
- Symlink/nonregular/unknown/malformed/oversized/path-collision/unstable-Unicode rejection.
- Explicit text, PNG, WASM, and ZIP classification with bounded reads.
- PEM, bearer, `otpauth`, serialized secret, Base32 seed, entropy, secret logging, source-map, environment-file, test-helper, fixture, candidate test artifact, candidate allowlist, and candidate remote-executable rules. Source lexical rules that are not reliable after minification remain source-mode rules; candidate mode retains robust literal and production-artifact rules and is paired with the existing AST/build scanners.
- Canonical exact allowlist parser. Entries bind schema/scanner version, mode, rule, exact path, full-file hash, match hash, byte range, count, and enumerated rationale; duplicate/overlapping/unused entries fail.
- Empty production allowlist; synthetic canaries require independently exact entries and candidate output forbids copied allowlists.

Review result: no runtime dependency, network access, executable loading, broad allowlist, matched secret output, or Project-specific filename dependency in generic rules. Task 12 remains the sole reviewer/Chrome trust implementation.

## Task 1.2 — consolidated Project 1 boundaries

RED:

- `pnpm exec vitest run tests/security/project1-boundaries.test.ts tests/security/build-output.test.ts tests/security/executable-policy.test.ts tests/security/ente-network-policy.test.ts tests/security/ente-credential-canaries.test.ts tests/tooling/dependencies.test.ts`
- Exit 1: consolidated suite initially could not import its not-yet-integrated messaging boundary; after resolving the local module, intended assertions exposed popup password-change authority and failed the no-submit expression.

GREEN:

- Same focused command plus `pnpm dependencies` passed: 6 files, 294 tests; dependency-cruiser reported 0 violations.
- Final consolidated suite has 9 tests covering content/popup negative authority, strict browser-owned sender identity, exact document requirements, minimized OTP fill and Ente state, no auto-submit, exact manifest/CSP/host/WASM policy, and no direct content/popup crypto/storage/repository primitive imports.
- `vault.changePassword` is now vault-document-only; its existing focused messaging test was updated to assert the narrowed policy.

Review result: content receives only metadata suggestions and one selected short-lived OTP code; it cannot request seeds, URIs, whole records, backup, migration, Ente credentials/actions, passwords, keys, repositories, roots, generic crypto, or low-level HOTP. Popup retains summary/code/lock authority but not change-password, backup, migration, import, or Ente management authority. No production authority was added.

## Task 1.3 — initial threat and invariant reconciliation

RED:

- `pnpm exec vitest run tests/security/docs.test.ts`
- Exit 1: 18 assertions failed because the Project 0-centered documentation lacked the required current Project 1 threat records and release-evidence limits.

GREEN:

- `pnpm exec vitest run tests/security/docs.test.ts`: 34 tests passed.
- `pnpm format:check`: passed after Phase 1 files were formatted and immutable approved Task 13 authority/canonical JSON were explicitly excluded.

Implemented evidence:

- Threat records now state asset, attacker capability, boundary, implemented mitigation, residual risk, and concrete evidence for stolen encrypted storage, weak passwords, KDF exhaustion, nonce misuse, interrupted writes, rollback, migration corruption, QR/native decoding bombs, malicious imports, clipboard leakage, hostile-page fill/HOTP races, Ente compromise/metadata/CAS uncertainty, service-worker restart, candidate substitution, registry/network modes, and reviewer-key governance.
- Invariants describe implemented OTP copy/fill/import/migration/backup/Ente behavior as current while leaving password fill future.
- Documentation explicitly states Phase 1 is not release approval; Node 24 and Chromium 151 are development-only, and mocks/static targeting/source inspection cannot replace observed Chrome 110 evidence.

## Consolidated verification and self-review

PASS:

- Focused Phase 1: 8 files, 358 tests.
- Full Vitest: 125 files, 1,640 tests.
- Full security plus legacy: 14 files, 347 tests.
- Production output security tests: 2 files, 8 tests.
- `pnpm typecheck`.
- `pnpm lint`.
- `pnpm format:check`.
- `pnpm dependencies`: 317 modules, 885 dependencies, 0 violations.
- `pnpm build:security`: fresh production build and existing build scanner passed.
- Generic candidate scanner: 40 files passed.
- Trust-primitive search found `createPublicKey`/Ed25519 reviewer verification only in `scripts/task12-release-evidence.mjs`; Phase 1 introduced no duplicate trust store, signature, or Chrome 110 implementation.

Observed intermediate issue and resolution:

- Running `node scripts/scan-build.mjs` against a stale `dist/` left by full tests failed three existing executable-policy checks. A fresh `pnpm build:security` regenerated the candidate, after which build scanning and the generic candidate scan passed. This demonstrates that an ambient mutable `dist/` is not release evidence; Phase 2 must provide the planned one-build immutable-candidate orchestration.

Known limits/blockers:

- Verification ran on Node 24.18.0 with pnpm 10.14.0. Node emitted the expected unsupported-engine warning because official release requires Node >=22.14.0 <23. These results are development evidence only.
- No official Chrome 110 run, immutable candidate, disposable frozen install, network-mode isolation, archive, evidence DAG, audit, external review import, or `PASS-PROJECT1-RELEASE` was attempted; those belong to Phases 2 and 3.
- Vite emitted existing nonblocking bundling/chunk warnings; no security test or build scanner failure remained.

Disposition: Phase 1 implementation and its local development verification pass. Project 1 release disposition remains STOP until the remaining approved plan phases and official environment evidence pass.

## Phase 1 scanner review remediation — 2026-08-21

The consolidated read-only review identified eight Important findings. All were addressed without entering Phase 2 or performing Git operations.

Scanner and allowlist evidence:

- Candidate mode now detects context-bound serialized password/seed/token fields, Base32 seed values, and suspicious entropy in actual minified JS/JSON/HTML while rejecting reviewed production grammar such as autocomplete values, validation prose, and the public Base32 alphabet.
- Every admitted text member is canonical BOM-free, NUL-free strict UTF-8 through a fatal decoder. UTF-16LE/BE BOMs, UTF-8 BOM, invalid/overlong sequences, and embedded NUL fail closed; findings retain original UTF-8 byte ranges.
- ZIP handling now parses real central/local records for stored and raw-deflate members, validates CRC, names, duplicate/path traversal, sizes, entry count, compression ratio, truncation, and nesting depth, and recursively scans supported members. Fake signature-only ZIPs and malformed/bomb inputs fail.
- Allowance intervals are grouped by mode/path and reject containment or partial/cross-rule intersection while permitting adjacency.
- Reports now have exactly the nine planned keys. Deep verification checks nested exact keys, lowercase hashes, safe paths, bounds/counts, deterministic sort, duplicates, mode agreement, status, and exact allowance records; the undocumented `files` field was removed from runtime and declarations.
- `scripts/generate-project1-secret-allowlist.mjs` provides review (`pnpm scan:secrets:allowlist`) and explicit write (`pnpm scan:secrets:allowlist:write`) commands. It scans only declared `tests/tooling`, permits only explicit test/fixture paths, emits exact canonical entries, and rejects stale output. The committed allowlist currently binds 28 findings. `pnpm scan:secrets:source` passed over 12 files with every allowance consumed. Production `src`/`dist` paths cannot be generated.
- A fresh candidate scan used a temporary canonical empty allowlist and passed 40 files; candidate mode therefore requires zero allowances.

Boundary and threat evidence:

- The consolidated boundary suite now invokes the generic source scanner and verifies that only exact source-mode scanner canaries are consumed.
- Current Project 1 assets no longer appear as future assets. The stale blanket future-work statement is explicitly historical, nonexistent crypto/HOTP/clipboard/fill/Ente evidence paths were corrected, and documentation tests now require every concrete backticked evidence file to exist.

Verification evidence:

- Focused scanner/boundary/docs: 3 files, 79 tests passed.
- Full Vitest: 125 files, 1,644 tests passed.
- `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` passed.
- `pnpm dependencies`: 317 modules, 885 dependencies, zero violations.
- Fresh `pnpm build:security`: production build, 8 output-security tests, and existing build scan passed.
- Generic source scan: 12 files, 28 exact allowances consumed, zero findings.
- Generic candidate scan: 40 files, canonical empty allowlist, zero findings and zero allowances.

Environment limitation remains unchanged: these are Node 24.18.0 development-only results. No Phase 2 archive/orchestration/evidence DAG, official Node 22/Chrome 110 release run, audit, or release PASS was attempted.

## Candidate scanner grammar remediation — 2026-08-21

- RED: the new focused candidate regression failed against the prior broad `key: "literal"` grammar. It reproduced all three observed false positives without an allowance: `type:"password"` metadata in dist VaultAccess input props, a Base32 validation assignment through `t.secret`, and the UI conditional label `"Reveal secret"`.
- GREEN: candidate serialized-secret matching now requires an object-style literal property assignment — a recognized sensitive key preceded by `{` or `,`, followed by `:` and a non-benign quoted literal. Source-mode serialized detection remains unchanged. This excludes HTML/UI prop `type`, property access assignments/messages, and labels while retaining recognized sensitive literal fields.
- Regression coverage added to `tests/tooling/project1-secret-scanner.test.ts`: the three false-positive contexts produce a clean candidate report, while minified JS, JSON, and HTML object/config fields with alphabetic password, token, passphrase, API-key, and Base32 secret values remain detected.
- Verification: focused scanner test passed (43 tests); fresh `pnpm build` then `node scripts/scan-secrets.mjs dist candidate config/project1-secret-allowlist-empty.json` passed 39 files with zero allowances; `pnpm scan:secrets:source` passed 12 files after regenerating the exact test allowlist (50 allowances); `pnpm lint` and `pnpm format:check` passed. Canonical minified empty-allowlist JSON was added to Prettier ignores, consistent with the existing canonical generated allowlist policy.
- No Phase 2 work or Git operation was performed.

## Phase 2 — immutable candidate, frozen workspace, network modes, archive, and evidence DAG — 2026-09-01

Scope: Phase 2 only. No Phase 3 package alias/final release verification and no Git operation.

Strict TDD RED record:

- Task 2.1 RED was established by running the planned focused evidence command before the new module existed; the import failed for absent `scripts/project1-release-evidence.mjs`. New adversarial coverage subsequently exercised Task 12 digest compatibility, canonical JSON, symlink rejection, complete required-kind DAG validation, and development-only ancestry rejection.
- Task 2.2 RED was established before the workspace module/config existed; the focused test import failed. Coverage now checks canonical declared inputs, exact regular-file copying, mutation detection, symlink and ambient `NODE_PATH` rejection, exact Node/pnpm/frozen-install command, HTTPS registry, and cleanup.
- Task 2.3 RED was established before the network runner existed; the focused test import failed. Coverage now checks absent isolation, offline deny, exact bootstrap registry, loopback-only mock, exact audit command, policy escape, timeout, and nonzero failure.
- Task 2.4 RED was established before candidate/archive modules existed; the focused test import failed. Coverage now checks stale removal, exactly one marked build, staged atomic candidate preservation, post-freeze mutation/symlink failure, deterministic no-overwrite ZIP bytes, outside-candidate output, truncation failure, and round-trip candidate identity.
- Task 2.5 RED was established before the orchestrator/test manifest existed; the focused test import failed. Coverage checks strict release/development runtime separation and malformed/renamed command manifest rejection before copy/build.

Implemented evidence:

- `scripts/project1-release-evidence.mjs` and declarations provide stricter complete-tree validation while delegating identity to unchanged `computeTask12Candidate`; exact canonical node schemas; sorted typed edges/artifacts; candidate/future/development/status/path/hash/cycle/orphan/final-root checks; and immutable imports through the existing Task 12 Chrome 110, reviewer approval, trust-store, and Ed25519 verification functions.
- `config/project1-release-inputs.json` and workspace helpers copy only declared exact inputs to an OS-private temporary root, reject special/symlink/collision/excluded inputs and ambient `NODE_PATH`, snapshot all regular source bytes, create an isolated empty store, require Node >=22.14 <23 and pnpm 10.14.0, and invoke only `pnpm install --frozen-lockfile` against one exact HTTPS registry origin.
- The network runner has four mutually exclusive modes and requires an `os-network-isolation-v1` adapter with fail-closed capability/status/attempt evidence. Offline permits no endpoint, mock permits one loopback origin, bootstrap permits one registry origin, and audit permits only `pnpm audit --prod` with registry audit policy. No permissive fallback exists.
- Candidate creation removes stale output, builds once into staging, validates it, atomically renames it to preserved `dist`, computes Task 12-compatible identity, records all file hashes/sizes/modes, marks files read-only, and detects later path/byte/mode changes.
- The dependency-free ZIP writer uses fixed raw DEFLATE level 9, UTF-8 flag, DOS 1980-01-01 00:00 timestamp, bytewise order, explicit 0755 directories/0644 files, no comments/extras/owner/group/symlink/executable bits, exclusive atomic output, fixed root `ShardPass-<version>/`, CRC-32, bounded strict parser, exact inventory, and round-trip candidate recomputation.
- `config/project1-release-tests.json` and `scripts/verify-project1-release.mjs` define the unified injectable evidence-producing order without adding Phase 3 package aliases. The orchestrator checks runtimes, disposable frozen bootstrap, offline source/static checks, one candidate build/freeze, candidate scan/tests, mock browser, scratch determinism, audit, same-candidate Task 12 imports, two equal archives plus round trip, docs, final digest/DAG, and cleanup. Development mode never constructs a final PASS root; direct Phase 2 CLI fails closed pending Phase 3 wiring.

GREEN and review evidence:

- Focused Phase 2 plus unchanged Task 12: 5 files, 28 tests passed.
- Phase 2 gate-focused set: 5 files, 18 tests passed.
- `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` passed.
- Fresh `pnpm build:security` passed its production build, 8 output tests, and build scanner.
- Reproducible build passed: 38 files with identical SHA-256 bytes.
- Fresh candidate scan passed 40 files using `config/project1-secret-allowlist-empty.json`. An attempted scan with the source-test allowlist correctly failed closed as `SECRET_SCAN_UNUSED_ALLOWANCE`, proving source allowances cannot silently satisfy candidate mode.
- Candidate/archive smoke generation produced a deterministic archive and successfully recomputed candidate identity from extraction.
- Task 12 legacy evidence tests remained green; no new Chrome command, trust store, reviewer schema, signature parser, `createPublicKey`, or Ed25519 implementation was introduced.

Known environment limits and disposition:

- Verification ran under Node 24.18.0 with pnpm 10.14.0, so it is development evidence only. No official Node 22/Chrome 110 external evidence, production audit, or Task 13 final PASS was claimed.
- Phase 3 remains intentionally unimplemented: no `verify:project1` package aliases, no final documentation reconciliation, and no official final verify invocation.
- Disposition: Phase 2 implementation and local focused/static/build/repro/candidate/archive evidence are green. Project 1 release disposition remains STOP until Phase 3 and the official external release environment pass.

## Phase 2 review remediation — 2026-09-01

The initial Phase 2 review found that injectable or optional operations could produce PASS-shaped nodes without proving the operation, evidence nodes admitted empty and kind-incomplete artifact sets, candidate directories were not frozen, and the direct CLI did not own executable release operations. Corrections were applied without Phase 3 aliases or Git operations.

Corrections:

- The production CLI now owns bootstrap, checks, source and candidate scans, candidate build, independent rebuild, audit, Task 12 import, archive, and final graph verification. Production candidate construction no longer accepts a build callback. Operation injection exists only in `tests/tooling/project1-candidate-harness.ts`, which production scripts do not import.
- Network operation results use exact hash-bound schemas. Missing, malformed, empty-output, timeout, nonzero, and request-hash-mismatched results fail. Linux offline execution uses an OS network namespace through bubblewrap, unshare, or firejail and fails closed when none works. Bootstrap, audit, and mock external modes require an independently enforcing wrapper with exact policy and actual-attempt output; no process-level fake is accepted by the production CLI.
- Bootstrap is routed through the network runner against one exact HTTPS registry, records actual observed attempts, and binds source pre/post snapshots. Candidate scanning always invokes the real scanner, validates a nonzero canonical report, and persists it.
- Candidate files are chmod 0444 and directories chmod 0555 bottom-up. Evidence records before/after freeze digests. The independent rebuild invokes production candidate construction again at a separate output path and compares full candidate identity and every content hash/size/path.
- Evidence verification requires nonempty, hash-valid, kind-specific artifacts: source/candidate scan reports; candidate manifest; build output and inventories; normalized test reports rejecting zero pass, failure, skip/pending/todo, and `.only`; network logs; audit; reproducibility; archive and archive report; and Task 12 Chrome, disposition, review report, signature, and trust-store references.
- Adversarial network tests now cover omitted, malformed, empty, and request-hash-unbound fake results. Existing archive tests use the isolated test-only build harness. Evidence tests construct every mandatory artifact kind and continue to cover hash replacement through graph verification.

Focused verification:

- Phase 2 focused set: 5 files, 18 tests passed.
- `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` passed.
- Environment remains Node 24.18.0, so no release PASS, production audit, external Chrome 110 evidence, or Phase 3 action was attempted. The production external-network runner intentionally remains blocked unless `SHARDPASS_NETWORK_WRAPPER` names an absolute independently enforcing wrapper.

## Phase 2 remaining review remediation — 2026-09-01

Addressed without Phase 3 or Git operations:

- Task 12 external reviewer approval is now schema version 2 and its exact signed canonical bytes must contain the ordered, closed scope `content-popup-authority`, `Ente`, `crypto-storage`, `migration-import-backup`, `clipboard-HOTP`, `scanner-allowlist`, `clean-install`, `network-modes`, `archive`, and `orchestration`. Missing, reordered, renamed, or extra scope fails signature approval parsing. No external approval evidence was created; changes are verifier types, templates/tests only.
- The release-input manifest is schema version 2 and closed-world at repository top level. Every observed top-level path is classified as included or explicitly generated/excluded, including `.npmrc`, `pnpm-workspace.yaml`, configs, the accidental generated `--output`, `dist`, stores, test output, and TypeScript build info. Unexpected roots and omitted package/lock inputs fail. Workspace evidence now records sorted individual file hashes and isolated store identity in addition to source pre/copy/post digests.
- Archive verification independently regenerates canonical bytes from the frozen candidate and requires byte-for-byte equality before parsing/round trip. Adversarial tests mutate prefixes/trailers/truncation, EOCD central size, UTF-8 flags, methods, timestamps, and CRC fields; all fail. This makes canonical writer metadata, central/local order, offsets, names, sizes, bounds, and exact EOCD end binding independent of acceptance of an alternate ZIP encoding.
- Candidate test harness and production freeze both chmod all files `0444` and every directory recursively `0555`; focused tests substantively inspect root and nested modes.
- A real Linux network conformance test executed the production bubblewrap namespace adapter and proved descendant DNS, IPv4, IPv6, loopback, and subprocess probes were denied. `unshare` was present but not permitted; bubblewrap was available and functional. The test consumes child output and does not treat self-reported isolation as enforcement.

Verification:

- RED was observed for the new signed scope parser, closed-world manifest, recursive test-harness directory freeze, and noncanonical ZIP mutations before implementation.
- Focused remediation: 6 files, 33 tests passed.
- `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` passed.
- Fresh `pnpm build:security` passed, including 8 production-output tests and build scanning.
- Reproducible build passed with 40 byte-identical files.
- Fresh candidate secret scan passed 40 files with the canonical empty allowlist.

Accurate blockers:

- Results remain development-only on Node 24.18.0; official release requires Node >=22.14.0 <23, pnpm 10.14.0, and externally observed Chrome 110.
- No external reviewer report/signature/trust evidence exists, therefore Task 12 import and the Task 13 final root remain impossible by design.
- External bootstrap/audit/mock modes remain blocked without an absolute independently enforcing `SHARDPASS_NETWORK_WRAPPER`; only the offline Linux namespace conformance was executable locally.
- No Phase 3 alias, final release invocation, external production audit, or Git operation was performed.

## Phase 3 — official scripts, documentation, local verification, and disposition — 2026-09-01

Implemented:

- Added exactly `verify:project1` and `verify:project1:local-node24`. The official alias performs the exact engine check first and is the only package script that requests `--mode=release`; the local alias explicitly requests development mode. `check-engine.mjs` admits only the exact new helper name and retains fixed Node 24 development-only warning behavior.
- The production CLI now observes pnpm from the invoking package-manager user agent, observes the actual browser executable (`TASK12_CHROME_EXECUTABLE` for release; packaged Playwright Chromium for development), defaults only the recorded npm registry and loopback mock origins, uses OS-temporary Task 13 output, and fails with fixed blocker categories. Official Node 24 invocation stops at the engine blocker before evidence. Local Node 24 observes Chromium 151.0.7922.34 and stops at `NETWORK_EXTERNAL_POLICY_UNAVAILABLE` because no independently enforcing wrapper exists.
- Canonical `config/project1-release-tests.json` remains exact/minified and is explicitly excluded from Prettier rewriting. Disposable input collection now excludes nested workspace `node_modules` links as generated dependency state while retaining symlink rejection for declared source inputs.
- README, threat model, invariants, release checklist, runtime boundaries, dependency policy, permissions, and cryptographic-format documentation now state current Project 1 behavior and the exact candidate/scanner/frozen-bootstrap/four-network-mode/archive/evidence-DAG/Task 12 reuse/runtime/reviewer/audit blockers. Stale current-state Project 0 assertions were converted to explicit history.
- Added cross-document executable assertions and exact package-script/engine-allowlist tests. The source scanner allowlist was regenerated after the Phase 2 test-only candidate harness became a reviewed scanner canary source; candidate mode still uses the canonical empty allowlist.

Development verification (Node 24.18.0, pnpm 10.14.0, Chromium 151.0.7922.34; never release evidence):

- Phase 3/release/docs/boundary focused set: 8 files, 83 tests passed. Earlier combined Phase 3 set: 7 files, 73 tests passed.
- Full Vitest: 127 files, 1,718 tests passed, zero skipped/only/failures, with exact pnpm 10.14.0 available to subprocesses.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and dependency-cruiser (317 modules, 885 dependencies, zero violations) passed.
- Fresh `build:security` passed production build, eight output-security tests, graph inventory, and semantic build scan.
- Packaged Playwright suite passed 37 tests on development Chromium 151, including browser/security/legacy Project 1 paths; this does not satisfy Chrome 110.
- Reproducibility passed with 40 byte-identical candidate files. Generic source scan passed 19 files with 51 exact test allowances consumed. Candidate scan passed 40 files with zero allowances.
- Candidate/archive/evidence/network/workspace focused tests passed. No Task 13 ZIP, PASS root, Chrome record, reviewer report, signature, trust record, or external audit record was written.

Fail-closed disposition and blockers:

- `pnpm verify:project1` exited nonzero at the precise Node blocker: local Node 24 is outside `>=22.14.0 <23`; it recommended only `verify:project1:local-node24` for development evidence.
- `pnpm verify:project1:local-node24` emitted the fixed development warning, observed the exact local browser/runtime, then exited nonzero at `NETWORK_EXTERNAL_POLICY_UNAVAILABLE` before bootstrap because `SHARDPASS_NETWORK_WRAPPER` is absent.
- Official release additionally remains blocked by absent Node 22, actual Chrome 110 executable/evidence, canonical external reviewer trust store, complete signed external review/disposition bytes, and isolated production audit endpoint evidence. Established Task 12 files were consumed read-only only when present; none exists locally and none was generated.
- Final disposition is `STOP-PROJECT1-RELEASE`. No `PASS-PROJECT1-RELEASE`, external record, release archive, production request, Git operation, or change to product authority occurred.


## Final review remediation — production source closure and evidence intervals — 2026-09-01

Implemented only the two requested final findings; no build-isolation, Phase 3, release, or Git work was performed.

- Added a canonical closed production-source manifest and deterministic closed staging scanner. It covers release-owned app source/manifests/package files, package source/package files, declared production scripts, root package/workspace/lock/npm/Vite/TypeScript/ESLint/dependency configuration, and current security/architecture documents. Generated dependencies, build output, tests, legacy generated material, and separately declared test-only helpers/generators are outside the closed set.
- Production source scanning uses the canonical empty allowlist and emits five reports bound by one manifest/report object. `scan:secrets:source` now runs this production scan first, then separately verifies the exact tests/tooling canary allowlist. Per-root injected Bearer canaries prove every closed root fails independently.
- Evidence nodes retain mandatory `startedAt` and `finishedAt`; release operations now capture the clock immediately around execution rather than sharing one timestamp. The injected clock must be monotonic, each interval rejects `finishedAt < startedAt`, and graph verification rejects prerequisites finishing after a child starts. Declarations and focused tests were updated.

Verification on development Node 24.18.0 with pnpm 10.14.0 (not release evidence):

- RED observed: production scanner module absent; prerequisite temporal inversion returned the wrong validation category.
- Focused Vitest: 3 files, 49 tests passed.
- Production empty-allowlist scan passed 260 files: apps 104, packages 103, production scripts 30, root config 14, current security/architecture docs 9; zero findings and zero allowances. Separate tooling self-test scanned 18 files and consumed 47 exact canary allowances.
- `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` passed.
- Node emitted the expected unsupported-engine warning because this development environment is Node 24; no release disposition is claimed.

## Final review remediation — isolated candidate and independent rebuild — 2026-09-01

Implemented only the final two Task 13 findings; no Phase 3 invocation, release disposition, archive, external evidence, or Git operation was performed.

- Production candidate construction now runs the exact Vite build plus production-graph inventory through `runInNetworkMode` in offline OS network isolation. The build receives a private disposable HOME, explicit output path, pnpm offline settings, and a closed environment that omits ambient credentials, proxy variables, `NODE_PATH`, and the invoking HOME.
- `buildAndFreezeCandidate` no longer launches any command or removes caller output. It accepts only an existing dist and exact hash-bound isolated-build evidence, verifies the dist identity, freezes every file read-only and directory read-only, and binds the network request/result hashes into the candidate manifest.
- Build and deterministic-build evidence now require network-log artifacts. Evidence commands state the actual Vite, inventory, offline install, frozen store, and second-workspace operations rather than claiming a scratch build.
- Reproducibility now creates a second complete disposable workspace from the same closed release-input manifest and source snapshot, requires a distinct parent/workdir, reuses the same isolated pnpm store after bootstrap, performs an offline frozen install, runs the exact isolated production build there, and compares complete candidate identity and content inventory. The former create/copy/delete fake scratch sequence was removed.
- Focused tests cover fake-isolation success, absent isolation failure, ambient environment stripping, denied network probes, existing-dist freezing, malformed evidence, mutation detection, source mismatch, shared store identity, and distinct workdirs.

Verification on development Node 24.18.0 with pnpm 10.14.0 (not release evidence):

- RED observed: production offline build API was absent; candidate freezing still spawned an unrestricted build; independent rebuild workspace helper was absent.
- Focused Vitest: 5 files, 26 tests passed.
- `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` passed.
- Fresh `pnpm build:security` passed, including 8 production-output security tests and build scanning.
- `node scripts/verify-reproducible-build.mjs` passed with 38 files having identical SHA-256 bytes.
- The expected unsupported-engine warning remains because this development environment is Node 24. No production release gate or Phase 3 command was run.


## Final three Task 13 review findings — 2026-09-01

Implemented without Git, push, release invocation, or external evidence generation:

- Production source eligibility is executable and closed per root: app package/source/entry HTML, package package/source excluding exact test paths, production script modules excluding an exact permitted test-only set, recognized root configuration names, and current architecture/security documents. The scanner bytewise-compares the actual eligible set with every manifest group, rejects missing eligible or stale/ineligible declarations, and requires the exact disjoint test-only exclusion list. `--write` regenerates the canonical manifest. Tests inject unlisted files into each root class and a stale manifest entry.
- Task 12 Chrome parsing/validation and reviewer disposition/trust/signature verification have separate clock intervals and operation hooks. Finalization records `validate pre-final evidence graph and bind root`: it validates a provisional final-root graph inside the recorded interval, constructs the immutable final node afterward, and verifies the complete graph outside the claimed interval.
- Evidence verification parses canonical schema-versioned artifacts by kind rather than accepting arbitrary nonempty bytes. It checks source-scan aggregate counts and empty allowlist reports, network modes/endpoints/request and output hashes, candidate identity/inventory, workspace/source/rebuild bindings, normalized test pass/fail/skip/todo/only counts, build output/inventory, archive hashes/roundtrip, exact production audit endpoint/command/zero prohibited vulnerabilities, reproducibility, and Task 12 structured evidence. Cross-artifact bindings reject mismatched outputs, inventories, source snapshots, archives, and candidates. Fixtures contain substantive valid artifacts and tampering is rejected.

Development verification (Node 24.18.0, pnpm 10.14.0; not release evidence):

- Focused Task 13 tooling: 3 files, 49 tests passed.
- Production source closure scan passed 261 eligible files: apps 104, packages 103, production scripts 31, root config 14, current architecture/security docs 9; zero findings.
- `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` passed.
- `pnpm build` passed with the existing Vite chunk-size and dependency `use client` warnings.
- No Git or push operation was performed.

## Final Task 13 production tools source-closure remediation — 2026-09-01

Implemented only the requested production-tools source-closure finding; no Git, push, release, or unrelated work was performed.

- Added the closed `tools-production` source root to executable eligibility and the canonical manifest. It currently contains every regular file under `tools/**`: `tools/ente-srp-vite-plugin.ts` and `tools/security/executable-policy.ts`. There are no tools test-only files to exclude; the existing exact permitted test-only declaration remains unchanged.
- Closure tests now inject an unlisted `tools/security/unlisted.ts` and reject it, inject a stale/ineligible `tools/zz-stale.ts` manifest declaration and reject it, and exercise a Bearer-token canary in `tools-production` through the per-root canary loop.
- Production scanning continues to require the canonical empty allowlist. The tooling test-source canary allowlist was regenerated canonically after its source test changed and contains 47 exact allowances.

Development verification on Node 24.18.0 with pnpm 10.14.0 (not release evidence):

- Production source plus tooling self-scan passed: 263 production files total, including 2 `tools-production` files, with zero production findings and zero production allowances; 18 tooling files passed with all 47 exact test allowances consumed.
- Focused scanner Vitest passed: 1 file, 44 tests.
- `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` passed.
- `pnpm build` passed with the existing nonblocking Vite dependency-directive and chunk-size warnings.
- The direct post-build `scan-build.mjs` candidate check initially exposed the known ambient-build issue (`computed-global-dynamic-code-access` in the Google migration worker). The authoritative fresh `pnpm build:security` path then passed the production build, 8 output-security tests, and build scan; the empty-allowlist candidate secret scan passed 40 files.
- The expected unsupported-engine warning remains because this development environment uses Node 24 rather than the required Node 22 release environment. No release disposition is claimed.
