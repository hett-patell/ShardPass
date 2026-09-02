# Competitor feature catalog

**Research date:** 2026-07-29  
**Status:** Maintained roadmap input, not a marketing ranking

## Purpose and reading guide

This catalog normalizes officially documented capabilities of 1Password, LastPass, Bitwarden, Dashlane, Proton Pass, NordPass, Keeper, and Ente Auth. It helps prioritize ShardPass work; raw feature count does not establish security, depth, usability, or product superiority.

Evidence uses official product, help, pricing, security, incident, and source-repository pages available on the research date. Statements about encryption, “zero knowledge,” audits, or open source are vendor claims unless independently established; a linked audit announcement is not a blanket assurance. Consumer/business, paid/free, region, browser, OS, item-type, and workflow caveats matter.

Normalized matrix states:

- **Yes:** official documentation clearly confirms the capability.
- **Partial:** confirmed with a material plan, platform, workflow, or item-type limitation.
- **No:** an official source clearly establishes unavailability; used sparingly.
- **Unverified:** no sufficiently clear official source was found; absence is not inferred.
- **Not applicable:** outside the product's stated role.

Compact cells use `Y`, `P`, `N`, `U`, and `NA` respectively. Links in evidence notes control if a compact matrix loses nuance. “Last verified” is the date the source was assessed, not a promise that the vendor has not changed it.

## Executive findings

- Mature password managers converge on login generation/autofill, cross-device sync, import/export, sharing, health reporting, and broad platform coverage, but plan and workflow details vary substantially.
- Passkeys, aliases/masked email, family/business collaboration, and developer item types are differentiators, not equivalent implementations. Vendor terminology must not be treated as interoperability.
- Bitwarden documents self-hosting; that does not imply every competitor lacks it. Unclear cells remain `U`.
- Ente Auth is an authenticator centered on OTP accounts, encrypted backup/sync, import/export, and sharing. It is not an eight-product password-manager equivalent and should not receive forced `No` values for unrelated families.
- The clearest ShardPass sequence remains: prove safe OTP migration/portability and local vault foundations, then exact-origin user-initiated login fill. Sharing, hosted sync, passkeys, monitoring, and enterprise administration expand the threat model and should follow separately.
- Security marketing is not normalized into a winner. The catalog records vendor-described models and review publications with their scope. LastPass's official account of its 2022 incident is included because incident response and recovery architecture are roadmap inputs.

## ShardPass verified baseline and future plans

### Current verified Project 0 baseline

The maintainable Project 0 build is an MV3 TypeScript foundation with popup, empty full-page vault shell, inert top-frame `<all_urls>` content entry, strict versioned message validation/authorization, fixed safe errors, self-only CSP, local UI assets/fallback fonts, and build/browser/security tests. It requests only `storage`; current clean source does not use storage or handle a real secret. `vaultAvailable` is fixed to `false`.

The preserved root ShardPass 1.2.1 package describes itself as a TOTP authenticator and declares OTP-oriented behavior, but it is minified legacy evidence without maintainable source, source maps, lockfile, or parity tests. Its observed OTP/import/Ente/alias behavior is migration research, not a capability claim for the clean Project 0 build.

### Approved future direction, not implemented

Project 1 plans a typed encrypted local vault, verified legacy migration, TOTP/HOTP/Steam parity, OTP import/export, lock behavior, and OTP-specific Ente interoperability. Project 2 plans login records, generation/capture, exact-HTTPS-origin policy, and click-to-fill by default with immediate origin/frame/document revalidation. Projects 3+ (notes/cards/identities/history, health, generalized sync, passkeys, sharing, aliases/developer/business work) need separate specifications and security gates.

Ente Auth interoperability remains OTP-specific. Its current authenticator APIs and repositories must not be presented as a stable generic vault sync API, and login passwords must never be projected into the Ente Auth integration without a separately approved protocol—which is not planned in Projects 0–2.

## Feature comparison

Abbreviations: `1P` 1Password, `LP` LastPass, `BW` Bitwarden, `DA` Dashlane, `PP` Proton Pass, `NP` NordPass, `KE` Keeper, `EA` Ente Auth.

### Vault, capture, authentication, and platforms

