// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PopupTitleBar } from "../../src/popup/components/PopupTitleBar";

afterEach(cleanup);

describe("PopupTitleBar", () => {
  it("focuses the title once per screen, not on every re-render with a fresh back object", () => {
    const view = render(
      <PopupTitleBar
        back={{ label: "Back", onBack: vi.fn() }}
        title="Logins"
        trailing={<button type="button">Copy</button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Logins" })).toHaveFocus();

    screen.getByRole("button", { name: "Copy" }).focus();
    view.rerender(
      <PopupTitleBar
        back={{ label: "Back", onBack: vi.fn() }}
        title="Logins"
        trailing={<button type="button">Copy</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Copy" })).toHaveFocus();

    view.rerender(
      <PopupTitleBar
        back={{ label: "Back", onBack: vi.fn() }}
        title="Notes"
        trailing={<button type="button">Copy</button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Notes" })).toHaveFocus();
  });
});
