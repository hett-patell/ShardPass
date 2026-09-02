# ShardPass Project 2 Login and Autofill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the typed encrypted vault into a secure personal login manager with exact-origin defaults, password/passphrase/username generation, explicit capture and update prompts, metadata-only suggestions, and user-initiated password autofill.

**Architecture:** Pure domain packages own login rules, origin policy, field semantics, and generators. The content script treats the page as hostile and only discovers fields, renders isolated UI, collects short-lived candidates, and performs a selected fill. The background revalidates sender/origin at query and release time, owns decrypted records, and releases only selected fields through single-use document-bound grants.

**Tech Stack:** Projects 0–1 plus `tldts` for public-suffix-aware registrable-domain calculation, React Shadow DOM picker/prompt UI, Web Crypto secure randomness, Vitest/jsdom, Playwright HTTPS fixture sites, and axe-core.

## Global Constraints

- Projects 0 and 1 must pass before Project 2 begins.
- Exact normalized HTTPS origin is the default rule created during capture.
- HTTPS rules never match HTTP. Scheme broadening or registrable-domain broadening is explicit, warned, confirmed, and journaled.
- No regex matching, path rules, auto-submit, or automatic page-load fill in Project 2.
- Reject opaque origins, non-HTTP(S) schemes, sandboxed contexts without trustworthy origin, and cross-origin frames before metadata queries.
- Store canonical ASCII/punycode hosts and render a safe Unicode/ASCII warning model.
- Suggestions are metadata-only. Secret release requires explicit item selection, current revision, repeated sender/origin validation, single use, and a five-second maximum lifetime.
- Capture candidates live in background memory for five minutes and are never silently persisted. Worker restart safely invalidates them.
- Never fill hidden, disabled, read-only, offscreen, replaced, or unexpected fields.
- Preserve at most five prior passwords when an update is confirmed.
- DuckDuckGo credentials stay encrypted and are used only by the background adapter.
- No username, password, alias, token, candidate, secret grant, or full URL with user-info in logs/errors/snapshots/accessibility labels.
- Preserve the modern ShardPass theme from Project 0 across popup, vault, picker, and save prompt.
- This directory is not currently a Git repository; skip commit commands until Git is initialized by the owner.

---

## Target file map

```text
packages/domain/src/login.ts                 LoginItem and revision-safe updates
packages/origin-policy/src/                  canonicalization, display, matching
packages/generator/src/                      password/passphrase/username/alias ports
packages/field-discovery/src/                page-local semantic field classification
packages/messaging/src/login.ts              metadata/capture/release contracts
apps/extension/src/background/login/         query, grant, capture, CRUD services
apps/extension/src/background/aliases/       DuckDuckGo provider and encrypted settings
apps/extension/src/content/login/             discovery, observers, fill adapter
apps/extension/src/content/ui/                picker and save/update prompt
apps/extension/src/popup/login/               current-site login suggestions/generator
apps/extension/src/vault/login/               login list/editor/origin policy UI
tests/fixtures/sites/login/                   local hostile/normal form corpus
tests/browser/project2-*.spec.ts              end-to-end and visual/a11y evidence
```

## Task 1: Add the strict LoginItem schema and update rules

**Files:**

- Create: `packages/domain/src/login.ts`
- Modify: `packages/domain/src/vault-item.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `packages/domain/test/login.test.ts`
- Modify: `packages/storage/test/vault-repository.test.ts`

**Interfaces:**

- Produces: `LoginItemSchema`, `LoginMetadataSchema`, `createLogin`, `updateLoginPassword`, `MAX_PASSWORD_HISTORY = 5`.

- [ ] **Step 1: Write schema and update tests**

```ts
it("preserves five previous passwords on a confirmed change", () => {
  let item = validLogin({ password: "p0" });
  for (let index = 1; index <= 7; index += 1) {
    item = updateLoginPassword(item, `p${index}`, "capture-update", now(index));
  }
  expect(item.password).toBe("p7");
  expect(item.passwordHistory.map((entry) => entry.password)).toEqual([
    "p6",
    "p5",
    "p4",
    "p3",
    "p2",
  ]);
});
```

Also test one or more usernames, bounded name/notes/custom fields, concealed fields, `fillMode: "click"`, linked/embedded/no OTP discriminators, strict unknown-field rejection, unique rule IDs, and repository encryption/CRUD of login records.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run packages/domain/test/login.test.ts packages/storage/test/vault-repository.test.ts`

