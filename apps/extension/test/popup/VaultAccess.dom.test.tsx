// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    render(
      <VaultAccess
        platform={{ sendMessage }}
        deriveKey={vi.fn(() => Promise.resolve(new Uint8Array(32)))}
      />,
    );
    await screen.findByRole("heading", { name: "Create your vault" });
    const password = screen.getByLabelText("Master password");
    const confirm = screen.getByLabelText("Confirm master password");

    // Too short: the length rule is the only thing to say; no box that cannot help.
    fireEvent.change(password, { target: { value: "short" } });
    expect(screen.getByText(/Use at least 12 characters/)).toBeVisible();
    expect(
      screen.queryByRole("checkbox", { name: "Use this password anyway" }),
    ).not.toBeInTheDocument();

    // Long enough but weak: the box appears, and without it the submit is refused.
    fireEvent.change(password, { target: { value: "aaaaaaaaaaaaaaaa" } });
    fireEvent.change(confirm, { target: { value: "aaaaaaaaaaaaaaaa" } });
    const box = screen.getByRole("checkbox", { name: "Use this password anyway" });
    fireEvent.click(screen.getByRole("button", { name: "Create vault" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tick the box to use it anyway");
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "vault.getKdfChallenge" }),
    );

    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Create vault" }));
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "vault.getKdfChallenge", purpose: "setup" }),
      ),
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

type PortState = {
  onState: (value: unknown) => void;
  onDisconnect: () => void;
};

const stateMessage = (state: "locked" | "unlocked", streamId: string, sequence: number) => ({
  version: 1,
  kind: "vault.state",
  state,
  autoLockMinutes: 15,
  lockOnScreenLock: true,
  retryAfterMs: 0,
  streamId,
  sequence,
});

function portPlatform() {
  const ports: PortState[] = [];
  const sendMessage = vi.fn(() => new Promise<never>(() => undefined));
  const connectVaultState = vi.fn((onState: (value: unknown) => void, onDisconnect: () => void) => {
    ports.push({ onState, onDisconnect });
    return () => undefined;
  });
  return { platform: { sendMessage, connectVaultState }, ports, connectVaultState };
}

describe("VaultAccess over the background's state port", () => {
  // Reconnecting is only attempted while the extension runtime still exists.
  beforeEach(() => vi.stubGlobal("chrome", { runtime: { id: "test-extension" } }));
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the vault unlocked while the background worker restarts and the port comes back", async () => {
    const { platform, ports, connectVaultState } = portPlatform();
    const onUnlockedChange = vi.fn();
    render(<VaultAccess platform={platform} onUnlockedChange={onUnlockedChange} />);
    await waitFor(() => expect(ports).toHaveLength(1));
    ports[0]!.onState(stateMessage("unlocked", "00000000000000000000000000000001", 1));
    expect(await screen.findByRole("heading", { name: "Vault unlocked" })).toBeVisible();

    ports[0]!.onDisconnect();
    await waitFor(() => expect(connectVaultState).toHaveBeenCalledTimes(2));
    ports[1]!.onState(stateMessage("unlocked", "00000000000000000000000000000002", 1));

    expect(screen.getByRole("heading", { name: "Vault unlocked" })).toBeVisible();
    expect(onUnlockedChange).not.toHaveBeenCalledWith(false);
  });

  it("does not wipe a password being typed when a fresh port repeats the locked state", async () => {
    const { platform, ports, connectVaultState } = portPlatform();
    render(<VaultAccess platform={platform} />);
    await waitFor(() => expect(ports).toHaveLength(1));
    ports[0]!.onState(stateMessage("locked", "00000000000000000000000000000001", 1));
    const input = await screen.findByLabelText("Master password");
    fireEvent.change(input, { target: { value: "still typing this" } });

    ports[0]!.onDisconnect();
    await waitFor(() => expect(connectVaultState).toHaveBeenCalledTimes(2));
    ports[1]!.onState(stateMessage("locked", "00000000000000000000000000000002", 1));

    expect(screen.getByLabelText("Master password")).toHaveValue("still typing this");
  });

  it("offers locking when ShardPass closes, and warns when the vault is left open until the browser closes", async () => {
    const { platform, ports } = portPlatform();
    const sent: unknown[] = [];
    vi.mocked(platform.sendMessage).mockImplementation((async (request: unknown) => {
      sent.push(request);
      return Promise.resolve({ version: 1, kind: "vault.ok", state: "unlocked" });
    }) as never);
    render(<VaultAccess platform={platform} securityControls />);
    await waitFor(() => expect(ports).toHaveLength(1));
    ports[0]!.onState(stateMessage("unlocked", "00000000000000000000000000000001", 1));
    const choice = await screen.findByLabelText("Lock the vault");
    expect(choice).toHaveValue("15");

    fireEvent.change(choice, { target: { value: "immediately" } });
    await waitFor(() =>
      expect(sent).toContainEqual({
        version: 1,
        kind: "vault.updateLockSettings",
        autoLockMinutes: 15,
        lockOnScreenLock: true,
        lockWhenClosed: true,
      }),
    );
    expect(screen.queryByRole("note")).toBeNull();

    fireEvent.change(choice, { target: { value: "0" } });
    await waitFor(() =>
      expect(sent).toContainEqual({
        version: 1,
        kind: "vault.updateLockSettings",
        autoLockMinutes: 0,
        lockOnScreenLock: true,
        lockWhenClosed: false,
      }),
    );
    expect(screen.getByRole("note")).toHaveTextContent(/anyone at this computer/u);
  });

  it("gives up and shows the vault as unavailable only after repeated failed reconnects", async () => {
    const { platform, ports, connectVaultState } = portPlatform();
    const onUnlockedChange = vi.fn();
    render(<VaultAccess platform={platform} onUnlockedChange={onUnlockedChange} />);
    await waitFor(() => expect(ports).toHaveLength(1));
    ports[0]!.onState(stateMessage("unlocked", "00000000000000000000000000000001", 1));
    await screen.findByRole("heading", { name: "Vault unlocked" });

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const port = ports[ports.length - 1]!;
      port.onDisconnect();
      // Backoff grows to two seconds per attempt.
      if (attempt < 5)
        await waitFor(() => expect(connectVaultState).toHaveBeenCalledTimes(attempt + 2), {
          timeout: 4_000,
        });
    }

    await waitFor(() => expect(onUnlockedChange).toHaveBeenCalledWith(false));
    expect(screen.getByRole("status", { name: "Loading vault state" })).toBeVisible();
    expect(connectVaultState).toHaveBeenCalledTimes(6);
  }, 15_000);
});
