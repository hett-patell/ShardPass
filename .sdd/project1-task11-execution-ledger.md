# Project 1 Task 11 Execution Ledger

Append-only Phase 1 implementation evidence. This ledger intentionally excludes codes, seeds, page values, URLs, labels, and other sensitive data.

## 2026-08-12 — Phase 1 RED

- Environment: Linux x86_64; Node v24.18.0 (development-only, outside the official Node 22 release engine); pnpm 10.14.0.
- Exact command: `pnpm exec vitest run apps/extension/test/content/otp apps/extension/test/content/createPickerHost.dom.test.tsx`
- Result: genuine RED, exit 1.
- Evidence: five new OTP suites failed import resolution because all five production OTP modules were absent; the refactored host contract also had two expected assertion failures because caller content and field-relative positioning were not implemented. Existing host tests otherwise passed.
- TDD boundary: no Phase 1 production implementation existed when this command ran.

## 2026-08-12 — Phase 1 GREEN and review

- Exact focused command: `pnpm exec vitest run apps/extension/test/content/otp apps/extension/test/content/createPickerHost.dom.test.tsx`
- Result: GREEN, 6 files and 61 tests passed.
- Typecheck: `pnpm typecheck` passed; Node v24.18.0 emitted the expected development-only engine warning.
- Changed lint: `pnpm exec eslint apps/extension/src/content/otp apps/extension/test/content/otp apps/extension/src/content/createPickerHost.tsx --max-warnings 0` passed.
- Changed format: the targeted Prettier check passed.
- Legacy verification: `pnpm exec vitest run tests/legacy/fixtures.test.ts` passed, 1 file and 9 tests.
- Consolidated review: checked false positives, bounded scans and churn pause, owner-realm setter, exact identity, event order, single-attempt consumption, no-submit behavior, opaque random handles, metadata-only DOM/accessibility, closed-host singleton/disposal, content-entry inertness, and Chrome 110-compatible syntax.
- Review correction: added and observed a focused RED for missing local single-attempt consumption, implemented consumption before the setter, then reran the complete verification chain successfully.
- Non-empty check: every created and modified Phase 1 artifact is non-empty.
- Remaining environment issue: official Node 22 and actual Chrome 110 evidence were not run in this Phase 1 environment; Node 24 results are development-only.

## 2026-08-12 — Phase 1 validated review findings remediation

- Findings fixed: effective eligibility now walks at most 64 light-DOM ancestors, rejects inherited display/visibility/opacity/pointer/inert/hidden/ARIA-hidden state, accounts for overflow clipping, and uses owner-realm `:disabled` semantics for disabled fieldsets.
- Discovery fix: replaced full-document `querySelectorAll` materialization with an owner-document incremental element `TreeWalker`; every visited element consumes the 256-node pass budget, traversal resumes on later bounded passes, and page Shadow DOM remains outside the document traversal.
- Mutation fix: observation now includes `placeholder`, `name`, `id`, label `for`, `aria-hidden`, existing eligibility attributes including class/style/type, and character-data context changes while retaining scan coalescing and churn pause behavior.
- Fill-attempt fix: the public fill options require a local attempt, runtime calls without one fail closed, already-consumed attempts fail before other validation, and consumption occurs before focus, setter, and events so setter/event failures cannot reuse it.
- Focus/revalidation fix: after consumption, the exact target is focused with owner-realm `focus({ preventScroll: true })`; URL, origin, active handle identity, connection, exact focus, and eligibility are revalidated before obtaining or invoking the native setter.
- RED evidence: `pnpm exec vitest run apps/extension/test/content/otp/field-eligibility.dom.test.ts apps/extension/test/content/otp/field-discovery.dom.test.ts apps/extension/test/content/otp/fill-otp-field.dom.test.ts` exited 1 with 15 expected regression failures before production changes.
- Focused Phase 1 evidence: `pnpm exec vitest run apps/extension/test/content/otp apps/extension/test/content/createPickerHost.dom.test.tsx` passed, 6 files and 78 tests.
- Typecheck: `pnpm typecheck` passed with the expected Node v24.18.0 development-only engine warning.
- Changed lint: `pnpm exec eslint apps/extension/src/content/otp apps/extension/test/content/otp --max-warnings 0` passed.
- Changed format: targeted `pnpm exec prettier --check` passed for all six modified source/test files.
- Legacy verification: `pnpm exec vitest run tests/legacy/fixtures.test.ts` passed, 1 file and 9 tests.
- Added regression coverage: ancestor opacity, disabled fieldset, full overflow clipping, visibility change during focus before fill, deferred beyond-budget examination, all mutation signal classes, required/unreusable attempts, exact picker-to-field focus, and focus-handler replacement.
- Environment remains Linux x86_64 with Node v24.18.0 and pnpm 10.14.0; official Node 22 and actual Chrome 110 evidence remain outstanding and Node 24 evidence is development-only.

