# Project 1 Task 8 OTP CRUD UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver encrypted OTP search and CRUD, safe one-item code projections, HOTP reservation lifecycle support, compact popup code/copy/countdown, and a complete full-vault OTP editor without weakening the post-Task-7 session, storage, migration, or security boundaries.

**Architecture:** The broader approved plan at `docs/superpowers/plans/2026-07-29-project-1-vault-otp.md` remains authoritative; this file is a supplemental, execution-level expansion of its Task 8 only. A session-owned repository bridge keeps the DEK, `VaultCryptoContext`, authenticated root, and root-change coordination inside `SessionService`; strict versioned messages call an `OtpService` that returns bounded projections; popup is read/copy-only while all create/edit/delete behavior lives in the full vault. Ten sequential TDD tasks each end at an independent review gate.

**Tech Stack:** TypeScript 5.9.3 strict mode, React, Zod Mini, Web Crypto through existing `@shardpass/otp`, encrypted generation storage through `@shardpass/storage`, Chrome MV3, Vitest 4.1.10, Testing Library, Playwright 1.62.0, Prettier 3.9.6, pnpm 10.14.0.

## Authority and scope

- `docs/superpowers/plans/2026-07-29-project-1-vault-otp.md` is the broader approved and authoritative Project 1 plan. This supplement does not revise Task 8 acceptance criteria or authorize Task 9 imports, Task 10 backup, Task 11 page fill, Task 12 Ente sync, or Task 13 release work.
- `docs/superpowers/specs/2026-07-29-password-manager-foundation-design.md` remains the approved foundation specification.
- Implement exactly the ten tasks below in order. Do not execute a later task while the current task's review gate is open.
- Do not perform Git, worktree, branch, commit, or push operations.
- Record Task 8 command evidence, review outcomes, corrections, and final gate results only in `.sdd/project1-task8-execution-ledger.md`. Do not append Task 8 evidence to `.sdd/execution-ledger.md`, `.sdd/project1-task7-execution-ledger.md`, a plan, or another document.

## Global constraints

- Project 0 and the completed Project 1 Tasks 1–7 behavior must remain passing; use the current source rather than the preserved minified artifact.
- The preserved ShardPass 1.2.1 artifact is a behavioral reference and fixture source only. New source must not import or edit its bundles, and builds write only to `dist/`.
- Node is `>=22.14.0 <23`, pnpm is exactly `10.14.0`, and minimum Chrome remains `110`. Do not change these floors in Task 8.
- Keep existing dependency versions pinned. Task 8 adds no runtime or development dependency and does not hand-roll cryptographic primitives.
- The background service worker exclusively owns the DEK, decrypted `OtpItem` objects, repository crypto context, generation/root authentication, HOTP reservation state, and CRUD orchestration.
- The session-owned bridge must never return or accept a DEK, `VaultCryptoContext`, `WrappedVaultKey`, `VaultRoot`, repository instance, migration capability, or callback that can capture any of them.
- Every repository operation authenticates the exact active root. Every internal repository activation synchronizes `SessionService.expectedRoot` and is distinguished from an external root notification. Deletion, malformed replacement, unrecognized replacement, notification/commit races, or failed post-activation authentication lock fail-closed.
- UI receives only bounded list/editor/code/result projections. It never receives a whole decrypted collection, OTP seed outside the single vault-only editor projection, key material, Ente credentials, backup plaintext, or unrestricted repository metadata.
- Full create, editor, update, delete, and conflict resolution are vault-only. Popup provides list, current code, countdown, copy, lock/open-vault actions, and opens the vault page for editing.
- All runtime messages are strict, version `1`, runtime-validated, reject unknown fields, and are authorized against browser-owned extension ID, exact popup/vault URL, and document ID. HOTP reservation commands additionally require browser-owned content `tabId`, `frameId`, and `documentId`.
- Safe errors are allowlisted fixed code/message pairs. Never interpolate raw errors, issuer, label, tags, notes, secret, code, full item, page content, or user-controlled input into an error, event, log, snapshot name, accessible label, or test title.
- Production code does not use `console.log`. Task 8 adds no analytics, remote network access, remote fonts/assets, dynamic code, inline executable code, or Ente network authority.
- Manifest permissions remain `storage`, `alarms`, and `idle`. Do not add `clipboardRead`, `clipboardWrite`, host permissions, `tabs`, or another permission. Clipboard writes use `navigator.clipboard.writeText` only from an explicit popup/vault user gesture.
- Do not claim clipboard auto-clear unless ownership can be verified; Task 8 does not implement a clear timer. Clipboard failures leave the code visible and show fixed safe retry text.
- Search is locale-stable: normalize the query and each issuer, label, and tag with `value.normalize("NFKC").toLocaleLowerCase("en-US")`; match when any normalized field includes the normalized trimmed query. Empty normalized query returns all items. Do not search secrets, notes, codes, IDs, Ente metadata, or ciphertext.
- Persisted OTP remains strict `OtpItem` only. Unknown/future kinds fail closed. Preserve TOTP, HOTP, and Steam behavior; SHA-1/SHA-256/SHA-512; configured digits/period; HOTP counter; tags/note; and existing schema bounds.
- Steam remains `otpType: "steam"`, SHA-1, five characters, and 30 seconds. Do not treat it as decimal TOTP or relax `OtpItemSchema`.
- TOTP and Steam reads never mutate storage. HOTP advances only through confirmed successful fill reservation commit, exactly once under concurrency. Listing, opening, displaying, copying, reserving, cancelling, failed fill, or expired reservation never advances it.
- Repository writes remain immutable-generation, staged, verified, and activated with authenticated associated data and revision compare-and-swap. Task 8 must not bypass the existing journal, tombstone, HOTP receipt, rollback, nonce, or capacity rules.
- CRUD is non-CAS at the storage-root level only in the existing generation-store sense; do not introduce a caller-supplied root CAS API. Item update/delete still require `expectedRevision`, and revision conflicts never overwrite.
- Lock increments the existing session epoch and wins against in-flight list/get/code/CRUD/HOTP operations. Failed or locked operations do not count as user activity. Successful intentional OTP commands use the existing settings activity path introduced by Task 5.
- JavaScript cannot guarantee physical memory zeroization. Minimize references and overwrite mutable byte buffers where practical, but do not claim guaranteed erasure.
- Preserve `MigrationPanel` in the full vault while migration remains available. Task 8 does not delete, retire, rewrite, or automatically remove the old legacy vault value.
- Automatic form submission remains out of scope. Task 8 creates HOTP reservation/commit/cancel service and message contracts needed by later fill work but does not activate the inert content UI or implement Task 11 field discovery/fill.
- Keep existing extension-page CSP exactly unchanged.
- UI retains the approved dark precise ShardPass theme: compact rows, issuer marker, mono tabular codes, countdown urgency, coral selection rail, sharp geometry, keyboard focus, reduced motion, and WCAG AA-oriented semantics.

## Exact file map and responsibilities

### Create

