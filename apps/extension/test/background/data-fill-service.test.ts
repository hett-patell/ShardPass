import type { SenderContext } from "@shardpass/messaging";
import { describe, expect, it } from "vitest";

import { DataFillService } from "../../src/background/login/data-fill-service";

const cardId = "10000000-0000-4000-8000-000000000001";
const card = {
  id: cardId,
  kind: "card",
  schemaVersion: 2,
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  favorite: false,
  tags: [],
  name: "Visa",
  cardholderName: "A Person",
  number: "4111111111111111",
  expMonth: "12",
  expYear: "2030",
  cvv: "123",
  pin: "",
  notes: "",
} as const;
const popup: SenderContext = {
  extensionId: "ext",
  contextKind: "popup",
  documentId: "popup-doc",
  senderUrl: "chrome-extension://ext/popup/index.html",
};
const page = (tabId: number): SenderContext => ({
  extensionId: "ext",
  contextKind: "content",
  tabId,
  frameId: 0,
  documentId: "page-doc",
  senderUrl: "https://shop.test/checkout",
});

function service(now = 1_000, reprompt = false) {
  return new DataFillService({
    repository: {
      getItem: (id) => Promise.resolve(id === cardId ? ({ ...card, reprompt } as never) : null),
    },
    now: () => now,
    notePrivilegedActivity: () => Promise.resolve(),
    repromptGranted: () => false,
  });
}

describe("DataFillService frames", () => {
  it("releases only to the tab's top frame, and a sub-frame's attempt does not spend the grant", async () => {
    const fill = service();
    await fill.handle({ version: 1, kind: "data.fillGrant", itemId: cardId, tabId: 7 }, popup);
    const subframe: SenderContext = {
      ...(page(7) as Extract<SenderContext, { contextKind: "content" }>),
      frameId: 3,
    };
    await expect(
      fill.handle({ version: 1, kind: "data.fillSelect", itemId: cardId }, subframe),
    ).rejects.toMatchObject({ code: "DATA_FILL_INVALID" });
    await expect(
      fill.handle({ version: 1, kind: "data.fillSelect", itemId: cardId }, page(7)),
    ).resolves.toMatchObject({ kind: "data.fillRelease", data: "card" });
    await expect(
      fill.handle({ version: 1, kind: "data.fillSelect", itemId: cardId }, page(7)),
    ).rejects.toMatchObject({ code: "DATA_FILL_INVALID" });
  });

  it("forgets every grant when asked, as the lock does", async () => {
    const fill = service();
    await fill.handle({ version: 1, kind: "data.fillGrant", itemId: cardId, tabId: 7 }, popup);
    fill.clear();
    await expect(
      fill.handle({ version: 1, kind: "data.fillSelect", itemId: cardId }, page(7)),
    ).rejects.toMatchObject({ code: "DATA_FILL_INVALID" });
  });
});

describe("DataFillService", () => {
  it("releases a card once, only to the tab the popup granted, and never to a page on its own", async () => {
    const fill = service();
    await expect(
      fill.handle({ version: 1, kind: "data.fillSelect", itemId: cardId }, page(7)),
    ).rejects.toMatchObject({
      code: "DATA_FILL_INVALID",
    });
    await expect(
      fill.handle({ version: 1, kind: "data.fillGrant", itemId: cardId, tabId: 7 }, popup),
    ).resolves.toMatchObject({
      kind: "data.fillGranted",
      itemId: cardId,
    });
    await expect(
      fill.handle({ version: 1, kind: "data.fillSelect", itemId: cardId }, page(8)),
    ).rejects.toMatchObject({
      code: "DATA_FILL_INVALID",
    });
    await fill.handle({ version: 1, kind: "data.fillGrant", itemId: cardId, tabId: 7 }, popup);
    await expect(
      fill.handle({ version: 1, kind: "data.fillSelect", itemId: cardId }, page(7)),
    ).resolves.toMatchObject({
      kind: "data.fillRelease",
      data: "card",
      card: { number: "4111111111111111", cvv: "123" },
    });
    await expect(
      fill.handle({ version: 1, kind: "data.fillSelect", itemId: cardId }, page(7)),
    ).rejects.toMatchObject({
      code: "DATA_FILL_INVALID",
    });
  });

  it("refuses an unknown item and one that asks for the master password first", async () => {
    await expect(
      service().handle(
        {
          version: 1,
          kind: "data.fillGrant",
          itemId: "10000000-0000-4000-8000-000000000002",
          tabId: 7,
        },
        popup,
      ),
    ).rejects.toMatchObject({ code: "DATA_FILL_NOT_FOUND" });
    await expect(
      service(1_000, true).handle(
        { version: 1, kind: "data.fillGrant", itemId: cardId, tabId: 7 },
        popup,
      ),
    ).rejects.toMatchObject({
      code: "REPROMPT_REQUIRED",
    });
  });
});
