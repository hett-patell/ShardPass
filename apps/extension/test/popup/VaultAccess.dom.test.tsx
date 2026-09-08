// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

import { VaultAccess } from "../../src/vault-access/VaultAccess";

const challenge = {
  version: 1,
  kind: "vault.kdfChallenge",
  challengeId: "0123456789abcdef0123456789abcdef",
  purpose: "setup",
  kdf: {
    algorithm: "argon2id",
    salt: "AAAAAAAAAAAAAAAAAAAAAA==",
    memoryKiB: 65536,
    iterations: 2,
    parallelism: 1,
  },
  expiresAt: Date.now() + 10_000,
} as const;

describe("VaultAccess", () => {
  it("enforces setup password policy before requesting a challenge", async () => {
    const sendMessage = vi.fn((request: { kind: string }) =>
      Promise.resolve(
        request.kind === "vault.getState"
          ? {
              version: 1,
              kind: "vault.state",
              state: "unconfigured",
              autoLockMinutes: 15,
              lockOnScreenLock: true,
              retryAfterMs: 0,
              streamId: "00000000000000000000000000000001",
              sequence: 1,
            }
          : challenge,
      ),
    );
    render(<VaultAccess platform={{ sendMessage }} deriveKey={vi.fn()} />);
    await screen.findByRole("heading", { name: "Create your vault" });
    fireEvent.change(screen.getByLabelText("Master password"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("Confirm master password"), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create vault" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 12 characters");
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("offers the weak-password box only once the password is long enough, and honours it", async () => {
    const sendMessage = vi.fn((request: { kind: string }) =>
      Promise.resolve(
        request.kind === "vault.getState"
          ? {
              version: 1,
              kind: "vault.state",
              state: "unconfigured",
              autoLockMinutes: 15,
              lockOnScreenLock: true,
              retryAfterMs: 0,
              streamId: "00000000000000000000000000000001",
              sequence: 1,
            }
          : challenge,
      ),
    );
    render(<VaultAccess platform={{ sendMessage }} deriveKey={vi.fn(() => Promise.resolve(new Uint8Array(32)))} />);
    await screen.findByRole("heading", { name: "Create your vault" });
    const password = screen.getByLabelText("Master password");
    const confirm = screen.getByLabelText("Confirm master password");

    // Too short: the length rule is the only thing to say; no box that cannot help.
    fireEvent.change(password, { target: { value: "short" } });
    expect(screen.getByText(/Use at least 12 characters/)).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: "Use this password anyway" })).not.toBeInTheDocument();

    // Long enough but weak: the box appears, and without it the submit is refused.
    fireEvent.change(password, { target: { value: "aaaaaaaaaaaaaaaa" } });
    fireEvent.change(confirm, { target: { value: "aaaaaaaaaaaaaaaa" } });
    const box = screen.getByRole("checkbox", { name: "Use this password anyway" });
    fireEvent.click(screen.getByRole("button", { name: "Create vault" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tick the box to use it anyway");
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "vault.getKdfChallenge" }));

    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Create vault" }));
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "vault.getKdfChallenge", purpose: "setup" })),
    );
  });

  it("derives in the trusted page worker and submits only base64 KEK", async () => {
    const sendMessage = vi.fn((request: { kind: string }) => {
      if (request.kind === "vault.getState")
        return Promise.resolve({
          version: 1,
          kind: "vault.state",
          state: "unconfigured",
          autoLockMinutes: 15,
          lockOnScreenLock: true,
          retryAfterMs: 0,
          streamId: "00000000000000000000000000000001",
          sequence: 1,
        });
      if (request.kind === "vault.getKdfChallenge") return Promise.resolve(challenge);
      return Promise.resolve({ version: 1, kind: "vault.ok", state: "unlocked" });
    });
    const deriveKey = vi.fn(() =>
      Promise.resolve(Uint8Array.from({ length: 32 }, (_, index) => index + 1)),
    );
    render(<VaultAccess platform={{ sendMessage }} deriveKey={deriveKey} />);
    await screen.findByRole("heading", { name: "Create your vault" });
    const password = "correct horse battery";
    fireEvent.change(screen.getByLabelText("Master password"), { target: { value: password } });
    fireEvent.change(screen.getByLabelText("Confirm master password"), {
      target: { value: password },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create vault" }));
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "vault.setup",
          keyEncryptionKey: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=",
        }),
      ),
    );
    expect(JSON.stringify(sendMessage.mock.calls)).not.toContain(password);
    expect(await screen.findByRole("heading", { name: "Vault unlocked" })).toBeVisible();
  });
});
