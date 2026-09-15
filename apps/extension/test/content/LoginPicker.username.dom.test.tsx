// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoginPicker } from "../../src/content/login/LoginPicker";

afterEach(cleanup);

describe("LoginPicker username suggestion", () => {
  it("offers the suggested username above the rows, with a way to ask for another", () => {
    const onUse = vi.fn();
    const onAnother = vi.fn();
    render(
      <LoginPicker
        suggestions={[]}
        state="empty"
        suggestedUsername={{ username: "me+example1234@example.com", onUse, onAnother }}
        onClose={() => undefined}
        onSelect={() => undefined}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Use suggested username me+example1234@example.com" }),
    );
    expect(onUse).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Suggest a different username" }));
    expect(onAnother).toHaveBeenCalledTimes(1);
    // With a suggestion to show, an empty vault is not an error worth a status line.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