## 2026-08-12 — Phase 1 fill-attempt provenance finding remediation

- Scope: closed only the remaining fill-attempt provenance and consumption finding; no Git operations were performed.
- Implementation: `OtpFillAttempt` is now an opaque unique-symbol-branded type. `createOtpFillAttempt()` issues a frozen propertyless object and records provenance in a module-private `WeakSet`; a second module-private `WeakSet` records terminal consumption. No public `consumed` property or `consume()` method remains.
- Runtime boundary: `fillOtpField` rejects missing attempts, arbitrary structural objects, attempts not issued by this module, and consumed genuine attempts. A genuine attempt is consumed before focus and therefore remains terminal after focus, setter, or event failure.
- RED evidence: `pnpm exec vitest run apps/extension/test/content/otp/fill-otp-field.dom.test.ts` exited 1 with 2 expected failures: a structural forgery was accepted and a genuine token was not frozen/opaque.
- GREEN and type boundary: `pnpm exec vitest run apps/extension/test/content/otp/fill-otp-field.dom.test.ts && pnpm typecheck` passed with 1 file and 16 tests plus TypeScript build success; the type assertion rejects the former public structural surface.
- Final focused verification: `pnpm exec vitest run apps/extension/test/content/otp apps/extension/test/content/createPickerHost.dom.test.tsx` passed, 6 files and 80 tests.
- Final typecheck: `pnpm typecheck` passed with the expected Node v24.18.0 development-only engine warning.
- Final targeted lint: `pnpm exec eslint apps/extension/src/content/otp/fill-otp-field.ts apps/extension/test/content/otp/fill-otp-field.dom.test.ts --max-warnings 0` passed.
- Final targeted format: `pnpm exec prettier --check apps/extension/src/content/otp/fill-otp-field.ts apps/extension/test/content/otp/fill-otp-field.dom.test.ts` passed.
- Final legacy verification: `pnpm exec vitest run tests/legacy/fixtures.test.ts` passed, 1 file and 9 tests.
- Added regression coverage: arbitrary structural forgery, frozen/propertyless runtime API, compile-time incompatibility with the former mutable surface, consumption observable before focus through nested reuse rejection, and genuine reuse rejection after focus, setter, and event failures.

## 2026-08-12 — Phase 2 RED

- Environment: Linux x86_64; Node v24.18.0 (development-only, outside the official Node 22 release engine); pnpm 10.14.0.
- Exact command: `pnpm exec vitest run packages/messaging/test/otp-fill.test.ts packages/messaging/test/otp.test.ts apps/extension/test/background/otp-fill-service.test.ts apps/extension/test/background/otp-fill-hotp-lifecycle.test.ts apps/extension/test/background/router.test.ts apps/extension/test/background/background-runtime.integration.test.ts apps/extension/test/platform/chrome-platform.test.ts`
- Result: genuine RED, exit 1; 5 failed files and 2 passed files.
- Expected failures: the strict fill protocol, dedicated broker, internal lifecycle, and typed content transport modules were absent; the legacy low-level HOTP sender policies still granted direct content authority.
- Existing router and background runtime suites remained green before Phase 2 production changes.
- TDD boundary: no Phase 2 production implementation existed when this command ran.

## 2026-08-12 — Phase 2 GREEN and consolidated review