- `apps/extension/src/background/vault/session-vault-repository.ts` — session-owned, capability-free bridge interface and implementation around `VaultRepository`; returns only OTP-domain results and coordinates internal roots through `SessionService` hooks.
- `apps/extension/test/background/session-vault-repository.test.ts` — bridge root synchronization, lock race, no-context API, and external-notification tests.
- `packages/messaging/src/otp.ts` — strict OTP request/response schemas, UI-safe projection schemas, request/response types, and sender policies.
- `packages/messaging/test/otp.test.ts` — unknown-field, bounds, projection minimization, sender-policy, and response-schema tests.
- `apps/extension/src/background/otp/otp-service.ts` — normalized search, list/editor projections, CRUD, code generation, safe domain errors, and HOTP lifecycle orchestration.
- `apps/extension/test/background/otp-service.test.ts` — service search/CRUD/code/conflict/lock/projection tests.
- `apps/extension/test/background/otp-hotp-lifecycle.test.ts` — reservation binding, commit, cancel, expiry, replay, and counter concurrency tests.
- `apps/extension/src/popup/otp/OtpCountdown.tsx` — accessible visual time remaining without announcing/changing code digits.
- `apps/extension/src/popup/otp/OtpRow.tsx` — compact issuer/label/code row with explicit copy and edit-in-vault actions.
- `apps/extension/src/popup/otp/OtpList.tsx` — popup loading, locked, empty, list, rollover, copy feedback, and vault navigation behavior.
- `apps/extension/src/popup/otp/OtpList.module.css` — compact popup OTP visuals and reduced-motion behavior.
- `apps/extension/test/popup/OtpList.dom.test.tsx` — popup list/countdown/copy/navigation/accessibility tests.
- `apps/extension/src/vault/otp/OtpVaultView.tsx` — full-page searchable list/detail orchestration, selection, conflict refresh, and delete confirmation.
- `apps/extension/src/vault/otp/OtpEditor.tsx` — vault-only create/edit form and concealed-by-default secret control.
- `apps/extension/src/vault/otp/OtpVaultView.module.css` — responsive list/editor split view and compact mode.
- `apps/extension/test/vault/OtpVaultView.dom.test.tsx` — search, create, edit, delete, conflict, focus, and MigrationPanel coexistence tests.
- `tests/browser/project1-otp-crud.spec.ts` — packaged-extension setup, unlock, create/search/edit/delete, popup code/copy, rollover, conflict-safe behavior, lock redaction, and accessibility E2E.
- `.sdd/project1-task8-execution-ledger.md` — Task 8-only command and review evidence, created when Task 1 records its first RED result.

### Modify

- `packages/storage/src/vault-repository.ts` — add an activation coordinator so session code can mark an internal candidate before activation and accept only an authenticated activated root afterward.
- `packages/storage/test/vault-repository.test.ts` — activation coordinator order/failure coverage without changing storage semantics.
- `packages/storage/src/index.ts` — export `VaultRepositoryActivationCoordinator`.
- `apps/extension/src/background/vault/session-service.ts` — own the bridge, repository context, internal-candidate synchronization, post-activation root authentication, epoch checks, and lock callback cleanup.
- `apps/extension/test/background/session-service.test.ts` — internal versus external root notification and lock-race regressions.
- `packages/security/src/errors.ts` — add fixed OTP safe error codes/messages.
- `packages/security/test/errors.test.ts` — exact OTP safe error mapping.
- `packages/otp/src/reservation.ts` — add explicit in-memory reservation clearing for lock/disposal without changing counters or receipts.
- `packages/otp/test/reservation.test.ts` — prove clearing invalidates reservations and never calls the committer.
- `packages/messaging/src/index.ts` — export OTP schemas/types/policy.
- `apps/extension/src/background/router.ts` — route authorized OTP requests and project only schema-validated OTP responses.
- `apps/extension/test/background/router.test.ts` — OTP invalid/unauthorized/safe-error/response-minimization tests.
- `apps/extension/src/background/main.ts` — construct `OtpService` and HOTP reservation service, pass them to the router, publish state after lock-relevant failures, and dispose reservation state.
- `apps/extension/test/background/background-runtime.integration.test.ts` — composition and root-notification integration.
- `apps/extension/src/platform/extension-platform.ts` — add typed `sendOtpMessage` helper contract at the UI adapter boundary without adding browser authority.
- `apps/extension/src/platform/chrome-platform.ts` — validate OTP responses before returning them to UI and expose unchanged `openVaultPage()`.
- `apps/extension/test/platform/chrome-platform.test.ts` — malformed OTP response rejection and vault navigation tests.
- `apps/extension/src/popup/PopupApp.tsx` — show `OtpList` only while unlocked and retain existing vault access/lock controls.
- `apps/extension/src/popup/PopupApp.module.css` — size OTP region within the 360px popup.
- `apps/extension/test/popup/PopupApp.dom.test.tsx` — locked/unlocked OTP composition tests.
- `apps/extension/src/vault/VaultApp.tsx` — replace disabled placeholders with `OtpVaultView` when unlocked and retain `MigrationPanel`.
- `apps/extension/src/vault/VaultApp.module.css` — support active search/create and responsive OTP workspace.
- `apps/extension/test/vault/VaultApp.dom.test.tsx` — unlocked editor plus migration retention tests.
- `apps/extension/test/vault/VaultApp.styles.test.ts` — responsive/focus/reduced-motion style contracts.
- `tests/browser/__screenshots__/popup-otp-linux.png` — reviewed packaged popup OTP baseline.
- `tests/browser/__screenshots__/vault-otp-desktop-linux.png` — reviewed packaged desktop vault OTP baseline.
- `tests/browser/__screenshots__/vault-otp-compact-linux.png` — reviewed packaged compact vault OTP baseline.
- `package.json` — add focused `test:project1:task8` and `verify:project1:task8` scripts only; retain all existing scripts.

## Task 1: Add the session-owned repository bridge and authenticated root coordination

**Files:**

- Create: `apps/extension/src/background/vault/session-vault-repository.ts`
- Create: `apps/extension/test/background/session-vault-repository.test.ts`
- Modify: `packages/storage/src/vault-repository.ts`
- Modify: `packages/storage/src/index.ts`
- Modify: `packages/storage/test/vault-repository.test.ts`
- Modify: `apps/extension/src/background/vault/session-service.ts`
- Modify: `apps/extension/test/background/session-service.test.ts`
- Create: `.sdd/project1-task8-execution-ledger.md`

**Interfaces:**

- Consumes: existing `VaultRepository`, `VaultCryptoContext`, `OtpItem`, `VaultItemMetadata`, `TombstoneResult`, `HotpReservationCommitRequest`, `HotpReservationCommitResult`, `SessionService.assertActiveRoot()`, session epoch, `expectedRoot`, and internal root notification handling.
- Produces:

```ts
export interface VaultRepositoryActivationCoordinator {
  beforeActivate(candidate: VaultRoot): Promise<void>;
  afterActivate(activated: VaultRoot): Promise<void>;
  activationFailed(candidate: VaultRoot): Promise<void>;
}

export interface SessionVaultRepository {
  listMetadata(): Promise<readonly VaultItemMetadata[]>;
  get(itemId: string): Promise<OtpItem | null>;
  create(candidate: OtpItem): Promise<OtpItem>;
  update(candidate: OtpItem, expectedRevision: number): Promise<OtpItem>;
  tombstone(itemId: string, expectedRevision: number): Promise<TombstoneResult>;
  commitHotpReservation(
    request: HotpReservationCommitRequest,
  ): Promise<HotpReservationCommitResult>;
  lookupHotpReservationReceipt(
    request: HotpReservationCommitRequest,
  ): Promise<HotpReservationCommitResult | null>;
}

export function createSessionVaultRepository(session: SessionService): SessionVaultRepository;
```

- `SessionService` additionally produces package-private methods used only by the bridge:

