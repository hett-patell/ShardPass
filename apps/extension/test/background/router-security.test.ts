import type { SenderContext } from "@shardpass/messaging";
import { describe, expect, it, vi } from "vitest";

import { routeMessage } from "../../src/background/router";
import { BreachCheckError } from "../../src/background/security/breach-check-service";

const extensionId = "expected-extension-id";
const itemId = "10000000-0000-4000-8000-000000000001";
const vaultSender: SenderContext = {
  extensionId,
  contextKind: "vault",
  documentId: "vault-document",
  senderUrl: `chrome-extension://${extensionId}/vault/index.html`,
};
const popupSender: SenderContext = {
  ...vaultSender,
  contextKind: "popup",
  senderUrl: `chrome-extension://${extensionId}/popup/index.html`,
};
const contentSender: SenderContext = {
  extensionId,
  contextKind: "content",
  tabId: 7,
  frameId: 0,
  documentId: "page-document",
  senderUrl: "https://example.test/login",
};

const check = { version: 1, kind: "security.checkItem", itemId } as const;
const route = (
  request: unknown,
  sender: SenderContext,
  handle: (request: unknown) => Promise<unknown>,
) =>
  routeMessage(
    request,
    sender,
    extensionId,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      handle: handle as never,
    },
  );

describe("security routing", () => {
  it("serves the vault page a validated breach result, and nobody else", async () => {
    const handle = vi.fn(() =>
      Promise.resolve({
        version: 1,
        kind: "security.breachResult",
        itemId,
        count: 12,
        checkedAt: 5,
      }),
    );
    await expect(route(check, vaultSender, handle)).resolves.toEqual({
      version: 1,
      kind: "security.breachResult",
      itemId,
      count: 12,
      checkedAt: 5,
    });
    await expect(route(check, popupSender, handle)).resolves.toMatchObject({
      kind: "error",
      error: { code: "UNAUTHORIZED_SENDER" },
    });
    await expect(route(check, contentSender, handle)).resolves.toMatchObject({
      kind: "error",
      error: { code: "UNAUTHORIZED_SENDER" },
    });
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("names a disabled check, and refuses a reply of the wrong shape", async () => {
    await expect(
      route(check, vaultSender, () =>
        Promise.reject(new BreachCheckError("BREACH_CHECK_DISABLED")),
      ),
    ).resolves.toMatchObject({ kind: "error", error: { code: "BREACH_CHECK_DISABLED" } });
    await expect(
      route(check, vaultSender, () =>
        Promise.resolve({ version: 1, kind: "security.settings", breachChecks: true }),
      ),
    ).resolves.toMatchObject({ kind: "error", error: { code: "VAULT_UNAVAILABLE" } });
  });
});