| Capability                        | 1P  | LP  | BW  | DA  | PP  | NP  | KE  | EA  |
| --------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- |
| Password logins                   | Y   | Y   | Y   | Y   | Y   | Y   | Y   | NA  |
| OTP storage/code generation       | Y   | Y   | Y   | Y   | Y   | Y   | Y   | Y   |
| Secure notes/cards/identities     | Y   | Y   | Y   | Y   | Y   | Y   | Y   | NA  |
| Passkey save/use                  | Y   | Y   | Y   | Y   | Y   | Y   | Y   | NA  |
| Login capture/generation/autofill | Y   | Y   | Y   | Y   | Y   | Y   | Y   | NA  |
| OTP autofill                      | Y   | U   | Y   | Y   | Y   | Y   | Y   | P   |
| Biometric unlock                  | P   | P   | P   | P   | P   | P   | P   | P   |
| Browser + mobile coverage         | Y   | Y   | Y   | Y   | Y   | Y   | Y   | P   |
| CLI                               | Y   | U   | Y   | U   | Y   | U   | Y   | Y   |

These rows describe documented product families, not identical support. For example, browser/mobile biometric behavior depends on device integration; OTP storage may depend on plan; Ente Auth's autofill is OTP-specific; and CLI scope differs. Sources and caveats are in product notes.

### Sharing, sync, portability, monitoring, and business

| Capability                        | 1P  | LP  | BW  | DA  | PP  | NP  | KE  | EA  |
| --------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- |
| Individual/family sharing         | Y   | Y   | Y   | Y   | Y   | Y   | Y   | Y   |
| Business/team vaults              | Y   | Y   | Y   | Y   | Y   | Y   | Y   | NA  |
| Cloud synchronization             | Y   | Y   | Y   | Y   | Y   | Y   | Y   | Y   |
| Self-hosting documented           | U   | U   | Y   | U   | U   | U   | U   | NA  |
| Portable export                   | Y   | Y   | Y   | Y   | Y   | Y   | Y   | Y   |
| Encrypted portable export         | N   | U   | Y   | U   | Y   | U   | U   | Y   |
| Password-health reporting         | Y   | Y   | Y   | Y   | Y   | Y   | Y   | NA  |
| Breach/dark-web monitoring        | P   | P   | P   | Y   | P   | P   | P   | NA  |
| SSO/SCIM/admin policies           | Y   | Y   | Y   | Y   | Y   | Y   | Y   | NA  |
| Published security/audit material | Y   | Y   | Y   | Y   | Y   | Y   | Y   | Y   |
| Public source availability        | P   | U   | Y   | P   | Y   | U   | P   | Y   |

`Portable export` means an officially documented user-controlled export suitable for backup or migration; it does not mean the exported file is encrypted. `Encrypted portable export` is `Y` only where the reviewed official source clearly documents an encrypted export/backup file. It is `U` where export exists but the reviewed source does not clearly establish an encrypted portable format. 1Password is `N` because its official export documentation explicitly says exported data is not encrypted. Other `P` cells deliberately group unlike restrictions such as plan gating, only some clients being public source, or monitoring limited to selected identifiers. Evidence notes control before roadmap use.

### Convenience and differentiated scope

| Capability                        | 1P  | LP  | BW  | DA  | PP  | NP  | KE  | EA  |
| --------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- |
| Email alias/masked email workflow | P   | U   | Y   | P   | Y   | Y   | P   | NA  |
| Travel/restricted-vault mode      | Y   | U   | U   | U   | U   | U   | U   | NA  |
| Emergency/digital legacy access   | P   | Y   | Y   | Y   | U   | Y   | Y   | NA  |
| SSH/developer secret features     | Y   | U   | Y   | U   | P   | U   | Y   | NA  |
| Attachments/files                 | Y   | Y   | Y   | Y   | U   | Y   | Y   | NA  |
| Adjacent VPN/service bundle       | U   | U   | U   | Y   | Y   | Y   | U   | NA  |

`U` means the reviewed official sources did not clearly settle the normalized capability; it is not “No.”

## Competitor evidence notes

### 1Password

**Last verified: 2026-07-29.** 1Password documents logins and other item categories, Watchtower, Travel Mode, passkeys, sharing, developer/SSH workflows, and business administration. Availability varies by app/browser, account/plan, item type, and recipient workflow. Security descriptions and audit publications are 1Password/vendor claims with specific scopes, not independent endorsement by this catalog.

