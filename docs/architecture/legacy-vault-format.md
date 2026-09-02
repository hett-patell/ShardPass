# ShardPass 1.2.1 legacy vault format

## Scope and provenance

This document records behavior recovered from the preserved, packaged ShardPass 1.2.1 artifact. The artifact is a read-only behavioral reference. The fixture generator does not import or execute its bundles, access Chrome profiles, contact Ente, read the clipboard, or use personal data. It recreates only statically confirmed formats with Node built-ins and deterministic synthetic inputs.

Primary evidence:

- `manifest.json` confirms artifact version 1.2.1 and the packaged worker entry.
- `assets/index.ts-DTcWtSwh.js` confirms local-storage keys, envelope cryptography, vault/settings/account fields, backup wrapper, length checks, and locally persisted Ente integration/pending-operation fields.
- `assets/_commonjsHelpers-BNVkcQi_.js` identifies `otpauth` 9.5.1 and confirms OTP generation, defaults, HOTP behavior, and the Steam alphabet/algorithm.

The generator and tests independently preserve all 17 artifact file hashes. No artifact file is modified.

## Local storage values

### `vault`

The `chrome.storage.local` key `vault` contains this version-1 encrypted envelope:

```text
{
  version: 1,
  salt: base64(16 bytes),
  iv: base64(12 bytes),
  ciphertext: base64(AES-GCM ciphertext followed by its 16-byte authentication tag),
  iterations: 600000,
  createdAt: epoch milliseconds,
  updatedAt: epoch milliseconds
}
```

Key derivation and encryption are confirmed as:

1. UTF-8 encode the password.
2. PBKDF2 using SHA-256, the stored salt, and the stored iteration count (600,000 by default).
3. Derive a 256-bit AES-GCM key.
4. UTF-8 encode `JSON.stringify(plaintextVault)`.
5. Encrypt with AES-GCM and the stored 12-byte IV. No additional authenticated data is supplied.
6. WebCrypto returns ciphertext with the authentication tag appended; the complete byte string is base64 encoded.

Every save retains the envelope metadata and salt but generates a fresh random 12-byte IV, replaces ciphertext, and updates `updatedAt`. The new fixture generator uses deterministic IVs and salts solely for reproducible synthetic test data. That deterministic construction must not be copied into product cryptography.

### Plaintext vault

A new vault starts as:

```text
{ version: 1, accounts: [] }
```

Confirmed account fields observed in creation, update, OTP URI conversion, search, and sync paths are:

```text
{
  id,
  createdAt,
  issuer,
  label,
  secret,
  algorithm,  // SHA1, SHA256, SHA512
  digits,
  period,
  type,       // totp (sometimes omitted/defaulted), hotp, steam
  counter?,
  note?,
  tags?
}
```

Static validation limits issuer and label to 256 characters and the normalized Base32 secret to 1024 characters. Ente URI import truncates note and each tag to 256 characters. The synthetic boundary fixture records those safe accepted boundaries; it does not assert behavior beyond them.

The encrypted vault may contain an `integrations.ente` object. Exact locally confirmed fields are:

```text
{
  email,
  serverUrl,
  authToken,
  masterKey,
  authenticatorKey?,
  entityMap: { [remoteEntityId]: localAccountId },
  pending?: [{
    op: "create" | "update" | "delete",
    accountId,
    enteId?,
    enqueuedAt,
    attempts
  }],
  lastSync?,
  lastError?,
  needsReauth?
}
```

The fixture includes only clearly synthetic placeholder strings and no real Ente key, token, email, server, ciphertext, or account state.

### `settings`

The `chrome.storage.local` key `settings` is an unencrypted object merged over these defaults:

```text
{ autoLockMinutes: 15, lockOnScreenLock: true }
```

The fixture uses non-default deterministic values to preserve both field names and types.

### Session-only values

The worker restricts `chrome.storage.session` to trusted contexts and uses `session_key` for an exported AES key and `pending_2fa` for an in-progress Ente login. These values are not local-vault migration inputs. The exact stable schema of `pending_2fa` was not sufficiently established by static analysis, so that fixture dimension is explicitly **Unverified** and deferred rather than invented.

## Backup format

