# Project 1 Task 12 — Read-Only Ente Auth OTP Snapshot Interoperability

**Status:** Approved conservative design for implementation

**Protocol pin:** `ente-io/ente@35658c587072b1919d517fcfacf4b4689af2c6a7` (2026-08-20)

## 1. Superseding scope decision

This design supersedes Task 12's roadmap assumption of immediate bidirectional synchronization. Current official Ente source provides source-derived evidence for authentication, authenticator-key retrieval, and read-only entity snapshots, but not a stable documented contract for safe third-party writes, timestamp-collision-safe incremental cursors, optimistic concurrency, Auth-key creation races, or cross-client conflict convergence.

Task 12 therefore implements **manual, read-only Ente Auth snapshot interoperability**:

1. authenticate through pinned official behavior;
2. download a complete snapshot beginning at `sinceTime=0`;
3. decrypt and validate only OTP authenticator entities;
4. present a metadata-only preview;
5. apply the confirmed snapshot through one local immutable encrypted generation.

It does not upload, update, delete, restore, poll, queue writes, or claim continuous/bidirectional sync. Future write support requires a separate design, current official fixtures, independent protocol/security review, and explicit user approval.

## 2. Goals

- Support the pinned official Ente login branches: email one-time token (OTT), SRP credential verification, Ente TOTP second factor, and official passkey verification flow.
- Retrieve and decrypt the Ente Auth account data key using official Ente crypto code only.
- Read a complete Auth entity snapshot with strict resource limits.
- Process remote tombstones and reconstruct the final live remote set in memory.
- Accept only strict `otpauth://` TOTP/HOTP/Steam-compatible projections supported by ShardPass.
- Reject unknown fields, unsupported versions/types, oversized ciphertext, malformed encodings, invalid URLs, login/password entities, and pagination ambiguity.
- Preserve unrelated local OTP records.
- Detect mapped local edits/deletions and require explicit conflict consequences before replacement.
- Store only minimal encrypted provenance in authenticated generation metadata.
- Keep every reusable credential and decrypted key background-owned and session-bound; do not persist reusable Ente credentials in Task 12.
- Make disconnect local-only and non-destructive to both local OTP records and remote Ente data.

## 3. Non-goals

- Ente create/update/delete endpoints or mutation requests of any kind.
- Incremental cursor persistence or claims of lossless continuous sync.
- Auth-key creation.
- General custom/self-hosted server support.
- HTTP development servers in production UI.
- Ente Photos, files, notes, passwords, recovery mutation, signup, password changes, passkey enrollment, or 2FA enrollment.
- `LoginItem`, password fields, generic vault records, or future item kinds.
- HOTP counter upload or reconciliation to Ente.
- Automatic background refresh on startup, unlock, alarm, idle wake, or service-worker restart.
- Persisting Ente account password, OTT, TOTP code, SRP proof, KEK, master key, private key, API token, Auth data key, raw remote responses, or decrypted URI strings.
- Reusing the legacy pending-operation/write queue as live Task 12 behavior.

## 4. Protocol classification and pin

Only OTP URI semantics and ShardPass's strict `OtpItem` domain are treated as stable input semantics. Authentication endpoints, schemas, headers, SRP framing, key envelopes, Auth entity framing, diff pagination, tombstones, and error codes are source-derived compatibility behavior pinned to official Ente commit `35658c587072b1919d517fcfacf4b4689af2c6a7`.

The pinned commit and reviewed symbols are recorded in source, fixtures, diagnostics, documentation, and executable policy. Any upstream pin change requires a protocol-diff review and fixture regeneration before release.

Pinned behavior includes:

- `GET /users/srp/attributes?email=...`;
- `POST /users/ott` and `POST /users/verify-email`;
- pinned SRP create/verify session behavior;
- `POST /users/two-factor/verify`;
- official accounts-page passkey flow and token polling;
- authenticated `X-Auth-Token` header;
- `GET /authenticator/key`;
- `GET /authenticator/entity/diff?sinceTime=<n>&limit=2500`;
- entity fields `id`, `encryptedData`, `header`, `isDeleted`, and `updatedAt`.

These are not described as a stable public third-party API.

## 5. Official-code-only crypto and CSP gate

