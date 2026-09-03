# Project 0 and current Project 1 threat model

**Review date:** 2026-08-21  
**Scope:** the clean-room Project 0 foundation and the implemented current Project 1 vault, OTP, import, backup, fill, and Ente boundaries emitted to `dist/`

## Scope and security posture

Project 0 is a maintainable Manifest V3 foundation, not a password manager release. Project 0 does not handle real secrets: it does not create, unlock, decrypt, import, capture, store, display, copy, or fill credentials or OTPs. Its only request returns a fixed, non-secret foundation status. The content script declared for arbitrary web pages is an inert production entry.

Project 0 remains historical foundation scope. Project 1 vault/OTP storage, clipboard copy, click-to-fill, migration/import, portable encrypted backup, and OTP-only Ente sync are implemented current behavior and are assessed below. Password login/autofill remains outside Project 1. Implemented controls are credited only where concrete source and tests exist; Phase 1 is not a release decision.

### Assets and boundaries

Current assets include extension integrity, trusted UI identity, browser-owned sender metadata, vault ciphertext and keys, bounded decrypted item projections, OTP seeds/codes, encrypted recovery material, clipboard contents, local extension storage availability, build provenance, and user confidence. Password-login credentials and password autofill remain future scope; the historical Project 0 foundation handled only the fixed non-secret response.

Trust boundaries are: page/extension isolated worlds; each page frame/document; content script/background messaging; extension UI/background messaging; extension process/Chrome storage; source/dependency/build output; browser profile/operating system; and user/irreversible action.

## Implemented Project 1 OTP/image-import boundary

Task 9.5 accepts only a browser-delivered local encoded file in the trusted full-vault extension page; it adds no camera, clipboard-read, host, or network authority. The page rejects more than 8 MiB before read/transfer and gives a fresh owned buffer to a single-use dedicated Worker with a fixed ten-second timeout, abort, response schema/request ID, capture-once settlement, termination, and fixed errors.

Only PNG is admitted. A maintained bounded byte reader obtains dimensions from the PNG signature and first IHDR before native decoding and rejects a first-IHDR claim over 4,096 per axis or 16,777,216 total pixels. It does not prove that IHDR is unique or that later encoded data agrees. Chrome's Worker `ImageDecoder` is then the encoded-format and frame-metadata authority: after complete buffering and track readiness, the Worker requires exactly one selected, non-animated, one-frame track, decodes only frame zero, requires a complete frame and matching coded/display dimensions, and only then allocates an `OffscreenCanvas` and JavaScript-visible RGBA readback. That application-owned canvas/RGBA allocation is strictly bounded by the checked dimensions. There is no manual PNG chunk parser, no independent claim that every PNG CRC or ordering rule is checked, and no `createImageBitmap` or main-thread fallback. Unsupported ImageDecoder, malformed/native-rejected input, APNG/multiframe content, JPEG, WebP, GIF, and SVG fail closed.

The native image decoder, canvas allocation/readback, and the older exact-pinned `jsQR` decoder remain attack surfaces. `ImageDecoder` may parse, process, or allocate native resources during construction, `completed`, or `tracks.ready`, before the explicit `decode()` and before ShardPass can compare frame dimensions. Duplicate or conflicting IHDR data could make the native decoder act on dimensions larger than the bounded first-IHDR claim before mismatch rejection. The 8 MiB encoded-byte cap, dedicated Worker, ten-second termination, browser-native limits, and cleanup mitigate impact, but they do not strictly bound native allocation, decompression work, or memory-safety exposure. The dimension/pixel cap strictly bounds only ShardPass's later `OffscreenCanvas` and JavaScript-visible RGBA allocation. `jsQR` is invoked once and returns its first deterministic decodable symbol; images containing multiple symbols are unsupported and are not guaranteed to be rejected or enumerated. The returned bounded text goes only to strict import detection and safe preview/explicit confirmation.

Encoded bytes and RGBA views are cleared best-effort and native decoder/frame resources are closed in `finally`; Worker termination and reference dropping limit logical lifetime. JavaScript, browser native code, garbage collection, immutable QR strings, and OS memory prevent any physical-zeroization claim. Raw images, pixels, QR text, URI, or seeds must not enter logs, errors, preview projection, DOM, storage, filenames, or telemetry. Production import code has no camera or network sink.

## Implemented Project 1 Task 11 safe OTP fill boundary

The isolated content controller executes in every matched frame and treats all page DOM, labels, events, navigation, and replacement behavior as attacker-controlled. Bounded discovery and immediate focused-field revalidation produce opaque random handles for live elements only. A closed shadow root reduces accidental page interference but is not a secrecy boundary.

The background broker returns bounded metadata-only favorite-first suggestions and releases one selected TOTP/HOTP/Steam value for at most five seconds. Capabilities are bound to Chrome-owned extension/tab/frame/document/sender URL metadata, normalized origin, exact live field handle, item revision, and session authority. Content cannot call low-level HOTP reservation commands. Confirmed success commits HOTP once; duplicate confirmation is idempotent, failure/timeout cancels, and uncertain storage outcomes reconcile through durable receipts without optimistic retry.