- Items, saving/filling, and supported apps: https://support.1password.com/item-categories/ and https://support.1password.com/save-fill-passwords/
- Passkeys and authenticator codes: https://support.1password.com/save-use-passkeys/ and https://support.1password.com/one-time-passwords/
- Sharing and Travel Mode: https://support.1password.com/share-items/ and https://support.1password.com/travel-mode/
- Watchtower: https://support.1password.com/watchtower/
- Import/export caveats: https://support.1password.com/import/ and https://support.1password.com/export/
- Security model and published assessments: https://support.1password.com/1password-security/ and https://support.1password.com/security-assessments/
- Business/SCIM and developer tooling: https://support.1password.com/scim/ and https://developer.1password.com/

Important caveats: shared links and vault sharing have different recipient controls. Portable export is **Yes**, but encrypted portable export is **No**: 1Password's official export documentation says exported data is not encrypted, including the portable 1PUX export, so exported files must be protected and deleted carefully. Command-line/developer and business administration are not equivalent to consumer UI features. Public source status is `Partial`, not a claim that the complete service is open source.

### LastPass

**Last verified: 2026-07-29.** LastPass documents password generation/autofill, secure notes and form-fill items, sharing/families, emergency access, security dashboard/dark-web monitoring, passkeys, import/export, authenticator support, and business federation/administration. Free/Premium/Families/Business entitlements and supported clients differ.

- Core password manager and plans: https://www.lastpass.com/features and https://www.lastpass.com/pricing
- Passkeys and MFA/authenticator: https://support.lastpass.com/s/document-item?language=en_US&bundleId=lastpass&topicId=LastPass/save-passkeys.html and https://support.lastpass.com/s/document-item?language=en_US&bundleId=lastpass&topicId=LastPass/set-up-mfa.html
- Sharing and emergency access: https://support.lastpass.com/s/document-item?language=en_US&bundleId=lastpass&topicId=LastPass/share-an-item.html and https://support.lastpass.com/s/document-item?language=en_US&bundleId=lastpass&topicId=LastPass/emergency-access.html
- Import/export: https://support.lastpass.com/s/document-item?language=en_US&bundleId=lastpass&topicId=LastPass/import-passwords.html and https://support.lastpass.com/s/document-item?language=en_US&bundleId=lastpass&topicId=LastPass/export-vault-data.html
- Security dashboard: https://www.lastpass.com/features/security-dashboard
- Business administration: https://www.lastpass.com/products/business
- Vendor security program: https://www.lastpass.com/security

Incident note: LastPass's official 2022 incident notice states that an unauthorized party used information from an earlier development-environment incident to access cloud backups and copy customer vault data; it describes encrypted and unencrypted fields and recommended actions. This is a vendor incident account, not a complete independent forensic conclusion: https://blog.lastpass.com/posts/notice-of-recent-security-incident

Important caveats: portable export is **Yes**, but encrypted portable export is **Unverified** from the reviewed official export source; plaintext exports require careful handling. Third-party vault-integrated TOTP autofill is also **Unverified**: the reviewed official material confirms account MFA setup and LastPass Authenticator capabilities, but account MFA, LastPass Authenticator code generation/approval, storage of a vault TOTP secret, and automatic filling of that third-party site's code are distinct capabilities. The MFA/authenticator pages are not evidence of vault-integrated TOTP autofill. Features and device access vary by plan. Public source availability remained `Unverified` rather than inferred absent.

### Bitwarden

**Last verified: 2026-07-29.** Bitwarden officially documents login/identity/card/secure-note and custom item handling, TOTP, passkeys, generators/autofill, Send, emergency access, organizations, reports, import/export, CLI, self-hosting, and enterprise administration. Some capabilities are Premium, Families, Teams, or Enterprise features.

- Product/help overview and vault items: https://bitwarden.com/help/getting-started-webvault/ and https://bitwarden.com/help/managing-items/
- Autofill, generator, TOTP, and passkeys: https://bitwarden.com/help/auto-fill-browser/ https://bitwarden.com/help/generator/ https://bitwarden.com/help/integrated-authenticator/ https://bitwarden.com/help/storing-passkeys/
- Sharing/organizations and Send: https://bitwarden.com/help/about-organizations/ and https://bitwarden.com/help/about-send/
- Import/export and encrypted exports: https://bitwarden.com/help/import-data/ and https://bitwarden.com/help/encrypted-export/
- Self-hosting and CLI: https://bitwarden.com/help/self-host-an-organization/ and https://bitwarden.com/help/cli/
- Security reports, white paper, audits: https://bitwarden.com/help/reports/ https://bitwarden.com/help/bitwarden-security-white-paper/ https://bitwarden.com/help/is-bitwarden-audited/
- Source code: https://github.com/bitwarden

