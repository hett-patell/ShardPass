# ShardPass Password Manager — Design Spec

**Date**: 2026-09-02
**Branch**: `feature/project1-release`
**Status**: Approved (pending implementation plan)

---

## Overview

ShardPass evolves from a TOTP-only authenticator into a full local-first password manager. The extension gains support for storing logins (username + password + URL + linked TOTP), secure notes, credit cards, identities, API keys/secrets, and SSH keys — all encrypted at rest in a single AES-256-GCM vault blob. The UI is redesigned from a dark-only vermillion-accented theme to a minimal neutral system-adaptive (light/dark) design. The content script extends from OTP-only autofill to full login-form credential filling with save-new-login prompts.

Ente Auth sync remains OTP-only. All non-OTP items are local with encrypted export/import for backup.

---

## 1. Vault Schema & Data Model

### Base item metadata (existing, unchanged)

All vault items share `ItemMetadataSchema`:

- `id`: UUID v4
- `schemaVersion`: integer (bumped from 1 to 2)
- `revision`: positive integer, incremented on each edit
- `createdAt` / `updatedAt`: ISO 8601 UTC timestamps
- `favorite`: boolean
- `archivedAt` / `deletedAt`: optional ISO timestamps (soft delete)
- `folderId`: optional UUID (reference to a `Folder`)
- `tags`: string array (max 64, unique after NFKC normalization)

### Item types (discriminated union on `kind`)

**`kind: "otp"` — OTP item (existing, unchanged)**

| Field | Type | Notes |
|---|---|---|
| issuer | string (0–256) | Service name |
| label | string (1–256) | Account identifier |
| secret | string (1–1024) | Canonical unpadded Base32 |
| otpType | `"totp" \| "hotp" \| "steam"` | |
| algorithm | `"SHA1" \| "SHA256" \| "SHA512"` | |
| digits | int (5–10) | |
| period | int (0–300) | 0 for HOTP |
| counter | int (optional) | Required for HOTP |
| note | string (0–4096) | |

**`kind: "login"` — Login item (new)**

| Field | Type | Notes |
|---|---|---|
| name | string (1–256) | Display name (e.g. "GitHub") |
| username | string (0–256) | Email, username, or phone |
| password | string (0–4096) | |
| urls | string[] (max 16) | Domains for autofill matching |
| linkedOtpId | string (optional) | UUID of linked OTP item for 2FA chaining |
| notes | string (0–8192) | |

**`kind: "note"` — Secure note (new)**

| Field | Type | Notes |
|---|---|---|
| name | string (1–256) | Title |
| content | string (0–65536) | Freeform text |

**`kind: "card"` — Credit card (new)**

| Field | Type | Notes |
|---|---|---|
| name | string (1–256) | Card label (e.g. "Chase Visa") |
| cardholderName | string (0–256) | |
| number | string (0–32) | Card number |
| expMonth | string (0–2) | "01"–"12" |
| expYear | string (0–4) | "2026" |
| cvv | string (0–8) | |
| pin | string (0–16) | |
| notes | string (0–8192) | |

**`kind: "identity"` — Identity/address (new)**

| Field | Type | Notes |
|---|---|---|
| name | string (1–256) | Label (e.g. "Home address") |
| firstName | string (0–256) | |
| lastName | string (0–256) | |
| email | string (0–256) | |
| phone | string (0–64) | |
| street | string (0–512) | |
| city | string (0–256) | |
| state | string (0–256) | |
| zip | string (0–32) | |
| country | string (0–256) | |
| notes | string (0–8192) | |

**`kind: "secret"` — API key / SSH key / token (new)**

| Field | Type | Notes |
|---|---|---|
| name | string (1–256) | Display name |
| secretType | `"api_key" \| "ssh_key" \| "token" \| "env" \| "other"` | |
| value | string (0–65536) | The secret value |
| metadata | `Record<string, string>` (max 32 entries) | Flexible key-value pairs (e.g. "host", "port") |
| notes | string (0–8192) | |

### Discriminated union

```typescript
VaultItemSchema = z.discriminatedUnion("kind", [
  OtpItemSchema,
  LoginItemSchema,
  NoteItemSchema,
  CardItemSchema,
  IdentityItemSchema,
  SecretItemSchema,
]);
```

### Folder schema

```typescript
FolderSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().check(z.minLength(1), z.maxLength(128)),
  parentId: z.optional(z.uuid()),  // for nested folders
});
```

Max folder depth: 3 levels. Max folders: 64.

### Vault blob structure

The entire vault is encrypted as one AES-256-GCM blob in `chrome.storage.local`. The plaintext structure:

```typescript
interface Vault {
  schemaVersion: 2;
  items: VaultItem[];
  folders: Folder[];       // { id, name, parentId? }
  integrations: {
    ente?: EnteIntegration;
    duckDuckGo?: DuckDuckGoIntegration;
  };
  settings: VaultSettings;
}
```

