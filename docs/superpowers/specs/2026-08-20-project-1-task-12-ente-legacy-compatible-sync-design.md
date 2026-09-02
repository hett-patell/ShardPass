# Project 1 Task 12 — Ente Legacy-Compatible OTP Synchronization

**Status:** Replacement design approved for implementation planning  
**Date:** 2026-08-20  
**Official protocol evidence pin:** `ente-io/ente@c69dcf66704ad7ec1f95e32920455be429a566ef`  
**Production API origin:** `https://api.ente.io`

## 1. Authority, supersession, and preserved history

This document is the sole design authority for Project 1 Task 12. It explicitly supersedes both:

- `docs/superpowers/specs/2026-08-20-project-1-task-12-ente-readonly-snapshot-design.md`; and
- `docs/superpowers/plans/2026-08-20-project-1-task-12-ente-readonly-snapshot.md`.

Their read-only/manual-only scope, previous commit pin, official-`ente-core-wasm` dependency decision, unchanged-CSP gate, and implementation sequence are not current requirements. They remain historical records and must not be edited or deleted.

`.sdd/project1-task12-execution-ledger.md` also remains append-only. Every existing RED result, research entry, artifact hash, and `STOP-TASK12` disposition is preserved verbatim as historical evidence. New work appends a dated “replacement design authorization” entry that cites this document and the new pin; it must never rewrite, remove, renumber, or characterize an earlier STOP as if it had not occurred. The earlier STOP correctly applied to the superseded design. It does not authorize Phase 2 under this design; only the new Phase 1 gate in §20 can do that.

The owner has explicitly approved the narrow Manifest V3 CSP source expression **`'wasm-unsafe-eval'`** for locally packaged, integrity-pinned libsodium WASM. That approval does not include `'unsafe-eval'`, `eval`, `Function`, remote code, remotely fetched WASM, arbitrary WebAssembly, or a general exception to executable-output policy.

## 2. Decision and scope

Task 12 provides bidirectional, legacy-compatible synchronization of **OTP records only** between the unlocked ShardPass vault and the one supported Ente production service. It preserves migrated ShardPass 1.2.1 Ente linkage and pending create/update/delete intent, supports current pinned Ente records, and converges through a bounded three-way merge.

The feature:

1. authenticates with the compatible Ente SRP-4096 password path and Ente TOTP second factor;
2. retrieves/decrypts the Authenticator account key;
3. downloads bounded remote changes and falls back to a complete snapshot whenever timestamp progress is ambiguous;
4. performs a base/local/remote three-way merge with explicit conflict outcomes;
5. commits the resulting local state and durable encrypted pending operations in one immutable local generation;
6. sends bounded pending creates, updates, and deletes one at a time;
7. treats every interrupted or unconfirmed mutation as uncertain and reconciles it from a complete remote snapshot before any retry; and
8. runs after connection, on extension/background restart when the vault is unlocked, on explicit manual request, and at most once per 15-minute alarm interval while unlocked and connected.

This is synchronization, not remote backup authority. Ente data is an untrusted replica of OTP records, and neither side silently becomes the content authority.

## 3. Goals

- Preserve validated migrated legacy `integrations.ente` mappings and pending create/update/delete intent without persisting legacy plaintext integration secrets.
- Preserve legacy-compatible SRP-4096 plus Ente TOTP second-factor login behavior.
- Synchronize strict ShardPass-supported TOTP, HOTP, and Steam records and no other content kind.
- Keep pending writes durable, encrypted, bounded, idempotently reconciled, and recoverable across lock, service-worker termination, browser restart, timeout, and network loss.
- Make merge behavior deterministic from a stored base projection, current local projection, and current remote projection.
- Never resolve a true three-way conflict by silently preferring local or remote content.
- Commit each accepted local merge, mappings, base projections, cursor state, and pending queue in one verified immutable generation.
- Keep network, credentials, WebAssembly, plaintext, and UI projections narrowly bounded and testable.
- Fail closed on protocol drift, dependency-integrity drift, unsupported SRP, timestamp ambiguity that cannot be resolved by a full snapshot, queue overflow, malformed records, and storage uncertainty.

## 4. Non-goals

- Passwords, login items, notes independent of an OTP record, files, photos, passkeys, recovery, signup, account/key creation, password change, 2FA enrollment, or Ente account deletion.
- Email OTT login, email MFA login, passkey login, or custom authentication branches.
- Creating `/authenticator/key`; an account without an existing Authenticator key is unsupported and remains unchanged.
- Custom, self-hosted, staging, loopback, user-entered, enterprise, or alternate Ente servers in production.
- Content-script access to Ente state, credentials, network, sync commands, conflicts, remote identifiers, or pending operations.
- Last-write-wins conflict resolution, remote-authoritative replacement, local-authoritative overwrite, or automatic destructive conflict resolution.
- Cross-device transactional CAS. The pinned API has no entity revision precondition; uncertainty and concurrent writes are contained through snapshot reconciliation and explicit conflicts, not represented as impossible.
- Guaranteed JavaScript memory zeroization.
- Continuous polling. The only automatic cadence is the bounded restart trigger and 15-minute alarm.

## 5. Evidence classification and protocol pin

