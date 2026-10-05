// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { siteOf, UsernameField } from "../../src/vault/components/forms/UsernameField";

afterEach(cleanup);

function background(options: { duck: boolean; email?: string }) {
  return vi.fn((payload: unknown): Promise<unknown> => {
    const request = payload as { kind?: string; usernameKind?: string; site?: string };
    switch (request.kind) {
      case "alias.getStatus":
        return Promise.resolve({ version: 1, kind: "alias.status", duckduckgo: options.duck });
      case "password.getGeneratorSettings":
        return Promise.resolve({
          version: 1,
          kind: "password.generatorSettings",
          email: options.email ?? "",
          domain: "",
        });
      case "password.generateUsername":
        return Promise.resolve({
          version: 1,
          kind: "password.generateUsernameResult",
          username:
            request.usernameKind === "plus"
              ? `me+${request.site ?? "x"}@mail.test`
              : "amber-fox-42",
          entropyBits: 30,
        });
      case "alias.generateDuck":
        return Promise.resolve({
          version: 1,
          kind: "alias.generated",
          provider: "duckduckgo",
          address: "quiet-otter-91@duck.com",
        });
      default:
        return Promise.resolve(undefined);
    }
  });
}

function Harness({
  sendMessage,
  site,
}: {
  sendMessage: (payload: unknown) => Promise<unknown>;
  site?: string;
}) {
  const [value, setValue] = useState("");
  return (
    <UsernameField
      value={value}
      maxLength={256}
      onChange={setValue}
      site={site}
      platform={{ sendMessage }}
    />
  );
}

describe("UsernameField", () => {
  it("suggests a username in the style the person set up, made for the login's site", async () => {
    const sendMessage = background({ duck: false, email: "me@mail.test" });
    render(<Harness sendMessage={sendMessage} site="shop.example.test" />);
    fireEvent.click(screen.getByRole("button", { name: "Suggest a username" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Username")).toHaveValue("me+shop.example.test@mail.test"),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ usernameKind: "plus", site: "shop.example.test" }),
    );
    // Without DuckDuckGo connected there is no alias button.
    expect(screen.queryByRole("button", { name: "Use a new @duck.com address" })).toBeNull();
  });

  it("offers a new @duck.com address once DuckDuckGo is connected", async () => {
    const sendMessage = background({ duck: true });
    render(<Harness sendMessage={sendMessage} />);
    fireEvent.click(await screen.findByRole("button", { name: "Use a new @duck.com address" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Username")).toHaveValue("quiet-otter-91@duck.com"),
    );
  });

  it("reads the site from a website typed with or without its scheme", () => {
    expect(siteOf("https://accounts.example.test/login")).toBe("accounts.example.test");
    expect(siteOf("example.test")).toBe("example.test");
    expect(siteOf("")).toBeUndefined();
    expect(siteOf(undefined)).toBeUndefined();
  });
});
