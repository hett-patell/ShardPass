import type { FoundationStatusState } from "../../foundation/useFoundationStatus";
import styles from "./EmptyVaultState.module.css";

export interface EmptyVaultStateProps {
  foundation: FoundationStatusState;
}

const safeFoundationError =
  "ShardPass can’t reach its background service. Reload the extension and try again.";

/** Shown while the extension's foundation status is loading or unavailable, before the vault can be reached at all. */
export function EmptyVaultState({ foundation }: EmptyVaultStateProps) {
  return (
    <div className={styles.state}>
      <h2>
        {foundation.state === "loading" ? "Starting up…" : "The background service is unavailable."}
      </h2>
      <p>
        ShardPass checks that its background service is running before the vault can be unlocked.
        Nothing is decrypted during this check.
      </p>
      {foundation.state === "error" ? (
        <p className={styles.error} role="alert">
          {safeFoundationError}
        </p>
      ) : null}
    </div>
  );
}
