# ShardPass Project 0 Foundation and UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible, maintainable TypeScript Manifest V3 extension foundation with secure runtime boundaries and a modern ShardPass-themed popup, full-page vault shell, and isolated in-page picker shell.

**Architecture:** A pnpm workspace contains one MV3 extension application and small framework-independent packages. React is restricted to user-interface entry points; browser access, messages, errors, and security events use narrow validated ports. The current minified extension remains an untouched behavioral reference while new builds are emitted to `dist/`.

**Tech Stack:** Node.js 22 LTS, pnpm 10, TypeScript, Vite, CRXJS, React, Zod, CSS Modules, Vitest, Testing Library, Playwright, axe-core, ESLint, Prettier, dependency-cruiser.

## Global Constraints

- Do not edit or import the existing minified files in `assets/`, `service-worker-loader.js`, or `src/popup/index.html` as maintainable source.
- Keep the existing production artifact usable while the clean rebuild is incomplete; emit new builds only to `dist/`.
- Chrome 110 is the minimum supported browser for Projects 0–2.
- Use exact dependency versions and a committed `pnpm-lock.yaml` once this workspace is placed under version control.
- No analytics, remote fonts, CSS framework, state-management framework, router, or runtime network access in Project 0.
- Project 0 does not create, unlock, decrypt, import, capture, or fill real secrets.
- Dark mode is the only shipped theme; tokens must permit a future complete light palette.
- Preserve ShardPass’s `#0c0c0d` background, `#ff4d2e` coral accent, Inter Tight/IBM Plex Mono pairing, 4px spacing rhythm, sharp radii, hairline borders, and restrained motion.
- No decorative gradients, glassmorphism, oversized shadows, excessive pills, or large rounded cards.
- Runtime messages must be versioned, runtime-validated, sender-authorized, and safely redacted.
- This directory is not currently a Git repository. Skip commit commands until the owner initializes Git; do not silently initialize or publish a repository.

---

## Target file map

```text
package.json                         root scripts and pinned tooling
pnpm-workspace.yaml                 app/package workspace declarations
tsconfig.base.json                  strict shared TypeScript settings
vite.config.ts                      CRXJS build and aliases
vitest.config.ts                    package/DOM test projects
playwright.config.ts                persistent Chromium extension tests
eslint.config.js                    boundaries and safe-code lint rules
apps/extension/src/manifest.ts      explicit MV3 manifest
apps/extension/src/platform/        sole browser API implementation
apps/extension/src/background/      worker entry and foundation router
apps/extension/src/popup/           compact popup entry and shell
apps/extension/src/vault/           full-page application entry and shell
apps/extension/src/content/         closed-Shadow-DOM entry and shell
packages/domain/src/                non-secret foundation models
packages/messaging/src/             message envelopes and authorization
packages/security/src/              safe errors/events/logging contracts
packages/ui/src/                    tokens, fonts, primitives, brand mark
packages/testing/src/               browser/platform test doubles
tests/browser/                      extension smoke, a11y, and visual tests
tests/fixtures/sites/               non-secret local fixture page
docs/architecture/                  runtime and dependency boundaries
docs/security/                      threat model and security invariants
docs/competitor-feature-catalog.md  maintained official-source roadmap input
```

## Task 1: Preserve provenance and create the workspace toolchain

**Files:**

- Create: `README.md`
- Create: `docs/architecture/legacy-artifact.md`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `.npmrc`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `eslint.config.js`
- Create: `prettier.config.js`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `tests/tooling/workspace.test.ts`

**Interfaces:**

- Consumes: Current packaged artifact at the workspace root.
- Produces: Root commands `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:browser`, `pnpm build`, and `pnpm verify`.

- [ ] **Step 1: Write the failing workspace test**

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);

