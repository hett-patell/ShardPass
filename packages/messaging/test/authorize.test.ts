import { describe, expect, expectTypeOf, it } from "vitest";

import { authorizeSender, foundationSenderPolicy } from "../src/authorize";
import type { SenderContext, SenderPolicy } from "../src/context";

const extensionId = "expected-extension-id";

const popupSender: SenderContext = {
  extensionId,
  contextKind: "popup",
  documentId: "popup-document",
  senderUrl: `chrome-extension://${extensionId}/popup/index.html`,
};

const vaultSender: SenderContext = {
  extensionId,
  contextKind: "vault",
  documentId: "vault-document",
  senderUrl: `chrome-extension://${extensionId}/vault/index.html`,
};

const contentSender: SenderContext = {
  extensionId,
  contextKind: "content",
  tabId: 7,
  frameId: 0,
  documentId: "document-id",
  senderUrl: "https://example.test/login",
};

const popupOnlyPolicy: SenderPolicy = {
  extensionId,
  allowedContexts: ["popup"],
};

const contentPolicy: SenderPolicy = {
  extensionId,
  allowedContexts: ["content"],
  requireTab: true,
  requireFrame: true,
  requireDocument: true,
};

describe("sender authorization", () => {
  it("authorizes only explicitly allowed extension-page contexts", () => {
    expect(authorizeSender(popupSender, popupOnlyPolicy)).toBe(true);
    expect(authorizeSender(vaultSender, popupOnlyPolicy)).toBe(false);
    expect(authorizeSender(contentSender, popupOnlyPolicy)).toBe(false);
  });

  it("rejects an unknown extension ID", () => {
    expect(
      authorizeSender({ ...popupSender, extensionId: "unknown-extension-id" }, popupOnlyPolicy),
    ).toBe(false);
  });

  it("rejects content without required browser-owned identity", () => {
    expect(
      authorizeSender(
        {
          extensionId,
          contextKind: "content",
          frameId: 0,
          documentId: "document-id",
          senderUrl: "https://example.test/login",
        },
        contentPolicy,
      ),
    ).toBe(false);
    expect(
      authorizeSender(
        {
          extensionId,
          contextKind: "content",
          tabId: 7,
          documentId: "document-id",
          senderUrl: "https://example.test/login",
        },
        contentPolicy,
      ),
    ).toBe(false);
    expect(
      authorizeSender(
        {
          extensionId,
          contextKind: "content",
          tabId: 7,
          frameId: 0,
          senderUrl: "https://example.test/login",
        },
        contentPolicy,
      ),
    ).toBe(false);
  });

  it("accepts frame zero and complete content identity", () => {
    expect(authorizeSender(contentSender, contentPolicy)).toBe(true);
  });

  it.each(["tabId", "frameId"] as const)(
    "fails closed for malformed runtime %s values",
    (field) => {
      const values: unknown[] = [undefined, null, -1, Number.NaN, 1.5, -1.5];
      for (const value of values) {
        const input: unknown = { ...contentSender, [field]: value };
        expect(authorizeSender(input, contentPolicy)).toBe(false);
      }
    },
  );

  it.each([
    null,
    [],
    { ...popupSender, senderUrl: "https://example.test/login" },
    {
      ...contentSender,
      senderUrl: `chrome-extension://${extensionId}/popup/index.html`,
    },
    { ...contentSender, contextKind: "unknown" },
  ])("fails closed for malformed or inconsistent runtime context: %j", (input: unknown) => {
    expect(authorizeSender(input, popupOnlyPolicy)).toBe(false);
    expect(authorizeSender(input, contentPolicy)).toBe(false);
  });

  it("defines an explicit policy for the foundation command", () => {
    expect(foundationSenderPolicy["foundation.getStatus"]).toEqual({
      allowedContexts: ["popup", "vault"],
      requireTab: false,
      requireFrame: false,
      requireDocument: false,
    });
    expect(
      authorizeSender(popupSender, {
        extensionId,
        ...foundationSenderPolicy["foundation.getStatus"],
      }),
    ).toBe(true);
    expect(
      authorizeSender(vaultSender, {
        extensionId,
        ...foundationSenderPolicy["foundation.getStatus"],
      }),
    ).toBe(true);
    expect(
      authorizeSender(contentSender, {
        extensionId,
        ...foundationSenderPolicy["foundation.getStatus"],
      }),
    ).toBe(false);
  });

  it("exposes a normalized sender-context union to the later browser boundary", () => {
    expectTypeOf<SenderContext["contextKind"]>().toEqualTypeOf<"popup" | "vault" | "content">();
    expectTypeOf<Extract<SenderContext, { contextKind: "content" }>>().toHaveProperty("documentId");
  });
});