The sole current evidence pin is `c69dcf66704ad7ec1f95e32920455be429a566ef`, the exact official `ente-io/ente` commit dated 2026-08-20. The pin appears in source constants, schemas, sanitized fixtures, diagnostics, build policy, release evidence, and the implementation plan. A pin change requires a source diff of every reviewed symbol, regenerated sanitized transcripts, schema/endpoint review, and a new release decision.

The following behavior is source-derived compatibility evidence, not a promise of a stable public third-party API:

- `GET /users/srp/attributes?email=...`;
- `POST /users/srp/create-session`;
- `POST /users/srp/verify-session`;
- `POST /users/two-factor/verify`;
- authenticated `X-Auth-Token` requests;
- `GET /authenticator/key`;
- `GET /authenticator/entity/diff?sinceTime=<integer>&limit=2500`;
- `POST /authenticator/entity` with `{ encryptedData, header }`;
- `PUT /authenticator/entity` with `{ id, encryptedData, header }`;
- `DELETE /authenticator/entity?id=<UUID>`;
- entity fields `id`, `encryptedData`, `header`, `isDeleted`, `createdAt`, and `updatedAt`;
- diff response fields `diff` and nullable/optional epoch-microsecond `timestamp`.

The official web client at this pin advances `sinceTime` to the greatest `updatedAt`; the official server orders/filters against timestamp state but exposes no unique tie-break cursor and mutation requests expose no revision precondition. This design therefore does not claim that timestamp-only incremental reads are lossless or that writes are strongly idempotent.

## 6. Fixed network authority

Production transport accepts exactly the origin `https://api.ente.io`: scheme `https`, ASCII host `api.ente.io`, implicit port 443, no user info, no alternate spelling, no trailing-dot host, and no caller-supplied base URL. Production settings contain no server field. A migrated `serverUrl` is accepted only if strict URL normalization proves it is exactly `https://api.ente.io`; any other value blocks connection and requires the user to disconnect the legacy integration without contacting it.

The client exposes endpoint-specific methods, never a generic URL, path, method, body, headers, or `fetch` capability. It enforces:

- the exact methods and paths in §5;
- canonical query encoding and no extra query keys;
- `redirect: "error"`;
- `credentials: "omit"` and no cookies or ambient authorization;
- fixed reviewed client headers and `X-Auth-Token` only on authenticated methods;
- request and whole-cycle abort signals;
- bounded status/header/body handling before JSON or base64 decoding;
- safe fixed error categories with no response body, server message, email, ID, or secret interpolation;
- no WebSocket, EventSource, beacon, telemetry, analytics, DNS-over-HTTPS, proxy, or remote executable/resource request.

Production manifest authority is exactly `https://api.ente.io/*`. Extension-page `connect-src` is exactly `'self' https://api.ente.io`; no wildcard or optional host permission is added. Tests may route this exact origin to an in-process synthetic server at the browser harness boundary, but production code never recognizes the test server address.

## 7. Dependency and cryptographic boundary

### 7.1 Selected libsodium dependency

The selected Ente primitive provider is:

- direct dependency: `libsodium-wrappers-sumo@0.8.4`;
- direct package license: ISC;
- direct registry integrity: `sha512-ql7hcgulKZ3ekfa2DGAogcCKsWU0diA/0nArz1CFzh93WQdb46/Kj18ka/Hifq6uA3Ush34Pc6vU/6HXeRwUkg==`;
- official repository: `https://github.com/jedisct1/libsodium.js`;
- transitive WASM package forced and locked exactly to `libsodium-sumo@0.8.0` despite the wrapper’s published `^0.8.0` range;
- transitive package license: ISC;
- transitive registry integrity: `sha512-Afy7Ya+jUT+JeBx93Vk83tFhmhOjLN521dVPYKi/KiLdHoSsa2j7qf9gxZmvo0HpVxlqhdrLX6nHhVPrfMqRhA==`.

The workspace manifest, pnpm override, and lockfile must all resolve exactly those versions and integrities. Installation/build fails if either package, integrity, license, repository identity, dependency edge, or emitted WASM/loader digest differs. No CDN, fallback package, non-sumo substitution, runtime download, or Emscripten JavaScript fallback may ship.

“Maintainable” means the upstream `jedisct1/libsodium.js` repository and npm release line are active enough to accept security updates as of this selection, the package is readable and reproducibly inventoryable, and ShardPass owns an explicit pin-review process. It does not mean automatic upgrades. Every upgrade repeats protocol vectors, license/provenance review, CSP execution tests, output inventory, production audit, and browser evidence.

### 7.2 Audit scope and claims

The dependency review inventories all exported wrapper functions and permits production imports/calls only for the exact Ente operations evidenced at the protocol pin: random bytes, constant-time comparison as needed, base64 conversion under strict canonical wrappers, `crypto_pwhash`/Argon2id parameters accepted by bounded Ente schemas, `crypto_box`/sealed-box operations, `crypto_secretbox`, and any exact Auth metadata primitive proven by pinned vectors. Tree-shaking is not credited as a security boundary; build output is scanned for forbidden call sites and all wrapper access is centralized behind a typed adapter.

