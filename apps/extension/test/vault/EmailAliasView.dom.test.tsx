// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmailAliasView } from "../../src/vault/tools/EmailAliasView";

afterEach(cleanup);

describe("EmailAliasView", () => {
  it("asks for a token when nothing is connected, then mints addresses once it is", async () => {
    let connected = false;
    const sendMessage = vi.fn((request: { kind: string; token?: string }) => {
      switch (request.kind) {
        case "alias.getStatus":
          return Promise.resolve({ version: 1, kind: "alias.status", duckduckgo: connected });
        case "alias.setDuckToken":
          connected = true;
          return Promise.resolve({ version: 1, kind: "alias.status", duckduckgo: true });
        case "alias.generateDuck":
          return Promise.resolve({
            version: 1,
            kind: "alias.generated",
            provider: "duckduckgo",
            address: "quiet_falcon42@duck.com",
          });
        default:
          return Promise.resolve({ version: 1, kind: "alias.status", duckduckgo: false });
      }
    });
    render(<EmailAliasView platform={{ sendMessage }} active />);
    const token = await screen.findByLabelText("Token");
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Paste the token first.");
    fireEvent.change(token, { target: { value: "tok3n" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText(/Connected to DuckDuckGo/u);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "alias.setDuckToken", token: "tok3n" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "New @duck.com address" }));
    expect(await screen.findByText("quiet_falcon42@duck.com")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(screen.getByLabelText("Token")).toBeVisible());
  });

  it("shows the background's reason when DuckDuckGo refuses", async () => {
    const sendMessage = vi.fn((request: { kind: string }) =>
      Promise.resolve(
        request.kind === "alias.getStatus"
          ? { version: 1, kind: "alias.status", duckduckgo: true }
          : {
              version: 1,
              kind: "error",
              error: { code: "ALIAS_REJECTED", message: "DuckDuckGo did not accept the token." },
            },
      ),
    );
    render(<EmailAliasView platform={{ sendMessage }} active />);
    fireEvent.click(await screen.findByRole("button", { name: "New @duck.com address" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("did not accept the token");
  });
});
