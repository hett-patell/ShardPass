import type { FoundationStatusState } from "../../foundation/useFoundationStatus";
import styles from "../VaultApp.module.css";

export interface EmptyVaultStateProps {
  foundation: FoundationStatusState;
}

const safeFoundationError =
  "ShardPass couldn’t confirm its foundation status. Reload the vault to try again.";

export function EmptyVaultState({ foundation }: EmptyVaultStateProps) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIndex} aria-hidden="true">
        00
      </div>
      <div className={styles.emptyCopy}>
        <p className={styles.technicalLabel}>FOUNDATION / LOCAL VAULT</p>
        <h2>Encrypted vault capabilities are being prepared.</h2>
        <p>
          This workspace will support encrypted items, search, and item details in a later project.
          No vault items are stored, listed, or decrypted by this foundation screen.
        </p>

        {foundation.state === "error" ? (
          <p className={styles.error} role="alert">
            {safeFoundationError}
          </p>
        ) : null}
      </div>

      <dl className={styles.capabilityList} aria-label="Planned encrypted vault capabilities">
        <div>
          <dt>ENCRYPTION</dt>
          <dd>Preparation pending</dd>
        </div>
        <div>
          <dt>ITEM INDEX</dt>
          <dd>Not connected</dd>
        </div>
        <div>
          <dt>LOCAL DATA</dt>
          <dd>None handled</dd>
        </div>
      </dl>
    </div>
  );
}
