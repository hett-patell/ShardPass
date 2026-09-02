import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MigrationPanel } from "../../src/vault/migration/MigrationPanel";
import type { DeriveLegacyKey } from "../../src/vault/migration/useMigration";

const id = "0123456789abcdef0123456789abcdef";
const salt = "AAECAwQFBgcICQoLDA0ODw==";
const status = (phase: "none" | "staged" | "verified" | "completed" | "failed", itemCount = 0) => ({
  version: 1 as const,
  kind: "migration.status" as const,
  available: true,
  phase,
  itemCount,
  ...(phase === "failed" ? { guidance: "retry-or-export" as const } : {}),
});

class ScriptedPlatform {
  readonly sentMessages: unknown[] = [];
  constructor(private readonly responses: unknown[]) {}
  sendMessage(payload: unknown): Promise<unknown> {
    this.sentMessages.push(payload);
    return Promise.resolve(this.responses.shift());
  }
}

const challenge = {
  version: 1,
  kind: "migration.credentialChallenge",
  challengeId: id,
  kdf: {
    algorithm: "PBKDF2-HMAC-SHA-256",
    salt,
    iterations: 600_000,
    outputBytes: 32,
  },
  expiresAt: 31_000,
} as const;
const authorized = {
  version: 1,
  kind: "migration.credentialAuthorized",
  credentialToken: id,
  expiresAt: 31_000,
} as const;

async function expectAccessible(container: HTMLElement) {
  const results = await axe.run(container, {
    resultTypes: ["violations"],
    rules: { "color-contrast": { enabled: false } },
  });
  expect(
    results.violations.filter(({ impact }) => ["serious", "critical"].includes(impact ?? "")),
  ).toEqual([]);
}

afterEach(cleanup);

describe("trusted-page migration panel", () => {
  it("runs the exact challenge, local authorization, stage, verify, and activation sequence", async () => {
    let releaseDerivation: ((value: Uint8Array) => void) | undefined;
    const deriveKey = vi.fn<DeriveLegacyKey>(
      () => new Promise((resolve) => (releaseDerivation = resolve)),
    );
    const platform = new ScriptedPlatform([
      status("none"),
      challenge,
      authorized,
      status("staged", 3),
      status("verified", 3),
      status("completed", 3),
    ]);
    const onCompleted = vi.fn();
    const { container } = render(
      <MigrationPanel platform={platform} deriveKey={deriveKey} active onCompleted={onCompleted} />,
    );

    expect(await screen.findByRole("heading", { name: "Migrate legacy vault" })).toBeVisible();
    expect(screen.getByText(/static-inference-only/i)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Legacy password"), {
      target: { value: "local-only phrase" },
    });
    const submitButton = screen.getByRole("button", { name: "Begin migration" });
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    await waitFor(() => expect(deriveKey).toHaveBeenCalledOnce());
    expect(submitButton).toBeDisabled();
    expect(platform.sentMessages).toHaveLength(2);
    expect(JSON.stringify(platform.sentMessages)).not.toContain("local-only phrase");
    releaseDerivation?.(new Uint8Array(32).fill(7));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Migration complete"));
    expect(platform.sentMessages.map((message) => (message as { kind: string }).kind)).toEqual([
      "migration.inspect",
      "migration.getCredentialChallenge",
      "migration.authorizeCredential",
      "migration.start",
      "migration.verify",
      "migration.activate",
    ]);
    expect(platform.sentMessages[2]).toEqual({
      version: 1,
      kind: "migration.authorizeCredential",
      challengeId: id,
      derivedKey: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
    });
    expect(platform.sentMessages[3]).toEqual({
      version: 1,
      kind: "migration.start",
      credentialToken: id,
    });
    expect(screen.getByText("3 OTP items migrated")).toBeVisible();
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(container.innerHTML).not.toContain("local-only phrase");
    expect(container.innerHTML).not.toContain(id);
    expect(container.innerHTML).not.toContain(salt);
    await expectAccessible(container);
  });

  it("reconstructs completed and failed states using only safe status categories", async () => {
    const completed = new ScriptedPlatform([status("completed", 2)]);
    const { unmount } = render(<MigrationPanel platform={completed} active />);
    expect(await screen.findByRole("status")).toHaveTextContent("Migration complete");
    expect(screen.getByText("2 OTP items migrated")).toBeVisible();
    unmount();

    const failed = new ScriptedPlatform([
      { ...status("failed", 0), arbitraryError: "private internal detail" },
    ]);
    render(<MigrationPanel platform={failed} active />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Migration could not continue safely");
    expect(alert).not.toHaveTextContent("private internal detail");
    expect(screen.getByRole("button", { name: "Retry migration" })).toBeVisible();
  });

  it("cancels derivation on lock or unmount and ignores late completion", async () => {
    let releaseDerivation: ((value: Uint8Array) => void) | undefined;
    let signal: AbortSignal | undefined;
    const deriveKey: DeriveLegacyKey = (_request, nextSignal) => {
      signal = nextSignal;
      return new Promise((resolve) => (releaseDerivation = resolve));
    };
    const platform = new ScriptedPlatform([status("none"), challenge]);
    const { rerender } = render(
      <MigrationPanel platform={platform} deriveKey={deriveKey} active />,
    );
    await screen.findByLabelText("Legacy password");
    fireEvent.change(screen.getByLabelText("Legacy password"), { target: { value: "temporary" } });
    fireEvent.submit(screen.getByRole("button", { name: "Begin migration" }).closest("form")!);
    await waitFor(() => expect(signal).toBeDefined());

    rerender(<MigrationPanel platform={platform} deriveKey={deriveKey} active={false} />);
    expect(signal?.aborted).toBe(true);
    releaseDerivation?.(new Uint8Array(32));
    await Promise.resolve();
    expect(platform.sentMessages.map((message) => (message as { kind: string }).kind)).toEqual([
      "migration.inspect",
      "migration.getCredentialChallenge",
    ]);
  });
});
