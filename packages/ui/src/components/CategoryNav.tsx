import {
  Braces,
  CreditCard,
  Globe,
  KeyRound,
  LayoutGrid,
  Lock,
  StickyNote,
  Terminal,
  User,
} from "lucide-react";
import type { ComponentType } from "react";
import type { VaultItemKind } from "@shardpass/domain";

import styles from "./CategoryNav.module.css";

/** A kind, everything, or one of the secret types that deserve a row of their own. */
export type CategoryKey = VaultItemKind | "all" | "api_key" | "ssh_key";

interface CategoryDefinition {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  key: CategoryKey;
  label: string;
  /** Drawn after a divider: a narrower slice of a kind above it. */
  secondary?: true;
}

const CATEGORIES: readonly CategoryDefinition[] = [
  { key: "all", label: "All", icon: LayoutGrid },
  { key: "login", label: "Logins", icon: Globe },
  { key: "otp", label: "One-time codes", icon: KeyRound },
  { key: "note", label: "Notes", icon: StickyNote },
  { key: "card", label: "Cards", icon: CreditCard },
  { key: "identity", label: "Identities", icon: User },
  { key: "secret", label: "Secrets", icon: Lock },
  { key: "api_key", label: "API credentials", icon: Braces, secondary: true },
  { key: "ssh_key", label: "SSH keys", icon: Terminal, secondary: true },
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
      {CATEGORIES.map(({ icon: Icon, key, label, secondary }, index) => {
        const isActive = key === active;
        const count = counts?.[key];
        const itemClasses = [styles.item, isActive ? styles.active : undefined]
          .filter(Boolean)
          .join(" ");
        const firstSecondary = secondary === true && CATEGORIES[index - 1]?.secondary !== true;

        return (
          <button
            key={key}
            type="button"
            className={firstSecondary ? `${itemClasses} ${styles.afterDivider}` : itemClasses}
            aria-current={isActive ? "true" : undefined}
            onClick={() => onSelect(key)}
          >
            <span className={styles.icon} data-key={key} aria-hidden="true">
              <Icon size={14} strokeWidth={2.25} />
            </span>
            <span className={styles.label}>{label}</span>
            {count === undefined ? null : <span className={styles.count}>{count}</span>}
          </button>
        );
      })}
    </nav>
  );
}