Residual risks remain explicit. A hostile page can observe an intentionally written field value and standard events, display deceptive fields, race mutation/navigation, or steal a value once delivered to its own input. Heuristics can produce false positives or false negatives. Browser, extension-process, or operating-system compromise remains outside this boundary. JavaScript cannot guarantee physical zeroization, and authenticated-root/local serialization does not provide cross-process CAS. Explicit user activation, immediate identity revalidation, single-attempt release, no auto-submit/focus advance, and fail-closed replacement/navigation behavior limit consequence rather than making hostile pages trustworthy.

## Current Project 1 release evidence limits

Phase 1 assertions and focused tests are development evidence, not a release PASS. Node 24 and packaged Chromium 151 are development-only and cannot satisfy the official gate. Release browser evidence requires Chrome 110 with an actual observed 110.x executable bound to the immutable candidate. Static `chrome110` targeting, mocks, and source inspection are not release evidence. JavaScript cleanup remains best effort; weak-password guessing, browser/OS compromise, page and OS visibility of intentionally filled or copied values, Ente metadata/API/CAS uncertainty, registry availability, reviewer-key governance, and Chrome 110 coverage limits remain residual risks.

## Task 13 release-pipeline threats

The production gate runs only through `pnpm verify:project1` with Node 22, pnpm 10.14.0, actual observed Chrome 110, an independently enforcing network wrapper, and complete signed external review. Node 24 and Chromium 151.0.7922.34 are development-only. One complete candidate uses `ShardPass packaged candidate v1\0`; every source-scan, build, candidate-scan, project1-tests, mock-browser, deterministic-build, archive, audit, docs, task12-chrome110, task12-review, and final DAG node binds the same `candidateDigest`.

### Build or candidate substitution

**Asset:** The exact reviewed production `dist/` tree and archive identity.  
**Attacker capability:** Introduce stale/generated inputs, mutate output after a check, swap Task 12 evidence, or exploit ambiguous archive metadata.  
**Trust boundary:** Declared source inputs and disposable build workspace to frozen candidate, external evidence, and release archive.  
**Implemented mitigation:** Closed-world regular-file copying, one build, repeated candidate hashes, exact Task 12 identity reuse, deterministic raw-DEFLATE-level-9 ZIPs with `1980-01-01T00:00:00Z` metadata, two byte-identical generations, round trip, and canonical hash-bound DAG validation.  
**Residual risk:** A compromised OS/toolchain can subvert local observations; independent reviewer and registry/tool provenance remain trusted. Candidate mutation, digest mismatch, missing edge, or cleanup failure is `STOP-PROJECT1-RELEASE`.  
**Evidence:** `scripts/project1-release-workspace.mjs`; `scripts/project1-candidate.mjs`; `scripts/project1-archive.mjs`; `tests/tooling/project1-candidate-archive.test.ts`.

### Registry and network-mode failure

**Asset:** Dependency integrity, audit validity, and tests that do not silently contact production services.  
**Attacker capability:** Redirect package/audit traffic, permit offline egress, abuse mock traffic, return malformed audit results, or make required infrastructure unavailable.  
**Trust boundary:** Gate subprocesses to independently enforced operating-system/container network policy.  
**Implemented mitigation:** Four mutually exclusive modes: `bootstrap` permits one recorded HTTPS registry origin and frozen install; `offline` permits no network; `mock` permits one loopback origin; `audit` permits only exact `pnpm audit --prod` traffic to the registry audit endpoint. Attempts and output are hash-bound.  
**Residual risk:** Registry integrity/availability and isolation-wrapper correctness remain trusted dependencies. Unavailability, malformed observation, escape, signal, timeout, or audit failure blocks rather than downgrades.  
**Evidence:** `scripts/project1-network-runner.mjs`; `tests/tooling/project1-network-runner.test.ts`; `config/project1-release-tests.json`.

### Reviewer-key governance

**Asset:** Independent approval authenticity, scope, freshness, and same-candidate binding.  
**Attacker capability:** Reuse stale or differently scoped approval, inject a key, duplicate trust entries, alter report/signature bytes, or substitute another candidate.  
**Trust boundary:** External reviewer report and detached Ed25519 signature to canonical Task 12 trust-store verification and Task 13 import.  
**Implemented mitigation:** Task 13 reuses the sole Task 12 parser/trust primitive and requires exact report, signature, Chrome-evidence hashes, active in-window unique trusted key, full ordered Project 1 scope, and identical `candidateDigest`. Missing evidence must be regenerated only through established Task 12 commands.  
**Residual risk:** Trusted-key custody, revocation timeliness, reviewer competence, and Chrome 110 coverage are governance limits. They never authorize a bypass or local fabrication.  
**Evidence:** `scripts/task12-release-evidence.mjs`; `scripts/project1-release-evidence.mjs`; `tests/tooling/task12-release-evidence.test.ts`; `tests/tooling/project1-release-evidence.test.ts`.

The final canonical status is `PASS-PROJECT1-RELEASE` only when all nodes verify; every other result is `STOP-PROJECT1-RELEASE`. Best-effort memory clearing, weak-password guessing, browser/OS compromise, intentional page/clipboard observability, Ente metadata/API/CAS/restart/network uncertainty, registry availability, reviewer-key governance, and Chrome 110 scope remain residual risks. None permits seed disclosure, unauthenticated storage, silent loss/conflict, candidate substitution, audit bypass, or undocumented authority.

