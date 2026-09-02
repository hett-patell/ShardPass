# Project 0 and current Project 1 security invariants

**Review date:** 2026-08-21  
**Applies to:** maintainable Project 0 foundation, implemented current Project 1 source, and fresh `dist/` output

These are security contracts, not descriptions of the preserved ShardPass 1.2.1 artifact. Project 1 OTP storage, clipboard copy, click-to-fill, import, migration, backup, and OTP-only Ente sync are implemented. Phase 1 assertions do not by themselves approve a release; the Task 13 candidate and evidence gate is required.

## Project 1 Task 13 release invariants

- `pnpm verify:project1` is the only release command. Node `>=22.14.0 <23`, pnpm 10.14.0, and an actually observed Chrome 110 are exact blockers. `pnpm verify:project1:local-node24`, Node 24, and Chromium 151.0.7922.34 are development-only and cannot create or parent a `PASS-PROJECT1-RELEASE` root.
- One frozen production candidate has identity `{ name, version, candidateDigest }` under `ShardPass packaged candidate v1\0`. All scans, tests, Task 12 Chrome/reviewer imports, archives, and final disposition bind the same `candidateDigest`; mutation or substitution stops release.
- The generic scanner uses deterministic `source` and `candidate` modes. An allowlist exception must bind one exact scanner/schema version, mode, rule, normalized file path, complete-file SHA-256, exact-match SHA-256/range/count, and approved rationale. Broad, overlapping, duplicate, stale, unused, or cross-mode allowances are forbidden; candidate output uses the empty allowlist.
- A disposable declared-input copy and frozen install precede checks. Network authority is mutually exclusive: `bootstrap` allows one recorded HTTPS registry origin, `offline` allows none, `mock` allows loopback only, and `audit` allows only the exact production audit endpoint and `pnpm audit --prod`.
- The deterministic archive is rooted at `ShardPass-<version>/`, uses timestamp `1980-01-01T00:00:00Z`, modes 0644/0755, raw DEFLATE level 9, bytewise paths, and no symlink, executable bit, owner/group, comment, or extra field. Two generations and extraction must reproduce exact bytes and identity.
- The canonical evidence DAG requires bootstrap, offline-static, source-scan, build, candidate-scan, project1-tests, mock-browser, deterministic-build, archive, audit, docs, task12-chrome110, task12-review, and one final root. Missing external review, trust, Chrome, audit, network isolation, cleanup, or consistent hashes is `STOP-PROJECT1-RELEASE`.

Residual risks—best-effort JavaScript memory clearing, weak-password guessing, browser/OS compromise, page/OS visibility of intentional fill/clipboard values, Ente metadata/API/CAS/restart/network uncertainty, registry availability, reviewer-key governance, and Chrome 110 coverage limits—are accepted only as documented limitations. None authorizes seed disclosure, unauthenticated storage, silent loss/conflict, candidate substitution, audit bypass, or undocumented authority.

## Current Project 0 invariants

### No secret handling in Project 0

Project 0 must not create, unlock, decrypt, import, migrate, capture, generate, persist, display, copy, or fill a real password, OTP seed/code, recovery value, or cryptographic key. Tests use non-secret foundation fixtures only. `vaultAvailable` remains `false`.

### No whole-vault response

No runtime command may return a whole vault, whole decrypted collection, encryption key, or unrestricted secret-bearing model to a popup, vault page, content script, or page. Project 0 returns only fixed foundation status. Future commands must return the minimum item or page-scoped projection authorized for the current action.

### No raw errors or logs

No raw `Error`, exception message, stack, arbitrary error interpolation, user-controlled value, page content, vault field, or secret may cross a message boundary or enter a security event/log. Responses use allowlisted codes and fixed user-safe text. Production code must not use `console.log`; future diagnostics use typed, non-secret event fields.

### No remote fonts

Fonts, scripts, styles, icons, and executable resources must not load at runtime from remote URLs. Preferred Inter Tight and IBM Plex Mono may ship only as reviewed local assets with redistribution license text; until then approved system fallbacks are used.

