import { CreditCard, Globe, KeyRound, LayoutGrid, Lock, StickyNote, User } from "lucide-react";
import type { ComponentType } from "react";
import type { VaultItemKind } from "@shardpass/domain";

import styles from "./CategoryNav.module.css";

export type CategoryKey = VaultItemKind | "all";

interface CategoryDefinition {
  icon: ComponentType<{ size?: number }>;
  key: CategoryKey;
  label: string;
}

const CATEGORIES: readonly CategoryDefinition[] = [
  { key: "all", label: "All", icon: LayoutGrid },
  { key: "login", label: "Logins", icon: Globe },
  { key: "otp", label: "OTP", icon: KeyRound },
  { key: "note", label: "Notes", icon: StickyNote },
  { key: "card", label: "Cards", icon: CreditCard },
  { key: "identity", label: "Identity", icon: User },
  { key: "secret", label: "Secrets", icon: Lock },
];

export interface CategoryNavProps {
  active: CategoryKey;
  className?: string;
  counts?: Partial<Record<CategoryKey, number>>;
  onSelect: (key: CategoryKey) => void;
}

export function CategoryNav({ active, className, counts, onSelect }: CategoryNavProps) {
  const navClasses = [styles.nav, className].filter(Boolean).join(" ");

  return (
    <nav className={navClasses} aria-label="Categories">
      {CATEGORIES.map(({ icon: Icon, key, label }) => {
        const isActive = key === active;
        const count = counts?.[key];
        const itemClasses = [styles.item, isActive ? styles.active : undefined]
          .filter(Boolean)
          .join(" ");

        return (
          <button
            key={key}
            type="button"
            className={itemClasses}
            aria-current={isActive ? "true" : undefined}
            onClick={() => onSelect(key)}
          >
            <span className={styles.icon} aria-hidden="true">
              <Icon size={16} />
            </span>
            <span className={styles.label}>{label}</span>
            {count === undefined ? null : <span className={styles.count}>{count}</span>}
          </button>
        );
      })}
    </nav>
  );
}
