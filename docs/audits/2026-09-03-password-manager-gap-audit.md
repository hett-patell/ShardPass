# ShardPass gap audit — 2026-09-03

Scope: what leading password managers ship in 2026, where ShardPass stands, what it is
losing on most, and a brief ordered plan. Evidence is from source reads, an end-to-end
Node reproduction of the import path, and web research (sources at the end).

## 1. Feature baseline vs ShardPass

| Capability | 1Password | Bitwarden | Proton Pass | KeePassXC | ShardPass |
|---|---|---|---|---|---|
| Item types | ~20 categories | login/card/identity/note/SSH | login/alias/card/note/identity/password | free-form | 6: otp, login, note, card, identity, secret |
| TOTP on a login | yes | yes | yes | yes | **no** — separate OTP item linked by `linkedOtpId` |
| Custom fields | yes | yes (+ linked) | no | yes | **no** |
| Password history | yes | yes | yes | yes | **no** |
| Per-URL match mode | — | base/host/starts/exact/regex/never | — | — | **base-domain only** |
| Passkeys | yes | yes | yes | yes | **no** |
| Autofill: login | yes | yes | yes | yes | yes (password-field anchored) |
| Autofill: multi-step / username-only page | yes | yes | yes | yes | **no** |
| Autofill: card / identity | yes | yes | yes | — | **no** |
| Save prompt | yes | yes | yes | yes | yes |
| Update-on-change prompt | yes | yes | yes | yes | **no** |
| Fill / copy from popup row | yes | yes | yes | — | **no** (row only opens vault) |
| Health: weak / reused | Watchtower | reports | monitor | health check | **no** |
| Health: exposed (HIBP) | yes | yes | yes | yes | **no** |
| Inactive-2FA report | yes | yes | — | — | **no** |
| Generator | yes | yes | yes | yes | yes (random + passphrase) |
| Folders / collections | yes | yes | yes (2026) | groups | schema only — **no CRUD UI** |
| Archive / trash | yes | yes | yes | recycle bin | schema only — **no UI** |
| Attachments | yes | yes | premium | yes | **no** |
| Import breadth | many | 50+ | many | CSV/1PUX/BW | Chrome, Firefox, Bitwarden, 1P CSV, KeePass KDBX4, otpauth, backup |
| Export | CSV/1PUX | CSV/JSON/enc | CSV/JSON/PGP | CSV/XML/HTML | **encrypted backup only** |
| Clipboard auto-clear | yes | yes | yes | yes | **no** |
| Keyboard command (fill) | yes | yes | yes | yes | **no** (`commands` absent from manifest) |
| Context menu | yes | yes | yes | — | **no** |
| Theme toggle | yes | yes | yes | yes | **system only** — `data-theme` unwired |
| Auto-lock | yes | yes | yes | yes | yes |
| Biometric / PIN unlock | yes | yes | yes | Quick Unlock | **no** |
| Sync | cloud | cloud | cloud | file | OTP-only via Ente (by design) |

Out of scope for a local-first extension and deliberately not counted: email aliases,
emergency access, sharing, SSH agent, CLI.

## 2. Findings, prioritised

### P0 — trust, correctness, data loss

**F1. Import failures are opaque.** `vault/components/forms/submit-item.ts` collapses every
`item.create` outcome to `{status:"error"}`; `ImportDialog` then shows only
"N item(s) could not be imported". The user cannot tell which item failed or why.

An end-to-end reproduction (real `installBackground` on `FakeExtensionPlatform`,
`vault.setup`, KeePass fixture through `importKeePassKdbx`, one `item.create` per item)
imported **100%** including the OTP and the login that links to it — so the path itself
is sound. A real vault fails only on content the client validation passes but the
schema rejects. Most plausible triggers, in order:

- **Tags must be unique after NFKC + case-fold** (`item-metadata.ts:24`). KeePass tags
  `Work` and `work` on one entry → `ITEM_INVALID`.