### Versioned, validated, authorized messages

Every message is runtime-validated with a strict schema and explicit version. The background authorizes browser-owned sender context and command-specific context before work. Invalid and unauthorized requests fail closed with safe errors. Adding a command requires schema, policy, response-minimization, and negative tests.

### Enforced no-runtime-network boundary

Extension-page CSP is exactly `script-src 'self'; object-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'`. Inline executable code, remote executable/resources, unshadowed dynamic code generation, computed dynamic imports, unsafe-eval policies, remote HTML resources, and recognized JavaScript network sinks with remote or computed destinations are forbidden and scanned. Static packaged relative/root-local URLs remain permitted. The picker style element lives in a page Shadow DOM and is governed by the host page's CSP rather than this extension-page policy; the production Project 0 content entry is inert and never injects it.

### Inert broad-match content entry

While `<all_urls>` remains in the Project 0 manifest, the production content entry performs no page inspection, UI injection, message, storage, network, or secret operation. Test-only picker invocation must not enter `dist/` or become a web-accessible production feature.

### Least manifest authority

The only Project 0 API permission is `storage`. There is no host permission, optional host permission, externally connectable surface, clipboard, idle, alarms, tabs permission, or runtime network allowlist. Any permission change requires an updated rationale, threat model, manifest tests, and review.

### Legacy artifact preservation

The root ShardPass 1.2.1 package is a behavioral reference, not clean source. Clean code must not import or edit it, and builds write only to `dist/`. Removal or replacement needs separate migration approval and parity evidence.

## Current Project 1 and future Project 2 release invariants

### Click-to-fill is the implemented OTP default

Implemented Project 1 OTP release to a page requires explicit user selection. Page-load autofill and automatic form submission are absent. Implemented clipboard copy releases one selected OTP only and is not a substitute for the sender-bound direct fill path. Password fill remains future Project 2 scope.

### Origin revalidation before future secret release

Immediately before every future secret response or fill, background authority must revalidate the live tab, frame, document, URL, HTTPS policy, item origin policy, navigation state, lock/session state, and initiating user action. Discovery-time or picker-open origin checks are insufficient. A mismatch, navigation, stale document, unsupported frame, HTTP downgrade, or lock event fails closed.

### Projection and lifetime minimization

Content and UI contexts receive only the selected fields needed for one operation, never a decrypted vault. Secret projections and derived values must not be retained beyond their operation, placed in logs/accessibility labels/snapshots, or persisted outside the encrypted storage design.

### JavaScript zeroization limitation

JavaScript cannot guarantee physical memory zeroization: strings are immutable, engines copy/move values, garbage collection is nondeterministic, and browser/OS copies may remain. Future code should reduce references and overwrite mutable byte buffers where practical, but documentation and UI must not claim guaranteed erasure. Locking limits logical access; it does not prove every physical copy vanished.

### Destructive and portable-data safety

Future migration verifies the new copy before source deletion. Delete, reset, overwrite, plaintext export, and recovery-changing operations require explicit consequence-specific UX and tests. Portable encrypted backup/export and documented recovery semantics must exist before depending on new hosted sync.

## Project 1 Task 11 safe OTP fill invariants

