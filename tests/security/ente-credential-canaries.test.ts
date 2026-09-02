import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const sources = [
  "../../apps/extension/src/vault/ente/EnteSettings.tsx",
  "../../apps/extension/src/vault/ente/useEnteSync.ts",
  "../../apps/extension/src/background/ente/ente-service.ts",
  "../../apps/extension/src/vault/ente/ente-auth-executor.ts",
];

describe("Task 12 credential canaries", () => {
  it("keeps sensitive values out of UI state, diagnostics, and logs", async () => {
    const text = (
      await Promise.all(sources.map((source) => readFile(new URL(source, import.meta.url), "utf8")))
    ).join("\n");
    expect(text).not.toMatch(/console\.|logger\.|localStorage|sessionStorage/u);
    expect(text).not.toMatch(
      /dangerouslySetInnerHTML|JSON\.stringify\([^)]*(?:password|code|email)/u,
    );
    expect(text).not.toMatch(/otpauth:\/\/|secretBase32|encryptedData|remoteId|authKeyEnvelope/u);
    expect(text).toContain("clearSensitive");
    expect(text).toContain("fill(0)");
  });
});