Expected: FAIL because `login` is not accepted.

- [ ] **Step 3: Implement the schema**

```ts
export const LoginItemSchema = ItemMetadataSchema.extend({
  kind: z.literal("login"),
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(256),
  usernames: z.array(LoginUsernameSchema).min(1).max(16),
  password: z.string().max(4096),
  passwordHistory: z.array(PasswordHistoryEntrySchema).max(5),
  originRules: z.array(OriginRuleSchema).min(1).max(64),
  otp: LoginOtpSchema,
  notes: z.string().max(16384),
  customFields: z.array(LoginCustomFieldSchema).max(64),
  fillMode: z.literal("click"),
}).strict();
```

- [ ] **Step 4: Implement revision-safe update helpers**

Only add history when the password changes. Store `{ password, changedAt, source }`; never expose it in `LoginMetadata`. Reject an update with stale expected revision.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run packages/domain packages/storage`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add packages/domain packages/storage/test/vault-repository.test.ts
 git commit -m "feat: add typed login vault items"
```

## Task 2: Implement origin canonicalization and display safety

**Files:**

- Create: `packages/origin-policy/package.json`
- Create: `packages/origin-policy/src/types.ts`
- Create: `packages/origin-policy/src/normalize.ts`
- Create: `packages/origin-policy/src/registrable-domain.ts`
- Create: `packages/origin-policy/src/display.ts`
- Create: `packages/origin-policy/src/index.ts`
- Create: `packages/origin-policy/test/normalize.test.ts`
- Create: `packages/origin-policy/test/display.test.ts`
- Create: `packages/origin-policy/test/registrable-domain.test.ts`

**Interfaces:**

- Produces: `normalizeWebOrigin(input): NormalizedWebOrigin`, `getRegistrableDomain(host): string | null`, `createOriginDisplay(origin): OriginDisplay`.

- [ ] **Step 1: Write canonicalization tests**

Cover default/non-default ports, uppercase hosts, trailing dot, IDN/punycode, IPv4/IPv6, localhost, single-label hosts, user-info rejection, fragments/paths ignored for origin, `blob:`, `data:`, `file:`, malformed URLs, and public suffixes such as `co.uk`.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run packages/origin-policy`

Expected: FAIL.

- [ ] **Step 3: Pin and wrap `tldts`**

Use `tldts` with private suffixes disabled. No other package may import it directly. Return `null` for IP, localhost, single-label hosts, and a public suffix without registrable label.

- [ ] **Step 4: Implement safe display**

Store ASCII canonical host. `OriginDisplay` exposes ASCII, Unicode candidate, warning flags for IDN/mixed-script/confusable-risk, scheme security, and port. If safe confusable analysis is uncertain, display ASCII prominently rather than asserting safety.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run packages/origin-policy`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add packages/origin-policy package.json pnpm-lock.yaml
 git commit -m "feat: normalize and display credential origins"
```

## Task 3: Implement explicit origin rules and matching

**Files:**

- Create: `packages/origin-policy/src/rules.ts`
- Create: `packages/origin-policy/src/match.ts`
- Create: `packages/origin-policy/src/context.ts`
- Create: `packages/origin-policy/test/match.test.ts`
- Create: `packages/origin-policy/test/context.test.ts`
- Modify: `packages/domain/src/login.ts`

**Interfaces:**

- Produces: `OriginRule`, `OriginRuleSummary`, `PageSecurityContext`, `evaluateOriginPolicy(rules, context): OriginDecision`.

- [ ] **Step 1: Write the policy matrix**

Test:

- Exact HTTPS origin match.
- Exact host and effective port.
- Explicit registrable-domain match.
- `never` overriding all positive rules.
- HTTPS-to-HTTP denial.
- Unapproved HTTP, IDN warning, IP, localhost, and non-default ports.
- Top-level same-origin frame acceptance.
- Cross-origin, sandboxed, opaque, and non-web context denial.
- No registrable-domain rules for IP/localhost/public suffix.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run packages/origin-policy/test/match.test.ts packages/origin-policy/test/context.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement deterministic precedence**

Precedence: invalid context → deny; matching `never` → deny; exact origin → allow; exact host → allow subject to scheme policy; registrable domain → allow with broad-rule indicator; otherwise deny. Never rank a broad positive rule over a matching exclusion.

- [ ] **Step 4: Add explicit broadening constructors**

`createExactOriginRule` is available during capture. `createExactHostRule` and `createRegistrableDomainRule` require an explicit confirmation token produced only by the vault UI; service methods journal the old/new rule and actor context.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run packages/origin-policy packages/domain/test/login.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add packages/origin-policy packages/domain/src/login.ts
 git commit -m "feat: enforce explicit credential origin policy"
```

