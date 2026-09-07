import type { LoginItem, VaultItemKind } from "@shardpass/domain";
import { matchLoginUrls, type UrlMatchMode } from "@shardpass/autofill";
import { parseLoginFillResponseForRequest, type ItemListItemProjection } from "@shardpass/messaging";
import { useCallback, useEffect, useRef, useState } from "react";

import type { EnteUiPlatform, ExtensionPlatform } from "../platform/extension-platform";
import type { VaultPageTarget } from "../platform/vault-route";
import { clearClipboardNow } from "../vault/components/detail/clipboard";
import { VaultAccess } from "../vault-access/VaultAccess";
import { PopupTitleBar } from "./components/PopupTitleBar";
import { useActiveTab } from "./hooks/useActiveTab";
import { useCopy } from "./hooks/useClipboard";
import { useFillIntoTab } from "./hooks/useFillIntoTab";
import { itemsInCategory, useVaultItems, type CategoryId } from "./hooks/useVaultItems";
import { DetailScreen } from "./screens/DetailScreen";
import { GeneratorScreen } from "./screens/GeneratorScreen";
import { CATEGORY_EMPTY, CATEGORY_TITLES, HomeScreen } from "./screens/HomeScreen";
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

  const openVault = useCallback(
    async (target?: VaultPageTarget): Promise<void> => {
    const token = ++invocationToken.current;
    setActionError(false);
    setOpeningVault(true);
    try {
      await platform.openVaultPage(target);
    } catch {
      if (mounted.current && token === invocationToken.current) setActionError(true);
    } finally {
      if (mounted.current && token === invocationToken.current) setOpeningVault(false);
    }
    },
    [platform],
  );

  return { actionError, openingVault, openVault } as const;
}

type Screen =
  | { kind: "home" }
  | { kind: "list"; category: CategoryId }
  | { kind: "generator" }
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
  const [feedbackTick, setFeedbackTick] = useState(0);
  const notify = useCallback((message: string) => {
    setFeedback(message);
    setFeedbackTick((tick) => tick + 1);
  }, []);
  const [direction, setDirection] = useState<"push" | "pop">("push");
  const vaultItems = useVaultItems(platform, vaultUnlocked);
  const tab = useActiveTab(platform);
  const { actionError, openVault } = useOpenVaultAction(platform);
  const copy = useCopy(platform, notify);
  const { fill, filling } = useFillIntoTab(platform, tab);

  const screen = stack[stack.length - 1] ?? { kind: "home" };
  const push = useCallback((next: Screen) => {
    setDirection("push");
    setStack((current) => [...current, next]);
  }, []);
  const pop = useCallback(() => {
    setFeedback("");
    setDirection("pop");
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }, []);

  // Feedback is a moment, not a fixture: it fades after a beat so "Password copied" from
  // earlier is not still standing when the next thing goes wrong.
  useEffect(() => {
    if (feedback === "") return;
    const timer = setTimeout(() => setFeedback(""), 2_500);
    return () => clearTimeout(timer);
  }, [feedback, feedbackTick]);

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
    // Only a confirmed lock leaves the unlocked UI; a failed one stays here with the
    // message, rather than dropping onto a lock screen that still says "unlocked".
    try {
      await platform.sendMessage({ version: 1, kind: "vault.lock" });
      setVaultUnlocked(false);
    } catch {
      setLockError(true);
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
      const reveal = platform.sendMessage(request).then((candidate) => {
        const parsed = parseLoginFillResponseForRequest(request, candidate);
        if (!parsed.success || parsed.data.kind !== "login.fillRelease") throw new Error("password unavailable");
        return parsed.data.password;
      });
      // A refused reveal (locked meanwhile, stale item) is not a clipboard problem.
      reveal.then(
        () => void copy(reveal, "Password"),
        () => notify("Password unavailable. Unlock and try again."),
      );
    },
    [copy, platform],
  );

  const fillItem = useCallback(
    async (itemId: string, expectedRevision: number) => {
      const outcome = await fill(itemId, expectedRevision);
      if (outcome === "filled") {
        window.close();
        return;
      }
      notify(
        outcome === "no-form"
          ? "No login form found on this page."
          : outcome === "no-script"
            ? "Reload the page, then try again."
            : "Could not fill. Try again.",
      );
    },
    [fill, notify],
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
              ? { onLock: () => void lock(), onSettings: () => void openVault({ view: "settings" }) }
              : {
                  back: { label: "Back", onBack: pop },
                  title:
                    screen.kind === "list" ? CATEGORY_TITLES[screen.category] : screen.kind === "generator" ? "Generate password" : screen.name,
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
                onRetry={() => vaultItems.refresh()}
                onCopyCode={(_item, code) => void copy(code, "Code")}
                onImport={() => void openVault({ view: "import" })}
                onNewItem={(kind) => void openVault({ newItem: kind })}
                onGenerate={() => push({ kind: "generator" })}
                platform={platform}
              />
            ) : screen.kind === "list" ? (
              <ListScreen
                items={itemsInCategory(vaultItems.items, screen.category)}
                emptyText={CATEGORY_EMPTY[screen.category]}
                platform={platform}
                onOpenItem={openItem}
                onCopyPassword={copyPassword}
                onCopyCode={(_item, code) => void copy(code, "Code")}
              />
            ) : screen.kind === "generator" ? (
              <GeneratorScreen platform={platform} onCopy={(value, label) => void copy(value, label)} />
            ) : (
              <DetailScreen
                itemId={screen.itemId}
                platform={platform}
                tab={tab}
                tabMatches={detailMatches(screen)}
                filling={filling === screen.itemId}
                onFill={(item: LoginItem) => void fillItem(item.id, item.revision)}
                onCopy={(value, label) => void copy(value, label)}
                onOpenVault={() => void openVault({ item: screen.itemId })}
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
