import type { VaultItemKind } from "@shardpass/domain";
import { Button } from "@shardpass/ui";
import {
  CreditCard,
  Globe,
  KeyRound,
  Lock,
  Plus,
  StickyNote,
  User,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import styles from "./AddItemMenu.module.css";

interface AddOption {
  icon: LucideIcon;
  kind: VaultItemKind;
  label: string;
}

const ADD_OPTIONS: readonly AddOption[] = [
  { kind: "login", label: "Login", icon: Globe },
  { kind: "otp", label: "OTP", icon: KeyRound },
  { kind: "note", label: "Note", icon: StickyNote },
  { kind: "card", label: "Card", icon: CreditCard },
  { kind: "identity", label: "Identity", icon: User },
  { kind: "secret", label: "Secret", icon: Lock },
];

export interface AddItemMenuProps {
  platform: Pick<ExtensionPlatform, "openVaultPage">;
}

// The vault app does not yet expose per-kind add routes, so every option opens the
// same vault tab; once the vault UI defines deep-linkable add forms, `selectKind` is
// the place to pass the chosen kind through (e.g. as a URL fragment).
export function AddItemMenu({ platform }: AddItemMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function selectKind(): void {
    setOpen(false);
    void platform.openVaultPage().catch(() => undefined);
  }

  return (
    <div className={styles.container} ref={containerRef}>
      {open ? (
        <ul className={styles.menu} role="menu" aria-label="Add item">
          {ADD_OPTIONS.map(({ kind, label, icon: Icon }) => (
            <li key={kind} role="none">
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={selectKind}
              >
                <Icon size={14} aria-hidden="true" />
                <span>{label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        className={styles.trigger}
        variant="secondary"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Plus size={16} aria-hidden="true" />
        <span>Add item</span>
      </Button>
    </div>
  );
}