## Initial Project 1 threat records

### Stolen encrypted storage

**Asset:** Vault ciphertext, authenticated root, wrapped keys, and OTP records.  
**Attacker capability:** Copy or replace extension storage while the vault is locked.  
**Trust boundary:** Browser storage and operating system to the authenticated vault repository.  
**Implemented mitigation:** Argon2id-derived wrapping and authenticated XChaCha20-Poly1305 records fail closed on tampering.  
**Residual risk:** Weak user passwords remain susceptible to offline guessing; browser or OS compromise is outside this boundary.  
**Evidence:** `packages/storage/test/vault-repository.test.ts`; `packages/crypto/test/aead.test.ts`.

### Weak passwords

**Asset:** Password-derived key encryption key and encrypted vault confidentiality.  
**Attacker capability:** Perform offline guesses against copied encrypted storage.  
**Trust boundary:** User-chosen password to Argon2id derivation and wrapped vault key.  
**Implemented mitigation:** Bounded Argon2id parameters and explicit setup/change-password flows raise guessing cost without claiming password strength.  
**Residual risk:** A weak password can still be guessed; JavaScript cannot erase every password copy physically.  
**Evidence:** `packages/crypto/src/kdf.ts`; `apps/extension/test/background/vault-service.test.ts`.

### KDF resource exhaustion

**Asset:** Extension availability and predictable memory/CPU use.  
**Attacker capability:** Supply malformed or extreme KDF metadata through storage, migration, or backup input.  
**Trust boundary:** Untrusted serialized parameters to the dedicated KDF worker.  
**Implemented mitigation:** Strict parameter schemas, fixed bounds, dedicated workers, and fixed safe errors reject malformed work.  
**Residual risk:** Approved Argon2 work is intentionally expensive and can still cause short-lived device pressure.  
**Evidence:** `packages/crypto/test/kdf.test.ts`; `apps/extension/test/vault/legacy-kdf-worker.test.ts`.

### Nonce misuse

**Asset:** Authenticated-encryption confidentiality and integrity.  
**Attacker capability:** Trigger repeated writes, interruptions, or malformed stored envelopes.  
**Trust boundary:** Repository mutation logic to XChaCha20-Poly1305 adapters and persisted generations.  
**Implemented mitigation:** Fresh random nonces, strict authenticated envelopes, generation journals, and tamper tests prevent accepted nonce reuse evidence.  
**Residual risk:** Catastrophic random-source or browser compromise is outside the application proof.  
**Evidence:** `packages/crypto/test/aead.test.ts`; `packages/storage/test/generation-store.test.ts`.

### Interrupted writes

**Asset:** Latest durable vault generation and HOTP intent/receipt state.  
**Attacker capability:** Stop the service worker or storage operation between intent, payload, and activation.  
**Trust boundary:** In-memory transaction to browser storage durability.  
**Implemented mitigation:** Generation staging, authenticated activation, journals, and receipt reconciliation avoid optimistic success.  
**Residual risk:** Browser storage offers no cross-process CAS and restart timing can leave an explicit uncertain state.  
**Evidence:** `packages/storage/test/interruption.test.ts`; `packages/otp-storage/test/repository-committer.test.ts`.

### Rollback

**Asset:** Monotonic vault state and HOTP counters.  
**Attacker capability:** Restore a previously valid authenticated storage generation.  
**Trust boundary:** Authenticated local generations to current session ownership.  
**Implemented mitigation:** Generation metadata, session epochs, journals, and stale-revision checks detect in-session rollback ambiguity.  
**Residual risk:** Local authenticated serialization cannot prove cross-profile or OS-level anti-rollback.  
**Evidence:** `packages/storage/test/generation-metadata.test.ts`; `packages/storage/test/round1-corrections.test.ts`.

### Migration corruption

**Asset:** Legacy records and newly activated Project 1 vault.  
**Attacker capability:** Supply corrupt legacy bytes or interrupt verification/activation.  
**Trust boundary:** Preserved legacy format to the current repository.  
**Implemented mitigation:** Inspect, stage, verify, then activate; source deletion is never assumed and corruption fails closed.  
**Residual risk:** Legacy parser compatibility and user recovery remain required if source data is already damaged.  
**Evidence:** `apps/extension/test/background/migration-service.test.ts`; `packages/storage/test/legacy-v1-compatibility.test.ts`.

### QR bombs and native decoding

**Asset:** Worker availability, bounded application allocations, and imported OTP confidentiality.  
**Attacker capability:** Supply compressed, malformed, animated, or dimension-conflicting PNG input.  
**Trust boundary:** User-selected encoded file to Chrome native ImageDecoder and the import worker.  
**Implemented mitigation:** An 8 MiB cap, first-IHDR dimension/pixel bounds, single-frame checks, timeout, worker termination, and strict preview keep application-owned work bounded.  
**Residual risk:** Native decoding can allocate or process before post-decode checks; the first-IHDR check is not a complete PNG validator.  
**Evidence:** `apps/extension/src/vault/otp/import/image-import-executor.ts`; `tests/browser/project1-otp-import.spec.ts`.

### Malicious imports

