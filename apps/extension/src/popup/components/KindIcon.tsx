import type { VaultItemKind } from "@shardpass/domain";
import { CreditCard, Globe, KeyRound, Lock, StickyNote, User, type LucideIcon } from "lucide-react";

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

export function KindIcon({ kind, size = "md" }: { kind: VaultItemKind; size?: "md" | "lg" }) {
  const Icon = KIND_ICONS[kind];
  return (
    <span className={`${styles.icon} ${size === "lg" ? styles.large : ""}`} aria-hidden="true">
      <Icon size={size === "lg" ? 20 : 16} strokeWidth={1.75} />
    </span>
  );
}
