import type { CardItem, IdentityItem, LoginItem, VaultItemKind } from "@shardpass/domain";
import { matchLoginUrls, type UrlMatchMode } from "@shardpass/autofill";
import {
  parseLoginFillResponseForRequest,
  type ItemListItemProjection,
} from "@shardpass/messaging";
import { useCallback, useEffect, useRef, useState } from "react";

import type { EnteUiPlatform, ExtensionPlatform } from "../platform/extension-platform";
import type { VaultPageTarget } from "../platform/vault-route";
import { clearClipboardNow } from "../vault/components/detail/clipboard";
import { RepromptPrompt } from "../vault-access/RepromptPrompt";
import { VaultAccess } from "../vault-access/VaultAccess";
import { PopupTitleBar } from "./components/PopupTitleBar";
import { useActiveTab } from "./hooks/useActiveTab";
import { useCopy } from "./hooks/useClipboard";
import { useFillDataIntoTab } from "./hooks/useFillDataIntoTab";
import { useFillIntoTab } from "./hooks/useFillIntoTab";
import { itemsInCategory, useVaultItems, type CategoryId } from "./hooks/useVaultItems";
import { DetailScreen } from "./screens/DetailScreen";
import { GeneratorScreen } from "./screens/GeneratorScreen";
import { IdentityScreen } from "./screens/IdentityScreen";
import { CATEGORY_EMPTY, CATEGORY_TITLES, HomeScreen } from "./screens/HomeScreen";
import { ListScreen } from "./screens/ListScreen";
import styles from "./PopupApp.module.css";

export interface PopupAppProps {
  platform: ExtensionPlatform & Partial<EnteUiPlatform>;
}

const PINNED_IDENTITY_KEY = "shardpass:popup:pinnedIdentity";
const LAST_SCREEN_KEY = "shardpass:popup:lastScreen";
/** How long a closed popup remembers where it was; a later open starts at home. */
const LAST_SCREEN_TTL_MS = 5 * 60_000;

type RememberedScreen = Readonly<{
  at: number;
  screen: { kind: "list"; category: CategoryId } | { kind: "generator" } | { kind: "identity" };
}>;

/** The screen a popup closed on moments ago: reopening lands back there, like a window would. */
function readLastScreen(): RememberedScreen["screen"] | null {
  try {
    const raw = globalThis.localStorage?.getItem(LAST_SCREEN_KEY);
    if (raw === null || raw === undefined) return null;
    const parsed = JSON.parse(raw) as RememberedScreen;
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > LAST_SCREEN_TTL_MS) return null;
    const screen = parsed.screen;
    if (screen.kind === "list" && typeof screen.category === "string") return screen;
    if (screen.kind === "generator" || screen.kind === "identity") return { kind: screen.kind };
    return null;
  } catch {
    return null;
  }
}
function writeLastScreen(screen: RememberedScreen["screen"] | null): void {
  try {
    if (screen === null) globalThis.localStorage?.removeItem(LAST_SCREEN_KEY);
    else
      globalThis.localStorage?.setItem(LAST_SCREEN_KEY, JSON.stringify({ at: Date.now(), screen }));
  } catch {
    // Forgetting where the popup was is harmless.
  }
}