- Discovery is bounded per pass/frame and remains in the frame's light DOM. Explicit `autocomplete="one-time-code"` is authoritative for otherwise eligible fields; heuristic matches require verification context, and PIN/postal/card/phone/search/coupon/date-style negatives override weak signals.
- The picker opens only from an explicit inline trigger beside the currently focused eligible field. Suggestions are bounded metadata only, favorite-first, locally searchable, and never ranked or filtered by page origin. No code is released before explicit account selection.
- Every capability/release is random, bounded, short-lived, single-attempt, and exact extension/tab/frame/document/origin/field/item-revision/session bound. Lock, restart, navigation, document/frame or element replacement, expiry, ambiguity, and authorization mismatch fail closed.
- Content never receives seeds, full records, current HOTP counters, notes, algorithms, roots, keys, repository or crypto objects, session epochs, or low-level durable HOTP reservation authority.
- HOTP increments exactly once only after confirmed successful native setter and standard events. Duplicate confirmation is idempotent; failures cancel; uncertain durable outcomes use receipts and are not optimistically retried.
- Fill targets one exact live input through the owner-realm native setter. It never submits, presses Enter, clicks a page control, advances focus, automatically opens, automatically selects an account, or retries a replacement element.
- Released codes, seeds, page values, raw URLs, selectors, labels, opaque capabilities, and release identifiers must not enter logs, errors, test names, screenshots, snapshots, accessibility text, storage, clipboard, analytics, or built artifacts. Synthetic fixtures and extension-owned synthetic vault data are the only test inputs.
- The page can observe the value and standard events intentionally delivered to it. Closed Shadow DOM is encapsulation rather than a secrecy boundary. JavaScript cleanup is best effort, and local serialization/authenticated-root validation is not cross-process CAS.

## Project 1 Task 9.5 OTP/image import invariants

- Image input is local trusted-vault-page input only. No camera/live capture, runtime network request, host permission, clipboard permission, popup surface, or content-script command is added.
- The page rejects encoded input over 8 MiB before reading or creating a Worker. One dedicated single-use module Worker receives only version, opaque request ID, and an owned transferable buffer; timeout is at most ten seconds and every terminal path aborts/terminates and accepts no late result.
- Encoded QR image support is exactly static PNG. JPEG, WebP, GIF, SVG, APNG/multiframe content, and unsupported native decoder environments fail with fixed errors. No main-thread pixel decode fallback is allowed.
- A maintained bounded PNG reader uses only the signature and first IHDR to reject a declared dimension over 4,096 per axis or an overflow-safe 16,777,216 pixels before native `ImageDecoder` construction. It does not establish unique/authoritative IHDR, structural validity, CRCs, or chunk ordering.
- `ImageDecoder` may parse, process, or allocate during construction, `completed`, or `tracks.ready`, before explicit frame decode or dimension comparison. Conflicting later metadata may therefore expose the native decoder to larger dimensions. The 8 MiB byte cap, Worker, ten-second termination, native limits, and cleanup mitigate but do not strictly bound native allocation or decompression.
- With complete input, Worker `ImageDecoder` metadata must expose exactly one selected, non-animated, one-frame track before explicit decoding. Frame zero must decode completely; coded and display dimensions must equal first-IHDR preflight dimensions. Only the subsequent ShardPass-owned `OffscreenCanvas` and JavaScript-visible RGBA allocation is strictly bounded by those dimensions.
- `jsQR` runs once over bounded RGBA and returns only its first deterministic decodable result. Multiple-symbol images are unsupported and may select one symbol; they are not promised rejection or enumeration. Strict text detection, safe preview, and explicit confirmation remain required.
- Worker responses have strict version/request-ID/exact-field schemas and only bounded payload or fixed `IMAGE_INVALID`, `IMAGE_LIMIT`, or `QR_NOT_FOUND`. Raw library/native errors are never reflected.
- Encoded and pixel buffers are overwritten best-effort, decoder/frame resources are closed, and references are dropped. Immutable strings, native/browser copies, garbage collection, and physical memory are not claimed zeroized. Image bytes, pixels, QR text, URI, seeds, and candidates never enter logs, errors, preview projection, DOM, persistence, telemetry, fixture filenames, or accessibility text.

## Project 1 Task 10 encrypted-backup invariants

