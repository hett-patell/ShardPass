import { memo, useEffect, useState } from "react";
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
  /**
   * Interactive controls for the row (copy, fill). Rendered as siblings of the row's own
   * button, never inside it: a button inside a button is invalid and unreachable to
   * assistive technology.
   */
  actions?: ReactNode;
  subtitle?: string;
  /** The site's own icon, when the caller has one; the kind's icon stands in until it loads. */
  iconUrl?: string | undefined;
  /** A drawn icon (a card network's mark) in place of the kind's icon. */
  icon?: ReactNode;
}

function ItemRowView({
  active = false,
  kind,
  name,
  onClick,
  rightContent,
  actions,
  subtitle,
  iconUrl,
  icon,
}: ItemRowProps) {
  const Icon = ICONS[kind];
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [iconUrl]);
  const showImage = iconUrl !== undefined && !broken;
  // A login the browser has no icon for gets its initials in a colour of its own instead.
  const initials = kind === "login" && !showImage ? initialsOf(name) : null;
  const hue = initials === null ? 0 : hueOf(name);
  const classes = [styles.row, active ? styles.active : undefined].filter(Boolean).join(" ");

  const row = (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      aria-current={active ? "true" : undefined}
    >
      <span className={styles.icon} aria-hidden="true">
        {icon !== undefined ? (
          icon
        ) : initials !== null ? (
          <span className={styles.initialsTile} style={{ ["--tile-hue" as string]: hue }}>
            {initials}
          </span>
        ) : showImage ? (
          <img
            className={styles.favicon}
            src={iconUrl}
            alt=""
            width={16}
            height={16}
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
          />
        ) : (
          <Icon size={16} />
        )}
      </span>
      <span className={styles.content}>
        <span className={styles.name}>{name}</span>
        {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
      </span>
      {rightContent ? <span className={styles.right}>{rightContent}</span> : null}
    </button>
  );
  if (!actions) return row;
  return (
    <div
      className={[styles.shell, active ? styles.shellActive : undefined].filter(Boolean).join(" ")}
    >
      {row}
      <span className={styles.actions}>{actions}</span>
    </div>
  );
}

/** Memoised: a list of a thousand rows must not redraw every row on each keystroke. */
export const ItemRow = memo(ItemRowView);

/** A hue from the name, so the same login always gets the same colour. */
function hueOf(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return hash % 360;
}

/** The first letters of the first two words ("Google Workspace" → "GW"). */
function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== "");
  const first = words[0]?.charAt(0) ?? "";
  const second = words[1]?.charAt(0) ?? words[0]?.charAt(1) ?? "";
  return (first + second).toUpperCase() || "?";
}
