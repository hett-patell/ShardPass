# Project 1 release checklist

Use this checklist for the implemented current Project 1 candidate. `pnpm verify:project1` is the sole official decision; historical Project 0 and Task 8–12 commands are diagnostic evidence and cannot substitute for the Task 13 gate or emit `PASS-PROJECT1-RELEASE`.

## Task 13 authoritative gate

- [ ] Use exact Node `>=22.14.0 <23` with observed Node 22 and pnpm 10.14.0. Observe an actual Chrome 110 executable. Node 24 with packaged Playwright Chromium 151.0.7922.34 is development-only.
- [ ] Supply an absolute independently enforcing network wrapper, one exact HTTPS registry origin, the canonical Task 12 trust store, and immutable same-`candidateDigest` Task 12 Chrome 110/reviewer disposition/report/detached Ed25519 signature bytes. Never generate external records from the local helper.
- [ ] Run one declared-input disposable copy and `pnpm install --frozen-lockfile`. Keep `bootstrap`, `offline`, loopback-only `mock`, and exact-endpoint `audit` modes separate; audit runs only `pnpm audit --prod`.
- [ ] Build one candidate, freeze it, and retain domain `ShardPass packaged candidate v1\0` identity `{ name, version, candidateDigest }`. Recompute before/after external imports and disposition; any mutation is a stop.
- [ ] Require exact source/candidate secret scans, strict hash/range/count/rationale allowlists, full typecheck/lint/format/dependency/Vitest Project 1 security/legacy/tooling tests, packaged browser tests, independent deterministic scratch build, audit, docs, archive, Task 12 imports, and final evidence-DAG validation. Zero/skipped/only tests fail.
- [ ] Generate the archive twice with byte-identical output: `ShardPass-<version>/`, timestamp `1980-01-01T00:00:00Z`, raw DEFLATE level 9, 0644 files, 0755 directories, no owner/group/comment/extra/symlink/executable bits, and round-trip candidate identity.
- [ ] Accept only one canonical final root whose status is `PASS-PROJECT1-RELEASE`. Every missing, malformed, stale, failed, contradictory, development-only, network-escaping, untrusted, or cleanup-failed condition is `STOP-PROJECT1-RELEASE` and writes no PASS/external record.
- [ ] Independent review scope covers content/popup authority, Ente, crypto/storage, migration/import/backup, clipboard/HOTP, scanner/allowlist, clean install, network modes, archive, and orchestration. Registry availability, reviewer-key governance, Chrome 110 coverage, memory clearing, weak-password, browser/OS, page/clipboard, and Ente metadata/API/CAS/restart/network residuals must be explicit and cannot waive security invariants.

`pnpm verify:project1:local-node24` may execute feasible local checks, but all its nodes are `developmentOnly: true`; it reports `DEVELOPMENT-ONLY` at most and never creates the final root.

## Hard blockers

- [ ] **Node.js 22 blocker cleared:** run the complete gate with the declared `>=22.14.0 <23` runtime and pnpm 10.14.0. Node 24 engine-bypass results are useful development evidence but do not clear this blocker.
- [ ] **Chrome 110 browser-evidence blocker cleared:** execute the candidate in an actual Chrome/Chromium 110 binary. Source and built CSS are statically constrained by the explicit `chrome110` target and compatibility policy, but later-Chromium evidence does not prove minimum-browser rendering.
- [ ] No open high-severity security finding, known production vulnerability, unexplained permission change, or mismatch between implementation and security docs.

## Accepted visual deviation

- [ ] Record that Project 0 uses the approved system fallback typography because verified redistributable Inter Tight and IBM Plex Mono WOFF2 assets plus license texts were unavailable. This does not block Project 0 release, but release materials must not claim preferred-font parity. Verified local assets remain a future visual opportunity; never fetch or fabricate them merely to satisfy a gate.

## Fresh, preserved build evidence

