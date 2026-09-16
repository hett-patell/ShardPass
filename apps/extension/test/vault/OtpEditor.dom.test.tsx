import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

import { OtpEditor } from "../../src/vault/otp/OtpEditor";

const value = {
  issuer: "",
  label: "",
  secret: "",
  otpType: "totp" as const,
  algorithm: "SHA1" as const,
  digits: 6,
  period: 30,
  note: "",
  favorite: false,
  tags: [] as string[],
};

describe("OtpEditor", () => {
  it("offers the secret field straight away when a code is being created", () => {
    render(
      <OtpEditor
        mode="create"
        value={value}
        submitting={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // There is nothing to conceal on a code that does not exist yet, and hiding the field
    // left no way to type the secret at all.
    expect(screen.getByLabelText(/Secret/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /Conceal secret/i })).toBeVisible();
  });

  it("keeps an existing code's secret concealed until asked", () => {
    render(
      <OtpEditor
        mode="edit"
        revision={1}
        value={{ ...value, issuer: "Example", label: "me", secret: "JBSWY3DPEHPK3PXP" }}
        submitting={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/^Secret$/i)).toBeNull();
    expect(screen.getByRole("button", { name: /Reveal secret/i })).toBeVisible();
  });
});