### Migration (v1 → v2)

On unlock, if `schemaVersion < 2`:
1. Existing OTP items are already valid `kind: "otp"` — no field transformation needed
2. Add empty `folders: []`
3. Set `schemaVersion: 2`
4. Re-encrypt and persist immediately

---

## 2. Monorepo Package Structure

### Existing packages (changes noted)

| Package | Changes |
|---|---|
| `@shardpass/domain` | Add `LoginItemSchema`, `NoteItemSchema`, `CardItemSchema`, `IdentityItemSchema`, `SecretItemSchema`. Add `FolderSchema`. Bump `ITEM_SCHEMA_VERSION` to 2. |
| `@shardpass/crypto` | No change — encrypts the vault blob, item-type-agnostic. |
| `@shardpass/otp` | No change — TOTP/HOTP/Steam code generation. |
| `@shardpass/otp-storage` | Rename to `@shardpass/vault-items`. Generalized CRUD for all item types. |
| `@shardpass/storage` | Vault blob shape changes to include all item types + folders. Add v1→v2 migration logic. |
| `@shardpass/messaging` | New message types: `queryLogins`, `fillLogin`, `offerSaveLogin`, `generatePassword`, CRUD for all item types. |
| `@shardpass/ui` | Full redesign — minimal neutral palette, light/dark tokens, compact components. |
| `@shardpass/importers` | Add importers for 1Password (.1pux/CSV), Bitwarden (JSON), Chrome (CSV), Firefox (CSV). |
| `@shardpass/security` | No change. |
| `@shardpass/testing` | Update fakes for new item types. |
| `apps/extension` | New vault views, autofill content script, popup redesign. |

### New package

| Package | Purpose |
|---|---|
| `@shardpass/autofill` | Login form detection heuristics + credential fill logic. Pure functions, no Chrome API dependency. Unit-testable. |

### Dependency graph

```
@shardpass/domain        ← (zod/mini only)
@shardpass/crypto        ← domain
@shardpass/otp           ← domain, crypto
@shardpass/storage       ← domain, crypto
@shardpass/vault-items   ← domain, storage
@shardpass/messaging     ← domain
@shardpass/autofill      ← domain
@shardpass/importers     ← domain, crypto
@shardpass/ui            ← (React, CSS)
@shardpass/security      ← (standalone)
@shardpass/testing       ← domain, storage
apps/extension           ← all above
```

### Build fix steps

1. `pnpm install` — workspace resolution via `pnpm-workspace.yaml`
2. `pnpm typecheck` — identify broken imports
3. Fix iteratively until clean

---

## 3. UI Design System

### Palette — Minimal Neutral

| Token | Light | Dark |
|---|---|---|
| `--bg-primary` | `#ffffff` | `#111113` |
| `--bg-secondary` | `#f7f7f8` | `#1a1a1e` |
| `--bg-tertiary` | `#ebebef` | `#232328` |
| `--text-primary` | `#111113` | `#ededef` |
| `--text-secondary` | `#6e6e76` | `#8e8e96` |
| `--text-tertiary` | `#9e9ea6` | `#5e5e66` |
| `--accent` | `#2563eb` | `#3b82f6` |
| `--accent-hover` | `#1d4ed8` | `#60a5fa` |
| `--border` | `#e4e4e7` | `#27272a` |
| `--danger` | `#dc2626` | `#ef4444` |
| `--success` | `#16a34a` | `#22c55e` |

Blue accent used sparingly — primary CTAs and active states only.

### Typography

- System font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- No uppercase kickers. Sentence-case labels.
- Body: 13px, captions: 11px
- Monospace only for OTP codes, passwords, and secret values

### Theming

- System-adaptive via `prefers-color-scheme` media query
- Manual override via `data-theme="light" | "dark"` on root element
- Tokens defined as CSS custom properties on `:root`
- Light palette on bare `:root`, dark redefined under `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and `:root[data-theme="dark"]`

### Component layouts

**Popup (400×540px):** Single-panel compact view.

- Header: search input + settings gear + lock button
- Filter tabs: All | Logins | OTP | Notes | Cards | Secrets
- Item rows: 44–48px height. Icon + name + subtitle + chevron
- Bottom: Add Item button
- OTP items show live code + countdown inline

**Vault (full tab — detached window):** Two-panel layout.

- Left sidebar: category navigation (All, Logins, OTP, Notes, Cards, Identity, Secrets) + folders + settings
- Right panel: item detail view with field labels, copy buttons, reveal toggles
- Edit/delete actions in detail view

### Item type icons (Lucide)

| Type | Icon |
|---|---|
| Login | `globe` |
| OTP | `key-round` |
| Note | `sticky-note` |
| Card | `credit-card` |
| Identity | `user` |
| Secret | `lock` |

---

## 4. Content Script & Password Autofill

### Login form detection (`@shardpass/autofill`)

On page load, scan for login fields:

1. Find `type="password"` inputs
2. For each, find associated username field: `type="email"`, `type="text"` with name/id matching `user|email|login|account|username`
3. Extract domain from `window.location.hostname`
4. Group into form candidates (same `<form>` parent, or proximity-based grouping for formless layouts)

### Matching flow

```
detect login fields → extract domain
  → chrome.runtime.sendMessage({ type: "queryLogins", domain })
  → background: match domain against VaultItem[kind="login"].urls[]
  → return: matched items (id, name, username only — no secrets)
  → content script: show autofill chip on username/password fields
