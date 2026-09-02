import "@testing-library/jest-dom/vitest";

import type { OtpEditableInput, OtpRequest, OtpResponse } from "@shardpass/messaging";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { Profiler } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  OtpImportUiExtensionPlatform,
  OtpUiExtensionPlatform,
} from "../../src/platform/extension-platform";
import { OtpVaultView } from "../../src/vault/otp/OtpVaultView";

const itemId = "10000000-0000-4000-8000-000000000010";
const secondId = "10000000-0000-4000-8000-000000000011";
const deterministicSecret = "JBSWY3DPEHPK3PXP";
const item = {
  id: itemId,
  revision: 3,
  issuer: "North Lab",
  label: "Operator",
  otpType: "totp" as const,
  favorite: false,
  tags: ["work"],
};
const editor = {
  ...item,
  secret: deterministicSecret,
  algorithm: "SHA1" as const,
  digits: 6,
  period: 30,
  note: "Local account",
};

function createPlatform(responder?: (request: OtpRequest) => Promise<OtpResponse>) {
  const sendOtpMessage = vi.fn(
    responder ??
      ((request: OtpRequest): Promise<OtpResponse> => {
        if (request.kind === "otp.list")
          return Promise.resolve({ version: 1, kind: "otp.listResult", items: [item] });
        if (request.kind === "otp.getEditor")
          return Promise.resolve({ version: 1, kind: "otp.editorResult", item: editor });
        if (request.kind === "otp.create" || request.kind === "otp.update")
          return Promise.resolve({ version: 1, kind: "otp.mutationResult", item });
        if (request.kind === "otp.delete")
          return Promise.resolve({ version: 1, kind: "otp.deleteResult", itemId, revision: 4 });
        throw new Error("unexpected request");
      }),
  );
  const platform: OtpUiExtensionPlatform & OtpImportUiExtensionPlatform = {
    extensionId: "vault-test-id",
    onMessage: () => () => undefined,
    sendMessage: () => Promise.resolve(undefined),
    sendOtpMessage,
    sendOtpImportMessage: () => Promise.reject(new Error("unused")),
    writeAuthoritativeClipboardText: () => Promise.resolve(),
    openVaultPage: () => Promise.resolve(),
  };
  return { platform, sendOtpMessage };
}

async function openEditor() {
  fireEvent.click(await screen.findByRole("option", { name: /North Lab.*Operator/i }));
  return screen.findByRole("heading", { name: "Edit OTP" });
}

function fillCreateForm(overrides: Partial<OtpEditableInput> = {}) {
  const values: OtpEditableInput = {
    issuer: "Field Unit",
    label: "Primary",
    secret: deterministicSecret,
    otpType: "totp",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    favorite: false,
    tags: ["device"],
    note: "",
    ...overrides,
  };
  fireEvent.change(screen.getByLabelText("Issuer"), { target: { value: values.issuer } });
  fireEvent.change(screen.getByLabelText("Label"), { target: { value: values.label } });
  fireEvent.click(screen.getByRole("button", { name: "Reveal secret" }));
  fireEvent.change(screen.getByLabelText("Secret"), { target: { value: values.secret } });
  fireEvent.change(screen.getByLabelText("Tags"), { target: { value: values.tags.join(", ") } });
}

