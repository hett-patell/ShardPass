import { describe, expect, it } from "vitest";

import { computeHealth } from "../../src/vault/health/health-report";
import { acceptsPasskeys, registrableDomain } from "../../src/vault/health/passkey-sites";

describe("passkey-ready sites", () => {
  it("reduces a saved URL to its registrable domain", () => {
    expect(registrableDomain("https://accounts.google.com/signin")).toBe("google.com");
    expect(registrableDomain("github.com")).toBe("github.com");
    expect(registrableDomain("https://www.amazon.co.uk/ap/signin")).toBe("amazon.co.uk");
    expect(registrableDomain("not a url ://")).toBe("");
  });

  it("flags logins on known passkey sites that have no passkey yet", () => {
    expect(acceptsPasskeys(["https://accounts.google.com"])).toBe(true);
    expect(acceptsPasskeys(["https://intranet.example"])).toBe(false);
    const base = {
      schemaVersion: 2 as const,
      revision: 1,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      favorite: false,
      tags: [],
      kind: "login" as const,
      username: "alice",
      password: "correct-horse-battery-staple",
      notes: "",
    };
    const report = computeHealth([
      {
        ...base,
        id: "10000000-0000-4000-8000-000000000001",
        name: "Google",
        urls: ["https://accounts.google.com"],
      },
      {
        ...base,
        id: "10000000-0000-4000-8000-000000000002",
        name: "GitHub",
        urls: ["https://github.com"],
        passkeys: [{ credentialId: "AAAA" }],
      },
      {
        ...base,
        id: "10000000-0000-4000-8000-000000000003",
        name: "Intranet",
        urls: ["https://intranet.example"],
      },
    ] as never);
    expect(report.passkeyReady.map((login) => login.name)).toEqual(["Google"]);
  });
});
