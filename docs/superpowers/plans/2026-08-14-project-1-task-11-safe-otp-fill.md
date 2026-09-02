# Project 1 Task 11 Safe OTP Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe all-frame OTP field discovery, an isolated metadata-only account picker, and one explicitly selected five-second TOTP/HOTP/Steam release that fills one exact field without submitting or advancing focus.

**Architecture:** Pure content-layer primitives discover and revalidate eligible fields, assign random opaque handles, and write through the owner-realm native input setter inside the existing closed Shadow DOM boundary. A dedicated background `OtpFillService` owns suggestion capabilities and field-bound code releases; existing OTP generation and durable HOTP reservation/receipt behavior remain internal dependencies rather than direct content authority. Strict browser-owned tab/frame/document/URL authorization, lock/restart cleanup, and packaged all-frame evidence enforce the boundary.

**Tech Stack:** TypeScript 5.9.3 strict mode, React 19.2.8, Zod Mini 4.4.3, Chrome MV3 minimum 110, existing `@shardpass/otp` and encrypted storage lifecycle, Vitest 4.1.10, Testing Library 16.3.2, Playwright 1.62.0, pnpm exactly 10.14.0.

## Global Constraints

- The approved design at `docs/superpowers/specs/2026-08-14-project-1-task-11-safe-otp-fill-design.md` is authoritative; the roadmap entry at `docs/superpowers/plans/2026-07-29-project-1-vault-otp.md:585-630` defines formal Task 11 scope.
- This is a non-Git workspace. Do not initialize Git or run branch, worktree, commit, merge, tag, or push commands.
- Implement exactly the three phases below with one consolidated review after each. Do not enter a later phase while a load-bearing finding remains open.
- Create `.sdd/project1-task11-execution-ledger.md` only after the first genuine RED result. Keep it append-only and free of codes, seeds, page values, URLs, labels, and other sensitive data.
- Node is `>=22.14.0 <23`, pnpm is exactly `10.14.0`, and minimum Chrome is 110. Node 24 and later Chromium runs are development-only evidence.
- Preserve all 17 pinned legacy artifacts as regular non-symlink files with exact hashes. Never edit, regenerate, rename, move, delete, format, import, or package the preserved legacy root artifact.
- Never expose OTP seeds, full decrypted records, HOTP counters, notes, algorithms, roots, keys, repository objects, crypto context, session epochs, or generic callback executors to content scripts.
- Suggestions are bounded, metadata-only, favorite-first, and not ranked or filtered by page origin. Codes appear only after explicit account selection.
- A selected release lasts at most 5,000 ms, is single-attempt, and is bound to exact extension, tab, frame, document, normalized sender origin, opaque field handle, item ID/revision, and current session authority.
- Existing low-level HOTP reserve/commit/cancel commands must not remain directly content-authorized. The dedicated broker exclusively owns durable reservation IDs.
- HOTP increments only after a confirmed successful native setter plus `input` and `change` events. Duplicate confirmation is idempotent; uncertain outcomes reconcile through durable receipts and are never retried optimistically.
- Never automatically open the picker, infer an account from a site, submit a form, press Enter, click a page control, advance focus, or retry against a replacement element.
- No code, seed, page field value, release ID, raw URL, selector, label, or page-derived string may enter logs, errors, test names, screenshots, snapshots, accessibility labels/descriptions, storage, clipboard, or analytics.
- JavaScript reference clearing and byte overwriting are best effort; do not claim guaranteed zeroization.
- No new `tabs`, `activeTab`, context menu, clipboard, downloads, camera, offscreen, optional-host, externally-connectable, or network permission. Keep extension CSP unchanged.
- Tests use only synthetic local fixture pages and extension-owned synthetic vault data. No real profile, account, clipboard, camera, external network, or production seed.

## Fixed contracts and limits