async function expectNoSeriousAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    resultTypes: ["violations"],
    rules: { "color-contrast": { enabled: false } },
  });
  expect(
    results.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("OtpVaultView", () => {
  it("debounces one bounded background search and ignores a stale response", async () => {
    vi.useFakeTimers();
    const pending: Array<(response: OtpResponse) => void> = [];
    const { platform, sendOtpMessage } = createPlatform((request) =>
      request.kind === "otp.list"
        ? new Promise((resolve) => pending.push(resolve))
        : Promise.resolve({ version: 1, kind: "otp.editorResult", item: editor }),
    );
    render(<OtpVaultView platform={platform} active />);
    pending.shift()?.({ version: 1, kind: "otp.listResult", items: [item] });
    await act(async () => Promise.resolve());

    fireEvent.change(screen.getByRole("searchbox", { name: "Search OTP items" }), {
      target: { value: "  Ｎorth  " },
    });
    await act(async () => vi.advanceTimersByTimeAsync(150));
    expect(sendOtpMessage).toHaveBeenLastCalledWith({
      version: 1,
      kind: "otp.list",
      query: "Ｎorth",
    });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search OTP items" }), {
      target: { value: "missing" },
    });
    await act(async () => vi.advanceTimersByTimeAsync(150));
    pending.shift()?.({ version: 1, kind: "otp.listResult", items: [item] });
    pending.shift()?.({ version: 1, kind: "otp.listResult", items: [] });
    await act(async () => Promise.resolve());
    expect(screen.getByText("No matching OTP items")).toBeVisible();
  });

  it("loads an editor only for selection, conceals its secret, and supports keyboard selection", async () => {
    const { platform, sendOtpMessage } = createPlatform((request) => {
      if (request.kind === "otp.list")
        return Promise.resolve({
          version: 1,
          kind: "otp.listResult",
          items: [item, { ...item, id: secondId, issuer: "Field Unit", label: "Backup" }],
        });
      if (request.kind === "otp.getEditor")
        return Promise.resolve({
          version: 1,
          kind: "otp.editorResult",
          item: {
            ...editor,
            id: request.itemId,
            label: request.itemId === secondId ? "Backup" : editor.label,
          },
        });
      throw new Error("unexpected request");
    });
    const { container } = render(<OtpVaultView platform={platform} active />);
    expect(await screen.findByText("North Lab")).toBeVisible();
    expect(sendOtpMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "otp.getEditor" }),
    );

    const first = screen.getByRole("option", { name: /North Lab.*Operator/i });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    await waitFor(() => expect(screen.getByLabelText("Label")).toHaveValue("Backup"));
    expect(screen.queryByLabelText("Secret")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain(deterministicSecret);
    for (const input of container.querySelectorAll("input")) {
      expect(input.value).not.toContain(deterministicSecret);
      for (const attribute of input.getAttributeNames())
        expect(input.getAttribute(attribute)).not.toContain(deterministicSecret);
    }
    const reveal = screen.getByRole("button", { name: "Reveal secret" });
    expect(reveal).not.toHaveAccessibleName(expect.stringContaining(deterministicSecret));
    fireEvent.click(reveal);
    const secret = await screen.findByLabelText("Secret");
    expect(secret).toHaveAttribute("type", "text");
    expect(secret).toHaveAttribute("autocomplete", "off");
    expect(secret).toHaveAttribute("name", "otp-secret-base32");
    expect(secret).toHaveAttribute("spellcheck", "false");
    expect(secret).toHaveAttribute("autocapitalize", "none");
    fireEvent.change(secret, { target: { value: "jbsw y3dp-ehpk3pxp" } });
    fireEvent.click(screen.getByRole("button", { name: "Conceal secret" }));
    expect(secret).toHaveValue("");
    expect(screen.queryByLabelText("Secret")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain(deterministicSecret);
    for (const input of container.querySelectorAll("input"))
      expect(input.value).not.toContain(deterministicSecret);

    fireEvent.click(screen.getByRole("button", { name: "Reveal secret" }));
    const revealedAgain = screen.getByLabelText("Secret");
    expect(revealedAgain).toHaveValue(deterministicSecret);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(revealedAgain).toHaveValue("");
    expect(screen.queryByLabelText("Secret")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain(deterministicSecret);
    await expectNoSeriousAxeViolations(container);
  });

  it("windows a capacity-sized index and navigates across virtual boundaries", async () => {
    const items = Array.from({ length: 10_000 }, (_, index) => ({
      ...item,
      id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      issuer: `Issuer ${index}`,
      label: `Account ${index}`,
    }));
    const { platform } = createPlatform((request) => {
      if (request.kind === "otp.list")
        return Promise.resolve({ version: 1, kind: "otp.listResult", items });
      if (request.kind === "otp.getEditor") {
        const index = Number(request.itemId.slice(-12));
        return Promise.resolve({
          version: 1,
          kind: "otp.editorResult",
          item: {
            ...editor,
            id: request.itemId,
            issuer: `Issuer ${index}`,
            label: `Account ${index}`,
          },
        });
      }
      throw new Error("unexpected request");
    });
    render(<OtpVaultView platform={platform} active />);
    expect(await screen.findByText("10,000 ITEMS")).toBeVisible();
    expect(screen.getAllByRole("option").length).toBeLessThanOrEqual(50);

    const listbox = screen.getByRole("listbox", { name: "OTP items" });
    expect(listbox).toHaveAttribute("tabindex", "0");
    listbox.focus();
    expect(listbox).toHaveFocus();
    const first = screen.getByRole("option", { name: /Issuer 0.*Account 0/i });
    expect(listbox).toHaveAttribute("aria-activedescendant", first.id);

    fireEvent.scroll(listbox, { target: { scrollTop: 54 * 500 } });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Issuer 495.*Account 495/i })).toBeVisible(),
    );
    const activeAfterScroll = listbox.getAttribute("aria-activedescendant");
    expect(activeAfterScroll).toBeTruthy();
    expect(document.getElementById(activeAfterScroll ?? "missing")).toHaveAttribute(
      "role",
      "option",
    );
    expect(listbox).toHaveFocus();
    expect(screen.getAllByRole("option").length).toBeLessThanOrEqual(46);

    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(listbox).toHaveFocus();
    const activeAfterArrow = listbox.getAttribute("aria-activedescendant");
    expect(document.getElementById(activeAfterArrow ?? "missing")).toHaveAttribute(
      "role",
      "option",
    );
    fireEvent.keyDown(listbox, { key: "End" });
    const last = await screen.findByRole("option", { name: /Issuer 9999.*Account 9999/i });
    await waitFor(() => expect(listbox).toHaveAttribute("aria-activedescendant", last.id));
    expect(listbox).toHaveFocus();
    expect(screen.getAllByRole("option").length).toBeLessThanOrEqual(46);
    fireEvent.keyDown(listbox, { key: "Home" });
    await waitFor(() => expect(listbox).toHaveAttribute("aria-activedescendant", first.id));
    expect(listbox).toHaveFocus();
  });

  it("keeps aria-activedescendant mounted in every query and collection transition commit", async () => {
    vi.useFakeTimers();
    const largeItems = Array.from({ length: 10_000 }, (_, index) => ({
      ...item,
      id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      issuer: `Issuer ${index}`,
      label: `Account ${index}`,
    }));
    const filteredItem = { ...item, id: secondId, issuer: "Filtered", label: "Only result" };
    const invalidCommits: string[] = [];
    const { platform } = createPlatform((request) => {
      if (request.kind === "otp.list")
        return Promise.resolve({
          version: 1,
          kind: "otp.listResult",
          items: request.query === "filtered" ? [filteredItem] : largeItems,
        });
      if (request.kind === "otp.getEditor") {
        const selected = request.itemId === secondId ? filteredItem : largeItems.at(-1)!;
        return Promise.resolve({
          version: 1,
          kind: "otp.editorResult",
          item: { ...editor, ...selected },
        });
      }
      throw new Error("unexpected request");
    });
    render(
      <Profiler
        id="active-descendant"
        onRender={() => {
          const listbox = document.querySelector<HTMLElement>('[role="listbox"]');
          const activeId = listbox?.getAttribute("aria-activedescendant");
          if (activeId && document.getElementById(activeId) === null) invalidCommits.push(activeId);
        }}
      >
        <OtpVaultView platform={platform} active />
      </Profiler>,
    );
    await act(async () => vi.runOnlyPendingTimersAsync());
    const listbox = screen.getByRole("listbox", { name: "OTP items" });
    listbox.focus();
    fireEvent.keyDown(listbox, { key: "End" });
    expect(screen.getByRole("option", { name: /Issuer 9999.*Account 9999/i })).toBeVisible();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search OTP items" }), {
      target: { value: "filtered" },
    });
    await act(async () => vi.advanceTimersByTimeAsync(150));
    expect(screen.getByRole("option", { name: /Filtered.*Only result/i })).toBeVisible();
    expect(invalidCommits).toEqual([]);
    const activeId = listbox.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    expect(document.getElementById(activeId ?? "missing")).toHaveAttribute("role", "option");
    fireEvent.keyDown(listbox, { key: "Home" });
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(
      document.getElementById(listbox.getAttribute("aria-activedescendant") ?? "missing"),
    ).toHaveAttribute("role", "option");
  });

  it("creates complete TOTP/HOTP/Steam inputs and enforces type invariants", async () => {
    const { platform, sendOtpMessage } = createPlatform();
    render(<OtpVaultView platform={platform} active />);
    await screen.findByText("North Lab");
    fireEvent.click(screen.getByRole("button", { name: "Create OTP" }));
    fillCreateForm();

    fireEvent.change(screen.getByLabelText("OTP type"), { target: { value: "hotp" } });
    expect(screen.queryByLabelText("Period (seconds)")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Counter")).toHaveValue(0);
    fireEvent.change(screen.getByLabelText("Counter"), { target: { value: "9" } });

    fireEvent.change(screen.getByLabelText("OTP type"), { target: { value: "steam" } });
    expect(screen.getByLabelText("Algorithm")).toHaveValue("SHA1");
    expect(screen.getByLabelText("Digits")).toHaveValue(5);
    expect(screen.getByLabelText("Period (seconds)")).toHaveValue(30);
    expect(screen.queryByLabelText("Counter")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("OTP type"), { target: { value: "totp" } });
    fireEvent.click(screen.getByRole("button", { name: "Save OTP" }));
    await waitFor(() =>
      expect(sendOtpMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "otp.create" })),
    );
    expect(sendOtpMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "otp.reserveHotp" }),
    );
  });

  it("validates before sending and normalizes permitted Base32 separators", async () => {
    const { platform, sendOtpMessage } = createPlatform();
    render(<OtpVaultView platform={platform} active />);
    await screen.findByText("North Lab");
    fireEvent.click(screen.getByRole("button", { name: "Create OTP" }));
    fillCreateForm();
    fireEvent.change(screen.getByLabelText("Secret"), { target: { value: "jbsw y3dp-ehpk3pxp" } });
    expect(screen.getByLabelText("Secret")).toHaveValue(deterministicSecret);
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Save OTP" }));
    expect(
      (await screen.findAllByRole("alert")).some((alert) =>
        alert.textContent?.includes("Enter a label"),
      ),
    ).toBe(true);
    expect(sendOtpMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "otp.create" }),
    );
  });

  it("does not let a deferred item A conflict reselect or overwrite item B", async () => {
    let rejectFirstUpdate: ((reason: unknown) => void) | undefined;
    const { platform } = createPlatform((request) => {
      if (request.kind === "otp.list")
        return Promise.resolve({
          version: 1,
          kind: "otp.listResult",
          items: [item, { ...item, id: secondId, issuer: "Field Unit", label: "Backup" }],
        });
      if (request.kind === "otp.getEditor")
        return Promise.resolve({
          version: 1,
          kind: "otp.editorResult",
          item: {
            ...editor,
            id: request.itemId,
            issuer: request.itemId === secondId ? "Field Unit" : editor.issuer,
            label: request.itemId === secondId ? "Backup" : editor.label,
          },
        });
      if (request.kind === "otp.update")
        return new Promise((_resolve, reject) => {
          rejectFirstUpdate = reject;
        });
      throw new Error("unexpected request");
    });
    render(<OtpVaultView platform={platform} active />);
    await openEditor();
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Attempt for A" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    fireEvent.click(screen.getByRole("option", { name: /Field Unit.*Backup/i }));
    await waitFor(() => expect(screen.getByLabelText("Label")).toHaveValue("Backup"));
    await act(async () => {
      rejectFirstUpdate?.(Object.assign(new Error("safe"), { code: "OTP_CONFLICT" }));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByLabelText("Label")).toHaveValue("Backup"));
    expect(screen.getByRole("option", { name: /Field Unit.*Backup/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByText(/Your attempted values are retained/i)).not.toBeInTheDocument();
  });

  it("retains attempted values, refreshes the exact editor on conflict, and requires another save", async () => {
    let updates = 0;
    const { platform, sendOtpMessage } = createPlatform((request) => {
      if (request.kind === "otp.list")
        return Promise.resolve({ version: 1, kind: "otp.listResult", items: [item] });
      if (request.kind === "otp.getEditor")
        return Promise.resolve({
          version: 1,
          kind: "otp.editorResult",
          item: { ...editor, revision: 4 },
        });
      if (request.kind === "otp.update") {
        updates += 1;
        if (updates === 1) throw Object.assign(new Error("safe"), { code: "OTP_CONFLICT" });
        return Promise.resolve({
          version: 1,
          kind: "otp.mutationResult",
          item: { ...item, revision: 5 },
        });
      }
      throw new Error("unexpected request");
    });
    render(<OtpVaultView platform={platform} active />);
    await openEditor();
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "My unsaved label" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This item changed");
    expect(screen.getByLabelText("Label")).toHaveValue("My unsaved label");
    expect(updates).toBe(1);
    expect(sendOtpMessage).toHaveBeenCalledWith({ version: 1, kind: "otp.getEditor", itemId });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updates).toBe(2));
    expect(sendOtpMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "otp.update", expectedRevision: 4 }),
    );
  });

  it("reconciles a stale successful A delete without disturbing B editor or dialog", async () => {
    let resolveDelete: ((value: OtpResponse) => void) | undefined;
    let deleted = false;
    const secondItem = { ...item, id: secondId, issuer: "Field Unit", label: "Backup" };
    const { platform } = createPlatform((request) => {
      if (request.kind === "otp.list")
        return Promise.resolve({
          version: 1,
          kind: "otp.listResult",
          items: deleted ? [secondItem] : [item, secondItem],
        });
      if (request.kind === "otp.getEditor")
        return Promise.resolve({
          version: 1,
          kind: "otp.editorResult",
          item: {
            ...editor,
            id: request.itemId,
            issuer: request.itemId === secondId ? "Field Unit" : editor.issuer,
            label: request.itemId === secondId ? "Backup" : editor.label,
          },
        });
      if (request.kind === "otp.delete")
        return new Promise((resolve) => {
          resolveDelete = (response) => {
            deleted = true;
            resolve(response);
          };
        });
      throw new Error("unexpected request");
    });
    render(<OtpVaultView platform={platform} active />);
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Delete OTP" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    fireEvent.click(screen.getByRole("option", { name: /Field Unit.*Backup/i }));
    await waitFor(() => expect(screen.getByLabelText("Label")).toHaveValue("Backup"));
    fireEvent.click(screen.getByRole("button", { name: "Delete OTP" }));
    const bDialog = screen.getByRole("dialog", { name: "Delete OTP item" });
    expect(within(bDialog).getByText(/Field Unit.*Backup/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm delete" })).not.toBeDisabled();

    await act(async () => {
      resolveDelete?.({ version: 1, kind: "otp.deleteResult", itemId, revision: 4 });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: /North Lab.*Operator/i }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Label")).toHaveValue("Backup");
    expect(screen.getByRole("option", { name: /Field Unit.*Backup/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("dialog", { name: "Delete OTP item" })).toBe(bDialog);
    expect(within(bDialog).getByText(/Field Unit.*Backup/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm delete" })).not.toBeDisabled();
  });

  it("reconciles stale A delete against the latest query without superseding newer results", async () => {
    vi.useFakeTimers();
    let resolveDelete: ((value: OtpResponse) => void) | undefined;
    let resolveLatestList: ((value: OtpResponse) => void) | undefined;
    const secondItem = { ...item, id: secondId, issuer: "Field Unit", label: "Backup" };
    const listQueries: string[] = [];
    const { platform } = createPlatform((request) => {
      if (request.kind === "otp.list") {
        listQueries.push(request.query);
        if (request.query === "field")
          return new Promise((resolve) => {
            resolveLatestList = resolve;
          });
        return Promise.resolve({ version: 1, kind: "otp.listResult", items: [item, secondItem] });
      }
      if (request.kind === "otp.getEditor")
        return Promise.resolve({
          version: 1,
          kind: "otp.editorResult",
          item: {
            ...editor,
            id: request.itemId,
            issuer: request.itemId === secondId ? "Field Unit" : editor.issuer,
            label: request.itemId === secondId ? "Backup" : editor.label,
          },
        });
      if (request.kind === "otp.delete")
        return new Promise((resolve) => {
          resolveDelete = resolve;
        });
      throw new Error("unexpected request");
    });
    render(<OtpVaultView platform={platform} active />);
    await act(async () => vi.runOnlyPendingTimersAsync());
    fireEvent.click(screen.getByRole("option", { name: /North Lab.*Operator/i }));
    await act(async () => Promise.resolve());
    expect(screen.getByRole("heading", { name: "Edit OTP" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Delete OTP" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    fireEvent.click(screen.getByRole("option", { name: /Field Unit.*Backup/i }));
    await act(async () => Promise.resolve());
    expect(screen.getByLabelText("Label")).toHaveValue("Backup");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search OTP items" }), {
      target: { value: "field" },
    });
    await act(async () => vi.advanceTimersByTimeAsync(150));

    await act(async () => {
      resolveDelete?.({ version: 1, kind: "otp.deleteResult", itemId, revision: 4 });
      await Promise.resolve();
    });
    expect(listQueries.at(-1)).toBe("field");
    expect(screen.getByLabelText("Label")).toHaveValue("Backup");

    await act(async () => {
      resolveLatestList?.({ version: 1, kind: "otp.listResult", items: [secondItem] });
      await Promise.resolve();
    });
    expect(screen.getByRole("searchbox", { name: "Search OTP items" })).toHaveValue("field");
    expect(screen.getByRole("option", { name: /Field Unit.*Backup/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("option", { name: /North Lab.*Operator/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Label")).toHaveValue("Backup");
    expect(listQueries.filter((query) => query === "field")).toHaveLength(1);
  });

  it("ignores a stale A delete error without altering B", async () => {
    let rejectDelete: ((reason: unknown) => void) | undefined;
    const secondItem = { ...item, id: secondId, issuer: "Field Unit", label: "Backup" };
    const { platform } = createPlatform((request) => {
      if (request.kind === "otp.list")
        return Promise.resolve({ version: 1, kind: "otp.listResult", items: [item, secondItem] });
      if (request.kind === "otp.getEditor")
        return Promise.resolve({
          version: 1,
          kind: "otp.editorResult",
          item: {
            ...editor,
            id: request.itemId,
            issuer: request.itemId === secondId ? "Field Unit" : editor.issuer,
            label: request.itemId === secondId ? "Backup" : editor.label,
          },
        });
      if (request.kind === "otp.delete")
        return new Promise((_resolve, reject) => {
          rejectDelete = reject;
        });
      throw new Error("unexpected request");
    });
    render(<OtpVaultView platform={platform} active />);
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Delete OTP" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    fireEvent.click(screen.getByRole("option", { name: /Field Unit.*Backup/i }));
    await waitFor(() => expect(screen.getByLabelText("Label")).toHaveValue("Backup"));
    fireEvent.click(screen.getByRole("button", { name: "Delete OTP" }));
    const bDialog = screen.getByRole("dialog", { name: "Delete OTP item" });

    await act(async () => {
      rejectDelete?.(new Error("safe delete failure"));
      await Promise.resolve();
    });

    expect(screen.getByLabelText("Label")).toHaveValue("Backup");
    expect(screen.getByRole("dialog", { name: "Delete OTP item" })).toBe(bDialog);
    expect(within(bDialog).getByText(/Field Unit.*Backup/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm delete" })).not.toBeDisabled();
  });

  it("uses a revision-bound accessible delete dialog with cancel, focus return, and bounded submit", async () => {
    let resolveDelete: ((value: OtpResponse) => void) | undefined;
    const { platform, sendOtpMessage } = createPlatform((request) => {
      if (request.kind === "otp.list")
        return Promise.resolve({ version: 1, kind: "otp.listResult", items: [item] });
      if (request.kind === "otp.getEditor")
        return Promise.resolve({ version: 1, kind: "otp.editorResult", item: editor });
      if (request.kind === "otp.delete") return new Promise((resolve) => (resolveDelete = resolve));
      throw new Error("unexpected request");
    });
    render(<OtpVaultView platform={platform} active />);
    await openEditor();
    const opener = screen.getByRole("button", { name: "Delete OTP" });
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Delete OTP item" });
    expect(within(dialog).getByText(/North Lab.*Operator/)).toBeVisible();
    expect(dialog.textContent).not.toContain(deterministicSecret);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    const confirm = screen.getByRole("button", { name: "Confirm delete" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(sendOtpMessage).toHaveBeenCalledTimes(
        sendOtpMessage.mock.calls.filter(([request]) => request.kind === "otp.delete").length + 2,
      ),
    ).catch(() => undefined);
    expect(
      sendOtpMessage.mock.calls.filter(([request]) => request.kind === "otp.delete"),
    ).toHaveLength(1);
    expect(sendOtpMessage).toHaveBeenCalledWith({
      version: 1,
      kind: "otp.delete",
      itemId,
      expectedRevision: 3,
    });
    resolveDelete?.({ version: 1, kind: "otp.deleteResult", itemId, revision: 4 });
  });

  it.each(["create", "conflict"] as const)(
    "atomically redacts a revealed %s secret in the first list-error commit",
    async (scenario) => {
      let listCalls = 0;
      let rejectList: ((reason: unknown) => void) | undefined;
      const commits: string[] = [];
      const { platform } = createPlatform((request) => {
        if (request.kind === "otp.list") {
          listCalls += 1;
          if (listCalls === 1 || (scenario === "conflict" && listCalls === 2))
            return Promise.resolve({ version: 1, kind: "otp.listResult", items: [item] });
          return new Promise((_resolve, reject) => {
            rejectList = reject;
          });
        }
        if (request.kind === "otp.getEditor")
          return Promise.resolve({ version: 1, kind: "otp.editorResult", item: editor });
        if (request.kind === "otp.update")
          return Promise.reject(Object.assign(new Error("safe"), { code: "OTP_CONFLICT" }));
        throw new Error("unexpected request");
      });
      const { container, rerender } = render(
        <Profiler id="otp" onRender={() => commits.push(document.body.innerHTML)}>
          <OtpVaultView platform={platform} active />
        </Profiler>,
      );
      await screen.findByText("North Lab");
      if (scenario === "create") {
        fireEvent.click(screen.getByRole("button", { name: "Create OTP" }));
        fillCreateForm({ label: "Create private label" });
      } else {
        await openEditor();
        fireEvent.change(screen.getByLabelText("Label"), {
          target: { value: "Conflict private label" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
        await screen.findByText(/Your attempted values are retained/i);
        fireEvent.click(screen.getByRole("button", { name: "Reveal secret" }));
      }
      const privateLabel =
        scenario === "create" ? "Create private label" : "Conflict private label";
      expect(screen.getByLabelText("Secret")).toHaveValue(deterministicSecret);
      rerender(
        <Profiler id="otp" onRender={() => commits.push(container.innerHTML)}>
          <OtpVaultView platform={platform} active refreshToken={1} />
        </Profiler>,
      );
      const beforeFailure = commits.length;

      await act(async () => {
        rejectList?.(new Error("safe list failure"));
        await Promise.resolve();
      });

      const errorCommits = commits
        .slice(beforeFailure)
        .filter((html) => html.includes("OTP items unavailable"));
      expect(errorCommits.length).toBeGreaterThan(0);
      expect(errorCommits[0]).not.toContain(deterministicSecret);
      expect(errorCommits[0]).not.toContain(privateLabel);
      expect(errorCommits[0]).not.toContain('role="dialog"');
      expect(screen.queryByLabelText("Secret")).not.toBeInTheDocument();
      expect(container.textContent).not.toContain(privateLabel);
    },
  );

  it("redacts all sensitive UI before publishing a list failure state", async () => {
    let listCalls = 0;
    const { platform } = createPlatform((request) => {
      if (request.kind === "otp.list") {
        listCalls += 1;
        if (listCalls === 1)
          return Promise.resolve({ version: 1, kind: "otp.listResult", items: [item] });
        return Promise.reject(new Error("safe list failure"));
      }
      if (request.kind === "otp.getEditor")
        return Promise.resolve({ version: 1, kind: "otp.editorResult", item: editor });
      throw new Error("unexpected request");
    });
    const { container, rerender } = render(<OtpVaultView platform={platform} active />);
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Reveal secret" }));
    expect(screen.getByLabelText("Secret")).toHaveValue(deterministicSecret);
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "Attempted private label" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete OTP" }));

    rerender(<OtpVaultView platform={platform} active refreshToken={1} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("OTP items unavailable");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Edit OTP" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Loading selected editor/i)).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("North Lab");
    expect(container.textContent).not.toContain("Attempted private label");
    expect(container.innerHTML).not.toContain(deterministicSecret);
    for (const input of container.querySelectorAll("input"))
      expect(input.value).not.toContain(deterministicSecret);
  });

  it("synchronously redacts list, editor, secret, dialog, and stale async results on lock", async () => {
    const { platform } = createPlatform();
    const { rerender } = render(<OtpVaultView platform={platform} active />);
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Delete OTP" }));
    rerender(<OtpVaultView platform={platform} active={false} />);
    expect(screen.queryByRole("heading", { name: "One-time passwords" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("North Lab");
    expect(document.body.textContent).not.toContain(deterministicSecret);
  });
});