- Backup v2 is strict canonical UTF-8 JSON with the exact version-2 header, canonical padded Base64, validated Argon2id v19 work factors, fresh 16-byte salt, fresh 24-byte nonce, and XChaCha20-Poly1305 ciphertext authenticated with the canonical header bytes as AAD. Outer bytes, ciphertext, items, journal, tombstones, and existing domain fields are bounded before expensive or persistent work.
- Portable plaintext contains only current OTP item fields, canonical lock settings, and bounded logical journal/tombstone history. It excludes DEK/KEK material, wrapped keys, roots/manifests/encrypted records, transaction state, Ente state, HOTP pending reservations/receipts, session epochs, and capabilities.
- The authorized `shardpass-export` version-1 wrapper is import-only. It maps supported TOTP/HOTP/Steam items, drops Ente state, uses documented safe lock defaults, and represents unavailable history as empty; no legacy export exists.
- Backup and current passwords stay in the trusted full-vault page and its local KDF Worker. Runtime messages carry only a document/challenge-bound current-password KEK proof or bounded portable data; popup and content contexts have no backup authority.
- Export requires fresh current-password step-up, a random one-use snapshot capability, a separate backup password, and local decrypt/reparse/canonical-payload self-verification before a direct-anchor object-URL download is offered. The URL is replaced/revoked on every terminal lifecycle path; no `downloads` permission is used.
- Import is unlocked, full-vault, local-file-only. Preview is write-free and secret-redacted. Preview capabilities are random, one-use, in-memory, five-minute, exact extension/vault URL/browser `documentId`/session/root bound, bounded per document and globally, and invalidated by cancel, confirmation, expiry, lock, document replacement, service-worker restart, or disposal.
- Confirmation reloads authenticated items/settings/history under local mutation serialization, reclassifies all rows, preserves the maximum HOTP counter, and requires reconfirmation if any item/settings/history result changed. A successful confirm uses exactly one stage/verify/activate generation path; preactivation interruption leaves the authenticated old generation complete and retry does not duplicate logical history.
- Authenticated generation `lock-settings` metadata is authoritative. Standalone settings are a post-activation runtime projection reconciled on setup/unlock. Projection failure does not make a committed import uncommitted and no projection atomicity is claimed.
- Local serialization and authenticated-root checks are not cross-process CAS. Active-root write ambiguity or unexpected external-root crossing fails closed and may lock; the implementation does not promise recovery from compromised browser/storage/OS state.
- Mutable owned buffers are overwritten and references dropped where practical, but immutable strings, structured-clone/native copies, garbage collection, and physical memory are not guaranteed zeroized. Fixed safe errors and reviewed counts/statuses must not expose passwords, keys, raw backup bytes, filenames, item fields, seeds, or parser/crypto/storage details.

## Enforcement and change control

The evidence baseline is `tests/security/`, package and application unit tests, `tests/browser/`, dependency-cruiser, build security scanning, dependency audit, and manual review of permissions/build artifacts/screenshots. A test passing does not waive review. Any invariant exception requires an approved design update, threat-model change, narrowly scoped implementation, and evidence before release.

## Project 1 Task 5 current invariants

- Encrypted Task 4 storage is active; plaintext passwords stay in trusted-page fields and the dedicated KDF Worker, while canonical Base64 KEKs cross only document-bound privileged messages. Mutable Worker/background KEK byte arrays are overwritten in `finally`; immutable strings and physical memory are not claimed zeroized.
- The DEK is background-memory-only. Lock increments a monotonic epoch first, clears DEK/challenges/root allowances, cancels alarms, and wins against setup, unlock, rotation, activation, alarm, idle, external root change, and restart.
- Every command relying on unlocked state authenticates the exact active root. Local root deletion, malformed data, or an unrecognized replacement locks. Intentional setup/rewrap activation is preactivation-cancellable and narrowly allowlisted.
- Challenge request and completion require the same browser-owned extension ID, exact URL/context, and document ID. Popup/vault cross-use, same-path distinct-document use, and replay fail closed.
- Failed/locked operations do not count as activity. Successful setup/unlock/rotation and intentional unlocked commands schedule according to off/5/15/30/60; explicit lock and off cancel.
- Throttle state is strict/versioned, saturating, finite, rollback-conservative, and malformed-state conservative; success clears it.
- Runtime state ports accept only exact popup/vault documents, broadcast transitions, clean up listeners, and treat disconnect/restart conservatively. Password change and lock settings exist only in the full vault; popup exposes lock only once unlocked.