- **Password ≤ 4096 chars.** An SSH/PGP key pasted into the KeePass *Password* field is
  classified as a login (the PEM check only inspects custom fields and notes) → rejected.
- **Login notes ≤ 8192** after `appendCustomFields` folds every custom field in.
- Worker timeout (120 s) on very high Argon2 cost, or a wrong password — both already
  surface a message, so less likely to read as a bare "import failure".

**F2. Import is O(N²) and non-atomic.** `packages/storage/src/vault-repository.ts
create()` loads, re-encrypts and rewrites the *whole* vault per item; `ImportDialog`
calls it per row. 500 entries ⇒ 500 full-vault re-encryptions and 500 storage writes,
and a partial vault if the tab closes mid-way. No batch route exists.

**F3. No duplicate detection.** Re-running any import duplicates every item.

**F4. `linkedOtpId` has no referential integrity.** Deleting the OTP leaves a dangling
link; `LoginDetail` tolerates it, exports/health checks will not.

**F5. Browser compatibility** — two Brave-only breaks were found and fixed this week
(`MessageSender.documentId` absent; `storage.local.setAccessLevel` absent below
Chromium 132). No further Chrome-only API use was found in the audit.

### P1 — gaps users hit on day one

**F6. Login item is thin.** `login-item.ts`: name, username, password, urls,
linkedOtpId, notes. No inline TOTP secret, no custom fields, no password history, no
per-URL match mode, no "never autofill", no passkey slot. Card lacks brand; identity
lacks middle name, company, DOB, address line 2, passport/licence/SSN numbers.

**F7. Autofill is 109 lines.** `packages/autofill`: detects only `input[type=password]`
and walks backwards for a username; no username-only/multi-step page support; no use of
`autocomplete` tokens; no card or identity fill; no iframe/nested shadow-root traversal;
domain match strips `www.` and compares suffixes with no public-suffix list. Content
script offers `login.saveOffer` but there is no update-on-change offer.

**F8. Popup cannot act.** `PopupLoginRow` only opens the vault — no fill-active-tab,
copy username, copy password, or open URL. This is the most frequent daily action.

**F9. No security reports.** Nothing for weak, reused, exposed (HIBP k-anonymity) or
inactive-2FA. All can run locally.

**F10. Organisation is schema-only.** `folderId`, `archivedAt`, `deletedAt` exist and
the sidebar lists folders, but there is no create/rename/move/delete, no archive, no
trash/restore.

**F11. Export is encrypted-backup only.** No CSV/JSON, nothing 1Password can import.

**F12. Hygiene basics missing.** `CopyButton` writes the clipboard and forgets it (no
auto-clear); no `commands` keyboard shortcut; no context menu; no badge.

### P2 — UI and aesthetics

**F13. Two design languages coexist.** The Task 4 redesign restyled the new surfaces
only. Eight components still render brutalist "kicker" labels — `LOCAL INPUT / SAFE
PREVIEW`, `SESSION / LOCKED`, `DESTRUCTIVE / REVISION BOUND`, `ENCRYPTED INDEX / OTP`,
`VAULT / OTP` — and 32 uppercase/letter-spaced style hits remain. Five CSS modules carry
35 hard-coded colours outside `tokens.css` (`OtpImportView`, `MigrationPanel`,
`picker.css`, `OtpList`, `primitives`). The OTP-era screens (`OtpVaultView`,
`OtpEditor`, `OtpList`, `OtpImportView`, `MigrationPanel`) were never restyled.

**F14. Jargon in user-facing copy.** "Foundation unavailable", "REVISION BOUND",
"ENCRYPTED INDEX".

**F15. Theme is system-only.** `prefers-color-scheme` works; `data-theme` toggle is not
wired; no setting exists.

**F16. States.** Single empty state ("No items match the current filters"); no skeleton
or loading states in lists; dialogs are custom rather than native `<dialog>` (the
modern-web-guidance baseline recommends `<dialog>` with `closedby` for light-dismiss).

**F17. Settings surface** is a single "Encrypted backups" panel.

### P3 — engineering quality

