import "@testing-library/jest-dom/vitest";

import type { EnteSafeState } from "@shardpass/messaging";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EnteUiPlatform } from "../../src/platform/extension-platform";
import { EnteSettings } from "../../src/vault/ente/EnteSettings";

const disconnected: EnteSafeState = {
  version: 1,
  kind: "ente.state",
  state: "disconnected",
  connected: false,
  pendingCount: 0,
  conflictCount: 0,
  lastSuccessAt: null,
};

function platform(...responses: unknown[]): EnteUiPlatform & {
  enteCalls: unknown[];
} {
  const enteCalls: unknown[] = [];
  const sendEnteMessage = vi.fn((request: unknown) => {
    enteCalls.push(request);
    return Promise.resolve(responses.shift() as EnteSafeState);
  });
  return {
    extensionId: "vault-test-id",
    onMessage: () => () => undefined,
    openVaultPage: () => Promise.resolve(),
    sendMessage: vi.fn(() => Promise.resolve(responses.shift())),
    sendEnteMessage,
    enteCalls,
  };
}

afterEach(cleanup);

describe("EnteSettings", () => {
  it("explains fixed OTP-only authority and cadence without a server control", async () => {
    const candidate = platform(disconnected);
    const { container } = render(<EnteSettings platform={candidate} active />);

    expect(await screen.findByRole("heading", { name: "Ente Authenticator sync" })).toBeVisible();
    expect(screen.getByText(/only TOTP, HOTP, and Steam records/i)).toBeVisible();
    expect(screen.getByText(/api\.ente\.io/i)).toBeVisible();
    expect(screen.getByText(/every 15 minutes/i)).toBeVisible();
    expect(screen.queryByLabelText(/server|host|origin/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Ente" })).toBeVisible();
    expect(container).not.toHaveTextContent(
      /otpauth:\/\/|ciphertext|remote id|auth key|api token/i,
    );
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(
      results.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
    ).toEqual([]);
  });

  it("clears sensitive controls synchronously on transfer and cancel", async () => {
    const candidate = platform(disconnected, {
      ...disconnected,
      state: "connecting",
      connected: true,
    });
    render(<EnteSettings platform={candidate} active />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect Ente" }));
    const email = screen.getByLabelText<HTMLInputElement>("Ente email");
    const password = screen.getByLabelText<HTMLInputElement>("Ente password");
    fireEvent.change(email, { target: { value: "sensitive@example.test" } });
    fireEvent.change(password, { target: { value: "password-canary" } });
    fireEvent.submit(screen.getByRole("form", { name: "Connect Ente" }));
    expect(email.value).toBe("");
    expect(password.value).toBe("");
    expect(candidate.enteCalls).toHaveLength(1);
    expect(JSON.stringify(candidate.enteCalls)).not.toContain("password-canary");
  });

  it("requires an explicit conflict choice and states each consequence", async () => {
    const conflict: EnteSafeState = {
      ...disconnected,
      state: "conflict",
      connected: true,
      conflictCount: 1,
      conflicts: [{ capability: "c".repeat(32), canKeepBoth: true }],
    };
    render(<EnteSettings platform={platform(conflict)} active />);
    expect(await screen.findByRole("heading", { name: "Conflicts require review" })).toBeVisible();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios.every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText(/Keep this device.*replace the Ente version/i)).toBeVisible();
    expect(screen.getByText(/Keep Ente.*replace this device/i)).toBeVisible();
    expect(screen.getByText(/Keep both.*creates a separate local OTP/i)).toBeVisible();
  });

  it("shows local-only disconnect consequences including uncertain outcomes", async () => {
    const connected: EnteSafeState = {
      ...disconnected,
      state: "uncertain",
      connected: true,
      pendingCount: 2,
      conflictCount: 1,
    };
    render(<EnteSettings platform={platform(connected, connected)} active />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(await screen.findByRole("heading", { name: "Disconnect Ente sync?" })).toBeVisible();
    expect(screen.getByText(/local-only/i)).toBeVisible();
    expect(screen.getByText(/cannot undo.*possibly dispatched request/i)).toBeVisible();
    expect(screen.getByText(/2 pending/i)).toBeVisible();
    expect(screen.getByText(/1 conflict/i)).toBeVisible();
  });
});
