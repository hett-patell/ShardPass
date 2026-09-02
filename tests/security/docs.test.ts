import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const researchDate = "2026-07-29";

const documentation = {
  threatModel: "docs/security/threat-model.md",
  invariants: "docs/security/invariants.md",
  releaseChecklist: "docs/security/release-checklist.md",
  runtimeBoundaries: "docs/architecture/runtime-boundaries.md",
  dependencies: "docs/architecture/dependencies.md",
  permissions: "docs/architecture/permissions.md",
  cryptographicFormat: "docs/security/cryptographic-format.md",
  readme: "README.md",
  catalog: "docs/competitor-feature-catalog.md",
} as const;

async function readDocument(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

function heading(content: string, title: string): string {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(
    `^#{2,3}\\s+${escaped}\\s*$([\\s\\S]*?)(?=^#{1,3}\\s|$(?![\\s\\S]))`,
    "mu",
  ).exec(content);
  expect(match, `missing section: ${title}`).not.toBeNull();
  return match?.[1] ?? "";
}

function officialUrls(content: string): URL[] {
  return [...content.matchAll(/https:\/\/[^\s)>\]|]+/gu)].map(
    ([url]) => new URL(url.replace(/[.,;:]$/u, "")),
  );
}

type MarkdownTable = ReadonlyMap<string, ReadonlyMap<string, string>>;

function markdownCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseMarkdownTable(section: string): MarkdownTable {
  const lines = section.split("\n").filter((line) => line.trim().startsWith("|"));
  const header = lines[0] === undefined ? [] : markdownCells(lines[0]);
  expect(header[0], "comparison table must start with a Capability header").toBe("Capability");

  const products = header.slice(1);
  if (new Set(products).size !== products.length) {
    throw new Error("comparison table contains a duplicate product alias");
  }
  const allowedStatuses = new Set(["Y", "P", "N", "U", "NA"]);
  const rows = new Map<string, ReadonlyMap<string, string>>();
  for (const line of lines.slice(2)) {
    const cells = markdownCells(line);
    const capability = cells[0];
    if (capability === undefined || capability === "") {
      continue;
    }
    expect(cells.length, `${capability} must have one cell per table header`).toBe(header.length);
    if (rows.has(capability)) {
      throw new Error(`comparison table contains duplicate capability: ${capability}`);
    }
    const statuses = cells.slice(1);
    for (const status of statuses) {
      if (!allowedStatuses.has(status)) {
        throw new Error(
          `${capability} contains invalid normalized status: ${JSON.stringify(status)}`,
        );
      }
    }
    rows.set(
      capability,
      new Map(products.map((product, index) => [product, statuses[index] ?? ""])),
    );
  }
  return rows;
}

function capabilityStatuses(table: MarkdownTable, capability: string): ReadonlyMap<string, string> {
  const row = table.get(capability);
  expect(row, `missing comparison capability: ${capability}`).toBeDefined();
  return row ?? new Map();
}

describe("Markdown comparison table parser", () => {
  it.each(["", "Yes", "Y (paid)", "UNKNOWN"])("rejects invalid status %j", (status) => {
    expect(() =>
      parseMarkdownTable(`
| Capability | 1P |
| --- | --- |
| Example | ${status} |
`),
    ).toThrow();
  });

  it("rejects duplicate product aliases", () => {
    expect(() =>
      parseMarkdownTable(`
| Capability | 1P | 1P |
| --- | --- | --- |
| Example | Y | N |
`),
    ).toThrow(/duplicate product alias/iu);
  });

  it("rejects duplicate capability labels", () => {
    expect(() =>
      parseMarkdownTable(`
| Capability | 1P |
| --- | --- |
| Example | Y |
| Example | N |
`),
    ).toThrow(/duplicate capability/iu);
  });

  it("accepts every normalized status with flexible spacing", () => {
    const table = parseMarkdownTable(`
 | Capability | 1P | LP | BW | DA | PP |
 | --- | --- | --- | --- | --- | --- |
 | Example | Y | P | N | U | NA |
`);
    expect(Object.fromEntries(capabilityStatuses(table, "Example"))).toEqual({
      "1P": "Y",
      LP: "P",
      BW: "N",
      DA: "U",
      PP: "NA",
    });
  });
});