- 1,979 tests across 156 files; zero TODO/FIXME. Two pre-existing 5 s-timeout flakes
  (`project1-secret-scanner`, `importers/backup`) under parallel load.
- Content script is `<all_urls>`, `all_frames`, `document_idle` — acceptable; a lazy
  start on first password field would cut cost.
- Ente boundary (OTP-only) is intact.

## 3. Where ShardPass is losing most, ranked

1. **Autofill depth** — multi-step pages, card/identity, update prompt, match modes, passkeys.
2. **Login item richness** — TOTP-on-login, custom fields, history.
3. **Import/export trust and breadth** — per-item reasons, batch commit, dedupe, CSV/JSON/1PUX.
4. **Security reports** — weak/reused/exposed/inactive-2FA.
5. **Organisation** — folders, archive, trash.
6. **Daily ergonomics** — popup actions, shortcuts, context menu, clipboard clear.
7. **Visual coherence** — finish the redesign; remove kickers and jargon; theme toggle.

## 4. Plan (brief, ordered)

Sizes: S ≈ a day, M ≈ several days, L ≈ a week-plus.

| Phase | Scope | Size |
|---|---|---|
| **A. Import trust** | Per-item failure reasons in the preview and summary; classifier clamps to schema limits and reports what it clamped; PEM-in-password → secret; case-fold tag dedupe; duplicate detection on (kind, name, username, first URL); `item.createMany` batch route with a single commit and per-item report; progress indicator. | M |
| **B. Login model v3** | Custom fields (text / hidden / boolean / linked); inline TOTP secret on login while keeping linked OTP; password history (last N, timestamped); per-URL match mode; `schemaVersion` 3 migration. Extend card and identity fields. | M |
| **C. Autofill** | Username-only and multi-step detection; `autocomplete` tokens; iframe and nested shadow-root traversal; public-suffix-aware matching; update-on-change prompt; card and identity fill; popup fill/copy/open row actions; `commands` shortcut; context menu. | L |
| **D. Security reports** | Local weak (zxcvbn-class scoring), reused, exposed via HIBP range API (opt-in, k-anonymity), inactive-2FA against a bundled list; a Reports screen with fix-it links. | M |
| **E. Organisation and UI** | Folder CRUD and move; archive and trash with restore; theme toggle; restyle the OTP-era screens to tokens; delete kickers and jargon; native `<dialog>`; empty, loading and error states; clipboard auto-clear. | M |
| **F. Export and 1Password** | CSV and JSON export; 1Password-importable CSV; 1PUX import; surface encrypted backup under Export. | M |
| **G. Passkeys** | WebAuthn interception in the content script, credential storage, conditional UI. | L |

Suggested order: **A → B → C → E → D → F → G.** A removes the trust problem found
today; B is a prerequisite for C's TOTP and custom-field fill; E is cheap coherence that
compounds every later screen.

## Sources

- https://cybernews.com/best-password-managers/proton-pass-vs-1password/
- https://guptadeepak.com/tools/top-10-password-managers-2026/
- https://tech-insider.org/proton-pass-vs-bitwarden-vs-1password-2026/
- https://www.techradar.com/versus/1password-vs-dashlane
- https://bitwarden.com/help/uri-match-detection/
- https://bitwarden.com/help/auto-fill-custom-fields/
- https://bitwarden.com/help/integrated-authenticator/
- https://bitwarden.com/help/reports/
- https://1password.com/features
- https://1password.com/features/watchtower-identifies-security-risks
- https://www.1password.dev/watchtower
- https://proton.me/blog/pass-roadmap-spring-summer-2026
- https://proton.me/support/pass-browser-extension
- https://cyberinsider.com/password-manager/reviews/proton-pass/
- https://keepassxc.org/blog/2020-08-15-keepassxc-password-healthcheck/
- https://github.com/keepassxreboot/keepassxc
- https://1password.com/blog/1password-product-enhancements-smarter-autofill-phishing-prevention
- https://www.security.org/password-manager/best/chrome/