**Asset:** Existing vault contents and imported OTP correctness.  
**Attacker capability:** Provide malformed URI, CSV, JSON, migration protobuf, duplicate, or oversized input.  
**Trust boundary:** Untrusted portable data to preview and explicit confirmation.  
**Implemented mitigation:** Strict bounded parsers, safe projections, duplicate review, and explicit confirmation precede one durable mutation.  
**Residual risk:** A user can explicitly confirm semantically misleading but syntactically valid labels or issuers.  
**Evidence:** `packages/importers/test/import-model.test.ts`; `apps/extension/test/background/otp-import-service.test.ts`.

### Clipboard leakage

**Asset:** A selected short-lived OTP code.  
**Attacker capability:** Read clipboard history or observe it through the OS or another application after explicit copy.  
**Trust boundary:** Trusted popup/vault action to browser clipboard and operating system.  
**Implemented mitigation:** Only one generated code is copied after explicit user action; seeds and full records never enter clipboard or logs.  
**Residual risk:** Clipboard values are visible to the browser, OS, and authorized applications; clearing cannot be guaranteed.  
**Evidence:** `apps/extension/test/platform/chrome-platform.test.ts`; `apps/extension/test/popup/PopupApp.dom.test.tsx`.

### Hostile-page fill and HOTP races

**Asset:** One selected OTP value, counter correctness, and sender-bound capability.  
**Attacker capability:** Control DOM, frames, navigation, replacement fields, events, and confirmation timing.  
**Trust boundary:** Content script to background and hostile page input.  
**Implemented mitigation:** Exact extension/tab/frame/document/origin/field/revision/session binding, short single-attempt releases, durable HOTP receipts, and no auto submit fail races closed.  
**Residual risk:** The page observes a value intentionally written to it; ambiguous durable outcomes stop rather than retry.  
**Evidence:** `apps/extension/test/content/otp/otp-fill-controller.dom.test.tsx`; `apps/extension/test/background/otp-fill-service.test.ts`.

### Ente server compromise and metadata exposure

**Asset:** OTP-only encrypted sync entities, account metadata, and local vault integrity.  
**Attacker capability:** Observe metadata, return malformed protocol data, reorder entities, or compromise the remote API.  
**Trust boundary:** Exact `https://api.ente.io` protocol adapter to the local encrypted OTP repository.  
**Implemented mitigation:** OTP-only projections, authenticated encrypted entities, strict endpoints/schemas, omitted cookies, rejected redirects, and conflict review prevent password/full-vault sync authority.  
**Residual risk:** Ente observes account and traffic metadata and service availability; API compromise can deny or reorder service.  
**Evidence:** `apps/extension/test/background/ente-real-bridge.integration.test.ts`; `tests/security/ente-network-policy.test.ts`.

### Ente CAS uncertainty

**Asset:** Durable local/remote sync intent and conflict correctness.  
**Attacker capability:** Race remote writes, drop responses, or restart the service worker around mutation acknowledgement.  
**Trust boundary:** Local durable intent to remote Ente create/update/delete acknowledgement.  
**Implemented mitigation:** Persist intent before writes, categorize create/update/delete, surface conflicts and uncertain state, and never silently retry ambiguous mutation.  
**Residual risk:** The Ente API and browser storage do not provide one shared cross-system CAS transaction.  
**Evidence:** `apps/extension/test/background/ente-coordinator.test.ts`; `apps/extension/test/background/ente-real-bridge.integration.test.ts`.

### Service-worker restart

**Asset:** Session authority, in-flight import/fill/sync operations, and durable receipts.  
**Attacker capability:** Browser restart or worker termination at any asynchronous boundary.  
**Trust boundary:** Ephemeral worker memory to authenticated persistent state.  
**Implemented mitigation:** Capabilities and sessions are memory-bound and expire; durable intents/receipts are reconciled after restart; stale completions fail.  
**Residual risk:** Restart and network timing can produce explicit unavailable or uncertain outcomes requiring user action.  
**Evidence:** `apps/extension/test/background/background-runtime.integration.test.ts`; `packages/otp-storage/test/repository-committer.test.ts`.

### Build and candidate substitution

**Asset:** Reviewed source, complete packaged output, and release identity.  
**Attacker capability:** Insert stale files, source maps, fixtures, secrets, symlinks, or substitute `dist/` after a check.  
**Trust boundary:** Source/dependencies/build process to immutable production candidate.  
**Implemented mitigation:** Phase 1 generic source/candidate scanning, packaged-output policy, deterministic traversal, and exact candidate-bound release design fail closed; Phase 2 identity/orchestration is not yet implemented.  
**Residual risk:** Phase 1 alone does not freeze one candidate or emit release evidence, so release remains blocked.  
**Evidence:** `scripts/scan-secrets.mjs`; `tests/tooling/project1-secret-scanner.test.ts`; `tests/security/build-output.test.ts`.

### Registry and network-mode failure