describe("Project 0 security documentation", () => {
  it("records every required threat with a complete review record", async () => {
    const content = await readDocument(documentation.threatModel);
    const threats = [
      "Malicious pages",
      "Malicious frames",
      "Extension-message spoofing",
      "Dependency compromise",
      "Cross-site scripting (XSS)",
      "Stolen browser profile",
      "Clipboard exposure",
      "Shoulder surfing and visual observation",
      "Destructive user error",
    ];

    for (const threat of threats) {
      const section = heading(content, threat);
      for (const field of [
        "Asset",
        "Attacker capability",
        "Trust boundary",
        "Project 0 mitigation",
        "Residual risk",
        "Evidence",
      ]) {
        expect(section, `${threat} must record ${field}`).toMatch(
          new RegExp(`\\*\\*${field}:\\*\\*\\s+\\S`, "u"),
        );
      }
    }

    expect(content).toContain("Project 0 does not handle real secrets");
    expect(content).toMatch(/Projects 1 and 2[\s\S]*future/iu);
  });

  it("states the required invariants and JavaScript limitation", async () => {
    const content = await readDocument(documentation.invariants);

    for (const required of [
      "No whole-vault response",
      "No raw errors or logs",
      "No remote fonts",
      "No secret handling in Project 0",
      "Click-to-fill is the implemented OTP default",
      "Origin revalidation before future secret release",
      "JavaScript zeroization limitation",
    ]) {
      expect(content).toContain(required);
    }

    expect(content).toMatch(/cannot guarantee physical memory zeroization/iu);
  });

  it("documents actual runtime and permission boundaries without future-permission drift", async () => {
    const [runtime, permissions] = await Promise.all([
      readDocument(documentation.runtimeBoundaries),
      readDocument(documentation.permissions),
    ]);

    expect(runtime).toMatch(/background service worker/iu);
    expect(runtime).toMatch(/popup/iu);
    expect(runtime).toMatch(/full-page vault/iu);
    expect(runtime).toMatch(/content script[\s\S]*inert/iu);
    expect(runtime).toMatch(/Project 0[\s\S]*foundation\.getStatus/iu);

    expect(permissions).toMatch(/exactly `storage`, `alarms`, and `idle`/iu);
    expect(permissions).toContain("`<all_urls>`");
    expect(permissions).toMatch(/retained[\s\S]*future field detection/iu);
    expect(permissions).toMatch(/broad injection surface|broad page reach/iu);
    expect(permissions).toMatch(/no `host_permissions`/iu);
    for (const absent of ["clipboardRead", "clipboardWrite", "offscreen"]) {
      expect(permissions).toMatch(new RegExp(`no \\x60${absent}\\x60`, "iu"));
    }
    expect(permissions).toMatch(/no runtime host network access/iu);
  });

  it("defines release blockers, review gates, screenshots, and artifact handling", async () => {
    const content = await readDocument(documentation.releaseChecklist);

    expect(content).toMatch(/Node\.js 22[\s\S]*blocker/iu);
    expect(content).toMatch(/Inter Tight[\s\S]*IBM Plex Mono[\s\S]*blocker/iu);
    expect(content).toMatch(/external security review/iu);
    expect(content).toMatch(/browser screenshots/iu);
    expect(content).toMatch(/preserve[\s\S]*legacy/iu);
    expect(content).toMatch(/fresh build/iu);
  });
});

