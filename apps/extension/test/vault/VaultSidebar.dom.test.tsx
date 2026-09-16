// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { Folder } from "@shardpass/domain";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VaultSidebar, type VaultSidebarProps } from "../../src/vault/components/VaultSidebar";

afterEach(cleanup);

const folder = (id: string, name: string, parentId?: string): Folder =>
  ({
    id: `10000000-0000-4000-8000-0000000000${id}`,
    name,
    ...(parentId === undefined
      ? {}
      : { parentId: `10000000-0000-4000-8000-0000000000${parentId}` }),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as Folder;

const work = folder("01", "Work");
const clients = folder("02", "Clients", "01");

function renderSidebar(overrides: Partial<VaultSidebarProps> = {}) {
  const props: VaultSidebarProps = {
    category: "all",
    onCategoryChange: vi.fn(),
    itemCounts: {},
    folders: [work, clients],
    folderCounts: new Map([[clients.id, 3]]),
    selectedFolderId: null,
    onFolderSelect: vi.fn(),
    folderError: null,
    onClearFolderError: vi.fn(),
    onCreateFolder: vi.fn(() => Promise.resolve(true)),
    onRenameFolder: vi.fn(() => Promise.resolve(true)),
    onDeleteFolder: vi.fn(() => Promise.resolve(true)),
    archived: false,
    onOpenArchive: vi.fn(),
    view: "vault",
    onOpenSettings: vi.fn(),
    onOpenEnte: vi.fn(),
    onOpenHealth: vi.fn(),
    onOpenGenerator: vi.fn(),
    onOpenAliases: vi.fn(),
    onOpenOverview: vi.fn(),
    ...overrides,
  };
  return { ...render(<VaultSidebar {...props} />), props };
}

describe("VaultSidebar folders", () => {
  it("counts a folder the way clicking it lists: items in its sub-folders included", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: /^Work/ })).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: /^Clients/ })).toHaveTextContent("3");
  });

  it("forgets a stale folder error when the attempt is abandoned", () => {
    const { props } = renderSidebar({ folderError: "That name is already used here." });
    expect(screen.getByRole("alert")).toHaveTextContent("That name is already used here.");
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(props.onClearFolderError).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Delete Clients" }));
    expect(props.onClearFolderError).toHaveBeenCalledTimes(2);
  });

  it("returns focus to the folder after the delete dialog closes, since its trash button is hover-only", async () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Delete Clients" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Clients/ })).toHaveFocus());
  });
});

describe("VaultSidebar tools", () => {
  it("lists the tools above the categories and opens each", () => {
    const { props } = renderSidebar();
    const nav = screen.getByRole("navigation", { name: "Tools" });
    expect(
      nav.compareDocumentPosition(screen.getByRole("navigation", { name: "Categories" })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    fireEvent.click(screen.getByRole("button", { name: "Password generator" }));
    expect(props.onOpenGenerator).toHaveBeenCalledWith("random");
    fireEvent.click(screen.getByRole("button", { name: "Username generator" }));
    expect(props.onOpenGenerator).toHaveBeenCalledWith("username");
    fireEvent.click(screen.getByRole("button", { name: "Email aliases" }));
    expect(props.onOpenAliases).toHaveBeenCalledTimes(1);
  });

  it("marks the open tool as current", () => {
    renderSidebar({ view: "generator", generatorTool: "username" });
    expect(screen.getByRole("button", { name: "Username generator" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: "Password generator" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

describe("VaultSidebar overview", () => {
  it("puts Overview above the tools and opens it", () => {
    const { props } = renderSidebar({ view: "overview" });
    const overview = screen.getByRole("button", { name: "Overview" });
    expect(overview).toHaveAttribute("aria-current", "true");
    expect(
      overview.compareDocumentPosition(screen.getByRole("button", { name: "Password generator" })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    fireEvent.click(overview);
    expect(props.onOpenOverview).toHaveBeenCalledTimes(1);
  });
});