The audit covers package provenance and license, both exact tarball integrities, transitive graph, loader behavior, WASM imports/exports, CSP requirements, local-only initialization, memory/view ownership, input/output bounds, API allowlisting, errors, disposal, build reproducibility, and known vulnerability advisories. It does not claim an independent audit of this exact JavaScript wrapper release or of ShardPass’s integration. Libsodium’s upstream reputation is not substituted for integration review.

### 7.3 CSP

The exact extension-page CSP becomes:

`script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.ente.io; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'`

Only extension pages/background that need the locally packaged dependency may instantiate its reviewed WASM. No web-accessible WASM is emitted. `'unsafe-eval'`, `eval`, `Function`, string timers, blob/data scripts, remote imports, computed dynamic imports, and remotely fetched workers/WASM remain forbidden. The owner approval and exact allowance are recorded in executable policy and threat/release evidence.

### 7.4 No selected SRP dependency

There is deliberately **no selected SRP package** in this design. Libsodium is not an SRP implementation. No handwritten SRP, generic bigint implementation, copied legacy minified code, `fast-srp-hap`, or official WASM SRP is approved merely by naming it.

An SRP candidate may be selected only after it independently reproduces both complete, sanitized SRP-4096 transcript suites:

1. **Legacy suite:** recovered ShardPass 1.2.1 framing and behavior, including group parameters, generator, hash, padding, username encoding, salt, derived login key, fixed client private ephemeral, client public `A`, server private ephemeral, server public `B`, scrambling parameter, premaster secret, session key, client proof `M1`, server proof `M2`, and rejection cases.
2. **Current-pin suite:** the same complete values generated from official source at `c69dcf66704ad7ec1f95e32920455be429a566ef` for the current `SrpSession`, `/users/srp/create-session`, and `/users/srp/verify-session` framing.

Both suites use synthetic emails/passwords, deterministic test-only ephemerals, and non-production keys. They contain no real account data. The generator provenance and transcript digests are pinned, and two independent replay implementations must agree byte-for-byte. Tests cover leading-zero padding, invalid `A`/`B`, wrong `M2`, malformed base64, out-of-range values, transcript mix-up, and legacy/current divergence. Until one candidate passes all transcript, license, integrity, maintenance, browser, CSP, side-channel-surface, and output-policy checks and receives a documented selection decision, **Phase 1 fails and no authentication, network authority, scheduler, or sync UI ships**.

## 8. Strict contracts and resource bounds

All protocol, decrypted entity, persisted metadata, queue, message, and worker schemas are strict: unknown keys fail closed and successful values are field-by-field owned projections. The following constants are immutable release contracts:

```ts
export const ENTE_PROTOCOL_PIN = "c69dcf66704ad7ec1f95e32920455be429a566ef" as const;
export const ENTE_API_ORIGIN = "https://api.ente.io" as const;
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
```

Endpoint bodies use narrower limits where possible. Integers must be safe, nonnegative, canonical decimal values. `maxSafeTimestamp` is the JavaScript safe-integer ceiling because pinned entity and server timestamps are epoch microseconds; values above it are rejected rather than rounded. Base64 is canonical and bounded before allocation. UUIDs are canonical lowercase hyphenated UUID strings. Deletion rows require null ciphertext/header; live rows require both non-null. `updatedAt` must be monotonic within a processed page order only where the server contract proves order; otherwise the page is normalized deterministically and ambiguity logic applies. KDF memory/operation limits have explicit accepted minima/maxima derived from both transcript suites; values outside the proven range fail before allocation.

Exceeding any count, byte, time, attempt, depth, width, or numeric bound aborts the cycle before local activation or a new remote mutation. Existing durable state remains intact.

## 9. OTP-only compile-time and runtime boundary

The Ente adapter accepts and returns a dedicated `EnteOtpProjection` discriminated only by `kind: "otp"` and `otpType: "totp" | "hotp" | "steam"`. It does not import `VaultItem`, `LoginItem`, generic item unions, password models, content-fill models, or arbitrary JSON records. Dependency-cruiser and negative TypeScript assertions prove those imports/types cannot enter the adapter.

After authenticated decryption, runtime parsing accepts one bounded canonical `otpauth://` projection and maps fields individually through the existing strict `OtpItemSchema`. It rejects:

- non-`otpauth` schemes and non-TOTP/HOTP/Steam types;
- password/login fields or unknown top-level/decrypted fields;
- duplicate query keys, fragments, user info, malformed percent encoding, NUL/unpaired surrogate/control text, unknown algorithms, invalid digits/period/counter, invalid Base32, missing label/secret, and values above domain bounds;
- unsupported Ente entity versions/shapes;
- plaintext that does not round-trip through the canonical serializer used for remote writes.

Notes and tags are synchronized only as bounded fields belonging to an OTP projection and only if the pinned entity format proves their representation. No separate note or generic metadata content is accepted. HOTP counter is content and participates in merge/conflict rules; it is never decremented automatically.

Production source and emitted output are scanned for `LoginItem`, password record adapters, generic Ente entity adapters, and mutation of any non-OTP endpoint. A compile-only check is insufficient: hostile decrypted plaintext tests must also prove runtime rejection.

## 10. Credential and key lifecycle

The trusted full-vault page collects email, password, and Ente TOTP second-factor code. The page sends password bytes only to a dedicated local crypto worker through a one-job typed protocol; ordinary runtime messages and React state never retain the submitted password string after transfer. The worker derives the KEK/login subkey and SRP proof, then disposes input views best effort.

