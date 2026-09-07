import type { VaultItemKind } from "@shardpass/domain";
import type { ItemListItemProjection } from "@shardpass/messaging";
import { matchLoginUrls } from "@shardpass/autofill";
import { Button, SearchBar, SectionLabel } from "@shardpass/ui";
import { ChevronRight, ExternalLink, KeyRound, LayoutGrid, Plus, Star, type LucideIcon } from "lucide-react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { KIND_ICONS } from "../components/KindIcon";
import { PopupRow } from "../components/PopupRow";
import { RowActions } from "../components/RowActions";
import { QuickAction } from "../components/QuickAction";
import type { ActiveTab } from "../hooks/useActiveTab";
import { itemsInCategory, projectionMatches, type CategoryId } from "../hooks/useVaultItems";
import styles from "./HomeScreen.module.css";

const CATEGORIES: readonly { id: CategoryId; label: string; icon: LucideIcon }[] = [
  { id: "favorites", label: "Favorites", icon: Star },
  { id: "all", label: "All items", icon: LayoutGrid },
  { id: "login", label: "Logins", icon: KIND_ICONS.login },
  { id: "otp", label: "One-time codes", icon: KIND_ICONS.otp },
  { id: "note", label: "Notes", icon: KIND_ICONS.note },
  { id: "card", label: "Cards", icon: KIND_ICONS.card },
  { id: "identity", label: "Identities", icon: KIND_ICONS.identity },
  { id: "secret", label: "Secrets", icon: KIND_ICONS.secret },
];

export const CATEGORY_TITLES: Record<CategoryId, string> = Object.fromEntries(
  CATEGORIES.map((category) => [category.id, category.label]),
) as Record<CategoryId, string>;

/** Empty-list copy per category, in the popup's own voice. */
export const CATEGORY_EMPTY: Record<CategoryId, string> = {
  favorites: "Nothing marked as a favorite yet.",
  all: "Nothing in your vault yet.",
  login: "No logins yet.",
  otp: "No one-time codes yet.",
  note: "No notes yet.",
  card: "No cards yet.",
  identity: "No identities yet.",
  secret: "No secrets yet.",
};