ShardPass must not hand-write SRP, Argon2, sealed-box, secretbox/box, secretstream, or Ente key/entity framing. It may use exact-pinned official Ente Rust/WASM or first-party packages only after:

- dependency provenance, license, maintenance, browser support, and transitive review;
- deterministic synthetic compatibility vectors;
- packaged MV3 execution under the existing security policy;
- narrowly audited executable-output allowances;
- no remote modules, dynamic code, eval, or network-loaded workers.

If official code requires `wasm-unsafe-eval`, the default remains fail closed. A CSP change is not silently accepted; it requires explicit dependency evidence, output policy, threat-model update, packaged minimum-browser evidence, and separate review. If official code cannot run safely, the affected login/crypto path is not shipped.

Official compatibility fixtures must cover:

1. password plus KDF parameters to exact KEK;
2. complete SRP transcript;
3. key attributes plus password to master key;
4. encrypted token plus keypair to API token;
5. Auth account-key wrapping;
6. Auth entity plaintext/key/header/ciphertext;
7. tombstones and multi-page equal-timestamp boundaries.

No fixture name, test title, error, log, screenshot, or ledger entry contains a real credential, token, seed, or plaintext production secret.

## 6. Layered architecture

### 6.1 Strict protocol schemas

`apps/extension/src/background/ente/schemas.ts` defines strict bounded schemas for every request/response and decrypted remote object. Unknown fields fail closed. Each layer projects field-by-field instead of passing raw response objects.

### 6.2 Transport

`client.ts` exposes only fixed read/auth endpoints for `https://api.ente.io`. It enforces:

- exact HTTPS origin;
- exact method and path allowlist;
- no redirects;
- bounded headers and response bodies;
- hard timeout and abort;
- no cookies or ambient credentials;
- fixed client headers;
- safe error categories;
- no mutation endpoint or generic URL/fetch method.

### 6.3 Authentication

`auth.ts` orchestrates OTT/SRP/TOTP/passkey state while crypto stays in `crypto.ts`. The account password and short-lived codes remain in the trusted full-vault page and official local crypto worker boundary. Ordinary runtime messages never contain the password.

Reusable decrypted API tokens and keys remain background memory only for the unlocked session. Lock, disconnect, restart, cancellation, or disposal invalidates them synchronously and clears owned byte buffers best effort. No guaranteed JavaScript zeroization claim is made.

### 6.4 OTP-only adapter

```ts
export interface OtpSnapshotAdapter {
  connect(input: EnteConnectionProof): Promise<EnteConnectionState>;
  completeSecondFactor(input: EnteSecondFactorProof): Promise<EnteConnectionState>;
  previewSnapshot(): Promise<EnteSnapshotPreview>;
  applySnapshot(previewToken: string): Promise<EnteSnapshotApplyResult>;
  disconnect(): Promise<void>;
}
```

The adapter cannot accept `LoginItem` or generic vault records at compile time. Runtime discriminators reject every remote entity that is not a supported OTP URI projection.

### 6.5 Background orchestration

Authentication, snapshot plaintext, OTP candidates, conflicts, credentials, entity identities, and provenance remain background-owned. Full-vault UI receives only fixed states, safe counts, bounded safe metadata, opaque preview tokens, and fixed errors. Popup/content receive no Ente authority.

## 7. Network and permission policy

Task 12 permits only `https://api.ente.io/*` for the background/auth adapter. The manifest and extension-page `connect-src` are widened only to that exact production origin after source/output tests. No `<all_urls>` background fetch authority is inferred from the content-script match.

Custom servers and optional host permissions are excluded from this conservative Task 12 scope. No HTTP, arbitrary URL, redirect target, OAuth host, analytics, telemetry, WebSocket, or remote executable resource is allowed.

Passkey verification uses the exact official accounts URL returned by the pinned flow. The extension does not implement a WebAuthn ceremony or persist passkey session material. If the official flow requires additional host authority or cannot be safely bound and packaged, passkey support remains disabled with a fixed safe explanation while OTT/SRP/TOTP paths remain independently testable.

## 8. Authentication states

The trusted UI/background state machine uses fixed states:

