// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { LoginItem, NoteItem } from "@shardpass/domain";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OverviewView } from "../../src/vault/overview/OverviewView";

afterEach(cleanup);

const base = {
  schemaVersion: 2 as const,
  revision: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  favorite: false,
  tags: [],
};
function login(suffix: string, name: string, password: string, updatedAt: string): LoginItem {
  return {
    ...base,
    id: `10000000-0000-4000-8000-0000000000${suffix}`,
    kind: "login",
    name,
    username: "alice",
    password,
    urls: ["https://example.com"],
    notes: "",
    updatedAt,
  };
}
const note: NoteItem = {
  ...base,
  id: "10000000-0000-4000-8000-0000000000ff",
  kind: "note",
  name: "Memo",
  content: "",
  updatedAt: "2026-09-10T00:00:00.000Z",
};

describe("OverviewView", () => {
  it("ranks the findings, names the accounts, and opens the health page at the one clicked", async () => {
    const items = [
      login("01", "Old strong", "correct-horse-battery-staple-9", "2026-09-02T00:00:00.000Z"),
      login("02", "Weak one", "weak", "2026-09-12T00:00:00.000Z"),
      login("03", "Twin A", "twin-password-shared-1", "2026-09-03T00:00:00.000Z"),
      login("04", "Twin B", "twin-password-shared-1", "2026-09-04T00:00:00.000Z"),
      note,
    ];
    const sendMessage = vi.fn(() =>
      Promise.resolve({
        version: 1,
        kind: "security.results",
        results: [
          { itemId: "10000000-0000-4000-8000-000000000001", count: 3, checkedAt: 1, stale: false },
        ],
      }),
    );
    const onOpenItem = vi.fn();
    const onOpenHealth = vi.fn();
    render(
      <OverviewView
        platform={{ sendMessage }}
        items={items}
        folderCount={2}
        redactedIds={new Set()}
        active
        onOpenItem={onOpenItem}
        onOpenHealth={onOpenHealth}
        onOpenGenerator={() => undefined}
        onOpenImport={() => undefined}
        onNewLogin={() => undefined}
      />,
    );
    // The count is its own element, so the line is checked whole rather than by its text node.
    expect(screen.getByText(/items in 2 folders, last changed/u)).toHaveTextContent(
      "5 items in 2 folders",
    );

    const queue = screen.getByRole("region", { name: /What to fix first/u });
    // The breach verdicts arrive after the first paint; the queue is read once they have.
    await within(queue).findByText("Breached password");
    const rows = within(queue).getAllByRole("button");
    // A breached password outranks weak and reused however many of those there are.
    expect(rows[0]).toHaveTextContent("Breached password");
    expect(rows[0]).toHaveTextContent("Old strong appeared in a known breach.");
    expect(rows.map((row) => row.textContent?.includes("Reused passwords")).some(Boolean)).toBe(
      true,
    );
    // Every login here lacks a second factor, so it is a footnote rather than a queue row.
    expect(within(queue).queryByText(/No second factor/u)).not.toBeInTheDocument();
    expect(within(queue).getByText(/4 logins have no second factor/u)).toBeVisible();

    // 4 logins: 1 breached (1.0), 1 weak (0.7), 2 reused (1.2), 4 without 2FA (0.4) → 100 - 82.5.
    const meter = screen.getByRole("meter", { name: "Health score" });
    expect(meter).toHaveAttribute("aria-valuenow", "18");
    expect(screen.getByText("At risk")).toBeVisible();

    fireEvent.click(rows[0]!);
    expect(onOpenHealth).toHaveBeenCalledWith("breached");
    fireEvent.click(within(queue).getByRole("button", { name: "See which" }));
    expect(onOpenHealth).toHaveBeenCalledWith("2fa");

    const composition = screen.getByRole("region", { name: "What is in the vault" });
    expect(within(composition).getByText("Logins")).toBeVisible();
    expect(within(composition).getByText("4")).toBeVisible();
    // Kinds nobody has saved are one sentence, not a tile apiece.
    expect(
      within(composition).getByText(/Empty so far: one-time codes, cards, identities, secrets/u),
    ).toBeVisible();

    const recent = screen.getByRole("region", { name: "Recently changed" });
    const names = within(recent)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names[0]).toContain("Weak one");
    expect(names[1]).toContain("Memo");
    fireEvent.click(within(recent).getAllByRole("button")[0]!);
    expect(onOpenItem).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000002");
  });

  it("says so plainly when nothing needs attention", async () => {
    render(
      <OverviewView
        platform={{ sendMessage: vi.fn(() => Promise.resolve(undefined)) }}
        items={[
          login("01", "Strong", "correct-horse-battery-staple-9", "2026-09-02T00:00:00.000Z"),
        ]}
        folderCount={0}
        redactedIds={new Set()}
        active
        onOpenItem={() => undefined}
        onOpenHealth={() => undefined}
        onOpenGenerator={() => undefined}
        onOpenImport={() => undefined}
        onNewLogin={() => undefined}
      />,
    );
    expect(
      await screen.findByText("No breached, weak or reused passwords among them."),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Nothing needs attention" })).toBeVisible();
  });

  it("asks an empty vault to be filled, with the two ways to do it", () => {
    const onOpenImport = vi.fn();
    render(
      <OverviewView
        platform={{ sendMessage: vi.fn(() => Promise.resolve(undefined)) }}
        items={[]}
        folderCount={0}
        redactedIds={new Set()}
        active
        onOpenItem={() => undefined}
        onOpenHealth={() => undefined}
        onOpenGenerator={() => undefined}
        onOpenImport={onOpenImport}
        onNewLogin={() => undefined}
      />,
    );
    expect(screen.getByRole("heading", { name: "Your vault is empty." })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Import from another manager" }));
    expect(onOpenImport).toHaveBeenCalled();
    // No score, no queue, no empty bar: an empty vault has nothing to report on.
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });
});