**Asset:** Frozen dependency provenance and offline verification integrity.  
**Attacker capability:** Compromise or redirect registry traffic, escape offline isolation, or make audit unavailable.  
**Trust boundary:** Disposable bootstrap/audit processes to the network.  
**Implemented mitigation:** The approved release design permits one recorded HTTPS registry during frozen bootstrap and separates offline, loopback mock, and exact audit modes; unavailable isolation or audit is a blocker. Phase 2 enforcement is not yet implemented.  
**Residual risk:** Registry and audit service trust/availability remain external dependencies; Phase 1 cannot claim enforcement.  
**Evidence:** `docs/superpowers/specs/2026-08-21-project-1-task-13-release-gate-design.md`; `tests/security/project1-boundaries.test.ts`.

### Reviewer-key governance

**Asset:** Independent review authenticity and candidate-bound approval.  
**Attacker capability:** Submit a forged, stale, duplicated, revoked, or wrong-candidate approval.  
**Trust boundary:** External reviewer and trust store to release disposition.  
**Implemented mitigation:** Task 12 owns strict canonical approval parsing, active-window unique Ed25519 trust, detached signatures, and candidate/hash binding; Phase 1 creates no alternate trust primitive.  
**Residual risk:** Trust-store custody, reviewer independence, key revocation timing, and scope completeness require governance outside code.  
**Evidence:** `scripts/task12-release-evidence.mjs`; `tests/tooling/task12-release-evidence.test.ts`.

## Threat records

### Malicious pages

**Asset:** Extension integrity and user trust now; future page-scoped credential and OTP projections.  
**Attacker capability:** A hostile HTTP(S) page controls its DOM, forms, navigation, events, look-alike content, and page-world script; it can attempt UI confusion and race navigation.  
**Trust boundary:** Untrusted page world to the isolated content-script world, then content script to background.  
**Project 0 mitigation:** The production content entry exports nothing and performs no DOM reads, writes, messages, or secret work. Extension pages use self-only CSP. The only background command rejects content senders.  
**Residual risk:** `<all_urls>` creates broad injection reach and future code could accidentally turn that reach into authority. Browser/OS compromise and deceptive page UI remain outside extension control. Future Projects 1/2 must treat page data as attacker-controlled, minimize projections, and revalidate the live origin immediately before release.  
**Evidence:** `apps/extension/src/content/main.tsx`; `apps/extension/src/background/router.ts`; `tests/security/manifest.test.ts`; `tests/security/csp.test.ts`; `tests/browser/extension-smoke.spec.ts`.

### Malicious frames

**Asset:** Frame/origin binding and future credentials intended for one document.  
**Attacker capability:** A hostile top frame or iframe can embed, navigate, replace, or race another frame and attempt to reuse stale document context.  
**Trust boundary:** Distinct tab/frame/document identities to background authorization.  
**Project 0 mitigation:** The manifest sets `all_frames: false`, so production injection is top-frame only. Browser-owned `tabId`, `frameId`, `documentId`, sender URL, and extension ID can be normalized for future content contexts; the current command policy allows only popup/vault contexts.  
**Residual risk:** Top-frame-only is not a complete iframe security policy, and Project 0 does not implement autofill. Projects 1/2 require an explicit same-origin/cross-origin frame policy, navigation invalidation, and fresh origin/document checks.  
**Evidence:** `apps/extension/src/manifest.ts`; `packages/messaging/src/context.ts`; `packages/messaging/src/authorize.ts`; `packages/messaging/test/context.test.ts`; `packages/messaging/test/authorize.test.ts`.

### Extension-message spoofing

**Asset:** Background authority and integrity/confidentiality of future privileged responses.  
**Attacker capability:** A compromised extension context, malformed caller, or web content reaching a content script can construct arbitrary runtime payloads and replay known command names.  
**Trust boundary:** Every runtime sender and payload entering the background service worker.  
**Project 0 mitigation:** Strict Zod schemas reject unknown/malformed envelopes; messages are versioned; sender context is built from Chrome-owned metadata; extension ID and exact extension-page URL are checked; command-specific authorization permits only popup/vault; errors are fixed safe responses. No `externally_connectable` surface is declared.  
**Residual risk:** Authorization defects or a compromised allowed extension page could issue allowed commands. Schema validity is not semantic authorization. Every future command needs least-privilege sender policy and response minimization.  
**Evidence:** `packages/messaging/src/foundation.ts`; `packages/messaging/src/context.ts`; `packages/messaging/src/authorize.ts`; `apps/extension/src/background/router.ts`; their unit tests and `tests/security/manifest.test.ts`.

### Dependency compromise

**Asset:** Source/build integrity and future secrets processed by runtime code.  
**Attacker capability:** A registry, maintainer, transitive package, install script, or build dependency may ship malicious or unexpectedly remote/dynamic code.  
**Trust boundary:** External package registry and dependency graph to developer machine and emitted extension.  
**Project 0 mitigation:** Exact versions and a lockfile are used; pnpm requires a 24-hour release age; dependencies are reviewed in `docs/architecture/dependencies.md`; dependency boundaries are checked; production output is scanned for executable-policy violations; audit is run. Runtime dependencies are deliberately small and there is no network library.  
**Residual risk:** Lockfiles and audits do not prove benign code; development dependencies execute during builds; known-vulnerability databases lag; a compromised developer machine can alter artifacts. A clean build, artifact review, and independent security review remain necessary.  
**Evidence:** `pnpm-lock.yaml`; `.npmrc`; `dependency-cruiser.config.cjs`; `tools/security/executable-policy.ts`; `tests/security/executable-policy.test.ts`; `docs/architecture/dependencies.md`; `pnpm audit --prod` results in the execution ledger.

