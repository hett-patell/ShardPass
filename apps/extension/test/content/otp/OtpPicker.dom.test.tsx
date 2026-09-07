import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OtpPicker, type OtpPickerSuggestion } from "../../../src/content/otp/OtpPicker";

const suggestions: readonly OtpPickerSuggestion[] = [
  {
    itemId: "item-b",
    expectedRevision: 2,
    issuer: "Work",
    label: "Secondary",
    otpType: "totp",
    favorite: false,
    tags: ["team"],
  },
  {
    itemId: "item-a",
    expectedRevision: 1,
    issuer: "Personal",
    label: "Primary",
    otpType: "steam",
    favorite: true,
    tags: ["games"],
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("metadata-only OTP picker shell", () => {
  it("renders safe metadata favorite-first with no code-bearing controls or values", () => {
    const { container } = render(
      <OtpPicker suggestions={suggestions} state="ready" onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    const rows = screen.getAllByRole("button", { name: /Use OTP account/ });
    expect(rows[0]).toHaveTextContent("Personal");
    expect(rows[1]).toHaveTextContent("Work");
    expect(container.textContent).not.toMatch(/synthetic-value|seed|counter|algorithm|release/i);
    expect(
      container.querySelector("[data-code], [aria-label*='released' i], [aria-label*='secret' i]"),
    ).toBeNull();
  });

  it("has no search box of its own, so the page's field keeps focus", () => {
    render(
      <OtpPicker suggestions={suggestions} state="ready" onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Close ShardPass picker" })).toBeInTheDocument();
  });

  it("supports keyboard selection and Escape close", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <OtpPicker suggestions={suggestions} state="ready" onClose={onClose} onSelect={onSelect} />,
    );
    fireEvent.keyDown(screen.getByRole("region", { name: "ShardPass OTP picker" }), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole("button", { name: /Use OTP account/ })[0]!);
    expect(onSelect).toHaveBeenCalledWith(suggestions[1]);
  });

  it.each([
    ["busy", "Loading accounts"],
    ["empty", "No OTP accounts available"],
    ["error", "OTP accounts are unavailable"],
  ] as const)("renders the fixed %s state", (state, message) => {
    render(<OtpPicker suggestions={[]} state={state} onClose={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(message);
  });

  it("does not render caller-provided errors or accessibility descriptions", () => {
    const { container } = render(
      <OtpPicker suggestions={[]} state="error" onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    expect(container.innerHTML).not.toContain("aria-description");
    expect(container.innerHTML).not.toContain("title=");
  });
});