```ts
export const OTP_FILL_LIMITS = Object.freeze({
  suggestionTtlMs: 300_000,
  releaseTtlMs: 5_000,
  terminalRetentionMs: 60_000,
  maxSuggestions: 10_000,
  maxCapabilitiesPerDocument: 4,
  maxCapabilitiesGlobal: 256,
  maxReleasesGlobal: 256,
  maxDiscoveryNodesPerPass: 256,
  maxDiscoveredFieldsPerFrame: 32,
  maxDiscoveryPassesPerSecond: 10,
});

export type OtpFillSuggestion = Readonly<{
  itemId: string;
  expectedRevision: number;
  issuer: string;
  label: string;
  otpType: "totp" | "hotp" | "steam";
  favorite: boolean;
  tags: readonly string[];
}>;
```

The strict version-1 message family is created in `packages/messaging/src/otp-fill.ts` with exact request-response pairing:

- `otp.fillSuggestions` → metadata list plus opaque suggestion capability.
- `otp.fillSelect` → one code-bearing five-second release.
- `otp.fillConfirm` → fixed terminal result, idempotent during retention.
- `otp.fillCancel` → fixed non-disclosing cancellation result.

Field handles, request IDs, capabilities, and release IDs are random opaque values. Sender identity is always normalized from browser-owned metadata, never request fields.

---

### Phase 1: Field discovery, native fill primitives, and isolated picker shell

**Files:**

- Create: `apps/extension/src/content/otp/field-eligibility.ts`
- Create: `apps/extension/src/content/otp/field-discovery.ts`
- Create: `apps/extension/src/content/otp/field-handles.ts`
- Create: `apps/extension/src/content/otp/fill-otp-field.ts`
- Create: `apps/extension/src/content/otp/OtpPicker.tsx`
- Create: `apps/extension/src/content/otp/otp-picker.css`
- Create: `apps/extension/test/content/otp/field-eligibility.dom.test.ts`
- Create: `apps/extension/test/content/otp/field-discovery.dom.test.ts`
- Create: `apps/extension/test/content/otp/field-handles.dom.test.ts`
- Create: `apps/extension/test/content/otp/fill-otp-field.dom.test.ts`
- Create: `apps/extension/test/content/otp/OtpPicker.dom.test.tsx`
- Modify: `apps/extension/src/content/createPickerHost.tsx`
- Modify: `apps/extension/src/content/picker.css`
- Modify: `apps/extension/test/content/createPickerHost.dom.test.tsx`
- Create after RED: `.sdd/project1-task11-execution-ledger.md`

**Interfaces:**

```ts
export interface OtpFieldEligibility {
  isEligible(input: HTMLInputElement): boolean;
}
export function createOtpFieldEligibility(ownerWindow: Window): OtpFieldEligibility;

export interface OtpFieldDiscovery {
  start(): void;
  revalidateFocusedField(): HTMLInputElement | null;
  snapshot(): readonly HTMLInputElement[];
  dispose(): void;
}

export interface OtpFieldHandleRegistry {
  handleFor(input: HTMLInputElement): string;
  activate(input: HTMLInputElement): string;
  resolveActive(handle: string): HTMLInputElement | null;
  clearActive(): void;
}

export type OtpFillPrimitiveResult = Readonly<{
  status:
    | "filled"
    | "expired"
    | "field-changed"
    | "field-ineligible"
    | "setter-failed"
    | "event-failed"
    | "verification-failed";
}>;
```

- [ ] **Step 1: Write one comprehensive content RED suite**

Cover explicit `autocomplete="one-time-code"`; bounded OTP/2FA/MFA/verification label context; numeric 4–8 shape requiring a separate positive signal; PIN/ZIP/CVV/phone/account/coupon/search/date/quantity negatives; hidden, transparent, inert, disabled, read-only, zero-size, and offscreen fields; dynamic insertion/removal/attribute changes; mutation coalescing/churn limits; same-markup replacement identity; no page Shadow DOM piercing; owner-realm native setter; React-controlled input; composed bubbling `input` then `change`; event/setter failure; replacement during events; no submit/Enter/click/focus advancement; opaque handles; picker keyboard behavior and no code-bearing rendering.

