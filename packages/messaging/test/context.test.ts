import { describe, expect, expectTypeOf, it } from "vitest";

import { normalizeSenderContext, SenderContextSchema } from "../src/context";
import type { RawSenderMetadata, SenderContext } from "../src/context";

const extensionId = "expected-extension-id";

const contentMetadata = {
  extensionId,
  senderUrl: "https://example.test/login",
  tabId: 7,
  frameId: 0,
  documentId: "document-id",
} satisfies RawSenderMetadata;

const invalidIdentityValues: ReadonlyArray<readonly [string, unknown]> = [
  ["undefined", undefined],
  ["null", null],
  ["negative integer", -1],
  ["NaN", Number.NaN],
  ["positive fraction", 1.5],
  ["negative fraction", -1.5],
];

describe("sender context normalization", () => {
  it.each([
    ["popup", `/popup/index.html`],
    ["vault", `/vault/index.html`],
  ] as const)(
    "rejects the approved %s extension page without document identity",
    (_contextKind, path) => {
      const input: unknown = {
        extensionId,
        senderUrl: `chrome-extension://${extensionId}${path}`,
      };

      expect(normalizeSenderContext(input, extensionId)).toBeNull();
    },
  );

  it.each([
    ["popup", { documentId: "popup-document-id" }],
    ["vault", { tabId: 7, frameId: 0, documentId: "vault-document-id" }],
  ] as const)(
    "classifies the approved %s extension page while retaining valid browser identity",
    (contextKind, identity) => {
      const senderUrl = `chrome-extension://${extensionId}/${contextKind}/index.html`;
      expect(normalizeSenderContext({ extensionId, senderUrl, ...identity }, extensionId)).toEqual({
        extensionId,
        contextKind,
        senderUrl,
        ...identity,
      });
    },
  );

  it.each([
    ["tabId", -1],
    ["tabId", 1.5],
    ["frameId", -1],
    ["frameId", Number.NaN],
    ["documentId", ""],
    ["documentId", null],
  ])("rejects malformed optional extension-page %s: %j", (field, value) => {
    expect(
      normalizeSenderContext(
        {
          extensionId,
          senderUrl: `chrome-extension://${extensionId}/popup/index.html`,
          [field]: value,
        },
        extensionId,
      ),
    ).toBeNull();
  });

  it("classifies an HTTP(S) sender with complete browser identity as content", () => {
    const input: unknown = contentMetadata;

    expect(normalizeSenderContext(input, extensionId)).toEqual({
      ...contentMetadata,
      contextKind: "content",
    });
  });

  it.each(["tabId", "frameId"] as const)("rejects omitted %s", (field) => {
    const input: Record<string, unknown> = { ...contentMetadata };
    delete input[field];

    expect(normalizeSenderContext(input, extensionId)).toBeNull();
  });

  it.each(["tabId", "frameId"] as const)("rejects invalid runtime %s values", (field) => {
    for (const [label, value] of invalidIdentityValues) {
      const input: unknown = { ...contentMetadata, [field]: value };
      expect(normalizeSenderContext(input, extensionId), label).toBeNull();
    }
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["null", null],
    ["number", 42],
  ])("rejects %s document identity", (_label, documentId) => {
    const input: unknown = { ...contentMetadata, documentId };
    expect(normalizeSenderContext(input, extensionId)).toBeNull();
  });

  it.each([
    {
      extensionId,
      contextKind: "popup",
      senderUrl: "https://example.test/login",
      tabId: 7,
      frameId: 0,
      documentId: "document-id",
    },
    {
      extensionId,
      contextKind: "vault",
      senderUrl: "https://example.test/login",
      tabId: 7,
      frameId: 0,
      documentId: "document-id",
    },
    {
      extensionId,
      contextKind: "content",
      senderUrl: `chrome-extension://${extensionId}/popup/index.html`,
      tabId: 7,
      frameId: 0,
      documentId: "document-id",
    },
  ])("rejects forged or inconsistent sender metadata: %j", (input: unknown) => {
    expect(normalizeSenderContext(input, extensionId)).toBeNull();
  });

  it.each([
    `chrome-extension://${extensionId}/unknown/index.html`,
    `chrome-extension://${extensionId}/popup/index.html?forged=true`,
    `chrome-extension://${extensionId}/vault/index.html#forged`,
    "file:///popup/index.html",
    "ftp://example.test/login",
  ])("rejects an unknown sender URL: %s", (senderUrl) => {
    const input: unknown = { ...contentMetadata, senderUrl };
    expect(normalizeSenderContext(input, extensionId)).toBeNull();
  });

  it("rejects metadata from another extension", () => {
    const input: unknown = {
      extensionId: "unknown-extension-id",
      senderUrl: `chrome-extension://unknown-extension-id/popup/index.html`,
    };
    expect(normalizeSenderContext(input, extensionId)).toBeNull();
  });

  it("exports a runtime schema matching normalized contexts", () => {
    const normalized = normalizeSenderContext(contentMetadata, extensionId);
    expect(SenderContextSchema.safeParse(normalized).success).toBe(true);
    expectTypeOf<SenderContext>().toEqualTypeOf<NonNullable<typeof normalized>>();
  });
});