## Task 4: Implement cryptographically secure generators

**Files:**

- Create: `packages/generator/package.json`
- Create: `packages/generator/src/random-source.ts`
- Create: `packages/generator/src/password.ts`
- Create: `packages/generator/src/passphrase.ts`
- Create: `packages/generator/src/username.ts`
- Create: `packages/generator/src/history.ts`
- Create: `packages/generator/src/index.ts`
- Create: `packages/generator/src/wordlists/eff-short.txt`
- Create: `packages/generator/test/password.test.ts`
- Create: `packages/generator/test/passphrase.test.ts`
- Create: `packages/generator/test/username.test.ts`
- Create: `packages/generator/test/history.test.ts`
- Create: `docs/architecture/generation.md`

**Interfaces:**

- Produces: `generatePassword`, `generatePassphrase`, `generateUsername`, `createPlusAddress`, `GeneratorHistory`.

- [ ] **Step 1: Write deterministic injected-randomness tests**

Test length bounds, required character minima, ambiguous-character exclusion, impossible constraints, rejection-sampling without modulo bias, passphrase word count/separator/case/number, random username, plus-address validation, and history clear/logout semantics.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run packages/generator`

Expected: FAIL.

- [ ] **Step 3: Implement secure random sampling**

Production `RandomSource` wraps `crypto.getRandomValues`. Tests inject deterministic bytes. Use rejection sampling for arbitrary alphabet sizes; shuffle required and remaining characters securely.

- [ ] **Step 4: Add and license the word list**

Use a reviewed, redistribution-compatible EFF word list. Record source URL, checksum, license, normalization, and word count. Bundle locally.

- [ ] **Step 5: Keep unsaved history memory-local**

History contains generated values only in the current trusted UI process, has a bounded count, is clearable, and clears on lock/logout. Do not persist or sync it.

- [ ] **Step 6: Run tests**

Run: `pnpm exec vitest run packages/generator`

Expected: PASS.

- [ ] **Step 7: Commit when Git exists**

```bash
git add packages/generator docs/architecture/generation.md
 git commit -m "feat: add secure credential generators"
```

## Task 5: Add the alias-provider port and DuckDuckGo adapter

**Files:**

- Create: `apps/extension/src/background/aliases/alias-provider.ts`
- Create: `apps/extension/src/background/aliases/duckduckgo-provider.ts`
- Create: `apps/extension/src/background/aliases/alias-settings-service.ts`
- Create: `packages/messaging/src/aliases.ts`
- Create: `apps/extension/test/background/aliases/duckduckgo-provider.test.ts`
- Create: `apps/extension/test/background/aliases/alias-settings-service.test.ts`
- Modify: `apps/extension/src/manifest.ts`
- Create: `docs/architecture/alias-providers.md`

**Interfaces:**

- Produces: `AliasProvider.generate(request): Promise<GeneratedAlias>` and versioned configure/remove/generate commands.

- [ ] **Step 1: Write adapter tests with mocked HTTP**

Assert POST to `https://quack.duckduckgo.com/api/email/addresses`, bearer token header, empty JSON body, strict response validation, normalized `<address>@duck.com`, redacted 401/network/invalid-response errors, timeout/abort, and no token/alias logging.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run apps/extension/test/background/aliases`

Expected: FAIL.

- [ ] **Step 3: Implement encrypted integration settings**

Store the token as an encrypted vault integration record accessible only to the background service. Removing the integration tombstones the token record and clears provider state.

- [ ] **Step 4: Add the narrow host permission**

Add only `https://quack.duckduckgo.com/*`; update manifest tests and permission rationale. No other alias host is pre-authorized.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run apps/extension/test/background/aliases tests/security/manifest.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add apps/extension/src/background/aliases apps/extension/test/background/aliases packages/messaging/src/aliases.ts apps/extension/src/manifest.ts docs/architecture/alias-providers.md
 git commit -m "feat: add protected DuckDuckGo alias provider"