- [ ] Start from a clean workspace/dependency install using the committed lockfile; use `pnpm install --frozen-lockfile` under the pinned runtime.
- [ ] Preserve the legacy ShardPass 1.2.1 artifact (`manifest.json`, `assets/`, `icons/`, `service-worker-loader.js`, `src/popup/index.html`) byte-for-byte. Do not import it as source or package it into the clean build.
- [ ] Remove stale `dist/`, perform a fresh build, and run source plus built-output CSP/manifest/executable-policy checks. Never approve a stale artifact.
- [ ] Preserve the exact candidate output, lockfile, command output, tool/runtime/browser versions, security/audit results, reviewed browser screenshots, and hashes/packaging evidence when Task 12 supplies them. Do not rebuild silently after review.
- [ ] Confirm `dist/manifest.json` has exactly `storage`, `alarms`, and `idle`, no host/optional-host/external message grants, the exact self-only script/object/connect/image/media/font/style CSP, and an inert top-frame `<all_urls>` content entry. The approved top-level shape permits the source fields plus CRXJS-generated `web_accessible_resources` only for that reviewed inert content asset; `homepage_url` is permitted harmless metadata if later supplied. Nested action/background/content/CSP/generated-resource keys are strict. Executable page fields such as `options_ui`, `devtools_page`, `side_panel`, `chrome_url_overrides`, and `sandbox` are not approved.

