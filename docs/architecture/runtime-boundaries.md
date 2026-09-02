# Project 0 history and current Project 1 runtime boundaries

**Verified:** 2026-09-01 against maintainable source, the current manifest, and Task 13 release contracts

## Project 1 release-tool boundary

The production release orchestrator is outside extension runtime authority. `pnpm verify:project1` requires Node 22, pnpm 10.14.0, observed Chrome 110, an independently enforcing external network wrapper, and valid same-`candidateDigest` signed Task 12 review. It copies declared inputs to a disposable workspace, performs one frozen bootstrap, and separates `bootstrap`, network-denied `offline`, loopback-only `mock`, and exact-endpoint `audit` modes. No extension source receives these tooling credentials or policies.

One `dist/` candidate is identified with `ShardPass packaged candidate v1\0`, frozen, repeatedly checked, archived twice at fixed `1980-01-01T00:00:00Z` metadata, and represented by a canonical evidence DAG. Source-scan, build, candidate-scan, project1-tests, mock-browser, deterministic-build, archive, audit, docs, task12-chrome110, and task12-review nodes all bind the same candidate before the final node can say `PASS-PROJECT1-RELEASE`; otherwise disposition is `STOP-PROJECT1-RELEASE`.

The local Node 24/Chromium 151.0.7922.34 helper is development-only. It cannot write external records, cannot establish Chrome 110/reviewer trust, and cannot create a final root.

## Implemented topology

| Context                   | Project 0 responsibility                                                                                                | Inputs and outputs                                                                                                                                                                            | Explicitly absent in Project 0                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Background service worker | Normalizes Chrome-owned sender metadata, validates and authorizes the one command, and returns fixed foundation status. | Accepts version 1 `foundation.getStatus` only from exact popup/vault extension URLs; returns `foundation.status` with `phase: foundation` and `vaultAvailable: false`, or a fixed safe error. | Vault storage, keys, crypto, lock sessions, OTP, origin queries, network, clipboard, imports/exports. |
| Popup                     | Displays compact foundation state and opens the vault page through a typed platform adapter.                            | Sends non-secret status request; renders validated response/failure state.                                                                                                                    | Unlock, suggestions, OTP, capture, generation, secret copy/fill.                                      |
| Full-page vault           | Displays the empty foundation shell and status.                                                                         | Sends the same non-secret status request.                                                                                                                                                     | Item list/search/edit, settings persistence, migration, backup, recovery, secret handling.            |
| Content script            | The production entry is deliberately inert despite matching `<all_urls>` at `document_idle`, top frame only.            | No runtime behavior or message.                                                                                                                                                               | DOM discovery, picker activation, page UI, candidate collection, storage, network, fill.              |
| Isolated picker module    | Provides a closed-Shadow-DOM foundation component for direct tests/harness use only.                                    | Invoked only by test code.                                                                                                                                                                    | It is not invoked by production content entry and is not a production feature.                        |
| Pure packages             | Messaging schemas/authorization, safe error/event contracts, UI primitives, and test doubles.                           | Narrow exported APIs.                                                                                                                                                                         | Browser globals or application imports where boundary policy forbids them.                            |

## Message boundary

The platform adapter constructs raw metadata only from `chrome.runtime.MessageSender`; callers do not supply their own trusted identity. Messaging then requires the expected extension ID and one of:

- exact `chrome-extension://<id>/popup/index.html`;
- exact `chrome-extension://<id>/vault/index.html`; or
- for future content commands, an HTTP(S) URL plus browser-provided tab, frame, and document identifiers.

Project 0 authorization for `foundation.getStatus` permits popup and vault only. Content, malformed, wrong-extension, wrong-path, unexpected-field, and unsupported-version requests are rejected. There is no `externally_connectable` manifest entry.

Responses are promises of typed data. Errors are reduced to allowlisted codes/fixed messages; raw platform errors are not returned. The foundation response contains no storage data and cannot become a whole-vault channel by implication.

## Storage and browser API boundary

The built manifest declares `storage`, but current Project 0 source does not call `chrome.storage`. Direct Chrome API access is isolated to `apps/extension/src/platform/chrome-platform.ts` and runtime bootstrap code. Popup/vault components depend on `ExtensionPlatform`, which keeps browser callbacks and `runtime.lastError` outside UI code.

The adapter also uses `chrome.tabs.create` to open an extension-owned vault URL. This does not require the broad `tabs` permission because it creates a tab without reading privileged tab metadata. No page host network request is authorized by `<all_urls>` content-script matching.

## Page isolation and executable boundary

