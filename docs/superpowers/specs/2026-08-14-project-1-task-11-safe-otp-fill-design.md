# Project 1 Task 11 Safe In-Page OTP Fill Design

**Status:** Approved design for implementation planning

**Scope:** Project 1 Task 11 only: discover eligible OTP fields, show an isolated metadata-only account picker, release one selected TOTP/HOTP/Steam code, write it safely, and confirm or cancel the fill without automatic submission.

## 1. Goals

- Detect likely OTP fields in every eligible top-level page and frame.
- Show a small ShardPass trigger only beside the currently focused eligible field.
- Let the user select from a bounded favorite-first list of all active OTP accounts.
- Keep suggestions metadata-only and release a code only after explicit selection.
- Bind every release to the exact extension, tab, frame, document, origin, field handle, item revision, and session.
- Write through the native input setter and dispatch compatible events without submitting or advancing focus.
- Increment HOTP exactly once only after confirmed successful field writing.
- Fail closed on lock, restart, navigation, DOM replacement, timeout, sender mismatch, item revision change, or uncertain storage outcome.

## 2. Non-goals

- Automatic account selection from website origin or page content.
- Automatic picker opening, filling, form submission, Enter presses, or focus advancement.
- General password autofill, login-field discovery, passkeys, SMS interception, clipboard reading, or camera access.
- Piercing arbitrary page-owned open or closed Shadow DOM.
- Persisting page-field observations, suggestion lists, released codes, or origin-to-account associations.
- Exposing OTP seeds, full records, HOTP counters, notes, algorithms, repository objects, roots, keys, or crypto context to content scripts.

## 3. Fixed product decisions

- Content scripts run in all eligible frames, including cross-origin frames, using browser-provided frame/document sender identity.
- The picker opens only from an inline ShardPass button beside a focused eligible field.
- Suggestions include all active accounts, bounded and favorite-first. The page origin does not rank or filter accounts.
- After successful fill, the picker closes and focus remains in the OTP field.
- The architecture uses a dedicated `OtpFillService`; existing CRUD/code and durable HOTP operations remain lower-level dependencies.

## 4. Trust boundaries

### 4.1 Content script

The content script may:

- inspect the current frame DOM for eligible fields;
- retain live element identities in memory;
- render an isolated trigger and picker;
- receive bounded account metadata;
- receive one five-second selected code;
- write that code to one exact live field;
- report a fixed success or failure result.

It must never receive:

- a seed;
- a full `OtpItem`;
- bulk decrypted records;
- current HOTP counter;
- direct durable HOTP reservation authority;
- repository, root, session epoch, DEK, KEK, or crypto context;
- a general callback executor.

### 4.2 Background fill broker

`OtpFillService` exclusively owns:

- suggestion capabilities;
- item authoritative rereads;
- selected code generation;
- five-second releases;
- field/sender/session binding;
- low-level HOTP reservation IDs;
- confirmation, cancellation, expiry, lock, and disposal cleanup.

Existing direct content authorization for low-level HOTP reserve/commit/cancel is removed. Popup and full-vault behavior remains unchanged.

### 4.3 Page

The page can observe the final input value and standard input/change events because filling the page is the feature. It must not gain access to extension DOM internals, suggestion data, item IDs, release IDs, seeds, or background capabilities.

## 5. Field discovery

### 5.1 Eligible element

A candidate must be a connected `<input>` in the current frame and must remain:

- enabled;
- writable and not read-only;
- outside inert or hidden subtrees;
- of a text-like, tel-like, or numeric-compatible input type;
- measurable with nonzero dimensions;
- intersecting the viewport;
- visible by computed `display`, `visibility`, opacity, and pointer-interaction checks;
- outside the extension-owned picker host.

### 5.2 Positive signals

A field is eligible when it has either:

1. `autocomplete="one-time-code"`; or
2. a bounded associated/contextual label containing a recognized OTP, one-time code, verification code, authentication code, 2FA, or MFA phrase; or
3. a numeric 4–8 digit shape plus a separate verification-related contextual signal.

Numeric length alone is insufficient.

### 5.3 Negative signals

Explicit negative terms override weak heuristic matches, including PIN, postal/ZIP, CVV/CVC, card security, phone, account number, quantity, search, coupon, and date/year contexts. The explicit standards signal `autocomplete="one-time-code"` remains authoritative unless the field is ineligible for visibility/editability reasons.