### Cross-site scripting (XSS)

**Asset:** Extension-page authority and future unlocked vault material.  
**Attacker capability:** Attacker-controlled text may reach extension rendering or markup sinks and try to execute script or load remote resources.  
**Trust boundary:** Untrusted page/import/storage data to extension DOM and privileged extension origin.  
**Project 0 mitigation:** React renders fixed non-secret UI; extension-page CSP restricts scripts, objects, connections, images, media, fonts, and styles to self (with reviewed `data:` images); there are no inline scripts, remote scripts/styles/fonts, `eval`, or `Function`; the executable scanner checks source/output dynamic-code policy plus recognized network sinks and remote HTML resources.  
**Residual risk:** CSP is defense in depth, not sanitization. Future imports, item fields, URLs, and rich text introduce untrusted data and must use safe text rendering, validated navigation, and narrowly reviewed DOM sinks.  
**Evidence:** `apps/extension/src/manifest.ts`; `tests/security/csp.test.ts`; `tests/security/output/csp.output.ts`; `tools/security/executable-policy.ts`; UI DOM tests.

### Stolen browser profile

**Asset:** Extension settings now; future vault ciphertext, session state, and recoverable secrets.  
**Attacker capability:** An attacker can copy or read an unlocked user's Chrome profile and extension storage, or operate the profile with the user's OS access.  
**Trust boundary:** Chrome extension storage and process state to the browser profile, filesystem, OS account, and physical device.  
**Project 0 mitigation:** There are no real secrets or session keys. The `storage` permission exists for foundation evolution, but current source does not persist vault data.  
**Residual risk:** Project 0 provides no cryptographic protection because it stores no vault. Projects 1/2 must define authenticated encryption, key derivation, lock/session lifetime, migration, backup, and stolen-profile tests. An already unlocked OS/browser can still expose decrypted data.  
**Evidence:** `apps/extension/src/manifest.ts`; source search and Project 0 tests; `packages/messaging/src/foundation.ts` fixes `vaultAvailable` to `false`.

### Clipboard exposure

**Asset:** Future copied passwords, OTPs, recovery codes, and generated values.  
**Attacker capability:** Other local applications, clipboard history/sync, remote-desktop software, or a later paste target may read clipboard contents; users may paste into the wrong place.  
**Trust boundary:** Extension/user gesture to the operating-system clipboard and other applications/devices.  
**Project 0 mitigation:** No clipboard permission or clipboard API use is implemented, and Project 0 has no secrets to copy.  
**Residual risk:** Clipboard secrecy cannot be guaranteed. Future copy must be user-initiated, disclose exposure, minimize lifetime where the platform permits, avoid claiming reliable clearing, and offer direct click-to-fill as the planned default.  
**Evidence:** `apps/extension/src/manifest.ts`; `tests/security/manifest.test.ts`; source and build scans; `docs/architecture/permissions.md`.

### Shoulder surfing and visual observation

**Asset:** Current non-secret UI privacy and user trust; future displayed passwords, OTP codes/seeds, recovery material, account identifiers, item metadata, and unlocked-session state.  
**Attacker capability:** A nearby observer can watch the user's screen or keyboard; a meeting, remote-support, or malware-controlled screen-share/recording process can capture pixels over time; screenshots can preserve a transient disclosure; accessibility services and browser/OS overlays can read or duplicate rendered text and notifications.  
**Trust boundary:** Extension-rendered pixels and accessibility semantics cross into the physical environment, display hardware, browser/OS compositor, assistive technology, screenshot/recording facilities, remote sessions, overlays, and human observers.  
**Project 0 mitigation:** Project 0 renders only fixed foundation status and empty non-secret shells, never a real credential or OTP. Browser tests use non-secret fixtures and reviewed screenshots. Secret values are absent from accessible labels, snapshots, and production notifications because no secret functionality exists.  
**Residual risk:** Project 0 cannot prevent observation of even non-secret account/use context. Projects 1/2 will display or fill sensitive material and must minimize default revelation, avoid secret-bearing accessibility labels/notifications, provide deliberate reveal/copy/fill controls, consider short OTP visibility, and test screen states without recording real secrets. Nearby observers, screen sharing, recording, screenshots, accessibility software, browser/OS overlays, compromised display paths, and user-enabled capture remain outside reliable extension control. Once pixels or spoken accessibility output are observed or recorded, disclosure is irreversible; hiding or locking afterward cannot revoke the copy.  
**Evidence:** `packages/messaging/src/foundation.ts` fixes `vaultAvailable` to `false`; popup/vault DOM tests assert non-secret foundation content; `tests/browser/popup-visual.spec.ts`, `vault-visual.spec.ts`, and reviewed non-secret screenshots; `docs/security/invariants.md` prohibits secret leakage into accessibility labels and snapshots for future work.

### Destructive user error

