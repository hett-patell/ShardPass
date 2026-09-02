import type { FoundationStatusState } from "../../foundation/useFoundationStatus";
import styles from "./EmptyVaultState.module.css";

export interface EmptyVaultStateProps {
  foundation: FoundationStatusState;
}

const safeFoundationError =
  "ShardPass couldn’t confirm its foundation status. Reload the vault to try again.";

/** Shown while the extension's foundation status is loading or unavailable, before the vault can be reached at all. */
export function EmptyVaultState({ foundation }: EmptyVaultStateProps) {
  return (
    <div className={styles.state}>
      <p className={styles.eyebrow}>Foundation</p>
      <h2>
        {foundation.state === "loading"
          ? "Checking the vault foundation…"
          : "The vault foundation is unavailable."}
      </h2>
      <p>
        ShardPass verifies its runtime foundation before the encrypted vault can be unlocked. No
        vault items are stored, listed, or decrypted during this check.
      </p>
      {foundation.state === "error" ? (
        <p className={styles.error} role="alert">
          {safeFoundationError}
        </p>
      ) : null}
    </div>
  );
}
