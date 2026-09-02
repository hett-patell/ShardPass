import { CreditCard, Globe, KeyRound, Lock, StickyNote, User } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { VaultItemKind } from "@shardpass/domain";

import styles from "./ItemRow.module.css";

const ICONS: Record<VaultItemKind, ComponentType<{ size?: number }>> = {
  login: Globe,
  otp: KeyRound,
  note: StickyNote,
  card: CreditCard,
  identity: User,
  secret: Lock,
};

export interface ItemRowProps {
  active?: boolean;
  kind: VaultItemKind;
  name: string;
  onClick?: () => void;
  rightContent?: ReactNode;
  subtitle?: string;
}

export function ItemRow({
  active = false,
  kind,
  name,
  onClick,
  rightContent,
  subtitle,
}: ItemRowProps) {
  const Icon = ICONS[kind];
  const classes = [styles.row, active ? styles.active : undefined].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      aria-current={active ? "true" : undefined}
    >
      <span className={styles.icon} aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className={styles.content}>
        <span className={styles.name}>{name}</span>
        {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
      </span>
      {rightContent ? <span className={styles.right}>{rightContent}</span> : null}
    </button>
  );
}