**Asset:** Future vault items, migration source, backups, recovery capability, and user access.  
**Attacker capability:** No malicious capability is required: a user may misunderstand delete, overwrite, import, reset, export, or migration actions; deceptive UI can amplify the error.  
**Trust boundary:** Human intent to state-changing extension operation and durable storage.  
**Project 0 mitigation:** Project 0 exposes no create/edit/delete/import/export/reset operation and displays an empty foundation shell only.  
**Residual risk:** Future Projects 1/2 must add consequence-specific confirmation, reversible deletion/history where designed, verified migration before source deletion, backup/export warnings, interruption-safe writes, and recovery tests. Confirmation fatigue and loss of all recovery material cannot be eliminated.  
**Evidence:** `apps/extension/src/popup/PopupApp.tsx`; `apps/extension/src/vault/VaultApp.tsx`; `packages/messaging/src/foundation.ts`; UI and browser tests.

## Project 1 Task 10 encrypted-backup threat record

**Assets:** Portable OTP records and seeds, logical history, lock settings, current/backup passwords, KEK proof material, backup ciphertext, preview candidates/capabilities, and authenticated local generations.  
**Attacker capability:** A malicious file may be oversized, malformed, noncanonical, tampered, computationally costly, or a replayed legacy wrapper; a compromised popup/content document may forge commands; a stale/replaced vault document may replay a capability; local storage changes or interruption may race confirmation; a local observer may copy the exported file or view the UI.  
**Trust boundary:** Browser-selected local bytes and password fields enter the trusted full-vault page; strict messages cross to the background/session/repository; one encrypted file leaves through a user-gesture anchor and object URL; generations and a separate settings projection cross local storage boundaries.  
**Mitigations:** V2 enforces canonical UTF-8 JSON, exact AAD/header, Argon2id/XChaCha20-Poly1305 identifiers and bounds, canonical Base64, byte/item/history limits, and fixed errors. Legacy support is restricted to authorized import-only v1. Plaintext passwords stay page/Worker-local; only current-password KEK proof material crosses a fresh document-bound challenge. Popup/content have no backup authority. Export uses fresh backup-only salt/nonce/key material and locally decrypts/reparses/compares the generated payload before offering a bounded-lifetime URL. Import preview is write-free; random in-memory five-minute one-use capabilities bind exact extension/vault document/session/root and are invalidated on replacement, cancel, lock, completion, expiry, restart, or disposal. Confirmation reloads authenticated state, prevents HOTP regression, returns changed preview for reconfirmation, and uses one stage/verify/activate generation. Authenticated lock metadata is authority and runtime settings are reconciled after activation/on unlock.  
**Interruption evidence:** Direct storage/session tests exercise stage and verify interruption with old-root readability and duplicate-free retry, active-root write ambiguity, concurrent overlapping confirms, and external-root crossing. Packaged Chromium evidence separately exercises write-free preview, one root transition, encrypted persistence, lock redaction, and service-worker-restart invalidation; it does not inject every repository fault or settings-projection failure.  
**Residual risks:** Backup-password strength and file custody are user-controlled; an unlocked/compromised trusted vault page, browser, extension process, OS, accessibility/screenshot path, or filesystem can disclose plaintext or the encrypted file. Argon2 does not prevent all denial of service within admitted bounds. Mutable cleanup is best effort, not guaranteed physical zeroization. Local mutation serialization/authenticated-root checks are not cross-process CAS. A post-activation settings-projection failure is not atomic with the generation and requires later reconciliation. Active-root ambiguity fails closed and may lock rather than prove whether an external write committed. No independent ShardPass/Argon2 audit is claimed.  
**Evidence:** `packages/importers/src/backup/`; `packages/messaging/src/backup.ts`; `apps/extension/src/background/vault/backup-service.ts`; session/repository tests; `apps/extension/src/vault/settings/useBackup.ts`; `tests/browser/project1-backup.spec.ts`; security manifest/CSP/build-output tests.

## Review triggers

Update this model before any code handles a real secret; any permission, host match, network endpoint, web-accessible resource, external message surface, dependency, import/export path, clipboard use, frame support, or cryptographic/session behavior changes; and after a relevant vulnerability or security incident. Projects 1 and 2 cannot inherit Project 0 conclusions without new evidence.

## Project 1 Task 5 current security posture

The maintainable extension now stores authenticated encrypted vault generations locally. A master password exists only in trusted popup/vault page fields and is encoded for the dedicated Task 3 Argon2id Worker; only canonical Base64 of the resulting 32-byte KEK crosses runtime messaging. Background decodes a mutable KEK once, overwrites that buffer in `finally`, unwraps the DEK, and keeps the DEK in background memory only. JavaScript strings and engine copies cannot be guaranteed zeroized.

KDF challenges are short-lived, single-use, and bound to browser-owned extension ID, exact popup/vault URL, context, and required document ID. Setup, unlock, and password rotation are cancelled by a monotonic lock epoch after every asynchronous boundary and immediately before root activation. Explicit, alarm, idle-screen, external-root, and service-worker-restart paths leave the vault locked and clear challenges/session key references. External deletion, malformed replacement, or an unrecognized authenticated root locks through the Chrome local-storage change listener; intentional root commits are narrowly allowlisted.