- Exact focused command passed after review remediation: 8 files and 98 tests, including strict fill messaging, fixed errors, broker, internal HOTP lifecycle, router, runtime, and Chrome platform transport.
- Serial regression command passed: `pnpm exec vitest run packages/messaging packages/otp packages/storage apps/extension/test/background apps/extension/test/platform --maxWorkers=1 --no-file-parallelism`; 42 files and 547 tests.
- `pnpm typecheck` passed with the expected Node v24.18.0 development-only engine warning.
- Full `pnpm lint` passed with zero warnings.
- Targeted formatting check passed for all Phase 2 source, tests, and this ledger. The repository-wide formatting command remains red only for three pre-existing execution ledgers outside Task 11; those append-only/preserved files were not modified.
- Exact legacy verification passed: 1 file and 9 tests.
- Consolidated review covered strict pairing and projections, browser-owned origin and extension/tab/frame/document/field binding, item revision and session authority races, capability/release limits and identity-safe replacement, five-second one-attempt consumption, terminal idempotency, lock/restart/dispose cleanup, TOTP/Steam generation, durable HOTP cancellation/commit/receipt behavior, direct low-level HOTP content-authority removal, fixed error reflection, runtime publication/disposal, typed content response revalidation, popup/vault regression behavior, and unchanged permissions/CSP scope.
- Review corrections: expired releases remain tombstoned in memory only for the terminal retention window so their first terminal attempt returns the fixed expiry result rather than degrading to an invalid-capability result; code-bearing response data is not retained in broker release state. Capability/document and release slots are reserved synchronously across awaited work to prevent concurrent cap bypass. An internal HOTP reservation is cancelled best-effort if session authority changes before broker release publication.
- Environment remains Linux x86_64 with Node v24.18.0 and pnpm 10.14.0. Official Node 22 and actual Chrome 110 evidence remain external Phase 3/release gates; this Phase 2 evidence is development-only.

## 2026-08-12 — Phase 2 validated ownership-model findings remediation

- Scope: implemented all four validated Phase 2 review findings as one identity-owned, generation-fenced broker model; no Git operations were performed.
- Ownership fixes: same-field suggestion work now synchronously installs an identity token and only the current token can publish; selection synchronously consumes the exact capability before its first await, so concurrent selects produce one release path and at most one HOTP reservation. Capacity and finalizers remain identity-safe.
- Terminal fix: concurrent duplicate confirmations for the same release and exact binding join one in-flight promise, receive the same fixed terminal response, execute one underlying HOTP confirmation, and then use the existing 60-second terminal retention.
- Expiry fix: release expiry is the minimum of five seconds and the generated TOTP/Steam interval or durable HOTP reservation expiry. Non-positive windows fail closed, and capability, release, retention, and prune boundaries consistently treat `now >= expiresAt` as expired.
- Invalidation fix: lock/session cleanup and disposal synchronously advance an invalidation generation before clearing state. Async operations validate generation after every await and before publication or response; a HOTP reservation returned after invalidation is cancelled best-effort and never published.
- RED evidence: the focused broker suite failed 7 new ownership regressions before production changes: stale same-field publication, duplicate capability selection, duplicate confirmation, TOTP and Steam interval boundaries, deferred suggestion/item-reread invalidation, and post-disposal HOTP reservation cleanup.
- Focused GREEN evidence: `pnpm exec vitest run packages/messaging/test/otp-fill.test.ts packages/messaging/test/otp.test.ts apps/extension/test/background/otp-fill-service.test.ts apps/extension/test/background/otp-fill-hotp-lifecycle.test.ts apps/extension/test/background/router.test.ts apps/extension/test/background/background-runtime.integration.test.ts apps/extension/test/platform/chrome-platform.test.ts` passed, 7 files and 85 tests.
- Serial regression evidence: `pnpm exec vitest run packages/messaging packages/otp packages/storage apps/extension/test/background apps/extension/test/platform --maxWorkers=1 --no-file-parallelism` passed, 42 files and 554 tests.
- Static evidence: `pnpm typecheck` passed with the expected Node v24.18.0 development-only engine warning; full `pnpm lint` passed with zero warnings; targeted Prettier check passed for the modified service and test.
- Legacy evidence: `pnpm exec vitest run tests/legacy/fixtures.test.ts` passed, 1 file and 9 tests.
- Added exact tests cover synchronous same-field winner ownership, atomic duplicate select/HOTP reserve count, shared concurrent terminal confirmation, deterministic TOTP and Steam boundary/exact-expiry behavior, cleanup during deferred suggestion loading and item reread, and disposal during deferred HOTP reserve.

## 2026-08-12 — Phase 2 expiry edge regression evidence

- Scope: added the two reviewer-noted non-blocking broker expiry regressions only; production code was unchanged because both tests passed against the existing implementation. No Git operations were performed.
- Coverage: a durable HOTP reservation expiring earlier than the five-second broker limit bounds the published release to the reservation expiry; source expiry equal to or earlier than `releaseNow` fails publication with `OTP_FILL_EXPIRED` and cancels the internal HOTP reservation using the exact tab/frame/document binding.
- Focused evidence: `pnpm exec vitest run apps/extension/test/background/otp-fill-service.test.ts` passed, 1 file and 17 tests.
- Static evidence: `pnpm typecheck` passed with the expected Node v24.18.0 development-only engine warning; `pnpm exec eslint apps/extension/test/background/otp-fill-service.test.ts --max-warnings 0` passed; `pnpm exec prettier --check apps/extension/test/background/otp-fill-service.test.ts` passed.