```

### Fill flow

```
user clicks chip → selects login item
  → chrome.runtime.sendMessage({ type: "fillLogin", itemId })
  → background: decrypt vault, return { username, password }
  → content script: set input.value, dispatch input/change/blur events
  → if linkedOtpId exists: watch for 2FA page navigation
  → on 2FA page: existing OTP autofill activates automatically
```

### Save-new-login prompt

```
form submit detected → capture username + password
  → chrome.runtime.sendMessage({ type: "offerSaveLogin", domain, username })
  → background: check for existing match
  → no match: show browser notification / popup prompt "Save this login?"
  → user confirms → VaultItem[kind="login"] created
```

### Security boundaries

- Content script never receives the full vault — only specific items on demand
- Background returns only the requested item, only when vault is unlocked
- Domain matching happens in background, not content script
- Credentials injected via `HTMLInputElement.value` + synthetic events, not stored in DOM
- Shadow DOM isolation for the inline chip (unchanged from current)

### Inline chip redesign

- Subtle neutral style: thin `1px` border in `--border`, small ShardPass icon (16×16)
- Adapts to page context (light/dark detection via `prefers-color-scheme`)
- Expands on hover to show matched item name
- Same Shadow DOM isolation as current implementation

---

## 5. Encrypted Export/Import

### Export format v2

```json
{
  "version": 2,
  "generator": "shardpass",
  "exportedAt": "2026-09-02T10:00:00Z",
  "encryption": {
    "algorithm": "AES-256-GCM",
    "kdf": "PBKDF2-SHA256",
    "iterations": 250000,
    "salt": "<base64>",
    "iv": "<base64>"
  },
  "data": "<ciphertext containing VaultItem[]>"
}
```

- Version 1 exports (OTP-only) remain importable — decrypted payload contains only `kind: "otp"` items
- Version 2 exports include all item types
- Items validated through `VaultItemSchema` on import; unknown `kind` values rejected
- Invalid items collected and reported to the user, not silently dropped

### Third-party importers

| Source | Format | Items imported |
|---|---|---|
| 1Password | `.1pux` or CSV | Logins, notes, cards, identity |
| Bitwarden | JSON export | Logins, notes, cards, identity |
| Chrome/Edge | CSV | Logins only |
| Firefox | CSV | Logins only |
| QR / otpauth:// / Ente | Existing, unchanged | OTP only |

Each importer maps source fields to `VaultItem` schemas and validates through Zod before adding.

---

## 6. Password Generator

Runs in the background service worker using `crypto.getRandomValues()`.

### Random mode

- Length: 8–128 characters (default 20)
- Character classes: uppercase, lowercase, digits, symbols (toggleable)
- Exclude ambiguous characters option (`0O`, `1lI`)
- Minimum 1 character from each selected class

### Passphrase mode

- Word count: 3–10 (default 4)
- Separator: hyphen, space, period, none
- Capitalize first letter option
- Bundled EFF large wordlist (~7,776 words, ~40KB)

### Entropy display

Show bits of entropy alongside the generated value so the user can gauge strength.

### Availability

- Add/Edit Login dialog — inline generator with preview
- Popup quick action — generate and copy to clipboard

---

## 7. Ente Sync Boundary

Ente Auth sync is unchanged and remains OTP-only:

- Only `kind: "otp"` items participate in sync
- The Ente codec (`codec.ts`) serializes `OtpItem` fields to/from `otpauth://` URIs
- Non-OTP items are invisible to the Ente layer
- The 30-file Ente implementation on `feature/project1-release` stays as-is — it works once the monorepo builds
- Conflict resolution, coordinator, scheduler all remain functional for OTP sync

---

## 8. Scope Exclusions

- No cloud sync for non-OTP items (local + encrypted export only)
- No browser-native credential provider API integration (future)
- No form-fill for cards/identity (future — passwords and OTP only for autofill)
- No shared vaults or multi-user access
- No master password recovery (unchanged — not stored)
- No biometric unlock (future — Chrome doesn't expose platform authenticator to extensions well)