Export serializes the stored encrypted envelope without decrypting it and adds one field:

```text
{ type: "shardpass-export", ...encryptedVaultEnvelope }
```

Import requires `type === "shardpass-export"`. It accepts an absent version or version 1 and rejects other versions. It derives the key from the backup's salt/iteration count and decrypts its IV/ciphertext. The synthetic `backup-export.json` fixture preserves this exact wrapper.

## OTP behavior and sources

The known-answer corpus includes:

- RFC 4226 Appendix D HOTP at counter 0 and counter 7.
- RFC 6238 Appendix B SHA-1, SHA-256, and SHA-512 answers at 59 seconds.
- Default SHA-1/6-digit/30-second TOTP at a fixed synthetic timestamp.
- SHA-256 with 8 digits and a non-default 45-second period.
- A synthetic Steam output inferred from static code at a fixed timestamp.

RFC expectations are calculated independently in the generator and again in the test with Node HMAC. Standards-vector secrets are plaintext because the published RFC calculations require them; `known-answers.json` labels them public/synthetic and explicitly forbids real-account use.

Steam uses HMAC-SHA1 over the 30-second counter, dynamic truncation, five output characters, and the artifact's alphabet:

```text
23456789BCDFGHJKMNPQRTVWXY
```

Steam is marked `static-inference-only` with `Unverified runtime parity`, not as an RFC result or captured compatibility output. Authorized exact fixed-time execution was not attempted because the packaged API derives timestamps internally from `Date.now()`; forcing a fixed time would require a time patch/hack that changes the execution environment's semantics. The expectation is independently calculated from the visible static algorithm only. No personal or live browser state was captured.

## Fixture inventory

`tests/fixtures/legacy/fixture-manifest.json` is authoritative across both generated directories. It declares `pathBase: "project-root"`; every fixture `path` is project-root-relative. It hashes all eight legacy fixture JSON files and `tests/fixtures/otp/known-answers.json`. The manifest intentionally excludes itself from its fixture list and records that policy, avoiding recursive self-hashing without claiming a detached digest. The corpus contains:

- `vault-standard.json`: TOTP SHA-1/SHA-256/SHA-512, custom digits/period, HOTP 0/later, Steam, note/tags.
- `vault-boundaries.json`: confirmed issuer, label, secret, note, and tag boundaries.
- `vault-ente-state.json`: exact confirmed local Ente linkage and pending-operation shape with synthetic placeholders.
- `settings.json`: non-default confirmed settings.
- `wrong-password.json`: valid envelope plus an intentionally wrong test-only password; scenario `wrong-password`, category `AUTHENTICATION_FAILED`, phase `decrypt`.
- `malformed-envelope.json`: invalid IV encoding; scenario `malformed-envelope`, category `MALFORMED_ENVELOPE`, phase `validation` before KDF/decrypt.
- `tampered-ciphertext.json`: one-bit ciphertext mutation; scenario `tampered-ciphertext`, category `AUTHENTICATION_FAILED`, phase `decrypt`.
- `backup-export.json`: legacy `type: "shardpass-export"` backup.
- `tests/fixtures/otp/known-answers.json`: independent OTP vectors and provenance.

Run `node scripts/capture-legacy-fixtures.mjs` to replace the generated corpus deterministically. The manifest is generated last and contains SHA-256 of each generated file's exact bytes except itself.

The test-only strict envelope helper rejects unknown/wrong fields, noncanonical Base64, incorrect salt/IV lengths, ciphertext shorter than the 16-byte tag, unsupported version, unsafe timestamps, and iteration counts outside 1–10,000,000 before cryptography. It wraps Node cryptographic failures as stable categories without raw secrets. AES-GCM intentionally cannot distinguish a wrong key/password from modified authenticated ciphertext: both are `AUTHENTICATION_FAILED`; their fixture `scenario` metadata remains distinct.

## Unverified dimensions

The following are intentionally not invented:

- The exact persisted shape of the session-only Ente pending-2FA value.
- Live Ente server ciphertext, undocumented server responses, or real account state.

These gaps are recorded in the fixture manifest for Project 1 Task 12 follow-up. The locally persisted `integrations.ente`, `entityMap`, and `pending` operation fields are verified from static worker code and represented separately.
