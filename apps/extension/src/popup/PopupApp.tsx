import { SearchBar } from "@shardpass/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import type { EnteUiPlatform, ExtensionPlatform } from "../platform/extension-platform";
import { VaultAccess } from "../vault-access/VaultAccess";
import { AddItemMenu } from "./components/AddItemMenu";
import { FilterTabs } from "./components/FilterTabs";
import { PopupHeader } from "./components/PopupHeader";
import { PopupItemList } from "./components/PopupItemList";
import { useVaultItems } from "./hooks/useVaultItems";
import styles from "./PopupApp.module.css";

export interface PopupAppProps {
  platform: ExtensionPlatform & Partial<EnteUiPlatform>;
}

const safeVaultError = "The vault could not be opened. Try again.";
const safeLockError = "The vault could not be locked. Try again.";

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
  // VaultAccess stays mounted at all times (just visually hidden once unlocked) so its
  // live vault-state port subscription keeps running — that is what lets the popup
  // notice an out-of-band lock (auto-lock, a lock triggered from the vault tab, etc.)
  // and fall back to the lock screen immediately, matching the previous popup's pattern.
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [lockError, setLockError] = useState(false);
  const vaultItems = useVaultItems(platform, vaultUnlocked);
  const { actionError, openVault } = useOpenVaultAction(platform);

  const lock = useCallback(async (): Promise<void> => {
    setLockError(false);
    try {
      await platform.sendMessage({ version: 1, kind: "vault.lock" });
    } catch {
      setLockError(true);
    } finally {
      setVaultUnlocked(false);
    }
  }, [platform]);

  return (
    <div className={styles.popup}>
      <div hidden={vaultUnlocked}>
        <VaultAccess platform={platform} onUnlockedChange={setVaultUnlocked} />
      </div>
      {vaultUnlocked ? (
        <>
          <PopupHeader onLock={() => void lock()} onSettings={() => void openVault()} />
          {actionError ? (
            <p className={styles.actionError} role="alert">
              {safeVaultError}
            </p>
          ) : null}
          {lockError ? (
            <p className={styles.actionError} role="alert">
              {safeLockError}
            </p>
          ) : null}
          <div className={styles.searchRow}>
            <SearchBar
              value={vaultItems.search}
              onChange={(value) => vaultItems.setSearch(value)}
              placeholder="Search items"
            />
          </div>
          <FilterTabs
            active={vaultItems.filter}
            onChange={(filter) => vaultItems.setFilter(filter)}
          />
          <PopupItemList items={vaultItems.items} status={vaultItems.status} platform={platform} />
          <AddItemMenu platform={platform} />
        </>
      ) : null}
    </div>
  );
}