Reusable state is background-owned and encrypted at rest inside generation metadata under the existing vault DEK:

- normalized account email;
- API token;
- master-key material needed for Authenticator-key recovery;
- decrypted Authenticator key only if required for restart sync;
- validated mappings, merge bases, cursor state, and pending operations.

No reusable value is stored in `chrome.storage.session`, settings, local plaintext keys, logs, errors, DOM, accessibility text, screenshots, or telemetry. Decrypted reusable credentials/keys exist only while the vault is unlocked. Lock, disconnect, vault reset, account replacement, or session-epoch change synchronously invalidates capabilities, aborts transport/workers, drops references, overwrites owned mutable bytes best effort, and prevents stale completion. Service-worker restart reloads encrypted metadata only after the existing vault session authorizes decryption; a locked restart records a non-secret “sync deferred until unlock” state and performs no network.

The Ente TOTP second-factor code is a login challenge value, distinct from synchronized OTP records. It is bounded to the exact pinned response contract, single-use in UI state, and cleared on submit, transition, cancel, error, lock, or unmount. Fixed safe errors never reveal whether a supplied email, password, SRP proof, token, or TOTP code was partly correct.

## 11. Persisted encrypted sync state

One authenticated generation metadata record stores a versioned `EnteOtpSyncState` alongside OTP records:

- exact protocol pin and exact production-origin marker;
- account identity fingerprint derived with domain separation, never the plaintext email in UI projections;
- encrypted reusable credential/key envelope;
- `remoteId -> localOtpId` bijection;
- for each mapping, a canonical encrypted **base projection** digest plus the complete encrypted canonical base needed for three-way comparison;
- last unambiguous incremental timestamp, or `0` when no cursor is safe;
- durable pending operations;
- a single uncertain-operation marker when applicable;
- safe scheduler timestamps/state and `needsReauth`;
- no raw HTTP response, SRP transcript, password, second-factor code, decrypted URI string, duplicate seed provenance, or server URL.

Pending operations have fixed schemas:

- create: operation ID, local ID, frozen canonical desired projection, base absence, enqueue time, attempts;
- update: operation ID, local ID, remote ID, frozen base projection, frozen desired projection, enqueue time, attempts;
- delete: operation ID, local ID, remote ID, frozen base projection, enqueue time, attempts.

All operation IDs are random and local; they are never asserted to be server idempotency keys. Queue normalization coalesces safe sequences before a request: create+local update becomes one create; unattempted create+delete cancels; repeated updates retain original base and newest desired state; update+delete becomes delete with original base. An uncertain operation is never coalesced, discarded, or retried until snapshot reconciliation classifies its outcome.

Legacy migrated pending operations are converted once into this schema in the same generation that removes plaintext legacy credentials. Missing base material is recovered by a full remote snapshot before any legacy update/delete can be sent. Legacy creates freeze the current mapped local OTP projection. Invalid, duplicate, contradictory, oversized, custom-server, or orphaned legacy state blocks sync and offers safe local disconnect; it is not partially executed.

## 12. Scheduler and single-cycle ownership

Only the background sync coordinator owns synchronization. It serializes cycles with an in-memory mutex plus persisted cycle epoch; no two requests run concurrently.

Triggers are:

- immediately after a successful connection and metadata activation;
- **restart:** when the MV3 service worker/background starts or is restarted, but only after the vault is already unlocked and the coordinator has restored authorized encrypted state; otherwise the next unlock schedules one cycle;
- **manual:** an explicit button in the trusted full-vault settings page;
- **15 minutes:** a Chrome alarm named by a fixed constant, period exactly 15 minutes, connected/unlocked only.

Trigger coalescing permits at most one running and one follow-up cycle. Alarm jitter or repeated events do not create parallel work. There is no content-script trigger, popup trigger, page-navigation trigger, idle polling loop, sub-15-minute retry, or automatic retry storm. Offline/auth failures wait for the next allowed trigger or manual action. Lock/restart aborts active work; any mutation already dispatched becomes uncertain.

## 13. Read algorithm and timestamp ambiguity

### 13.1 Incremental attempt

A normal cycle starts from the last unambiguous timestamp and requests pages of 2,500. It validates every page before decryption, applies rows to an in-memory remote candidate keyed by remote ID, and tracks `(updatedAt, id, tombstone/live digest)` observations.

Timestamp progress is ambiguous when any of the following occurs:

- a full page’s maximum `updatedAt` is not strictly greater than the requested `sinceTime`;
- more than one returned row shares the page-boundary maximum timestamp and the API supplies no unique continuation token;
- the next page repeats, omits progress from, or contradicts an observed `(updatedAt, id)`;
- one ID has incompatible rows at the same timestamp;
- a page is full but cursor advancement could skip another equal-timestamp row;
- server `timestamp` regresses, is malformed, or conflicts with the entity time domain;
- local cursor/pin/account metadata is absent, migrated, changed, or invalid;
- an uncertain mutation exists.

### 13.2 Mandatory full snapshot fallback

