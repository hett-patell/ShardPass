# Competitor Feature Catalog Design

**Date:** 2026-07-29  
**Status:** Approved design  
**Target artifact:** `docs/competitor-feature-catalog.md`

## Purpose

Create a maintainable, evidence-based catalog of capabilities offered by major password managers and authenticators. The catalog will primarily support ShardPass product-roadmap decisions rather than act as a marketing scorecard.

The initial catalog will cover:

- 1Password
- LastPass
- Bitwarden
- Dashlane
- Proton Pass
- NordPass
- Keeper
- Ente Auth

## Evidence standard

Use current official vendor documentation, help-center articles, security documentation, pricing or plan documentation, and product pages. Every material capability claim must be traceable to an official URL.

Each competitor section must include a `Last verified` date. Findings must use these normalized states where a comparison needs a status:

- **Yes:** Official documentation clearly confirms the capability.
- **Partial:** The capability exists with significant plan, platform, workflow, or item-type limitations.
- **No:** Official documentation clearly establishes that the capability is unavailable.
- **Unverified:** No sufficiently clear official source was found. Lack of evidence must not be presented as proof of absence.
- **Not applicable:** The capability is outside the product's stated role, where that distinction is useful.

Plan and platform restrictions must be recorded when they materially change the finding. Marketing terms must be translated into normalized capabilities while retaining branded names in evidence notes when useful.

## Research method

Run independent research tracks for all eight competitors. Each track will examine the same taxonomy and return:

1. A concise product-positioning summary.
2. Confirmed features grouped by taxonomy.
3. Important limitations by plan, platform, or workflow.
4. Official source URLs supporting each group of claims.
5. A last-verified date.
6. Explicit uncertainties instead of inferred answers.

Reconcile the tracks into one consistent catalog. Avoid declaring a product superior based on raw feature count; capabilities differ in depth, threat model, platform support, and target audience.

## ShardPass baseline

The catalog will document the currently observed ShardPass baseline before comparing competitors:

- Encrypted local OTP vault.
- TOTP, HOTP, and Steam-style OTP handling.
- Manual, URI, QR image, and supported migration/import workflows.
- OTP display, copy, countdown, domain matching, and in-page autofill.
- Ente Auth authentication and synchronization.
- Backup import and export.
- Auto-lock and lock-on-system-lock behavior.
- DuckDuckGo email-alias generation integration.

The baseline must distinguish verified behavior in the unpacked extension from unavailable source-level assurances. This workspace contains production bundles rather than the maintainable source repository and has no tests, source maps, package manifest, or build configuration.

## Feature taxonomy

Research and comparison will use these feature families:

1. **Vault item types**
   - Password logins, OTPs, passkeys, secure notes, identities, payment cards, documents/files, SSH keys, API/developer secrets, recovery codes, and custom items or fields.
2. **Capture, generation, and autofill**
   - Login capture, password generation, username generation, password autofill, OTP autofill, multi-step login handling, form filling, and clipboard controls.
3. **Authentication and passkeys**
   - Unlock methods, biometric unlock, security keys, passkey storage/use, account MFA, trusted-device behavior, and passwordless account access.
4. **Sharing and collaboration**
   - Individual sharing, family vaults, organization/team vaults, expiring links, external-recipient access, emergency access, and transfer controls.
5. **Sync, offline use, and hosting**
   - Cloud sync, offline access, self-hosting, custom servers, sync transparency, and conflict or history handling.
6. **Import, export, backup, and recovery**
   - Supported import sources, portable exports, encrypted exports, account recovery, emergency kits, restore/version history, and deletion behavior.
7. **Security monitoring**
   - Weak/reused-password reports, breach monitoring, compromised-site alerts, dark-web monitoring, domain or phishing protections, and administrative reporting.
8. **Privacy and cryptographic controls**
   - Encryption model, zero-knowledge claims, key derivation, audits, open-source status, telemetry/privacy controls, secret exposure boundaries, and local-only options.
9. **Platform coverage**
   - Browser extensions, web application, desktop, mobile, command line, supported browsers, and notable platform disparities.
10. **Administration and business**
    - Provisioning, SSO, SCIM, policies, access controls, reporting, event logs, secrets management, and developer or MSP capabilities.
11. **Convenience and adjacent services**
    - Email aliases, masked email, VPN/bundles, travel mode, digital legacy, attachment handling, and other differentiated services.

The catalog may add a narrowly defined capability discovered during research, but it must place it under an existing family unless a genuinely distinct family is required.

## Target document structure

`docs/competitor-feature-catalog.md` will contain:

1. **Purpose and reading guide** — Scope, evidence rules, normalized statuses, and research date.
2. **Executive findings** — Cross-market patterns and the most relevant implications for ShardPass.
3. **ShardPass baseline** — Current verified capabilities and structural limitations.
4. **Feature comparison** — Manageable tables split by feature family rather than one oversized matrix.
5. **Competitor evidence notes** — One section per product with official links, restrictions, uncertainties, and verification date.
6. **ShardPass opportunity backlog** — Normalized candidate capabilities classified as `Now`, `Next`, `Later`, or `Out of scope`.
7. **Maintenance procedure and log** — Instructions and a dated record of future research updates.

## Roadmap classification

The opportunity backlog will use:

- **Now:** Natural extensions of ShardPass's OTP mission with high user value and limited architectural expansion.
- **Next:** Valuable capabilities requiring deliberate schema, UI, sync, or security work.
- **Later:** Larger password-manager or platform capabilities that should follow a generalized item architecture.
- **Out of scope:** Enterprise, bundle, or adjacent-service capabilities that do not fit the likely ShardPass product direction.

Each candidate will record:

- Normalized capability name.
- User value.
- Competitors with verified implementations.
- ShardPass's current state.
- Major prerequisites or architectural dependencies.
- Security/privacy considerations.
- Suggested priority and rationale.

Priorities are research recommendations, not committed implementation decisions.

## Quality controls

Before considering the catalog complete:

- Check that all eight competitors are represented.
- Ensure material claims use official sources.
- Check links for obvious errors and remove duplicate citations.
- Mark unclear findings `Unverified`; do not infer absence.
- Separate free/paid, consumer/business, and platform restrictions where material.
- Normalize equivalent branded features without erasing meaningful differences.
- Avoid unsupported cryptographic or security comparisons.
- Ensure roadmap recommendations account for ShardPass's OTP-centric schema and Ente Auth-specific sync boundary.
- Scan for stale dates, placeholders, contradictions, and oversized unreadable tables.

## Constraints

- This directory is not a Git repository, so the design and catalog cannot be committed here.
- The available ShardPass package is an unpacked production build, so source-level implementation guarantees cannot be made.
- Competitor products and plans change frequently; this document is a dated research snapshot and must expose its maintenance history.
- No competitor account purchases or authenticated plan testing are required. Official public documentation is the evidence boundary.

## Deliverable acceptance criteria

The work is complete when:

1. `docs/competitor-feature-catalog.md` exists.
2. All eight products have dated, official-source-backed research.
3. The comparison spans all defined feature families where applicable.
4. ShardPass's current state is clearly separated from competitor claims.
5. An actionable but non-binding `Now / Next / Later / Out of scope` opportunity backlog is included.
6. Uncertainties and plan/platform constraints are explicit.
7. The catalog includes instructions and a log structure for future maintenance.
