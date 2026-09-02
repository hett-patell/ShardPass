import { describe, expect, it } from "vitest";

import { EnteConflictCapabilities } from "../../src/background/ente/conflicts";
import type { EnteOtpProjection } from "../../src/background/ente/protocol";

const otp = (label: string): EnteOtpProjection => ({
  version: 1,
  kind: "otp",
  otpType: "totp",
  issuer: "Issuer",
  label,
  secretBase32: "JBSWY3DPEHPK3PXP",
  algorithm: "SHA1",
  digits: 6,
  period: 30,
});
const binding = {
  sessionEpoch: 7,
  rootDigest: "root-a",
  conflictId: "00000000-0000-4000-8000-000000000001",
  baseDigest: "base",
  localDigest: "local",
  remoteDigest: "remote",
  base: otp("base"),
  local: otp("local"),
  remote: otp("remote"),
};
const request = {
  capability: "capability-000000000000000000000000",
  choice: "keep-local" as const,
  sessionEpoch: 7,
  currentRootDigest: "root-a",
  currentConflictId: binding.conflictId,
  currentDigests: { base: "base", local: "local", remote: "remote" },
};

describe("single-use conflict capabilities", () => {
  it("binds session epoch, root, conflict identity, and complete B/L/R digests", () => {
    const values = new EnteConflictCapabilities(
      () => 10,
      () => request.capability,
    );
    values.issue(binding);
    expect(values.resolve(request)).toMatchObject({ action: "push-local" });
    expect(() => values.resolve(request)).toThrow();
  });

  it.each([
    { currentRootDigest: "root-b" },
    { sessionEpoch: 8 },
    { currentConflictId: "00000000-0000-4000-8000-000000000002" },
    { currentDigests: { base: "base", local: "local", remote: "changed" } },
  ])(
    "rejects a remote/local/root change between preview and resolve without applying",
    (change) => {
      const values = new EnteConflictCapabilities(
        () => 10,
        () => request.capability,
      );
      values.issue(binding);
      expect(() => values.resolve({ ...request, ...change })).toThrow();
      expect(() => values.resolve(request)).toThrow();
    },
  );

  it("expires capabilities", () => {
    let now = 10;
    const values = new EnteConflictCapabilities(
      () => now,
      () => request.capability,
    );
    values.issue(binding, 5);
    now = 16;
    expect(() => values.resolve(request)).toThrow();
  });
});
