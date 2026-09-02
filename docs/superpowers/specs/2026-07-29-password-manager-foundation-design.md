# ShardPass Password Manager Foundation Design

**Date:** 2026-07-29  
**Status:** Approved direction  
**Implementation boundary:** Projects 0–2  
**Program scope:** Transform ShardPass from a packaged OTP extension into a maintainable personal password manager.

## 1. Context and constraints

The workspace contains an unpacked production Chrome Manifest V3 extension, not its development repository. The popup, background service worker, and content script are minified bundles. There is no package manifest, build configuration, source map, test suite, or Git repository.

The implementation must therefore be a clean-room maintainable rebuild that uses the current package as a behavioral and migration reference. Generated assets must not become the new source code.

The first implementation plan covers:

- **Project 0:** Reproducible TypeScript foundation and security baseline.
- **Project 1:** Versioned typed local vault, migration, and full OTP behavioral parity.
- **Project 2:** Login records, generation, capture, strict-origin matching, and password autofill.

Secure notes, cards, identities, history/recovery, generalized import/export, health monitoring, purpose-built sync, passkeys, sharing, and business features remain separately gated follow-up projects. The foundation must make those projects possible without implementing them prematurely.

## 2. Product principles

1. **Security behavior before feature count.** Safe matching, correct fill behavior, portability, migration, and recovery semantics matter more than broad checkbox parity.
2. **Local-first trust boundary.** The first release stores the generalized vault locally and supports encrypted portability before introducing a new synchronization service.
3. **Ente interoperability stays OTP-specific.** Existing Ente Auth integration remains an optional projection of OTP items. Login passwords and future item types never enter Ente's authenticator API.
4. **Click-to-fill by default.** Automatic page-load filling must be a deliberate user option, not the baseline.
5. **Least-privilege secret access.** UI and content-script code receive the smallest page-specific projections necessary. They never receive a whole decrypted vault.
6. **Explicit security trade-offs.** Origin broadening, plaintext export, recovery changes, and destructive actions must disclose consequences.
7. **Portable data ownership.** A user must have a documented path to migrate and back up data before managed sync is introduced.
8. **Theme continuity.** The rebuild evolves ShardPass's existing dark, precise, coral-accented identity instead of replacing it with a generic rounded password-manager aesthetic.

## 3. Program decomposition

The full transformation is split into independently specified and releasable projects:

0. Maintainable source project and security baseline.
1. Typed local vault, OTP migration, and OTP parity.
2. Login capture, exact-origin matching, generation, and autofill.
3. Secure notes, cards, identities, custom fields, history, recovery, and complete import/export.
4. Local password health, K-anonymous breach checks, and UX hardening.
5. Open, end-to-end-encrypted multi-device synchronization.
6. Passkey storage and WebAuthn integration.
7. Sharing, family vaults, and emergency access.
8. Alias-provider adapters, developer item types, CLI, and optional organization capabilities.

Projects 3–8 require their own approved specifications and threat-model updates.

## 4. Project 0: maintainable foundation

### 4.1 Repository structure

Create a TypeScript workspace with explicit application and library boundaries:

```text
apps/
  extension/
    src/background/
    src/content/
    src/popup/
    src/vault/
packages/
  domain/
  crypto/
  storage/
  messaging/
  otp/
  origin-policy/
  importers/
  ui/
tests/
  fixtures/
  browser/
docs/
  architecture/
  security/
```

These paths are architectural boundaries, not permission to mix unrelated responsibilities into large files. Each package must expose a narrow public API and must not import from an application entry point.

### 4.2 Technology baseline

- TypeScript with strict compiler settings.
- React for popup and full-page vault surfaces.
- Vite-based reproducible extension build or an equivalent MV3-capable build tool selected in the implementation plan.
- WebExtension-compatible APIs through a typed browser abstraction.
- Vitest for unit and integration tests.
- Playwright for extension-level browser tests.
- Zod or an equivalent explicit runtime-schema validator at storage, import, and message boundaries.
- Locally bundled fonts and icons; no remote runtime fonts.
- No analytics in Projects 0–2.

Third-party dependencies must be minimal, pinned through a lockfile, and reviewed for browser compatibility and secret-handling behavior.

### 4.3 Runtime boundaries