describe("workspace policy", () => {
  it("keeps generated builds and local secrets out of source", async () => {
    const ignore = await readFile(new URL(".gitignore", root), "utf8");
    expect(ignore).toContain("dist/");
    expect(ignore).toContain(".env*");
    expect(ignore).not.toContain("assets/");
  });

  it("uses strict TypeScript", async () => {
    const config = JSON.parse(await readFile(new URL("tsconfig.base.json", root), "utf8"));
    expect(config.compilerOptions.strict).toBe(true);
    expect(config.compilerOptions.noUncheckedIndexedAccess).toBe(true);
    expect(config.compilerOptions.exactOptionalPropertyTypes).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm the files are absent**

Run: `pnpm exec vitest run tests/tooling/workspace.test.ts`

Expected: FAIL because `package.json`, Vitest configuration, and policy files do not exist.

- [ ] **Step 3: Create the pinned workspace**

Use this root package policy:

```json
{
  "name": "shardpass",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.14.0",
  "engines": { "node": ">=22.14.0 <23", "pnpm": "10.14.0" },
  "scripts": {
    "build": "vite build",
    "typecheck": "tsc -b --pretty false",
    "lint": "eslint . --max-warnings 0",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:browser": "playwright test",
    "verify": "pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build"
  }
}
```

Pin the implementation-plan dependency set after checking current registry compatibility instead of using ranges. Record every selected exact version in `docs/architecture/dependencies.md`. Configure `.npmrc` with `save-exact=true`, `minimum-release-age=1440`, and `strict-peer-dependencies=true`.

- [ ] **Step 4: Document artifact provenance**

`docs/architecture/legacy-artifact.md` must identify `manifest.json`, `assets/`, `icons/`, `service-worker-loader.js`, and `src/popup/index.html` as ShardPass 1.2.1 behavioral references. State that new code may inspect them and generate fixtures from authorized local execution, but may not import them into the new source graph.

- [ ] **Step 5: Install and run the test**

Run: `pnpm install && pnpm exec vitest run tests/tooling/workspace.test.ts`

Expected: PASS.

- [ ] **Step 6: Run baseline quality commands**

Run: `pnpm typecheck && pnpm lint && pnpm format:check`

Expected: PASS.

- [ ] **Step 7: Commit when Git exists**

```bash
git add README.md docs/architecture .editorconfig .gitignore .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json eslint.config.js prettier.config.js vitest.config.ts playwright.config.ts tests/tooling
 git commit -m "build: establish ShardPass TypeScript workspace"
```

## Task 2: Enforce package boundaries and safe errors

**Files:**

- Create: `packages/security/package.json`
- Create: `packages/security/src/errors.ts`
- Create: `packages/security/src/events.ts`
- Create: `packages/security/src/index.ts`
- Create: `packages/security/test/errors.test.ts`
- Create: `dependency-cruiser.config.cjs`
- Create: `tests/tooling/dependencies.test.ts`

**Interfaces:**

- Produces: `SafeError`, `SafeErrorCode`, `toSafeError(error: unknown, fallback: SafeErrorCode): SafeError`, `SecurityEventSink.record(event: SecurityEvent): void`.

- [ ] **Step 1: Write safe-error tests**

```ts
import { describe, expect, it } from "vitest";
import { toSafeError } from "../src/errors";

describe("toSafeError", () => {
  it("drops arbitrary messages, stacks, causes, and payloads", () => {
    const input = Object.assign(new Error("password=hunter2"), { token: "secret" });
    const result = toSafeError(input, "UNEXPECTED");
    expect(result).toEqual({ code: "UNEXPECTED", message: "Something went wrong. Try again." });
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run packages/security/test/errors.test.ts`

Expected: FAIL because `toSafeError` is absent.

- [ ] **Step 3: Implement allowlisted errors**

```ts
export type SafeErrorCode =
  "INVALID_MESSAGE" | "UNAUTHORIZED_SENDER" | "UNSUPPORTED_CONTEXT" | "UNEXPECTED";

const messages: Record<SafeErrorCode, string> = {
  INVALID_MESSAGE: "The request was invalid.",
  UNAUTHORIZED_SENDER: "This action is not allowed here.",
  UNSUPPORTED_CONTEXT: "This page context is not supported.",
  UNEXPECTED: "Something went wrong. Try again.",
};

export type SafeError = Readonly<{ code: SafeErrorCode; message: string }>;

export function toSafeError(_error: unknown, fallback: SafeErrorCode): SafeError {
  return { code: fallback, message: messages[fallback] };
}
```

Define `SecurityEvent` as a discriminated union containing event codes and non-secret booleans/enums only. Add a default no-op sink; do not add console transport.

- [ ] **Step 4: Enforce dependencies**

Configure dependency-cruiser so `packages/*` cannot import `apps/*`, pure packages cannot import React or browser globals, and app UI cannot import `webextension-polyfill` directly.

- [ ] **Step 5: Run focused and boundary tests**

Run: `pnpm exec vitest run packages/security tests/tooling/dependencies.test.ts && pnpm exec depcruise apps packages`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add packages/security dependency-cruiser.config.cjs tests/tooling/dependencies.test.ts
 git commit -m "feat: add redacted security boundaries"
```

## Task 3: Add validated runtime messaging

**Files:**

- Create: `packages/messaging/package.json`
- Create: `packages/messaging/src/envelope.ts`
- Create: `packages/messaging/src/context.ts`
- Create: `packages/messaging/src/foundation.ts`
- Create: `packages/messaging/src/authorize.ts`
- Create: `packages/messaging/src/index.ts`
- Create: `packages/messaging/test/foundation.test.ts`
- Create: `packages/messaging/test/authorize.test.ts`

**Interfaces:**

- Produces: `MessageEnvelopeSchema`, `FoundationRequest`, `FoundationResponse`, `SenderContext`, `authorizeSender(context, policy): boolean`.

- [ ] **Step 1: Write validation tests**

```ts
import { describe, expect, it } from "vitest";
import { FoundationRequestSchema } from "../src/foundation";

describe("foundation messages", () => {
  it("accepts the exact versioned request", () => {
    expect(FoundationRequestSchema.parse({ version: 1, kind: "foundation.getStatus" })).toEqual({
      version: 1,
      kind: "foundation.getStatus",
    });
  });

  it("rejects unknown fields and versions", () => {
    expect(() =>
      FoundationRequestSchema.parse({ version: 2, kind: "foundation.getStatus" }),
    ).toThrow();
    expect(() =>
      FoundationRequestSchema.parse({ version: 1, kind: "foundation.getStatus", secret: "x" }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run packages/messaging`

Expected: FAIL because schemas do not exist.

- [ ] **Step 3: Implement strict schemas**

```ts
import { z } from "zod";

export const FoundationRequestSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("foundation.getStatus"),
  })
  .strict();

export const FoundationResponseSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("foundation.status"),
    phase: z.literal("foundation"),
    vaultAvailable: z.literal(false),
  })
  .strict();
```

`SenderContext` must be derived from browser-owned sender data and contain extension ID, context kind, tab ID, frame ID, document ID, and sender URL where supplied. Authorization must explicitly list `popup`, `vault`, and `content` contexts per command.

- [ ] **Step 4: Test authorization**

Verify a content sender cannot invoke popup-only commands, an unknown extension ID fails, and missing document identity fails for content commands.

Run: `pnpm exec vitest run packages/messaging`

Expected: PASS.

- [ ] **Step 5: Commit when Git exists**

```bash
git add packages/messaging
 git commit -m "feat: validate and authorize extension messages"
```

## Task 4: Build the browser platform port and background router

**Files:**

- Create: `apps/extension/package.json`
- Create: `apps/extension/src/platform/extension-platform.ts`
- Create: `apps/extension/src/platform/chrome-platform.ts`
- Create: `apps/extension/src/background/router.ts`
- Create: `apps/extension/src/background/main.ts`
- Create: `packages/testing/src/fake-extension-platform.ts`
- Create: `apps/extension/test/background/router.test.ts`

**Interfaces:**

- Produces: `ExtensionPlatform`, `createChromePlatform()`, and `routeMessage(input, senderContext): Promise<FoundationResponse>`.

- [ ] **Step 1: Write router tests with a fake platform**

```ts
it("returns a foundation status only to an authorized extension page", async () => {
  const response = await routeMessage(
    { version: 1, kind: "foundation.getStatus" },
    popupSender("expected-extension-id"),
  );
  expect(response).toEqual({
    version: 1,
    kind: "foundation.status",
    phase: "foundation",
    vaultAvailable: false,
  });
});
```

Add rejection cases for external extension IDs, invalid payloads, and content senders without tab/frame/document identity.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run apps/extension/test/background/router.test.ts`

Expected: FAIL because the router is absent.

- [ ] **Step 3: Implement the narrow platform port**

```ts
export interface ExtensionPlatform {
  readonly extensionId: string;
  onMessage(handler: (payload: unknown, sender: unknown) => Promise<unknown>): () => void;
  sendMessage(payload: unknown): Promise<unknown>;
  openVaultPage(): Promise<void>;
}
```

Only `chrome-platform.ts` may import extension APIs. `main.ts` installs one listener, converts sender metadata into `SenderContext`, routes, and returns only safe errors.

- [ ] **Step 4: Run tests and type checks**

Run: `pnpm exec vitest run apps/extension/test/background && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit when Git exists**

```bash
git add apps/extension/src/platform apps/extension/src/background apps/extension/test/background packages/testing
 git commit -m "feat: add MV3 platform and background router"
```

## Task 5: Create the explicit Manifest V3 build

**Files:**

- Create: `apps/extension/src/manifest.ts`
- Create: `vite.config.ts`
- Create: `apps/extension/src/popup/index.html`
- Create: `apps/extension/src/vault/index.html`
- Create: `tests/security/manifest.test.ts`
- Create: `tests/security/csp.test.ts`

**Interfaces:**

- Consumes: Background, popup, vault, and content entry paths.
- Produces: Installable `dist/manifest.json` and extension assets.

- [ ] **Step 1: Write manifest policy tests**

Assert manifest version 3, Chrome 110 floor, module service worker, no remote scripts, no externally connectable origins, no network host permissions, and only `storage` permission in Project 0. Assert CSP is exactly `script-src 'self'; object-src 'self'` unless CRXJS requires a documented development-only variant that is absent from production output.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run tests/security/manifest.test.ts tests/security/csp.test.ts`

Expected: FAIL because no new manifest/build exists.

- [ ] **Step 3: Implement the manifest**

```ts
export default {
  manifest_version: 3,
  name: "ShardPass",
  version: "2.0.0-dev.0",
  minimum_chrome_version: "110",
  permissions: ["storage"],
  action: { default_popup: "src/popup/index.html" },
  options_page: "src/vault/index.html",
  background: { service_worker: "src/background/main.ts", type: "module" },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/main.tsx"],
      run_at: "document_idle",
      all_frames: false,
    },
  ],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
} as const;
```

Document why `<all_urls>` is required for future field detection even though Project 0 renders only a foundation shell. Do not add clipboard, idle, alarms, Ente, DuckDuckGo, or future sync permissions yet.

- [ ] **Step 4: Build and inspect output**

Run: `pnpm build && pnpm exec vitest run tests/security`

Expected: PASS and `dist/manifest.json` contains no remote origin.

- [ ] **Step 5: Commit when Git exists**

```bash
git add apps/extension/src/manifest.ts apps/extension/src/popup/index.html apps/extension/src/vault/index.html vite.config.ts tests/security
 git commit -m "build: produce explicit Manifest V3 package"
```

## Task 6: Implement the ShardPass design tokens and primitives

**Files:**

- Create: `packages/ui/package.json`
- Create: `packages/ui/src/styles/fonts.css`
- Create: `packages/ui/src/styles/tokens.css`
- Create: `packages/ui/src/styles/base.css`
- Create: `packages/ui/src/brand/ShardPassMark.tsx`
- Create: `packages/ui/src/primitives/Button.tsx`
- Create: `packages/ui/src/primitives/IconButton.tsx`
- Create: `packages/ui/src/primitives/Field.tsx`
- Create: `packages/ui/src/primitives/StatusBadge.tsx`
- Create: `packages/ui/src/primitives/AppHeader.tsx`
- Create: `packages/ui/src/index.ts`
- Create: `packages/ui/test/primitives.test.tsx`
- Add licensed local Inter Tight and IBM Plex Mono WOFF2 files under `packages/ui/src/fonts/` only after license verification; otherwise use the approved system fallback stack and document the gap rather than downloading fonts from an unverified source.

**Interfaces:**

- Produces: Shared semantic tokens and accessible React primitives.

- [ ] **Step 1: Write accessibility and class-contract tests**

Test that icon-only buttons require an accessible label, disabled buttons expose state, fields associate labels/errors, and status does not depend on color alone.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run packages/ui`

Expected: FAIL because primitives are absent.

- [ ] **Step 3: Define semantic tokens**

```css
:root {
  color-scheme: dark;
  --color-bg: #0c0c0d;
  --color-surface: #18181b;
  --color-popover: #131316;
  --color-elevated: #1c1c20;
  --color-text: #f4f4f5;
  --color-text-muted: #a1a1aa;
  --color-border-soft: #1d1d21;
  --color-border: #26262b;
  --color-border-strong: #3a3a40;
  --color-accent: #ff4d2e;
  --color-accent-hover: #ff6749;
  --color-success: #4ade80;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --radius-xs: 1px;
  --radius-sm: 2px;
  --radius-md: 4px;
  --motion-fast: 100ms;
  --motion-standard: 160ms;
}
```

Add tabular-number and mono-label utilities, strong focus rings, AA-compliant muted text, 32px minimum compact controls, and a reduced-motion block.

- [ ] **Step 4: Implement primitives and the flat coral mark**

The brand mark must be a simple flat vector/tile aligned with the existing coral `S`; do not reuse the glossy blue shield as the main UI mark. Destructive buttons use red, not coral.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run packages/ui && pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit when Git exists**

```bash
git add packages/ui
 git commit -m "feat: establish ShardPass visual system"
```

## Task 7: Build the compact popup shell

**Files:**

- Create: `apps/extension/src/popup/main.tsx`
- Create: `apps/extension/src/popup/PopupApp.tsx`
- Create: `apps/extension/src/popup/PopupApp.module.css`
- Create: `apps/extension/src/popup/useFoundationStatus.ts`
- Create: `apps/extension/test/popup/PopupApp.test.tsx`

**Interfaces:**

- Consumes: `ExtensionPlatform.sendMessage`, UI primitives, `FoundationResponse`.
- Produces: 360px popup shell with brand header, status, explanation, and “Open vault” action.

- [ ] **Step 1: Write popup tests**

Test loading, safe error, foundation status, keyboard activation, status live region, and that no password/OTP/reveal/copy control is falsely presented as functional.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run apps/extension/test/popup`

Expected: FAIL.

- [ ] **Step 3: Implement the shell**

Use a 360px compact layout with a bordered header, coral mark, mono `FOUNDATION` status, restrained empty-state copy, and one action opening the full-page vault. Avoid centered oversized marketing artwork.

- [ ] **Step 4: Run tests and axe**

Run: `pnpm exec vitest run apps/extension/test/popup`

Expected: PASS with no serious axe violations.

- [ ] **Step 5: Commit when Git exists**

```bash
git add apps/extension/src/popup apps/extension/test/popup
 git commit -m "feat: add themed popup foundation shell"
```

## Task 8: Build the full-page vault shell

**Files:**

- Create: `apps/extension/src/vault/main.tsx`
- Create: `apps/extension/src/vault/VaultApp.tsx`
- Create: `apps/extension/src/vault/VaultApp.module.css`
- Create: `apps/extension/src/vault/components/VaultSidebar.tsx`
- Create: `apps/extension/src/vault/components/EmptyVaultState.tsx`
- Create: `apps/extension/test/vault/VaultApp.test.tsx`

**Interfaces:**

- Produces: Responsive navigation/list/detail shell ready for Project 1 without fake secret persistence.

- [ ] **Step 1: Write layout and accessibility tests**

Test named navigation, skip link, keyboard focus order, responsive single-column state, no misleading enabled CRUD buttons, and safe failure state.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run apps/extension/test/vault`

Expected: FAIL.

- [ ] **Step 3: Implement the responsive shell**

Desktop uses sidebar plus list/detail regions; compact widths collapse to one region. Render disabled or explanatory future item controls rather than fake data. Use technical labels, hairline dividers, and compact rows derived from current ShardPass.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run apps/extension/test/vault`

Expected: PASS.

- [ ] **Step 5: Commit when Git exists**

```bash
git add apps/extension/src/vault apps/extension/test/vault
 git commit -m "feat: add responsive vault application shell"
```

## Task 9: Build the isolated in-page shell

**Files:**

- Create: `apps/extension/src/content/main.tsx`
- Create: `apps/extension/src/content/createPickerHost.tsx`
- Create: `apps/extension/src/content/FoundationPicker.tsx`
- Create: `apps/extension/src/content/picker.css`
- Create: `apps/extension/test/content/createPickerHost.test.tsx`

**Interfaces:**

- Produces: `createPickerHost(anchor: HTMLElement): PickerHandle` where `PickerHandle.close(): void` unmounts, removes the host, and restores focus.

- [ ] **Step 1: Write lifecycle tests**

Test one host per document, closed Shadow DOM, text-only origin display, Escape close, focus restoration, listener cleanup, and no page stylesheet leakage.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run apps/extension/test/content`

Expected: FAIL.

- [ ] **Step 3: Implement the closed Shadow DOM shell**

The Project 0 content entry must not scan password fields or render automatically. Expose a test-only invocation path and production-safe host factory for later projects. Render site strings only through React text nodes; never use `dangerouslySetInnerHTML`.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run apps/extension/test/content`

Expected: PASS.

- [ ] **Step 5: Commit when Git exists**

```bash
git add apps/extension/src/content apps/extension/test/content
 git commit -m "feat: add isolated in-page UI host"
```

## Task 10: Add browser smoke, visual, and accessibility tests

**Files:**

- Create: `tests/browser/fixtures.ts`
- Create: `tests/browser/extension-smoke.spec.ts`
- Create: `tests/browser/popup-visual.spec.ts`
- Create: `tests/browser/vault-visual.spec.ts`
- Create: `tests/browser/picker-visual.spec.ts`
- Create: `tests/fixtures/sites/foundation.html`
- Create: `tests/browser/__screenshots__/` through approved snapshot generation.

**Interfaces:**

- Consumes: Built `dist/` extension.
- Produces: Evidence that all entry points load without console errors and match the approved visual system.

- [ ] **Step 1: Write extension loader and smoke tests**

Launch Chromium persistent context with `--disable-extensions-except=<dist>` and `--load-extension=<dist>`. Resolve the extension ID from the service worker URL. Test manifest, worker, popup, vault page, and a local fixture page.

- [ ] **Step 2: Verify failure before the harness is complete**

Run: `pnpm build && pnpm exec playwright test tests/browser/extension-smoke.spec.ts`

Expected: FAIL until the loader and entries are correct.

- [ ] **Step 3: Add deterministic screenshots and axe checks**

Use fixed viewport/font rendering, mask no regions, disable motion through media emulation, and capture popup at 360px plus vault desktop/compact layouts. Fail on serious or critical axe violations.

- [ ] **Step 4: Run browser suite**

Run: `pnpm exec playwright test`

Expected: PASS with reviewed baseline screenshots and no unexpected console errors.

- [ ] **Step 5: Commit when Git exists**

```bash
git add tests/browser tests/fixtures
 git commit -m "test: verify extension shells and visual system"
```

## Task 11: Document threat model, invariants, permissions, and competitor baseline

**Files:**

- Create: `docs/security/threat-model.md`
- Create: `docs/security/invariants.md`
- Create: `docs/security/release-checklist.md`
- Create: `docs/architecture/runtime-boundaries.md`
- Create: `docs/architecture/permissions.md`
- Create: `docs/competitor-feature-catalog.md`
- Create: `tests/security/docs.test.ts`

**Interfaces:**

- Produces: Reviewable security contract and maintained roadmap evidence.

- [ ] **Step 1: Write documentation-presence tests**

Assert threat actors include malicious pages, malicious frames, extension-message spoofing, dependency compromise, XSS, stolen profile, clipboard exposure, and destructive user error. Assert invariants include no whole-vault content response, no arbitrary error interpolation, no remote font, click-to-fill default, and origin revalidation before future secret release.

- [ ] **Step 2: Verify failure**

Run: `pnpm exec vitest run tests/security/docs.test.ts`

Expected: FAIL because documents are absent.

- [ ] **Step 3: Write the security documents**

For every threat, record asset, attacker capability, trust boundary, mitigation, residual risk, and test or review evidence. Explicitly state JavaScript cannot guarantee physical memory zeroization.

- [ ] **Step 4: Write the competitor catalog**

Use official-source findings dated 2026-07-29 for 1Password, LastPass, Bitwarden, Dashlane, Proton Pass, NordPass, Keeper, and Ente Auth. Include feature-family matrices, plan/platform qualifications, per-product official links, `Yes/Partial/No/Unverified/Not applicable`, ShardPass baseline, and `Now/Next/Later/Out of scope` backlog. Do not convert missing evidence into `No`.

- [ ] **Step 5: Run docs tests and link checks**

Run: `pnpm exec vitest run tests/security/docs.test.ts`

Expected: PASS. Manually open every official URL or run an approved non-authenticated link checker; record inaccessible dynamic pages as verification notes instead of removing caveats.

- [ ] **Step 6: Commit when Git exists**

```bash
git add docs/security docs/architecture docs/competitor-feature-catalog.md tests/security/docs.test.ts
 git commit -m "docs: define security model and product baseline"
```

## Task 12: Establish the Project 0 release gate

**Files:**

- Create: `scripts/scan-build.mjs`
- Create: `scripts/verify-reproducible-build.mjs`
- Create: `tests/security/build-output.test.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**

- Produces: `pnpm verify:project0`.

- [ ] **Step 1: Write build-output tests**

Assert `dist/` contains no `http://`, `https://`, source-map references, `console.log`, test fixture text, `.env` value, inline script, or dependency on legacy minified filenames.

- [ ] **Step 2: Verify the scan initially fails on an injected fixture**

Run the scanner against a temporary artifact containing `https://example.test` and confirm a non-zero exit. Remove the temporary artifact afterward.

- [ ] **Step 3: Implement deterministic build verification**

Build twice from the same lockfile into separate temporary directories, normalize only documented non-semantic archive timestamps if packaging is added, and compare file names plus SHA-256 hashes.

- [ ] **Step 4: Add the final command**

```json
{
  "scripts": {
    "verify:project0": "pnpm verify && pnpm test:browser && node scripts/scan-build.mjs && node scripts/verify-reproducible-build.mjs"
  }
}
```

- [ ] **Step 5: Run the complete gate**

Run: `pnpm install --frozen-lockfile && pnpm verify:project0`

Expected: PASS from a clean workspace using Node 22 and pnpm 10.

- [ ] **Step 6: Commit when Git exists**

```bash
git add scripts tests/security/build-output.test.ts package.json README.md
 git commit -m "test: enforce Project 0 release gate"
```

## Project 0 completion evidence

- New source builds reproducibly into `dist/` without changing the packaged ShardPass 1.2.1 artifact.
- All TypeScript, lint, formatting, unit, boundary, CSP, manifest, browser, visual, and accessibility checks pass.
- Popup, full-page vault, and picker exhibit one coherent ShardPass visual system.
- There is no functional or simulated secret storage in the foundation.
- Runtime boundaries reject malformed and unauthorized messages.
- Threat model, security invariants, permission rationale, and competitor catalog are reviewable.
