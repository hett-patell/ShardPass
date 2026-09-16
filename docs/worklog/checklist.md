# Work checklist

Kept current by the assistant while working; one line per item, newest run first.

## 2026-09-16 · Whole-codebase audit (read-only agents, two at a time)

Baseline at 2.3.0: typecheck clean, lint clean after one test fix, full suite green apart from the known slow scanner test.

- [x] 1 Background services, messaging, router — 10 findings (1 high, 4 medium, 5 low), listed below
- [x] 2 Vault page UI — 27 findings (2 high, 10 medium, 15 low), listed below
- [ ] 3 Content scripts, autofill, passkeys — not run (agent launches were blocked in that session)
- [ ] 4 Importers, samples, crypto helpers — not run
- [ ] 5 Popup, platform, manifest, CSP, build scanner — not run
- [ ] 6 Tests and tooling — not run
- [x] Fix batch A (background, security first), with tests — verified: typecheck clean, background/messaging/vault/popup/content suites green, lint clean. A6 (username suggestion budget), A9 (comments) and the OTP-service re-prompt unit test followed in later commits.
- [x] Fix batch B (vault UI), with tests — done except B20 (handleCreated edge cases), B22 (navigating away from a create form), B24 (deleting the filtered folder from another view), B26 (unverified dialog desync); B13 was already NBSP.
- [x] Re-run gates, commit, bump — batch A shipped as 2.3.1, batch B and the passkey change as 2.4.0
- [x] Google sign-in: answer conditional (page-load) passkey requests with ShardPass's own prompt; a locked vault stays quiet there

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