### 5.4 Bounded discovery lifecycle

- Run one bounded initial scan after content startup.
- Use one `MutationObserver` for relevant additions/removals and selected attributes.
- Coalesce mutations into one scheduled scan.
- Enforce maximum examined nodes and discovered fields per pass.
- Pause and fail closed under sustained mutation churn rather than loop indefinitely.
- Recheck a focused input immediately so dynamic fields need not wait for a scheduled scan.
- Do not pierce page-owned Shadow DOM.
- Navigation and content-script disposal synchronously close UI and clear all field/release state.

### 5.5 Field handles

Each eligible live element receives a cryptographically random opaque field handle held in a `WeakMap`, with a bounded reverse map for the active picker only. Handles are never selectors, DOM paths, names, IDs, values, labels, hashes, or page-derived strings. A replacement element receives a different handle even if its markup is identical.

## 6. Isolated picker interaction

- Reuse the existing document-owned closed Shadow DOM host.
- Show the trigger only for the currently focused eligible field.
- Reposition on bounded scroll, resize, and layout updates.
- Close synchronously if the target disconnects, becomes ineligible, leaves the viewport, navigation occurs, or the frame loses authority.
- Clicking the trigger obtains a suggestion capability and bounded metadata list.
- Suggestions are favorite-first with deterministic secondary ordering and local search over issuer, label, and safe tags.
- Suggestion metadata contains only opaque item ID, expected revision, issuer, label, OTP type, favorite, and bounded safe tags.
- Suggestions omit code, seed, counter, algorithm, period, digits, note, timestamps, Ente metadata, and full records.
- Escape closes the picker. If still eligible, focus returns to the target field.
- The picker never opens automatically and never intercepts ordinary field typing.

## 7. Messaging and sender policy

Create a strict version-1 fill message family, preferably in `packages/messaging/src/otp-fill.ts` rather than further widening CRUD messaging:

- `otp.fillSuggestions`
- `otp.fillSelect`
- `otp.fillConfirm`
- `otp.fillCancel`

Every request and response:

- uses strict schemas and rejects unknown fields;
- has exact command-to-response-kind pairing;
- is content-only where appropriate;
- requires browser-owned extension ID, tab ID, frame ID, document ID, and sender URL;
- never accepts caller-supplied sender identity, origin authority, session epoch, root, repository, or crypto context.

The normalized origin is derived in background from the browser-owned sender URL. Unsupported or opaque origins fail closed unless an explicit tested browser scheme is allowed.

## 8. Suggestions capability

A suggestion request includes only a fresh random content request ID and the opaque field handle. The background:

1. validates and authorizes the sender;
2. verifies the vault is unlocked;
3. captures the current session authority;
4. loads one authenticated OTP snapshot;
5. projects bounded metadata field-by-field;
6. issues an in-memory random capability bound to sender, origin, field handle, session, and snapshot revisions.

Policy:

- five-minute maximum suggestion capability lifetime;
- one active capability per field;
- at most four per document and a bounded global count;
- replacement, lock, restart, navigation/document replacement, expiry, cancellation, or disposal invalidates it;
- the capability is consumed when an account is selected.

## 9. Selected-code release

### 9.1 Selection

Content sends:

- suggestion capability;
- opaque item ID and expected revision from the projection;
- opaque field handle.

The background revalidates sender, origin, document, session, capability ownership, item existence, item revision, and active state before code generation or HOTP reservation.

### 9.2 Release contract

A release response contains only:

- random release ID;
- code;
- exact expiry timestamp;
- fixed expected code length/character-class metadata needed for local verification.

It omits seed, counter, algorithm, note, tags, full item, low-level HOTP reservation ID, root, and session details.

Each release is bound to:

- extension ID;
- tab ID;
- frame ID;
- document ID;
- normalized origin;
- field handle;
- item ID and revision;
- current background session authority.

It expires after five seconds and permits one fill attempt. Code strings never enter logs, errors, test names, screenshots, snapshots, accessibility labels, DOM attributes, storage, clipboard, or analytics.

### 9.3 TOTP and Steam

