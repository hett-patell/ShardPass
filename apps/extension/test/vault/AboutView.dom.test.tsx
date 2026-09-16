import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AboutView } from "../../src/vault/about/AboutView";

interface FakeChrome {
  runtime?: { getManifest: () => { version: string } };
  commands?: { getAll: () => Promise<readonly unknown[]> };
  tabs?: { create: (properties: { url: string }) => void };
}

function withChrome(value: FakeChrome | undefined): void {
  if (value === undefined) Reflect.deleteProperty(globalThis, "chrome");
  else Object.defineProperty(globalThis, "chrome", { configurable: true, value });
}

afterEach(() => {
  cleanup();
  withChrome(undefined);
});

describe("About", () => {
  it("names the version and lists the shortcuts this browser actually has", async () => {
    withChrome({
      runtime: { getManifest: () => ({ version: "9.9.9" }) },
      commands: {
        getAll: () =>
          Promise.resolve([
            // Chrome returns the action command without a description of its own.
            { name: "_execute_action", description: "", shortcut: "Ctrl+Shift+L" },
            { name: "lock-vault", description: "Lock ShardPass", shortcut: "" },
            { name: "fill-login", description: "Fill the login for this page", shortcut: "Alt+F" },
          ]),
      },
    });
    render(<AboutView />);

    expect(screen.getByText("Version 9.9.9")).toBeVisible();
    expect(await screen.findByText("Open ShardPass")).toBeVisible();
    expect(screen.getByText("Ctrl+Shift+L")).toBeVisible();
    expect(screen.getByText("Alt+F")).toBeVisible();
    // A command with no chord says so rather than showing an empty box.
    expect(screen.getByText("Lock ShardPass").parentElement).toHaveTextContent("Not set");
  });

  it("opens the browser's own shortcut settings, which a link may not reach", () => {
    const create = vi.fn();
    withChrome({
      commands: { getAll: () => Promise.resolve([]) },
      tabs: { create },
    });
    render(<AboutView />);

    fireEvent.click(screen.getByRole("button", { name: "Change shortcuts" }));
    expect(create).toHaveBeenCalledWith({ url: "chrome://extensions/shortcuts" });
  });

  it("stands on its own copy where no commands API answers", () => {
    withChrome(undefined);
    render(<AboutView />);

    expect(screen.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
    expect(screen.getByText(/each have a shortcut of their own/)).toBeVisible();
    expect(screen.queryByText("Version")).not.toBeInTheDocument();
  });
});
