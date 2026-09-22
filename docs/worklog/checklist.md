# Work checklist

Kept current by the assistant while working; one line per item, newest run first.

## 2026-09-16 · Whole-codebase audit (read-only agents, two at a time)

Baseline at 2.3.0: typecheck clean, lint clean after one test fix, full suite green apart from the known slow scanner test.

- [x] 1 Background services, messaging, router — 10 findings (1 high, 4 medium, 5 low), listed below
- [x] 2 Vault page UI — 27 findings (2 high, 10 medium, 15 low), listed below
- [x] 3 Content scripts, autofill, passkeys — 15 findings (2 high, 9 medium, lows), listed under batch D
- [x] 4 Importers, samples, crypto helpers — fixed as batch C (2.4.2)
- [x] 5 Popup, platform, manifest, CSP, build scanner — 10 findings (1 high, 5 medium, lows), listed under batch E
- [x] 6 Tests and tooling — run 2026-09-16; findings shipped as batch F
- [x] Fix batch A (background, security first), with tests — verified: typecheck clean, background/messaging/vault/popup/content suites green, lint clean. A6 (username suggestion budget), A9 (comments) and the OTP-service re-prompt unit test followed in later commits.
- [x] Fix batch B (vault UI), with tests — done except B20 (handleCreated edge cases), B22 (navigating away from a create form), B24 (deleting the filtered folder from another view), B26 (unverified dialog desync); B13 was already NBSP.
- [x] Re-run gates, commit, bump — batch A shipped as 2.3.1, batch B and the passkey change as 2.4.0
- [x] Google sign-in: answer conditional (page-load) passkey requests with ShardPass's own prompt; a locked vault stays quiet there
- [x] Batch C (importers): Bitwarden fields/reprompt/clamps, KeePass lookup order, KDBX bounds, Dashlane caps, LastPass leftovers, Proton timestamps, generic mapping, ragged CSV, UTF-16 clamps, per-field sample checks — 2.4.2
- [x] Passkey prompt given room to breathe (wider host, larger title, taller rows and buttons) — 2.4.2
- [x] Batch D (content scripts, autofill, passkeys) — shipped in 2.4.3; D5's frame check is verified by reading (jsdom cannot frame a document)
- [x] Batch E (popup, platform, gates) — shipped in 2.4.3; E1 (clipboard auto-clear) followed in 2.4.4; E9 (narrow popup fill race) left open
- [x] Audit 6 (tests and tooling) — 15 findings; fixes are batch F below
- [x] Google "Create a passkey": the page script answers isUserVerifyingPlatformAuthenticatorAvailable / isConditionalMediationAvailable / getClientCapabilities as a platform authenticator, so Google calls create() on desktops without one (2.4.1)

### Batch A · background (verified by the audit)

- [x] A1 high · `login/data-fill-service.ts` select(): a card/identity grant is bound to the tab only, so any iframe (content scripts run in all frames) can win the single-use release and receive number + CVV. Require `sender.frameId === 0`; make `content/data/data-fill-controller.ts` answer only in the top frame and detect fields before asking.
- [x] A2 medium · `login-fill-service.ts` offer(): `existing === "same"` is a password-correctness oracle for scripts on the registrable domain (no banner = correct guess). Throttle per domain (more than 5 evaluations a minute → answer as unknown).
- [x] A3 medium · reprompt grants survive the Lock button and every fail-closed lock (only `main.ts lockAndPublish` clears them). Register `sessions.onLockOrDispose(() => repromptGrants.clear())`; clear data-fill grants too; fix the comment in `reprompt-grants.ts`.
- [x] A4 medium · `item/item-service.ts redactSecrets`: OTP items come back unredacted and identities keep passport, licence and national id. Blank them; gate `otp.getCode` / `otp.getEditor` on the reprompt grant.
- [x] A5 medium · the PIN wrap survives a master-password change (same DEK). Remove `shardpass:v1:pin` in `changePasswordInternal`, tell the UI, and say in the PIN copy that a copy of the profile allows offline PIN guessing.
- [x] A6 low · `login.suggestUsername` hands the plus-address and mints Duck addresses on the content script's request without a rate limit.
- [x] A7 low · `alias-service.ts` maps every seal/open error to VAULT_LOCKED; `forgetDuck` overwrites an unreadable list with `[]`; `listDuck` answers `[]` while locked.
- [x] A8 low · `packages/messaging/src/vault.ts` lockMinutes accepts 0..1440 while the service takes only 0/5/15/30/60.
- [x] A9 low · `login.fillSuggestions` schema requires `domain`/`pageUrl` that the service never reads; `router.ts` documents `error.detail` as Ente-only but startup sets it too.
- [x] A10 low · session hygiene: `this.dek` reassigned without wiping in `unlockInternal` and `unlockWithPin`; `sealSecret`/`openSecret`/`captureBackupSession` pass `assertEpoch` after `beginLock` bumped the epoch (add a pending-lock flag); a storage error inside `unlockWithPin` counts as a wrong PIN; breach checks read reprompt-protected passwords without a grant.

### Batch B · vault UI (verified by the audit)

