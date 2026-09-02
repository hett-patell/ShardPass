import { AppHeader, Button, StatusBadge, type Status } from "@shardpass/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import type { EnteUiPlatform, ExtensionPlatform } from "../platform/extension-platform";
import styles from "./PopupApp.module.css";
import { useFoundationStatus } from "../foundation/useFoundationStatus";
import { VaultAccess } from "../vault-access/VaultAccess";
import { OtpList } from "./otp/OtpList";

export interface PopupAppProps {
  platform: ExtensionPlatform & Partial<EnteUiPlatform>;
}

const safeStatusError =
  "ShardPass couldn’t confirm its foundation status. Try reopening the popup.";
const safeVaultError = "The vault could not be opened. Try again.";

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

export function useOpenVaultAction(platform: ExtensionPlatform) {
  const [actionError, setActionError] = useState(false);
  const [openingVault, setOpeningVault] = useState(false);
  const mounted = useRef(true);
  const invocationToken = useRef(0);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      invocationToken.current += 1;
    };
  }, []);

  const openVault = useCallback(async (): Promise<void> => {
    const token = ++invocationToken.current;
    setActionError(false);
    setOpeningVault(true);

    try {
      await platform.openVaultPage();
    } catch {
      if (mounted.current && token === invocationToken.current) {
        setActionError(true);
      }
    } finally {
      if (mounted.current && token === invocationToken.current) {
        setOpeningVault(false);
      }
    }
  }, [platform]);

  return { actionError, openingVault, openVault } as const;
}

export function PopupApp({ platform }: PopupAppProps) {
  const foundation = useFoundationStatus(platform);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [enteConnected, setEnteConnected] = useState<boolean | null>(null);
  const { actionError, openingVault, openVault } = useOpenVaultAction(platform);

  useEffect(() => {
    let active = true;
    if (platform.sendEnteMessage === undefined)
      return () => {
        active = false;
      };
    void platform
      .sendEnteMessage({ version: 1, kind: "ente.status" })
      .then((state) => {
        if (active) setEnteConnected(state.connected);
      })
      .catch(() => {
        if (active) setEnteConnected(null);
      });
    return () => {
      active = false;
    };
  }, [platform]);
  const presentation = statusPresentation(foundation.state);

  return (
    <div className={styles.shell}>
      <AppHeader className={styles.header ?? ""} eyebrow="FOUNDATION" title="ShardPass" />
      <main className={styles.main}>
        <section className={styles.statusSection} aria-labelledby="foundation-heading">
          <div className={styles.sectionHeading}>
            <p className={styles.kicker}>SECURITY BASELINE</p>
            <StatusBadge status={presentation.status}>{presentation.label}</StatusBadge>
          </div>

          {foundation.state === "loading" ? (
            <div className={styles.skeleton} data-testid="foundation-skeleton" aria-hidden="true">
              <span className={styles.skeletonTitle} />
              <span className={styles.skeletonLine} />
              <span className={styles.skeletonLineShort} />
            </div>
          ) : foundation.state === "ready" ? (
            <VaultAccess platform={platform} onUnlockedChange={setVaultUnlocked} />
          ) : null}

          {foundation.state === "error" ? (
            <p className={styles.error} role="alert">
              {safeStatusError}
            </p>
          ) : null}
        </section>

        <OtpList platform={platform} active={foundation.state === "ready" && vaultUnlocked} />

        <section className={styles.statusSection} aria-labelledby="ente-summary-heading">
          <div className={styles.sectionHeading}>
            <p className={styles.kicker} id="ente-summary-heading">
              ENTE OTP SYNC
            </p>
            <span>
              {enteConnected === true
                ? "Connected"
                : enteConnected === false
                  ? "Disconnected"
                  : "Unavailable"}
            </span>
          </div>
          <Button variant="secondary" onClick={() => void openVault()} loading={openingVault}>
            Open vault settings
          </Button>
        </section>

        <div className={styles.footer}>
          <p className={styles.boundaryCopy}>
            Password derivation stays in a trusted extension Worker. OTP editing stays in the vault.
          </p>
          <Button
            className={styles.primaryAction}
            disabled={foundation.state === "loading"}
            loading={openingVault}
            onClick={() => void openVault()}
          >
            Open vault
          </Button>
          {actionError ? (
            <p className={styles.actionError} role="alert">
              {safeVaultError}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