## 2026-08-12 — Phase 3 RED

- Environment: Linux x86_64; Node v24.18.0 development-only; pnpm 10.14.0.
- Exact focused command: `pnpm exec vitest run apps/extension/test/content/otp/otp-fill-controller.dom.test.tsx tests/security/manifest.test.ts tests/security/csp.test.ts tests/security/build-output.test.ts`.
- Result: genuine RED, exit 1. The controller suite failed import resolution because the production controller was absent; source manifest/content assertions failed because content remained inert and top-frame-only; build policy remained pinned to inert top-frame output. The unchanged CSP suite passed.
- Exact packaged command: `pnpm exec playwright test tests/browser/project1-otp-autofill.spec.ts`.
- Result: genuine RED, exit 1. The synthetic OTP fixture did not exist and returned a controlled local not-found response.
- TDD boundary: no Phase 3 controller, active content entry, all-frame manifest activation, or synthetic fixture implementation existed when these commands ran.

## 2026-08-12 — Phase 3 preserved-state recovery and WAR contract correction

- Scope: recovered the preserved Phase 3 partial state only; no Git operations, full browser matrix, or documentation work were performed.
- Root cause evidence: CRXJS 2.7.1 emits a non-WAR content loader (`assets/main.tsx-loader-*.js`) which calls `chrome.runtime.getURL` for the generated content entry. The single generated WAR entry contains that entry plus its exact transitive local JavaScript imports; the loader itself is not web-accessible. The preserved standalone scanner fixture instead exposed its content script directly, while the scanner accepted any non-content `assets/*.js`, so valid fixtures failed and arbitrary substituted or omitted JavaScript could pass.
- RED evidence: the original `pnpm exec vitest run tests/security/build-output.test.ts` failed exactly 4 of 74 tests. After making the standalone fixture model the generated loader/entry/dependency shape, two new mismatch regressions failed as intended: replacing a generated dependency with unrelated local JavaScript and omitting a generated dependency were both accepted.
- Correction: the scanner now derives the exact transitive local JavaScript dependency closure from the generated content loader using statically parsed ESM references and literal `chrome.runtime.getURL(...)` references. WAR resources must equal that closure, remain local exact JavaScript paths, exclude the content loader, contain no duplicates, and retain exact `<all_urls>`/`use_dynamic_url: false` metadata. Standalone fixtures use the same generated-output shape. Picker/test harness, missing references, remote references, and arbitrary local JavaScript remain rejected.
- Executable-policy integration: the existing executable scanner now follows CRXJS's literal `import(chrome.runtime.getURL("assets/..."))` loader reference as a local executable edge; its TypeScript narrowing was corrected without weakening fail-closed handling. The obsolete checked-in-source inertness assertion now explicitly confirms the active controller bootstrap is not inert, and the content entry test enforces the narrow controller bootstrap with no direct network, clipboard/media, console, DOM-query, or React-root surface.
- React diagnostics: controller focus/click/disposal and promise settlement are now driven inside React `act`; the focused controller suite passes with no act diagnostics.
- Final focused command: `pnpm exec vitest run apps/extension/test/content/otp apps/extension/test/content/createPickerHost.dom.test.tsx tests/security/manifest.test.ts tests/security/csp.test.ts tests/security/build-output.test.ts tests/security/executable-policy.test.ts && pnpm typecheck && pnpm build:security`.
- Final result: GREEN. Focused unit/security: 11 files and 358 tests passed with clean controller stderr. Typecheck passed. `build:security` rebuilt the CRXJS package, passed 2 output-security files and 7 tests, and ended with `Build scan passed` against the actual generated `dist` manifest/assets.
- Preserved contracts: exact one-entry all-frame `<all_urls>` content contract at `document_idle`; self-only CSP; no remote executable/reference; no picker or test-harness output exposure; only exact generated local content dependencies are WAR. Node v24.18.0 remains development-only outside the official Node 22 engine and emitted the expected warning.


## 2026-08-12 — Phase 3 packaged matrix, policy, and release evidence