- [x] B1 high · `OtpDetail.tsx`: "Delete OTP" in edit mode does nothing; the dialog only renders in the view branch, so it pops up after Cancel.
- [x] B2 high · `VaultAccess.tsx`: change-master-password errors and the lock failure are set but never rendered in the unlocked branch; success shows nothing.
- [x] B3 medium · `useModalDialog.ts`: `dialog.close()` runs after unmount, so focus drops to body when a dialog is dismissed by button (DetailActions cancel, passkey cancel, PasswordGeneratorDialog).
- [x] B4 medium · `Form.module.css`: `.select` gets `width: 100%` inside `.listRow`, squeezing the sibling input (LoginForm URL/custom-field rows, SecretForm key row).
- [x] B5 medium · `item-support.ts itemDisplaySubtitle`: a note's first line is shown in the clear in lists, the overview and the import preview.
- [x] B6 medium · Overview (quick estimator) and Health (zxcvbn) disagree on weak counts and the score.
- [x] B7 medium · opening an item from Health/Overview keeps category, folder and search, so the selection points at a hidden row (`VaultApp.tsx` onOpenItem handlers; the hash route resets).
- [x] B8 medium · `HealthGauge` needs `aria-valuetext`; the caption and number are presentational inside role="meter".
- [x] B9 medium · focus lost after archive/restore (OrganizeControls), folder rename/create (VaultSidebar FolderNameInput), and cancelling or saving a create form (VaultApp).
- [x] B10 medium · `useOtpLiveCode.ts`: an error shows "Loading code…" forever; an already-expired code re-polls every 250 ms.
- [x] B11 medium · Backup card: Escape anywhere clears the typed passwords and discards a decrypted preview (`BackupView.tsx` → `useBackup.ts`).
- [x] B12 medium · empty master password runs a full Argon2 derivation and counts against the throttle (`VaultAccess.tsx` locked path).
- [x] B13–B25, B27 low · Move select indentation uses plain spaces (collapsed in `<option>`); B14 `.value`/`.rowValue` need `white-space: pre-wrap`; B15 empty state offers "Add a login" in every category; B16 two `aria-current` entries in the Archive view; B17 folder tree misuses role="tree"; B18 stale `linkedOtpId` re-saved; B19 OTP edits reset on any refresh; B20 `handleCreated` edge cases; B21 CopyButton has no live region; B22 sidebar navigation discards an in-progress create form; B23 BreachCheckRow shows "Not checked yet." on a failed listing; B24 deleting the filtered folder from another view jumps to the vault; B25 weak count shown while judging; B26 (unverified) locked dialog can desync from React on a second Escape; B27 dead CSS (`.folderItemActive`, `.empty`, `.fieldFull`, `.labelRow`, `.labelActions`, `.listAdd`).

### Batch F · tests and tooling (verified by the audit)

- [x] F1 high · the only gate that scans production source for secrets was red (`PRODUCTION_SOURCE_MANIFEST_CLOSURE_INVALID`, a manifest that predated a dozen services) and was not in `pnpm verify`, so nothing scanned it at all. Manifest regenerated (476 files), three noisy rules tightened so the scan passes honestly, and the chain now runs first in `build:security` and in `verify`.
- [x] F2 high · `console.error` and `console.warn` shipped with no gate. They are now reported outside the vendored bundles that log on their own account, and the generated content-script loader no longer prints ShardPass failures into every page.
- [x] F3 high · a test wrote `.shardpass-executable-audit.json` into `dist`, and the policy read that file to grant an exemption: the shipped artifact carried its own waiver, and a standalone `node scripts/scan-build.mjs` failed without it. The allowance is now derived from the artifact (exactly one chunk may carry the protobuf text-encoding module, and it must be the Google-migration worker entry); a dropped waiver file grants nothing.
- [x] F7 · the secret scanner missed credentials inside a URL and JSON Web Tokens; both are now rules. The PEM rule requires a base64-only body, so code that merely names the markers is no longer a finding.
- [x] F8 · the reproducible-build gate compared two scratch builds to each other and never looked at `dist`; it now compares the working artifact too.
- [x] F12 · no licence or new-dependency gate existed. `config/runtime-dependencies.json` pins all 18 external runtime dependencies with their licence and why they are there; adding one, or a licence changing, fails `tests/security/runtime-dependencies.test.ts`, and nothing copyleft may enter.
- [x] F13 · `pnpm verify` ran the tests that read `dist` before the build that writes it; it now builds first.
- [x] F14 · the build-output security step used vitest's default `passWithNoTests`, so a renamed glob would have turned it into a silent no-op.
- [x] F15 · two background suites raced real work against a 250 ms wall clock; the deadline is now one only a hang can miss.
- [x] F4 · the Ente graph's eight constraints were hardcoded `true`; the generator now reads each one off the chunks (Chrome and storage terms included) and refuses to emit a compliant manifest for a graph that breaks one. Proven by planting `chrome.storage` in the entry chunk.
- [x] F5 · `docs/architecture/permissions.md` claimed three permissions, no host permissions and an inert content script. It now describes the seven permissions, two hosts, three network origins and four controllers that exist, and the test derives its assertions from the manifest instead of restating them.
- [x] F6 · the boundary test covered 6 of 18 sender policies; it now enumerates every exported policy, pins each family's audience, and fails if any command a content script must not reach starts allowing one.
- [x] F9 · release steps pinned only their ids, so a step could keep its name while its command was swapped; both are pinned now.
- [x] F10 · the 14-scan secret-scanner test is split per case with honest timeouts, and resolves its config paths from the module rather than the working directory.
- [x] F11 · two workspace tests wrapped their whole bodies in a Node 24 check and asserted nothing on the supported runtime; both now assert the behaviour they actually get.
- [x] Fixed in 2.6.0: the tree was reformatted and the assistant's scratch directories ignored, so `pnpm format:check` passes again.

### Batch D · content scripts, autofill, passkeys (verified by the audit)

