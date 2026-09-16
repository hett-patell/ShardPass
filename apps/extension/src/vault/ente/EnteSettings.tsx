import { Button, PasswordInput } from "@shardpass/ui";
import { useEffect, useId, useRef, useState } from "react";

import type { EnteUiPlatform } from "../../platform/extension-platform";
import { formatWhen } from "../format-time";
import styles from "./EnteSettings.module.css";
import { useEnteSync } from "./useEnteSync";

export interface EnteSettingsProps {
  platform: EnteUiPlatform;
  active: boolean;
  /** After a sync that may have changed items; the page refreshes its list. */
  onSynced?: () => void;
}

export function EnteSettings({ platform, active, onSynced }: EnteSettingsProps) {
  const sync = useEnteSync({ platform, active, ...(onSynced === undefined ? {} : { onSynced }) });
  const [showCredentials, setShowCredentials] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [choices, setChoices] = useState<
    Record<number, "keep-local" | "keep-ente" | "keep-both" | undefined>
  >({});
  const connectButtonRef = useRef<HTMLButtonElement>(null);
  const conflictHelpId = useId();
  useEffect(() => {
    if (!sync.state.connected) setDisconnecting(false);
  }, [sync.state.connected]);
  if (!active) return null;

  const cancel = () => {
    setShowCredentials(false);
    setDisconnecting(false);
    sync.cancel();
    queueMicrotask(() => connectButtonRef.current?.focus());
  };
  const state = sync.state;
  const busy = [
    "connecting",
    "srp-checking",
    "initial-sync",
    "syncing",
    "syncing-reading",
    "syncing-writing",
  ].includes(state.state);

  return (
    <section
      className={styles.region}
      aria-labelledby="ente-settings-heading"
      onKeyDown={(event) => {
        if (event.key === "Escape") cancel();
      }}
    >
      <header className={styles.header}>
        <div>
          <h3 id="ente-settings-heading">Ente Authenticator sync</h3>
        </div>
        <span className={styles.scope}>{state.connected ? "CONNECTED" : "DISCONNECTED"}</span>
      </header>

      <p className={styles.boundary}>
        Only TOTP, HOTP, and Steam records synchronize with <strong>api.ente.io</strong>. ShardPass
        checks while unlocked after connection, restart, manual request, and every 15 minutes.
        Conflicting edits always require your explicit choice.
      </p>
      {sync.error ? (
        <p className={styles.error} role="alert">
          Ente sync could not complete. No partial result was applied. Reason:{" "}
          <code>{sync.errorCode ?? "not reported"}</code>.
        </p>
      ) : null}
      {!sync.error && state.lastFailure ? (
        <p className={styles.error} role="status">
          The last background sync failed {formatWhen(state.lastFailure.at).text}. Reason:{" "}
          <code>{state.lastFailure.code}</code>
          {state.lastFailure.detail ? <> — {state.lastFailure.detail}</> : null}. It is retried with
          a growing wait; Sync now tries at once.
        </p>
      ) : null}

      {(showCredentials && !state.connected && state.state !== "totp-required") ||
      state.state === "connecting" ? (
        <form
          className={styles.form}
          aria-label="Connect Ente"
          onSubmit={(event) => {
            event.preventDefault();
            sync.connect();
          }}
        >
          <h4>Email and password</h4>
          <label>
            Ente email
            <input ref={sync.emailRef} type="email" autoComplete="off" maxLength={320} required />
          </label>
          <label>
            Ente password
            <PasswordInput ref={sync.passwordRef} autoComplete="off" maxLength={1024} required />
          </label>
          <p className={styles.help}>
            {state.state === "connecting"
              ? "Unlocking your Ente account keys on this device. This takes up to a minute: Ente's key derivation is deliberately slow."
              : "Your Ente password stays on this device: it is used once to unlock your account keys, then cleared. Accounts protected only by a passkey or an email code cannot connect yet."}
          </p>
          <div className={styles.actions}>
            <Button type="submit">Continue securely</Button>
            <Button type="button" variant="secondary" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </form>
      ) : state.state === "totp-required" ? (
        <form
          className={styles.form}
          aria-label="Ente two-factor verification"
          onSubmit={(event) => {
            event.preventDefault();
            sync.submitTotp();
          }}
        >
          <h4>TOTP 2FA required</h4>
          <label>
            Ente two-factor code
            <input
              ref={sync.totpRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6,10}"
              maxLength={10}
              required
            />
          </label>
          <div className={styles.actions}>
            <Button type="submit">Verify code</Button>
            <Button type="button" variant="secondary" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </form>
      ) : disconnecting && state.connected ? (
        <section className={styles.confirmation} aria-labelledby="ente-disconnect-heading">
          <h4 id="ente-disconnect-heading">Disconnect Ente sync?</h4>
          <p>
            Disconnect is local-only. It removes Ente credentials, mappings, pending operations, and
            conflict metadata. It deletes no local or Ente OTP records and makes no network request.
          </p>
          <p>
            <strong>{state.pendingCount} pending</strong> ·{" "}
            <strong>{state.conflictCount} conflict</strong> ·{" "}
            <strong>
              {state.uncertainCount ??
                (state.state === "uncertain" || state.state === "uncertain-create" ? 1 : 0)}{" "}
              uncertain
            </strong>
          </p>
          <p>
            Disconnect cannot undo a possibly dispatched request or determine its remote outcome.
          </p>
          <div className={styles.actions}>
            <Button onClick={() => sync.disconnectConfirm()}>Confirm local disconnect</Button>
            <Button variant="secondary" onClick={cancel}>
              Keep connected
            </Button>
          </div>
        </section>
      ) : state.state === "disconnected" ? (
        <div className={styles.empty}>
          <h4>Disconnected</h4>
          <p>Connect an existing Ente account to begin an initial full OTP snapshot.</p>
          <Button ref={connectButtonRef} onClick={() => setShowCredentials(true)}>
            Connect Ente
          </Button>
        </div>
      ) : state.state === "legacy-review" ? (
        <State
          title="Legacy review required"
          copy="A migrated custom server or invalid legacy state is blocked. Only safe counts are available; disconnect locally to remove it."
        />
      ) : state.state === "srp-checking" ? (
        <State
          title="Checking SRP compatibility"
          copy="ShardPass is verifying the pinned Ente SRP-4096 path. No alternate login path is used."
          action={
            <Button variant="secondary" onClick={cancel}>
              Cancel
            </Button>
          }
        />
      ) : state.state === "initial-sync" ? (
        <State
          title="Connecting / initial full snapshot"
          copy="Reading bounded OTP metadata before any local activation."
          action={
            <Button variant="secondary" onClick={cancel}>
              Cancel
            </Button>
          }
        />
      ) : state.state === "syncing-reading" || state.state === "syncing" ? (
        <State
          title="Syncing: reading"
          copy="Reading bounded OTP changes. Cancellation is safe before writes begin."
          action={
            <Button variant="secondary" onClick={cancel}>
              Cancel
            </Button>
          }
        />
      ) : state.state === "syncing-committing" ? (
        <State
          title="Syncing: committing locally"
          copy="Activating one authenticated vault generation. Cancellation is disabled until activation finishes."
        />
      ) : state.state === "syncing-writing" ? (
        <State
          title="Syncing: writing"
          copy={`Writing ${state.writeCategory ?? "OTP"} changes. Canceling after dispatch may make the outcome uncertain.`}
          action={
            <Button variant="secondary" onClick={cancel}>
              Cancel and reconcile later
            </Button>
          }
        />
      ) : state.state === "offline" ? (
        <State
          title="Offline / retry later"
          copy="State is retained. Retry manually or wait for the next unlocked 15-minute trigger."
        />
      ) : state.state === "reauth-required" ? (
        <State
          title="Reauthentication required"
          copy="Pending intent is preserved and no writes run until SRP and any Ente TOTP challenge succeed."
          action={<Button onClick={sync.reauthenticate}>Reauthenticate</Button>}
        />
      ) : state.state === "conflict" ? (
        <div className={styles.conflicts}>
          <h4>Conflicts require review</h4>
          <p id={conflictHelpId}>
            No choice is preselected. Review the consequence for each option.
          </p>
          {(state.conflicts ?? []).map((conflict, index) => (
            <fieldset key={conflict.capability} className={styles.conflict}>
              <legend>Conflict {index + 1}</legend>
              {(
                [
                  [
                    "keep-local",
                    "Keep this device",
                    "Keep this device and replace the Ente version.",
                  ],
                  ["keep-ente", "Keep Ente", "Keep Ente and replace this device’s version."],
                  [
                    "keep-both",
                    "Keep both",
                    "Keep both creates a separate local OTP and preserves the Ente version.",
                  ],
                ] as const
              ).map(([value, label, copy]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={`conflict-${index}`}
                    value={value}
                    checked={choices[index] === value}
                    disabled={value === "keep-both" && !conflict.canKeepBoth}
                    aria-describedby={`${conflictHelpId}-choice-${index}-${value}`}
                    onChange={() => setChoices((current) => ({ ...current, [index]: value }))}
                  />
                  <span>
                    <strong>{label}</strong>
                    <small id={`${conflictHelpId}-choice-${index}-${value}`}>{copy}</small>
                  </span>
                </label>
              ))}
              <Button
                disabled={choices[index] === undefined}
                onClick={() => {
                  const choice = choices[index];
                  if (choice) sync.resolveConflict(conflict.capability, choice);
                }}
              >
                Apply explicit choice
              </Button>
            </fieldset>
          ))}
        </div>
      ) : state.state === "uncertain" ? (
        <State
          title="Uncertain write reconciling"
          copy="A complete remote snapshot is required before retry. Automatic retry is disabled."
        />
      ) : state.state === "uncertain-create" ? (
        <State
          title="Blocked uncertain create"
          copy="The create may already exist remotely. Retrying could duplicate it; review the conflict or disconnect locally."
        />
      ) : state.state === "limit-reached" ? (
        <State
          title="Limit reached / data invalid"
          copy="Sync stopped before partial application because bounded or canonical data validation failed."
        />
      ) : state.state === "blocked" ? (
        <State
          title="Protocol/dependency unsupported"
          copy="Sync failed closed because the pinned protocol or dependency graph is unsupported. No mutation is available."
        />
      ) : (
        <div className={styles.connected}>
          <h4>Connected</h4>
          <dl>
            <div>
              <dt>Account</dt>
              <dd>{state.maskedEmail ?? "Connected account"}</dd>
            </div>
            <div>
              <dt>Last successful sync</dt>
              <dd title={formatWhen(state.lastSuccessAt).title}>
                {formatWhen(state.lastSuccessAt).text}
              </dd>
            </div>
            <div>
              <dt>Next eligible run</dt>
              <dd title={formatWhen(state.nextEligibleAt).title}>
                {formatWhen(state.nextEligibleAt).text}
              </dd>
            </div>
            <div>
              <dt>Pending</dt>
              <dd>{state.pendingCount}</dd>
            </div>
            <div>
              <dt>Conflicts</dt>
              <dd>{state.conflictCount}</dd>
            </div>
          </dl>
          <div className={styles.actions}>
            <Button onClick={sync.manualSync} disabled={busy}>
              Sync now
            </Button>
            <Button variant="secondary" onClick={sync.reauthenticate}>
              Reauthenticate
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setDisconnecting(true);
                sync.disconnectPreview();
              }}
            >
              Disconnect
            </Button>
          </div>
        </div>
      )}
      {state.connected && !disconnecting && state.state !== "conflict" && state.state !== "idle" ? (
        <div className={styles.secondaryActions}>
          <Button
            variant="secondary"
            onClick={() => {
              setDisconnecting(true);
              sync.disconnectPreview();
            }}
          >
            Disconnect
          </Button>
        </div>
      ) : null}
      <p className={styles.live} role="status" aria-live="polite">
        {busy ? "Ente sync in progress." : ""}
      </p>
    </section>
  );
}

function State({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) {
  return (
    <div className={styles.state}>
      <h4>{title}</h4>
      <p>{copy}</p>
      {action}
    </div>
  );
}