Extension pages run under `script-src 'self'; object-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'`. This Chrome-MV3-compatible policy permits only extension-local connections, media, fonts, styles, and scripts; images additionally permit `data:` for reviewed embedded assets. Production output is structurally checked for remote HTML resources and semantically checked for recognized JavaScript network sinks with remote or computed destinations, alongside inline/remote execution and dynamic-code checks. Static extension-packaged relative/root-local URLs needed by the bundler remain permitted. The picker style element is created inside a host-page Shadow DOM and is therefore governed by the host page's CSP, not extension-page CSP; Project 0 production content is inert and never injects it. A content script executes in Chrome's isolated world, but isolation is not authorization: future page data remains untrusted, and any future secret response needs live origin/frame/document revalidation in the background.

The picker uses a closed shadow root to reduce page CSS/DOM interference. That is an encapsulation measure, not a security boundary against the browser, extension, screenshots, accessibility tooling, or a compromised content script.

## Future boundary changes

Approved design assigns future vault session/crypto/storage orchestration to background, page-local discovery/fill to content, quick actions to popup, and management/import/export to full-page vault. None is implemented in Project 0. Projects 1 and 2 must add and test their own schemas, storage validation, encryption/session model, minimum secret projections, frame/origin policies, clipboard behavior, and permission rationale before release.

## Project 1 Task 11 safe OTP fill boundary

The production content controller now runs in each matched top-level and child frame. It performs bounded light-DOM OTP-field discovery, renders one closed-Shadow-DOM trigger only for the focused eligible field, and opens a metadata-only account picker only after an explicit click. The page and content script remain untrusted: suggestions contain bounded display metadata, while seeds, full records, HOTP counters, notes, keys, repository objects, session epochs, and durable reservation identifiers remain background-only.

`OtpFillService` binds suggestion capabilities and five-second releases to Chrome-owned extension, tab, frame, document, normalized sender origin, opaque live field handle, item revision, and current session authority. Navigation, replacement, lock, worker restart, expiry, and identity mismatch fail closed. TOTP and Steam are released only after account selection. HOTP reservation and receipt handling is internal to the broker; a successful native setter plus `input` and `change` confirmation increments once, duplicate confirmation is idempotent, and uncertain durable outcomes are reconciled rather than retried optimistically.

The content controller writes one exact live field through its owner-realm native setter. It never submits, presses Enter, clicks page controls, advances focus, selects an account from origin, retries against a replacement element, or persists page observations. The page can observe an intentionally filled value and standard events; closed Shadow DOM is encapsulation, not secrecy from the browser or a compromised content script. Reference clearing and mutable-byte overwriting are best effort and are not guaranteed physical zeroization. Authenticated-root checks plus local mutation serialization are not cross-process compare-and-swap semantics.

## Evidence

- `apps/extension/src/manifest.ts`
- `apps/extension/src/background/main.ts` and `router.ts`
- `apps/extension/src/platform/chrome-platform.ts`
- `apps/extension/src/content/main.tsx`
- `packages/messaging/src/`
- `packages/security/src/`
- `tests/security/manifest.test.ts`, `csp.test.ts`, and output equivalents
- message/platform/router unit tests and `tests/browser/extension-smoke.spec.ts`

## Project 1 Task 5 implemented boundary

Background owns Task 4 encrypted generation storage, root authentication, the memory-only DEK, lock epoch, challenges, throttle, alarms/idle, external-root monitoring, password rewrap, and strict state-port broadcasts. Popup and full vault own password fields and dedicated Task 3 KDF Workers; they send canonical Base64 KEKs but never plaintext passwords. The full vault additionally owns validated lock settings and password-change controls; popup may lock but does not change security settings.

Every privileged challenge is bound to Chrome-owned extension ID, exact extension page URL/context, and required `documentId`. State ports use the same browser-owned identity and switch pages to conservative loading/locked state on disconnect before reconnect/query. Chrome APIs remain isolated to `apps/extension/src/platform/chrome-platform.ts`. That content-entry statement is historical Project 0 scope. Current Project 1 activates bounded OTP discovery/release, explicit fill and clipboard copy, while OTP-only Ente remains background-owned; password autofill remains outside Project 1.

## Project 1 Task 10 encrypted-backup boundary

| Context                   | Task 10 authority and data                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trusted full-vault page   | Sole user-facing backup authority. Owns current/backup password fields, local KDF Worker execution, bounded local file reads, v2/legacy decrypt, generated-v2 self-verification, safe preview UI, explicit reconfirmation, and direct user-gesture anchor/object-URL download. It clears fields and owned jobs synchronously on replacement, cancel, lock, completion, and unmount; mutable buffers are best-effort cleanup, not guaranteed zeroization. |
| Background service worker | Authorizes the exact extension ID, vault URL, and browser-owned `documentId`; verifies current-password KEK proof; owns random one-use export/preview capabilities; snapshots authenticated portable state; reclassifies and confirms through session/repository authority; publishes only committed/import-expiry state changes. It never receives plaintext passwords or performs backup-password KDF work.                                            |
| Session/repository        | Authenticates the active root, provides owned item/settings/logical-history snapshots, serializes local mutations, enforces HOTP non-regression and changed-preview reconfirmation, and stages/verifies/activates one immutable generation. This coordination is not cross-process CAS.                                                                                                                                                                  |
| Popup and content script  | No backup command authority and no portable payload, preview token, password proof, file, or download role.                                                                                                                                                                                                                                                                                                                                              |

