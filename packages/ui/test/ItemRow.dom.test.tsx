import "@testing-library/jest-dom/vitest";

import axe from "axe-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ItemRow } from "../src/index";

afterEach(cleanup);

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  expect(results.violations).toEqual([]);
}

describe("ItemRow", () => {
  it("renders the item name, subtitle, and a kind-specific icon", async () => {
    const { container } = render(
      <ItemRow kind="login" name="Acme Corp" subtitle="jane@example.com" />,
    );

    expect(screen.getByRole("button", { name: /Acme Corp/ })).toBeVisible();
    expect(screen.getByText("jane@example.com")).toBeVisible();
    // A login the browser has no icon for shows its initials, out of the accessible name.
    expect(screen.getByText("AC")).toBeVisible();
    expect(screen.getByRole("button", { name: /Acme Corp/ })).not.toHaveAccessibleName(/AC /);
    await expectNoAxeViolations(container);

    const { container: note } = render(<ItemRow kind="note" name="Memo" />);
    expect(note.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the site icon for a login when one is given, and the initials when it fails", () => {
    const { container } = render(
      <ItemRow
        kind="login"
        name="Example Site"
        iconUrl="chrome-extension://x/_favicon/?pageUrl=a"
      />,
    );
    const image = container.querySelector("img");
    expect(image).toHaveAttribute("src", "chrome-extension://x/_favicon/?pageUrl=a");
    fireEvent.error(image!);
    expect(screen.getByText("ES")).toBeVisible();
  });

  it("renders without a subtitle when none is given", () => {
    render(<ItemRow kind="secret" name="API key" />);

    expect(screen.getByRole("button", { name: "API key" })).toBeVisible();
  });

  it("fires onClick when activated", () => {
    const onClick = vi.fn();
    render(<ItemRow kind="otp" name="GitHub" onClick={onClick} />);

    fireEvent.click(screen.getByRole("button", { name: "GitHub" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("marks the active row with aria-current", () => {
    const { rerender } = render(<ItemRow kind="note" name="Wi-Fi password" />);
    const row = screen.getByRole("button", { name: "Wi-Fi password" });

    expect(row).not.toHaveAttribute("aria-current");

    rerender(<ItemRow kind="note" name="Wi-Fi password" active />);
    expect(row).toHaveAttribute("aria-current", "true");
    expect(row.className).toMatch(/active/);
  });

  it("renders optional right-aligned content", () => {
    render(<ItemRow kind="card" name="Visa ending 4242" rightContent={<span>Favorite</span>} />);

    expect(screen.getByText("Favorite")).toBeVisible();
  });

  it("renders a distinct icon per vault item kind", () => {
    const kinds = ["login", "otp", "note", "card", "identity", "secret"] as const;
    const icons = kinds.map((kind) => {
      const { container, unmount } = render(<ItemRow kind={kind} name={kind} />);
      const markup = container.querySelector("svg")?.outerHTML;
      unmount();
      return markup;
    });

    expect(new Set(icons).size).toBe(kinds.length);
  });
});
