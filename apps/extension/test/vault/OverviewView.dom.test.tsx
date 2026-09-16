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
  it("shows the score, the counts, what needs a look, and what changed last", async () => {
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
    expect(screen.getByText("5 items in 2 folders.")).toBeVisible();
    expect(within(screen.getByLabelText("Logins")).getByText("4")).toBeVisible();
    expect(within(screen.getByLabelText("Notes")).getByText("1")).toBeVisible();
    expect(within(screen.getByLabelText("Folders")).getByText("2")).toBeVisible();

    const attention = screen.getByRole("region", { name: "Needs a look" });
    expect(await within(attention).findByText("Breached passwords")).toBeVisible();
    expect(within(attention).getByText("Weak passwords")).toBeVisible();
    expect(within(attention).getByText("Reused passwords")).toBeVisible();
    // 4 logins: 1 breached (1.0), 1 weak (0.7), 2 reused (1.2), 4 without 2FA (0.4) → 100 - 82.5.
    const meter = screen.getByRole("meter", { name: "Health score" });
    expect(meter).toHaveAttribute("aria-valuenow", "18");
    expect(screen.getByText("At risk")).toBeVisible();

    const recent = screen.getByRole("region", { name: "Recently changed" });
    const names = within(recent)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names[0]).toContain("Weak one");
    expect(names[1]).toContain("Memo");
    fireEvent.click(within(recent).getAllByRole("button")[0]!);
    expect(onOpenItem).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000002");
    fireEvent.click(within(attention).getByText("Weak passwords"));
    expect(onOpenHealth).toHaveBeenCalled();
  });

  it("says an empty vault is empty and scores it clean", () => {
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
        onOpenImport={() => undefined}
        onNewLogin={() => undefined}
      />,
    );
    expect(screen.getByText(/An empty vault/u)).toBeVisible();
    expect(screen.getByRole("meter", { name: "Health score" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });
});