- Environment: Linux x86_64; Node v24.18.0 development-only; pnpm 10.14.0; installed Playwright Chromium (later than the required minimum browser).
- Packaged matrix: expanded the single synthetic browser case into one serial setup/unlock workflow covering explicit and heuristic eligibility, false-positive rejection, top/same-origin/cross-origin frame activation, explicit inline trigger, metadata-only favorite-first suggestions and local search, TOTP, Steam, packaged HOTP single increment, replacement cancellation, lock and navigation invalidation, no submit/focus advance, encrypted persistence, accessibility, and a reviewed compact safe screenshot. Existing direct broker/lifecycle suites retain duplicate/failure/timeout/restart/ambiguity and React-controlled native-setter coverage.
- Fixture correction: the initial packaged smoke emitted one controlled local missing-icon console error. Root cause was browser favicon fallback on the synthetic page; adding an inert local data icon removed the unrelated runtime issue without changing extension behavior.
- Compatibility correction: the legacy packaged CRUD browser spec still expected direct content authorization for low-level HOTP reserve/commit/cancel commands, contradicting the approved Task 11 broker boundary. It now asserts fixed unauthorized responses and unchanged counter; exactly-once worker-restart/receipt behavior remains in direct broker and lifecycle tests. Runtime-capture evidence now retains its generated Worker until delayed diagnostics are observed.
- Product correction: removed an unnecessary fill-release assertion and kept synchronous code clearing before terminal confirmation. No permissions or CSP were added.
- Security/build policy: updated runtime boundaries, permissions, invariants, threat model, and release checklist for all-frame execution, untrusted pages, exact field/release authority, page observability, HOTP uncertainty, no auto-submit, best-effort cleanup, and non-CAS semantics. Added Task 11 scripts and exact Node-24 allowlist entry; the Task 11 Prettier ignore contains append-only ledgers/recovery evidence only. Build-output and executable-policy scanners passed against the generated loader/entry/dependency closure.
- Focused unit/security evidence: `pnpm test:project1:task11` passed 57 files and 956 tests. Focused security passed 6 files and 294 tests. `pnpm build:security` passed 2 output files and 7 tests and ended with `Build scan passed`.
- Focused packaged evidence: `pnpm exec playwright test tests/browser/project1-otp-autofill.spec.ts` passed 1 test. The compact baseline was visually inspected: bounded 320-by-278 picker, complete headings/search/rows, visible focus, no clipping, and metadata only; no code, seed, page value, identifier, or raw URL is visible.
- Static evidence: full typecheck, lint, dependency cruise, and Task 11 format check passed. Formatting policy now governs the plan/spec tree and ignores only append-only ledger evidence at the Task 11 layer.
- Full development gate: `pnpm verify:project1:task11:local-node24` passed after one genuine compatibility RED. Evidence included 94 files/1,430 tests, startup diagnostics 2 files/3 tests, all 26 packaged browser tests, security plus legacy 7 files/303 tests, build scan success, 26-file byte-identical reproducible build, and production audit with no known vulnerabilities.
- Exact legacy evidence: `pnpm exec vitest run tests/legacy/fixtures.test.ts` passed 1 file and 9 tests; its preservation assertion verified all 17 authorized artifacts as exact regular files.
- Fresh independent release evidence: `node scripts/verify-reproducible-build.mjs` verified 26 files with identical SHA-256 bytes; `pnpm audit --prod` reported no known vulnerabilities.
- Remaining external blockers: official `pnpm verify:project1:task11` has not run under Node >=22.14.0 <23, and packaged execution has not run in actual Chrome/Chromium 110. Node 24 and later-Chromium evidence are development-only and do not clear either release blocker. No Git operation was performed.

## 2026-08-14 — Fresh full-gate timing correction

- A fresh independent `pnpm verify:project1:task11:local-node24` run reached the full serial Vitest stage and failed one pre-existing vault DOM assertion: the test synchronously queried the secret input immediately after clicking a React state-changing reveal button. The Task 11 suites and preceding build/security stages passed.
- Root-cause evidence: the affected `OtpVaultView.dom.test.tsx` file passed focused, then passed five consecutive serial focused runs. No Task 11 production path was involved. The assertion was changed from a synchronous `getByLabelText` to `await findByLabelText`, matching the asynchronous React render boundary without changing product behavior.
- Fresh corrected full gate: `pnpm verify:project1:task11:local-node24` passed. Evidence included build scan and output policy, 94 files/1,430 tests, startup diagnostics 2 files/3 tests, all 26 packaged browser tests, security plus legacy 7 files/303 tests, 26-file byte-identical reproducible build, and production audit with no known vulnerabilities. Node 24 and later Chromium remain development-only evidence.