## Automated checks

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm format:check`
- [ ] `pnpm test`, including documentation tests
- [ ] `pnpm dependencies`
- [ ] `pnpm build:security`
- [ ] `pnpm audit --prod` (record registry availability and findings)
- [ ] `pnpm test:browser` against the fresh candidate build, not a development server substitute
- [ ] `pnpm verify:project0` under the declared Node 22/pnpm runtime; this official gate checks the engine first, then source/static/dependency checks, a clean build and semantic output scan, all nine browser tests against that candidate, byte-for-byte reproducibility, and `pnpm audit --prod`
- [ ] If `pnpm verify:project0:local-node24` is recorded as development evidence, label it explicitly as a bypass that does not clear the Node 22 blocker

## Browser and human review

- [ ] Review browser screenshots rather than only accepting pixel matching: popup at native 360px and 200% zoom/long copy, vault desktop/compact/responsive boundaries and 200% zoom, isolated picker plus compact 200% zoom/long origin/status, visible focus, reflow, reduced motion, contrast, and no secret/test leakage.
- [ ] Confirm MV3 worker, popup, vault, fixture, and inert production content entry produce no unexpected page/worker/context console errors.
- [ ] Recheck permission rationale and store disclosures, especially the broad `<all_urls>` match and its risk.
- [ ] Reconcile threat records/invariants/runtime boundaries against source and built manifest; future plans must remain labeled as future.
- [ ] Manually inspect production output for unexpected URLs, remote fonts/resources, source maps, inline code, legacy imports, fixture strings, dynamic execution, analytics, and logs.

## External review gates

- [ ] Obtain independent code/security review for the Project 0 boundary, manifest/CSP, dependency/build policy, message authorization, safe errors, and documentation before calling the security baseline release-ready.
- [ ] Projects 1/2 require a new external security review of cryptography, storage/migration, session locking, import/export/recovery, origin/frame authorization, clipboard, and secret redaction before handling real secrets.
- [ ] Hosted sync, passkeys/WebAuthn, sharing/emergency access, recovery changes, and any enterprise secret integration each require separately scoped design, threat-model update, and external security review; Project 0 approval does not cover them.
- [ ] Record reviewer identity/scope, candidate artifact identity, findings, accepted residual risks, and closure evidence outside the artifact where access control is appropriate.

## Release decision

- [ ] Every blocker is cleared or the release is explicitly stopped.
- [ ] The approved artifact is the same artifact tested and reviewed.
- [ ] Release notes describe current Project 1 accurately: implemented OTP storage, copy, explicit click-to-fill, import/migration, encrypted backup, and OTP-only Ente sync; password-login autofill remains outside Project 1.
- [ ] The execution ledger records commands, counts, environment caveats, inaccessible research URLs if relevant, and the final go/no-go decision. No Git action is assumed while this workspace is not a repository.

## Project 1 Task 11 safe OTP fill release additions

- [ ] Run `pnpm verify:project1:task11` under Node `>=22.14.0 <23` and pnpm 10.14.0. `pnpm verify:project1:task11:local-node24` is development-only and does not clear the Node 22 blocker.
- [ ] Execute the packaged candidate in actual Chrome/Chromium 110. Later Chromium and static `chrome110` compatibility evidence do not clear the minimum-browser blocker.
- [ ] Confirm the exact 17 preserved legacy artifacts remain regular non-symlink files at pinned hashes and remain outside `dist/`.
- [ ] Confirm content injection is the exact reviewed `<all_urls>`, `document_idle`, `all_frames: true` contract, permissions remain exactly `storage`, `alarms`, and `idle`, CSP is unchanged, and no host/optional-host/network/clipboard/camera/downloads/context-menu/offscreen/external authority was added.
- [ ] Verify bounded explicit/heuristic discovery and false positives across top, same-origin, and cross-origin frames; explicit inline activation; metadata-only favorite-first suggestions/search; and TOTP, Steam, and exactly-once HOTP through the packaged UI.
- [ ] Verify exact sender/origin/document/field/item/session binding and failure behavior for lock, expiry, cancellation, navigation, frame/document or element replacement, worker restart, duplicate confirmation, failure, timeout, and uncertain HOTP receipt reconciliation.
- [ ] Verify native React-controlled input compatibility, no automatic open/selection/submit/Enter/page click/focus advance/retry, encrypted persistence, and page observability disclosure.
- [ ] Run accessibility checks and visually inspect desktop and effective-200% compact screenshots. Screenshots, test names, accessibility strings, logs, and output must contain no code, seed, page value, raw URL, label, selector, capability, or release identifier.
- [ ] Run focused browser/security checks, full serial verification, exact legacy verification, reproducible build, production audit, executable/build scanner tests, and preserve the exact evidence in the Task 11 append-only ledger.

## Project 1 Task 10 encrypted-backup release additions

- [ ] Run `pnpm verify:project1:task10` under Node `>=22.14.0 <23` and pnpm 10.14.0. `pnpm verify:project1:task10:local-node24` is development-only evidence and must not clear the Node 22 blocker.
- [ ] Execute packaged evidence in actual Chrome/Chromium 110. A passing installed later Chromium, source target, and CSS compatibility scan do not clear the Chrome 110 blocker.
- [ ] Verify the exact 17 authorized legacy artifacts remain regular non-symlink files at their pinned hashes; never edit, regenerate, rename, or include them in `dist/`.
- [ ] Verify strict canonical v2 header/envelope/AAD, Argon2id/XChaCha20-Poly1305 identifiers/work bounds, fresh salt/nonce, canonical Base64, outer/ciphertext/item/history bounds, exclusions, wrong-password/tamper behavior, legacy import-only behavior, and no manual primitive.
- [ ] Verify plaintext current/backup passwords never cross runtime messaging; current-password step-up proof and backup KDF run only through the trusted vault page's local Worker boundary; popup/content have no backup authority.
- [ ] Verify generated export self-decrypt/reparse/canonical comparison before the direct-anchor object-URL download, URL replacement/revocation, and absence of `downloads`, network, clipboard, camera, host/optional-host, or offscreen permission.
- [ ] Verify preview performs no write and exposes safe counts only; capabilities are random, one-use, five-minute, in-memory, exact vault document/session/root bound, bounded, and invalidated by replacement/cancel/confirm/expiry/lock/restart/disposal.
- [ ] Verify confirm-time authenticated reclassification, HOTP maximum counter, changed-preview reconfirmation, item/settings/history import in one stage/verify/activate generation, and duplicate-free retry after preactivation interruption.
- [ ] Verify authenticated generation `lock-settings` is authority and standalone settings projection reconciles after activation/setup/unlock. Record projection failures honestly: no cross-store atomicity or rollback of a committed root is promised.
- [ ] Record that local mutation serialization/root authentication is not cross-process CAS; active-root ambiguity and external-root crossing fail closed and may lock.
- [ ] Review DOM, accessibility tree, screenshots, logs, errors, storage, build output, filenames, and test artifacts for passwords, keys, seeds, full records, raw bodies, notes/tags/labels, or legacy markers. Mutable cleanup is best effort; do not claim guaranteed zeroization.
- [ ] Run the focused Task 10 Vitest and packaged Playwright gates, full source/static/dependency/build/security/legacy tests, byte-for-byte reproducible build, and `pnpm audit --prod`; preserve exact command/runtime/browser/count/failure evidence in the append-only ledger.
- [ ] Do not call Task 10 release-ready until independent security/code review of format, cryptography use, trusted-page/background authority, capability lifetime, import interruption, settings reconciliation, and UI secrecy is complete. No independent ShardPass or current Argon2 implementation audit is presently claimed.

## Project 1 Task 5 release additions

- [ ] Verify encrypted Task 4 setup/unlock/rotation, memory-only DEK, Worker/background KEK buffer clearing, and no plaintext-password messages.
- [ ] Verify exact document-bound challenge cross-page/cross-document/replay rejection and lock-epoch cancellation at every await/preactivation boundary.
- [ ] Verify external root deletion/malformed/replacement locking without self-write races, and dispose storage/port listeners.
- [ ] Verify activity scheduling only after successful unlocked operations; explicit/off/alarm/idle lock paths cancel and broadcast.
- [ ] Verify strict saturating throttle against maximum-safe counts, NaN/Infinity/malformed state, and backward clocks.
- [ ] Verify multi-page state synchronization, disconnect/restart conservative UI, full-vault security controls, successful rotation, and old-password rejection.
- [ ] Historical Task 5 check: permissions remain exactly `storage`, `alarms`, and `idle`; no `offscreen`. Current Project 1 OTP/copy/fill/Ente authority must satisfy the later Task 11–13 checks; password autofill remains outside Project 1.

## Project 1 Task 5 round-two checks

- [ ] Exercise storage `onChanged` between candidate root write and expected-root update, activation failure cleanup, and later external replay of the candidate.
- [ ] Block setup/rotation root writes, request lock, and verify committed-and-locked versus cancelled response truth against old/new password behavior.
- [ ] Defer/fail startup readiness and verify persisted 60-minute settings, no post-unlock stale clear, stable unavailable errors, and no delayed work after dispose.
- [ ] Run concurrent wrong credentials and verify exact fifth-failure cooldown with no lost update.
- [ ] Verify one publication read, one trailing read, increasing revisions, subscriber isolation, and no post-dispose delivery.
- [ ] Verify bounded one-port reconnect, loading on query failure, terminal context invalidation, stale revision rejection, and password-field clearing.

## Project 1 Task 12 Ente OTP sync

ShardPass pins the Ente compatibility contract to `ente-io/ente@c69dcf66704ad7ec1f95e32920455be429a566ef` and permits only `https://api.ente.io`. Synchronization is OTP-only (TOTP, HOTP, Steam), fixed-origin, background-owned, and active only while connected and unlocked on connect/restart/unlock/manual/exact 15-minute alarm triggers. The extension CSP is exactly `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.ente.io; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'`; `'unsafe-eval'`, custom servers, redirects, cookies, telemetry, WebSockets, and remote executable resources remain forbidden.

