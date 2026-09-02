import type { LegacyEnteState } from "@shardpass/importers/legacy-v1";
import { describe, expect, it } from "vitest";
import { EnteOtpMetadataStore } from "../../src/background/ente/ente-otp-metadata-store";

const otpIds = new Set([
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a29",
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a28",
]);
const state: LegacyEnteState = {
  email: "fixture@example.invalid",
  serverUrl: "https://synthetic.invalid",
  authToken: "synthetic-token-placeholder",
  masterKey: "synthetic-key-placeholder",
  entityMap: { remote: [...otpIds][0]! },
  pending: [
    { op: "create", accountId: [...otpIds][1]!, enqueuedAt: 1, attempts: 0 },
    { op: "update", accountId: [...otpIds][0]!, enteId: "remote", enqueuedAt: 2, attempts: 0 },
    { op: "delete", accountId: [...otpIds][0]!, enteId: "remote", enqueuedAt: 3, attempts: 0 },
  ],
};
describe("EnteOtpMetadataStore", () => {
  it("returns only safe counts", () => {
    const projection = new EnteOtpMetadataStore().parse(state, otpIds);
    expect(projection).toEqual({
      present: true,
      entityCount: 1,
      pendingCount: 3,
      createCount: 1,
      updateCount: 1,
      deleteCount: 1,
    });
    expect(JSON.stringify(projection)).not.toContain("fixture@example.invalid");
  });
  it("rejects dangling account references and duplicate semantic operations", () => {
    const store = new EnteOtpMetadataStore();
    expect(() =>
      store.parse(
        { ...state, entityMap: { remote: "018f47a6-7d11-7c2f-8bd9-a1d37f147a30" } },
        otpIds,
      ),
    ).toThrow();
    const duplicate = {
      op: "update" as const,
      accountId: [...otpIds][0]!,
      enteId: "remote",
      enqueuedAt: 4,
      attempts: 1,
    };
    expect(() =>
      store.parse({ ...state, pending: [duplicate, { ...duplicate, attempts: 2 }] }, otpIds),
    ).toThrow();
  });
  it("projects absent state safely", () => {
    expect(new EnteOtpMetadataStore().parse(undefined, otpIds)).toEqual({
      present: false,
      entityCount: 0,
      pendingCount: 0,
      createCount: 0,
      updateCount: 0,
      deleteCount: 0,
    });
  });
});
