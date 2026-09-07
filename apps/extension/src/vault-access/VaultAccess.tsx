import {
  MAX_PASSWORD_UTF8_BYTES,
  MIN_SETUP_PASSWORD_CODE_POINTS,
  createWorkerKdfExecutor,
  type Argon2idWorkParameters,
} from "@shardpass/crypto";
import {
  VaultKdfChallengeResponseSchema,
  VaultStateResponseSchema,
  VaultStateUnavailableSchema,
} from "@shardpass/messaging";
import { Button, PasswordInput } from "@shardpass/ui";
import { useEffect, useRef, useState } from "react";

import type { ExtensionPlatform } from "../platform/extension-platform";
import styles from "./VaultAccess.module.css";

export type DerivePageKey = (
  password: string,
  parameters: Argon2idWorkParameters,
  salt: Uint8Array,
) => Promise<Uint8Array>;

const defaultDerive: DerivePageKey = async (password, parameters, salt) => {
  const executor = createWorkerKdfExecutor();
  return executor.derive({
    password: new TextEncoder().encode(password),
    salt,
    parameters,
  });
};

function backgroundErrorCode(response: unknown): string | undefined {
  if (typeof response !== "object" || response === null) return undefined;
  const envelope = response as { kind?: unknown; error?: { code?: unknown } };
  if (envelope.kind !== "error") return undefined;
  const code = envelope.error?.code;
  return typeof code === "string" ? code : "unknown error";
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 0 ? message : "No response from background service.";
}