- Generate only after selection and authoritative reread.
- Keep release state in memory only.
- Consume the release on the first confirm or cancel attempt.
- Successful confirmation may record best-effort non-authoritative activity.
- Failure never mutates the item.

### 9.4 HOTP

- Selection creates an underlying encrypted pending HOTP reservation through the existing durable lifecycle.
- The broker retains the low-level reservation ID internally.
- Successful fill confirmation commits exactly once.
- Known failed fill, timeout, cancel, navigation, or lock attempts cancellation.
- Active-root write ambiguity reconciles through existing durable receipts.
- Duplicate confirmation of the broker release is idempotent and returns the already committed safe result without another counter increment.
- A service-worker restart does not re-release the code. Pending durable state is reconciled/cancelled safely when possible.

## 10. Content-side fill algorithm

Immediately before writing, content verifies:

1. local release time remains valid;
2. the field handle maps to the exact same object;
3. the object remains connected, visible, editable, and eligible;
4. current frame URL/origin has not changed;
5. the element is outside the picker host;
6. no previous consume attempt was made.

Then content:

1. marks the release locally consumed;
2. focuses the target without advancing elsewhere;
3. obtains the owner-realm native `HTMLInputElement.prototype.value` setter;
4. calls the setter with the released code;
5. dispatches bubbling, composed `input` and `change` events;
6. verifies the same field remains connected and its value equals the released code;
7. reports fixed success or failure;
8. synchronously clears local code/release state;
9. closes the picker after success while leaving focus in the target.

It never calls submit APIs, presses Enter, clicks page controls, advances focus, retries against a replacement element, or falls back to page-overridden setters.

## 11. Confirmation, cancellation, and idempotency

- `confirm` includes release ID, field handle, and a fixed result enum; it includes no code or page-derived error text.
- Background consumes the release atomically before awaited mutation work.
- Duplicate confirmation returns the existing terminal result during a bounded reconciliation window.
- `cancel` is idempotent and non-disclosing.
- A success report for the wrong sender, field, document, origin, expired release, or changed item revision fails closed.
- Cleanup finalizers are identity-safe so stale operations cannot delete replacement capabilities.
- Lock and explicit disposal synchronously remove all in-memory capabilities/releases and initiate best-effort HOTP pending cancellation without claiming guaranteed JavaScript zeroization.

## 12. Errors and user feedback

All errors use fixed allowlisted code/message pairs, such as:

- `OTP_FILL_INVALID`
- `OTP_FILL_UNAVAILABLE`
- `OTP_FILL_EXPIRED`
- `OTP_FILL_FIELD_CHANGED`
- `OTP_FILL_ITEM_CHANGED`
- `OTP_FILL_CANCELLED`
- `OTP_FILL_UNCERTAIN`

Raw page strings, URLs, labels, selectors, item metadata, library errors, and storage failures are never reflected.

UI behavior:

- locked/unavailable: close picker and show a non-secret prompt to unlock through the extension;
- stale field or navigation: close immediately with no write;
- item changed: refresh suggestions rather than silently filling a new revision;
- fill failure: keep page state as produced by the page setter/events, close sensitive release state, and offer a safe retry that requires a new release;
- uncertain HOTP outcome: do not generate a new HOTP release until durable reconciliation resolves or the fixed uncertainty window expires safely.

## 13. Accessibility and visual behavior

- Trigger and picker use the existing compact dark ShardPass visual language.
- Trigger has a non-secret accessible name such as “Fill one-time code with ShardPass.”
- Picker is keyboard operable with predictable listbox/dialog semantics, visible focus, Escape close, and no focus trap that blocks the page.
- Account accessible names contain only already-approved safe metadata.
- The code never appears in picker text, status announcements, or accessible descriptions.
- Positioning avoids viewport overflow and flips above/below the field as needed.
- All-frame injection creates at most one host per frame.
- Reduced-motion mode uses instant state changes; no decorative motion is added.

## 14. Manifest and platform changes

- Set the existing content script to `all_frames: true` for eligible matched pages.
- Use Chrome-owned `sender.tab.id`, `sender.frameId`, `sender.documentId`, and sender URL for authority.
- Do not add `tabs`, `activeTab`, context menus, clipboard, downloads, camera, offscreen, optional host, externally connectable, or network permissions.
- Keep the current extension-page CSP unchanged.
- Preserve minimum Chrome 110 syntax and API behavior; later-Chromium evidence does not clear the Chrome 110 gate.