Any ambiguity discards the incremental candidate before local mutation and immediately performs one bounded full snapshot from `sinceTime=0`. The fallback reconstructs the complete live set in memory by remote ID, applying tombstones in deterministic `(updatedAt, stable response index)` order only when that ordering is internally consistent.

A full snapshot is accepted only if it reaches an empty page without a full-page equal-maximum-timestamp boundary, repeated page, contradictory same-time row, count/byte/time overflow, or cursor non-progress. If ambiguity remains, the cycle stops with `ENTE_TIMESTAMP_AMBIGUOUS`; it commits no merge, advances no cursor, and sends no write. It never loops snapshots indefinitely.

After an accepted full snapshot, the next cursor is the greatest observed timestamp only if the terminal-page evidence makes it unambiguous; otherwise it remains `0`, forcing another full snapshot next cycle. Correctness takes priority over incremental efficiency.

## 14. Explicit three-way merge

For each mapped record, define:

- **B (base):** the canonical OTP projection last proven common after an accepted remote observation/write reconciliation;
- **L (local):** the current canonical ShardPass OTP projection, or absence if locally deleted;
- **R (remote):** the current canonical decrypted Ente OTP projection, or absence if remotely deleted.

Equality is byte equality of the versioned canonical projection, not display text, timestamp, object identity, or remote ciphertext. The merge matrix is exact:

| Relationship | Result |
|---|---|
| `L = B` and `R = B` | unchanged; retain mapping/base |
| `L != B` and `R = B` | accept local; enqueue create/update/delete as appropriate |
| `L = B` and `R != B` | accept remote locally; update/delete local record and set base to R |
| `L = R`, including both absent | converged independently; set base to that value and clear covered pending intent |
| `L != B`, `R != B`, and `L != R` | explicit conflict; no content choice and no remote write |

Unmapped local OTP records are local additions and enqueue creates only after the connection’s initial full snapshot establishes that no mapping exists. Unmapped remote live OTP records are remote additions and are imported with new local IDs. Remote tombstones without a known mapping are ignored after validation. A remote ID mapped to two local IDs, a local ID mapped to two remote IDs, or identity reuse is corruption and stops the cycle.

### 14.1 Conflict object and choices

A conflict is encrypted in the local generation and projected to UI only as bounded issuer, label, OTP type, change-kind metadata, and safe consequences. It contains no seed, URI, remote ID, base digest, token, key, ciphertext, or HOTP code.

Per conflict, the user must choose exactly one:

- **Keep local:** retain L and enqueue the necessary remote create/update/delete against the observed R; the UI explicitly warns that this overwrites/deletes the Ente version and that the API has no revision precondition.
- **Keep Ente:** accept R locally and discard the conflicting local pending intent; the UI explicitly warns that this replaces/deletes the ShardPass version.
- **Keep both:** allowed only when L and R are both live; retain L as a local-only record and import R under a new mapping/local ID. No existing remote entity is overwritten.

There is no “newest wins,” bulk default, timeout default, or implicit choice. Conflict decisions are bound to a preview capability containing the session epoch and canonical B/L/R digests. Before activation or write, the coordinator re-reads local state and remote snapshot; any changed digest invalidates the choice and requires a new preview.

## 15. One-generation local merge

A cycle first completes read, decrypt, validation, merge calculation, and any required user decision without changing active local state. It then stages exactly one immutable generation containing:

- all retained encrypted vault records;
- accepted remote additions/updates/deletes;
- unchanged unrelated local records;
- new mappings and base projections;
- normalized durable pending operations and conflicts;
- cursor/scheduler/credential metadata;
- existing journals and HOTP receipts required by storage invariants.

The generation is verified and activated through the existing expected-root check. If the root changed, the staged generation is abandoned and the whole merge is recomputed from fresh B/L/R. There is no record-by-record activation and no second generation for metadata. Thus readers observe either the previous complete state or the complete merged state.

Remote writes occur only after this local generation durably records their intent. Successful or reconciled write acknowledgments are incorporated in the next single generation. Storage failure never causes the coordinator to claim a remote write was recorded locally.

## 16. Write execution and uncertain outcomes

The coordinator executes at most one durable pending mutation at a time in deterministic enqueue order. Immediately before dispatch it confirms unlocked session/account/pin, queue head, latest accepted remote snapshot, and absence of conflict. Request plaintext is built in background memory, encrypted with fresh cryptographic randomness, bounded, sent, and disposed best effort.

- **Create:** success requires a strict returned entity with canonical UUID and validated timestamps. The mapping is not guessed.
- **Update:** HTTP success alone is provisional because the endpoint returns no entity/revision. The operation remains pending until a subsequent read observes decrypted content equal to desired content.
- **Delete:** HTTP success alone is provisional. The operation remains pending until a subsequent read observes a tombstone/absence compatible with the mapped entity.

A write is **uncertain** if dispatch may have occurred but a strict conclusive result was not durably recorded: timeout, abort, network loss, service-worker termination, malformed/truncated success response, lock, storage failure after response, or any exception after request handoff. Exactly one queue head may be uncertain; later writes stop.

Before retrying an uncertain operation, the next permitted cycle performs a full snapshot:

- uncertain update/delete is complete only if the observed remote state matches the desired live/absent state;
- if remote still equals the frozen base, retry is permitted subject to `maxMutationAttempts`;
- if remote differs from both base and desired, it becomes a three-way conflict;
- uncertain create is matched only by a protocol-proven identity. Because create has no client entity ID or idempotency key, content equality alone is not sufficient when multiple equal entities can exist. One unique previously absent matching entity may be adopted only when the full before/after snapshot and operation provenance prove uniqueness; zero matches permits retry; multiple/indeterminate matches create an `ENTE_CREATE_UNCERTAIN` conflict and never auto-retry.

Attempts are incremented durably before each dispatch. At eight attempts the operation is blocked for manual retry/disconnect; it is not dropped. HTTP 401 marks `needsReauth`; strict 4xx validation failures block that operation; 5xx/network errors retain it. No response error text enters state or UI.

## 17. No content authority and deletion safety

Neither local timestamps nor remote timestamps determine content authority. Local and remote are replicas joined by a stored common base. Only the merge matrix and an explicit, freshness-bound user conflict choice can replace divergent content.

Deletes are first-class absence states. A local deletion against unchanged remote becomes a durable remote delete; a remote deletion against unchanged local becomes a local deletion; simultaneous deletion converges; delete-versus-edit conflicts. Disconnect never deletes local OTP records or remote entities and never flushes pending writes. It removes encrypted Ente credentials, mappings, bases, cursor, conflicts, and pending operations in one confirmed local generation after showing counts and consequences. If an uncertain write exists, disconnect warns that its remote outcome cannot be known and still makes no further network request.

## 18. Runtime boundaries and UI states

### 18.1 Trusted boundaries

- **Background:** sole owner of transport, decrypted reusable credentials/keys, remote plaintext, mappings, bases, queue, conflict bodies, scheduler, and merge/write coordinator.
- **Dedicated crypto worker:** libsodium initialization and bounded cryptographic jobs; no network, Chrome API, storage, DOM, logs, generic method dispatch, or persistent state.
- **Full-vault settings page:** sensitive login input and metadata-only sync controls. It never receives remote IDs, seeds, URIs, ciphertext, API token, keys, SRP internals, complete records, or queue payloads.
- **Popup:** fixed connection summary and “Open vault settings” action only; no sync trigger or secrets.
- **Content scripts/pages:** no Ente command is authorized. They receive no connection state beyond existing OTP fill behavior, no network authority, and no sync-derived provenance.

Every message is versioned, strict, sender-authorized from Chrome-owned metadata, session-epoch bound, and command-specific. Opaque capabilities are random, single-purpose, expiring, and invalidated on lock/restart/account change.

### 18.2 UI state machine

The Ente settings panel renders exactly these accessible states:

1. **Disconnected** — explanation of OTP-only sync, exact `api.ente.io`, 15-minute cadence, conflict semantics, and Connect.
2. **Legacy review required** — migrated custom server/invalid state is blocked; shows only safe counts and offers local-only Disconnect.
3. **Email and password** — bounded inputs, no server input, submit/cancel.
4. **Checking SRP compatibility** — cancellable; no fallback to email OTT/passkey.
5. **TOTP 2FA required** — bounded code input and cancel.
6. **Connecting / initial full snapshot** — progress category and bounded counts only.
7. **Connected idle** — masked email, last successful sync time, next eligible 15-minute run, pending/conflict counts, Manual sync, Reauthenticate, Disconnect.
8. **Syncing: reading** — cancellable before writes; metadata-only progress.
9. **Syncing: committing locally** — cancellation is disabled during root activation.
10. **Syncing: writing** — identifies create/update/delete category, not record content; cancel makes an in-flight write uncertain.
11. **Offline / retry later** — state retained for restart/manual/15-minute trigger.
12. **Reauthentication required** — pending intent preserved; no writes until successful SRP+TOTP login.
13. **Conflicts require review** — bounded rows and the three explicit choices from §14.1.
14. **Uncertain write reconciling** — explains that a full snapshot is required and retry is disabled.
15. **Blocked uncertain create** — explains possible duplicate risk and requires manual conflict handling/disconnect.
16. **Protocol/dependency unsupported** — fixed fail-closed state, no mutation action.
17. **Limit reached / data invalid** — fixed safe state, no partial apply.
18. **Disconnect confirmation** — displays pending/conflict/uncertain counts and states that disconnect is local-only and cannot undo a possibly dispatched request.

Sensitive controls clear on transfer, state transition, cancel, error, lock, replacement, and unmount. Async ownership suppresses stale results. Conflict choices are keyboard operable, individually described, and never preselected. Compact viewport, focus order/restoration, live-region restraint, reduced motion, and automated/manual accessibility checks are release requirements.

## 19. Trust, credential, CSP, network, and output policy

Release claims require separate executable tests for each boundary:

- **Trust:** only exact full-vault extension URLs can connect, reauthenticate, sync, resolve conflicts, or disconnect; popup is summary-only; content/external/wrong-frame/wrong-extension senders fail; stale session/capability/job messages fail.
- **Network:** source AST and packaged-output inspection prove all Ente calls flow through the fixed client; manifest host permission equals `https://api.ente.io/*`; CSP connect source equals `https://api.ente.io`; the method/path table equals §5; redirects, cookies, custom ports/hosts, custom servers, generic fetch, telemetry, WebSockets, and mutation-before-durable-intent are absent.
- **Credentials:** tests canary every password, TOTP2FA code, SRP value, token, master/Auth key, seed, URI, ciphertext, and remote ID across storage keys, messages, DOM/accessibility tree, logs, errors, screenshots, crash-like interruption evidence, and diagnostics. Only encrypted generation blobs may contain reusable state. Lock/restart/disconnect/stale jobs prove logical invalidation.
- **CSP/WASM:** packaged MV3 tests prove exact `'wasm-unsafe-eval'` permits only the local integrity-matched libsodium WASM; removing it fails the controlled initialization test; adding `'unsafe-eval'`, blob/data/remote script, remote WASM, an extra `.wasm`, unexpected WASM imports/exports, or dynamic code fails build policy.
- **Output:** fresh `dist/` contains only inventoried executables/assets, exact dependency/license notices, expected local WASM digest, no official Ente source bundle, no legacy artifact import, no source map with secrets, no test fixture/transcript generator, no credential literals, no unexpected network sink, and no non-OTP Ente endpoint. The preserved 17 legacy artifacts remain byte-identical regular non-symlink files and outside production imports/output.

Diagnostics are typed events with pin, phase, fixed error code, bounded counts, trigger category, and booleans only. They never include email, server body/message, URL query, item metadata, IDs, hashes/fingerprints exposed to UI, queue payload, crypto values, or exception text.

## 20. Three phases and hard Phase 1 SRP gate

### Phase 1 — Current-pin evidence, libsodium/CSP boundary, and SRP selection

Deliver strict schemas and bounds, exact current-pin protocol inventory, sanitized legacy and current SRP-4096 transcript suites, libsodium exact-pin/integrity/license policy, centralized OTP crypto adapter, packaged MV3 CSP/output tests, and dependency/trust boundary tests.

**Hard gate:** Phase 1 passes only when one maintainable exact-pinned SRP candidate has been explicitly selected after reproducing both complete sanitized transcript suites byte-for-byte through two independent replays; the exact candidate passes license/integrity/transitive review; libsodium vectors and packaged local WASM pass under the owner-approved exact CSP; no forbidden fallback exists; and all Phase 1 review findings are resolved. If any condition fails, append `STOP-TASK12-PHASE1-SRP` to the preserved ledger, make no production manifest/host/connect-src/scheduler/UI change, and do not begin Phase 2. This gate cannot be waived by mock tests, static source similarity, a partial proof, or owner approval of `wasm-unsafe-eval`.

### Phase 2 — Durable coordinator, merge, and bounded protocol integration

Implement encrypted credential/sync metadata, migration conversion, fixed-origin client, SRP+TOTP2FA session, full/incremental reads, ambiguity fallback, OTP-only parsing, three-way merge, one-generation activation, durable queue, write execution, uncertain reconciliation, and restart/manual/15-minute scheduler. Use deterministic synthetic mock transport; production host authority remains disabled until Phase 2’s consolidated security review passes.

Phase 2 passes only with interruption tests at every storage/network boundary, root-change recomputation, timestamp collision/fallback tests, all conflict/deletion matrices, uncertain create/update/delete tests, queue bounds/coalescing tests, and proof that no write precedes durable intent.

### Phase 3 — Production authority, complete UI, packaged evidence, and release gate

Add the exact host permission/connect source/CSP string, settings UI state machine, packaged browser tests routed to a synthetic server, accessibility evidence, output/license/audit scans, documentation updates, reproducible build, official runtime/browser verification, production dependency audit, and one final consolidated review.

No later phase starts with an unresolved load-bearing finding. Release requires official Node `>=22.14.0 <23`, pnpm exactly `10.14.0`, minimum Chrome 110 evidence, a clean production audit, exact legacy hashes, and preservation of every ledger STOP/history entry.

## 21. Exact testing matrix

### Protocol and schema

- Exact pin/origin/method/path/query/header assertions and protocol-diff fixture.
- Strict success/error schemas for SRP attributes/session proofs, TOTP2FA, Authenticator key, diff, create, update, and delete.
- Unknown key, duplicate key, malformed JSON/base64/UUID/timestamp, null/live mismatch, oversized header/ciphertext/plaintext, timeout, abort, redirect, pagination, and aggregate-limit failures.
- No request to a real external account in automated tests.

### SRP and crypto

- Complete sanitized legacy/current SRP-4096 transcripts and all rejection cases in §7.4.
- Pinned KDF, master/Auth key envelope, metadata encryption/decryption, fresh nonce, malformed ciphertext, wrong key, and cross-protocol/domain-separation vectors.
- Exact libsodium wrapper/transitive versions, integrities, licenses, repository, WASM digest/import/export inventory, no fallback, dispose-after-use, and bounded allocation.

### Merge and storage

- Every B/L/R row in §14, additions, mappings, simultaneous equality, edit/edit, edit/delete, delete/edit, delete/delete, HOTP counter divergence, Keep local/Ente/both, stale decisions, and no default.
- One and only one activated generation per accepted local merge; interruption before/during/after stage/verify/root activation; external-root recomputation; unrelated record/journal/receipt retention.
- Migrated mapping/pending conversion, custom-server block, orphan/duplicate contradiction, encrypted-at-rest canaries, queue coalescing/limits, attempts, and local-only disconnect.

