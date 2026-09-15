// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BreachCheckSettings } from "../../src/vault/settings/BreachCheckSettings";

afterEach(cleanup);

describe("BreachCheckSettings", () => {
  it("shows the stored preference, explains what is sent, and saves a change", async () => {
    let enabled = false;
    const sendMessage = vi.fn((request: { kind: string; enabled?: boolean }) => {
      if (request.kind === "security.setBreachChecks") enabled = request.enabled === true;
      return Promise.resolve({ version: 1, kind: "security.settings", breachChecks: enabled });
    });
    render(<BreachCheckSettings platform={{ sendMessage }} active />);
    const box = await screen.findByRole("checkbox", { name: "Allow breach checks" });
    await waitFor(() => expect(box).toBeEnabled());
    expect(box).not.toBeChecked();
    expect(screen.getByText(/first five characters/u)).toBeVisible();
    fireEvent.click(box);
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        version: 1,
        kind: "security.setBreachChecks",
        enabled: true,
      }),
    );
    expect(box).toBeChecked();
  });
});