```

## Task 6: Build local field discovery

**Files:**

- Create: `packages/field-discovery/package.json`
- Create: `packages/field-discovery/src/types.ts`
- Create: `packages/field-discovery/src/visibility.ts`
- Create: `packages/field-discovery/src/classify.ts`
- Create: `packages/field-discovery/src/forms.ts`
- Create: `packages/field-discovery/src/index.ts`
- Create: `packages/field-discovery/test/classify.test.ts`
- Create: `packages/field-discovery/test/forms.test.ts`

**Interfaces:**

- Produces: `discoverCredentialForms(root): CredentialFormModel[]`, `classifyField(element): FieldClassification`.

- [ ] **Step 1: Write a semantic fixture corpus**

Cover username/email, current password, new password, confirmation, OTP, search, card, hidden honeypot, disabled/readonly, offscreen, unlabeled, `autocomplete`, labels, nearby text, and multi-step single-field screens. Add false-positive fixtures.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run packages/field-discovery`

Expected: FAIL.

- [ ] **Step 3: Implement deterministic local heuristics**

Use autocomplete, type, name/id, explicit label, aria label, placeholder, nearby form structure, and visibility/editability. Return scores plus reasons for tests/debugging, but never page text or field values to a remote service.

- [ ] **Step 4: Bound scanning**

Skip hidden/disabled/readonly/non-input targets. Do not traverse closed shadow roots or cross-origin documents. Cap processed nodes and form candidates per scan.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run packages/field-discovery`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add packages/field-discovery
 git commit -m "feat: classify login fields locally"
```

## Task 7: Define login messaging and background authorization

**Files:**

- Create: `packages/messaging/src/login.ts`
- Create: `apps/extension/src/background/login/login-query-service.ts`
- Create: `apps/extension/src/background/login/secret-grant-service.ts`
- Create: `apps/extension/test/background/login/login-query-service.test.ts`
- Create: `apps/extension/test/background/login/secret-grant-service.test.ts`
- Modify: `apps/extension/src/background/router.ts`

**Interfaces:**

- Produces commands `login.querySuggestions`, `login.requestSecretGrant`, `login.consumeSecretGrant` and safe `LoginMetadata` projections.

- [ ] **Step 1: Write metadata-boundary tests**

Assert suggestions include item ID, revision, display name, matching username labels/values, favorite, and rule summary—but omit password, password history, concealed fields, notes, embedded OTP URI, and all unrelated records.

- [ ] **Step 2: Write grant lifecycle tests**

Assert explicit selection is required; item revision must match; query and grant both re-evaluate origin; grant binds extension/tab/frame/document/origin/item/fields, expires in five seconds, is single-use, and fails after navigation, worker restart, lock, item change, or rule change.

- [ ] **Step 3: Verify failure**

Run: `pnpm exec vitest run apps/extension/test/background/login/login-query-service.test.ts apps/extension/test/background/login/secret-grant-service.test.ts`

Expected: FAIL.

- [ ] **Step 4: Implement query and release services**

Index candidate metadata by canonical host, then run full origin policy before returning up to 20 rows. On consumption, return only the explicitly approved username/password/custom field values and no complete item object.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run apps/extension/test/background/login`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add packages/messaging/src/login.ts apps/extension/src/background/login apps/extension/test/background/login apps/extension/src/background/router.ts
 git commit -m "feat: authorize metadata-only login suggestions"
```

## Task 8: Implement safe field filling

**Files:**

- Create: `apps/extension/src/content/login/field-registry.ts`
- Create: `apps/extension/src/content/login/fill-fields.ts`
- Create: `apps/extension/src/content/login/document-context.ts`
- Create: `apps/extension/test/content/login/fill-fields.test.ts`
- Create: `tests/fixtures/sites/login/react-controlled.html`
- Create: `tests/fixtures/sites/login/unsafe-fields.html`

**Interfaces:**

- Produces: `FieldRegistry.register/resolve/clear` and `fillApprovedFields(grant, registry): FillResult`.

- [ ] **Step 1: Write hostile DOM tests**