- [ ] **Step 2: Run genuine RED and create the ledger**

```bash
pnpm exec vitest run apps/extension/test/content/otp apps/extension/test/content/createPickerHost.dom.test.tsx
```

Expected: FAIL because the OTP content modules do not exist. Create `.sdd/project1-task11-execution-ledger.md` immediately afterward and append exact environment/command/failure evidence without sensitive values.

- [ ] **Step 3: Implement strict eligibility and bounded discovery**

Use owner-window DOM constructors and computed styles. Treat explicit one-time-code autocomplete as the strongest semantic signal while still enforcing visibility/editability. Use bounded associated labels and nearby context only; never persist page text. Coalesce observer work, cap nodes/fields/passes, pause after churn until one second of quiescence, and keep direct focused-field revalidation available.

- [ ] **Step 4: Implement opaque handle ownership and exact-object filling**

Use random UUID handles in a `WeakMap` and a bounded active reverse lookup. Immediately before fill, revalidate expiry, exact object identity, connection, visibility, editability, current URL/origin snapshot, and exclusion from the picker host. Mark local release consumed before invoking the owner-realm native value setter. Dispatch composed bubbling `input` and `change`, verify the same element/value, and return only fixed result enums. Never submit or retry a replacement.

- [ ] **Step 5: Refactor the closed host and implement picker shell**

Preserve one host per frame/document, closed Shadow DOM, idempotent disposal, and isolation from page CSS/events. Add field-relative positioning with viewport flipping and bounded resize/scroll updates. Render only safe metadata rows, local search, busy/empty/fixed-error states, visible focus, Escape close, and reduced-motion behavior. The production content entry remains inert until Phase 3.

- [ ] **Step 6: Run Phase 1 GREEN**

```bash
pnpm exec vitest run apps/extension/test/content/otp apps/extension/test/content/createPickerHost.dom.test.tsx
pnpm typecheck
pnpm exec eslint apps/extension/src/content/otp apps/extension/test/content/otp apps/extension/src/content/createPickerHost.tsx --max-warnings 0
pnpm exec vitest run tests/legacy/fixtures.test.ts
```

- [ ] **Step 7: Perform one consolidated Phase 1 review**

Review heuristic false positives, bounded observer behavior, owner-realm setter safety, exact element identity, event order, no-submit contract, handle randomness, DOM/a11y secrecy, host isolation, cleanup, Chrome 110 syntax, and tests for every branch. Resolve high-confidence findings and rerun Step 6 once.

---

### Phase 2: Strict fill protocol, dedicated broker, and internal HOTP lifecycle

**Files:**

- Create: `packages/messaging/src/otp-fill.ts`
- Create: `packages/messaging/test/otp-fill.test.ts`
- Create: `apps/extension/src/background/otp/otp-fill-service.ts`
- Create: `apps/extension/test/background/otp-fill-service.test.ts`
- Create or extract: `apps/extension/src/background/otp/hotp-lifecycle.ts`
- Create or update: `apps/extension/test/background/otp-fill-hotp-lifecycle.test.ts`
- Modify: `packages/messaging/src/index.ts`
- Modify: `packages/messaging/src/otp.ts`
- Modify: `packages/messaging/test/otp.test.ts`
- Modify: `packages/security/src/errors.ts`
- Modify: `packages/security/test/errors.test.ts`
- Modify: `apps/extension/src/background/otp/otp-service.ts`
- Modify: `apps/extension/src/background/router.ts`
- Modify: `apps/extension/test/background/router.test.ts`
- Modify: `apps/extension/src/background/main.ts`
- Modify: `apps/extension/test/background/background-runtime.integration.test.ts`
- Modify: `apps/extension/src/background/vault/session-service.ts`
- Modify: `apps/extension/src/platform/extension-platform.ts`
- Modify: `apps/extension/src/platform/chrome-platform.ts`
- Modify: `apps/extension/test/platform/chrome-platform.test.ts`
- Modify: `apps/extension/test/background/otp-hotp-lifecycle.test.ts`
- Modify: `.sdd/project1-task11-execution-ledger.md`

