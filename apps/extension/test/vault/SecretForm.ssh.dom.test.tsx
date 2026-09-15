// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SecretForm } from "../../src/vault/components/forms/SecretForm";

// jsdom's crypto has no subtle; the browser's does, and the form generates keys with it.
if (globalThis.crypto.subtle === undefined)
  Object.defineProperty(globalThis.crypto, "subtle", { value: webcrypto.subtle });

afterEach(cleanup);

describe("SecretForm SSH keys", () => {
  it("generates an Ed25519 key on this device and shows its public key and fingerprint", async () => {
    const sendMessage = vi.fn(() => Promise.resolve({ version: 1, kind: "error", error: {} }));
    render(
      <SecretForm
        platform={{ sendMessage }}
        onSaved={() => undefined}
        onCancel={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "ssh_key" } });
    expect(screen.getByLabelText("Private key")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Key comment"), { target: { value: "ci@shardpass" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate key" }));
    const privateKey = await screen.findByDisplayValue(/BEGIN OPENSSH PRIVATE KEY/u, undefined, {
      timeout: 5_000,
    });
    expect(privateKey).toBe(screen.getByLabelText("Private key"));
    const publicKey = screen.getByLabelText<HTMLTextAreaElement>("Public key");
    expect(publicKey.value).toMatch(/^ssh-ed25519 AAAA\S+ ci@shardpass$/u);
    expect(screen.getByText(/ssh-ed25519 · SHA256:/u)).toBeVisible();
    expect(screen.getByLabelText("Name")).toHaveValue("SSH key (ssh-ed25519)");
    // Nothing was sent anywhere: generation is local.
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("says when a pasted value is not a key it can read, and keeps it as pasted", async () => {
    render(
      <SecretForm
        platform={{ sendMessage: vi.fn() }}
        onSaved={() => undefined}
        onCancel={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "ssh_key" } });
    fireEvent.change(screen.getByLabelText("Private key"), { target: { value: "not a key" } });
    await waitFor(() =>
      expect(screen.getByText(/not a private key ShardPass can read/u)).toBeVisible(),
    );
    expect(screen.getByLabelText("Private key")).toHaveValue("not a key");
  });
});
