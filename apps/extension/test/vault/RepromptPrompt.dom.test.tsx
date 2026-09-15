// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RepromptPrompt } from "../../src/vault-access/RepromptPrompt";

afterEach(cleanup);

const itemId = "10000000-0000-4000-8000-000000000001";
const challenge = {
  version: 1,
  kind: "vault.kdfChallenge",
  challengeId: "0123456789abcdef0123456789abcdef",
  purpose: "reprompt",
  kdf: {
    algorithm: "argon2id",
    salt: "AAAAAAAAAAAAAAAAAAAAAA==",
    memoryKiB: 65536,
    iterations: 2,
    parallelism: 1,
  },
  expiresAt: Date.now() + 10_000,
} as const;

describe("RepromptPrompt", () => {
  it("asks for a reprompt challenge, sends the derived key with the item id, and reports the grant", async () => {
    const sendMessage = vi.fn(
      (request: { kind: string; keyEncryptionKey?: string; itemId?: string }) => {
        if (request.kind === "vault.getKdfChallenge") return Promise.resolve(challenge);
        if (request.kind === "vault.confirmReprompt")
          return Promise.resolve(
            request.keyEncryptionKey === "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=" &&
              request.itemId === itemId
              ? { version: 1, kind: "vault.ok", state: "unlocked" }
              : { version: 1, kind: "error", error: { code: "INVALID_CREDENTIALS", message: "" } },
          );
        return Promise.resolve(undefined);
      },
    );
    const deriveKey = vi.fn((password: string) =>
      Promise.resolve(
        Uint8Array.from({ length: 32 }, (_, index) => (password === "right" ? index + 1 : 0)),
      ),
    );
    const onGranted = vi.fn();
    render(
      <RepromptPrompt
        platform={{ sendMessage }}
        itemId={itemId}
        onGranted={onGranted}
        deriveKey={deriveKey}
      />,
    );

    fireEvent.change(screen.getByLabelText("Master password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That is not your master password.");
    expect(onGranted).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Master password"), { target: { value: "right" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(onGranted).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "vault.getKdfChallenge", purpose: "reprompt" }),
    );
    expect(JSON.stringify(sendMessage.mock.calls)).not.toContain("right");
  });
});