- [x] D1 high · `packages/autofill/src/domain-match.ts` + `equivalent-domains.ts`: hosting-tenant hosts (myshopify.com, digitaloceanspaces.com, force.com, azurewebsites.net) and missing multi-label suffixes (co.il, com.pl, co.th, com.pt, co.at …) hand logins to attacker-registrable hosts; the autofill and passkey suffix lists disagree.
- [x] D2 high · `detect-login-fields.ts isVisible`: only the input's own style is read; an input in a `display:none` wrapper counts as visible (zero rect escape hatch), so honeypots become the username field.
- [x] D3 medium · `login-fill-controller.tsx onPickerKeyDown`: synthetic (untrusted) key events drive the open picker and complete a fill.
- [x] D4 medium · `save-login-prompt.tsx`: untrusted submit/click events with page-chosen values reach the save/update offer.
- [x] D5 medium · passkey ceremonies answered inside cross-origin iframes with `crossOrigin:false`; the bridge never checks it is the top frame.
- [x] D6 medium · https logins offered and auto-submitted on http pages; http captures saved as https.
- [x] D7 medium · un-hinted change-password forms (three password fields) get the generated password in the current-password field too.
- [x] D8 medium · any visible `type=email` input in a form with a submit is a "username-only step": newsletter/search forms get the sign-in banner and a submit.
- [x] D9 medium · passkey bridge: malformed request wedges `activeId`; a modal request during a pending conditional one always falls back; the page-side timeout never cancels the bridge.
- [x] D10 medium · rescans: shadow roots observed for the page lifetime, class/style mutations trigger full scans, `body.textContent` read on every rescan of a page without fields.
- [x] D11 medium · data fill takes the first matching field in DOM order without a visibility check; `user_name` matches fullName before username.
- [x] D12 low-medium · `isRendered` accepts opacity:0 / clipped forms for the popup fill and the banner.
- [x] D13 low · a VAULT_LOCKED prompt can appear for a dead ceremony id and cannot be dismissed.
- [x] D14 low · `owns()` needs `location.href` equality; Escape from a synthetic keydown dismisses the prompt; `startsWith` matches `/app` against `/application`; `expYear` ignores `maxLength`; `offered` keeps plaintext passwords for the page lifetime; bridge acks before validation; dead code (`field-discovery.ts` never started, FoundationPicker default content, `.passkeyPrompt` was unused — now used).

### Batch E · popup, platform, gates (verified by the audit)

- [x] E1 high · popup clipboard auto-clear never fires: the timer dies with the popup and `document.hasFocus()` is false. Needs an alarm-driven clear through the active tab's content script. Fixed in 2.4.4: the due time is written down and the next ShardPass document to open or regain focus carries the clear out; a clear more than ten minutes past due is dropped rather than wiping what was copied since. Without a clipboard permission, a person who never opens ShardPass again still keeps the value.
- [x] E2 medium · `PopupApp.tsx`: `grantedRef` and the reprompt overlay survive a lock; after unlock a granted item shows "Password unavailable".
- [x] E3 medium · DetailScreen's own reprompt does not tell PopupApp, so "Fill in host" asks for the master password again.
- [x] E4 medium · "Reopen where you were" is dead: the reset effect runs before the restore effect; `readLastScreen` accepts any category string.
- [x] E5 medium · scanner "no console transport" covers only log/info/debug; `diagnostics.ts` comment claims more than the gate enforces.
- [x] E6 medium · the whole background chunk is exempt from the network-destination rule in `scan-build.mjs`.
- [x] E7 low · context-menu fill drops `frameId`; `chrome.action.openPopup` needs Chrome 127 (min is 111) and its failure is swallowed.
- [x] E8 low · `LiveCode.tsx` puts the live TOTP code in an `aria-label`.
- [x] E9 · `login.fillFromPopup` first-answer race across frames, closed in 2.8.1. The tab hands the request to every frame and keeps the first answer; one of the four negative paths already waited a moment so a filling frame could answer first, and the other three did not. All of them wait now, with a test.
- [x] E10 low · dead `useOtpList.ts`; stale scan-build/manifest-test comments; GeneratorScreen's deferred settings fetch overwrites what was typed and requests a username per keystroke.

## 2026-09-22 · Last pass: is every feature current? (2.8.3)

Version 2.8.2, clean tree, in sync with origin, all three CI jobs green.

- [x] Drove the built extension in a real browser twice. Everything works and nothing logged an error: create vault 1,887 ms, import 163 ms, all nine views render, reveal 469 ms, search, lock and unlock 1,328 ms, popup 124 ms, create login, create folder, set a PIN, create a one-time code and watch a live six-digit code, and the content script attaching over http and drawing its chip on focus.
- [x] Two flags from the first sweep were my own harness, not the product: I searched the New item menu for "One-time code" when it said "OTP", and served the fill fixture over `file://`, which an unpacked extension may not inject into. Re-run over `http://127.0.0.1:4173` with the menu's own wording, both pass.
- [x] But the first of those **was** a real finding, pointing the other way: the sidebar, the popup and the project's own `KIND_LABELS` all say "One-time code", while the New item menu said "OTP", the editor said "Create OTP" / "Edit OTP", and its save button said "Save OTP" / "Save changes" where every other form says "Save". A user reads one name in the list and hunts for another in the menu. All four now match the rest of the interface. TOTP and HOTP stay -- those are algorithm names, not the category.
- [x] Checked the claims the interface and the store listing make against the code: Argon2id 64 MiB / two passes ✓, five wrong PINs (`MAX_PIN_FAILURES = 5`) ✓, permissions and hosts consistent across the manifest, `docs/architecture/permissions.md`, the listing and the privacy policy ✓. One was wrong: About said imports come from "Chrome, 1Password, Bitwarden, LastPass and eight more" when there are thirteen formats besides restoring your own backup. Now "nine more"; the listing's "thirteen formats" was already right.
- [x] Found why the four quarantined one-time-code specs rot: `git log -S` puts it at 932754d (2026-09-03), which replaced a standalone OTP view -- its own "Create OTP" button, "Search OTP items" searchbox, "OTP items" listbox -- with the unified item list and the New item menu. They had been asserting against a removed interface ever since.
- [x] Their shared create helper now drives the current flow, and creation passes again in all four (verified by running `project1-otp-crud`: it gets past creating three codes to the searching built on the removed listbox). The quarantine comment in `playwright.config.ts` now names the cause per file instead of "the current interface arranges differently".
- [ ] **Left open, deliberately:** the rest of those specs -- searching, selecting and editing through the old OTP view -- needs rewriting against the unified list, not patching. `project1-migration` fails separately: it hits the migration worker's fixed 120 s fail-closed timeout under browser contention and its retry path fails too. Both want a session of their own.
- [x] Gates: typecheck, lint, format, `build:security`, 2,478 tests in 230 files, all green. No CI-running spec references the renamed strings, so the passing subset is untouched.

