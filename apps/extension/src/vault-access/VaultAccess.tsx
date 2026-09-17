import {
  MAX_PASSWORD_UTF8_BYTES,
  MIN_SETUP_PASSWORD_CODE_POINTS,
  type Argon2idWorkParameters,
  DEFAULT_ARGON2ID_PARAMETERS,
} from "@shardpass/crypto";
import {
  VaultKdfChallengeResponseSchema,
  VaultPinChallengeResponseSchema,
  VaultStateResponseSchema,
  VaultStateUnavailableSchema,
  type VaultLockSettings,
} from "@shardpass/messaging";
import { Button, PasswordInput } from "@shardpass/ui";

import { passwordStrength } from "./password-strength";
import {
  clearStrengthCache,
  createStrengthEstimator,
  type StrengthEstimate,
} from "./strength-estimator";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ExtensionPlatform } from "../platform/extension-platform";
import { createPageKdfExecutor } from "../platform/kdf-executor";
import styles from "./VaultAccess.module.css";

const MIN_PIN_CODE_POINTS = 4;
const MAX_PIN_UTF8_BYTES = 64;

export type DerivePageKey = (
  password: string,
  parameters: Argon2idWorkParameters,
  salt: Uint8Array,
) => Promise<Uint8Array>;

const defaultDerive: DerivePageKey = async (password, parameters, salt) => {
  const executor = createPageKdfExecutor();
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
  const [weakAllowed, setWeakAllowed] = useState(false);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [settings, setSettings] = useState<VaultLockSettings>({
    autoLockMinutes: 15,
    lockOnScreenLock: true,
  });
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  // Time left on the failed-unlock cooldown the background reported; counts down on screen.
  const [retryAfterMs, setRetryAfterMs] = useState(0);
  const [pinAvailable, setPinAvailable] = useState(false);
  const [pinMode, setPinMode] = useState(true);
  const [pin, setPin] = useState("");
  const [pinConfirmation, setPinConfirmation] = useState("");
  const [pinNotice, setPinNotice] = useState("");
  // The PIN card and the locking card each show their own failure: one message shared by both
  // would appear under whichever card the reader was not looking at.
  const [pinError, setPinError] = useState("");
  const [changeNotice, setChangeNotice] = useState("");
  // The full estimate (zxcvbn, in its worker) arrives a moment after typing pauses; until
  // then, and wherever workers are missing, the quick arithmetic stands in.
  const estimator = useMemo(() => createStrengthEstimator(), []);
  useEffect(() => () => estimator.dispose(), [estimator]);
  const [refined, setRefined] = useState<Readonly<{
    password: string;
    estimate: StrengthEstimate;
  }> | null>(null);
  useEffect(() => {
    if (state !== "unconfigured" || password === "") return;
    let live = true;
    const timer = setTimeout(() => {
      void estimator.estimate(password).then((estimate) => {
        if (live) setRefined({ password, estimate });
      });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [estimator, password, state]);
  useEffect(() => {
    if (retryAfterMs <= 0) return;
    const timer = setTimeout(() => setRetryAfterMs((left) => Math.max(0, left - 1_000)), 1_000);
    return () => clearTimeout(timer);
  }, [retryAfterMs]);

  // Optimistic, but honest: the control shows the new value immediately and rolls back with
  // a named reason if the background refuses, instead of silently snapping back on the next
  // state push -- which reads as "the setting doesn't save".
  async function applyLockSettings(next: VaultLockSettings) {
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
  const lastKnownState = useRef<string | null>(null);

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
      // Typed fields go only when the vault actually locks; a state repeated by a fresh
      // port (the background worker restarts every so often) must not wipe a password
      // someone is still typing.
      if (lastKnownState.current === "unlocked" && parsed.data.state !== "unlocked") clearFields();
      lastKnownState.current = parsed.data.state;
      onUnlockedChange?.(parsed.data.state === "unlocked");
      setState(parsed.data.state);
      setRetryAfterMs(parsed.data.retryAfterMs);
      setPinAvailable(parsed.data.pinAvailable === true);
      setSettings({
        autoLockMinutes: parsed.data.autoLockMinutes,
        lockOnScreenLock: parsed.data.lockOnScreenLock,
        ...(parsed.data.lockWhenClosed === undefined
          ? {}
          : { lockWhenClosed: parsed.data.lockWhenClosed }),
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
            // The background worker idles out after half a minute and takes the port with
            // it; the vault itself is still unlocked in its session store. Keep the page as
            // it is and reconnect: the new port's first message says whether anything
            // changed. Only a connection that will not come back is shown as lost.
            latestStream.current = null;
            receivedPortState = false;
            if (queryTimer !== undefined) clearTimeout(queryTimer);
            if (!globalThis.chrome?.runtime?.id) return;
            if (retries >= 5) {
              setDiagnostic("Lost the connection to the background service.");
              onUnlockedChange?.(false);
              setState("loading");
              return;
            }
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
    setChangeNotice("");
    if (Array.from(newPassword).length < MIN_SETUP_PASSWORD_CODE_POINTS) {
      setError(`Use at least ${MIN_SETUP_PASSWORD_CODE_POINTS} characters.`);
      return;
    }
    if (newPassword !== newConfirmation) {
      setError("Passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("Choose a password different from your current one.");
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
        clearStrengthCache();
        setPinAvailable(false);
        setError(
          "The password was changed, but the vault is locked. Unlock with the new password.",
        );
      } else if (!isUnlocked(response)) setError(safeError(response));
      else {
        // The background removed the PIN with the old password; say so where the PIN lives.
        setPinAvailable(false);
        setChangeNotice("Master password changed.");
        setPinNotice(
          "Password changed. The PIN was removed with the old password; set a new one below if you want one.",
        );
      }
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

  async function unlockWithPin(): Promise<void> {
    setError("");
    if (pin.length === 0) return;
    setWorking(true);
    try {
      const challenge = VaultPinChallengeResponseSchema.parse(
        await platform.sendMessage({ version: 1, kind: "vault.getPinChallenge" }),
      );
      const { salt, ...parameters } = challenge.kdf;
      const key = await deriveKey(pin, parameters, decodeBase64(salt));
      const response = await platform.sendMessage({
        version: 1,
        kind: "vault.unlockWithPin",
        challengeId: challenge.challengeId,
        pinKey: encodeBase64(key),
      });
      if (isUnlocked(response)) {
        onUnlockedChange?.(true);
        setPin("");
        setState("unlocked");
        return;
      }
      if (errorCode(response) === "PIN_REMOVED" || errorCode(response) === "PIN_UNAVAILABLE") {
        setPinAvailable(false);
        setPinMode(false);
      }
      setPin("");
      setError(safeError(response));
    } catch {
      setError("The vault could not be unlocked. Try again.");
    } finally {
      setWorking(false);
    }
  }

  async function setPinForDevice(): Promise<void> {
    setPinNotice("");
    setPinError("");
    if (Array.from(pin).length < MIN_PIN_CODE_POINTS) {
      setPinError(`Use at least ${MIN_PIN_CODE_POINTS} characters for the PIN.`);
      return;
    }
    if (new TextEncoder().encode(pin).byteLength > MAX_PIN_UTF8_BYTES) {
      setPinError("The PIN is too long.");
      return;
    }
    if (pin !== pinConfirmation) {
      setPinError("The PINs do not match.");
      return;
    }
    setWorking(true);
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(pin, DEFAULT_ARGON2ID_PARAMETERS, salt);
      const response = await platform.sendMessage({
        version: 1,
        kind: "vault.setPin",
        pinKey: encodeBase64(key),
        kdf: { ...DEFAULT_ARGON2ID_PARAMETERS, salt: encodeBase64(salt) },
      });
      if (isUnlocked(response)) {
        setPin("");
        setPinConfirmation("");
        setPinAvailable(true);
        setPinNotice("PIN set. The lock screen offers it from now on.");
      } else setPinError(safeError(response));
    } catch {
      setPinError("The PIN could not be set. Try again.");
    } finally {
      setWorking(false);
    }
  }

  async function removePin(): Promise<void> {
    setPinNotice("");
    setPinError("");
    setWorking(true);
    try {
      const response = await platform.sendMessage({ version: 1, kind: "vault.removePin" });
      if (isUnlocked(response)) {
        setPinAvailable(false);
        setPinNotice("PIN removed. The lock screen asks for your master password.");
      } else setPinError(safeError(response));
    } catch {
      setPinError("The PIN could not be removed. Try again.");
    } finally {
      setWorking(false);
    }
  }

  async function submit(): Promise<void> {
    setError("");
    // An empty password is never right; deriving a key from it would only cost time and a
    // failed attempt against the throttle.
    if (state !== "unconfigured" && password === "") {
      setError("Enter your master password.");
      return;
    }
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
          clearStrengthCache();
          setError("The vault change was saved, but the vault is locked. Unlock again.");
        } else {
          setError(safeError(response));
          setPassword("");
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
            <p className={styles.loadingError}>
              Could not connect to ShardPass background service.
            </p>
            {diagnostic === "" ? null : <p className={styles.loadingDetail}>{diagnostic}</p>}
            <p>Check chrome://extensions for errors, then reload the extension.</p>
          </>
        ) : (
          <p>Connecting to vault&hellip;</p>
        )}
      </div>
    );
  if (state === "unlocked") {
    const lockButton = (
      <Button
        variant="secondary"
        onClick={() =>
          void platform.sendMessage({ version: 1, kind: "vault.lock" }).then(
            (reply) => {
              const candidate = reply as { kind?: unknown; state?: unknown } | null;
              if (candidate?.kind === "vault.ok" && candidate.state === "locked") {
                onUnlockedChange?.(false);
                setState("locked");
                clearStrengthCache();
              } else setError("Could not lock the vault. Try again.");
            },
            () => setError("Could not lock the vault. Try again."),
          )
        }
      >
        Lock vault
      </Button>
    );
    const failure = error ? (
      <p className={styles.error} role="alert">
        {error}
      </p>
    ) : null;
    if (!securityControls)
      return (
        <section className={styles.panel}>
          <h2>Vault unlocked</h2>
          <p>ShardPass locks itself after the time below, or as soon as your screen locks.</p>
          {failure}
          {lockButton}
        </section>
      );
    // One card per thing a person changes: when it locks, the PIN, the master password. In a
    // single card those three stood as one column three times the height of its neighbours,
    // and the panel stretched every other card to match it.
    return (
      <>
        <section className={styles.panel} aria-labelledby="vault-locking-heading">
          <h2 id="vault-locking-heading">Vault unlocked</h2>
          <p>ShardPass locks itself after the time below, or as soon as your screen locks.</p>
          {settingsError !== "" ? (
            <p className={styles.loadingError} role="alert">
              {settingsError}
            </p>
          ) : null}
          {failure}
          <label>
            Lock the vault
            <select
              value={
                settings.lockWhenClosed === true ? "immediately" : String(settings.autoLockMinutes)
              }
              onChange={(event) => {
                const choice = event.target.value;
                if (choice === "immediately") {
                  void applyLockSettings({ ...settings, lockWhenClosed: true });
                  return;
                }
                const autoLockMinutes = Number(choice) as 0 | 5 | 15 | 30 | 60;
                void applyLockSettings({ ...settings, autoLockMinutes, lockWhenClosed: false });
              }}
            >
              <option value="immediately">When ShardPass closes</option>
              <option value="5">After 5 minutes</option>
              <option value="15">After 15 minutes</option>
              <option value="30">After 30 minutes</option>
              <option value="60">After 60 minutes</option>
              <option value="0">Never, until the browser closes</option>
            </select>
          </label>
          {settings.lockWhenClosed !== true && settings.autoLockMinutes === 0 ? (
            <p className={styles.weakNote} role="note">
              Until the browser closes, anyone at this computer can open your vault. Pick a timer
              unless this device is yours alone and always locked when you step away.
            </p>
          ) : null}
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
          {lockButton}
        </section>
        <section className={styles.panel} aria-labelledby="vault-pin-heading">
          <h2 id="vault-pin-heading">Unlock with a PIN</h2>
          <p>
            A PIN is shorter than your master password, so it only counts for this browser profile:
            after five wrong PINs it is removed and the master password is required again. Anyone
            with a copy of this profile could guess PINs offline, so use one only on a device that
            is yours. Changing the master password removes the PIN.
          </p>
          {pinError !== "" ? (
            <p className={styles.loadingError} role="alert">
              {pinError}
            </p>
          ) : null}
          {pinNotice !== "" ? (
            <p className={styles.working} role="status">
              {pinNotice}
            </p>
          ) : null}
          {pinAvailable ? (
            <div className={styles.pinRow}>
              <span>A PIN is set for this profile.</span>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void removePin()}
                disabled={working}
              >
                Remove PIN
              </Button>
            </div>
          ) : (
            <form
              className={styles.changePassword}
              onSubmit={(event) => {
                event.preventDefault();
                if (!working) void setPinForDevice();
              }}
            >
              <label>
                New PIN
                <PasswordInput
                  autoComplete="off"
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                />
              </label>
              <label>
                Confirm PIN
                <PasswordInput
                  autoComplete="off"
                  value={pinConfirmation}
                  onChange={(event) => setPinConfirmation(event.target.value)}
                />
              </label>
              <Button type="submit" loading={working}>
                Set PIN
              </Button>
            </form>
          )}
        </section>
        <section className={styles.panel} aria-labelledby="vault-password-heading">
          <h2 id="vault-password-heading">Change master password</h2>
          <p>
            The new password re-encrypts the vault on this device. Any PIN is removed with the old
            password, and other signed-in browsers ask for the new one.
          </p>
          {changeNotice !== "" ? (
            <p className={styles.working} role="status">
              {changeNotice}
            </p>
          ) : null}
          <form
            className={styles.changePassword}
            onSubmit={(event) => {
              event.preventDefault();
              if (!working) void rotatePassword();
            }}
          >
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
            <Button type="submit" variant="secondary" loading={working}>
              Change password
            </Button>
          </form>
        </section>
      </>
    );
  }
  const setup = state === "unconfigured";
  const strength: StrengthEstimate =
    refined?.password === password
      ? refined.estimate
      : { ...passwordStrength(password), source: "quick" };
  if (!setup && pinAvailable && pinMode) {
    return (
      <section className={styles.panel}>
        <h2>Unlock ShardPass</h2>
        <p>Enter your PIN.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!working) void unlockWithPin();
          }}
          className={styles.form}
        >
          <label>
            PIN
            <PasswordInput
              autoFocus
              autoComplete="off"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
            />
          </label>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" loading={working}>
            Unlock vault
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={working}
            onClick={() => {
              setError("");
              setPinMode(false);
            }}
          >
            Use master password instead
          </Button>
        </form>
      </section>
    );
  }
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
          // The length rule speaks first (from submit); the weak gate only for a long enough one.
          if (
            setup &&
            Array.from(password).length >= MIN_SETUP_PASSWORD_CODE_POINTS &&
            strength.level < 2 &&
            !weakAllowed
          ) {
            setError(
              "This password is weak. Tick the box to use it anyway, or choose a longer one.",
            );
            return;
          }
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
        {setup && password.length > 0 ? (
          <div className={styles.strength} role="status" aria-live="polite">
            <div className={styles.meter} aria-hidden="true">
              <span className={styles.meterFill} data-level={strength.level} />
            </div>
            <span className={styles.strengthLabel}>{strength.label}</span>
            {strength.advice !== undefined ? (
              <span className={styles.strengthAdvice}>{strength.advice}</span>
            ) : null}
          </div>
        ) : null}
        {setup &&
        password.length > 0 &&
        Array.from(password).length < MIN_SETUP_PASSWORD_CODE_POINTS ? (
          <p className={styles.weakNote}>
            {`Use at least ${MIN_SETUP_PASSWORD_CODE_POINTS} characters. A few unrelated words are easy to remember and hard to guess.`}
          </p>
        ) : null}
        {setup &&
        password.length > 0 &&
        Array.from(password).length >= MIN_SETUP_PASSWORD_CODE_POINTS &&
        strength.level < 2 ? (
          <>
            <p className={styles.weakNote}>
              This password is weak. Anyone who gets your vault file could crack it offline. A few
              unrelated words are both easier to remember and much stronger.
            </p>
            <label className={styles.checkField}>
              <input
                type="checkbox"
                checked={weakAllowed}
                onChange={(event) => setWeakAllowed(event.target.checked)}
              />
              Use this password anyway
            </label>
          </>
        ) : null}
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
        {retryAfterMs > 0 ? (
          <p className={styles.loadingError} role="alert">
            Too many attempts. Try again in {Math.ceil(retryAfterMs / 1_000)} s.
          </p>
        ) : null}
        <Button type="submit" loading={working} disabled={retryAfterMs > 0}>
          {setup ? "Create vault" : "Unlock vault"}
        </Button>
        {!setup && pinAvailable ? (
          <Button
            type="button"
            variant="ghost"
            disabled={working}
            onClick={() => {
              setError("");
              setPinMode(true);
            }}
          >
            Use PIN instead
          </Button>
        ) : null}
        {working ? (
          <p className={styles.working} role="status">
            Deriving your key on this device. It is never sent anywhere.
          </p>
        ) : null}
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
function errorCode(value: unknown): string | undefined {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { error?: { code?: unknown } }).error?.code === "string"
  )
    return (value as { error: { code: string } }).error.code;
  return undefined;
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
