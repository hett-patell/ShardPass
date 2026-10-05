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

function vaultState(state: "locked" | "unlocked", extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    kind: "vault.state",
    state,
    autoLockMinutes: 15,
    lockOnScreenLock: true,
    pinAvailable: false,
    retryAfterMs: 0,
    streamId: "00000000000000000000000000000001",
    sequence: 1,
    ...extra,
  };
}

function background(initial: Record<string, unknown>) {
  return vi.fn((request: { kind: string }) => {
    switch (request.kind) {
      case "vault.getState":
        return Promise.resolve(initial);
      case "vault.getRecoveryChallenge":
        return Promise.resolve({
          version: 1,
          kind: "vault.recoveryChallenge",
          challengeId: "0123456789abcdef0123456789abcdef",
          kdf,
          expiresAt: Date.now() + 10_000,
        });
      case "vault.getKdfChallenge":
        return Promise.resolve({
          version: 1,
          kind: "vault.kdfChallenge",
          challengeId: "fedcba9876543210fedcba9876543210",
          purpose: "change-new",
          kdf,
          expiresAt: Date.now() + 10_000,
        });
      default:
        return Promise.resolve({ version: 1, kind: "vault.ok", state: "unlocked" });
    }
  });
}

describe("VaultAccess recovery code", () => {
  it("recovers a locked vault with the code and sets the new master password in one go", async () => {
    const sendMessage = background(vaultState("locked", { recoveryAvailable: true }));
    const deriveKey = vi.fn((input: string) =>
      Promise.resolve(new Uint8Array(32).fill(input.length)),
    );
    const onUnlockedChange = vi.fn();
    render(
      <VaultAccess
        platform={{ sendMessage }}
        deriveKey={deriveKey}
        securityControls
        onUnlockedChange={onUnlockedChange}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Forgot your master password?" }));
    fireEvent.change(screen.getByLabelText("Recovery code"), {
      target: { value: "abcd efgh ijkl mnop qrst uvwx" },
    });
    fireEvent.change(screen.getByLabelText("New master password"), {
      target: { value: "a brand new long passphrase" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new master password"), {
      target: { value: "a brand new long passphrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Recover vault" }));

    await waitFor(() => expect(onUnlockedChange).toHaveBeenLastCalledWith(true));
    // The code is derived in its canonical form, the password as typed.
    expect(deriveKey).toHaveBeenCalledWith(
      "ABCDEFGHIJKLMNOPQRSTUVWX",
      expect.any(Object),
      expect.any(Uint8Array),
    );
    const kinds = sendMessage.mock.calls.map(([request]) => request.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "vault.getRecoveryChallenge",
        "vault.unlockWithRecovery",
        "vault.resetPassword",
      ]),
    );
    expect(kinds.indexOf("vault.unlockWithRecovery")).toBeLessThan(
      kinds.indexOf("vault.resetPassword"),
    );
  });

  it("offers recovery only on the vault page, and only when a code exists", async () => {
    render(
      <VaultAccess
        platform={{ sendMessage: background(vaultState("locked", { recoveryAvailable: true })) }}
      />,
    );
    await screen.findByRole("button", { name: "Unlock vault" });
    expect(screen.queryByRole("button", { name: "Forgot your master password?" })).toBeNull();
    cleanup();
    render(
      <VaultAccess platform={{ sendMessage: background(vaultState("locked")) }} securityControls />,
    );
    await screen.findByRole("button", { name: "Unlock vault" });
    expect(screen.queryByRole("button", { name: "Forgot your master password?" })).toBeNull();
  });

  it("holds a vault opened with the code until it has a new master password", async () => {
    const onUnlockedChange = vi.fn();
    render(
      <VaultAccess
        platform={{ sendMessage: background(vaultState("unlocked", { recovering: true })) }}
        deriveKey={() => Promise.resolve(new Uint8Array(32))}
        securityControls
        onUnlockedChange={onUnlockedChange}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "Choose a new master password" }),
    ).toBeVisible();
    expect(onUnlockedChange).not.toHaveBeenCalledWith(true);
    fireEvent.change(screen.getByLabelText("New master password"), {
      target: { value: "a brand new long passphrase" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new master password"), {
      target: { value: "a brand new long passphrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
    await waitFor(() => expect(onUnlockedChange).toHaveBeenLastCalledWith(true));
  });

  it("makes a code in Settings, shows it once, and saves only a key derived from it", async () => {
    const sendMessage = background(vaultState("unlocked"));
    const deriveKey = vi.fn(() => Promise.resolve(new Uint8Array(32).fill(3)));
    render(<VaultAccess platform={{ sendMessage }} deriveKey={deriveKey} securityControls />);
    fireEvent.click(await screen.findByRole("button", { name: "Make a recovery code" }));
    const shown = await screen.findByText(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){5}$/u);
    const code = shown.textContent.replaceAll("-", "");
    expect(deriveKey).toHaveBeenCalledWith(code, expect.any(Object), expect.any(Uint8Array));
    const saved = sendMessage.mock.calls.find(([request]) => request.kind === "vault.setRecovery");
    expect(JSON.stringify(saved)).not.toContain(code);

    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toBeDisabled();
    fireEvent.click(screen.getByLabelText("I have stored this code somewhere safe"));
    fireEvent.click(done);
    expect(await screen.findByText(/Recovery code saved/u)).toBeVisible();
    expect(screen.queryByText(shown.textContent)).toBeNull();
    expect(screen.getByRole("button", { name: "Make a new recovery code" })).toBeVisible();
  });
});