Test React-controlled inputs, field replacement after suggestion, hidden/disabled/readonly/offscreen fields, type changes, detached elements, unexpected form changes, duplicate field IDs, cross-document elements, event ordering, and no submit event.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run apps/extension/test/content/login/fill-fields.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement opaque field handles**

Register eligible elements under random document-local handles. Never send selectors or DOM paths as authority. Resolve and revalidate the exact element immediately before filling.

- [ ] **Step 4: Implement native setters and events**

Use the appropriate `HTMLInputElement` or `HTMLTextAreaElement` prototype setter, then bubbling `input` and `change`. Fill only approved handle/value pairs and clear grant references in `finally`.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run apps/extension/test/content/login/fill-fields.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add apps/extension/src/content/login apps/extension/test/content/login tests/fixtures/sites/login
 git commit -m "feat: fill selected login fields safely"
```

## Task 9: Build the themed Shadow DOM login picker

**Files:**

- Create: `apps/extension/src/content/ui/LoginPicker.tsx`
- Create: `apps/extension/src/content/ui/LoginPicker.module.css`
- Create: `apps/extension/src/content/ui/useAnchoredPosition.ts`
- Create: `apps/extension/src/content/login/login-controller.ts`
- Create: `apps/extension/test/content/ui/LoginPicker.test.tsx`
- Create: `tests/browser/project2-login-fill.spec.ts`
- Create: `tests/browser/project2-picker-visual.spec.ts`

**Interfaces:**

- Consumes: field discovery, metadata suggestions, secret grant, fill adapter.
- Produces: keyboard-accessible anchored listbox with explicit selection.

- [ ] **Step 1: Write interaction/a11y tests**

Test focus-triggered opening, no result/locked/error states, Arrow keys, Enter, Escape, Tab behavior, named options, long usernames, multiple accounts, origin warning, repositioning, SPA teardown, reduced motion, and focus restoration.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run apps/extension/test/content/ui/LoginPicker.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement the picker**

Use the Project 0 closed Shadow root, near-black surfaces, coral selection rail, mono origin metadata, sharp 2px geometry, restrained elevation, and 32px targets. Do not reveal passwords or put them in accessible names. Do not auto-select/fill a single match.

- [ ] **Step 4: Connect explicit fill**

On selection, request a current revision grant, consume it, revalidate field handles, fill, clear, and announce “Filled login” without secret values. Surface origin denials instead of hiding them.

- [ ] **Step 5: Run browser/visual tests**

Run: `pnpm exec playwright test tests/browser/project2-login-fill.spec.ts tests/browser/project2-picker-visual.spec.ts`

Expected: PASS with reviewed snapshots and no serious axe findings.

- [ ] **Step 6: Commit when Git exists**

```bash
git add apps/extension/src/content/ui apps/extension/src/content/login/login-controller.ts apps/extension/test/content/ui tests/browser/project2-login-fill.spec.ts tests/browser/project2-picker-visual.spec.ts
 git commit -m "feat: add origin-aware login picker"
```

## Task 10: Implement short-lived capture candidates

**Files:**

- Create: `apps/extension/src/content/login/capture-observer.ts`
- Create: `apps/extension/src/content/login/navigation-observer.ts`
- Create: `apps/extension/src/background/login/capture-candidate-service.ts`
- Modify: `packages/messaging/src/login.ts`
- Create: `apps/extension/test/content/login/capture-observer.test.ts`
- Create: `apps/extension/test/background/login/capture-candidate-service.test.ts`

**Interfaces:**

- Produces commands `login.proposeCapture`, `login.resolveCaptureCandidate`, `login.dismissCaptureCandidate`; candidates expire after five minutes.

- [ ] **Step 1: Write capture tests**

Cover login submit, registration, password change, multi-step username then password, SPA navigation, failed/uncertain login, duplicate existing items, ambiguous username matches, no password, unchanged password, hidden honeypot, worker restart, lock, expiry, and navigation to a different origin.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run apps/extension/test/content/login/capture-observer.test.ts apps/extension/test/background/login/capture-candidate-service.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement minimum candidate collection**

Collect only normalized origin, candidate username, candidate password, field role evidence, and non-secret display title. Encrypt nothing because candidates are memory-only; never persist them to storage/session/local. Clear on lock/restart/expiry/dismissal.

- [ ] **Step 4: Implement conservative resolution**

Classify as new, update, ambiguous, unchanged, or rejected. Submission alone is never proof of successful authentication. Prompt after navigation when confidence is sufficient but let the user edit, select another item, or dismiss.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run apps/extension/test/content/login/capture-observer.test.ts apps/extension/test/background/login/capture-candidate-service.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add apps/extension/src/content/login apps/extension/src/background/login/capture-candidate-service.ts packages/messaging/src/login.ts apps/extension/test
 git commit -m "feat: detect explicit login save candidates"
```

