import "@testing-library/jest-dom/vitest";

import { PasswordInput } from "@shardpass/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

describe("PasswordInput", () => {
  it("hides the value until the eye is pressed, and hides it again", () => {
    render(<PasswordInput aria-label="Master password" defaultValue="hunter2" />);
    const input = screen.getByLabelText("Master password");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByTitle("Show password"));
    expect(input).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByTitle("Hide password"));
    expect(input).toHaveAttribute("type", "password");
    // The eye is sighted-only, so the wrapping label's name stays clean for assistive tech.
    expect(screen.queryByRole("button", { name: /password/ })).toBeNull();
  });

  it("says when Caps Lock is on while typing", () => {
    render(<PasswordInput aria-label="Master password" />);
    const input = screen.getByLabelText("Master password");
    fireEvent.keyDown(input, { key: "A", modifierCapsLock: true });
    expect(screen.getByRole("status")).toHaveTextContent("Caps Lock is on");
    fireEvent.keyUp(input, { key: "CapsLock", modifierCapsLock: false });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