**Interfaces:**

```ts
export interface OtpFillService {
  handle(request: OtpFillRequest, sender: SenderContext): Promise<OtpFillResponse>;
  dispose(): void;
}

export interface InternalHotpLifecycle {
  reserve(
    itemId: string,
    expectedRevision: number,
    binding: ReservationBinding,
  ): Promise<InternalHotpRelease>;
  confirm(reservationId: string, binding: ReservationBinding): Promise<HotpReservationCommitResult>;
  cancel(reservationId: string, binding: ReservationBinding): Promise<boolean>;
}
```

`InternalHotpRelease` and reservation IDs never enter runtime messages. The broker adds extension/origin/field/item/session binding around the durable tab/frame/document reservation.

- [ ] **Step 1: Write consolidated messaging, broker, HOTP, router, runtime, and platform RED tests**

Cover strict version/unknown fields/bounds/response pairing; content-only exact browser sender policy; origin derivation; metadata minimization; no code before selection; suggestion TTL/caps/replacement; five-second release and single attempt; session/root/item revision races; wrong tab/frame/document/origin/field; TOTP/Steam; internal HOTP reserve-confirm-cancel; duplicate confirmation; timeout; failed setter; navigation; lock; restart; ambiguous commit receipt; no double counter; no direct content authority for low-level HOTP commands; identity-safe finalizers; fixed error mapping; one runtime instance; disposal; typed content transport and response revalidation.

- [ ] **Step 2: Run Phase 2 RED**

```bash
pnpm exec vitest run packages/messaging/test/otp-fill.test.ts packages/messaging/test/otp.test.ts apps/extension/test/background/otp-fill-service.test.ts apps/extension/test/background/otp-fill-hotp-lifecycle.test.ts apps/extension/test/background/router.test.ts apps/extension/test/background/background-runtime.integration.test.ts apps/extension/test/platform/chrome-platform.test.ts
```

Expected: FAIL for missing protocol/service/internal lifecycle/routes.

- [ ] **Step 3: Implement strict protocol and narrow authorization**

Create exact paired schemas and `parseOtpFillResponseForRequest`. Suggestions contain only approved metadata. Releases contain only release ID, code, expiry, and fixed shape metadata. Parse before authorization, derive origin from browser-owned sender URL, require extension/tab/frame/document, field-project responses, and reparse before return. Add fixed errors `OTP_FILL_INVALID`, `OTP_FILL_UNAVAILABLE`, `OTP_FILL_EXPIRED`, `OTP_FILL_FIELD_CHANGED`, `OTP_FILL_ITEM_CHANGED`, `OTP_FILL_CANCELLED`, and `OTP_FILL_UNCERTAIN`.

- [ ] **Step 4: Internalize HOTP lifecycle**

Move low-level reserve/commit/cancel orchestration behind `InternalHotpLifecycle`. Remove content from the low-level HOTP sender policies while preserving popup/vault behavior where applicable. Keep encrypted pending state, durable receipts, uncertainty windows, capacity, lock cleanup, and idempotent commit. Broker-owned cancellation is best effort and never claims an uncertain counter did not commit.

- [ ] **Step 5: Implement suggestion and release ownership**

Use random capabilities with synchronous slot reservation, five-minute suggestion TTL, five-second release TTL, four per document, bounded global counts, one active field capability, one-attempt release consumption, 60-second terminal result retention, exact sender/origin/field/item/session binding, authoritative rereads, deep metadata projection, and identity-safe finalizers. Lock/restart/dispose clears in-memory authority synchronously and initiates known HOTP cancellation.

- [ ] **Step 6: Wire router, runtime, session cleanup, and platform**

Construct one broker and one internal HOTP lifecycle. Parse/authorize/revalidate exact responses. Publish authoritative state only for relevant lock or committed HOTP outcomes. Add a typed content transport without widening popup/vault interfaces. Dispose idempotently and retain current OTP CRUD/import/backup behavior.