```ts
runRepositoryRead<T>(operation: (repository: VaultRepository, context: VaultCryptoContext) => Promise<T>): Promise<T>;
runRepositoryMutation<T>(operation: (repository: VaultRepository, context: VaultCryptoContext) => Promise<T>): Promise<T>;
```

These methods remain in the background implementation and are not exported from a package public index. `createSessionVaultRepository` closes over them; consumers receive only `SessionVaultRepository`.

- [ ] **Step 1: Write failing storage and bridge tests**

```ts
it("marks the candidate before activation and accepts only the authenticated activated root", async () => {
  const order: string[] = [];
  const coordinator: VaultRepositoryActivationCoordinator = {
    beforeActivate: async () => void order.push("before"),
    afterActivate: async () => void order.push("after"),
    activationFailed: async () => void order.push("failed"),
  };
  await repositoryWith(coordinator).create(otpCandidate(), context);
  expect(order).toEqual(["before", "after"]);
});

it("does not expose repository context or key material through the bridge", () => {
  expect(Object.keys(bridge).sort()).toEqual([
    "commitHotpReservation",
    "create",
    "get",
    "listMetadata",
    "lookupHotpReservationReceipt",
    "tombstone",
    "update",
  ]);
});

it("does not lock on its own authenticated root notification", async () => {
  await bridge.create(otpCandidate());
  await deliverQueuedActiveRootNotification();
  await expect(session.getState()).resolves.toMatchObject({ state: "unlocked" });
});

it("locks when an external root wins during a repository mutation", async () => {
  const operation = bridge.update(changedItem(), 1);
  await replaceActiveRootWithAuthenticatedButUnexpectedRoot();
  await expect(operation).rejects.toMatchObject({ code: "VAULT_LOCKED" });
  await expect(session.getState()).resolves.toMatchObject({ state: "locked" });
});
```

Also assert notification-before-`afterActivate`, notification-after-`afterActivate`, activation throw, post-activation authentication failure, explicit lock during mutation, and external root deletion.

- [ ] **Step 2: Run RED tests**

Run: `pnpm exec vitest run packages/storage/test/vault-repository.test.ts apps/extension/test/background/session-vault-repository.test.ts apps/extension/test/background/session-service.test.ts`

Expected: FAIL because `VaultRepositoryActivationCoordinator`, `SessionVaultRepository`, `createSessionVaultRepository`, and session repository operations do not exist, and repository commits currently activate roots without session synchronization.

- [ ] **Step 3: Add minimal storage activation hooks**

  Extend the `VaultRepository` constructor with an optional final coordinator parameter whose default methods are no-ops. In its private `commit`, call `beforeActivate(verified.root)` immediately before `GenerationStore.activate`, call `afterActivate(activated)` only with the root returned by successful activation, and call `activationFailed(verified.root)` in the activation failure path. Do not move staging, verification, journal, receipt, nonce, or capacity logic.

- [ ] **Step 4: Implement the session bridge**

  Construct the repository only while the session is unlocked. Derive context internally from the session's memory-only DEK and existing clock/random/ID dependencies. Before every read, authenticate the current root and capture the epoch. Serialize mutation entry with the existing session mutation mutex; set `commitCandidate` before activation. After activation, read/authenticate the active generation using the session DEK, require exact canonical equality with the activated root, update `expectedRoot`, clear `commitCandidate`, and recheck epoch. Any uncertainty clears session state and throws `VaultSessionError("VAULT_LOCKED")` or `VaultSessionError("VAULT_UNAVAILABLE")` according to the existing distinction.

  `update(candidate, expectedRevision)` must call the existing repository updater as `repository.update(candidate, expectedRevision, () => candidate, context)` so repository-owned immutable metadata/revision rules remain authoritative.

- [ ] **Step 5: Run GREEN and regression tests**

Run: `pnpm exec vitest run packages/storage apps/extension/test/background/session-vault-repository.test.ts apps/extension/test/background/session-service.test.ts apps/extension/test/background/migration-service.test.ts apps/extension/test/background/migration-destination.test.ts`

Expected: PASS; internal notifications do not self-lock, external roots still lock, migration still uses its existing session capability path, and no public bridge method exposes context/key/root values.

- [ ] **Step 6: Record evidence and pass the independent review gate**

  Create `.sdd/project1-task8-execution-ledger.md` with date, task title, exact RED/GREEN commands, observed exit codes/counts, expected RED reason, changed-file list, and reviewer outcome. A fresh reviewer must inspect root notification ordering, epoch/lock wins, coordinator failure cleanup, public surface, and migration non-regression. Continue only after all Critical and Important findings are corrected and the focused GREEN command is rerun and recorded.

## Task 2: Define strict OTP messages and fixed safe errors

**Files:**

- Create: `packages/messaging/src/otp.ts`
- Create: `packages/messaging/test/otp.test.ts`
- Modify: `packages/messaging/src/index.ts`
- Modify: `packages/security/src/errors.ts`
- Modify: `packages/security/test/errors.test.ts`

**Interfaces:**

- Consumes: message version `1`, `CommandSenderPolicy`, strict Zod schemas, `OtpItemSchema` bounds, and existing `SafeError` mapping.
- Produces these exact request kinds:

```ts
type OtpRequest =
  | { version: 1; kind: "otp.list"; query: string }
  | { version: 1; kind: "otp.getEditor"; itemId: string }
  | { version: 1; kind: "otp.create"; input: OtpCreateInput }
  | {
      version: 1;
      kind: "otp.update";
      itemId: string;
      expectedRevision: number;
      input: OtpEditableInput;
    }
  | { version: 1; kind: "otp.delete"; itemId: string; expectedRevision: number }
  | { version: 1; kind: "otp.getCode"; itemId: string }
  | { version: 1; kind: "otp.copyCode"; itemId: string }
  | { version: 1; kind: "otp.reserveHotp"; itemId: string }
  | { version: 1; kind: "otp.commitHotp"; reservationId: string }
  | { version: 1; kind: "otp.cancelHotp"; reservationId: string };
```

```ts
interface OtpListItemProjection {
  id: string;
  revision: number;
  issuer: string;
  label: string;
  otpType: "totp" | "hotp" | "steam";
  favorite: boolean;
  tags: readonly string[];
}
interface OtpEditableInput {
  issuer: string;
  label: string;
  secret: string;
  otpType: "totp" | "hotp" | "steam";
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
  counter?: number;
  favorite: boolean;
  tags: readonly string[];
  note: string;
}
type OtpCreateInput = OtpEditableInput;
interface OtpEditorProjection extends OtpEditableInput {
  id: string;
  revision: number;
}
interface OtpCodeProjection {
  itemId: string;
  revision: number;
  code: string;
  otpType: "totp" | "steam";
  remaining: number;
  expiresAt: number;
}
```

- Produces response kinds: `otp.listResult`, `otp.editorResult`, `otp.mutationResult`, `otp.deleteResult`, `otp.codeResult`, `otp.hotpReserved`, `otp.hotpCommitted`, and `otp.hotpCancelled`. `otp.editorResult` is authorized only for vault senders. `otp.codeResult` is a single item's short-lived code. HOTP reservation responses contain reservation ID/code/counter/revision/expiry but no secret.
- Produces fixed safe codes: `OTP_INVALID`, `OTP_NOT_FOUND`, `OTP_CONFLICT`, `OTP_HOTP_REQUIRED`, `OTP_RESERVATION_INVALID`, `OTP_RESERVATION_STALE`, `OTP_RESERVATION_UNCERTAIN`, and `CLIPBOARD_UNAVAILABLE`, each mapped to one fixed non-reflective message.
- [ ] **Step 1: Write failing schema and safe-error tests**