## Task 11: Build the save/update prompt and commit service

**Files:**

- Create: `apps/extension/src/content/ui/SaveLoginPrompt.tsx`
- Create: `apps/extension/src/content/ui/SaveLoginPrompt.module.css`
- Create: `apps/extension/src/background/login/login-commit-service.ts`
- Create: `apps/extension/test/content/ui/SaveLoginPrompt.test.tsx`
- Create: `apps/extension/test/background/login/login-commit-service.test.ts`
- Create: `tests/browser/project2-login-capture.spec.ts`
- Create: `tests/browser/project2-save-prompt-visual.spec.ts`

**Interfaces:**

- Produces commands `login.previewCapture`, `login.commitCapture`, and `login.dismissCapture`.

- [ ] **Step 1: Write prompt tests**

Test new/update/ambiguous states, editable name/username, selected target item, exact origin display, password concealed, dismiss, stale candidate, revision conflict, validation errors, keyboard operation, and non-modal focus behavior.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run apps/extension/test/content/ui/SaveLoginPrompt.test.tsx apps/extension/test/background/login/login-commit-service.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement explicit commit semantics**

New items receive only an exact origin rule. Updates require expected revision, preserve previous password, journal the origin/password change, and fail visibly on conflicts. Never merge by title alone.

- [ ] **Step 4: Implement the anchored prompt**

Use a named anchored region unless focus is intentionally trapped; do not claim dialog modality incorrectly. Show what origin and item will change. Use coral for the primary save action and red only for destructive operations.

- [ ] **Step 5: Run browser/visual tests**

Run: `pnpm exec playwright test tests/browser/project2-login-capture.spec.ts tests/browser/project2-save-prompt-visual.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add apps/extension/src/content/ui apps/extension/src/background/login/login-commit-service.ts apps/extension/test tests/browser/project2-login-capture.spec.ts tests/browser/project2-save-prompt-visual.spec.ts
 git commit -m "feat: add explicit save and update prompts"
```

## Task 12: Build login CRUD and origin editing in the full vault

**Files:**

- Create: `apps/extension/src/vault/login/LoginVaultView.tsx`
- Create: `apps/extension/src/vault/login/LoginList.tsx`
- Create: `apps/extension/src/vault/login/LoginEditor.tsx`
- Create: `apps/extension/src/vault/login/OriginRulesEditor.tsx`
- Create: `apps/extension/src/vault/login/PasswordField.tsx`
- Create: `apps/extension/src/background/login/login-crud-service.ts`
- Modify: `packages/messaging/src/login.ts`
- Create: `apps/extension/test/vault/login/*.test.tsx`
- Create: `tests/browser/project2-vault-login.spec.ts`

**Interfaces:**

- Produces list/search/create/get-editor/update/delete and explicit origin broadening commands.

- [ ] **Step 1: Write CRUD and sensitive-action tests**

Test list metadata, search, create/edit, stale revision, password conceal/reveal/copy, step-up authentication for reveal/history and broadening, exact origin default, broadening warning/confirmation, `never` rule, HTTPS downgrade warning, IDN display, archive/trash boundaries reserved for Project 3, and safe live-region feedback.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run apps/extension/test/vault/login`

Expected: FAIL.

- [ ] **Step 3: Implement the full-page split UI**

Use dense rows with item-kind icon, display name, primary username, and safe origin. Detail panel shows concealed password and visibly lists every origin rule. Long forms retain sticky action/footer behavior without oversized cards.

- [ ] **Step 4: Implement step-up and revision checks**

A recent unlock window may satisfy reveal/copy; otherwise require the current master password. Broadening always requires a dedicated confirmation showing old and new scope. Journal every change.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run apps/extension/test/vault/login && pnpm exec playwright test tests/browser/project2-vault-login.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add apps/extension/src/vault/login apps/extension/src/background/login/login-crud-service.ts packages/messaging/src/login.ts apps/extension/test/vault/login tests/browser/project2-vault-login.spec.ts
 git commit -m "feat: manage login items and origin rules"
```