## 15. Testing strategy

### 15.1 Pure discovery tests

Cover:

- explicit `autocomplete="one-time-code"`;
- OTP/2FA/MFA/verification labels;
- numeric 4–8 digit shapes with required context;
- PIN, ZIP, CVV, phone, account, coupon, search, date, and quantity false positives;
- hidden, zero-size, offscreen, transparent, inert, disabled, and read-only fields;
- dynamic insertion/removal and relevant attribute changes;
- mutation coalescing and churn limits;
- same-markup DOM replacement receiving a new handle;
- no page Shadow DOM piercing.

### 15.2 Fill primitive tests

Cover:

- native owner-realm setter;
- React-controlled inputs;
- bubbling/composed `input` and `change` order;
- exact object identity;
- replacement/removal during events;
- no submit/requestSubmit/click/Enter/focus advancement;
- cleanup after success, setter throw, event throw, stale field, and expiry.

### 15.3 Messaging/service tests

Cover:

- strict schemas, bounds, unknown fields, and exact response pairing;
- metadata-only suggestions and no code before selection;
- exact all-frame sender binding and origin normalization;
- popup/vault/wrong-document/wrong-frame rejection for fill commands;
- suggestion capability TTL/caps/replacement/lock/restart;
- five-second single-use release;
- item revision races and session/root changes;
- TOTP/Steam success and failure;
- HOTP reserve/confirm/cancel, duplicate confirmation, ambiguity receipt, restart, timeout, and no double increment;
- removal of direct content authority for low-level HOTP commands;
- identity-safe stale finalizers and fixed error mapping.

### 15.4 Packaged browser tests

Use only synthetic local fixture pages and extension-owned synthetic vault data. Cover:

- top-frame and iframe discovery, including cross-origin fixture frames where the packaged harness permits;
- explicit and heuristic fields plus false positives;
- inline trigger behavior;
- all-active favorite-first suggestions and local search;
- TOTP, Steam, and exactly-once HOTP fill;
- React-controlled field;
- DOM replacement before selection and during fill;
- lock, navigation, frame/document replacement, service-worker restart, expiry, and cancellation;
- no automatic submission or focus advancement;
- encrypted HOTP persistence/reconciliation;
- axe accessibility and compact/zoom layout;
- screenshots containing safe metadata only and never codes, seeds, page values, notes, tags, release IDs, or raw URLs.

### 15.5 Security and release evidence

Assert:

- no new API permissions and intended `all_frames` content injection only;
- unchanged CSP;
- no seed/code logs or build artifacts;
- no remote network/camera/clipboard behavior;
- exact legacy artifact preservation;
- reproducible build;
- official Node 22 and actual Chrome 110 remain explicit release requirements unless genuinely run.

## 16. Implementation decomposition

Use three broad TDD phases to reduce correction rounds:

1. **Discovery and fill primitives** — field eligibility, bounded observer, opaque handles, native setter/events, isolated trigger/picker shell.
2. **Fill broker and protocol** — strict messaging, suggestion capabilities, five-second releases, TOTP/Steam, internalized durable HOTP lifecycle, runtime/router cleanup.
3. **Packaged UI and release evidence** — all-frame manifest behavior, full picker interaction, synthetic browser fixtures, security scans, docs, and verification scripts.

Each phase receives one consolidated review. No later phase begins with an unresolved load-bearing finding from the previous phase.

## 17. Security claims and residual risks

- ShardPass does not claim that page scripts cannot observe a value intentionally written into their input.
- JavaScript reference clearing and byte overwriting are best effort, not guaranteed zeroization.
- Heuristic discovery can produce false positives or false negatives; explicit user interaction and immediate revalidation limit consequences.
- Browser sender/document identity and extension isolation reduce confused-deputy risk but do not make a compromised browser or already-compromised page trustworthy.
- Local mutation serialization and authenticated root checks are not cross-process CAS.
- Cross-origin all-frame injection broadens where the isolated content script executes but does not add host permissions beyond existing match scope.
- HOTP uncertainty is surfaced and reconciled rather than hidden or retried optimistically.
