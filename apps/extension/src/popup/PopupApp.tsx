import type { LoginItem, VaultItemKind } from "@shardpass/domain";
import { matchLoginUrls, type UrlMatchMode } from "@shardpass/autofill";
import { parseLoginFillResponseForRequest, type ItemListItemProjection } from "@shardpass/messaging";
import { useCallback, useEffect, useRef, useState } from "react";

import type { EnteUiPlatform, ExtensionPlatform } from "../platform/extension-platform";
import { clearClipboardNow } from "../vault/components/detail/clipboard";
import { VaultAccess } from "../vault-access/VaultAccess";
import { PopupTitleBar } from "./components/PopupTitleBar";
import { useActiveTab } from "./hooks/useActiveTab";
import { useCopy } from "./hooks/useClipboard";
import { useFillIntoTab } from "./hooks/useFillIntoTab";
import { itemsInCategory, useVaultItems, type CategoryId } from "./hooks/useVaultItems";
import { DetailScreen } from "./screens/DetailScreen";
import { CATEGORY_TITLES, HomeScreen } from "./screens/HomeScreen";
import { ListScreen } from "./screens/ListScreen";
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
      if (mounted.current && token === invocationToken.current) setActionError(true);
    } finally {
      if (mounted.current && token === invocationToken.current) setOpeningVault(false);
    }
  }, [platform]);

  return { actionError, openingVault, openVault } as const;
}

type Screen =
  | { kind: "home" }
  | { kind: "list"; category: CategoryId }
  | { kind: "detail"; itemId: string; name: string; kindOf: VaultItemKind; urls?: readonly string[]; urlMatches?: readonly UrlMatchMode[] };

/**
 * The popup: a stack of screens over the unlocked vault. Home shows suggestions for the open
 * tab and the categories; a category pushes its list; an item pushes its detail. The unlock
 * screen stays mounted (hidden) so its state port keeps reporting an out-of-band lock.
 */
export function PopupApp({ platform }: PopupAppProps) {
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [lockError, setLockError] = useState(false);
  const [stack, setStack] = useState<Screen[]>([{ kind: "home" }]);
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState("");
  const [direction, setDirection] = useState<"push" | "pop">("push");
  const vaultItems = useVaultItems(platform, vaultUnlocked);
  const tab = useActiveTab(platform);
  const { actionError, openVault } = useOpenVaultAction(platform);
  const copy = useCopy(platform, setFeedback);
  const { fill, filling } = useFillIntoTab(platform, tab);

  const screen = stack[stack.length - 1] ?? { kind: "home" };
  const push = useCallback((next: Screen) => {
    setDirection("push");
    setStack((current) => [...current, next]);
  }, []);
  const pop = useCallback(() => {
    setDirection("pop");
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }, []);

  useEffect(() => {
    if (!vaultUnlocked) {
      setStack([{ kind: "home" }]);
      setSearch("");
      setFeedback("");
    }
  }, [vaultUnlocked]);

  const lock = useCallback(async (): Promise<void> => {
    setLockError(false);
    void clearClipboardNow();
    try {
      await platform.sendMessage({ version: 1, kind: "vault.lock" });
    } catch {
      setLockError(true);
    } finally {
      setVaultUnlocked(false);
    }
  }, [platform]);

  const openItem = useCallback(
    (item: ItemListItemProjection) =>
      push({
        kind: "detail",
        itemId: item.id,
        name: item.name,
        kindOf: item.kind,
        ...(item.urls === undefined ? {} : { urls: item.urls }),
        ...(item.urlMatches === undefined ? {} : { urlMatches: item.urlMatches }),
      }),
    [push],
  );

  const copyPassword = useCallback(
    (item: ItemListItemProjection) => {
      const request = { version: 1 as const, kind: "login.reveal" as const, itemId: item.id, expectedRevision: item.revision };
      void copy(
        platform.sendMessage(request).then((candidate) => {
          const parsed = parseLoginFillResponseForRequest(request, candidate);
          if (!parsed.success || parsed.data.kind !== "login.fillRelease") throw new Error("password unavailable");
          return parsed.data.password;
        }),
        "Password",
      );
    },
    [copy, platform],
  );

  const fillItem = useCallback(
    async (itemId: string, expectedRevision: number) => {
      const outcome = await fill(itemId, expectedRevision);
      if (outcome === "filled") {
        setFeedback("Filled");
        window.close();
      } else setFeedback(outcome === "no-form" ? "No login form found on this page." : "Could not fill. Try again.");
    },
    [fill],
  );

  const detailMatches = (candidate: Extract<Screen, { kind: "detail" }>): boolean =>
    tab !== null && candidate.urls !== undefined && matchLoginUrls(tab.url, candidate.urls, candidate.urlMatches);

  return (
    <div className={styles.popup}>
      <div className={styles.vaultAccessWrapper} hidden={vaultUnlocked}>
        <VaultAccess platform={platform} onUnlockedChange={setVaultUnlocked} />
      </div>
      {vaultUnlocked ? (
        <>
          <PopupTitleBar
            {...(screen.kind === "home"
              ? { onLock: () => void lock(), onSettings: () => void openVault() }
              : {
                  back: { label: "Back", onBack: pop },
                  title: screen.kind === "list" ? CATEGORY_TITLES[screen.category] : screen.name,
                })}
          />
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

          <div key={`${screen.kind}-${stack.length}`} className={`${styles.screen} ${direction === "push" ? styles.enterRight : styles.enterLeft}`}>
            {screen.kind === "home" ? (
              <HomeScreen
                items={vaultItems.items}
                status={vaultItems.status}
                tab={tab}
                search={search}
                onSearch={setSearch}
                onOpenCategory={(category) => push({ kind: "list", category })}
                onOpenItem={openItem}
                onFill={(item) => void fillItem(item.id, item.revision)}
                filling={filling}
                onCopyPassword={copyPassword}
                onOpenVault={() => void openVault()}
                onNewItem={() => void openVault()}
                platform={platform}
              />
            ) : screen.kind === "list" ? (
              <ListScreen
                items={itemsInCategory(vaultItems.items, screen.category)}
                emptyText={
                  screen.category === "favorites" ? "Nothing marked as a favourite yet." : `No ${CATEGORY_TITLES[screen.category].toLowerCase()} yet.`
                }
                platform={platform}
                onOpenItem={openItem}
                onCopyPassword={copyPassword}
                onCopyCode={(_item, code) => void copy(code, "Code")}
              />
            ) : (
              <DetailScreen
                itemId={screen.itemId}
                platform={platform}
                tab={tab}
                tabMatches={detailMatches(screen)}
                filling={filling === screen.itemId}
                onFill={(item: LoginItem) => void fillItem(item.id, item.revision)}
                onCopy={(value, label) => void copy(value, label)}
                onOpenVault={() => void openVault()}
              />
            )}
          </div>

          <p className={styles.feedback} role="status" aria-live="polite">
            {feedback}
          </p>
        </>
      ) : null}
    </div>
  );
}
