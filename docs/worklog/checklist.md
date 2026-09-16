# Work checklist

Kept current by the assistant while working; one line per item, newest run first.

## 2026-09-16 · Whole-codebase audit (read-only agents, two at a time)

Baseline at 2.3.0: typecheck clean, lint clean after one test fix, full suite green apart from the known slow scanner test.

- [x] 1 Background services, messaging, router — 10 findings (1 high, 4 medium, 5 low), listed below
- [x] 2 Vault page UI — 27 findings (2 high, 10 medium, 15 low), listed below
- [x] 3 Content scripts, autofill, passkeys — 15 findings (2 high, 9 medium, lows), listed under batch D
- [x] 4 Importers, samples, crypto helpers — fixed as batch C (2.4.2)
- [x] 5 Popup, platform, manifest, CSP, build scanner — 10 findings (1 high, 5 medium, lows), listed under batch E
- [ ] 6 Tests and tooling — not run
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

- [ ] A1 high · `login/data-fill-service.ts` select(): a card/identity grant is bound to the tab only, so any iframe (content scripts run in all frames) can win the single-use release and receive number + CVV. Require `sender.frameId === 0`; make `content/data/data-fill-controller.ts` answer only in the top frame and detect fields before asking.
- [ ] A2 medium · `login-fill-service.ts` offer(): `existing === "same"` is a password-correctness oracle for scripts on the registrable domain (no banner = correct guess). Throttle per domain (more than 5 evaluations a minute → answer as unknown).
- [ ] A3 medium · reprompt grants survive the Lock button and every fail-closed lock (only `main.ts lockAndPublish` clears them). Register `sessions.onLockOrDispose(() => repromptGrants.clear())`; clear data-fill grants too; fix the comment in `reprompt-grants.ts`.
- [ ] A4 medium · `item/item-service.ts redactSecrets`: OTP items come back unredacted and identities keep passport, licence and national id. Blank them; gate `otp.getCode` / `otp.getEditor` on the reprompt grant.
- [ ] A5 medium · the PIN wrap survives a master-password change (same DEK). Remove `shardpass:v1:pin` in `changePasswordInternal`, tell the UI, and say in the PIN copy that a copy of the profile allows offline PIN guessing.
- [ ] A6 low · `login.suggestUsername` hands the plus-address and mints Duck addresses on the content script's request without a rate limit.
- [ ] A7 low · `alias-service.ts` maps every seal/open error to VAULT_LOCKED; `forgetDuck` overwrites an unreadable list with `[]`; `listDuck` answers `[]` while locked.
- [ ] A8 low · `packages/messaging/src/vault.ts` lockMinutes accepts 0..1440 while the service takes only 0/5/15/30/60.
- [ ] A9 low · `login.fillSuggestions` schema requires `domain`/`pageUrl` that the service never reads; `router.ts` documents `error.detail` as Ente-only but startup sets it too.
- [ ] A10 low · session hygiene: `this.dek` reassigned without wiping in `unlockInternal` and `unlockWithPin`; `sealSecret`/`openSecret`/`captureBackupSession` pass `assertEpoch` after `beginLock` bumped the epoch (add a pending-lock flag); a storage error inside `unlockWithPin` counts as a wrong PIN; breach checks read reprompt-protected passwords without a grant.

### Batch B · vault UI (verified by the audit)

