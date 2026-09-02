# Current Project 1 manifest permissions

**Verified:** 2026-09-01 against `apps/extension/src/manifest.ts`, current output assertions, and Task 13 policy

This document describes the maintainable current Project 1 build, not the preserved ShardPass 1.2.1 root manifest. Implemented OTP, clipboard copy through the page Clipboard API, explicit click-to-fill, import/migration, backup, and fixed-origin OTP-only Ente sync do not imply undeclared manifest authority.

Task 13 changes no extension permission. Release tooling network modes are process/container policy, not manifest grants: `bootstrap` reaches one registry, `offline` reaches none, `mock` reaches loopback only, and `audit` reaches the exact registry audit endpoint. The same frozen candidate manifest and CSP are checked before a canonical `PASS-PROJECT1-RELEASE`; Node 24/Chromium 151 development-only output cannot waive a mismatch or replace actual Chrome 110 and signed external review.

## Current authority

The built manifest grants exactly `storage`, `alarms`, and `idle` API permissions.

| Manifest capability         | Current declaration                                                                                                                   | Project 0 use and rationale                                                                                                                                                                                                                             | Risk/control                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permissions`               | `storage`, `alarms`, `idle`                                                                                                           | `storage` holds authenticated encrypted generations plus non-secret settings/throttle state. `alarms` enforces inactivity lock; `idle` receives the operating-system `locked` state.                                                                    | The DEK remains in background memory only, so service-worker restart locks. Session storage stores only non-secret attempt state and is restricted to `TRUSTED_CONTEXTS`.                                                                    |
| `content_scripts.matches`   | `<all_urls>`                                                                                                                          | Retained because future field detection and user-initiated autofill must operate on arbitrary HTTP(S) sites. Project 0 keeps the production entry inert so the future topology can be built/tested without silently granting it runtime behavior later. | This is broad page reach and a broad injection surface: the tiny entry is loaded on eligible pages even though it does nothing. Any future regression gains wide exposure. Source/output tests, browser smoke, and review enforce inertness. |
| `content_scripts` execution | `document_idle`, `all_frames: false`                                                                                                  | Top-frame entry after document idle.                                                                                                                                                                                                                    | Does not solve malicious iframe/navigation problems; future frame support requires explicit policy and fresh document/origin authorization.                                                                                                  |
| extension CSP               | `script-src 'self'; object-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'` | Allows only extension-local scripts, connections, media, fonts, and styles; reviewed embedded `data:` images are also permitted.                                                                                                                        | Defense in depth; semantic network-sink scanning, safe rendering, and dependency/output review remain required.                                                                                                                              |

`<all_urls>` as a content-script match is not a `host_permissions` entry and does not itself authorize extension pages or the service worker to issue cross-origin network requests. The built manifest has no `host_permissions` and no `optional_host_permissions`. It also has no runtime network endpoint allowlist, and Project 0 has no runtime host network access or fetch/XHR behavior.

## Task 11 all-frame execution

Task 11 activates the existing `<all_urls>` content match with `all_frames: true` at `document_idle`. This broadens where the isolated controller executes, including same-origin and cross-origin child frames, but adds no host permission and no background network authority. Every fill message is authorized from browser-owned tab/frame/document/sender URL metadata and normalized origin; request payloads cannot assert sender identity. The active controller is constrained to bounded discovery, one focused-field trigger, metadata-only suggestions, and one explicitly selected five-second field-bound release.

No new API permission accompanies Task 11: permissions remain exactly `storage`, `alarms`, and `idle`; CSP is unchanged; and there is still no `tabs`, `activeTab`, optional host, clipboard, camera, downloads, context-menu, offscreen, externally-connectable, or network grant. The generated content entry and its exact local dependency closure are the only reviewed content-related web-accessible resources.

## Explicitly absent