## 2026-09-17 · The browser specs had rotted, and CI found them

- [x] The first pipeline run failed, and what it caught was not the workflow: `pnpm verify` is not environment-free. `tests/browser/startup-process-harness.test.ts` spawns a real Chromium and `tests/tooling/project1-network-runner.test.ts` asks for actual network isolation. The gates job installs Playwright's Chromium and bubblewrap, sets `kernel.apparmor_restrict_unprivileged_userns=0` (this machine has it off, which is why the isolation test always passed here), and proves the sandbox blocks the network in one line before the suite runs -- that probe caught `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` immediately instead of burying it in a test log.
- [x] **The Playwright specs had been failing for a long time and nobody knew**, because they are in neither `pnpm test` nor any pipeline. Twenty failures, two causes: twelve waited on the `Vault unlocked` heading as the signal that unlocking had finished -- `git log -S` traces that to my own 2.6.8 commit, which moved the heading into the Settings panel where it renders hidden -- and six waited for `Foundation ready`, a string that no longer exists in the source at all.
- [x] Repaired: shared helpers that name today's interface (`expectVaultUnlocked` waits for the shell, `lockVault` opens Settings, `expectVaultReady` reads the header badge, `openEnteSync` opens the view Ente now lives in); the smoke spec no longer assumes a vault already exists, since a fresh profile offers to create one on both surfaces.
- [x] CI runs the eleven specs that pass, in 29 seconds. `playwright.config.ts` names the seven files left out and why, each as work rather than a decision to stop caring. They still run locally.
- [x] `retries` on CI is 1, not 2: three retries of a genuine three-minute timeout is nine minutes of runner time for no new information. The browser job was cancelled at sixty minutes twice before this.
- [ ] **Left open, and possibly a real bug:** the Ente matrix spec now gets through connect and two-factor and is answered "disconnected" by its own strict mock. That is either mock drift or something genuinely broken in Ente connect. It needs a session of its own; nudging the locator until it goes green is how this suite rotted.
- [ ] The visual specs compare pixels and this project ships no fonts -- it renders with whatever the machine has -- so two Linux machines disagree about a baseline the snapshot path calls "linux". They belong to local review; pinning fonts in CI would be the alternative.

## 2026-09-17 · A commit wrote once per journal entry (2.8.2)

- [x] Measured the mutation path in Node, where the storage port is in memory: one update on a 1,000-item vault costs 831 ms of our own work but **1,067 storage operations, 1,011 of them writes**. Records were batched 256 to a call; the journal was not, and a vault carries up to 4,096 entries. In a browser every one of those writes is a message to another process, which is where the browser's 3.2 s against Node's 0.83 s went.
- [x] Journal, metadata and receipt writes are batched like the records. Storage operations per commit: 1,067 -> 67, writes 1,011 -> 11. In a real browser on a 1,000-item vault: `item.update` 3,224 ms -> 1,452 ms, import of 1,000 logins 19.5 s -> 9.9 s. `item.query` is unchanged at ~227 ms, as expected.
- [x] The interruption-safety tests had to change, and the reason matters: they fault at every write in a commit, and two of them addressed writes by index. Batching moved the indices, so the fault stopped being injected and the tests passed while testing nothing. They now name the write they mean -- `failWriteToKeyEnding("root", ...)`, added to the fake storage port -- or measure how many writes a commit makes before looping. The property is unchanged: the root write is still last and still alone, which is what makes an interrupted commit leave the old generation whole.
- [x] Still open and named rather than changed: staging re-verifies every record and decrypts every journal entry before writing them, which is most of the ~1.45 ms per item that remains. Whether that belt-and-braces pass is worth keeping on the write path is a decision about the format's guarantees, not a tidy-up.

## 2026-09-17 · Closing the gaps named in "what's lacking" (2.8.0)

- [x] **CI exists.** `.github/workflows/verify.yml`: the gates, the browser specs and the store package, on every push, with the Playwright report kept when a spec fails. The weakest link was that every gate ran only when I remembered to run it.
- [x] **The flaky four are budgeted, not papered over.** Each does work that is slow by nature -- a Vite build, an Argon2 derivation, a scan of every production root -- and the default five seconds is what failed them under contention. Three consecutive full-suite runs now pass clean. Regenerating the secret allowlist afterwards changed only `fileSha256` values for the one file edited: 46 allowances before and after, same paths, lines and value hashes.
- [x] **Autofill no longer rewrites the vault for a timestamp.** Stamps are collected and written together after a few seconds, or before a lock, in one commit rather than one per fill. A test pins that two fills produce one write.
- [x] The dashboard carries the standing truth about backups. A timed "you have not backed up in 90 days" nudge would need a new message kind, new storage and new gate pins for a reminder that cannot be honest about history; the standing line and a button cost nothing and say the true thing.
- [x] The read shape is pinned by a test: one item reads one record's bytes, a list reads each record once. Today's 9x on single reads cannot silently regress.
- [x] `docs/store/` holds listing copy, single-purpose statement, permission justifications, data disclosures, and five 1280x800 screenshots from a real build, plus the recipe for retaking them.
- [x] Reverted my own change: skipping the live re-query when the archive opens. A test documents that the sidebar counts refresh there deliberately, and trading freshness for 230 ms is the wrong way round. The cost belongs to the read path, not to that call.

## 2026-09-17 · Audit of the day's own changes (2.7.7)