- **Background service worker:** Vault session control, cryptographic orchestration, storage, item queries, OTP generation, Ente adapter, change journal, lock policy, and privileged message validation.
- **Content script:** Field discovery, page-local UI, fill execution, save/update candidate collection, and origin context. It must not derive keys, decrypt storage, or cache complete secrets.
- **Popup:** Fast unlock, current-site suggestions, OTP display/copy, quick add, generator access, and navigation to the full-page vault.
- **Full-page vault:** Search, filtering, item editing, settings, imports/exports, migration status, and security-sensitive confirmations.
- **Shared packages:** Pure domain rules and schema validation, with no dependency on React or browser globals unless the package is explicitly platform-facing.

### 4.4 Manifest and permissions

Start with the current MV3 capabilities but rejustify every permission. Prefer optional host permissions or an explicit domain allowlist workflow if that can preserve reliable autofill. Document why broad host access is required if `<all_urls>` remains.

Clipboard access should be invoked through user gestures where possible. Remote network allowlists must identify Ente endpoints explicitly. A future sync host must not be pre-authorized before Project 5.

### 4.5 Security baseline

Create and maintain:

- Threat model covering malicious pages, compromised dependencies, extension-message spoofing, XSS, stolen local profiles, clipboard exposure, shoulder surfing, and accidental destructive actions.
- Security invariants for key lifetime, session locking, origin checks, secret redaction, and export behavior.
- Dependency review and automated vulnerability checks.
- Content Security Policy tests.
- Message schemas and sender/context validation.
- Redacted structured errors with user-safe messages and no secrets.

## 5. Project 1: typed vault and OTP parity

### 5.1 Domain model

The vault uses discriminated item types and common versioned metadata:

```ts
type VaultItem = LoginItem | OtpItem;

interface ItemMetadata {
  id: string;
  schemaVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
  archivedAt?: string;
  deletedAt?: string;
  tags: string[];
}
```

Projects 0–2 implement `LoginItem` and `OtpItem`. The discriminated union is intentionally extensible for Project 3 item types, but placeholders for unimplemented item payloads must not be accepted into storage.

`LoginItem` contains:

- Name.
- One or more usernames.
- Password and bounded password-history metadata.
- One or more approved origin rules.
- Optional linked or embedded OTP reference.
- Notes and custom fields only to the minimum extent required for login capture; general custom-item UI is deferred.

`OtpItem` preserves:

- Issuer and label.
- Secret.
- TOTP or HOTP type.
- SHA-1, SHA-256, or SHA-512.
- Digit count.
- Period.
- HOTP counter.
- Steam behavior where present.
- Ente remote identity/state where required by the adapter.

### 5.2 Cryptographic envelope

Use a versioned key hierarchy:

1. Generate a random vault data-encryption key.
2. Derive a key-encryption key from the master password with a browser-appropriate memory-hard KDF and stored parameters.
3. Wrap the vault data key with authenticated encryption.
4. Encrypt item payloads or bounded item pages independently with AEAD.
5. Authenticate item ID, item kind, schema version, and revision as associated data.

The implementation plan must choose audited browser-compatible primitives and define parameter benchmarking. It must not invent cryptography or silently downgrade parameters.

The key hierarchy must support later device wrapping and recipient envelopes without changing every stored item. Keys and plaintext must have bounded in-memory lifetimes. JavaScript cannot guarantee physical zeroization, so documentation must not claim it can.

### 5.3 Storage model

Persistent storage contains:

- Versioned vault header and wrapped key material.
- Independently encrypted item records or pages.
- Encrypted change journal entries.
- Tombstones for deleted records.
- Non-secret migration and integrity status only when disclosure is acceptable.

Writes use a transaction-like staging protocol so interruption cannot replace a valid vault with a partial one. Maintain a last-known-good encrypted snapshot or equivalent rollback marker during migration.

### 5.4 Migration

Migration from the current `chrome.storage.local` vault must be:

- Detectable and explicitly versioned.
- Idempotent.
- Lossless for all observed OTP fields and settings.
- Tested with TOTP, HOTP, Steam, custom digits/period/algorithm, Ente-linked records, pending operations, and malformed fixtures.
- Completed through write-new, verify, then retire-old semantics.
- Reversible until post-migration verification succeeds.