```ts
it("rejects a list projection containing a secret", () => {
  expect(
    OtpResponseSchema.safeParse({
      version: 1,
      kind: "otp.listResult",
      items: [{ ...listProjection(), secret: "NOT-A-REAL-SECRET" }],
    }).success,
  ).toBe(false);
});

it("keeps full CRUD vault-only", () => {
  expect(otpSenderPolicy["otp.create"].allowedContexts).toEqual(["vault"]);
  expect(otpSenderPolicy["otp.copyCode"].allowedContexts).toEqual(["popup", "vault"]);
  expect(otpSenderPolicy["otp.reserveHotp"].allowedContexts).toEqual(["content"]);
});

it("maps OTP failures to fixed text", () => {
  expect(toSafeError("reflected input", "OTP_CONFLICT")).toEqual({
    code: "OTP_CONFLICT",
    message: "This item changed. Review the latest version and try again.",
  });
});
```

Cover every request/response, unknown fields, invalid UUID/revision/reservation ID, overlong input, illegal Steam/HOTP combinations, secret absence in list/delete/mutation responses, editor secret presence only in editor schema, and exact policies.

- [ ] **Step 2: Run RED tests**

Run: `pnpm exec vitest run packages/messaging/test/otp.test.ts packages/security/test/errors.test.ts`

Expected: FAIL because OTP message schemas, policies, exports, and OTP safe error codes do not exist.

- [ ] **Step 3: Implement strict schemas and safe errors**

  Build all request objects with `z.strictObject`, a discriminated union on `kind`, exact bounds imported from domain where available, UUID schemas for item/reservation IDs, positive safe revisions, and exact response schemas. Use `requireDocument: true` for every OTP command; HOTP lifecycle policy additionally uses content-only context with required tab/frame/document. Export all schemas and inferred types from `packages/messaging/src/index.ts`.

- [ ] **Step 4: Run GREEN and messaging regression tests**

Run: `pnpm exec vitest run packages/messaging packages/security`

Expected: PASS with every legacy foundation/vault/migration message unchanged and all malformed OTP shapes failing closed.

- [ ] **Step 5: Record evidence and pass the independent review gate**

  Append only to `.sdd/project1-task8-execution-ledger.md`. A fresh reviewer must compare every schema field with the interfaces above, verify CRUD/editor vault-only policy, confirm list projections cannot carry secrets, and inspect every safe string for reflection. Correct all Critical/Important findings and rerun the GREEN command before Task 3.

## Task 3: Implement OtpService search and CRUD

**Files:**

- Create: `apps/extension/src/background/otp/otp-service.ts`
- Create: `apps/extension/test/background/otp-service.test.ts`

**Interfaces:**

- Consumes: `SessionVaultRepository`, Task 2 request/response types, `OtpItemSchema`, existing `generateOtp`, clock `{ now(): number }`, and ID source `{ next(): string }`.
- Produces:

```ts
export type OtpServiceErrorCode =
  | "VAULT_LOCKED"
  | "VAULT_UNAVAILABLE"
  | "OTP_INVALID"
  | "OTP_NOT_FOUND"
  | "OTP_CONFLICT"
  | "OTP_HOTP_REQUIRED"
  | "OTP_RESERVATION_INVALID"
  | "OTP_RESERVATION_STALE"
  | "OTP_RESERVATION_UNCERTAIN";

export class OtpServiceError extends Error {
  constructor(readonly code: OtpServiceErrorCode);
}

export class OtpService {
  constructor(dependencies: {
    repository: SessionVaultRepository;
    clock: { now(): number; isoNow(): string };
    ids: { next(): string };
    reservations: HotpReservationService;
    notePrivilegedActivity(): Promise<void>;
  });
  handle(request: OtpRequest, sender: SenderContext): Promise<OtpResponse>;
}

export function normalizeOtpSearch(value: string): string;
```

- `otp.list` first obtains metadata, then gets only matching candidate records needed to project issuer/label/tags because encrypted metadata currently omits those fields. It returns no results when locked and never caches records after the request.
- `otp.create` creates metadata server-side (`id`, revision/timestamps placeholders accepted by repository normalization) and validates through `OtpItemSchema`; caller cannot set ID, revision, timestamps, archived/deleted state, or Ente metadata.
- `otp.update` obtains the current item, applies only `OtpEditableInput`, and relies on repository `expectedRevision`; `otp.delete` tombstones with `expectedRevision`.
- `otp.getCode` and `otp.copyCode` accept TOTP/Steam only. HOTP requires reservation and later confirmed fill; popup/vault code requests for HOTP return `OTP_HOTP_REQUIRED` without advancing.
- [ ] **Step 1: Write failing service tests**

```ts
it("searches only NFKC en-US folded issuer, label, and tags", async () => {
  await createItems([
    item({ issuer: "Ａcme" }),
    item({ label: "İSTANBUL" }),
    item({ tags: ["Work"] }),
  ]);
  expect(await listedIds("acme")).toEqual([ids.acme]);
  expect(await listedIds("i̇stanbul")).toEqual([ids.istanbul]);
  expect(await listedIds("work")).toEqual([ids.work]);
  expect(await listedIds("note-only-token")).toEqual([]);
});

it("does not overwrite a newer revision", async () => {
  await expect(
    service.handle(updateRequest({ expectedRevision: 1 }), vaultSender),
  ).rejects.toMatchObject({ code: "OTP_CONFLICT" });
  expect(await repository.get(itemId)).toMatchObject({ revision: 2, label: "newer" });
});

it("returns a bounded TOTP projection and rejects HOTP display", async () => {
  expect(await service.handle(getCodeRequest(totpId), popupSender)).toEqual({
    version: 1,
    kind: "otp.codeResult",
    itemId: totpId,
    revision: 1,
    code: "123456",
    otpType: "totp",
    remaining: 15,
    expiresAt: 30_000,
  });
  await expect(service.handle(getCodeRequest(hotpId), popupSender)).rejects.toMatchObject({
    code: "OTP_HOTP_REQUIRED",
  });
});
```

Add create canonicalization rejection, list no seed/note/code, editor vault-only defense in depth, delete tombstone, missing item, locked operation, lock during generation, TOTP rollover, Steam five-character result, algorithms/digits/period preservation, and fixed error tests.

- [ ] **Step 2: Run RED tests**

Run: `pnpm exec vitest run apps/extension/test/background/otp-service.test.ts`

Expected: FAIL because `OtpService` and `normalizeOtpSearch` do not exist.

- [ ] **Step 3: Implement minimal service**

```ts
export function normalizeOtpSearch(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}
```

Map storage/session/OTP errors into `OtpServiceError` by allowlisted code without including raw messages. Recheck repository/session authority before returning code or mutation results. Call `notePrivilegedActivity()` only after a successful intentional OTP response; never call it for rejected, locked, malformed, or failed operations. Sort lists deterministically: favorites first, then normalized issuer, normalized label, and ID as final tie-breaker. Do not add pagination or recent-item persistence in Task 8.

- [ ] **Step 4: Run GREEN and domain regressions**

Run: `pnpm exec vitest run apps/extension/test/background/otp-service.test.ts packages/domain packages/otp packages/storage`

