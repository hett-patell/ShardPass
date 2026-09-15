// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

import { VaultAccess } from "../../src/vault-access/VaultAccess";

const kdf = {
  algorithm: "argon2id",
  salt: "AAAAAAAAAAAAAAAAAAAAAA==",
  memoryKiB: 65536,
  iterations: 2,
  parallelism: 1,
} as const;

function lockedState(pinAvailable: boolean) {
  return {
    version: 1,
    kind: "vault.state",
    state: "locked",
    autoLockMinutes: 15,
    lockOnScreenLock: true,
    pinAvailable,
    retryAfterMs: 0,
    streamId: "00000000000000000000000000000001",
    sequence: 1,
  };
}

describe("VaultAccess PIN unlock", () => {
  it("offers the PIN first when one is set, derives with the stored salt, and unlocks", async () => {
    const sendMessage = vi.fn((request: { kind: string }) => {
      switch (request.kind) {
        case "vault.getState":
          return Promise.resolve(lockedState(true));
        case "vault.getPinChallenge":
          return Promise.resolve({
            version: 1,
            kind: "vault.pinChallenge",
            challengeId: "0123456789abcdef0123456789abcdef",
            kdf,
            expiresAt: Date.now() + 10_000,
          });
        case "vault.unlockWithPin":
          return Promise.resolve({ version: 1, kind: "vault.ok", state: "unlocked" });
        default:
          return Promise.resolve({ version: 1, kind: "vault.ok", state: "unlocked" });
      }
    });
    const deriveKey = vi.fn(() => Promise.resolve(new Uint8Array(32).fill(7)));
    const onUnlockedChange = vi.fn();
    render(
      <VaultAccess
        platform={{ sendMessage }}
        deriveKey={deriveKey}
        onUnlockedChange={onUnlockedChange}
      />,
    );
    expect(await screen.findByText("Enter your PIN.")).toBeVisible();
    expect(screen.queryByLabelText("Master password")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2468" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock vault" }));
    await waitFor(() => expect(onUnlockedChange).toHaveBeenCalledWith(true));
    expect(deriveKey).toHaveBeenCalledWith(
      "2468",
      { algorithm: "argon2id", memoryKiB: 65536, iterations: 2, parallelism: 1 },
      expect.any(Uint8Array),
    );
    const unlockCall = sendMessage.mock.calls.find(
      ([request]) => request.kind === "vault.unlockWithPin",
    );
    expect(unlockCall?.[0]).toMatchObject({
      challengeId: "0123456789abcdef0123456789abcdef",
      pinKey: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
    });
  });

  it("falls back to the master password once the PIN is removed", async () => {
    const sendMessage = vi.fn((request: { kind: string }) => {
      switch (request.kind) {
        case "vault.getState":
          return Promise.resolve(lockedState(true));
        case "vault.getPinChallenge":
          return Promise.resolve({
            version: 1,
            kind: "vault.pinChallenge",
            challengeId: "0123456789abcdef0123456789abcdef",
            kdf,
            expiresAt: Date.now() + 10_000,
          });
        default:
          return Promise.resolve({
            version: 1,
            kind: "error",
            error: {
              code: "PIN_REMOVED",
              message: "Too many wrong PINs. The PIN was removed; use your master password.",
            },
          });
      }
    });
    render(
      <VaultAccess
        platform={{ sendMessage }}
        deriveKey={vi.fn(() => Promise.resolve(new Uint8Array(32)))}
      />,
    );
    await screen.findByText("Enter your PIN.");
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock vault" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The PIN was removed");
    expect(screen.getByLabelText("Master password")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Use PIN instead" })).not.toBeInTheDocument();
  });

  it("lets the user switch to the master password and back", async () => {
    const sendMessage = vi.fn(() => Promise.resolve(lockedState(true)));
    render(<VaultAccess platform={{ sendMessage }} deriveKey={vi.fn()} />);
    await screen.findByText("Enter your PIN.");
    fireEvent.click(screen.getByRole("button", { name: "Use master password instead" }));
    expect(screen.getByLabelText("Master password")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Use PIN instead" }));
    expect(screen.getByLabelText("PIN")).toBeVisible();
  });

  it("sets a PIN from the security settings with a fresh salt, and can remove it", async () => {
    const sendMessage = vi.fn((request: { kind: string }) => {
      if (request.kind === "vault.getState")
        return Promise.resolve({ ...lockedState(false), state: "unlocked" });
      return Promise.resolve({ version: 1, kind: "vault.ok", state: "unlocked" });
    });
    const deriveKey = vi.fn(() => Promise.resolve(new Uint8Array(32).fill(1)));
    render(<VaultAccess platform={{ sendMessage }} deriveKey={deriveKey} securityControls />);
    await screen.findByRole("heading", { name: "Unlock with a PIN" });

    fireEvent.change(screen.getByLabelText("New PIN"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Set PIN" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 4 characters");
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "vault.setPin" }));

    fireEvent.change(screen.getByLabelText("New PIN"), { target: { value: "1234" } });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Set PIN" }));
    expect(await screen.findByRole("status")).toHaveTextContent("PIN set");
    const setCall = sendMessage.mock.calls.find(([request]) => request.kind === "vault.setPin");
    const setRequest = setCall?.[0] as unknown as {
      pinKey: string;
      kdf: { algorithm: string; salt: string };
    };
    expect(setRequest.pinKey).toBe("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=");
    expect(setRequest.kdf.algorithm).toBe("argon2id");
    expect(setRequest.kdf.salt).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(setRequest.kdf.salt).not.toBe(kdf.salt);

    fireEvent.click(screen.getByRole("button", { name: "Remove PIN" }));
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "vault.removePin" }),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("PIN removed");
    expect(screen.getByLabelText("New PIN")).toBeVisible();
  });
});