export function VaultAccess({
  platform,
  deriveKey = defaultDerive,
  securityControls = false,
  onUnlockedChange,
}: {
  platform: Pick<ExtensionPlatform, "sendMessage" | "connectVaultState">;
  deriveKey?: DerivePageKey;
  securityControls?: boolean;
  onUnlockedChange?: (unlocked: boolean) => void;
}) {
  const [state, setState] = useState<"loading" | "unconfigured" | "locked" | "unlocked">("loading");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [settings, setSettings] = useState({ autoLockMinutes: 15, lockOnScreenLock: true });
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const [settingsError, setSettingsError] = useState("");

  // Optimistic, but honest: the control shows the new value immediately and rolls back with
  // a named reason if the background refuses, instead of silently snapping back on the next
  // state push -- which reads as "the setting doesn't save".
  async function applyLockSettings(next: { autoLockMinutes: number; lockOnScreenLock: boolean }) {
    const previous = settings;
    setSettings(next);
    setSettingsError("");
    try {
      const response = (await platform.sendMessage({
        version: 1,
        kind: "vault.updateLockSettings",
        ...next,
      })) as { kind?: unknown; error?: { code?: unknown } };
      if (response?.kind === "vault.ok") return;
      setSettings(previous);
      const code = typeof response?.error?.code === "string" ? response.error.code : "no response";
      setSettingsError(`Could not save this setting (${code}).`);
    } catch (failure) {
      setSettings(previous);
      setSettingsError(`Could not save this setting (${errorText(failure)}).`);
    }
  }
  const [diagnostic, setDiagnostic] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newConfirmation, setNewConfirmation] = useState("");
  const latestStream = useRef<{ streamId: string; sequence: number } | null>(null);

  useEffect(() => {
    let active = true;
    let retries = 0;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let disconnect: (() => void) | undefined;
    const clearFields = () => {
      setPassword("");
      setConfirmation("");
      setCurrentPassword("");
      setNewPassword("");
      setNewConfirmation("");
    };
    let receivedPortState = false;
    let queryTimer: ReturnType<typeof setTimeout> | undefined;
    const accept = (response: unknown, fromPort: boolean) => {
      const unavailable = VaultStateUnavailableSchema.safeParse(response);
      if (unavailable.success) {
        if (!active) return;
        const latest = latestStream.current;
        if (
          latest !== null &&
          (unavailable.data.streamId !== latest.streamId ||
            unavailable.data.sequence <= latest.sequence)
        )
          return;
        latestStream.current = {
          streamId: unavailable.data.streamId,
          sequence: unavailable.data.sequence,
        };
        if (fromPort && !receivedPortState) receivedPortState = true;
        onUnlockedChange?.(false);
        setState("loading");
        return;
      }
      const parsed = VaultStateResponseSchema.safeParse(response);
      if (!parsed.success) {
        // The background answered, but not with a vault state — almost always an error
        // envelope from a route that failed. Record why so the UI can say more than
        // "loading" forever, instead of dropping the response on the floor.
        const code = backgroundErrorCode(response);
        if (active) {
          if (response === undefined || response === null)
            setDiagnostic("Background returned no response (message handler failed).");
          else if (code !== undefined) setDiagnostic(`Background reported: ${code}`);
        }
      }
      if (!active || !parsed.success) return;
      const latest = latestStream.current;
      if (
        latest !== null &&
        ((parsed.data.streamId === latest.streamId && parsed.data.sequence <= latest.sequence) ||
          (!fromPort && parsed.data.streamId !== latest.streamId))
      )
        return;
      if (fromPort && !receivedPortState) receivedPortState = true;
      latestStream.current = { streamId: parsed.data.streamId, sequence: parsed.data.sequence };
      retries = 0;
      setDiagnostic("");
      if (parsed.data.state !== "unlocked") clearFields();
      onUnlockedChange?.(parsed.data.state === "unlocked");
      setState(parsed.data.state);
      setSettings({
        autoLockMinutes: parsed.data.autoLockMinutes,
        lockOnScreenLock: parsed.data.lockOnScreenLock,
      });
    };
    const query = async () => {
      try {
        accept(await platform.sendMessage({ version: 1, kind: "vault.getState" }), false);
      } catch (error) {
        if (active) {
          setDiagnostic(errorText(error));
          onUnlockedChange?.(false);
          setState("loading");
        }
      }
    };
    const connect = () => {
      disconnect?.();
      disconnect = undefined;
      if (!active) return;
      if (platform.connectVaultState === undefined) {
        void query();
        return;
      }
      try {
        receivedPortState = false;
        disconnect = platform.connectVaultState(
          (value) => accept(value, true),
          () => {
            disconnect = undefined;
            if (!active) return;
            onUnlockedChange?.(false);
            setState("loading");
            clearFields();
            latestStream.current = null;
            receivedPortState = false;
            if (queryTimer !== undefined) clearTimeout(queryTimer);
            if (retries >= 5 || !globalThis.chrome?.runtime?.id) return;
            const delay = Math.min(2_000, 250 * 2 ** retries++);
            reconnect = setTimeout(connect, delay);
          },
        );
        queryTimer = setTimeout(() => {
          if (!receivedPortState) void query();
        }, 250);
      } catch {
        onUnlockedChange?.(false);
        setState("loading");
      }
    };
    connect();
    return () => {
      active = false;
      clearFields();
      if (reconnect !== undefined) clearTimeout(reconnect);
      if (queryTimer !== undefined) clearTimeout(queryTimer);
      disconnect?.();
    };
  }, [onUnlockedChange, platform]);

  async function deriveChallenge(passwordValue: string, purpose: "change-current" | "change-new") {
    const raw = await platform.sendMessage({ version: 1, kind: "vault.getKdfChallenge", purpose });
    const challenge = VaultKdfChallengeResponseSchema.parse(raw);
    const { salt, ...parameters } = challenge.kdf;
    return { challenge, key: await deriveKey(passwordValue, parameters, decodeBase64(salt)) };
  }

  async function rotatePassword(): Promise<void> {
    setError("");
    if (Array.from(newPassword).length < MIN_SETUP_PASSWORD_CODE_POINTS) {
      setError(`Use at least ${MIN_SETUP_PASSWORD_CODE_POINTS} characters.`);
      return;
    }
    if (newPassword !== newConfirmation) {
      setError("Passwords do not match.");
      return;
    }
    if (new TextEncoder().encode(newPassword).byteLength > MAX_PASSWORD_UTF8_BYTES) {
      setError("The password is too long.");
      return;
    }
    let currentKey: Uint8Array | undefined;
    let nextKey: Uint8Array | undefined;
    setWorking(true);
    try {
      const current = await deriveChallenge(currentPassword, "change-current");
      currentKey = current.key;
      const next = await deriveChallenge(newPassword, "change-new");
      nextKey = next.key;
      const response = await platform.sendMessage({
        version: 1,
        kind: "vault.changePassword",
        currentChallengeId: current.challenge.challengeId,
        currentKeyEncryptionKey: encodeBase64(currentKey),
        newChallengeId: next.challenge.challengeId,
        newKeyEncryptionKey: encodeBase64(nextKey),
      });
      if (isCommittedLocked(response)) {
        onUnlockedChange?.(false);
        setState("locked");
        setError(
          "The password was changed, but the vault is locked. Unlock with the new password.",
        );
      } else if (!isUnlocked(response)) setError(safeError(response));
    } catch {
      setError("The password could not be changed. Try again.");
    } finally {
      currentKey?.fill(0);
      nextKey?.fill(0);
      setCurrentPassword("");
      setNewPassword("");
      setNewConfirmation("");
      setWorking(false);
    }
  }

  async function submit(): Promise<void> {
    setError("");
    const bytes = new TextEncoder().encode(password).byteLength;
    if (state === "unconfigured" && Array.from(password).length < MIN_SETUP_PASSWORD_CODE_POINTS) {
      setError(`Use at least ${MIN_SETUP_PASSWORD_CODE_POINTS} characters.`);
      return;
    }
    if (bytes > MAX_PASSWORD_UTF8_BYTES) {
      setError("The password is too long.");
      return;
    }
    if (state === "unconfigured" && password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setWorking(true);
    try {
      const purpose = state === "unconfigured" ? "setup" : "unlock";
      const raw = await platform.sendMessage({
        version: 1,
        kind: "vault.getKdfChallenge",
        purpose,
      });
      const challenge = VaultKdfChallengeResponseSchema.parse(raw);
      const { salt, ...parameters } = challenge.kdf;
      const key = await deriveKey(password, parameters, decodeBase64(salt));
      try {
        const response = await platform.sendMessage({
          version: 1,
          kind: state === "unconfigured" ? "vault.setup" : "vault.unlock",
          challengeId: challenge.challengeId,
          keyEncryptionKey: encodeBase64(key),
        });
        if (isUnlocked(response)) {
          onUnlockedChange?.(true);
          setPassword("");
          setConfirmation("");
          setState("unlocked");
        } else if (isCommittedLocked(response)) {
          onUnlockedChange?.(false);
          setPassword("");
          setConfirmation("");
          setState("locked");
          setError("The vault change was saved, but the vault is locked. Unlock again.");
        } else {
          setError(safeError(response));
        }
      } finally {
        key.fill(0);
      }
    } catch {
      setError("The vault could not be unlocked. Try again.");
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => {
    if (state !== "loading") {
      setLoadingTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setLoadingTimedOut(true), 5_000);
    return () => clearTimeout(timer);
  }, [state]);

  if (state === "loading")
    return (
      <div className={styles.loading} role="status" aria-label="Loading vault state">
        {loadingTimedOut ? (
          <>
            <p className={styles.loadingError}>Could not connect to ShardPass background service.</p>
            {diagnostic === "" ? null : <p className={styles.loadingDetail}>{diagnostic}</p>}
            <p>Check chrome://extensions for errors, then reload the extension.</p>
          </>
        ) : (
          <p>Connecting to vault&hellip;</p>
        )}
      </div>
    );
  if (state === "unlocked") {
    return (
      <section className={styles.panel}>
        <h2>Vault unlocked</h2>
        <p>ShardPass locks itself after the time below, or as soon as your screen locks.</p>
        {securityControls ? (
          <>
            <h3>Security settings</h3>
            {settingsError !== "" ? (
              <p className={styles.loadingError} role="alert">
                {settingsError}
              </p>
            ) : null}
            <label>
              Auto-lock
              <select
                value={settings.autoLockMinutes}
                onChange={(event) => {
                  const autoLockMinutes = Number(event.target.value) as 0 | 5 | 15 | 30 | 60;
                  void applyLockSettings({ ...settings, autoLockMinutes });
                }}
              >
                <option value={0}>Off</option>
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>60 minutes</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.lockOnScreenLock}
                onChange={(event) => {
                  void applyLockSettings({ ...settings, lockOnScreenLock: event.target.checked });
                }}
              />
              Lock when the screen locks
            </label>
            <h3>Change master password</h3>
            <label>
              Current password
              <PasswordInput

                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label>
              New password
              <PasswordInput

                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              Confirm new password
              <PasswordInput

                autoComplete="new-password"
                value={newConfirmation}
                onChange={(event) => setNewConfirmation(event.target.value)}
              />
            </label>
            <Button variant="secondary" onClick={() => void rotatePassword()}>
              Change password
            </Button>
          </>
        ) : null}
        <Button
          variant="secondary"
          onClick={() =>
            void platform.sendMessage({ version: 1, kind: "vault.lock" }).then(() => {
              onUnlockedChange?.(false);
              setState("locked");
            })
          }
        >
          Lock vault
        </Button>
      </section>
    );
  }
  const setup = state === "unconfigured";
  return (
    <section className={styles.panel}>
      <h2>{setup ? "Create your vault" : "Unlock ShardPass"}</h2>
      <p>
        {setup
          ? "One password protects everything in ShardPass. It never leaves this device and cannot be recovered, so pick something long that you will remember."
          : "Enter your master password."}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className={styles.form}
      >
        <label>
          Master password
          <PasswordInput
            autoFocus
            autoComplete={setup ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {setup ? (
          <label>
            Confirm master password
            <PasswordInput
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" loading={working}>
          {setup ? "Create vault" : "Unlock vault"}
        </Button>
      </form>
    </section>
  );
}

function isUnlocked(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "vault.ok" &&
    (value as { state?: unknown }).state === "unlocked"
  );
}
function isCommittedLocked(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "vault.ok" &&
    (value as { state?: unknown }).state === "locked" &&
    (value as { committed?: unknown }).committed === true
  );
}
function safeError(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { error?: { message?: unknown } }).error &&
    typeof (value as { error: { message?: unknown } }).error.message === "string"
  )
    return (value as { error: { message: string } }).error.message;
  return "The vault could not be unlocked. Try again.";
}
function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
function encodeBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}