Expected: PASS; known-answer generation and encrypted repository behavior remain unchanged.

- [ ] **Step 5: Record evidence and pass the independent review gate**

  Append Task 3 evidence only to the Task 8 ledger. A fresh reviewer must trace every projection, normalization call, conflict path, lock check, HOTP rejection, Steam branch, and raw-error boundary. Correct all Critical/Important findings and rerun GREEN before Task 4.

## Task 4: Integrate HOTP reservation, commit, and cancel lifecycle

**Files:**

- Create: `apps/extension/test/background/otp-hotp-lifecycle.test.ts`
- Modify: `apps/extension/src/background/otp/otp-service.ts`
- Modify: `apps/extension/src/background/vault/session-vault-repository.ts`
- Modify: `packages/otp/src/reservation.ts`
- Modify: `packages/otp/test/reservation.test.ts`

**Interfaces:**

- Consumes: existing `HotpReservationService`, `createRepositoryHotpCommitter`, reservation TTL/retention behavior, Task 1 bridge receipt/commit methods, and content `SenderContext`.
- Produces lifecycle behavior:

```ts
reserveHotp(itemId, binding): Promise<{
  reservationId: string;
  itemId: string;
  itemRevision: number;
  counter: number;
  code: string;
  expiresAt: number;
}>;
commitHotp(reservationId, binding): Promise<{ revision: number; counter: number }>;
cancelHotp(reservationId, binding): Promise<{ cancelled: boolean }>;
```

`binding` is exactly `{ tabId, frameId, documentId }` derived from browser-owned content sender context, never from request fields.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it("increments exactly once after confirmed commit", async () => {
  const reserved = await service.handle(reserveRequest(itemId), contentA);
  const [first, replay] = await Promise.all([
    service.handle(commitRequest(reserved.reservationId), contentA),
    service.handle(commitRequest(reserved.reservationId), contentA),
  ]);
  expect(first).toEqual(replay);
  expect(await currentCounter(itemId)).toBe(8);
});

it.each(["list", "get", "copy", "reserve", "cancel", "expire", "wrong-binding"])(
  "does not increment on %s",
  async (operation) => {
    await performWithoutConfirmedCommit(operation);
    expect(await currentCounter(itemId)).toBe(7);
  },
);
```

Cover same-item parallel reservations, stale revision, expired reservation, cancel idempotence without disclosure, wrong tab/frame/document, lock between reserve/commit, uncertain commit reconciliation by encrypted receipt, counter maximum, reservation capacity, disposal/lock clearing, and TOTP/Steam reservation rejection.

- [ ] **Step 2: Run RED tests**

Run: `pnpm exec vitest run apps/extension/test/background/otp-hotp-lifecycle.test.ts packages/otp/test/repository-reservation.test.ts packages/otp-storage/test/repository-committer.test.ts`

Expected: FAIL because `OtpService` does not yet route lifecycle requests through sender-derived bindings and the bridge is not yet adapted to `createRepositoryHotpCommitter` without exposing context.

- [ ] **Step 3: Implement minimal lifecycle integration**

  Add an adapter in the bridge that satisfies `HotpCounterCommitter` using its own `commitHotpReservation` and receipt reconciliation methods. Construct one background-owned `HotpReservationService`. Convert content sender metadata to `ReservationBinding` only after Task 2 policy and runtime sender validation. Add `clear(): void` to `HotpReservationService`; it removes all in-memory entries and active-item indexes without touching counters or storage. Register `clear()` through the existing `SessionService.onLockOrDispose()` callback and call it during background disposal; never persist code/reservation state. Preserve existing encrypted commit receipts for uncertain-outcome reconciliation.

- [ ] **Step 4: Run GREEN and concurrency regressions**

Run: `pnpm exec vitest run apps/extension/test/background/otp-hotp-lifecycle.test.ts packages/otp packages/otp-storage packages/storage/test/vault-repository.test.ts`

Expected: PASS; each confirmed reservation advances once, replay is idempotent, and every non-confirmed path preserves the counter.

- [ ] **Step 5: Record evidence and pass the independent review gate**

  Append only Task 4 evidence to the Task 8 ledger. A fresh reviewer must examine binding derivation, lock/dispose cleanup, race behavior, uncertain reconciliation, receipt secrecy, and every no-increment path. Correct all Critical/Important findings and rerun GREEN before Task 5.

## Task 5: Compose OTP runtime routing and platform adapters

**Files:**

- Modify: `apps/extension/src/background/router.ts`
- Modify: `apps/extension/test/background/router.test.ts`
- Modify: `apps/extension/src/background/main.ts`
- Modify: `apps/extension/test/background/background-runtime.integration.test.ts`
- Modify: `apps/extension/src/platform/extension-platform.ts`
- Modify: `apps/extension/src/platform/chrome-platform.ts`
- Modify: `apps/extension/test/platform/chrome-platform.test.ts`
- Modify: `apps/extension/package.json`

**Interfaces:**

- Consumes: `OtpRequestSchema`, `OtpResponseSchema`, `otpSenderPolicy`, `OtpService.handle`, `SessionVaultRepository`, and existing normalized sender context.
- Produces:

```ts
interface ExtensionPlatform {
  // existing members remain
  sendOtpMessage(request: OtpRequest): Promise<OtpResponse>;
}

function routeMessage(
  input: unknown,
  senderContext: unknown,
  expectedExtensionId: string,
  vaultService?: VaultService,
  getState?: () => Promise<VaultStateResponse>,
  migrationHandler?: MigrationHandler,
  otpService?: Pick<OtpService, "handle">,
): Promise<BackgroundResponse>;
```

- `BackgroundResponse` adds `OtpResponse`, and every service result is reparsed/projected through `OtpResponseSchema` before crossing runtime. OTP errors become existing `BackgroundErrorResponse` with Task 2 codes.
- [ ] **Step 1: Write failing router/composition/platform tests**

```ts
it("rejects popup OTP create before invoking the service", async () => {
  await expect(
    routeMessage(createRequest(), popupSender, extensionId, vault, state, migration, otp),
  ).resolves.toMatchObject({ kind: "error", error: { code: "UNAUTHORIZED_SENDER" } });
  expect(otp.handle).not.toHaveBeenCalled();
});

