import { Button, Field } from "@shardpass/ui";
import { useEffect, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import styles from "./MigrationPanel.module.css";
import { useMigration, type DeriveLegacyKey } from "./useMigration";

export function MigrationPanel({
  platform,
  deriveKey,
  active,
  onCompleted,
}: Readonly<{
  platform: Pick<ExtensionPlatform, "sendMessage">;
  deriveKey?: DeriveLegacyKey;
  active: boolean;
  onCompleted?: () => void;
}>) {
  const [password, setPassword] = useState("");
  const { state, submit } = useMigration({
    platform,
    active,
    ...(deriveKey === undefined ? {} : { deriveKey }),
  });
  const working = ["deriving", "staging", "verifying", "activating"].includes(state.phase);

  useEffect(() => {
    if (!active) setPassword("");
  }, [active]);

  useEffect(() => {
    if (state.phase === "completed") onCompleted?.();
  }, [onCompleted, state.phase]);

  if (!active || state.phase === "loading" || state.phase === "unavailable") return null;

  const complete = state.phase === "completed";
  const failed = state.phase === "failed";
  return (
    <section className={styles.panel} aria-labelledby="migration-heading">
      <header className={styles.header}>
        <div>
          <h3 id="migration-heading">Migrate legacy vault</h3>
        </div>
        <span className={styles.phase}>{phaseLabel(state.phase)}</span>
      </header>

      <p className={styles.summary}>
        Move supported OTP items into the new encrypted vault. The original legacy vault and
        settings remain untouched.
      </p>

      <ol className={styles.steps} aria-label="Migration phases">
        <li data-active={state.phase === "ready" || state.phase === "deriving"}>AUTHORIZE</li>
        <li data-active={state.phase === "staging"}>STAGE</li>
        <li data-active={state.phase === "verifying"}>VERIFY</li>
        <li data-active={state.phase === "activating" || complete}>ACTIVATE</li>
      </ol>

      {complete ? (
        <div className={styles.statusRegion} role="status">
          <strong>Migration complete</strong>
          <span>{itemCountLabel(state.itemCount)}</span>
        </div>
      ) : (
        <>
          {failed ? (
            <div className={styles.errorRegion} role="alert">
              <strong>Migration could not continue safely</strong>
              <span>Retry from this trusted vault page, or keep the legacy data for export.</span>
            </div>
          ) : (
            <div className={styles.statusRegion} role="status" aria-live="polite">
              <strong>{phaseLabel(state.phase)}</strong>
              <span>
                {working ? "Keep this vault page open." : "Ready for local authorization."}
              </span>
            </div>
          )}
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              const submitted = password;
              setPassword("");
              void submit(submitted);
            }}
          >
            <Field
              id="legacy-migration-password"
              label="Legacy password"
              help="Used only on this trusted page and its dedicated PBKDF2 worker."
              inputProps={{
                type: "password",
                autoComplete: "current-password",
                value: password,
                disabled: working,
                onChange: (event) => setPassword(event.target.value),
              }}
            />
            <Button type="submit" loading={working} disabled={password.length === 0}>
              {failed ? "Retry migration" : "Begin migration"}
            </Button>
          </form>
        </>
      )}

      <dl className={styles.compatibility}>
        <div>
          <dt>DERIVATION</dt>
          <dd>PBKDF2-HMAC-SHA-256 / 600,000</dd>
        </div>
        <div>
          <dt>STEAM</dt>
          <dd>static-inference-only; runtime parity is not claimed</dd>
        </div>
      </dl>
    </section>
  );
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case "ready":
      return "Ready to migrate";
    case "deriving":
      return "Deriving legacy key";
    case "staging":
      return "Staging encrypted items";
    case "verifying":
      return "Verifying migrated items";
    case "activating":
      return "Activating migrated vault";
    case "completed":
      return "Migration complete";
    case "failed":
      return "Retry required";
    default:
      return "Checking migration";
  }
}

function itemCountLabel(count: number): string {
  return `${count} OTP ${count === 1 ? "item" : "items"} migrated`;
}