### Reads, scheduler, and writes

- Empty/partial/full 2,500-row pages, 40-page/100,000-change caps, tombstones, duplicate IDs, equal-boundary timestamps, non-progress, regression, contradiction, incremental discard, one full-snapshot fallback, fallback failure, and cursor reset/advance.
- Connection/restart/unlock/manual/15-minute triggers, locked deferral, alarm coalescing, one running/one follow-up, restart abort, no sub-15-minute loop, and content/popup denial.
- Create/update/delete success, strict response handling, provisional update/delete, timeout/abort/restart/lock/storage-loss uncertainty, snapshot-before-retry, unique/zero/multiple uncertain-create matches, conflict conversion, eight-attempt block, 401 reauth, and no later write while uncertain.

### UI, trust, credentials, network, CSP, and output

- All 18 states in §18.2, exact consequence copy, sensitive-input clearing, stale async suppression, focus/keyboard/screen-reader semantics, 320 CSS-pixel compact layout, reduced motion, and metadata-only rendering.
- Sender authorization negatives for content, popup mutation, web page, external extension, stale document/session, malformed version, extra keys, and replayed capability.
- Canary scans and exact authority/output checks from §19 against source and a fresh packaged extension.
- Packaged synthetic-server browser scenarios for login+TOTP2FA, initial/full/incremental sync, each conflict choice, each uncertain mutation, restart, alarm, offline, lock, protocol drift, disconnect, and proof that no request escapes interception.
- Exact production CSP equality; controlled success with local libsodium WASM; controlled failure without `'wasm-unsafe-eval'`; rejection of `'unsafe-eval'`, extra WASM, remote execution, and arbitrary network.

## 22. Error model

Public errors are fixed codes with fixed text:

- `ENTE_INVALID`
- `ENTE_UNAVAILABLE`
- `ENTE_AUTH_FAILED`
- `ENTE_TOTP2FA_REQUIRED`
- `ENTE_REAUTH_REQUIRED`
- `ENTE_SRP_UNSUPPORTED`
- `ENTE_PROTOCOL_DRIFT`
- `ENTE_LIMIT_REACHED`
- `ENTE_TIMESTAMP_AMBIGUOUS`
- `ENTE_CONFLICT`
- `ENTE_CREATE_UNCERTAIN`
- `ENTE_WRITE_UNCERTAIN`
- `ENTE_STORAGE_CHANGED`
- `ENTE_STORAGE_FAILED`
- `ENTE_DEPENDENCY_INTEGRITY`
- `ENTE_PERMISSION_DENIED`

Raw errors, HTTP bodies, library strings, endpoints with query values, emails, IDs, labels, URI text, crypto values, stack traces, and server error messages never cross worker/runtime/UI boundaries or enter diagnostics.

## 23. Security claims and residual risks

- ShardPass claims compatibility only with exact official evidence commit `c69dcf66704ad7ec1f95e32920455be429a566ef` and sanitized legacy evidence.
- The selected libsodium packages are exact-pinned ISC dependencies with recorded registry integrity; no claim of an independent audit of the exact wrapper/integration is made.
- `'wasm-unsafe-eval'` expands executable capability for local WASM. Exact CSP, asset inventory, integrity, import/call allowlists, and packaged tests contain but do not eliminate that risk.
- No SRP implementation is approved until the hard Phase 1 transcript gate passes.
- The Ente API exposes neither a tie-break cursor for equal timestamps nor mutation revision preconditions/idempotency keys. Full snapshots, explicit conflicts, durable intent, and uncertain-write reconciliation reduce data-loss/duplication risk but cannot create server-side CAS.
- Ente, the browser, device, and network path necessarily observe account/API traffic. A compromised extension/browser/OS can access unlocked data.
- Authenticated and successfully decrypted remote content remains untrusted until strict OTP-only validation.
- JavaScript/WASM memory cleanup is best effort and does not prove physical zeroization.
- Content scripts have no Ente authority, but synchronized OTP values intentionally become available to existing authorized OTP display/fill flows after the local generation activates.
- Disconnect is local-only and cannot retract an already dispatched uncertain request.

## 24. Acceptance criteria

Task 12 is complete only when:

1. this replacement design is the implementation authority and old read-only documents remain untouched historical records;
2. the STOP ledger is append-only with all prior entries preserved;
3. exact official pin, exact `api.ente.io`, exact libsodium versions/integrities/licenses, and exact CSP are enforced in source and packaged output;
4. the hard Phase 1 SRP gate passed without waiver and records the selected dependency and transcript evidence;
5. only strict OTP TOTP/HOTP/Steam projections compile and run through the adapter;
6. restart/manual/15-minute sync, durable pending create/update/delete, one-generation local merges, timestamp snapshot fallback, explicit three-way conflicts, and uncertain-write rules pass the complete matrix;
7. no content script, popup mutation path, custom server, generic network method, non-OTP entity, raw error, plaintext persisted credential, or unapproved executable output exists;
8. all three consolidated phase reviews have no unresolved load-bearing findings; and
9. official runtime/browser, reproducibility, dependency audit, legacy preservation, accessibility, packaged network, credential-canary, CSP, and output evidence all pass.
