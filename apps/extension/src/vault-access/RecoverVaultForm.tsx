import { MAX_PASSWORD_UTF8_BYTES, MIN_SETUP_PASSWORD_CODE_POINTS } from "@shardpass/crypto";
import {
  VaultKdfChallengeResponseSchema,
  VaultRecoveryChallengeResponseSchema,
} from "@shardpass/messaging";
import { Button, PasswordInput } from "@shardpass/ui";
import { useState } from "react";

import type { ExtensionPlatform } from "../platform/extension-platform";
import { decodeBase64, encodeBase64 } from "./key-transport";
import { normalizeRecoveryCode } from "./recovery-code";
import type { DerivePageKey } from "./VaultAccess";
import styles from "./VaultAccess.module.css";

export interface RecoverVaultFormProps {
  platform: Pick<ExtensionPlatform, "sendMessage">;
  deriveKey: DerivePageKey;
  /**
   * "recover": the vault is locked and the master password forgotten. "reset": the vault is
   * already open with the recovery code and only needs its new password.
   */
  mode: "recover" | "reset";
  /** The vault is open under the new master password. */
  onRecovered: () => void;
  /** Back to the ordinary unlock form; absent in "reset", which has to be finished. */
  onCancel?: () => void;
}

function errorCodeOf(value: unknown): string | undefined {
  const candidate = value as { kind?: unknown; error?: { code?: unknown } } | undefined;
  return candidate?.kind === "error" && typeof candidate.error?.code === "string"
    ? candidate.error.code
    : undefined;
}

function isUnlocked(value: unknown): boolean {
  const candidate = value as { kind?: unknown; state?: unknown } | undefined;
  return candidate?.kind === "vault.ok" && candidate.state === "unlocked";
}

/**
 * A forgotten master password: the recovery code opens the vault, and a new master password
 * replaces the old one in the same step. Both keys are derived here, on this page, exactly as
 * the master password always is; neither the code nor the password leaves it.
 */
export function RecoverVaultForm({
  platform,
  deriveKey,
  mode,
  onRecovered,
  onCancel,
}: RecoverVaultFormProps) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const validate = (): string | null => {
    if (mode === "recover" && normalizeRecoveryCode(code) === null)
      return "Enter the 24-letter recovery code, as it was written down.";
    if (Array.from(password).length < MIN_SETUP_PASSWORD_CODE_POINTS)
      return `Use at least ${MIN_SETUP_PASSWORD_CODE_POINTS} characters for the new master password.`;
    if (new TextEncoder().encode(password).byteLength > MAX_PASSWORD_UTF8_BYTES)
      return "The password is too long.";
    if (password !== confirmation) return "The new passwords do not match.";
    return null;
  };

  /** Opens the vault with the code. Returns false, having said why, when it cannot. */
  const openWithCode = async (): Promise<boolean> => {
    const normalized = normalizeRecoveryCode(code);
    if (normalized === null) return false;
    const challenge = VaultRecoveryChallengeResponseSchema.safeParse(
      await platform.sendMessage({ version: 1, kind: "vault.getRecoveryChallenge" }),
    );
    if (!challenge.success) {
      setError("The vault is not ready for a recovery right now. Wait a moment and try again.");
      return false;
    }
    const { salt, ...parameters } = challenge.data.kdf;
    const key = await deriveKey(normalized, parameters, decodeBase64(salt));
    try {
      const response = await platform.sendMessage({
        version: 1,
        kind: "vault.unlockWithRecovery",
        challengeId: challenge.data.challengeId,
        recoveryKey: encodeBase64(key),
      });
      if (isUnlocked(response)) return true;
      const reason = errorCodeOf(response);
      setError(
        reason === "INVALID_CREDENTIALS"
          ? "That recovery code does not open this vault. Check it letter by letter."
          : reason === "THROTTLED"
            ? "Too many attempts. Wait a few minutes, then try again."
            : "The vault could not be opened. Try again.",
      );
      return false;
    } finally {
      key.fill(0);
    }
  };

  const setNewPassword = async (): Promise<boolean> => {
    const challenge = VaultKdfChallengeResponseSchema.safeParse(
      await platform.sendMessage({
        version: 1,
        kind: "vault.getKdfChallenge",
        purpose: "change-new",
      }),
    );
    if (!challenge.success) {
      setError("The new password could not be set. Try again.");
      return false;
    }
    const { salt, ...parameters } = challenge.data.kdf;
    const key = await deriveKey(password, parameters, decodeBase64(salt));
    try {
      const response = await platform.sendMessage({
        version: 1,
        kind: "vault.resetPassword",
        newChallengeId: challenge.data.challengeId,
        newKeyEncryptionKey: encodeBase64(key),
      });
      if (isUnlocked(response)) return true;
      setError("The new password could not be set. The vault is open; try again.");
      return false;
    } finally {
      key.fill(0);
    }
  };

  const submit = async () => {
    setError("");
    const problem = validate();
    if (problem !== null) {
      setError(problem);
      return;
    }
    setWorking(true);
    try {
      if (mode === "recover" && !(await openWithCode())) return;
      if (!(await setNewPassword())) return;
      setCode("");
      setPassword("");
      setConfirmation("");
      onRecovered();
    } catch {
      setError("Something went wrong on this page. Try again.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className={styles.panel}>
      <h2>{mode === "recover" ? "Recover your vault" : "Choose a new master password"}</h2>
      <p>
        {mode === "recover"
          ? "Enter the recovery code you saved, then choose a new master password. The old one stops working, and so does any PIN."
          : "The vault was opened with your recovery code. Choose the master password it opens with from now on."}
      </p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!working) void submit();
        }}
      >
        {mode === "recover" ? (
          <label>
            Recovery code
            <input
              autoFocus
              className={styles.recoveryInput}
              value={code}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
        ) : null}
        <label>
          New master password
          <PasswordInput
            autoFocus={mode === "reset"}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          Confirm new master password
          <PasswordInput
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        {error !== "" ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" loading={working}>
          {mode === "recover" ? "Recover vault" : "Set new password"}
        </Button>
        {onCancel !== undefined ? (
          <Button type="button" variant="ghost" disabled={working} onClick={onCancel}>
            Back to unlock
          </Button>
        ) : null}
        {working ? (
          <p className={styles.working} role="status">
            Deriving keys on this device. Nothing typed here is sent anywhere.
          </p>
        ) : null}
      </form>
    </section>
  );
}