/** The pinned identity's id: a preference, not a secret, so plain page storage will do. */
function readPinnedIdentity(): string | null {
  try {
    return globalThis.localStorage?.getItem(PINNED_IDENTITY_KEY) ?? null;
  } catch {
    return null;
  }
}
function writePinnedIdentity(id: string): void {
  try {
    globalThis.localStorage?.setItem(PINNED_IDENTITY_KEY, id);
  } catch {
    // A refused write only means the choice does not outlive this popup.
  }
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
  | { kind: "identity" }
  | {
      kind: "detail";
      itemId: string;
      name: string;
      kindOf: VaultItemKind;
      urls?: readonly string[];
      urlMatches?: readonly UrlMatchMode[];
    };

/**
 * The popup: a stack of screens over the unlocked vault. Home shows suggestions for the open
 * tab and the categories; a category pushes its list; an item pushes its detail. The unlock
 * screen stays mounted (hidden) so its state port keeps reporting an out-of-band lock.
 */
/** The background's answer to vault.lock when the vault is now locked. */
function confirmsLocked(reply: unknown): boolean {
  const candidate = reply as { kind?: unknown; state?: unknown } | null;
  return candidate?.kind === "vault.ok" && candidate.state === "locked";
}

export function PopupApp({ platform }: PopupAppProps) {
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [lockError, setLockError] = useState(false);
  // An item that asks for the master password again: what to run once it has been given.
  // The background remembers a grant for a few minutes; this set avoids asking twice here.
  const [reprompt, setReprompt] = useState<Readonly<{
    itemId: string;
    action: string;
    run: () => void;
  }> | null>(null);
  const grantedRef = useRef(new Set<string>());
  const withReprompt = useCallback(
    (
      item: Readonly<{ id: string; reprompt?: boolean | undefined }>,
      action: string,
      run: () => void,
    ) => {
      if (item.reprompt === true && !grantedRef.current.has(item.id))
        setReprompt({ itemId: item.id, action, run });
      else run();
    },
    [],
  );
  const [stack, setStack] = useState<Screen[]>([{ kind: "home" }]);
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackTick, setFeedbackTick] = useState(0);
  const [pinnedIdentityId, setPinnedIdentityId] = useState<string | null>(readPinnedIdentity);
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
  const { fill: fillData, filling: fillingData } = useFillDataIntoTab(platform, tab);
  const fillDataItem = useCallback(
    async (item: CardItem | IdentityItem) => {
      const outcome = await fillData(item.id);
      if (outcome === "filled") {
        window.close();
        return;
      }
      notify(
        outcome === "no-form"
          ? `No ${item.kind === "card" ? "card" : "address"} fields found on this page.`
          : outcome === "no-tab"
            ? "This page can't be filled."
            : outcome === "no-script"
              ? "Reload the page, then try again."
              : outcome === "reprompt"
                ? "Enter your master password for this item first."
                : "Could not fill. Try again.",
      );
    },
    [fillData, notify],
  );

  const screen = stack[stack.length - 1] ?? { kind: "home" };
  // Lists, the generator and the identity chooser are remembered for a few minutes; a detail
  // screen is not (its item may be gone, and it may show a secret).
  useEffect(() => {
    if (!vaultUnlocked) return;
    writeLastScreen(
      screen.kind === "list"
        ? { kind: "list", category: screen.category }
        : screen.kind === "generator" || screen.kind === "identity"
          ? { kind: screen.kind }
          : null,
    );
  }, [screen, vaultUnlocked]);
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

  const restored = useRef(false);
  useEffect(() => {
    if (!vaultUnlocked) {
      setStack([{ kind: "home" }]);
      setSearch("");
      setFeedback("");
      return;
    }
    if (restored.current) return;
    restored.current = true;
    const last = readLastScreen();
    if (last !== null) setStack([{ kind: "home" }, last]);
  }, [vaultUnlocked]);

  const lock = useCallback(async (): Promise<void> => {
    setLockError(false);
    void clearClipboardNow();
    // Only a confirmed lock leaves the unlocked UI; a failed one stays here with the
    // message, rather than dropping onto a lock screen that still says "unlocked".
    try {
      const reply = await platform.sendMessage({ version: 1, kind: "vault.lock" });
      // A refusal arrives as an error envelope, not a rejection; only "locked" counts.
      if (confirmsLocked(reply)) setVaultUnlocked(false);
      else setLockError(true);
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
      const request = {
        version: 1 as const,
        kind: "login.reveal" as const,
        itemId: item.id,
        expectedRevision: item.revision,
      };
      const reveal = platform.sendMessage(request).then((candidate) => {
        const parsed = parseLoginFillResponseForRequest(request, candidate);
        if (!parsed.success || parsed.data.kind !== "login.fillRelease")
          throw new Error("password unavailable");
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
          : outcome === "no-tab"
            ? "This page can't be filled."
            : outcome === "no-script"
              ? "Reload the page, then try again."
              : "Could not fill. Try again.",
      );
    },
    [fill, notify],
  );

  const detailMatches = (candidate: Extract<Screen, { kind: "detail" }>): boolean =>
    tab !== null &&
    candidate.urls !== undefined &&
    matchLoginUrls(tab.url, candidate.urls, candidate.urlMatches);

  return (
    <div className={styles.popup}>
      {reprompt !== null ? (
        <div className={styles.repromptOverlay}>
          <RepromptPrompt
            platform={platform}
            itemId={reprompt.itemId}
            action={reprompt.action}
            onGranted={() => {
              grantedRef.current.add(reprompt.itemId);
              const { run } = reprompt;
              setReprompt(null);
              run();
            }}
            onCancel={() => setReprompt(null)}
          />
        </div>
      ) : null}
      <div className={styles.vaultAccessWrapper} hidden={vaultUnlocked}>
        <VaultAccess platform={platform} onUnlockedChange={setVaultUnlocked} />
      </div>
      {vaultUnlocked ? (
        <>
          <PopupTitleBar
            {...(screen.kind === "home"
              ? {
                  onLock: () => void lock(),
                  onSettings: () => void openVault({ view: "settings" }),
                }
              : {
                  back: { label: "Back", onBack: pop },
                  title:
                    screen.kind === "list"
                      ? CATEGORY_TITLES[screen.category]
                      : screen.kind === "generator"
                        ? "Generate password"
                        : screen.kind === "identity"
                          ? "Your identity"
                          : screen.name,
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

          <div
            key={`${screen.kind}-${stack.length}`}
            className={`${styles.screen} ${direction === "push" ? styles.enterRight : styles.enterLeft}`}
          >
            {screen.kind === "home" ? (
              <HomeScreen
                items={vaultItems.items}
                status={vaultItems.status}
                tab={tab}
                search={search}
                onSearch={setSearch}
                onOpenCategory={(category) => push({ kind: "list", category })}
                onOpenItem={openItem}
                onFill={(item) =>
                  withReprompt(item, "fill", () => void fillItem(item.id, item.revision))
                }
                filling={filling}
                onCopyPassword={(item) => withReprompt(item, "copy", () => copyPassword(item))}
                onOpenVault={() => void openVault()}
                onRetry={() => vaultItems.refresh()}
                onCopyCode={(_item, code) => void copy(code, "Code")}
                onImport={() => void openVault({ view: "import" })}
                onNewItem={(kind) => void openVault({ newItem: kind })}
                onGenerate={() => push({ kind: "generator" })}
                pinnedIdentityId={pinnedIdentityId}
                onChooseIdentity={() => push({ kind: "identity" })}
                platform={platform}
              />
            ) : screen.kind === "list" ? (
              <ListScreen
                items={itemsInCategory(vaultItems.items, screen.category)}
                emptyText={CATEGORY_EMPTY[screen.category]}
                platform={platform}
                onOpenItem={openItem}
                onCopyPassword={(item) => withReprompt(item, "copy", () => copyPassword(item))}
                onCopyCode={(_item, code) => void copy(code, "Code")}
              />
            ) : screen.kind === "generator" ? (
              <GeneratorScreen
                platform={platform}
                onFillData={(item) => withReprompt(item, "fill", () => void fillDataItem(item))}
                fillingData={fillingData === screen.itemId}
                onCopy={(value, label) => void copy(value, label)}
              />
            ) : screen.kind === "identity" ? (
              <IdentityScreen
                identities={vaultItems.items.filter((item) => item.kind === "identity")}
                pinnedId={pinnedIdentityId}
                onPick={(id) => {
                  setPinnedIdentityId(id);
                  writePinnedIdentity(id);
                  pop();
                }}
                onCreate={() => void openVault({ newItem: "identity" })}
              />
            ) : (
              <DetailScreen
                itemId={screen.itemId}
                platform={platform}
                tab={tab}
                tabMatches={detailMatches(screen)}
                filling={filling === screen.itemId}
                onFill={(item: LoginItem) =>
                  withReprompt(item, "fill", () => void fillItem(item.id, item.revision))
                }
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