- [ ] **Step 7: Run Phase 2 GREEN and regressions**

```bash
pnpm exec vitest run packages/messaging/test/otp-fill.test.ts packages/messaging/test/otp.test.ts apps/extension/test/background/otp-fill-service.test.ts apps/extension/test/background/otp-fill-hotp-lifecycle.test.ts apps/extension/test/background/router.test.ts apps/extension/test/background/background-runtime.integration.test.ts apps/extension/test/platform/chrome-platform.test.ts
pnpm exec vitest run packages/messaging packages/otp packages/storage apps/extension/test/background apps/extension/test/platform --maxWorkers=1 --no-file-parallelism
pnpm typecheck
pnpm exec vitest run tests/legacy/fixtures.test.ts
```

- [ ] **Step 8: Perform one consolidated Phase 2 review**

Review all sender and capability bindings, origin handling, metadata/code projections, TTL and one-attempt semantics, lock/restart cleanup, direct HOTP authority removal, durable idempotency/uncertainty, item revision/root races, error reflection, stale finalizers, runtime publication/disposal, no permission widening, and direct fault evidence. Resolve findings and rerun Step 7 once.

---

### Phase 3: Active all-frame picker, packaged browser/security evidence, documentation, and release gate

**Files:**

- Create: `apps/extension/src/content/otp/otp-fill-controller.ts`
- Create: `apps/extension/test/content/otp/otp-fill-controller.dom.test.tsx`
- Modify: `apps/extension/src/content/main.tsx`
- Modify: `apps/extension/src/content/createPickerHost.tsx`
- Modify: `apps/extension/src/manifest.ts`
- Create: `tests/fixtures/sites/otp.html`
- Create: `tests/fixtures/sites/otp-frame.html`
- Create: `tests/fixtures/sites/otp-react.html`
- Create: `tests/browser/project1-otp-autofill.spec.ts`
- Create reviewed safe baselines only if needed: `tests/browser/__screenshots__/otp-fill-*.png`
- Modify: `tests/browser/fixtures.ts` or fixture server support for a second synthetic origin
- Modify: `tests/security/manifest.test.ts`
- Modify: `tests/security/csp.test.ts`
- Modify: `tests/security/build-output.test.ts`
- Modify: `scripts/scan-build.mjs`
- Modify: `tools/security/executable-policy.ts` only if a narrowly audited built-content pattern requires it
- Modify: `docs/security/threat-model.md`
- Modify: `docs/security/invariants.md`
- Modify: `docs/security/release-checklist.md`
- Modify: `docs/architecture/runtime-boundaries.md`
- Modify: `docs/architecture/permissions.md`
- Modify: `package.json`
- Modify: `scripts/check-engine.mjs`
- Create: `.prettierignore.project1-task11` only for append-only ledgers if required
- Modify: `.sdd/project1-task11-execution-ledger.md`

**Interfaces:**

```ts
export interface OtpFillController {
  start(): void;
  dispose(): void;
}

export function createOtpFillController(
  options: Readonly<{
    document: Document;
    window: Window;
    platform: OtpFillContentPlatform;
  }>,
): OtpFillController;
```

- [ ] **Step 1: Write controller, manifest, browser, and security RED tests**

Cover one controller/closed host per frame; focused trigger only; positioning/flipping; all-active favorite-first suggestions and search; selection/fill/confirm/cancel; synchronous release clearing; top-frame and same/cross-origin iframe discovery; explicit/heuristic/false-positive fields; TOTP, Steam, exactly-once HOTP; React-controlled input; replacement before/during fill; lock, expiry, navigation, document/frame replacement, worker restart, ambiguity; no submit/focus advance; metadata-only DOM; axe; desktop and effective-200% compact layout; `all_frames: true`; unchanged API permissions/CSP; no remote/clipboard/camera/log/code/seed build output.

- [ ] **Step 2: Run Phase 3 RED**