Reusable credentials, Auth-key material, mappings, bases, pending operations, uncertainty, and conflicts are confined to authenticated encrypted vault generation metadata. The full-vault UI receives bounded counts, times, masked email, and opaque expiring capabilities only; popup is summary-only; content scripts have no Ente authority. Memory cleanup is best effort and does not substitute for logical invalidation on lock, restart, replacement, disconnect, or stale async ownership. Disconnect is local-only: it does not delete local or remote OTP records, cannot undo a possibly dispatched request, and performs no network request. The API has no cross-device transactional CAS; snapshot reconciliation and explicit conflicts contain concurrent/uncertain writes but cannot provide impossible atomicity.

Production uses exact `libsodium-wrappers-sumo@0.8.4` with forced `libsodium-sumo@0.8.0` (ISC) and the Phase 1-selected exact SRP dependency. This is not an independent libsodium integration audit. Any protocol, dependency, CSP, WASM graph, endpoint, scheduler, or origin upgrade requires the complete Task 12 compatibility, integrity, packaged-browser, security, and license review again.

Task 12 final review has no default trusted reviewer. The owner must separately provision a canonical trust-store file from `.sdd/task12-reviewer-trust-store.template.json` with an active Ed25519 public key, exact reviewer ID/organization, SHA-256 SPKI fingerprint, and validity interval. The committed template intentionally has no keys and cannot approve a release. Produce evidence with `pnpm verify:project1:task12:final-review -- --review-report "$REPORT" --signature "$SIGNATURE" --trust-store "$TASK12_REVIEWER_TRUST_STORE"`. Run the release verifier with `TASK12_REVIEWER_TRUST_STORE=/absolute/owner-provisioned-reviewers.json pnpm verify:project1:task12` (or the documented Node 24 development variant). Missing/empty trust, inactive/expired keys, altered report/signature bytes, and identity or candidate/Chrome binding mismatches fail closed. Preserve the generated relative report/signature evidence files with the disposition; the release verifier independently rechecks their hashes, signature, trust, identity, status, and bindings.