Important caveats: self-hosting transfers operational security/availability duties; organization ownership changes sharing semantics; encrypted exports have compatibility/account constraints documented by Bitwarden. Audit and cryptographic descriptions remain scoped vendor publications.

### Dashlane

**Last verified: 2026-07-29.** Dashlane documents password/passkey saving and autofill, secure notes/personal information/payments, sharing, Friends & Family, password health, dark-web monitoring, import/export, recovery options, and business SSO/SCIM/policies. Desktop support is primarily web-app/browser-extension centered; exact availability varies by platform and plan.

- Save/fill and generated passwords: https://support.dashlane.com/hc/en-us/articles/202625092 and https://support.dashlane.com/hc/en-us/articles/202699141
- Passkeys and 2FA tokens: https://support.dashlane.com/hc/en-us/articles/7888558064274 and https://support.dashlane.com/hc/en-us/articles/202625042
- Item types and sharing: https://support.dashlane.com/hc/en-us/articles/202699101 and https://support.dashlane.com/hc/en-us/articles/202699121
- Import/export: https://support.dashlane.com/hc/en-us/articles/360004101920 and https://support.dashlane.com/hc/en-us/articles/202625092-Export-Dashlane-data
- Password Health and Dark Web Monitoring: https://support.dashlane.com/hc/en-us/articles/202699181 and https://support.dashlane.com/hc/en-us/articles/115004155145
- Plans and business administration: https://www.dashlane.com/pricing and https://support.dashlane.com/hc/en-us/categories/360001186479
- Vendor security information: https://www.dashlane.com/security

Important caveats: plan, admin policy, browser, and account-recovery setup change results. “VPN” is an adjacent plan benefit, not a vault primitive. Public source status is `Partial`; do not infer service-wide openness from selected publications.

### Proton Pass

**Last verified: 2026-07-29.** Proton Pass documents logins, notes, cards, identities, passkeys, integrated 2FA, aliases, sharing, import/export including encrypted backup, browser/mobile/desktop clients, CLI, and business plans. Plan limits, Proton ecosystem integration, and platform rollout materially qualify features.

- Features and plans: https://proton.me/pass and https://proton.me/pass/pricing
- Pass support index (items, aliases, sharing, import/export, CLI) and passkeys: https://proton.me/support/pass and https://proton.me/support/pass-use-passkeys
- 2FA authenticator: https://proton.me/support/pass-2fa
- Import/export: https://proton.me/support/pass-import and https://proton.me/support/pass-export
- Platforms: https://proton.me/pass/download
- Vendor security model and source: https://proton.me/pass/security and https://github.com/ProtonMail

Important caveats: free/paid limits and Proton plan bundles change aliases, vaults, sharing, and monitoring. Developer/SSH scope is `Partial` rather than equating CLI with full secrets management. Security and audit statements are vendor-scoped claims.

### NordPass

**Last verified: 2026-07-29.** NordPass documents password generation/autofill, secure notes/cards/personal information, passkeys, authenticator codes, sharing, emergency access, import/export, password health/data-breach scanning, masked email, and business SSO/SCIM/admin capabilities. Features differ by Free, Premium, Family, Teams, Business, Enterprise, platform, and browser.

- Features and plans: https://nordpass.com/features/ and https://nordpass.com/plans/
- Passkeys and authenticator: https://support.nordpass.com/hc/en-us/articles/12042177018908 and https://support.nordpass.com/hc/en-us/articles/360002770517
- Sharing and emergency access: https://support.nordpass.com/hc/en-us/articles/360002795397 and https://support.nordpass.com/hc/en-us/articles/360011866317
- Import/export: https://support.nordpass.com/hc/en-us/articles/360002770957 and https://support.nordpass.com/hc/en-us/articles/360002771037
- Password health, breach scanning, and masked email: https://nordpass.com/features/
- Business administration: https://nordpass.com/business-password-manager/
- Vendor security publication: https://nordpass.com/security/

Important caveats: sharing recipients, emergency-access waiting periods, breach scan inputs, and business controls have workflow/plan restrictions. Complete public source availability was `Unverified`.

### Keeper