it("rejects a service response with an added secret", async () => {
  otp.handle.mockResolvedValue({ ...listResult(), secret: "NOT-A-REAL-SECRET" });
  await expect(routeOtpList()).resolves.toMatchObject({
    kind: "error",
    error: { code: "VAULT_UNAVAILABLE" },
  });
});
```

Cover invalid message, missing OTP service, exact popup/vault/content policies, document requirement, safe error mapping, root-triggered lock, typed platform parse failure, and no new clipboard/manifest authority.

- [ ] **Step 2: Run RED tests**

Run: `pnpm exec vitest run apps/extension/test/background/router.test.ts apps/extension/test/background/background-runtime.integration.test.ts apps/extension/test/platform/chrome-platform.test.ts`

Expected: FAIL because router, runtime composition, and platform do not support OTP messages.

- [ ] **Step 3: Implement routing and composition**

  Parse OTP before vault/foundation fallback, authorize with the exact per-command policy, require non-null normalized sender context, call `OtpService`, project/reparse its response, and map only `OtpServiceError.code` through an exhaustive `Record<OtpServiceErrorCode, SafeErrorCode>`; unknown thrown values map to `UNEXPECTED`. In `installBackground`, create the bridge after `SessionService`, create the repository committer/reservation service/OtpService, pass `() => settings.notePrivilegedActivity()` into `OtpService`, and pass the service to `routeMessage`. Register session lock cleanup for reservations and dispose it with the background. Keep migration and state publisher behavior intact.

  `sendOtpMessage` sends the request with the existing runtime transport and accepts only `OtpResponseSchema`; a background error is converted to a fixed UI error object by existing safe handling, never a raw `runtime.lastError`.

- [ ] **Step 4: Run GREEN and runtime regressions**

Run: `pnpm exec vitest run apps/extension/test/background apps/extension/test/platform packages/messaging packages/security`

Expected: PASS; setup/unlock/lock/settings/migration routing remains passing and malformed OTP service output cannot cross the boundary.

- [ ] **Step 5: Record evidence and pass the independent review gate**

  Append Task 5 evidence only to the Task 8 ledger. A fresh reviewer must inspect parse order, authorization-before-service, response reparsing, error projection, runtime construction lifetime, cleanup, and unchanged permissions/CSP. Correct all Critical/Important findings and rerun GREEN before Task 6.

## Task 6: Build popup OTP list, countdown, copy, and vault navigation

**Files:**

- Create: `apps/extension/src/popup/otp/OtpCountdown.tsx`
- Create: `apps/extension/src/popup/otp/OtpRow.tsx`
- Create: `apps/extension/src/popup/otp/OtpList.tsx`
- Create: `apps/extension/src/popup/otp/OtpList.module.css`
- Create: `apps/extension/test/popup/OtpList.dom.test.tsx`
- Modify: `apps/extension/src/popup/PopupApp.tsx`
- Modify: `apps/extension/src/popup/PopupApp.module.css`
- Modify: `apps/extension/test/popup/PopupApp.dom.test.tsx`

**Interfaces:**

- Consumes: `ExtensionPlatform.sendOtpMessage`, `openVaultPage`, `otp.list`, `otp.getCode`, `otp.copyCode`, browser `navigator.clipboard.writeText`, and vault unlocked state from existing `VaultAccess`.
- Produces:

```ts
export interface OtpListProps {
  platform: ExtensionPlatform;
  active: boolean;
  now?: () => number;
  clipboard?: Pick<Clipboard, "writeText">;
}

export interface OtpCountdownProps {
  remaining: number;
  period: number;
  urgentAt: number;
}
```

- Popup never renders an editor or secret field. Each Edit action calls only `openVaultPage()`.
- [ ] **Step 1: Write failing popup tests with fake timers**

```tsx
it("copies only after an explicit click and never announces digits", async () => {
  render(<OtpList platform={platform} active clipboard={clipboard} now={() => 15_000} />);
  await user.click(await screen.findByRole("button", { name: "Copy code for Acme" }));
  expect(clipboard.writeText).toHaveBeenCalledWith("123456");
  expect(screen.getByRole("status")).toHaveTextContent("Code copied");
  expect(screen.getByRole("status")).not.toHaveTextContent("123456");
});

it("refreshes at the expiry boundary without a per-row timer", async () => {
  vi.advanceTimersByTime(15_000);
  expect(platform.sendOtpMessage).toHaveBeenCalledWith({
    version: 1,
    kind: "otp.getCode",
    itemId,
  });
});

it("opens the vault instead of editing in the popup", async () => {
  await user.click(await screen.findByRole("button", { name: "Edit Acme in vault" }));
  expect(platform.openVaultPage).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText("Secret")).not.toBeInTheDocument();
});
```

Cover locked redaction (no metadata), loading/empty/error, Steam display, HOTP unavailable guidance, clipboard rejection with fixed text, duplicate clicks, unmount timer cleanup, urgency, reduced motion, keyboard order, and no code in accessible label/status.

- [ ] **Step 2: Run RED tests**

Run: `pnpm exec vitest run apps/extension/test/popup/OtpList.dom.test.tsx apps/extension/test/popup/PopupApp.dom.test.tsx`

Expected: FAIL because popup OTP components do not exist and `PopupApp` still renders foundation-only content.

- [ ] **Step 3: Implement minimal popup UI**

  On active transition, request `otp.list` with empty query. Fetch one code per visible TOTP/Steam row; maintain one parent boundary timer scheduled to the nearest `expiresAt`, then refresh expired codes. Render tabular mono digits visually; set the digit wrapper `aria-hidden="true"` and give the row a non-secret accessible description. Copy flow calls `otp.copyCode` inside the click handler and immediately passes the returned code to `clipboard.writeText`; discard the local reference after completion. Do not add clipboard manifest permission or a clear timer.

- [ ] **Step 4: Run GREEN and popup regressions**

Run: `pnpm exec vitest run apps/extension/test/popup`

Expected: PASS; locked popup shows no account metadata, copy is gesture-bound, countdown rolls over, and existing setup/unlock/lock/open-vault behavior remains passing.

- [ ] **Step 5: Record evidence and pass the independent review gate**

  Append Task 6 evidence only to the Task 8 ledger. A fresh reviewer must inspect clipboard gesture timing, digit accessibility, timer consolidation/cleanup, lock transition redaction, error copy, and absence of editor/secret UI. Correct all Critical/Important findings and rerun GREEN before Task 7.

## Task 7: Build full-vault search, editor, delete, and conflict UX while retaining migration

**Files:**

- Create: `apps/extension/src/vault/otp/OtpVaultView.tsx`
- Create: `apps/extension/src/vault/otp/OtpEditor.tsx`
- Create: `apps/extension/src/vault/otp/OtpVaultView.module.css`
- Create: `apps/extension/test/vault/OtpVaultView.dom.test.tsx`
- Modify: `apps/extension/src/vault/VaultApp.tsx`
- Modify: `apps/extension/src/vault/VaultApp.module.css`
- Modify: `apps/extension/test/vault/VaultApp.dom.test.tsx`
- Modify: `apps/extension/test/vault/VaultApp.styles.test.ts`

**Interfaces:**

- Consumes: all vault-authorized Task 2 commands, `ExtensionPlatform.sendOtpMessage`, vault unlocked state, and existing `MigrationPanel`.
- Produces:

```ts
export interface OtpVaultViewProps {
  platform: ExtensionPlatform;
  active: boolean;
}

export interface OtpEditorProps {
  mode: "create" | "edit";
  value: OtpEditableInput;
  revision?: number;
  submitting: boolean;
  onSubmit(value: OtpEditableInput): Promise<void>;
  onCancel(): void;
}
```

- Conflict behavior: on `OTP_CONFLICT`, preserve unsaved form state in memory, fetch latest list/editor data, show fixed text explaining the item changed, and require the user to review and explicitly submit again against the new revision. Never silently retry or merge secrets.
- Delete behavior: require a modal/dialog naming the non-secret issuer/label and explicit Delete/Cancel; submit `expectedRevision`; conflict refreshes rather than deleting a newer record.
- [ ] **Step 1: Write failing vault DOM tests**

```tsx
it("creates, edits, and deletes only through vault commands", async () => {
  await user.click(screen.getByRole("button", { name: "Create OTP" }));
  await fillValidTotpEditor();
  await user.click(screen.getByRole("button", { name: "Save OTP" }));
  expect(sentKinds()).toContain("otp.create");
  expect(sentKinds()).not.toContain("otp.reserveHotp");
});