Unlock attempts use strict versioned trusted-session state, saturating safe integers, bounded cooldown/deadlines, conservative handling of malformed/NaN/infinite state, and rollback detection. Successful authentication clears the throttle. Auto-lock is scheduled only after successful setup/unlock/rotation or intentional unlocked activity; failures and locked settings changes do not extend a session. Full vault security settings expose off/5/15/30/60 and screen-lock behavior plus same-document password rotation. Long-lived versioned runtime ports synchronize popup/vault state; disconnect/restart is treated as loading/locked until reconnection.

This section is a historical Project 0 snapshot. In current Project 1, OTP algorithms, bounded content-script OTP release, clipboard copy, click-to-fill, and OTP-only Ente sync are implemented and assessed in the current sections above; password-login autofill remains future work.

## Project 1 Task 5 round-two concurrency model

Intentional root activation now uses a scoped commit transaction rather than a persistent root allowlist. Only the exact candidate is ignored by the storage listener while activation is in progress; the scope is removed in `finally`. The actual active generation is authenticated after the write and before `expectedRoot` is updated or state is published. Unexpected reconciliation locks. A lock marks the epoch immediately and queues key cleanup behind a root mutation already in flight. If that write commits, setup/password rotation returns an explicit `committed: true, state: locked` outcome so the UI reports that the change persisted without silently unlocking.

Background listeners are registered synchronously for MV3 wake-up, but message, port, alarm, idle, and root work waits on one fail-closed readiness promise covering trusted session storage, persisted settings, stale-alarm clearing, and settings listener installation. State publication is a coalescing single-reader pump with monotonic revisions, one trailing read, and subscriber isolation. A throwing or disconnected subscriber cannot alter a committed command response or block another page.

Credential completions serialize cooldown check, verification, and attempt mutation, preventing concurrent failures from losing counts. Trusted pages accept only increasing state revisions during one port lifetime, reset revision on disconnect, retry one port at a time with bounded 250/500/1000/2000 ms backoff and a terminal cap, remain loading on query failure, and clear password fields on submit completion, lock/disconnect, ownership-state changes, and unmount.

## Project 1 Task 5 round-three publication authority

A dedicated `StatePublisher` is now the sole authority for live/query vault snapshots. Each service-worker lifetime receives a random 128-bit hexadecimal `streamId`; every successfully completed immutable snapshot receives one increasing positive `sequence`. The publisher caches that exact object, sends it to ports, and returns the same object to `vault.getState`, so one stream/sequence cannot describe different states. Ports are primary; trusted pages wait briefly for the initial port snapshot and only query as fallback. A new port connection may establish a new worker stream, while stale messages from an older active connection cannot override it.

A failed snapshot read preserves dirty state and retries with bounded 100/250/500/1000/2000 ms delays while a subscriber or query waiter exists. A new publication request cancels backoff and accelerates the read. After the bounded attempts, the publisher emits strict `vault.stateUnavailable` with the same stream and next sequence, leaving pages conservatively loading. Commands remain independent of publication delivery, subscriber exceptions are isolated, and disposal cancels retry timers and waiters.

## Project 1 Task 5 round-four publication hardening

Direct `vault.getState` requests now pass through the same strict router authorization as every other vault command before the publisher snapshot handler is invoked; content, wrong extension IDs, malformed contexts, and disallowed senders receive no state. Port authorization remains browser-owned and exact.

The publisher caches one authoritative `VaultStateEvent` union, not a separate last-success value. Dirty or in-flight refresh prevents immediate cached delivery to a new subscriber. Terminal retry exhaustion freezes, sequences, caches, and publishes `vault.stateUnavailable`; reconnecting subscribers receive that latest event. A direct query never returns a stale success after unavailable: it initiates a fresh bounded read and rejects on terminal failure. A later explicit publication may supersede unavailable with a higher-sequence state.

## Project 1 Task 12 Ente OTP sync

ShardPass pins the Ente compatibility contract to `ente-io/ente@c69dcf66704ad7ec1f95e32920455be429a566ef` and permits only `https://api.ente.io`. Synchronization is OTP-only (TOTP, HOTP, Steam), fixed-origin, background-owned, and active only while connected and unlocked on connect/restart/unlock/manual/exact 15-minute alarm triggers. The extension CSP is exactly `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.ente.io; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'`; `'unsafe-eval'`, custom servers, redirects, cookies, telemetry, WebSockets, and remote executable resources remain forbidden.

Reusable credentials, Auth-key material, mappings, bases, pending operations, uncertainty, and conflicts are confined to authenticated encrypted vault generation metadata. The full-vault UI receives bounded counts, times, masked email, and opaque expiring capabilities only; popup is summary-only; content scripts have no Ente authority. Memory cleanup is best effort and does not substitute for logical invalidation on lock, restart, replacement, disconnect, or stale async ownership. Disconnect is local-only: it does not delete local or remote OTP records, cannot undo a possibly dispatched request, and performs no network request. The API has no cross-device transactional CAS; snapshot reconciliation and explicit conflicts contain concurrent/uncertain writes but cannot provide impossible atomicity.

Production uses exact `libsodium-wrappers-sumo@0.8.4` with forced `libsodium-sumo@0.8.0` (ISC) and the Phase 1-selected exact SRP dependency. This is not an independent libsodium integration audit. Any protocol, dependency, CSP, WASM graph, endpoint, scheduler, or origin upgrade requires the complete Task 12 compatibility, integrity, packaged-browser, security, and license review again.
