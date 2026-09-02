import type { VaultItemKind } from "@shardpass/domain";

import styles from "./FilterTabs.module.css";

export type FilterTabKey = VaultItemKind | "all";

interface TabDefinition {
  key: FilterTabKey;
  label: string;
}

// No "identity" tab: identity items are niche enough to skip a dedicated tab in the
// compact popup, but they still appear under "All" (see useVaultItems / item.list).
const TABS: readonly TabDefinition[] = [
  { key: "all", label: "All" },
  { key: "login", label: "Logins" },
  { key: "otp", label: "OTP" },
  { key: "note", label: "Notes" },
  { key: "card", label: "Cards" },
  { key: "secret", label: "Secrets" },
];

export interface FilterTabsProps {
  active: FilterTabKey;
  onChange: (key: FilterTabKey) => void;
}

export function FilterTabs({ active, onChange }: FilterTabsProps) {
  return (
    <div className={styles.tabs} role="tablist" aria-label="Filter items">
      {TABS.map(({ key, label }) => {
        const selected = key === active;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={selected}
            className={[styles.tab, selected ? styles.active : undefined].filter(Boolean).join(" ")}
            onClick={() => onChange(key)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
