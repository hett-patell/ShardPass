# Chrome Web Store listing

Everything the dashboard asks for, written out so a submission is copy-and-paste rather than
improvisation. The screenshots beside this file are 1280×800, taken from a real build with a
vault of ten logins; retake them with `docs/store/README.md`'s recipe whenever the interface
changes materially.

## Identity

- **Name:** ShardPass
- **Category:** Productivity → Tools
- **Language:** English (United Kingdom)
- **Website / homepage:** <https://github.com/hett-patell/ShardPass>
- **Support:** <https://github.com/hett-patell/ShardPass/issues>
- **Privacy policy URL:**
  <https://github.com/hett-patell/ShardPass/blob/main/docs/privacy-policy.md>

## Short description (132 characters maximum)

The same line the manifest carries, so the listing and the extensions page agree:

> Keeps your passwords, passkeys and one-time codes on this device, and fills them as you
> browse. No account, no server.

## Detailed description

> ShardPass is a password manager that keeps your vault on your own machine.
>
> There is no account to create and no server holding your passwords. Everything you save is
> encrypted on this device with a key derived from your master password, and it stays here.
>
> **What it keeps**
>
> - Logins, passkeys and one-time codes, filled on the page you are on
> - Cards, identities, notes, API credentials and SSH keys
> - Generators for passwords, usernames and email aliases
> - Folders, favourites, an archive, and a health report over the whole vault
>
> **How it is protected**
>
> - Your master password derives the key with Argon2id; the password itself is never stored
> - Items are encrypted with XChaCha20-Poly1305 before they are written
> - The key lives in the extension's background worker, never in a web page
> - The vault locks on your timer, when your screen locks, and on demand
> - A PIN can stand in for the master password on a device that is yours
>
> **Bringing your passwords over**
>
> Import from Chrome, Firefox, Safari, Bitwarden, 1Password, LastPass, Dashlane, NordPass,
> Proton Pass, KeePass, any CSV you map yourself, or a QR code. Leaving is the same motion in
> reverse: an encrypted backup file you hold.
>
> **What it does not do**
>
> No account. No phone app. No sharing or teams. Nothing leaves your device unless you turn on
> a feature that needs it: breach checks (which send the first five characters of a password's
> hash, never the password), Ente sync for one-time codes, or DuckDuckGo email aliases.
>
> Free and open source under the MIT licence.

## Single purpose

Chrome requires one sentence naming the single purpose:

> ShardPass stores the user's passwords and related credentials encrypted on their own device
> and fills them into sign-in forms at the user's request.

## Permission justifications

Each of these is the reason recorded in `apps/extension/src/manifest.ts`; keep them in step.

| Permission         | Justification for the reviewer                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`          | Holds the encrypted vault and the non-secret settings on the user's device.                                                                   |
| `unlimitedStorage` | The vault format writes a complete new generation on every commit and keeps the previous one for rollback, which crosses the 10 MB default.   |
| `alarms`           | Locks the vault after the inactivity period the user chose.                                                                                   |
| `idle`             | Locks the vault when the operating system reports the screen as locked.                                                                       |
| `activeTab`        | Reads the open tab's address to offer the login saved for it, and asks that tab to fill. Granted only while the user is using the popup.      |
| `contextMenus`     | Adds a "Fill login with ShardPass" entry to editable fields.                                                                                  |
| `favicon`          | Shows the browser's own cached site icons beside saved logins; no request is made to the sites themselves.                                    |
| `host_permissions` | The content script that offers to fill and to save runs on the pages the user visits. It reports nothing anywhere and acts only when clicked. |
| Remote code        | None. Everything executed ships in the package; the content security policy allows scripts from the extension itself only.                    |

## Data disclosures

Chrome's form asks what is collected. The truthful answers:

- **Personally identifiable information, authentication information, personal communications,
  location, web history, user activity, website content:** not collected. The vault never
  leaves the device unless the user turns on a feature named below, and the developer receives
  nothing in any case.
- **Sold to third parties:** no. **Used or transferred for purposes unrelated to the single
  purpose:** no. **Used to determine creditworthiness or for lending:** no.
- Three optional features contact a third party with the user's own credentials or data, each
  off until switched on: Have I Been Pwned (a password hash prefix), Ente (one-time-code
  records, end-to-end encrypted, under the user's own account), DuckDuckGo Email Protection
  (to mint an alias). All three are described in the privacy policy.

## Screenshots

In the order they should appear, with the caption to put under each:

1. `1-vault.png` — "Every kind of credential in one vault, with the detail beside the list."
2. `2-dashboard.png` — "What to fix first, in the order it costs you something."
3. `3-health.png` — "A worklist for weak, reused, breached and unencrypted logins."
4. `4-generator.png` — "Passwords and passphrases generated on the device."
5. `5-settings.png` — "Locking, a PIN, the master password, and importing from thirteen formats."

## Before submitting

- [ ] `pnpm package` and upload `release/shardpass-<version>.zip`.
- [ ] Check the short description in the listing matches `manifest.ts` exactly.
- [ ] Confirm the privacy policy URL resolves on the branch that is public.
- [ ] Retake screenshots if the interface changed since the ones in this folder.