describe("competitor feature catalog", () => {
  it("contains the approved structure, date, statuses, products, and roadmap classes", async () => {
    const content = await readDocument(documentation.catalog);

    expect(content).toContain(researchDate);
    for (const section of [
      "Purpose and reading guide",
      "Executive findings",
      "ShardPass verified baseline and future plans",
      "Feature comparison",
      "Competitor evidence notes",
      "ShardPass opportunity backlog",
      "Maintenance procedure and log",
    ]) {
      heading(content, section);
    }

    for (const status of ["Yes", "Partial", "No", "Unverified", "Not applicable"]) {
      expect(content).toMatch(new RegExp(`\\*\\*${status}:\\*\\*`, "u"));
    }
    for (const priority of ["Now", "Next", "Later", "Out of scope"]) {
      expect(content).toMatch(new RegExp(`\\b${priority}\\b`, "u"));
    }

    for (const product of [
      "1Password",
      "LastPass",
      "Bitwarden",
      "Dashlane",
      "Proton Pass",
      "NordPass",
      "Keeper",
      "Ente Auth",
    ]) {
      const section = heading(content, product);
      expect(section).toContain(`Last verified: ${researchDate}`);
      expect(
        officialUrls(section).length,
        `${product} needs official evidence URLs`,
      ).toBeGreaterThan(0);
    }

    expect(content).toMatch(/LastPass[\s\S]*incident/iu);
    expect(content).toMatch(/Ente Auth[\s\S]*OTP-specific/iu);
    expect(content).toMatch(/Ente Auth[\s\S]*not a stable generic vault sync API/iu);
  });

  it("preserves reviewed OTP-autofill and export semantics", async () => {
    const content = await readDocument(documentation.catalog);
    const vaultMatrix = heading(content, "Vault, capture, authentication, and platforms");
    const portabilityMatrix = heading(
      content,
      "Sharing, sync, portability, monitoring, and business",
    );
    const lastPass = heading(content, "LastPass");
    const onePassword = heading(content, "1Password");

    const otpAutofill = capabilityStatuses(parseMarkdownTable(vaultMatrix), "OTP autofill");
    expect(Object.fromEntries(otpAutofill)).toMatchObject({ LP: "U" });
    expect(lastPass).toMatch(/third-party vault-integrated TOTP autofill[\s\S]*Unverified/iu);
    expect(lastPass).toMatch(/account MFA[\s\S]*LastPass Authenticator[\s\S]*not evidence/iu);

    const portability = parseMarkdownTable(portabilityMatrix);
    expect(Object.fromEntries(capabilityStatuses(portability, "Portable export"))).toEqual({
      "1P": "Y",
      LP: "Y",
      BW: "Y",
      DA: "Y",
      PP: "Y",
      NP: "Y",
      KE: "Y",
      EA: "Y",
    });
    expect(
      Object.fromEntries(capabilityStatuses(portability, "Encrypted portable export")),
    ).toEqual({
      "1P": "N",
      LP: "U",
      BW: "Y",
      DA: "U",
      PP: "Y",
      NP: "U",
      KE: "U",
      EA: "Y",
    });
    expect(onePassword).toMatch(/portable export[\s\S]*Yes/iu);
    expect(onePassword).toMatch(/encrypted portable export[\s\S]*No/iu);
    expect(onePassword).toMatch(/plaintext|unencrypted|not encrypted/iu);

    const ente = heading(content, "Ente Auth");
    expect(ente).toMatch(
      /hosted backup\/sync[\s\S]*portable encrypted file export[\s\S]*distinct/iu,
    );
    expect(ente).toMatch(/encrypted JSON/iu);
    expect(ente).toMatch(/Argon2id[\s\S]*XChaCha20-Poly1305/iu);
    expect(ente).toMatch(/Ente Encrypted[\s\S]*decrypt[\s\S]*Ente CLI/iu);
    expect(ente).toContain("https://ente.com/help/auth/migration/export/");
  });

  it("uses only approved official vendor domains for competitor evidence", async () => {
    const content = await readDocument(documentation.catalog);
    const allowedDomains = [
      "1password.com",
      "lastpass.com",
      "bitwarden.com",
      "dashlane.com",
      "proton.me",
      "nordpass.com",
      "keepersecurity.com",
      "keeper.io",
      "ente.io",
      "ente.com",
    ];

    const urls = officialUrls(content);
    expect(urls.length).toBeGreaterThanOrEqual(24);
    for (const url of urls) {
      expect(url.protocol).toBe("https:");
      if (url.hostname === "github.com") {
        expect(url.pathname).toMatch(/^\/(?:ente-io|bitwarden|ProtonMail)(?:\/|$)/u);
      } else {
        expect(
          allowedDomains.some(
            (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
          ),
          `unapproved evidence domain: ${url.hostname}`,
        ).toBe(true);
      }
    }
  });
});

describe("Project 1 initial threat reconciliation", () => {
  const requiredThreats = [
    "stolen encrypted storage",
    "weak passwords",
    "KDF resource exhaustion",
    "nonce misuse",
    "interrupted writes",
    "rollback",
    "migration corruption",
    "QR bombs and native decoding",
    "malicious imports",
    "clipboard leakage",
    "hostile-page fill and HOTP races",
    "Ente server compromise and metadata exposure",
    "Ente CAS uncertainty",
    "service-worker restart",
    "build and candidate substitution",
    "registry and network-mode failure",
    "reviewer-key governance",
  ] as const;

  it.each(requiredThreats)("records complete current threat evidence for %s", async (title) => {
    const threatModel = await readDocument(documentation.threatModel);
    const section = heading(threatModel.toLowerCase(), title.toLowerCase());
    for (const field of [
      "**Asset:**",
      "**Attacker capability:**",
      "**Trust boundary:**",
      "**Implemented mitigation:**",
      "**Residual risk:**",
      "**Evidence:**",
    ])
      expect(section, `${title} missing ${field}`).toContain(field.toLowerCase());
    expect(section).toMatch(/(?:apps|packages|scripts|tests)\//u);
  });

  it("references existing concrete evidence and rejects stale current-state future claims", async () => {
    const threatModel = await readDocument(documentation.threatModel);
    const evidencePaths = [...threatModel.matchAll(/`((?:apps|packages|scripts|tests)\/[^`]+)`/gu)]
      .map((match) => match[1])
      .filter(
        (evidencePath): evidencePath is string =>
          evidencePath !== undefined && /\.[a-z\d]+$/iu.test(evidencePath),
      );
    for (const evidencePath of evidencePaths) {
      expect(evidencePath).toBeDefined();
      await expect(readFile(new URL(evidencePath ?? "", root))).resolves.toBeInstanceOf(Buffer);
    }
    expect(threatModel).not.toMatch(
      /(?:OTP algorithms|content-script secret release|clipboard|click-to-fill|Ente)[^\n]{0,100}remain future work/iu,
    );
    expect(threatModel).not.toContain("packages/crypto/test/vault-crypto.test.ts");
    expect(threatModel).not.toContain("packages/otp-storage/test/hotp-transaction.test.ts");
  });

  it("describes implemented Project 1 as current without false release evidence", async () => {
    const threatModel = await readDocument(documentation.threatModel);
    const invariants = await readDocument(documentation.invariants);
    expect(threatModel).toMatch(/current Project 1/iu);
    expect(invariants).toMatch(/current Project 1/iu);
    for (const feature of ["OTP", "clipboard", "fill", "import", "backup", "Ente"]) {
      expect(`${threatModel}\n${invariants}`).toMatch(
        new RegExp(`implemented[^\\n]{0,100}${feature}|${feature}[^\\n]{0,100}implemented`, "iu"),
      );
    }
    expect(threatModel).toMatch(/Node 24[\s\S]{0,120}development-only/iu);
    expect(threatModel).toMatch(/Chromium 151[\s\S]{0,120}development-only/iu);
    expect(threatModel).toMatch(/Chrome 110[\s\S]{0,160}(?:observed|actual)/iu);
    expect(threatModel).not.toMatch(
      /(?:mocks?|source inspection|static [`']?chrome110)[^\n]{0,120}(?:proves?|is release evidence)/iu,
    );
  });
});

describe("Project 1 Task 13 release documentation", () => {
  it("binds every release document to the executable gate contracts", async () => {
    const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8")) as {
      scripts: Record<string, string>;
      packageManager: string;
      engines: Record<string, string>;
    };
    const manifest = JSON.parse(
      await readFile(new URL("config/project1-release-tests.json", root), "utf8"),
    ) as { steps: Array<{ id: string; mode: string; command: string[] }> };
    const evidenceTypes = await readFile(
      new URL("scripts/project1-release-evidence.d.mts", root),
      "utf8",
    );
    const docs = await Promise.all(
      [
        documentation.readme,
        documentation.threatModel,
        documentation.invariants,
        documentation.releaseChecklist,
        documentation.runtimeBoundaries,
        documentation.dependencies,
        documentation.permissions,
        documentation.cryptographicFormat,
      ].map(readDocument),
    );
    const combined = docs.join("\n");

    expect(packageJson.scripts["verify:project1"]).toBe(
      "node scripts/check-engine.mjs --local-command=verify:project1:local-node24 && node scripts/verify-project1-release.mjs --mode=release",
    );
    expect(packageJson.packageManager).toBe("pnpm@10.14.0");
    expect(packageJson.engines).toEqual({ node: ">=22.14.0 <23", pnpm: "10.14.0" });
    for (const phrase of [
      "pnpm verify:project1",
      "Node 22",
      "pnpm 10.14.0",
      "Chrome 110",
      "Node 24",
      "Chromium 151",
      "development-only",
      "ShardPass packaged candidate v1\\0",
      "1980-01-01T00:00:00Z",
      "PASS-PROJECT1-RELEASE",
      "STOP-PROJECT1-RELEASE",
    ])
      expect(combined).toContain(phrase);
    for (const mode of ["bootstrap", "offline", "mock", "audit"])
      expect(combined).toMatch(new RegExp(`\\b${mode}\\b`, "u"));
    for (const step of manifest.steps) {
      expect(combined).toContain(step.id);
      expect(["offline", "mock", "audit"]).toContain(step.mode);
    }
    for (const kind of [
      "bootstrap",
      "source-scan",
      "build",
      "candidate-scan",
      "project1-tests",
      "mock-browser",
      "deterministic-build",
      "archive",
      "audit",
      "docs",
      "task12-chrome110",
      "task12-review",
      "final",
    ])
      expect(evidenceTypes).toContain(`"${kind}"`);
    expect(combined).toMatch(/same[^\n]{0,80}candidateDigest/iu);
    expect(combined).toMatch(/external[^\n]{0,80}(?:review|reviewer)/iu);
    expect(combined).toMatch(/scanner[\s\S]{0,200}exact[\s\S]{0,200}allowlist/iu);
    expect(combined).not.toMatch(
      /(?:OTP\/content secrets\/clipboard\/autofill\/Ente (?:are|remain)|OTP, content secret projections, clipboard, autofill, and Ente are) future/iu,
    );
  });
});

describe("documentation hygiene", () => {
  it("records fallback typography as an accepted nonblocking deviation", async () => {
    const dependencies = await readDocument(documentation.dependencies);

    expect(dependencies).toMatch(/approved system fallback typography/iu);
    expect(dependencies).toMatch(/does not block Project 0 release/iu);
    expect(dependencies).toMatch(/must not claim preferred-font parity/iu);
    expect(dependencies).not.toMatch(/font[\s\S]{0,160}release blocker/iu);
  });

  it("contains no unfinished placeholders", async () => {
    const contents = await Promise.all(Object.values(documentation).map(readDocument));
    for (const content of contents) {
      expect(content).not.toMatch(/\b(?:TBD|TODO)\b/iu);
    }
  });
});