**Last verified: 2026-07-29.** Keeper documents passwords and diverse record types, TOTP, passkeys, autofill, secure sharing/One-Time Share, emergency access, import/export/backup, BreachWatch, broad clients/CLI, enterprise administration, and separate secrets/PAM products. Consumer, Family, Business, Enterprise, and add-on boundaries are significant.

- Records, KeeperFill, and passkeys: https://docs.keeper.io/en/user-guides/keeperfill-for-apps and https://docs.keeper.io/en/user-guides/passkeys
- Sharing and One-Time Share: https://docs.keeper.io/en/user-guides/sharing and https://docs.keeper.io/en/user-guides/one-time-share
- Emergency access: https://docs.keeper.io/en/user-guides/emergency-access
- Export/report guidance: https://docs.keeper.io/en/user-guides/export-and-reports
- BreachWatch: https://docs.keeper.io/en/user-guides/breachwatch
- Plans and enterprise platform: https://www.keepersecurity.com/pricing/personal-and-family.html and https://www.keepersecurity.com/enterprise.html
- Vendor security publication: https://www.keepersecurity.com/security.html

Important caveats: Keeper Secrets Manager/PAM is not the same entitlement or threat model as the consumer vault; BreachWatch and storage add-ons can be plan-dependent. Public source status is `Partial`, and vendor audit/certification pages should be read by exact product/scope/date.

### Ente Auth

**Last verified: 2026-07-29.** Ente Auth is an OTP-specific authenticator, not a general password manager. Official documentation and public repositories describe end-to-end encrypted backup/synchronization, multi-device and offline access, import/export, account organization/search, sharing, autofill support on applicable platforms, web/desktop/mobile apps, and CLI tooling.

- Product and Auth help index (FAQ, sharing, autofill): https://ente.io/auth/ and https://help.ente.io/auth
- Current encrypted export, import, decryption, and local-backup documentation: https://ente.com/help/auth/migration/export/
- Encrypted hosted-sync architecture: https://ente.io/architecture/
- Open-source apps/server and CLI: https://github.com/ente-io/ente and https://github.com/ente-io/ente/tree/main/cli
- Published cryptography audit: https://ente.io/blog/cryptography-audit/

Important caveats: Ente's end-to-end encrypted hosted backup/sync and its user-controlled portable encrypted file export are distinct capabilities, and current official documentation confirms both exist. Encrypted portable export is **Yes**: Ente Auth exports password-protected encrypted JSON, derives the key with Argon2id, and encrypts authentication data with XChaCha20-Poly1305. Users can import it through `Ente Encrypted export`, decrypt it using the Ente CLI, and select a local backup location for password-protected on-device backups. This current migration documentation supersedes the prior round's inference from an older FAQ that only a plain HTML export was documented. Generic password login items, cards, identity filling, password capture/generation, password health, passkeys, and enterprise vault administration are `Not applicable` to its stated authenticator role rather than inferred `No`. Ente Auth's current APIs/repositories are not a stable generic vault sync API for ShardPass. Project 1 interoperability is limited to OTP projection and must track authentication/API changes explicitly.

## ShardPass opportunity backlog

Recommendations are roadmap inputs, not commitments.