## Task 13: Integrate generation into popup, vault, and capture

**Files:**

- Create: `apps/extension/src/popup/generator/GeneratorPanel.tsx`
- Create: `apps/extension/src/vault/generator/GeneratorView.tsx`
- Create: `apps/extension/src/content/ui/GeneratorPopover.tsx`
- Create: `apps/extension/src/background/generator/generator-service.ts`
- Create: `apps/extension/test/ui/generator.test.tsx`
- Create: `tests/browser/project2-generator.spec.ts`

**Interfaces:**

- Produces `generator.generatePassword`, `generator.generatePassphrase`, `generator.generateUsername`, `generator.generateAlias`, `generator.clearHistory`.

- [ ] **Step 1: Write workflow tests**

Test configuration validation, regenerate, copy feedback without announcing value, generate/fill/save on registration, plus-address input, DuckDuckGo unavailable/configured/error states, clear history, lock clearing history, and no generated value in URL/log/snapshot.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run apps/extension/test/ui/generator.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement compact shared controls**

Keep numeric settings compact, labels explicit, and generated value monospaced/concealed where shoulder-surfing is relevant. Alias provider appears as a selectable strategy only when configured.

- [ ] **Step 4: Connect generate/fill/save**

Registration flow uses a generated password, fills new/confirm fields through the grant mechanism, and opens an editable save candidate. It never assumes account creation succeeded.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run apps/extension/test/ui/generator.test.tsx && pnpm exec playwright test tests/browser/project2-generator.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add apps/extension/src/popup/generator apps/extension/src/vault/generator apps/extension/src/content/ui/GeneratorPopover.tsx apps/extension/src/background/generator apps/extension/test/ui tests/browser/project2-generator.spec.ts
 git commit -m "feat: integrate secure credential generation"
```

## Task 14: Prioritize current-site suggestions in the popup

**Files:**

- Create: `apps/extension/src/popup/login/CurrentSiteLogins.tsx`
- Create: `apps/extension/src/popup/login/LoginQuickActions.tsx`
- Modify: `apps/extension/src/popup/PopupApp.tsx`
- Create: `apps/extension/test/popup/CurrentSiteLogins.test.tsx`
- Create: `tests/browser/project2-popup.spec.ts`

**Interfaces:**

- Consumes: active-tab-derived sender context in the background; popup never supplies an origin as authority.
- Produces: metadata-only current-site list with explicit fill/copy/open actions.

- [ ] **Step 1: Write popup boundary tests**

Assert no full vault dump, no password in initial response/DOM/accessibility tree, locked and unsupported page behavior, multiple matches, explicit fill, stale tab navigation, and safe origin warning.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run apps/extension/test/popup/CurrentSiteLogins.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement active-site prioritization**

Background derives active tab URL and queries policy. Popup shows current-site logins first, then OTP favorites/recent items, while maintaining the compact 360px layout.

- [ ] **Step 4: Run browser tests**

Run: `pnpm exec playwright test tests/browser/project2-popup.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit when Git exists**

```bash
git add apps/extension/src/popup/login apps/extension/src/popup/PopupApp.tsx apps/extension/test/popup tests/browser/project2-popup.spec.ts
 git commit -m "feat: prioritize current-site credentials"
```

## Task 15: Complete the hostile-site browser matrix

**Files:**

- Create: `tests/fixtures/sites/login/standard.html`
- Create: `tests/fixtures/sites/login/registration.html`
- Create: `tests/fixtures/sites/login/password-change.html`
- Create: `tests/fixtures/sites/login/multi-step.html`
- Create: `tests/fixtures/sites/login/spa.html`
- Create: `tests/fixtures/sites/login/iframes.html`
- Create: `tests/fixtures/sites/login/cross-origin-frame.html`
- Create: `tests/fixtures/sites/login/http-downgrade.html`
- Create: `tests/fixtures/sites/login/idn.html`
- Create: `tests/browser/project2-origin-security.spec.ts`
- Create: `tests/browser/project2-multi-step.spec.ts`
- Create: `tests/browser/project2-accessibility.spec.ts`
- Create: `tests/browser/project2-visual.spec.ts`

**Interfaces:**