The old encrypted vault must not be deleted automatically before the new vault decrypts, validates, and reproduces expected OTP codes from known fixtures. A user-visible migration error must preserve the old data and offer export/retry guidance.

### 5.5 OTP parity

The rebuild must preserve or deliberately improve:

- Setup and unlock.
- Auto-lock and lock-on-system-lock.
- TOTP, HOTP, and Steam code generation.
- SHA-1, SHA-256, and SHA-512.
- Configurable digits and period.
- HOTP counter advancement only after a confirmed fill action.
- Manual and URI creation.
- QR image/clipboard scanning.
- Google Authenticator migration input.
- Supported Aegis and Ente formats.
- Search, copy, countdown, edit, and delete.
- Existing encrypted backup compatibility where technically recoverable.
- In-page OTP detection and fill.
- Ente Auth login and OTP synchronization.

OTP code generators require known-answer tests, boundary tests around period rollover, and counter-concurrency tests.

### 5.6 Ente boundary

Define `OtpSyncAdapter` as a narrow interface. The Ente implementation can read and write only `OtpItem` projections. It must reject `LoginItem` and future non-OTP kinds by type and runtime schema.

The adapter must expose pending, synced, error, and conflict states. Undocumented Ente API behavior must not be treated as a stability guarantee. Preserve custom-server support only with explicit URL validation and clear trust messaging.

## 6. Project 2: login capture and autofill

### 6.1 Origin policy

Every login has explicit origin rules. Default save behavior records the current normalized HTTPS origin, including scheme, hostname, and non-default port.

Supported matching levels in Project 2:

- **Exact origin:** Scheme, hostname, and effective port must match. This is the default.
- **Exact host:** Hostname and effective port match; a user-approved scheme upgrade may be allowed, but HTTPS-to-HTTP downgrade is never silent.
- **Registrable domain:** User explicitly opts into subdomain-wide matching after a warning.
- **Never match:** Explicit exclusion for a site.

Paths and regular expressions are deferred. Unicode hostnames must be normalized and displayed safely with punycode/lookalike warnings. IP addresses, localhost, non-HTTP schemes, opaque origins, cross-origin frames, and sandboxed frames receive explicit policy rather than falling through string matching.

Credentials must not be offered on HTTP when only HTTPS origins are recorded. Adding or broadening an origin requires an explicit user action and is recorded in the item revision history.

### 6.2 Field discovery

The content script classifies:

- Username/email fields.
- Current-password fields.
- New-password and confirmation fields.
- OTP fields.
- Multi-step login transitions.

Classification combines autocomplete attributes, input type, semantic attributes, labels, nearby text, and form structure. Password values and page text must never be sent to a remote service for classification.

Field adapters must work with controlled frameworks by using native setters and appropriate input/change events. Closed shadow roots and inaccessible cross-origin frames are reported as unsupported rather than bypassed.

### 6.3 Save and update workflow

A candidate workflow captures the minimum page-local data and sends it to the background service with origin and frame context. The service returns one of:

- New login candidate.
- Existing item update candidate.
- Ambiguous matches requiring user selection.
- Rejected candidate with a safe reason.

Saving is never silent. The user can edit the title, username, selected vault item, and approved origin before commit. Updating a password preserves the previous password in bounded history and never overwrites an item solely because a page reported a submission event.

Failed login detection is heuristic; the design must avoid claiming a save is valid merely because a form was submitted. Post-navigation prompts should remain dismissible and reversible.

### 6.4 Fill workflow

1. Content script reports origin, frame, and classified fields.
2. Background validates sender and re-evaluates origin policy.
3. Background returns metadata-only suggestions.
4. User selects an item.
5. Background revalidates origin and releases only the selected fields in a short-lived response.
6. Content script fills only the approved field set and clears references immediately afterward.

Default behavior is click-to-fill. Optional automatic fill is per-item/per-origin and requires a separate setting. Automatic submit is out of scope for Project 2.

Ambiguous or deceptive contexts show a warning rather than ranking one credential silently. Autofill must not write secrets into hidden, disabled, offscreen, or unexpected cross-origin fields.

### 6.5 Generation

Project 2 includes:

- Random passwords with length, character-class, ambiguous-character, and minimum-class controls.
- Memorable passphrases with word count, separator, capitalization, and optional numeric controls.
- Random usernames and plus-address variants.
- Adapter interface for email-alias providers, retaining DuckDuckGo support without hard-coding aliases into the generator domain.
- Generate, fill, and save workflow.
- Client-local unsaved generator history with explicit clearing and no synchronization.

Generation uses cryptographically secure randomness and tests output constraints statistically and deterministically through injected test randomness.

## 7. User experience and visual system

### 7.1 Experience architecture

ShardPass gains two complementary surfaces:

- **Compact popup, 360px wide:** unlock, current-site matches, OTP codes, quick fill/copy, generator, add action, sync state, and link to the full vault.
- **Full-page vault:** scalable item list, details/editor pane, filters, settings, imports/exports, migration status, and later health reports.

The content-script picker remains a compact Shadow DOM surface beside relevant fields. It uses the same tokens and component language but avoids copying the entire application stylesheet into the page.

### 7.2 Preserve the existing identity

Preserve:

- Near-black `#0c0c0d` foundation.
- Charcoal card and popover surfaces.
- Warm coral `#ff4d2e` primary accent.
- Inter Tight for UI and IBM Plex Mono for technical data.
- Dense 4px spacing rhythm.
- Sharp 1–2px radii and hairline borders.
- Mono metadata, tabular OTP digits, uppercase technical labels.
- Coral selection rail, issuer marker, countdown ring, and restrained semantic colors.
- Lucide-style outline icons.
- Fast, low-amplitude motion.

Do not introduce decorative gradients, glassmorphism, oversized shadows, excessive pills, or large rounded cards. The existing precise technical character is part of the product identity.

### 7.3 Modernize coherently

Implement semantic tokens for:

- Background, surface, elevated surface, text levels, borders, accent states, danger, warning, success, and focus.
- A compact named typography scale rather than scattered fractional sizes.
- 4px-based space scale.
- 1px, 2px, and selectively 4px radii.
- Low, medium, modal, and picker elevation.
- Fast and standard motion durations and easing.

Modernization includes:

- A responsive full-page split view with list and detail/editor regions.
- Consistent empty, loading, locked, error, and migration states.
- Inline validation that does not shift layouts unexpectedly.
- Command/search-first navigation.
- Clear item-kind icons and security-state badges.
- Accessible 32–36px minimum compact controls where space permits.
- Keyboard-visible row actions and focus rings.
- `prefers-reduced-motion` support.
- Local font bundling.
- A simplified flat ShardPass mark aligned with the coral in-product identity; the existing glossy blue icon is not used as the main UI language.

Dark mode is the required initial theme. Tokens must be structured so a complete light theme can be added later, but Project 0 must not ship an incomplete automatic inversion.

### 7.4 Critical screen behavior

- **Setup:** Communicate local encryption, recovery responsibility, and migration detection without overwhelming the user.
- **Locked:** Fast password unlock, explicit lockout timing, keyboard submit, and room for later biometric unlock.
- **Popup unlocked:** Current-site suggestions first, then recent/favorite OTP and login items; no full vault dump.
- **Vault list:** Search, type filter, favorites, archive/trash boundaries, and metadata density consistent with existing account rows.
- **Item detail:** Secrets concealed by default, copy/reveal with clear feedback, exact origin policy visible rather than hidden in advanced settings.
- **Save/update prompt:** Small, anchored, editable, and explicit about which origin and item will be changed.
- **Autofill picker:** Origin-aware, keyboard navigable, isolated in Shadow DOM, and visually distinct from the host page.
- **Dangerous actions:** Coral is not used for destructive actions; destructive actions use red and require context-appropriate confirmation.

### 7.5 Accessibility

- Meet WCAG AA contrast for meaningful text and controls.
- Avoid using color alone for lock, sync, warning, and destructive states.
- Provide labels and accessible names for icon-only actions.
- Preserve logical focus when dialogs, sheets, and anchored prompts close.
- Support keyboard navigation across item lists, menus, fields, and picker suggestions.
- Announce copy, fill, save, sync, and error results through appropriate live regions without announcing secrets.
- Verify popup behavior at browser zoom and with longer localized labels.

## 8. Messaging and data contracts

All runtime messages are discriminated, versioned, and runtime-validated. A message defines:

- Message version and command kind.
- Allowed sender context.
- Request schema.
- Response schema.
- Whether an unlocked session is required.
- Whether origin/frame revalidation is required.
- Redaction behavior for errors.