- [x] **Found while auditing, not introduced by it: the vault could not be opened at all on a machine Chrome reports as screen-locked.** `chrome.idle.queryState` returns "locked" on this very machine. With the default "lock when the screen locks", that event calls the full lock, and a lock clears every outstanding challenge and bumps the epoch -- which is precisely what the unlock in flight was relying on. Setup and unlock both died with "That secure request expired. Try again.", reproducibly, 3 times out of 3. The automatic triggers (alarm, screen lock, last page closed) now call `lockIfUnlocked`, which passes over a vault holding no key; the shortcut and the button still take the full lock. Both sides are pinned by tests. Verified: creating a vault and unlocking it both work on this machine now.
- [x] Introduced by me and fixed: the strength cache was cleared at three click paths, so a lock that arrived from the background -- the auto-lock, or another page locking -- left every password's judgement in the page's memory. It is cleared on the state transition now, which covers every way the vault can lock, with a test.
- [x] Incomplete fix from 2.7.6, completed: seven further reads still decrypted every record a second time (backup export, portable preview and import, the two Ente one-time-code writes). All now use the items the load produced.
- [x] Shipped rough edge from 2.7.3: `pnpm package` failed on a second run for the same version with a raw `ARCHIVE_OUTPUT_EXISTS`. It replaces its own output and says so.
- [x] Checked and found sound: journal sequence and nonce-uniqueness checks still run after the journal change; `get` still verifies the record it returns; the remaining single-record decrypts on update paths are index-aligned and left alone rather than risk an aliasing bug for 0.05 ms.

## 2026-09-17 · The read path did everything twice (2.7.6)

- [x] Measured the parts first, per 1,000 records: AEAD 43 ms, zod parse 25 ms, canonical hash 20 ms, JSON.parse plus canonical re-check 6 ms.
- [x] `validateVaultRecord` decrypted, decoded, canonical-checked, parsed and match-checked each record -- and returned `void`. `listItems` then called `decryptVaultRecord`, which did all of it again. Every read of the vault paid for every record twice. The verification now returns the item it produced and the repository uses it.
- [x] A read also decrypted every change-journal entry, and a vault keeps up to 4,096 of them, for a payload only `ChangeJournal.listAfter` ever reads. Reads keep the hash, key-binding, sequence and nonce checks and leave the decryption to the caller that wants the plaintext. A test pins that a tampered journal entry is still rejected on read -- by the manifest's hash, which was always the check that caught it.
- [x] On a 1,000-item vault: `item.query` 540-760 ms -> 236-259 ms, `item.get` 235-297 ms -> 25-45 ms across both passes, import of 1,000 logins 24.5 s -> 19.5 s.
- [x] Not done, and now the only lever left of its size: a cache that serves repeat reads from memory. A `VaultRepository` is constructed per operation, so it would have to live across requests, and every version of it trades away some part of "tampering is caught on every read". That is the user's decision, not a detail to slip into a speed pass.

## 2026-09-17 · Showing a password read the whole vault (2.7.5)

- [x] The user reported that passwords and one-time codes take a long time to appear. It was the read path found in the audit, in its most visible form: `VaultRepository.get` loaded the active generation, and loading it authenticates every record in the vault -- hash, schema parse and AEAD per record -- before the one record asked for is decrypted. On a 1,000-item vault that is 235-297 ms per password revealed, and `otp.getCode` pays it twice (once for the item, once for the revision re-check after generating).
- [x] `GenerationStore.readActiveRecord` reads one record with the same rigour applied to it: root read, manifest invariants, manifest hash, manifest authenticated under the data key, the verified marker, then the record's stored bytes checked against the hash the manifest pins, bound to their key, and authenticated. What it no longer does is verify the other 999 records, which this read does not return. Measured on a 1,000-item vault: 35-59 ms, about five times faster.
- [x] The narrowing is deliberate and is pinned by a test: `get` still rejects a tampered manifest and a tampered copy of the record it returns, and still succeeds when a different record is tampered with -- which `listItems` then rejects. One existing test used `get` as its vehicle for proving receipt tampering is caught; it now uses `listItems`, the read that returns receipts, with a comment saying why.
- [x] Correction to the audit: the benchmarks that created items by sending `item.createMany` directly were writing nothing (the payloads failed validation), so the "writes are flat at 6-12 ms whatever the vault holds" line from that run proves nothing. The numbers that stand are the ones taken against vaults built through the real importer.

## 2026-09-17 · Speed audit, measured rather than guessed (2.7.4)

- [x] Measured first. Three hypotheses died on contact: the 2.27 MB service-worker graph costs 6-17 ms to wake, not hundreds of ms; `new Worker()` does not exist in an MV3 service worker, so the plan recorded in 2.6.6 for moving Ente's crypto out of the wake path cannot work as written; and writes are 6-12 ms whatever the vault holds.
- [x] Unlock is ~1.0 s of key derivation: ~880 ms of Argon2id at 64 MiB and two passes, plus ~120 ms to start a worker that loads libsodium. Both are decisions, not defects, and are written up for the user.
- [x] **Every item operation re-reads the whole vault.** On a 1,000-login vault built through the importer, `item.get` for a single item costs 235-297 ms and `item.query` 360-446 ms, while `vault.getState` stays at 3 ms. This is the cost the deferred read cache was meant to remove (see the entry at the foot of this file): a decrypted cache breaks the pinned property that tampering under an unchanged root is caught on every read, and doing it properly means re-verifying the stored bytes by hash on each cached read.
- [x] Fixed: the dashboard and health page each mounted their own strength estimator, unmounted it on the way out, and threw the results away. A shared judgement cache, cleared on lock, takes a second dashboard visit on 1,000 logins from 2,850 ms to 111 ms.
- [x] Fixed: the import preview built a row per line and kept rebuilding it while importing. Capped at 200 rows and hidden during the import; previewing a 1,000-row file went from 482 ms to ~170 ms.
- [x] Left as a finding: opening the archive issues two full queries (the archived list, then the live list for the counts), which on a large vault is twice the wait.

## 2026-09-17 · The item record, the popup's categories, and the store blockers (2.7.2)