- Produces: Full browser evidence required by the design specification.

- [ ] **Step 1: Add controlled HTTPS and cross-origin fixture servers**

Use locally generated test certificates trusted only by the Playwright context. Serve separate loopback hosts/ports to model exact origin, subdomain, HTTP downgrade, and cross-origin frame behavior deterministically.

- [ ] **Step 2: Write the denial matrix**

Assert no metadata or secret on HTTP downgrade, unapproved origin, opaque/sandboxed/cross-origin frame, deceptive IDN warning, stale navigation, hidden/replaced field, or changed item revision.

- [ ] **Step 3: Write positive workflow tests**

Assert standard login, registration, password change, multi-step, SPA, same-origin supported frame where policy allows, React-controlled inputs, multiple accounts, login-plus-OTP, and lock during picker/prompt.

- [ ] **Step 4: Add visual and axe coverage**

Cover popup, vault list/detail/editor, origin warning, picker, save/update prompt, generator, locked state, empty/error states, reduced motion, browser zoom, and long localized-style labels. No secret may enter snapshots.

- [ ] **Step 5: Run the matrix**

Run: `pnpm exec playwright test tests/browser/project2-*.spec.ts`

Expected: PASS with reviewed screenshots and no serious/critical axe violations.

- [ ] **Step 6: Commit when Git exists**

```bash
git add tests/fixtures/sites/login tests/browser/project2-*.spec.ts tests/browser/__screenshots__
 git commit -m "test: verify login workflows against hostile pages"
```

## Task 16: Establish the Project 2 release gate

**Files:**

- Create: `tests/security/project2-boundaries.test.ts`
- Modify: `scripts/scan-secrets.mjs`
- Modify: `docs/security/threat-model.md`
- Modify: `docs/security/invariants.md`
- Modify: `docs/security/release-checklist.md`
- Modify: `package.json`

**Interfaces:**

- Produces: `pnpm verify:project2`.

- [ ] **Step 1: Add source/message/build scans**

Assert no content message can export, enumerate full decrypted records, access history, alter rules, request an unselected password, or consume a grant for another document. Scan for secret-bearing console/log calls, `dangerouslySetInnerHTML`, unsafe URL matching, automatic submission, and persistence of capture candidates/generator history.

- [ ] **Step 2: Update threat model and invariants**

Add phishing/lookalikes, HTTP downgrade, malicious iframes, DOM replacement, hidden exfiltration fields, form spoofing, capture ambiguity, stale revisions, grant replay, background restart, public-suffix errors, alias token theft, clipboard exposure, and shoulder surfing.

- [ ] **Step 3: Add the release command**

```json
{
  "scripts": {
    "verify:project2": "pnpm verify:project1 && pnpm vitest run packages/domain packages/origin-policy packages/generator packages/field-discovery apps/extension/test && pnpm exec playwright test tests/browser/project2-*.spec.ts && node scripts/scan-secrets.mjs && pnpm audit --prod"
  }
}
```

- [ ] **Step 4: Run from a clean installation**

Run: `pnpm install --frozen-lockfile && pnpm verify:project2`

Expected: PASS. Exact HTTPS origin is default; unsafe contexts receive neither metadata nor secrets; capture is explicit; five-entry password history is bounded; generators satisfy constraints; all UI surfaces pass visual/a11y review.

- [ ] **Step 5: Request independent security review**

Review origin policy, message authorization, secret grant lifecycle, capture semantics, storage integration, and content-script DOM handling. Record findings and dispositions before a public password-manager release.

- [ ] **Step 6: Commit when Git exists**

```bash
git add tests/security/project2-boundaries.test.ts scripts/scan-secrets.mjs docs/security package.json
 git commit -m "test: enforce Project 2 security gate"
```

## Project 2 completion evidence

- Users can securely create, edit, search, generate, capture, and fill login records.
- Exact HTTPS origin is visible and default; all broadening is explicit and journaled.
- Metadata and selected-secret release are separate, validated, document-bound operations.
- Save and update prompts are editable, non-silent, revision-safe, and preserve five prior passwords.
- Password, passphrase, username, plus-address, and DuckDuckGo alias workflows are tested.
- Popup, full-page vault, picker, save prompt, and generator remain visually coherent with ShardPass.
- Hostile-page, accessibility, visual, secret-scan, and security-boundary gates pass before release.
