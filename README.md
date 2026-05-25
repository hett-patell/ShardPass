# ShardPass

[![Release](https://img.shields.io/github/v/release/hett-patell/ShardPass?color=blue)](https://github.com/hett-patell/ShardPass/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

<p align="center">
  <picture>
    <img src="https://github.com/user-attachments/assets/ad08c8a6-8418-4240-8153-4b34eec64efc" alt="ShardPass" width="500">
  </picture>
</p>

ShardPass is a **local-first TOTP authenticator** browser extension for Chromium (Manifest V3). It detects OTP fields on web pages and surfaces matching codes via an inline floating chip — no phone needed, no cloud dependency.

All secrets are encrypted at rest with AES-256-GCM, with the key derived from a master password using PBKDF2-HMAC-SHA256. The master password is never stored or transmitted.

---
<p align="center">
  <picture>
    <img src="https://github.com/user-attachments/assets/b779f606-9af6-4deb-81b0-f34d53f9bf54" alt="ShardPass" width="250  ">
  </picture>
</p>

## Features

- End-to-end encrypted vault (AES-256-GCM, PBKDF2 250k rounds, SHA-256)
- Inline autofill chip matches accounts to the current domain and fills OTP codes on click
- TOTP (RFC 6238) and HOTP (RFC 4226) support
- Import from manual secret, QR image, `otpauth://` URI dump, or encrypted JSON backup
- Export encrypted vault backups
- Detached window for file-based import/export (survives Chromium popup dismissal)
- Optional E2EE two-way sync with [Ente Auth](https://ente.io) via SRP + libsodium
- Optional DuckDuckGo Email Protection alias generation
- Auto-lock on idle or OS screen lock

---

## Install

```bash
bun install
bun run build
```

1. Navigate to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/` directory

---

## First run

1. Click the toolbar icon and set a **master password** (minimum 12 characters)
2. Add accounts via manual entry, QR paste, or import
3. Visit a site's 2FA page, focus the OTP field, and click the chip to autofill

---

## Inline autofill

OTP inputs are detected by scanning the page for:

- `autocomplete="one-time-code"`
- Heuristic matching on `name`, `id`, `placeholder`, `aria-label`, and `data-testid`
- `inputmode="numeric"` with `maxlength` between 4 and 8

Domain matching tokenizes the hostname and eTLD+1, then compares against each account's `issuer`, `label`, and `tags`. Multiple matching accounts are shown in a scrollable list; a single match is shown directly.

---

## Security architecture

### Local vault

| Layer | Mechanism |
|-------|-----------|
| At rest | Entire vault (accounts, Duck token, Ente state) encrypted as one AES-256-GCM blob in `chrome.storage.local` |
| Key derivation | PBKDF2-HMAC-SHA256, 250,000 iterations, 16-byte random salt |
| In memory | `CryptoKey` + plaintext vault held in the service worker while unlocked |
| Session persistence | Raw AES key bytes in `chrome.storage.session` for SW restart resilience; cleared on lock |
| Master password | Never written to disk; incorrect password causes decrypt failure |
| Export | JSON backup contains ciphertext + salt + IV; re-import requires the export password |

### Trust boundaries

| Extension surface | Access to secrets |
|---|---|
| Popup | No — receives codes on demand, never stores secrets |
| Content script | No — receives only metadata and generated codes |
| Service worker | Yes (when unlocked) — sole surface that decrypts the vault, generates TOTP, and talks to remote APIs |
| Detached import window | Same as popup |

### Auto-lock

- Configurable timer via `chrome.alarms` (0 = disabled)
- Optional lock on OS screen lock via `chrome.idle`
- Lock clears the in-memory vault and session key; content scripts stop displaying codes

### Permissions

| Permission | Purpose |
|---|---|
| `storage` | Encrypted vault and settings |
| `activeTab` | Context on current tab |
| `alarms` | Auto-lock and periodic Ente sync |
| `idle` | Lock on OS screen lock |
| `clipboardRead` / `clipboardWrite` | Paste imports and QR, copy codes and aliases |
| `<all_urls>` | Content script on login pages for the chip; domain matching happens locally |

### What ShardPass does not do

- No analytics or telemetry
- No plaintext secrets in storage
- No remote code execution
- No master password recovery — it is not stored

---

## Ente Auth sync (optional)

Two-way E2EE sync with Ente's authenticator backend:

- **Login**: SRP-6a (`fast-srp-hap`) + libsodium KEK derivation
- **Sync**: Pulls remote diffs, decrypts with the authenticator key, and merges accounts by fingerprint; pushes local changes via a deduplicated pending queue
- **Server**: Defaults to `https://api.ente.io`; self-hosted URL configurable in settings

Ente credentials are stored inside the encrypted vault blob. Sync runs in the service worker with `wasm-unsafe-eval` CSP enabled for libsodium.

---

## DuckDuckGo Email Protection (optional)

Generate `@duck.com` aliases from within the extension:

1. Sign up at [DuckDuckGo Email Protection](https://duckduckgo.com/email/)
2. Visit [autofill settings](https://duckduckgo.com/email/settings/autofill)
3. Open DevTools → Network → Generate Private Duck Address → copy the `Authorization: Bearer …` token
4. Settings → DuckDuckGo → Connect

The token is stored inside the encrypted vault and is never read back in plaintext.

---

## Development

```bash
bun run dev      # Watch mode → dist/
bun run build    # tsc --noEmit && vite build
bun run zip      # Package dist/ → shardpass.zip
```

### Project layout

```
src/
├── background/     # MV3 service worker — vault session, TOTP/HOTP, Ente, Duck, auto-lock
├── content/        # OTP detection + Shadow DOM inline chip
├── lib/
│   ├── crypto.ts   # PBKDF2 + AES-GCM vault encryption
│   ├── ente/       # Ente API client, SRP, libsodium sync, pending queue
│   ├── totp.ts     # TOTP and HOTP code generation
│   ├── format.ts   # Dependency-free code formatter
│   └── …
├── components/ui/  # shadcn/ui primitives
└── popup/          # React application and detached import views
```

### Stack

- Chrome Manifest V3 (service worker + content script + popup)
- React 18 + TypeScript 5.7 + Tailwind v4 + shadcn/ui
- otpauth · jsqr · libsodium-wrappers-sumo · fast-srp-hap
- Vite 6 · Bun · CRXJS

---

## Releases

| Tag | Notes |
|---|---|
| v3 | Multi-device Ente sync, SW restart resilience, HOTP, change-password, input validation |
| v2 | Ente Auth E2EE sync and settings UI |
| v1 | Detached-window import fix |

---

## License

[MIT](LICENSE) © Het Patel

---

## Shard ecosystem

| Project | Description |
|---|---|
| [ShardLure](https://github.com/hett-patell/ShardLure) | SSH honeypot and threat-intel dashboard |
| [ShardC2](https://github.com/hett-patell/ShardC2) | Red-team C2 framework in Go |
| [ShardFlow](https://github.com/hett-patell/ShardFlow) | Layer-2 LAN workbench (ARP, drop, throttle) |
| [ShardShell](https://github.com/hett-patell/ShardShell) | PHP post-exploitation shell |
| [ShardPass](https://github.com/hett-patell/ShardPass) | Local-first TOTP authenticator for Chromium |
| [ShardPet](https://github.com/hett-patell/ShardPet) | Pixel-Pokémon browser extension |