it("preserves unsaved input and refreshes a revision conflict", async () => {
  platform.failNext("otp.update", "OTP_CONFLICT");
  await user.clear(screen.getByLabelText("Label"));
  await user.type(screen.getByLabelText("Label"), "My unsaved label");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(screen.getByLabelText("Label")).toHaveValue("My unsaved label");
  expect(screen.getByRole("alert")).toHaveTextContent("This item changed");
  expect(sentKinds()).toEqual(expect.arrayContaining(["otp.update", "otp.list", "otp.getEditor"]));
});

it("retains migration controls beside the unlocked OTP workspace", async () => {
  render(<VaultApp platform={platform} />);
  await unlockVault();
  expect(screen.getByRole("heading", { name: "One-time passwords" })).toBeVisible();
  expect(screen.getByRole("heading", { name: /Migration/i })).toBeVisible();
});
```

Cover NFKC search request, empty/no-result state, selection, TOTP/HOTP/Steam conditional controls, all algorithm/digit/period/counter fields, tags/note, concealed secret with explicit reveal, validation, cancel, delete cancel/confirm/conflict, lock redaction, focus restoration, keyboard navigation, 360px/desktop structure, and reduced motion.

- [ ] **Step 2: Run RED tests**

Run: `pnpm exec vitest run apps/extension/test/vault/OtpVaultView.dom.test.tsx apps/extension/test/vault/VaultApp.dom.test.tsx apps/extension/test/vault/VaultApp.styles.test.ts`

Expected: FAIL because the vault OTP view/editor do not exist and current search/create controls are disabled.

- [ ] **Step 3: Implement minimal vault workflow**

  Debounce search by 150ms and send the raw trimmed query; background remains authoritative for NFKC/en-US normalization. Use controlled editor fields. Canonicalize the Base32 secret to uppercase and remove permitted ASCII separators only at explicit paste/input normalization, then let strict schema/service reject invalid material. Default create values are TOTP/SHA1/6 digits/30 seconds, favorite false, empty issuer/tags/note. HOTP sets period `0` and requires a safe nonnegative counter; Steam forces SHA1/5/30 and no counter. Conceal the secret by default and never put it in DOM attributes beyond the input value.

  Keep `MigrationPanel platform={platform} active={vaultUnlocked}` mounted in `VaultApp`; place it in a settings/migration region rather than replacing it with OTP details. On lock, unmount OTP editor/list immediately and clear component state.

- [ ] **Step 4: Run GREEN and vault regressions**

Run: `pnpm exec vitest run apps/extension/test/vault apps/extension/test/background/otp-service.test.ts`

Expected: PASS; complete vault-only CRUD/search works, conflicts do not overwrite, migration remains visible/functional, and existing vault access/settings/migration tests pass.

- [ ] **Step 5: Record evidence and pass the independent review gate**

  Append Task 7 evidence only to the Task 8 ledger. A fresh reviewer must inspect secret DOM exposure, controlled-state cleanup on lock, conflict semantics, delete confirmation, type-dependent validation, search boundary, accessibility/focus, responsive styles, and `MigrationPanel` retention. Correct all Critical/Important findings and rerun GREEN before Task 8.

## Task 8: Add packaged browser OTP CRUD and popup evidence

**Files:**

- Create: `tests/browser/project1-otp-crud.spec.ts`
- Create: `tests/browser/__screenshots__/popup-otp-linux.png`
- Create: `tests/browser/__screenshots__/vault-otp-desktop-linux.png`
- Create: `tests/browser/__screenshots__/vault-otp-compact-linux.png`

**Interfaces:**

- Consumes: fresh `dist/`, existing persistent-extension fixtures, real setup/unlock flow, popup/vault pages, runtime issue gate, fixed UTC locale/timezone, and browser clipboard APIs invoked by user gesture.
- Produces: packaged black-box evidence for Task 8 only; no harness-only UI or source-level service invocation may substitute for extension interactions.
- [ ] **Step 1: Write the failing packaged E2E spec**

```ts
test("creates, searches, edits, copies, and deletes an OTP in the packaged extension", async ({
  context,
  extensionId,
}) => {
  const vault = await context.newPage();
  await vault.goto(`chrome-extension://${extensionId}/vault/index.html`);
  await setupAndUnlock(vault);
  await createTotp(vault, { issuer: "Acme", label: "alice", secret: syntheticBase32 });
  await expect(vault.getByText("Acme")).toBeVisible();
  await vault.getByRole("searchbox", { name: "Search vault" }).fill("ＡＣＭＥ");
  await expect(vault.getByText("alice")).toBeVisible();
  await editLabel(vault, "alice updated");

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await expect(popup.getByText("alice updated")).toBeVisible();
  await popup.getByRole("button", { name: "Copy code for Acme" }).click();
  await expect(popup.getByRole("status")).toHaveText("Code copied");

  await deleteOtp(vault, "Acme");
  await expect(vault.getByText("Acme")).toHaveCount(0);
});
```

Use deterministic synthetic fixture material without putting the secret/code in the test title, screenshot filename, log, or accessibility assertion. Add locked-state metadata redaction, countdown rollover, conflict-safe second-page edit, Steam rendering, HOTP no-advance on popup access, migration panel presence, viewport 360px and desktop screenshots, keyboard path, reduced motion, serious/critical axe checks, and zero runtime console/page errors.

- [ ] **Step 2: Run RED packaged browser test**

Run: `pnpm build:security && pnpm exec playwright test tests/browser/project1-otp-crud.spec.ts`

Expected: FAIL before production UI completion/baselines because packaged OTP selectors/workflows and approved Task 8 screenshots are absent. If implementation from Tasks 1–7 makes functional assertions pass, screenshot absence/difference is the required RED signal; do not weaken assertions to manufacture failure.

- [ ] **Step 3: Make only E2E/harness corrections and capture baselines**

  Fix packaged-only integration defects in the owning production file, not in a test-only replacement. Generate screenshots with `pnpm exec playwright test tests/browser/project1-otp-crud.spec.ts --update-snapshots`, inspect each image for clipped text, secret/code leakage outside intended visual code display, focus, contrast, compact layout, migration retention, and theme continuity, then rerun without `--update-snapshots`.

- [ ] **Step 4: Run GREEN packaged browser tests**

Run: `pnpm build:security && pnpm exec playwright test tests/browser/project1-otp-crud.spec.ts tests/browser/project1-setup-unlock.spec.ts tests/browser/project1-migration.spec.ts`

Expected: PASS against fresh `dist/` with no unexpected runtime issues; setup/unlock and migration remain passing.

- [ ] **Step 5: Record evidence and pass the independent review gate**

  Append Task 8 evidence and manually reviewed screenshot names only to the Task 8 ledger. A fresh reviewer must inspect the E2E for true packaged interactions, absence of secret-bearing artifacts, clipboard gesture, HOTP non-advance, lock redaction, migration coexistence, accessibility, and screenshot quality. Correct all Critical/Important findings and rerun GREEN before Task 9.

## Task 9: Add the focused Task 8 verification command and run cross-layer regressions

**Files:**

- Modify: `package.json`
- Modify: `.sdd/project1-task8-execution-ledger.md`

**Interfaces:**

- Consumes: all Task 8 source/tests and existing `verify`, `build:security`, `test:browser:built`, dependency, audit, and legacy checks.
- Produces exact scripts:

```json
{
  "scripts": {
    "test:project1:task8": "vitest run packages/domain packages/otp packages/otp-storage packages/storage packages/messaging packages/security apps/extension/test/background apps/extension/test/platform apps/extension/test/popup apps/extension/test/vault",
    "verify:project1:task8": "pnpm typecheck && pnpm lint && pnpm format:check && pnpm test:project1:task8 && pnpm dependencies && pnpm build:security && pnpm exec playwright test tests/browser/project1-otp-crud.spec.ts tests/browser/project1-setup-unlock.spec.ts tests/browser/project1-migration.spec.ts"
  }
}
```

- [ ] **Step 1: Add a failing script-contract test assertion to the existing workspace test**

  In `tests/tooling/workspace.test.ts`, assert both scripts equal the exact strings above and that `verify:project1:task8` contains no Git, source mutation, snapshot update, or alternate ledger command.

- [ ] **Step 2: Run RED command**

Run: `pnpm exec vitest run tests/tooling/workspace.test.ts`

Expected: FAIL because `test:project1:task8` and `verify:project1:task8` are not yet defined.

- [ ] **Step 3: Add the exact package scripts**

  Add only the two script keys above. Do not replace or weaken `verify`, `verify:project0`, browser, security, dependency, or audit scripts.

- [ ] **Step 4: Run GREEN focused verification**

Run: `pnpm exec vitest run tests/tooling/workspace.test.ts && pnpm verify:project1:task8`

Expected: PASS with typecheck, lint, Prettier, focused source tests, dependency boundaries, security build/output scan, and packaged Task 8/setup/migration E2E all green.

- [ ] **Step 5: Run standing security and legacy regressions**

Run: `pnpm exec vitest run tests/security tests/legacy && pnpm audit --prod`

Expected: PASS; permissions/CSP/build-output/legacy artifacts remain valid and production dependency audit reports no unresolved vulnerability accepted by Task 8.

- [ ] **Step 6: Record evidence and pass the independent review gate**

  Append exact commands, environment versions, exit codes, test counts, and audit summary only to the Task 8 ledger. A fresh reviewer must verify the scripts are exact, no gate was weakened, all Task 8 directories are covered, and browser tests run on built output. Correct all Critical/Important findings and rerun both GREEN commands before Task 10.

## Task 10: Final verification, evidence audit, and Task 8 acceptance gate

**Files:**

- Modify: `.sdd/project1-task8-execution-ledger.md`

**Interfaces:**

- Consumes: Tasks 1–9, broader authoritative Task 8 criteria, foundation security constraints, all independent review outcomes, and fresh command output.
- Produces: a closed Task 8 ledger with no unverified success claim and an explicit pass/fail entry for every final gate below. No source or test behavior is introduced in this task.
- [ ] **Step 1: Audit plan coverage before commands**

  In the ledger, add a matrix linking evidence to: session-owned bridge; internal/external root synchronization; no DEK/context exposure; strict schemas/policies; fixed safe errors; NFKC/en-US issuer/label/tag search; CRUD/revision conflict; TOTP/Steam code/countdown; HOTP reserve/commit/cancel/exactly-once; router/platform composition; popup copy/navigation-only; vault editor/delete; MigrationPanel retention; unchanged permissions/CSP; packaged E2E; accessibility; and secret-free artifacts. Mark a row failed rather than using ambiguous language when evidence is absent.

- [ ] **Step 2: Run the clean focused gate**

Run: `pnpm install --frozen-lockfile && pnpm verify:project1:task8`

Expected: PASS from the pinned lockfile and required Node/pnpm range.

- [ ] **Step 3: Run full current regression and production audit gates**

Run: `pnpm verify && pnpm test:browser:built && node scripts/verify-reproducible-build.mjs && pnpm audit --prod`

Expected: PASS. This is the current repository-wide gate; do not label all of Project 1 complete because Tasks 9–13 of the broader plan remain.

- [ ] **Step 4: Run secret and authority inspection commands**

Run: `rg -n "console\\.log|clipboard(Read|Write)|clipboard_(read|write)|otp.*secret|secret.*otp" apps/extension/src packages/messaging/src dist manifest.json`

Expected: no `console.log`; no clipboard permission; any `secret` matches are confined to vault-only editor schema/service/domain/storage logic and never list/code/delete projections or built accessibility text. Record each reviewed match rather than claiming a zero-match result when legitimate vault-editor references exist.

Run: `rg -n "TODO|TBD|implement later|fill in details|Similar to Task" apps/extension/src/background/otp apps/extension/src/popup/otp apps/extension/src/vault/otp packages/messaging/src/otp.ts`

Expected: no matches.

- [ ] **Step 5: Perform final independent review**

  A fresh reviewer reads the authoritative Task 8 section, this supplement, changed files, Task 8 ledger, and final command output. The reviewer must explicitly report Critical, Important, and Minor findings; verify no Task 9–13 scope was pulled in; verify the broader plan remains authoritative; and verify all Task 8 evidence is confined to `.sdd/project1-task8-execution-ledger.md`. Correct every Critical/Important finding, rerun the smallest affected RED/GREEN regression plus Steps 2–4, and record corrections/results.

- [ ] **Step 6: Close the ledger with bounded status**

  Record Task 8 as complete only if every final gate passes and every Critical/Important review finding is closed. State explicitly that Task 8 provides vault-only OTP CRUD/editor, popup list/code/copy/navigation, and future-fill HOTP lifecycle infrastructure; it does not complete imports, backup, page autofill, Ente sync, or the Project 1 release gate.

## Final acceptance gates

- [ ] The session bridge surface contains no key/context/root/repository escape and authenticates the exact active root around every operation.
- [ ] Internal repository activations synchronize `expectedRoot`; their storage notifications do not self-lock; external, deleted, malformed, raced, or unauthenticated roots lock fail-closed.
- [ ] Every OTP request/response is strict version `1`, document-bound, authorized by exact context, and response-reparsed before runtime return.
- [ ] Locked list/code/editor/CRUD paths disclose no item metadata, secret, or code.
- [ ] Search uses exact NFKC plus `toLocaleLowerCase("en-US")` semantics over issuer/label/tags only.
- [ ] Create/update/delete preserve strict OTP schemas and immutable generation/journal/tombstone behavior; revision conflicts never overwrite.
- [ ] TOTP and Steam known-answer behavior and countdown rollover remain passing; Steam constraints are unchanged.
- [ ] HOTP increments exactly once only after confirmed commit; display/copy/reserve/cancel/failure/expiry/wrong binding/lock do not increment.
- [ ] Popup has list/code/countdown/copy and opens the vault for editing; it has no CRUD/editor/secret surface.
- [ ] Full vault has complete search/create/edit/delete/conflict UX and retains `MigrationPanel`.
- [ ] Clipboard use is explicit-gesture `navigator.clipboard.writeText`; manifest has no clipboard permission and Task 8 makes no auto-clear ownership claim.
- [ ] Errors, logs, snapshots, accessible labels, test names, and ledger contain no secret/code/raw-error reflection.
- [ ] Existing manifest permissions, CSP, migration source preservation, legacy compatibility, session locking, and security build gates remain passing.
- [ ] Packaged browser E2E passes against fresh `dist/` at desktop and compact popup/vault sizes with reviewed visual baselines and no unexpected runtime issues.
- [ ] All ten task review gates and final commands are evidenced only in `.sdd/project1-task8-execution-ledger.md`.
- [ ] No Git/worktree/commit operation and no Task 9–13 implementation occurred.
