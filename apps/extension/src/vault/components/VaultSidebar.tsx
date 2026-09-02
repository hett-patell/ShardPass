import type { FoundationStatusState } from "../../foundation/useFoundationStatus";
import styles from "../VaultApp.module.css";

export interface VaultSidebarProps {
  foundation: FoundationStatusState;
}

function statusLabel(state: FoundationStatusState["state"]): string {
  switch (state) {
    case "loading":
      return "Checking foundation";
    case "ready":
      return "Foundation ready";
    case "error":
      return "Foundation unavailable";
  }
}

export function VaultSidebar({ foundation }: VaultSidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <nav className={styles.navigation} aria-label="Vault navigation">
        <p className={styles.navLabel}>VAULT</p>
        <a className={styles.navItem} href="#vault-details" aria-current="page">
          <span aria-hidden="true" className={styles.navGlyph}>
            ◫
          </span>
          <span>All items</span>
          <span className={styles.navCount}>00</span>
        </a>
        <div className={styles.navFuture} aria-disabled="true">
          <span aria-hidden="true" className={styles.navGlyph}>
            ☆
          </span>
          <span>Favorites</span>
          <span className={styles.navMeta}>LATER</span>
        </div>
      </nav>

      <div className={styles.sidebarStatus}>
        <p className={styles.navLabel}>RUNTIME</p>
        <p className={styles.runtimeState}>
          <span className={styles.runtimeDot} data-state={foundation.state} aria-hidden="true" />
          {statusLabel(foundation.state)}
        </p>
        <p className={styles.runtimeBoundary}>No secrets active</p>
      </div>
    </aside>
  );
}