Privileged commands reject unknown fields where possible. Content-script requests cannot invoke general vault export, bulk listing of secrets, key operations, migration control, or Ente credential access.

## 9. Error handling and resilience

Errors use stable internal codes and user-safe messages. Expected categories include:

- Locked or expired session.
- Invalid password and throttled retry.
- Corrupt or unsupported vault version.
- Migration validation failure.
- Storage quota or interrupted write.
- Invalid runtime message.
- Origin mismatch or insecure context.
- Ambiguous capture/fill target.
- Unsupported field/frame context.
- QR/import parsing failure.
- Ente authentication, network, crypto, API, or conflict error.

No error string may interpolate passwords, OTP seeds, full decrypted items, recovery material, or exported data. Unexpected errors preserve local encrypted state and provide an actionable retry/export path where possible.

## 10. Testing strategy

### 10.1 Unit tests

- Domain schemas and migrations.
- Origin normalization and every match level.
- IDN, port, scheme, iframe, IP, localhost, and registrable-domain boundaries.
- Password/passphrase/username generation constraints.
- TOTP/HOTP/Steam known-answer vectors and rollover behavior.
- Ente adapter projection rejection for non-OTP items.
- Message authorization and redaction.

### 10.2 Integration tests

- Create, unlock, lock, rotate password, and interrupted writes.
- Existing-vault migration success, retry, rollback, and malformed input.
- CRUD and search through encrypted storage.
- OTP import/export and Ente pending-operation behavior.
- Capture candidate to save/update commit.
- Metadata suggestion to selected-field release.

### 10.3 Browser tests

Use local fixture sites for:

- Standard login and registration.
- Password change.
- Multi-step login.
- Single-page-app navigation.
- React-controlled inputs.
- Same-origin and cross-origin iframes.
- Hidden honeypot fields.
- HTTP downgrade.
- Similar-looking and punycode domains.
- Multiple accounts and ambiguous forms.
- OTP-only and login-plus-OTP flows.
- Lock during picker/save-prompt interaction.

Visual regression checks cover the popup, vault, setup, locked state, account/item rows, dialogs, save prompt, and autofill picker at representative sizes.

### 10.4 Security release gates

Projects 0–2 cannot be called complete until:

- Build and tests pass from a clean checkout.
- Migration fixtures preserve expected OTP behavior.
- Import/export tests prove round-trip behavior for supported Project 1 data.
- Manifest permissions and CSP are reviewed.
- Dependencies are audited.
- No secrets appear in logs, snapshots, test output, or accessible labels.
- Threat model and security invariants match implementation.
- Autofill refuses documented unsafe contexts.

Hosted sync, passkeys, and sharing require separate external security review gates in their own projects.

## 11. Acceptance criteria for Projects 0–2

1. A reproducible, maintainable TypeScript MV3 extension project replaces direct dependence on minified bundles.
2. The extension can identify and safely migrate an existing ShardPass vault without deleting the source before verification.
3. Existing TOTP, HOTP, Steam, import, QR, autofill, lock, and Ente OTP workflows meet documented parity tests.
4. Users can create, edit, search, delete, generate, capture, and fill login credentials from the typed encrypted vault.
5. Exact HTTPS origin is the default login policy, with explicit safe broadening controls.
6. Password fill is user-initiated by default and blocked in documented unsafe contexts.
7. Popup, full-page vault, and in-page picker share a coherent modern design system derived from ShardPass's existing theme.
8. Accessibility, reduced motion, keyboard navigation, and meaningful contrast are verified.
9. Runtime messages, storage, imports, and migrations use explicit runtime validation.
10. Tests and security documentation establish the baseline for Projects 3–8.

## 12. Explicit non-goals

Projects 0–2 do not include:

- Hosted or self-hosted generalized vault sync.
- Synchronizing passwords through Ente Auth.
- Passkey creation or assertion interception.
- Sharing, family vaults, or emergency access.
- Email-forwarding infrastructure.
- Dark-web monitoring.
- Attachments and arbitrary documents.
- Organization administration, SSO, SCIM, SIEM, PAM, or secrets injection.
- Automatic form submission.
- Regex or arbitrary-script origin matching.
- Claims of formal security certification or audit before one occurs.