- no `clipboardRead` and no `clipboardWrite`; Project 0 neither reads nor writes clipboard data;
- no camera permission and no live capture; Task 9.5 accepts only browser-provided local Blob/File image bytes in the trusted vault page and decodes native-accepted, one-track/one-frame PNG locally in a dedicated module Worker; browser-native decoding is the acceptance boundary, not independent structural or CRC validation;
- no `offscreen`; Argon2 and bounded QR decoding run in dedicated Workers owned by trusted extension pages, without an offscreen document;
- no `activeTab` or `tabs` permission; creating the extension-owned vault tab does not require reading privileged tab details;
- no `notifications`, `downloads`, `unlimitedStorage`, `identity`, `scripting`, `webRequest`, or native messaging; Task 10 export uses a direct user-gesture `<a download>` with a page-owned Blob object URL, revokes/replaces that URL on its bounded lifecycle, and never calls the downloads API;
- no `externally_connectable`, so websites and external extensions are not invited to message this extension;
- no web-accessible picker or API resource authored by Project 0. CRXJS lists the inert generated content entry as a build resource; this does not make a callable secret API.

Task 10 does not widen authority: backup files are selected only through the trusted full-vault page's browser file control, are size-bounded before reading, and are processed locally. There is no host/optional-host permission, network endpoint, camera, clipboard, offscreen document, popup/content backup surface, or externally connectable API. A Blob object URL is a page-local download mechanism rather than runtime network or host authority.

## Why `<all_urls>` is retained

The approved product direction requires reliable future field discovery and click-to-fill across user-selected sites. A content script cannot discover fields on an arbitrary site without matching that site. Deferring the match until Project 2 would reduce Project 0 exposure, but it would also defer testing of the install/build/runtime topology and create a permission-surface change at the moment secret behavior arrives.

The chosen trade-off is transparent rather than least possible reach: retain broad matching now, make the entry audibly inert, grant no host network authority, and treat any production content behavior as a security-reviewed change. Before Project 2 release, the team must reconsider optional host permissions or an explicit allowlist workflow and document why reliability does or does not justify continued broad matching. User-facing store disclosures must accurately describe the resulting page access.

## Future permission gate

Future needs are not current grants:

- Clipboard operations should prefer explicit user gestures and may not need manifest clipboard permissions; decide from implemented browser behavior and threat review.
- Additional alarm or idle behavior requires lock-policy tests; current use is limited to Task 5 auto-lock and system lock.
- Ente access in Project 1 must be OTP-specific and allowlist only documented endpoints; it must not become generic password sync.
- No generalized sync host is pre-authorized before its separately approved project.
- Any host, optional host, frame expansion, or API permission requires source and built-manifest assertions, updated runtime boundaries/threat model/store disclosure, and browser evidence.

## Verification

`tests/security/manifest.test.ts` asserts source policy; `tests/security/output/manifest.output.ts` asserts the built manifest and referenced files; `tests/security/csp.test.ts` and output tests enforce self-only CSP; `apps/extension/src/content/main.tsx` is the inert implementation; and browser smoke confirms the fixture does not automatically activate content behavior.

## Project 1 Task 12 Ente OTP sync

ShardPass pins the Ente compatibility contract to `ente-io/ente@c69dcf66704ad7ec1f95e32920455be429a566ef` and permits only `https://api.ente.io`. Synchronization is OTP-only (TOTP, HOTP, Steam), fixed-origin, background-owned, and active only while connected and unlocked on connect/restart/unlock/manual/exact 15-minute alarm triggers. The extension CSP is exactly `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.ente.io; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'`; `'unsafe-eval'`, custom servers, redirects, cookies, telemetry, WebSockets, and remote executable resources remain forbidden.

Reusable credentials, Auth-key material, mappings, bases, pending operations, uncertainty, and conflicts are confined to authenticated encrypted vault generation metadata. The full-vault UI receives bounded counts, times, masked email, and opaque expiring capabilities only; popup is summary-only; content scripts have no Ente authority. Memory cleanup is best effort and does not substitute for logical invalidation on lock, restart, replacement, disconnect, or stale async ownership. Disconnect is local-only: it does not delete local or remote OTP records, cannot undo a possibly dispatched request, and performs no network request. The API has no cross-device transactional CAS; snapshot reconciliation and explicit conflicts contain concurrent/uncertain writes but cannot provide impossible atomicity.

Production uses exact `libsodium-wrappers-sumo@0.8.4` with forced `libsodium-sumo@0.8.0` (ISC) and the Phase 1-selected exact SRP dependency. This is not an independent libsodium integration audit. Any protocol, dependency, CSP, WASM graph, endpoint, scheduler, or origin upgrade requires the complete Task 12 compatibility, integrity, packaged-browser, security, and license review again.