- [ ] B1 high · `OtpDetail.tsx`: "Delete OTP" in edit mode does nothing; the dialog only renders in the view branch, so it pops up after Cancel.
- [ ] B2 high · `VaultAccess.tsx`: change-master-password errors and the lock failure are set but never rendered in the unlocked branch; success shows nothing.
- [ ] B3 medium · `useModalDialog.ts`: `dialog.close()` runs after unmount, so focus drops to body when a dialog is dismissed by button (DetailActions cancel, passkey cancel, PasswordGeneratorDialog).
- [ ] B4 medium · `Form.module.css`: `.select` gets `width: 100%` inside `.listRow`, squeezing the sibling input (LoginForm URL/custom-field rows, SecretForm key row).
- [ ] B5 medium · `item-support.ts itemDisplaySubtitle`: a note's first line is shown in the clear in lists, the overview and the import preview.
- [ ] B6 medium · Overview (quick estimator) and Health (zxcvbn) disagree on weak counts and the score.
- [ ] B7 medium · opening an item from Health/Overview keeps category, folder and search, so the selection points at a hidden row (`VaultApp.tsx` onOpenItem handlers; the hash route resets).
- [ ] B8 medium · `HealthGauge` needs `aria-valuetext`; the caption and number are presentational inside role="meter".
- [ ] B9 medium · focus lost after archive/restore (OrganizeControls), folder rename/create (VaultSidebar FolderNameInput), and cancelling or saving a create form (VaultApp).
- [ ] B10 medium · `useOtpLiveCode.ts`: an error shows "Loading code…" forever; an already-expired code re-polls every 250 ms.
- [ ] B11 medium · Backup card: Escape anywhere clears the typed passwords and discards a decrypted preview (`BackupView.tsx` → `useBackup.ts`).
- [ ] B12 medium · empty master password runs a full Argon2 derivation and counts against the throttle (`VaultAccess.tsx` locked path).
- [ ] B13 low · Move select indentation uses plain spaces (collapsed in `<option>`); B14 `.value`/`.rowValue` need `white-space: pre-wrap`; B15 empty state offers "Add a login" in every category; B16 two `aria-current` entries in the Archive view; B17 folder tree misuses role="tree"; B18 stale `linkedOtpId` re-saved; B19 OTP edits reset on any refresh; B20 `handleCreated` edge cases; B21 CopyButton has no live region; B22 sidebar navigation discards an in-progress create form; B23 BreachCheckRow shows "Not checked yet." on a failed listing; B24 deleting the filtered folder from another view jumps to the vault; B25 weak count shown while judging; B26 (unverified) locked dialog can desync from React on a second Escape; B27 dead CSS (`.folderItemActive`, `.empty`, `.fieldFull`, `.labelRow`, `.labelActions`, `.listAdd`).

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
- [ ] Not fixed: `pnpm format:check` fails on 102 files that predate this work (prettier 3.9.6 against a tree formatted by an older version). Reformatting would rewrite evidence-pinned files, so it wants its own pass.

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
- [ ] E9 low (still open, narrow) · `login.fillFromPopup` first-answer race across frames (narrow).
- [x] E10 low · dead `useOtpList.ts`; stale scan-build/manifest-test comments; GeneratorScreen's deferred settings fetch overwrites what was typed and requests a username per keystroke.

## 2026-09-16 · Full pass through a real browser (2.6.4)

Loaded the built extension into Chromium and drove every feature: vault CRUD for each item kind, categories, search, folders, archive, restore, delete, the login chip and picker, the sign-up generator, the save prompt, the sign-in banner, the code picker, passkey creation and sign-in, the popup, Health, Overview, the generators, About, Settings, locking and unlocking.

- [x] **Unlocking with a PIN did nothing, silently.** The correct PIN opened the vault in the background, but the state every surface reads was never republished, so the lock screen stayed up over an open vault. A wrong PIN reported "That is not the PIN"; the right one reported nothing at all. `vault.unlockWithPin`, `vault.setPin` and `vault.removePin` now publish, and an integration test drives the whole path and fails without the fix.
- [x] Found while testing: the new one-time-code form has no field to type the secret into until "Reveal secret" is clicked. For a code that does not exist yet there is nothing to conceal.
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

- [ ] Google passkeys: the page script leaves conditional mediation to the browser (needs a document_start entry)
- [ ] Popup: no overview or alias UI yet
- [ ] Other alias providers (SimpleLogin, addy.io, Firefox Relay)
- [ ] Real export files for the importers (samples in docs/import-samples are synthetic)