- [x] The item detail stacked five all-caps labels over five short values, so a login took twice the height it needed and the name of a thing was set louder than the thing. Label sits beside value now, one row per fact, with a hairline between rows and the folder control on the same grid. One CSS change covers every item kind, since the markup was already uniform.
- [x] A note's body still spans the full width: it is the item, not a value beside a label.
- [x] Edit is the primary action on an item; Delete is a quiet danger button pushed to the far end, rather than standing beside Edit as an equal.
- [x] The popup listed every category including the five reading 0. It lists what the vault holds, with All items always there as the way back.
- [x] **Icons, the store blocker.** The manifest had no `icons` and no `action.default_icon`, so Brave and Chrome showed a puzzle piece and no listing was possible. Four PNGs rendered from the shipped mark (16/32/48/128) ship in `apps/extension/public/icons`, the manifest declares them for both the toolbar and the listing, and the build scanner now checks every declared icon is a packaged `.png` present in the build. Confirmed on chrome://extensions in a real profile.
- [x] `homepage_url` points at the repository, and the description says what ShardPass does instead of "Local-first password manager foundation."
- [x] The manifest key allow-lists in `tests/security/manifest.test.ts`, the built-manifest test and `scripts/scan-build.mjs` were extended deliberately rather than loosened: the new keys are pinned to exact values, and `default_icon` is the only addition permitted inside `action`.
- [x] `docs/privacy-policy.md` written from the actual data flows: what is stored on the device, the three features that can reach the network (HIBP by hash prefix, Ente for OTP records, DuckDuckGo for aliases), what each sends, and the permission-by-permission reasons.
- [x] `CHANGELOG.md` written from the version history.
- [x] The release checklist demanded a permission set from three releases ago (`storage`, `alarms`, `idle` only). Corrected to the seven that ship, with the superseded Task 5 line marked as such, and a store-listing section added.
- [x] Re-pinned the Ente SRP evidence and regenerated the sodium vectors after the scanner change, as that gate requires. All gates green.
- [x] `pnpm package` produces the store upload. The release gate's own archive nests everything under `ShardPass-<version>/`, which Chrome rejects, so the archiver gained a flat mode and the round-trip verifier learned both layouts. The packager snapshots `dist` without freezing it, writes `release/shardpass-<version>.zip`, unpacks it again to prove the identity matches, and prints the sha256. Two runs of the same build give the same bytes.

## 2026-09-16 · The dashboard, health and the generator, redesigned (2.7.0)

- [x] The dashboard reported counts where it should have said what to do. Seven identical tiles, six of them reading 0; the same five findings printed twice, once as a run-on line under the gauge and once as a list beside it; "passkeys available" filed as a defect; and every row opening the same undifferentiated health page.
- [x] It is a triage queue now: findings ordered by what they cost to ignore, each naming the accounts it covers ("Cricbuzz, Docker Hub and 9 others"), each landing on that finding in the health page. Severity reads from the dot and the order, with danger, warning and success tokens kept apart from the vermilion that means "interactive".
- [x] "No second factor" left the queue for a footnote: it matched all 24 logins, so as a row it said nothing about where to start.
- [x] The seven kind tiles became one composition bar in the sidebar's own category colours, with a legend of what is actually there and one sentence for what is not. An empty vault is now an invitation with two actions instead of a grid of zeros.
- [x] Health was six tinted metric tiles with 40px watermark icons, equal weight whatever they said. It is a summary strip over a worklist of bands now, in the same severity order as the dashboard, with the accounts hanging in a text column under each title.
- [x] The health page can be opened at a finding: the dashboard passes it, the card is scrolled to and focused.
- [x] The generated password is the point of the generator page and was set at the size of a form label. It is 28px on the vault page and 18px in the popup, with digits and symbols picked out of the letters; the buttons and options use the width they have. Checked at both widths.
- [x] All gates green; every page checked in Chromium at 1440x900 with 24 real logins in the vault.
- [x] The detail panel told a reader to select an item while the list beside it was empty, which on the archive page is an instruction nobody can follow. It says what the list is instead (2.7.1).

## 2026-09-16 · Two scrollbars, three unequal cards, an empty About page (2.6.8)

- [x] The settings page scrolled twice: the panel's own scrollbar beside the page's. The import card's visually-hidden file input is `position: absolute` with no offsets, and with no positioned ancestor it kept the place it would have had in the flow -- measured from the page, 1288px down -- so the document itself grew past the viewport. The four hidden controls are pinned to their corner now, and every settings card is a containing block, so nothing inside one can stretch the page again.
- [x] Settings held three cards of wildly different sizes: locking, the PIN and the master password shared one card three times the height of its neighbours, and the panel stretched Appearance and breach checks to match it. Each is its own card now, security first, and the two rows come out even (three at 397px, two at 185px, with the importer across the row beneath).
- [x] Those cards' own fields had no styling: the "Lock the vault" label and its select shared one line, the label's text running under the control. Labels sit above their controls, the select spans the card, and the checkbox takes the accent colour.
- [x] The PIN card and the locking card each keep their own failure message; one shared message would have appeared under whichever card the reader was not looking at.
- [x] About was a third of a page. It now names what ShardPass keeps, how the vault is protected (Argon2id at 64 MiB and two passes, XChaCha20-Poly1305, where the key lives, what locks it), what leaves the device and what does not, the shortcuts as this browser actually has them with a button to the browser's own settings page, and the developer and update links. Version, licence and supported browsers sit beside the name.
- [x] Checked in Chromium at 1440x900: one scrollbar on settings, six even cards on About, all gates green.

## 2026-09-16 · The interface was rendering at 87.5% (2.6.7)

- [x] Every size in the design system is a rem fraction written against a 16px root, and each token's comment names the pixel size that assumes. The root was 14px, so the whole interface rendered at 87.5% of its own design: body text at 12.25px, section labels at 9px. That is why it needed browser zoom to read comfortably. The root is 16px now, and a test pins it.
- [x] The left pane went from 200px to 248px, and the item list from 280px to 320px, so the longest category names sit beside their counts without truncating.
- [x] The list toolbar could not hold search, sorting and "New item" on one line at the larger size: search now has its line and the other two sit beneath it.
- [x] Checked in a real browser at 100% zoom: the vault reads well and the popup, fixed at 400px, gained no horizontal overflow.