This paragraph is historical Project 0 scope. Current Project 1 implements OTP, bounded content projections, clipboard copy, explicit OTP fill, and OTP-only Ente sync under the current invariants above; password-login autofill remains outside Project 1.

## Project 1 Task 5 round-two invariants

- Root write allowance is scoped to one exact candidate and always removed. Actual root authentication and expected-root update precede publication; reconciliation locks on ambiguity.
- Lock marks the epoch before queuing cleanup. A root already being written may commit, but its response explicitly reports `committed: true, state: locked`; cancellation before commit does not claim persistence.
- All MV3 event work awaits one readiness barrier. Initialization failure yields stable `VAULT_UNAVAILABLE`; disposal suppresses delayed initialization, alarms, publication, and subscriber work.
- Credential cooldown checks and success/failure mutation are serialized. State publication has one read in flight, at most one trailing read, monotonic revision, and isolated subscribers.
- Trusted pages keep one port/timer, use bounded retry, remain unavailable/loading on query failure, ignore stale revisions, and clear every password field when ownership ends or the component unmounts.

## Project 1 Task 5 round-three publication invariants

- `StatePublisher` exclusively allocates random worker `streamId` and increasing positive `sequence`; the cached immutable object is shared by query and port delivery.
- One stream/sequence always means one snapshot. Port state is primary; query is timeout fallback and cannot race an independently recomputed state.
- Snapshot read failure preserves dirty state, retries with one timer/one read and bounded exponential delays, then emits strict `vault.stateUnavailable`. Publication never changes command outcomes and disposal cancels retries.

## Project 1 Task 5 round-four publication invariants

- State query authorization is performed by the common router before publisher access; unauthorized senders cannot observe cached state.
- New subscribers receive cached events only when the publisher is clean. Dirty or in-flight refresh never emits stale cache.
- The authoritative latest cache is the `VaultStateEvent` union. Terminal unavailable is immutable, sequenced, cached, and delivered to reconnects; query retries or rejects rather than returning an older state, and later success supersedes it.

## Project 1 Task 12 Ente OTP sync

ShardPass pins the Ente compatibility contract to `ente-io/ente@c69dcf66704ad7ec1f95e32920455be429a566ef` and permits only `https://api.ente.io`. Synchronization is OTP-only (TOTP, HOTP, Steam), fixed-origin, background-owned, and active only while connected and unlocked on connect/restart/unlock/manual/exact 15-minute alarm triggers. The extension CSP is exactly `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.ente.io; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'`; `'unsafe-eval'`, custom servers, redirects, cookies, telemetry, WebSockets, and remote executable resources remain forbidden.

Reusable credentials, Auth-key material, mappings, bases, pending operations, uncertainty, and conflicts are confined to authenticated encrypted vault generation metadata. The full-vault UI receives bounded counts, times, masked email, and opaque expiring capabilities only; popup is summary-only; content scripts have no Ente authority. Memory cleanup is best effort and does not substitute for logical invalidation on lock, restart, replacement, disconnect, or stale async ownership. Disconnect is local-only: it does not delete local or remote OTP records, cannot undo a possibly dispatched request, and performs no network request. The API has no cross-device transactional CAS; snapshot reconciliation and explicit conflicts contain concurrent/uncertain writes but cannot provide impossible atomicity.

Production uses exact `libsodium-wrappers-sumo@0.8.4` with forced `libsodium-sumo@0.8.0` (ISC) and the Phase 1-selected exact SRP dependency. This is not an independent libsodium integration audit. Any protocol, dependency, CSP, WASM graph, endpoint, scheduler, or origin upgrade requires the complete Task 12 compatibility, integrity, packaged-browser, security, and license review again.
