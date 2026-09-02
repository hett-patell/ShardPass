import { AppHeader, Button, StatusBadge, type Status } from "@shardpass/ui";
import { useCallback, useState } from "react";

import { useFoundationStatus } from "../foundation/useFoundationStatus";
import type {
  BackupUiExtensionPlatform,
  EnteUiPlatform,
  ExtensionPlatform,
  OtpImportUiExtensionPlatform,
} from "../platform/extension-platform";
import styles from "./VaultApp.module.css";
import { VaultSidebar } from "./components/VaultSidebar";
import { EmptyVaultState } from "./components/EmptyVaultState";
import { VaultAccess } from "../vault-access/VaultAccess";
import { MigrationPanel } from "./migration/MigrationPanel";
import { OtpVaultView } from "./otp/OtpVaultView";
import { BackupView } from "./settings/BackupView";
import { EnteSettings } from "./ente/EnteSettings";

export interface VaultAppProps {
  platform: ExtensionPlatform &
    OtpImportUiExtensionPlatform &
    BackupUiExtensionPlatform &
    EnteUiPlatform;
}

function statusPresentation(state: "loading" | "ready" | "error"): {
  label: string;
  status: Status;
} {
  switch (state) {
    case "loading":
      return { label: "Checking foundation status", status: "neutral" };
    case "ready":
      return { label: "Foundation ready", status: "success" };
    case "error":
      return { label: "Foundation unavailable", status: "error" };
  }
}

export function VaultApp({ platform }: VaultAppProps) {
  const foundation = useFoundationStatus(platform);
  const presentation = statusPresentation(foundation.state);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [otpRefreshToken, setOtpRefreshToken] = useState(0);
  const handleImported = useCallback(() => setOtpRefreshToken((token) => token + 1), []);

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#vault-content">
        Skip to vault content
      </a>

      <AppHeader
        className={styles.header ?? ""}
        eyebrow="ENCRYPTED VAULT / FOUNDATION"
        title="ShardPass"
        actions={<StatusBadge status={presentation.status}>{presentation.label}</StatusBadge>}
      />

      <VaultSidebar foundation={foundation} />

      <main className={styles.main} id="vault-content" tabIndex={-1}>
        {!vaultUnlocked ? (
          <div className={styles.commandBar} role="search">
            <div className={styles.searchGroup}>
              <label className={styles.searchLabel} htmlFor="vault-search">
                <span className={styles.technicalLabel}>COMMAND / SEARCH</span>
                <span className={styles.searchControl}>
                  <span className={styles.searchGlyph} aria-hidden="true">
                    ⌕
                  </span>
                  <input
                    id="vault-search"
                    type="search"
                    aria-describedby="search-availability"
                    aria-label="Search vault"
                    placeholder="Search encrypted items"
                    disabled
                  />
                </span>
              </label>
              <span className={styles.searchAvailability} id="search-availability">
                Search is available after the vault is unlocked.
              </span>
            </div>
            <div className={styles.createGroup}>
              <Button
                className={styles.createButton}
                variant="secondary"
                disabled
                aria-describedby="create-availability"
              >
                Create item
              </Button>
              <span className={styles.createAvailability} id="create-availability">
                Item creation is available after the vault is unlocked.
              </span>
            </div>
          </div>
        ) : null}

        <div className={vaultUnlocked ? styles.unlockedWorkspace : styles.workspace}>
          {!vaultUnlocked ? (
            <section className={styles.listRegion} aria-labelledby="vault-items-heading">
              <header className={styles.regionHeader}>
                <div>
                  <p className={styles.technicalLabel}>INDEX / ALL</p>
                  <h2 id="vault-items-heading">Vault items</h2>
                </div>
                <span className={styles.regionCount}>0 AVAILABLE ITEMS</span>
              </header>
              <div className={styles.listPlaceholder} aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </section>
          ) : null}

          <section
            className={vaultUnlocked ? styles.unlockedRegion : styles.detailRegion}
            id="vault-details"
            aria-labelledby="vault-details-heading"
          >
            {!vaultUnlocked ? (
              <header className={styles.regionHeader}>
                <div>
                  <p className={styles.technicalLabel}>DETAIL / FOUNDATION</p>
                  <h2 id="vault-details-heading">Vault details</h2>
                </div>
                <span className={styles.regionCount}>NO ITEM SELECTED</span>
              </header>
            ) : (
              <h2 className={styles.visuallyHidden} id="vault-details-heading">
                Unlocked vault workspace
              </h2>
            )}
            {foundation.state === "ready" ? (
              <div className={vaultUnlocked ? styles.unlockedContent : styles.accessRegion}>
                {vaultUnlocked ? (
                  <OtpVaultView
                    platform={platform}
                    active
                    refreshToken={otpRefreshToken}
                    onImported={handleImported}
                  />
                ) : null}
                <section
                  className={vaultUnlocked ? styles.settingsRegion : styles.accessOnlyRegion}
                  aria-label={vaultUnlocked ? "Vault controls" : "Vault access"}
                >
                  {vaultUnlocked ? (
                    <header className={styles.settingsHeader}>
                      <p className={styles.technicalLabel}>VAULT / SECURITY &amp; MIGRATION</p>
                      <h2>Vault controls</h2>
                    </header>
                  ) : null}
                  <div className={vaultUnlocked ? styles.settingsContent : undefined}>
                    <VaultAccess
                      platform={platform}
                      securityControls
                      onUnlockedChange={setVaultUnlocked}
                    />
                    <EnteSettings platform={platform} active={vaultUnlocked} />
                    <MigrationPanel
                      platform={platform}
                      active={vaultUnlocked}
                      onCompleted={handleImported}
                    />
                    <BackupView
                      platform={platform}
                      active={vaultUnlocked}
                      onImported={handleImported}
                    />
                  </div>
                </section>
              </div>
            ) : (
              <EmptyVaultState foundation={foundation} />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
