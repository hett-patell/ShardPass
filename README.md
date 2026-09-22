# ShardPass

ShardPass is a local-first password manager for Chrome and Brave. There is no account and no
server: the vault is encrypted on the machine it lives on with a key derived from the master
password, and it stays there.

It keeps logins, passkeys, one-time codes, cards, identities, notes, API credentials and SSH
keys, fills them into the page you are on, and reports on weak, reused and breached passwords.
Imports come from thirteen formats; backups are an encrypted file you hold. Three features
reach the network, each off until switched on: breach checks (a password hash prefix), Ente
sync for one-time codes, and DuckDuckGo email aliases.

- What each release changed: [CHANGELOG.md](CHANGELOG.md)
- What leaves the device, and when: [docs/privacy-policy.md](docs/privacy-policy.md)
- Store submission copy and screenshots: [docs/store/](docs/store/)
- Architecture, threat model and invariants: [docs/architecture/](docs/architecture/)

This workspace holds the clean-room TypeScript implementation alongside the untouched ShardPass
1.2.1 packaged extension kept as a behavioral reference.

## Installing the build

```sh
pnpm build:security
```

Then load `dist/` unpacked: `chrome://extensions` -> Developer mode -> Load unpacked.
`pnpm package` writes `release/shardpass-<version>.zip` for the store.

## Prerequisites

- Node.js 22.14 or later, before Node.js 23
- pnpm 10.14.0 (Corepack can provide the pinned version)

## Setup

```sh
corepack enable
pnpm install --frozen-lockfile
```

The frozen install is a release prerequisite, not a hidden step inside verification. This preserves the committed dependency graph and avoids network/package-manager changes during evidence collection.

## Commands

- `pnpm build` — build clean source into `dist/`
- `pnpm typecheck` — run strict TypeScript project checks
- `pnpm lint` — run ESLint with zero warnings allowed
- `pnpm format:check` — verify Prettier formatting
- `pnpm test` — run Vitest tests
- `pnpm build:security` — clean, build, and run the output tests and semantic build scanner over `dist/`
- `pnpm package` — build and write the store ZIP to `release/`
- `pnpm test:browser` — clean/build/scan and run the Playwright specs; install the pinned browser first with `pnpm exec playwright install chromium` if Playwright reports a missing executable. Not every spec passes: `playwright.config.ts` lists the quarantined files and says why each one is there, and CI runs the rest
- `pnpm verify` — run the baseline source checks, dependency boundaries, fresh build-output tests, and semantic build scanner
- `pnpm verify:project0` — official Project 0 gate; fails immediately unless Node `>=22.14.0 <23` and pnpm `10.14.0` are active, then runs all source, dependency, fresh output, browser-suite, reproducibility, and production-audit evidence
- `pnpm verify:project0:local-node24` — development-only Node 24 bypass that runs the same evidence; it never clears the Node 22 release blocker

## Project 0 verification

From a clean workspace under the approved runtime:

```sh
corepack pnpm@10.14.0 install --frozen-lockfile
corepack pnpm@10.14.0 verify:project0
```

`verify:project0` cleans and builds `dist/`, applies source-output manifest/CSP tests, recursively scans production files, runs the browser suite against that preserved candidate, builds twice into temporary directories and compares sorted paths plus exact SHA-256 bytes, and finishes with `pnpm audit --prod`. The scanner rejects remote executable resources, maps/source-map references, prohibited console transports, `.env` leakage, inline executable scripts, legacy bundles, test harnesses, dynamic code, broken local references, and unexpected web-accessible exposure. Harmless manifest metadata URLs are not rejected merely for containing HTTPS.

This machine now runs Node 22.14.0, the approved runtime, so the Node 24 bypass below is no longer the only route. Equivalent local evidence can still be collected explicitly with:

```sh
COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10.14.0 --config.engine-strict=false verify:project0:local-node24
```

Project 0 is **not release-ready** while its current hard blocker remains: the official gate has not passed on Node 22. The approved system fallback typography is accepted for Project 0, so unavailable verified redistributable Inter Tight/IBM Plex Mono WOFF2 assets are a documented visual deviation and future opportunity, not a release blocker. Do not claim preferred-font parity or fetch/fabricate font files; do not weaken the package engine.

## Project 1 release verification

`pnpm verify:project1` is the sole official Project 1 release decision. It first enforces Node `>=22.14.0 <23` (observed Node 22) and pnpm 10.14.0, then invokes the production Task 13 orchestrator. The gate requires an actual observed Chrome 110 executable, an absolute independently enforcing external network wrapper, the canonical Task 12 reviewer trust store, and valid same-`candidateDigest` Chrome 110 and signed external-review records. Missing infrastructure or evidence is a hard `STOP-PROJECT1-RELEASE`; only the complete official evidence DAG may emit `PASS-PROJECT1-RELEASE`.

The gate copies only declared inputs into a disposable workspace, rejects symlinks and ambient generated state, performs one frozen bootstrap, then uses four separated network modes: `bootstrap` permits one recorded HTTPS pnpm registry origin; `offline` denies all networking; `mock` permits one loopback origin while denying egress; and `audit` permits only `pnpm audit --prod` at the registry audit endpoint. It runs typecheck, lint, formatting, dependency analysis, exact source and candidate secret scans, all Vitest projects including Project 1 security/legacy/tooling coverage, packaged browser checks, an independent deterministic scratch build, production audit, documentation tests, archive verification, and final DAG validation.

The one production `dist/` is frozen after computing the Task 12-compatible identity `{ name, version, candidateDigest }` with domain `ShardPass packaged candidate v1\0`. Every subsequent check and imported Task 12 record binds that same identity. Packaging creates byte-identical ZIPs rooted at `ShardPass-<version>/`, using fixed `1980-01-01T00:00:00Z` timestamps, 0644 files, 0755 directories, raw DEFLATE level 9, and round-trip identity verification.

For feasible local diagnosis on this machine, use:

```sh
COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10.14.0 --config.engine-strict=false verify:project1:local-node24
```

That helper requires Node 24, pnpm 10.14.0, and packaged Playwright Chromium 151.0.7922.34. Every evidence node is `developmentOnly: true`; it cannot write external review/Chrome records, cannot create a final PASS root, and reports `DEVELOPMENT-ONLY` at most. Node 24, Chromium 151, mocks, static `chrome110` targeting, and source inspection never satisfy release blockers.

## Legacy artifact boundary

The root `manifest.json`, `assets/`, `icons/`, `service-worker-loader.js`, and `src/popup/index.html` belong to the packaged ShardPass 1.2.1 artifact. Do not edit, move, delete, or import these generated files into maintainable source. New builds are emitted only to `dist/`. See [legacy artifact provenance](docs/architecture/legacy-artifact.md).