```bash
pnpm exec vitest run apps/extension/test/content/otp/otp-fill-controller.dom.test.tsx tests/security/manifest.test.ts tests/security/csp.test.ts tests/security/build-output.test.ts
pnpm exec playwright test tests/browser/project1-otp-autofill.spec.ts
```

Expected: FAIL because controller, fixtures, manifest activation, and browser spec do not exist.

- [ ] **Step 3: Activate the bounded controller in every matched frame**

Set `all_frames: true` without adding permissions. Start one controller from `content/main.tsx`; preserve singleton/disposal behavior. On focused eligible fields, show the inline trigger. Open the picker only on explicit click, request suggestions, select/release/fill/confirm, close and keep field focus on success. Every async continuation checks controller owner token, document URL/origin snapshot, live field identity, and disposal/lock state. Clear code-bearing state synchronously before sending terminal confirmation.

- [ ] **Step 4: Add synthetic packaged browser evidence**

Serve two local synthetic origins for cross-origin iframe coverage. Use only generated test vault data. Assert exact root/counter changes through safe background harness projections, no page submission, no focus advancement, restart/lock redaction, and no sensitive screenshots. Inspect every baseline visually before accepting it.

- [ ] **Step 5: Harden build/security policy and documentation**

Replace inert-content assumptions with narrow implemented behavior assertions. Keep exact permissions and CSP. Scan source and built output for network/camera/clipboard/logging and reviewed synthetic code/seed markers. Document all-frame execution, untrusted page boundary, field/release authority, page observability of intentionally filled values, HOTP uncertainty, no auto-submit, best-effort cleanup, non-CAS semantics, and explicit Node 22/Chrome 110 blockers.

- [ ] **Step 6: Add Task 11 verification scripts**

Add `format:check:project1:task11`, `test:project1:task11`, `verify:project1:task11:evidence`, `verify:project1:task11`, and `verify:project1:task11:local-node24`. Extend `check-engine.mjs` only with the exact local Task 11 allowlist entry. Preserve serial full-suite, startup diagnostics, browser, security/legacy, reproducibility, and production audit evidence.

- [ ] **Step 7: Run focused and full development verification**

```bash
pnpm test:project1:task11
pnpm build:security
pnpm exec playwright test tests/browser/project1-otp-autofill.spec.ts
pnpm verify:project1:task11:local-node24
```

The last command is development-only on Node 24. Official completion also requires `pnpm verify:project1:task11` under Node 22 and packaged execution in actual Chrome/Chromium 110.

- [ ] **Step 8: Perform the consolidated Phase 3 and whole-Task-11 review**

Review discovery false positives/churn, all-frame scope, closed-host isolation, sender/origin/field/session binding, code lifetime, HOTP exactly-once behavior, lock/restart/navigation races, no-submit contract, DOM/a11y/screenshot secrecy, permissions/CSP/build scanner, legacy preservation, reproducibility, audit, docs honesty, and environment claims. Resolve every high-confidence Critical/Important finding, rerun Step 7 and exact legacy verification, and append final status plus remaining external blockers to the ledger.

## Plan self-review

- **Spec coverage:** Every approved design section maps to one of the three phases: page-local primitives, broker/protocol/HOTP authority, or active packaged evidence/release gate.
- **Placeholder scan:** No deferred implementation placeholders or generic “handle errors” steps remain. Conditional screenshot/policy files are created only when actual packaged output requires evidence.
- **Type consistency:** `OtpFieldEligibility`, `OtpFieldDiscovery`, `OtpFieldHandleRegistry`, `OtpFillPrimitiveResult`, `OtpFillService`, `InternalHotpLifecycle`, and `OtpFillController` names are stable across phases.
- **Scope:** Task 12 Ente synchronization and Task 13 Project 1 release gate remain excluded. Task 11 adds only OTP discovery, explicit picker selection, and one exact-field fill.
- **Authority:** Content cannot call low-level HOTP commands, receive seeds/full items/counters, supply sender identity, or submit page forms.