Export capability lifetime is five minutes, one use, in memory, and bound to the issuing document, session epoch, and authenticated root. Preview capability lifetime has the same binding and is also cancelled by document replacement, lock, completion, explicit cancel, expiry, service-worker restart, or disposal; per-document and global caps bound retained candidate state. Raw passwords never cross runtime messaging. The current-password boundary reuses the trusted page's KDF Worker and sends only canonical Base64 KEK proof material bound to a fresh background challenge. Backup-password derivation and v2/legacy decryption remain page-local.

Portable state crosses only between the trusted vault page and background under strict versioned schemas and bounds. Preview responses expose item classifications and settings/history counts, not secrets or full records. Confirmation reloads authenticated current items, generation lock settings, and logical journal, then either returns a replacement preview or commits one generation. The authenticated generation metadata is settings authority; the standalone settings service is a post-activation scheduling/UI projection reconciled on setup/unlock. A projection failure after activation cannot be rolled back and does not change the honest committed response, so cross-store atomicity is explicitly not claimed.

Preactivation stage or verify interruption leaves the prior authenticated generation active. Direct repository/session tests cover retry without duplicate item/history effects, active-root write ambiguity, concurrent overlapping confirmation, and external-root crossing; packaged Chromium evidence covers preview zero writes, one root transition, lock redaction, and service-worker-restart capability invalidation. The packaged suite does not inject projection failure or every storage interruption and is not represented as doing so.

## Task 5 readiness and state synchronization

Chrome registers top-level message/connect/alarm/idle/storage listeners synchronously, then gates their work on one readiness promise. Readiness restricts session storage, loads persisted lock settings, clears stale alarms, and installs settings listeners. State ports publish strict `vault.state` messages with monotonic per-worker revision through a coalescing pump. Port disconnect resets the page revision epoch; reconnect uses bounded backoff and query failure remains a loading/unavailable condition rather than asserting locked. Port and settings listeners are idempotently disposed.

## Task 5 authoritative state stream

Background `StatePublisher` owns state snapshot reads, caching, retry, stream identity, and sequence allocation. New subscribers receive the exact cached object or trigger one coalesced read. `vault.getState` awaits that same cache/coordinator. Trusted pages treat a port's first valid snapshot as authoritative for that connection, compare later messages only within its stream, and use direct query only after the initial port timeout. A service-worker restart creates a new stream accepted after reconnect; `vault.stateUnavailable` keeps the page in conservative loading state.

## Project 1 Task 12 Ente OTP sync

ShardPass pins the Ente compatibility contract to `ente-io/ente@c69dcf66704ad7ec1f95e32920455be429a566ef` and permits only `https://api.ente.io`. Synchronization is OTP-only (TOTP, HOTP, Steam), fixed-origin, background-owned, and active only while connected and unlocked on connect/restart/unlock/manual/exact 15-minute alarm triggers. The extension CSP is exactly `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.ente.io; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'`; `'unsafe-eval'`, custom servers, redirects, cookies, telemetry, WebSockets, and remote executable resources remain forbidden.

Reusable credentials, Auth-key material, mappings, bases, pending operations, uncertainty, and conflicts are confined to authenticated encrypted vault generation metadata. The full-vault UI receives bounded counts, times, masked email, and opaque expiring capabilities only; popup is summary-only; content scripts have no Ente authority. Memory cleanup is best effort and does not substitute for logical invalidation on lock, restart, replacement, disconnect, or stale async ownership. Disconnect is local-only: it does not delete local or remote OTP records, cannot undo a possibly dispatched request, and performs no network request. The API has no cross-device transactional CAS; snapshot reconciliation and explicit conflicts contain concurrent/uncertain writes but cannot provide impossible atomicity.

Production uses exact `libsodium-wrappers-sumo@0.8.4` with forced `libsodium-sumo@0.8.0` (ISC) and the Phase 1-selected exact SRP dependency. This is not an independent libsodium integration audit. Any protocol, dependency, CSP, WASM graph, endpoint, scheduler, or origin upgrade requires the complete Task 12 compatibility, integrity, packaged-browser, security, and license review again.