const MAX_SEARCH_RESULTS = 60;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}` : (parts[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
}

export interface HomeScreenProps {
  items: readonly ItemListItemProjection[];
  status: "error" | "loading" | "locked" | "ready";
  tab: ActiveTab | null;
  search: string;
  onSearch: (value: string) => void;
  onOpenCategory: (category: CategoryId) => void;
  onOpenItem: (item: ItemListItemProjection) => void;
  onFill: (item: ItemListItemProjection) => void;
  filling: string | null;
  onCopyPassword: (item: ItemListItemProjection) => void;
  onOpenVault: () => void;
  /** Loads the vault again after "Items unavailable". */
  onRetry: () => void;
  onCopyCode: (item: ItemListItemProjection, code: string) => void;
  /** Opens the vault page at its import section. */
  onImport: () => void;
  onNewItem: (kind: VaultItemKind) => void;
  /** Opens the password generator screen. */
  onGenerate: () => void;
  platform: Pick<ExtensionPlatform, "sendOtpMessage">;
}

/** Suggestions for the open tab, then the categories: the popup's first screen. */
export function HomeScreen({
  items,
  status,
  tab,
  search,
  onSearch,
  onOpenCategory,
  onOpenItem,
  onFill,
  filling,
  onCopyPassword,
  onOpenVault,
  platform,
  onRetry,
  onCopyCode,
  onImport,
  onNewItem,
  onGenerate,
}: HomeScreenProps) {
  const query = search.trim();
  const suggestions =
    tab === null
      ? []
      : items.filter(
          (item) =>
            item.kind === "login" && item.urls !== undefined && matchLoginUrls(tab.url, item.urls, item.urlMatches),
        );
  const matches = query === "" ? [] : items.filter((item) => projectionMatches(item, query));
  const results = matches.slice(0, MAX_SEARCH_RESULTS);
  const resultCount = matches.length > MAX_SEARCH_RESULTS ? `${MAX_SEARCH_RESULTS}+` : String(matches.length);
  // The person's own identity sits above everything: the favourite one, else the first.
  const identity =
    items.filter((item) => item.kind === "identity").sort((left, right) => Number(right.favorite) - Number(left.favorite))[0] ??
    null;

  return (
    <div className={styles.screen}>
      <div className={styles.searchRow}>
        <SearchBar value={search} onChange={onSearch} placeholder="Search ShardPass" autoFocus />
      </div>

      <div className={styles.scroll}>
        {status === "error" ? (
          <p className={styles.error} role="alert">
            Items unavailable.{" "}
            <button type="button" className={styles.retry} onClick={onRetry}>
              Try again
            </button>
          </p>
        ) : null}

        {query !== "" ? (
          <section aria-labelledby="results-label">
            <SectionLabel id="results-label" className={styles.sectionLabel} trailing={resultCount}>
              Results
            </SectionLabel>
            {results.length === 0 ? (
              <p className={styles.quiet}>Nothing matches “{query}”.</p>
            ) : (
              <ul className={styles.list}>
                {results.map((item) => (
                  <li key={item.id}>
                    <PopupRow
                      item={item}
                      onOpen={onOpenItem}
                      actions={
                        <RowActions
                          item={item}
                          platform={platform}
                          onCopyPassword={onCopyPassword}
                          onCopyCode={onCopyCode}
                          {...(item.kind === "login" &&
                          tab !== null &&
                          item.urls !== undefined &&
                          matchLoginUrls(tab.url, item.urls, item.urlMatches)
                            ? { onFill, filling: filling === item.id }
                            : {})}
                        />
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <>
            {status === "ready" && items.length === 0 ? (
              <section className={styles.getStarted} aria-labelledby="get-started-label">
                <SectionLabel id="get-started-label" className={styles.sectionLabel}>
                  Get started
                </SectionLabel>
                <p className={styles.getStartedCopy}>
                  Your vault is empty. Bring your passwords over from your browser, 1Password, Bitwarden or KeePass,
                  or add the first one by hand.
                </p>
                <div className={styles.getStartedActions}>
                  <Button onClick={onImport}>Import passwords</Button>
                  <Button variant="secondary" onClick={() => onNewItem("login")}>
                    Add a login
                  </Button>
                </div>
              </section>
            ) : null}

            {identity !== null ? (
              <button
                type="button"
                className={styles.identity}
                aria-label={`Your identity: ${identity.name}`}
                onClick={() => onOpenItem(identity)}
              >
                <span className={styles.avatar} aria-hidden="true">
                  {initials(identity.name)}
                </span>
                <span className={styles.identityText}>
                  <span className={styles.identityName}>{identity.name}</span>
                  {identity.subtitle ? <span className={styles.identityEmail}>{identity.subtitle}</span> : null}
                </span>
                <ChevronRight size={16} className={styles.chevron} aria-hidden="true" />
              </button>
            ) : null}

            {tab !== null ? (
              <section aria-labelledby="suggestions-label">
                <SectionLabel id="suggestions-label" className={styles.sectionLabel} trailing={tab.host}>
                  Suggestions
                </SectionLabel>
                {status === "loading" ? (
                  <ul className={styles.list} aria-busy="true">
                    <li className={styles.skeleton} />
                    <li className={styles.skeleton} />
                  </ul>
                ) : suggestions.length === 0 ? (
                  <p className={styles.quiet}>No logins saved for {tab.host}.</p>
                ) : (
                  <ul className={styles.list}>
                    {suggestions.map((item) => (
                      <li key={item.id}>
                        <PopupRow
                          item={item}
                          onOpen={onOpenItem}
                          actions={
                            <>
                              <QuickAction
                                aria-label={`Copy password for ${item.name}`}
                                title="Copy password"
                                onClick={() => onCopyPassword(item)}
                              >
                                <KeyRound size={15} />
                              </QuickAction>
                              <Button
                                className={styles.fill}
                                loading={filling === item.id}
                                onClick={() => onFill(item)}
                              >
                                Fill
                              </Button>
                            </>
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            <section aria-labelledby="categories-label">
              <SectionLabel id="categories-label" className={styles.sectionLabel}>
                Categories
              </SectionLabel>
              <ul className={styles.list}>
                {CATEGORIES.map(({ id, label, icon: Icon }) => {
                  const count = status === "ready" ? itemsInCategory(items, id).length : null;
                  return (
                    <li key={id}>
                      <button type="button" className={styles.category} onClick={() => onOpenCategory(id)}>
                        <span className={styles.categoryIcon} aria-hidden="true">
                          <Icon size={16} strokeWidth={1.75} />
                        </span>
                        <span className={styles.categoryLabel}>{label}</span>
                        {count === null ? null : <span className={styles.count}>{count}</span>}
                        <ChevronRight size={16} className={styles.chevron} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.footerButton} onClick={() => onNewItem("login")}>
          <Plus size={16} aria-hidden="true" />
          New item
        </button>
        <button type="button" className={styles.footerButton} onClick={onGenerate}>
          <KeyRound size={16} aria-hidden="true" />
          Generate
        </button>
        <button type="button" className={styles.footerButton} onClick={onOpenVault}>
          <ExternalLink size={16} aria-hidden="true" />
          Open vault
        </button>
      </footer>
    </div>
  );
}
