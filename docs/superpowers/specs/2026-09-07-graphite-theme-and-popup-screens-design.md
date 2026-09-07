# Graphite theme and 1Password-style popup screens

Date: 2026-09-07. Status: approved by direction ("first understand the theme and implement it").

## Why

The current UI reads as a generic template: blue accent, 6–8 px rounding, system font, light-first,
and a popup that pours every item kind into one list. The v1.2.1 `main` branch has a coherent
identity — a dark graphite surface system with a single vermillion accent, sharp corners, Inter
Tight text and IBM Plex Mono for codes and labels — and that identity is what this design carries
forward to the password manager. The popup gains the screen structure of a real password manager
(1Password's): a home screen with suggestions for the current site and categories, list screens
per category, and a detail screen per item.

## Design language (carried from `main`, tuned for density)

- **Surfaces (dark, default):** background `#0c0c0d`, subtle `#131316`, card `#18181b`, elevated
  `#1c1c20`. **Light variant** (toggle): `#fafafa`, `#f4f4f5`, `#ffffff`, `#ffffff`.
- **Ink:** primary `#f4f4f5`, secondary `#a1a1aa`, tertiary `#71717a` (≥4.5:1 on background).
  Light: `#111113`, `#52525b`, `#71717a`.
- **Accent:** vermillion `#ff4d2e` for focus rings, selection, active states and icons; a deeper
  fill `#d9391b` with white text for filled buttons (4.6:1). No second accent colour.
- **Lines:** border `#26262b`, soft `#1d1d21`, strong `#3a3a40`. Light: `#e4e4e7` / `#ececef` /
  `#d4d4d8`. 1 px everywhere; no side stripes.
- **Geometry:** radii 2 px (controls), 4 px (panels). Swiss, not rounded.
- **Type:** Inter Tight 400/500/600/700 (self-hosted via @fontsource; the CSP forbids Google
  Fonts, correctly). IBM Plex Mono 400/500/600 for codes, secrets, section labels. Body 14 px,
  letter-spacing −0.005em, features `ss01`/`cv11`. Scale: 11.5 / 13 / 14 / 16 / 20 / 24 px.
- **Section labels:** mono, 10.5 px, 500, 0.14em tracking, uppercase, tertiary ink. Used for
  list-section headings only (SUGGESTIONS, CATEGORIES, field names), never as decorative eyebrows.
- **Focus:** `0 0 0 1px background, 0 0 0 2px accent`. Sharp. Same on every control.
- **Motion:** 200 ms `cubic-bezier(0.16, 1, 0.3, 1)`. Screens slide 12 px in from the right on push
  and from the left on pop; dialogs fade-scale from 0.97. Reduced motion: crossfade only.
- **Density:** the previous UI was compact for its own sake. Rows are 48 px in the popup and 44 px
  in the vault, gutters 16 px, controls 36–40 px, detail panels padded 24 px.

## Popup information architecture

Width 400 px, height 560 px. Screens form a stack; back returns to the previous one.

1. **Locked** — unlock form. Same theme; the vault mark, a heading, one field, one button.
2. **Home** — title bar (mark, "ShardPass", lock and settings icons); a search field; then
   - **SUGGESTIONS** — logins whose URLs match the active tab (needs `activeTab`), each with
     *Fill* as the primary action and copy username/password as secondary. Empty: one quiet line
     naming the host. Hidden when the tab has no http(s) URL.
   - **CATEGORIES** — Favorites, All items, Logins, One-time codes, Notes, Cards, Identities,
     Secrets: icon, label, count, chevron.
   - Footer: *New item* (opens the vault's create form), *Open vault*.
3. **List** — back + category title; rows with kind icon, name, subtitle; right side is the
   quick action (copy password / live one-time code); the row opens the detail screen. Typing in
   the home search shows a **Search** list of every kind.
4. **Detail** — back + kind icon + name + subtitle; fields with mono-caps labels, values and a copy
   button each: username, password (reveal), one-time code (live with countdown), websites (open),
   notes; card and identity fields likewise; *Fill in this tab* when the tab matches; *Edit in
   vault* always.

Trust boundary change: the popup may now send `item.get` (the detail screen needs the whole item).
The popup and the vault page are the same extension origin; the earlier "projections only" rule
was defence in depth that a detail screen cannot honour. Content scripts remain restricted.

*Fill* from the popup: the popup asks the active tab's content script (a new `login.fillFromPopup`
runtime message, accepted only from the extension itself) to run its existing fill path — the
content script performs `login.fillSelect` under its own content-only policy, fills the focused or
first detected login form, and answers `filled` / `no-form`. The popup then closes.

## Vault page

Same tokens (everything re-themes through them) plus the density pass above. No functional change.

## Testing

DOM tests: home shows suggestions and categories, category → list → detail navigation, search
results across kinds, Fill sends the tab message, copy actions, axe on every screen. Policy tests
for `item.get` from the popup. Content-script test for `login.fillFromPopup`. The Chrome-110
syntax pin on vault stylesheets stays.

## Addendum (2026-09-07, later): identity on top, several accounts per site, passkeys

### Identity on top

The popup's home screen pins the person's own identity above everything else: initials
avatar, name, email (the identity item marked favourite, else the first identity). Tapping it
opens the identity's detail with every field copyable. The list projection for identities
carries the email as its subtitle so the pin needs no extra request.

### Several accounts per site

Suggestions and the in-page picker already list every login whose URLs match; nothing is
collapsed to "first match". What was missing is saving: the in-page prompt after a submit
offered "Save" but only opened the vault page, because content scripts may not create items.
Now the offer is held in the background (`login.saveOffer` answers with an offer id and what
the vault already has for that host: nothing, the same username with the same password,
or the same username with a different password). The banner then reads "Save new login" or
"Update password for <username>", and `login.saveConfirm` (content-only, carrying only the
offer id and the person's choice) creates or updates the item in the background. Offers
expire in five minutes and hold the password only in the worker's memory.

### Passkeys

Chrome gives ordinary extensions no passkey-provider API; managers that offer passkeys
(Bitwarden, 1Password) intercept WebAuthn in the page instead. ShardPass does the same:

- A dependency-free **main-world script** (built separately as an IIFE and added to the
  manifest by a post-build plugin, because the crx loader cannot run outside the isolated
  world) wraps `navigator.credentials.create` and `get`. When a call carries `publicKey`
  options, it asks the isolated content script over `window.postMessage` (tagged, id-matched)
  and waits. "fallback" answers hand the call to the browser's own implementation.
- The **content script** builds `clientDataJSON` itself from the real origin, shows the
  prompt in its closed shadow root ("Create a passkey for <rpId> as <user>?" naming the login
  it will attach to, or "Sign in with a passkey" listing candidates), and talks to the
  background with a content-only `passkey.*` family. The vault must be unlocked; otherwise
  the prompt says so and the call falls back.
- The **background** owns keys: ES256 (P-256) pairs generated with WebCrypto, stored on the
  login item (`passkeys[]`: credential id, rp id, user handle, user name, private key PKCS#8,
  COSE public key, counter, created at) — the same place 1Password keeps them, so the passkey
  lives with the account it belongs to. It produces the attestation object (`fmt: "none"`,
  CBOR) and, for assertions, the authenticator data and a DER-encoded ECDSA signature over
  `authenticatorData || sha256(clientDataJSON)`. rpId must be the origin's host or a parent
  domain of it.
- The **page script** returns an object shaped like `PublicKeyCredential` (id, rawId, type,
  response with `clientDataJSON`, `attestationObject` / `authenticatorData` + `signature` +
  `userHandle`, the accessor methods, `getClientExtensionResults`, `toJSON`), with the real
  `PublicKeyCredential.prototype` as its prototype so `instanceof` holds.
- Vault and popup detail screens list a login's passkeys (rp, user, created) and allow
  deletion. `minimum_chrome_version` rises to 111 for main-world content scripts.
