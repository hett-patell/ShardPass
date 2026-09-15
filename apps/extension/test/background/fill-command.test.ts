import type { LoginFillSuggestion } from "@shardpass/messaging";
import { describe, expect, it, vi } from "vitest";

import { createFillCommand } from "../../src/background/login/fill-command";

const suggestion = (overrides: Partial<LoginFillSuggestion> = {}): LoginFillSuggestion => ({
  itemId: "10000000-0000-4000-8000-000000000001",
  expectedRevision: 3,
  name: "Example",
  username: "alice",
  favorite: false,
  tags: [],
  hasLinkedOtp: false,
  ...overrides,
});

function harness(suggestions: readonly LoginFillSuggestion[] | Error, fillStatus = "filled") {
  const fillInTab = vi.fn(() => Promise.resolve({ status: fillStatus }));
  const openPopup = vi.fn(() => Promise.resolve());
  const command = createFillCommand({
    activeTab: () => Promise.resolve({ id: 7, url: "https://example.test/login" }),
    suggestionsFor: () =>
      suggestions instanceof Error ? Promise.reject(suggestions) : Promise.resolve(suggestions),
    fillInTab,
    openPopup,
  });
  return { command, fillInTab, openPopup };
}

describe("fill command", () => {
  it("fills the page's one login straight into the active tab", async () => {
    const { command, fillInTab, openPopup } = harness([suggestion()]);
    await expect(command.run()).resolves.toBe("filled");
    expect(fillInTab).toHaveBeenCalledWith(7, "10000000-0000-4000-8000-000000000001", 3);
    expect(openPopup).not.toHaveBeenCalled();
  });

  it("opens the popup when there are several logins, none, a locked vault, or a page that cannot be filled", async () => {
    for (const setup of [
      harness([suggestion(), suggestion({ itemId: "10000000-0000-4000-8000-000000000002" })]),
      harness([]),
      harness(Object.assign(new Error("locked"), { code: "VAULT_LOCKED" })),
      harness([suggestion()], "no-form"),
    ]) {
      await expect(setup.command.run()).resolves.toBe("popup");
      expect(setup.openPopup).toHaveBeenCalledTimes(1);
    }
  });

  it("leaves logins that ask for the master password, or sign in through a provider, to the popup", async () => {
    const { command, fillInTab, openPopup } = harness([suggestion({ reprompt: true })]);
    await expect(command.run()).resolves.toBe("popup");
    expect(fillInTab).not.toHaveBeenCalled();
    expect(openPopup).toHaveBeenCalledTimes(1);
    const provider = harness([suggestion({ signInWith: "google" })]);
    await expect(provider.command.run({ id: 9, url: "https://example.test" })).resolves.toBe(
      "popup",
    );
  });

  it("does nothing on a page that is not a website", async () => {
    const { command, openPopup } = harness([suggestion()]);
    await expect(command.run({ id: 1, url: "chrome://extensions" })).resolves.toBe("nothing");
    expect(openPopup).not.toHaveBeenCalled();
  });
});