- `disconnected`;
- `requesting-email-code`;
- `awaiting-email-code`;
- `deriving-srp`;
- `awaiting-totp`;
- `awaiting-official-passkey`;
- `authenticating`;
- `connected`;
- `loading-snapshot`;
- `preview-ready`;
- `conflict`;
- `applying`;
- `applied`;
- `error`.

OTT, password, TOTP code, SRP proofs, passkey session values, API token, and keys are never rendered after their immediate input/transition and never enter accessibility text, persistent form state, logs, or error details.

## 9. Complete snapshot algorithm

Every manual refresh starts at `sinceTime=0` with a fixed page limit of 2500 and strict global bounds. It does not resume a persisted cursor or claim incremental completeness.

For each page:

1. validate outer response and every entity strictly;
2. bound entity count, body bytes, ciphertext/header sizes, timestamps, strings, and pages;
3. retain only immutable owned copies required for processing;
4. apply tombstones in memory by remote entity ID;
5. decrypt live entities through official crypto;
6. parse UTF-8 and strict OTP URI content;
7. reject unsupported/non-OTP records;
8. deduplicate repeated remote IDs by greatest `updatedAt`, accepting exact byte-identical duplicates only;
9. clear raw/decoded buffers and references as early as practical.

Pagination proceeds only when the next boundary is unambiguous. If a full page ends with repeated `updatedAt` values such that a timestamp-only cursor could skip unseen equal-timestamp rows, snapshot loading fails with `ENTE_SNAPSHOT_AMBIGUOUS`; no preview or write is produced. A maximum page/entity/body/time budget also fails closed without partial results.

## 10. Preview and local merge

Preview creation is write-free. It performs no ID allocation, journal write, metadata update, settings change, or generation stage. The background classifies remote rows as:

- `new`;
- `unchanged-mapped`;
- `replace-mapped`;
- `remote-deleted`;
- `local-conflict`;
- `rejected`.

The UI receives safe issuer/label/type metadata and counts only. It does not receive seeds, URIs, remote entity IDs, hashes/fingerprints, notes, tags, full items, ciphertext, tokens, or keys.

Mapped local items use encrypted provenance to detect whether the local item revision/content changed since the last applied snapshot. Unrelated local items are retained. Remote tombstones remove only unchanged mapped items. Simultaneously changed or locally deleted mapped items become explicit conflicts; no silent overwrite or resurrection occurs.

The preview capability is random, one-use, five-minute, in-memory, and bound to exact vault document, session authority, authenticated root, protocol pin, and snapshot identity. Lock, restart, navigation/document replacement, expiry, disconnect, replacement preview, or disposal invalidates it.

Confirmation reloads authenticated current state and reclassifies everything. Any changed outcome returns a replacement preview requiring explicit reconfirmation.

## 11. Atomic apply and provenance

Successful confirmation stages, verifies, authenticates, and activates exactly one new immutable generation containing:

- accepted/replaced OTP items;
- local journal entries for actual creates/updates/deletes;
- bounded encrypted `ente-otp-state` provenance metadata;
- retained unrelated local records and metadata.

Provenance contains only the minimum encrypted mapping/state required for later snapshot replacement/deletion and protocol-pin verification. It contains no account password, email in plaintext storage, API token, master/private/Auth key, raw URI, seed duplicate, raw response, cursor claim, or write queue.

Interruption before activation leaves the old generation active. Ambiguous activation fails closed and reconciles through authenticated-root semantics. Retry does not duplicate items or journal changes. Local serialization and authenticated roots are not cross-process CAS.

## 12. Disconnect

Disconnect:

- invalidates all in-memory auth/session/preview capabilities;
- clears owned credentials and keys best effort;
- removes encrypted connection/provenance metadata through one local generation where required;
- retains imported local OTP items;
- makes no Ente network request;
- never deletes or mutates remote data.

Legacy migrated Ente credentials/pending operations are never silently activated. They may be displayed only as safe legacy-state counts requiring a fresh connection, then removed through explicit local disconnect/reset.

## 13. Messaging and errors

`packages/messaging/src/ente.ts` defines strict version-1, vault-only, exact-document messages with exact request-response pairing. Raw passwords and reusable credentials are not message fields. Any worker-derived proof is opaque, bounded, challenge/session/document-bound, transferred with owned buffers, and cleared after use.