## 2026-09-16 · Ente sync, broken by my own change (2.6.6)

- [x] Ente reported ENTE_UNAVAILABLE on every sync since 2.5.3. That release made libsodium load on first use to keep it out of the service worker's start-up; `import()` is disallowed in a ServiceWorkerGlobalScope by the HTML specification, so the module never loaded and the crypto adapter never existed. Proved by calling `import()` inside the running worker: "import() is disallowed on ServiceWorkerGlobalScope by the HTML specification."
- [x] The import is static again. The worker is back to loading about 1.8 MB on every wake; winning that back means moving Ente's crypto into a worker of its own, not a dynamic import.
- [x] The build scanner now reports any `import(` reachable from the service worker, with a test. That is the gate that would have caught this the day I wrote it.

## 2026-09-16 · Full pass through a real browser (2.6.4)

Loaded the built extension into Chromium and drove every feature: vault CRUD for each item kind, categories, search, folders, archive, restore, delete, the login chip and picker, the sign-up generator, the save prompt, the sign-in banner, the code picker, passkey creation and sign-in, the popup, Health, Overview, the generators, About, Settings, locking and unlocking.

- [x] **Unlocking with a PIN did nothing, silently.** The correct PIN opened the vault in the background, but the state every surface reads was never republished, so the lock screen stayed up over an open vault. A wrong PIN reported "That is not the PIN"; the right one reported nothing at all. `vault.unlockWithPin`, `vault.setPin` and `vault.removePin` now publish, and an integration test drives the whole path and fails without the fix.
- [x] Fixed: the new one-time-code form had no field to type the secret into until "Reveal secret" was clicked. A code being created has nothing to conceal, so the field is there from the start; editing an existing code still starts concealed.
- [x] Also verified end to end: a Chrome CSV import, an encrypted backup exported and restored into a fresh vault, the re-prompt on an item, a breach check against Have I Been Pwned, the Health counts (very weak and reused both correct) and the master-password change.
- [ ] Not reachable from this harness: filling a card or identity from the popup into a page, and the popup's fill button, because a popup driven this way has no other active tab. Ente sync and DuckDuckGo aliases need live accounts.
- [x] Everything else passed: item creation for every kind, category filters, search, folder create/rename/delete and filing, archive/restore/delete, login fill from the chip and the picker, a generated password filling both sign-up fields, the save prompt storing a login, the sign-in banner filling the form, the code picker filling the field, passkey create and assert on a real page, the popup's list, search and live code, and the Health, Overview, generator, About and Settings views.

## 2026-09-16 · Clicking a one-time code: the actual cause, found by reproducing it (2.6.3)

Loaded the built extension into a real Chromium, created a vault, added a code, and drove the flow.

- [x] **The picker was click-through.** The shadow host sets `pointer-events: none` so a chip beside a field never swallows the page's own buttons, and a rule in `picker.css` names the surfaces that take clicks again. `.otpPicker` was never in that list. The list rendered, the live code ticked down, and every click passed straight through to the page. No amount of controller logic could have fixed it, which is why three attempts did not.
- [x] A gate now derives each content component's own root class and fails if it is missing from that rule. It fails on the old stylesheet.
- [x] Second, separate bug found in the same session: on a page that rewrites its own path, the chip would not open the list at all, because opening also checked the claim. It reclaims the field now, as the row click does.
- [x] Both verified in the browser: the field fills and the picker closes, on a stable page and on one that rewrites its path.

## 2026-09-16 · Clicking a one-time code, the real cause (2.6.2)

- [x] The click died at the ownership guard, before any of 2.6.1's retry could run. The picker's claim on the field records the page it opened on, and a two-factor step that rewrites its own path (which is what these pages do between steps) invalidates that claim while the picker stays on screen. Every click then hit the guard and returned in silence.
- [x] The claim is now retaken when the field itself is still there and still a code field: same origin, connected, eligible. That is what clicking the chip again would do, and the background re-authorises from scratch because the new claim needs its own permission.
- [x] The test drives the real shape: open the list, let the page rewrite its path, click the account. It fails without the fix.

## 2026-09-16 · Clicking a one-time code (2.6.1)

Reported: the list appears, clicking the account does nothing, the code has to be typed by hand.

- [x] The permission to release a code and the account's revision are both pinned when the list is fetched. Either can move while the person is choosing (a sync, a touch, a slow read, or simply the five-minute window running out), and the background then refuses with ITEM_CHANGED, EXPIRED or INVALID. The content script caught that, closed the picker and said nothing, which is exactly "clicking does nothing".
- [x] A refusal of that kind now asks again with a fresh permission and the account's current revision, and fills. Anything still refused leaves the picker open with "That code could not be fetched. Click the account again."
- [x] Both covered by tests: one where the first attempt is refused and the second fills, one where every attempt is refused and the reason is on screen.

## 2026-09-16 · Small things with real weight (2.6.0)

- [x] The passkey prompt's header used a class no stylesheet defines, so it had no grid, no column for the close button and none of the save banner's spacing: cramped box, close glyph outside it. It now uses the shared heading row, with a wider prompt and more room around the title, rows and buttons.
- [x] Swept the content scripts for the same mistake: every class name used has a rule, and every rule is used.
- [x] `pnpm format:check` had been failing on 101 files since the formatter's version changed, which meant `pnpm verify` could not pass. The tree is formatted, and the two directories that exist only between assistant runs are ignored rather than rewritten.
- [x] B22 · a click in the sidebar threw away a half-filled new item without a word. It now asks, and only when something was actually typed: the form's fields are compared with what they held when it opened.
- [x] B24 · deleting the folder you were filtering by moved you to the vault list even from Settings or Health. The filter is cleared where it lives now, and the view stays put.
- [x] B20 · a new item that could not be filed into the open folder failed silently as an unhandled rejection. It says so, above the item.
- [ ] B26 stays open: a locked dialog desyncing from React on a second Escape was never reproduced.

