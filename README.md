# ShardPass

A minimal, local-first **TOTP authenticator** for Chrome (MV3) with **inline autofill**. Focus a 2FA input on any site — a floating chip appears with the matching code(s). Click to fill.

- 🔒 Vault encrypted with **AES-256-GCM**, key derived via **PBKDF2** (250k, SHA-256)
- 🧠 Master password is **never stored** — the derived key lives only in the service worker until lock
- 📥 Import from QR images, `otpauth://` text dumps, encrypted backups, or paste
- 🪄 Multi-account aware — 5 GitHub accounts? The chip lists all 5 with live codes
- 🌑 Built with React + shadcn/ui in a tight, minimal dark UI

## Install (load unpacked)

```bash
bun install
bun run build
```

1. Open `chrome://extensions` (or `helium://extensions`, `brave://extensions`, etc.)
2. Enable **Developer mode**
3. **Load unpacked** → select the **`dist/`** folder

## First run

1. Click the toolbar icon → set a **master password** (≥ 8 characters)
2. Add accounts — pick any:
   - **Manual** — paste a base32 secret
   - **QR image** — upload a screenshot of the QR
   - **Import** — choose `.json` backup or `.txt` dump of `otpauth://` URIs, or **paste** the contents directly into the dialog (works around the Chromium "popup closes when file picker opens" issue)
3. Visit a site's 2FA page, focus the OTP input — the chip appears with the matching code(s)

## Inline autofill

OTP inputs are detected via:
- `autocomplete="one-time-code"` (the standard hint)
- Heuristics on `name`/`id`/`placeholder`/`aria-label`/`data-testid` (`otp`, `2fa`, `totp`, `verification code`, etc.)
- `inputmode="numeric"` with `maxlength` between 4 and 8

Domain matching tokenizes the hostname + eTLD+1 against each account's `issuer` / `label` / `tags`, so `github.com` surfaces every account whose issuer contains `github`.

When multiple accounts match, the chip renders as a list — each row shows initial · issuer/label · live code · circular countdown. Click a row to fill.

## Security model

| Layer | Detail |
|---|---|
| At rest | `AES-256-GCM` ciphertext in `chrome.storage.local` |
| Key derivation | `PBKDF2`, 250 000 iterations, SHA-256, 16-byte random salt |
| In memory | Derived `CryptoKey` lives in the service worker; cleared on auto-lock or screen lock |
| Auto-lock | Configurable timer + optional lock on OS screen lock (`chrome.idle`) |
| Permissions | `storage`, `activeTab`, `alarms`, `idle`, `clipboardRead`, `clipboardWrite`, host: `<all_urls>` (required for the inline chip on login pages) |

The master password is never persisted. Re-importing an exported backup requires the password used at export time.

## Develop

```bash
bun run dev      # Vite watch build into dist/
bun run build    # Type-check (tsc --noEmit) + production build
bun run zip      # Package dist/ → shardpass.zip
```

The repo uses [CRXJS](https://crxjs.dev/) so HMR works inside the popup during dev.

## Stack

- Chrome MV3 (service worker + content script + popup)
- React 18 + TypeScript 5.7 (`@/` path alias)
- Tailwind v4 + [shadcn/ui](https://ui.shadcn.com/) primitives, Radix under the hood
- `otpauth` (TOTP generation), `jsqr` (QR decoding), `lucide-react` (icons)
- Vite 6 + Bun

## Layout

```
src/
├── background/        # MV3 service worker — vault session, message routing, auto-lock
├── content/           # Content script + the floating chip (Shadow DOM)
├── lib/               # crypto, storage, totp, detect, qr, otpauth-import, log
├── components/ui/     # shadcn primitives (button, input, dialog, tabs, ...)
└── popup/             # React popup (Setup / Unlock / AccountList + dialogs)
```

## License

[MIT](LICENSE) © Het Patel