Fixed error categories include:

- `ENTE_INVALID`;
- `ENTE_UNAVAILABLE`;
- `ENTE_AUTH_FAILED`;
- `ENTE_SECOND_FACTOR_REQUIRED`;
- `ENTE_PASSKEY_UNAVAILABLE`;
- `ENTE_PROTOCOL_UNSUPPORTED`;
- `ENTE_PROTOCOL_DRIFT`;
- `ENTE_SNAPSHOT_LIMIT`;
- `ENTE_SNAPSHOT_AMBIGUOUS`;
- `ENTE_CONFLICT`;
- `ENTE_PREVIEW_EXPIRED`;
- `ENTE_PERMISSION_DENIED`.

No endpoint body, email, URI, label, ciphertext, token, library error, or server message is reflected.

## 14. UI

`EnteSettings.tsx` lives in the trusted full-vault settings area. It clearly states:

- read-only manual snapshot import;
- ShardPass never uploads or deletes Ente data;
- refresh always downloads a complete snapshot;
- source-derived compatibility is pinned to an Ente commit;
- pagination ambiguity or protocol drift stops before mutation.

The UI supports connection, email-code/password/TOTP transitions, official passkey handoff when safely available, manual refresh, metadata-only preview, conflict consequence confirmation, apply, and local disconnect. Sensitive inputs clear synchronously on transition, lock, cancel, error, replacement, and unmount. Owned async jobs suppress stale results.

## 15. Testing and evidence

### Phase 1 — pinned protocol and crypto compatibility

- Strict schema/limit tests for every auth/key/entity response.
- Exact official synthetic KDF/SRP/key/token/Auth entity vectors.
- CSP-safe local worker/package evidence.
- No handwritten crypto or fallback.
- Compile-time dependency test proving `LoginItem` cannot enter the adapter.
- Protocol-drift and unsupported-version failures.

### Phase 2 — authentication and read-only snapshot apply

- Deterministic local mock Ente server; no real account or external network.
- OTT, SRP, TOTP, official passkey handoff/polling branches.
- Token/key recovery, Auth-key read, snapshot pages/tombstones/dedup.
- Equal-timestamp ambiguity, limits, malformed entities, non-OTP rejection, timeout/abort/lock/restart.
- Write-free preview, conflicts, changed-preview reconfirmation, one-generation apply, interruption/retry/no duplicate.
- Disconnect local-only and no mutation endpoint reachable.

### Phase 3 — UI, packaged security, and release gate

- Packaged mock-server browser tests with synthetic data only.
- Connection states, sensitive input redaction, preview/apply/disconnect, conflict, lock/restart, accessibility, compact layout.
- Exact `api.ente.io` permission/connect-src assertions, no arbitrary hosts, no mutation requests.
- Build scan for credentials, seeds, fixture secrets, network sinks, dynamic code, and legacy-bundle imports.
- Exact 17 legacy artifacts, reproducible build, production audit.
- Official Node 22 and actual Chrome/Chromium 110 evidence remain hard release blockers unless genuinely run.

## 16. Three-phase implementation strategy

1. **Pinned schemas, official crypto/SRP adapters, and deterministic compatibility fixtures.** Stop if official code cannot satisfy CSP or vectors.
2. **Trusted authentication, in-memory credentials, complete read-only snapshot, preview/conflicts, and atomic local apply.** No write endpoint exists.
3. **Vault settings UI, packaged mock-server/security evidence, documentation, verification scripts, and final review.**

Each phase has one consolidated review. A later phase does not begin with unresolved load-bearing findings.

## 17. Security claims and residual risks

- ShardPass claims read-only compatibility only with the pinned Ente source commit.
- It does not claim Ente's source-derived API is stable or officially supported for third-party clients.
- It does not claim timestamp-only pagination is collision-safe; ambiguity stops the snapshot.
- It does not claim guaranteed JavaScript zeroization.
- Ente, the browser, and the device necessarily observe authentication/API traffic.
- Authenticated remote data remains untrusted until strict validation.
- Conflict replacement occurs only after explicit consequence confirmation.
- The official passkey page is an external Ente trust transition.
- Read-only behavior is enforced by fixed transport methods/paths, absence of mutation destinations, tests, and output policy.