## 2026-09-16 · Google and passkeys, again (2.5.4)

- [x] Every passkey ShardPass created told the site it was reachable over "hybrid" as well as "internal". Hybrid means "this credential can be used from a phone", so Google offered the phone, which is the same prompt that asks to turn Bluetooth on. Bitwarden advertises hybrid deliberately, because it has a phone app to reach; ShardPass has none, so it now says "internal" only.
- [x] Checked `chrome.webAuthenticationProxy` (Chrome 115+, permission `webAuthenticationProxy`) as the deterministic route. Rejected: attachment is exclusive and global, so while attached ShardPass would answer every passkey request in the browser, including ones meant for Chrome's own profile passkeys, Windows Hello or a co-installed 1Password, with no way to hand a request back. It suits remote-desktop software, which attaches only for the length of a session.
- [x] Probed Google's own sign-in page: the identifier step makes no WebAuthn call at all, so nothing there can be intercepted. The ceremony starts only after an account is named.
- [x] Fixed the Ente regression from 2.5.3: conflict preview and resolution read the crypto adapter without waiting for it, which is what reported ENTE_UNAVAILABLE. Both now wait, and a connected account starts loading it as soon as it connects.

## 2026-09-16 · Speed (2.5.3)

Measured on a 100-item vault, in Node with in-memory storage (the browser pays more, since every read is chrome.storage IPC):

| what                                                                    | cost     |
| ----------------------------------------------------------------------- | -------- |
| Argon2id at the shipped parameters (64 MiB, 2 passes), libsodium        | 750 ms   |
| the same in pure JavaScript, the fallback if the WebAssembly path fails | 1,700 ms |
| list every item                                                         | 40 ms    |
| read one item                                                           | 25 ms    |
| update one item (a new generation, written and verified)                | 180 ms   |

- [x] The background service worker statically imported libsodium, 1.8 MB of wrapper and WebAssembly, on every wake, for Ente sync alone. It now loads on the first Ente operation: the worker's start-up graph went from about 2.3 MB to 482 KB. The WebAssembly payload, its imports and its exports are byte-identical; only the wrapper's hash is re-pinned.
- [ ] Not done: caching the decrypted generation between reads. It cuts a full read from 40 ms to 13 ms and a single item read to under 1 ms, but it breaks a property the vault tests pin: a record tampered with under an unchanged root must be caught on every read. Doing it properly means re-verifying the stored bytes by hash on each cached read, which is its own design decision.
- [ ] Unlock is dominated by the key derivation and will stay near a second at these parameters. Lighter parameters (19 MiB, 2 passes is the OWASP floor) would cut it to roughly a third, and would apply to an existing vault only when the master password is set again.

## 2026-09-16 · One-time codes (2.5.2)

- [x] Clicking a code in the picker did nothing on pages that rewrite their URL while you choose. The fill refused unless `location.href` was byte-identical to the URL captured when the picker opened, so a sign-in step adding a query parameter (common on two-factor pages) turned every click into a silent refusal. Origin and path must still match; a query or fragment rewrite does not.
- [x] The vault's live code froze: the countdown effect scheduled one timer and, because the tick's own state was not a dependency, never scheduled another. The code stayed on screen past its period and was never asked for again. The popup's copy of the same hook was already correct.
- [x] Both covered by tests that fail without the fix.

## 2026-09-16 · The chip on every login field (2.5.0)

Reported on HackerOne's sign-in: 1Password's island appears, ShardPass shows nothing.

- [x] Read the real page (the form is a plain Rails one: hidden token, `user[email]` text input, `user[password]`, a checkbox) and pinned it as a detection test. Detection was never the problem.
- [x] The chip only appeared when the vault already held a match, was locked, or the form looked like a sign-up. Bitwarden and 1Password put their menu beside any login field and offer "New login" when nothing matches; ShardPass now does the same.
- [x] With nothing saved, the picker offers a generated password and a row that opens the vault at a new login for this site.
- [x] Focus no longer asks the background anything: the chip is drawn beside the field, and the vault is asked once, when the picker opens. That also removes the chip's old side effect of telling a page whether this site is in the vault.

## 2026-09-16 · Google passkey: the Bluetooth prompt (2.4.5)

- [x] Root cause: the page-world interceptor runs at `document_start` and the isolated half at `document_idle`. A ceremony started in that window got no answer within 700 ms, so it went to the browser, which on a desktop with no platform authenticator offers a phone over Bluetooth.
- [x] A modal request now keeps asking for about five seconds, and the isolated half announces itself when it loads so a waiting ceremony is asked again at once.
- [x] A request that names a phone or a security key (`hints`, or allow-list transports without `internal`) is left to the browser, so ShardPass no longer steps in front of a deliberate cross-device sign-in.
- [ ] Deterministic alternative not taken: `chrome.webAuthenticationProxy` (Chrome 115+) would have the browser route ceremonies to ShardPass instead of racing content scripts. It needs a new permission, and only one extension at a time can hold it, so it is the user's call.

## 2026-09-16 · 1Password-inspired pass (target 2.3.0)

- [x] Health page as a scoreboard: gauge hero, overall strength bar, finding cards with counts
- [x] "Passkeys available" check (known passkey sites, logins without a passkey)
- [x] Coloured category tiles; API credentials and SSH keys as their own entries
- [x] Coloured initial tiles for logins without a site icon; logo header on login detail
- [x] About page: developer, networkshard.com, GitHub hett-patell, built with Claude
- [x] Fix the ItemRow test that expects a kind icon on a login row
- [x] Lint, tests, security build, commit, bump to 2.3.0

## Open after this run

- [x] Google passkeys: answered in 2.4.0-2.5.4 (document_start page script, conditional mediation, platform-authenticator answers, internal-only transports)
- [ ] Popup: no overview or alias UI yet
- [ ] Other alias providers (SimpleLogin, addy.io, Firefox Relay)
- [ ] Real export files for the importers (samples in docs/import-samples are synthetic)
