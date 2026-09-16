import type { VaultItemKind } from "@shardpass/domain";
import { CreditCard, Globe, KeyRound, Lock, StickyNote, User, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import styles from "./KindIcon.module.css";

export const KIND_ICONS: Record<VaultItemKind, LucideIcon> = {
  login: Globe,
  otp: KeyRound,
  note: StickyNote,
  card: CreditCard,
  identity: User,
  secret: Lock,
};

export const KIND_LABELS: Record<VaultItemKind, string> = {
  login: "Login",
  otp: "One-time code",
  note: "Note",
  card: "Card",
  identity: "Identity",
  secret: "Secret",
};

export function KindIcon({
  kind,
  size = "md",
  iconUrl,
}: {
  kind: VaultItemKind;
  size?: "md" | "lg";
  /** The site's own icon; the kind's icon stands in until it loads or when it cannot. */
  iconUrl?: string | undefined;
}) {
  const Icon = KIND_ICONS[kind];
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [iconUrl]);
  const pixels = size === "lg" ? 20 : 16;
  return (
    <span className={`${styles.icon} ${size === "lg" ? styles.large : ""}`} aria-hidden="true">
      {iconUrl !== undefined && !broken ? (
        <img
          className={styles.favicon}
          src={iconUrl}
          alt=""
          width={pixels}
          height={pixels}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <Icon size={pixels} strokeWidth={1.75} />
      )}
    </span>
  );
}