| Priority     | Capability                                           | User value and verified examples                                                                            | ShardPass state                              | Dependencies                                                                                    | Security/privacy and rationale                                                                       |
| ------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Now          | Verified OTP migration and portable backup           | Preserves existing accounts; all authenticator/password-manager products document portability in some form. | Legacy behavior observed; clean P0 has none. | Typed OTP schema, authenticated encryption, fixture corpus, atomic migration/import/export.     | Never delete source before verification; warn on plaintext; foundation for user trust and P1 parity. |
| Now          | TOTP/HOTP/Steam parity with safe copy/display        | Core existing mission; OTP support is documented by all eight in product-specific form.                     | Future Project 1.                            | Clock/counter correctness, lock/session model, redaction tests, accessible non-secret fixtures. | Seeds/codes never enter logs/snapshots; clipboard exposure explicit.                                 |
| Now          | Click-to-fill OTP with strict context checks         | Avoids clipboard and reduces typing; multiple products document OTP fill.                                   | Future Project 1.                            | Origin mapping, tab/frame/document policy, user gesture, minimum projection.                    | Fresh origin revalidation and no whole-vault response; natural OTP extension.                        |
| Next         | Login records, generator, capture, exact-origin fill | High baseline password-manager value, documented across seven password managers.                            | Future Project 2.                            | Generalized item schema, encrypted storage, picker/save UX, phishing/downgrade tests.           | Click-to-fill default; capture is untrusted input; no auto-submit.                                   |
| Next         | Recovery-safe encrypted export and history           | Reduces lockout/data loss; vendors document varied backup/recovery.                                         | Planned beyond initial vault details.        | Versioned format, key/recovery design, destructive-action UX.                                   | Recovery can weaken confidentiality; independently review semantics before implementation.           |
| Next         | Local password health                                | Identifies weak/reused credentials without mandatory disclosure.                                            | Future Project 4.                            | Login corpus, local analysis, remediation UX.                                                   | Prefer local computation; breach checks need separately reviewed K-anonymous network boundary.       |
| Later        | Open E2EE generalized sync                           | Multi-device value; competitors offer cloud sync and Bitwarden documents self-hosting.                      | Future Project 5.                            | Conflict/history protocol, server, account/recovery model, crypto review, operations.           | Largest trust/availability expansion; Ente remains OTP-specific, not generic sync.                   |
| Later        | Passkeys                                             | Growing phishing-resistant workflow, documented across seven password managers.                             | Future Project 6.                            | WebAuthn integration, platform/browser lifecycle, recovery/portability model.                   | Requires dedicated external review; do not imply security merely from feature presence.              |
| Later        | Sharing/family/emergency access                      | Collaboration and recovery value, broadly documented.                                                       | Future Project 7.                            | Identity, authorization, recipient keys, revocation/history, sync.                              | Consent, metadata, revocation, recovery, and abuse model are substantial.                            |
| Later        | Alias-provider adapters                              | Privacy/convenience; Bitwarden, Proton Pass, NordPass and others document integrations/services.            | Future Project 8 candidate.                  | Provider interface, user consent, endpoint/privacy review.                                      | Avoid a bundled surveillance/network dependency; adapters remain optional.                           |
| Out of scope | VPN/service bundles and dark-web brokerage           | Adjacent commercial packaging rather than local vault core.                                                 | None.                                        | Separate services, accounts, operations, legal/privacy program.                                 | Distracts from safe vault fundamentals; partner claims/data sharing need separate governance.        |
| Out of scope | SSO/SCIM/SIEM/PAM/MSP administration                 | Valuable to enterprises; seven password managers document business offerings.                               | Explicit non-goal for Projects 0–2.          | Organization control plane, audit pipeline, sales/support/compliance.                           | High-impact multi-user authority and metadata; not justified for current personal product direction. |

## Maintenance procedure and log

### Procedure

1. Recheck quarterly and before roadmap/security decisions, major vendor releases, plan changes, incidents, or deprecations.
2. Use only official product/help/pricing/security/incident/source pages for catalog claims. Record independent analysis separately rather than laundering it into a vendor fact.
3. Open each material URL, record date and access result, and preserve title/scope where practical. A redirect, bot challenge, client-rendered shell, or transient error is an access exception—not evidence that a claim is false.
4. Update one normalized capability at a time; retain plan/platform/workflow caveats nearby. Use `Unverified` when official evidence is unclear and reserve `No` for explicit official unavailability.
5. Treat vendor crypto, zero-knowledge, open-source, audit, certification, and incident statements as scoped claims. Do not compare algorithms or assurances without matching product, client/server boundary, version, audit scope, and date.
6. Reconcile matrices, product notes, executive findings, and backlog. Run `pnpm exec vitest run tests/security/docs.test.ts`; tests check structure/evidence hygiene, not marketing truth.
7. Append the maintenance log with products/rows changed, sources checked, inaccessible URLs/exceptions, reviewer, and security/roadmap implications.

### Log

| Date       | Scope                                                                                            | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-29 | Initial official-source synthesis for all eight products and ShardPass Project 0/future boundary | Catalog created with normalized statuses, plan/platform caveats, official evidence, incident note, opportunity backlog, and explicit uncertainty. Best-effort non-authenticated HTTP checking reached 66 of 90 unique URLs with 2xx/3xx status. Exceptions were six client-rendered LastPass support URLs (`000`), the official LastPass incident page (`403`), eleven Dashlane support URLs (`403`), and six NordPass support URLs (`403`). These bot/dynamic access results are not treated as false claims; exact exception URLs are preserved in the Task 11 execution-ledger entry. |
